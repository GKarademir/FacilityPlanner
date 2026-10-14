// Facility Planer · Author: Geray S. Karademir

import * as D from "./day.js";
import * as Fmt from "./fmt.js";
import * as R from "./recurrence.js";
import * as A from "./agenda.js";
import * as Backup from "./backup.js";
import * as Report from "./report.js";
import * as Reminders from "./reminders.js";
import { Store, Prefs } from "./store.js";
import { icons } from "./icons.js";
import { sheet, confirmDialog, alertDialog, actionMenu } from "./dialogs.js";

const esc = Report.esc;
/** Escapes text for a <textarea> (keeps line breaks). */
const escText = (s) => esc(s).replaceAll("<br>", "\n");
const store = new Store();
const prefs = new Prefs();

/** Screen state that is not data (iOS: @State of the views). */
const ui = {
  day: D.today(),
  lastToday: D.today(),
  expanded: new Set(),
  edit: null,
  report: {
    propertyId: null,
    from: D.firstOfMonth(D.today()),
    to: D.lastOfMonth(D.today()),
    type: "PROTOCOL",
  },
  installPrompt: null,
};

const viewEl = document.getElementById("view");
const isBlank = (s) => (s ?? "").trim() === "";

// MARK: - Routing

/** #/heute | #/objekte | #/objekte/:id | #/objekte/:id/aufgabe/:taskId|neu | #/berichte | #/einstellungen */
function route() {
  const parts = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  const tab = ["heute", "objekte", "berichte", "einstellungen"].includes(parts[0]) ? parts[0] : "heute";
  return {
    tab,
    propertyId: tab === "objekte" && parts[1] ? Number(parts[1]) : null,
    taskId: tab === "objekte" && parts[2] === "aufgabe" ? (parts[3] === "neu" ? 0 : Number(parts[3])) : null,
  };
}

function render() {
  const r = route();
  let view;
  if (r.tab === "objekte" && r.taskId !== null) view = viewTaskEdit(r.propertyId, r.taskId);
  else if (r.tab === "objekte" && r.propertyId !== null) view = viewPropertyDetail(r.propertyId);
  else if (r.tab === "objekte") view = viewProperties();
  else if (r.tab === "berichte") view = viewReports();
  else if (r.tab === "einstellungen") view = viewSettings();
  else view = viewToday();

  if (r.taskId === null) ui.edit = null;
  viewEl.className = view.className ?? "";
  viewEl.innerHTML = view.html;
  view.mount?.(viewEl);
  document.querySelectorAll(".tabbar a").forEach((a) => {
    const active = a.dataset.tab === r.tab;
    a.classList.toggle("active", active);
    if (active) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
}

// MARK: - Building blocks

function bar(title, { left = "", right = "" } = {}) {
  return `<header class="bar">
    <div class="bar-side">${left}</div>
    <h1>${esc(title)}</h1>
    <div class="bar-side right">${right}</div>
  </header>`;
}

const backLink = (href, label = "Zurück") =>
  `<a class="bar-btn" href="${href}" aria-label="${esc(label)}">${icons.back}<span>${esc(label)}</span></a>`;

const iconButton = (action, icon, label, attrs = "") =>
  `<button type="button" class="bar-btn" data-action="${action}" aria-label="${esc(label)}" title="${esc(label)}" ${attrs}>${icon}</button>`;

const hint = (text) => `<p class="hint">${esc(text)}</p>`;

const sectionHeader = (text) => `<h3 class="section-header">${esc(text)}</h3>`;
const sectionFooter = (text, cls = "") => `<p class="section-footer ${cls}">${esc(text)}</p>`;

function stepper(field, value, label, min, max) {
  return `<div class="row stepper">
    <span class="grow">${esc(label)}</span>
    <div class="stepper-buttons">
      <button type="button" data-action="step" data-field="${field}" data-delta="-1" data-min="${min}" data-max="${max}"
        aria-label="Weniger" ${value <= min ? "disabled" : ""}>−</button>
      <button type="button" data-action="step" data-field="${field}" data-delta="1" data-min="${min}" data-max="${max}"
        aria-label="Mehr" ${value >= max ? "disabled" : ""}>+</button>
    </div>
  </div>`;
}

const options = (items, selected) =>
  items.map(([value, label]) =>
    `<option value="${esc(value)}" ${String(value) === String(selected) ? "selected" : ""}>${esc(label)}</option>`).join("");

// MARK: - Heute

/**
 * Every property with its open items: properties with open items first, then those with
 * nothing due, each sorted by name. Items without a known property go after the active ones.
 */
function propertyGroups(s, open, done, day) {
  const byProperty = A.groupBy(open, (i) => i.task.propertyId);
  // Properties where a task was completed (or skipped) on the shown day.
  const worked = new Set(done.map((d) => d.task.propertyId));
  const known = s.properties.map((p) => ({
    propertyId: p.id, name: p.name, items: byProperty.get(p.id) ?? [], times: s.timeEntriesOn(p.id, day),
    worked: worked.has(p.id),
  }));
  const orphans = open.filter((i) => !s.propertyById.has(i.task.propertyId));
  const active = known.filter((g) => g.items.length > 0);
  const inactive = known.filter((g) => g.items.length === 0);
  const orphanGroup = orphans.length ? [{ propertyId: -1, name: "Ohne Objekt", items: orphans, times: [], worked: false }] : [];
  return [...active, ...orphanGroup, ...inactive];
}

function viewToday() {
  const s = store.snapshot;
  const today = D.today();
  const day = ui.day;
  const open = A.openItems(s, day);
  const done = A.completedOn(s, day);
  const groups = propertyGroups(s, open, done, day);
  // One-off tasks only make sense for today or a later day.
  const canAdd = day >= today && s.properties.length > 0;

  let h = bar("Aufgaben", { right: canAdd ? iconButton("add-oneoff", icons.plus, "Einmalige Aufgabe") : "" });
  h += '<div class="content">';
  h += `<section class="group day-header">
    <button type="button" class="icon-btn accent" data-action="day" data-delta="-1" aria-label="Vorheriger Tag">${icons.left}</button>
    <div class="day-title">
      <div class="headline">${day === today ? "Heute" : esc(Fmt.dayLong(day))}</div>
      ${day === today
        ? `<div class="caption">${esc(Fmt.dayLong(day))}</div>`
        : '<button type="button" class="link small" data-action="day-today">Zu heute</button>'}
    </div>
    <button type="button" class="icon-btn accent" data-action="day" data-delta="1" aria-label="Nächster Tag">${icons.right}</button>
  </section>`;

  if (s.tasks.length === 0) {
    h += hint("Noch keine Aufgaben angelegt.\nUnter „Objekte“ ein Objekt anlegen und dort Aufgaben hinzufügen.");
  } else if (open.length === 0) {
    h += hint("Alles erledigt. ✓");
  }

  for (const g of groups) h += propertyCard(g, day);

  if (done.length > 0) {
    h += sectionHeader(`Erledigt (${done.length})`);
    h += `<section class="group">${done.map(doneRow).join("")}</section>`;
  }
  h += "</div>";
  return { html: h };
}

function propertyCard(g, day) {
  const count = g.items.length;
  const overdue = g.items.filter((i) => i.dueDate < day).length;
  const totalMinutes = g.times.reduce((m, e) => m + Backup.entryMinutes(e), 0);
  // Active on this day: something is still open or a task was already done here.
  const active = count > 0 || g.worked;
  // Working time stays editable after the last task of the day is done.
  const expandable = active || g.times.length > 0;
  const expanded = expandable && ui.expanded.has(g.propertyId);

  let subtitle = `<span class="muted">${count > 0 ? `${count} offen` : "Nichts offen ✓"}</span>`;
  if (overdue > 0) subtitle += `<span class="danger"> · ${overdue} überfällig</span>`;
  if (totalMinutes > 0) subtitle += `<span class="muted"> · ${Fmt.duration(totalMinutes)} erfasst</span>`;

  let h = `<section class="group card ${count > 0 ? "" : "inactive"}">
    <button type="button" class="row card-head" data-action="toggle-group" data-id="${g.propertyId}"
      ${expandable ? `aria-expanded="${expanded}"` : "disabled"}>
      <div class="grow">
        <div class="headline">${esc(g.name)}</div>
        <div class="caption">${subtitle}</div>
      </div>
      ${expandable ? `<span class="chev ${expanded ? "up" : ""}" aria-hidden="true">${icons.down}</span>` : ""}
    </button>`;

  if (expanded) {
    for (const item of g.items) h += openItemRow(item, day);
    h += '<div class="row sub-head">Arbeitszeit</div>';
    for (const e of g.times) {
      const details = [Fmt.duration(Backup.entryMinutes(e)), isBlank(e.workedBy) ? null : e.workedBy].filter(Boolean).join(" · ");
      h += `<div class="row">
        <span>${Fmt.time(e.startTime)} – ${Fmt.time(e.endTime)}</span>
        <span class="caption muted grow">${esc(details)}</span>
        <button type="button" class="icon-btn muted" data-action="delete-time" data-id="${e.id}" aria-label="Arbeitszeit löschen">${icons.trash}</button>
      </div>`;
    }
    // Time can be added while the object has an open task or one done on this day.
    if (active && g.propertyId > 0) {
      h += `<button type="button" class="row link-row" data-action="add-time" data-id="${g.propertyId}">${icons.plus}<span>Zeit erfassen</span></button>`;
    } else if (g.times.length === 0) {
      h += '<div class="row caption muted">Keine Zeit erfasst.</div>';
    }
  }
  return h + "</section>";
}

function openItemRow(item, day) {
  const overdueDays = D.daysBetween(item.dueDate, day);
  const ref = `data-task="${item.task.id}" data-due="${item.dueDate}"`;
  return `<div class="row item">
    <button type="button" class="check" data-action="done" ${ref} aria-label="Als erledigt markieren">${icons.circle}</button>
    <div class="grow">
      <div>${esc(item.task.title)}</div>
      ${isBlank(item.task.description) ? "" : `<div class="caption muted clamp">${esc(item.task.description)}</div>`}
      ${overdueDays > 0
        ? `<div class="caption danger strong">Überfällig seit ${Fmt.date(item.dueDate)} (${overdueDays} ${overdueDays === 1 ? "Tag" : "Tage"})</div>`
        : ""}
    </div>
    <button type="button" class="icon-btn muted" data-action="item-menu" ${ref} aria-label="Weitere Aktionen">${icons.more}</button>
  </div>`;
}

function doneRow(item) {
  const r = item.record;
  const skipped = r.status === "SKIPPED";
  const parts = [Fmt.timeMillis(r.completedAt)];
  if (!isBlank(r.completedBy)) parts.push(r.completedBy);
  parts.push(`fällig ${Fmt.date(r.dueDate)}`);
  if (!isBlank(r.note)) parts.push(r.note);
  const details = [item.property?.name, ...parts].filter(Boolean).join(" · ");
  return `<div class="row">
    <span class="${skipped ? "muted" : "accent"} done-icon" aria-label="${skipped ? "Übersprungen" : "Erledigt"}">${skipped ? icons.x : icons.check}</span>
    <div class="grow">
      <div>${skipped ? "Übersprungen: " : ""}${esc(item.task.title)}</div>
      <div class="caption muted">${esc(details)}</div>
    </div>
    <button type="button" class="link small" data-action="undo" data-id="${r.id}">Rückgängig</button>
  </div>`;
}

function findItem(el) {
  const taskId = Number(el.dataset.task);
  const dueDate = Number(el.dataset.due);
  const task = store.snapshot.taskById.get(taskId);
  return task ? { task, dueDate } : null;
}

function noteSheet(item, status) {
  const isDone = status === "DONE";
  sheet({
    title: (isDone ? "Erledigt: " : "Überspringen: ") + item.task.title,
    html: `<label class="field"><span>${isDone ? "Notiz (optional)" : "Grund"}</span>
      <textarea name="note" rows="3" autofocus></textarea></label>`,
    valid: (f) => isDone || !isBlank(f.note.value),
    onConfirm: (f) => store.record({
      taskId: item.task.id, dueDate: item.dueDate, status, note: f.note.value.trim(), by: prefs.author,
    }),
  });
}

/** Start and end on the shown day; the end has to be after the start. */
function timeSheet(property) {
  const day = ui.day;
  // Default: the hour that just ended, in 5-minute steps.
  const now = D.timeNow();
  const end = Math.floor(now / 5) * 5;
  const start = end >= 60 ? end - 60 : 0;
  sheet({
    title: `Arbeitszeit: ${property.name}`,
    html: `<label class="field inline"><span>Beginn</span><input type="time" name="start" value="${D.timeText(start)}" required></label>
      <label class="field inline"><span>Ende</span><input type="time" name="end" value="${D.timeText(end)}" required></label>
      <p class="field-note" data-hint></p>`,
    valid: (f) => {
      const a = D.parseTime(f.start.value);
      const b = D.parseTime(f.end.value);
      return a !== null && b !== null && b > a;
    },
    update: (f) => {
      const a = D.parseTime(f.start.value);
      const b = D.parseTime(f.end.value);
      const el = f.querySelector("[data-hint]");
      if (a !== null && b !== null && b > a) {
        el.textContent = `Dauer: ${Fmt.duration(Backup.roundedMinutes(a, b))} (auf Viertelstunden aufgerundet)`;
        el.classList.remove("danger");
      } else {
        el.textContent = "Das Ende muss nach dem Beginn liegen.";
        el.classList.add("danger");
      }
    },
    onConfirm: (f) => store.addTimeEntry({
      propertyId: property.id, date: day,
      startTime: D.parseTime(f.start.value), endTime: D.parseTime(f.end.value), workedBy: prefs.author,
    }),
  });
}

/** Creates a task that is due only once, on the shown day, for the chosen object. */
function oneOffSheet() {
  const s = store.snapshot;
  const day = ui.day;
  const single = s.properties.length === 1 ? s.properties[0].id : "";
  sheet({
    title: `Einmalige Aufgabe für ${day === D.today() ? "heute" : Fmt.date(day)}`,
    confirm: "Hinzufügen",
    html: `<label class="field"><span>Objekt</span><select name="property">
        <option value="" ${single === "" ? "selected" : ""}>Bitte wählen</option>
        ${options(s.properties.map((p) => [p.id, p.name]), single)}
      </select></label>
      <label class="field"><span>Titel</span><input name="title" autocomplete="off" ${single !== "" ? "autofocus" : ""}></label>
      <label class="field"><span>Beschreibung (optional)</span><textarea name="description" rows="3"></textarea></label>`,
    valid: (f) => f.property.value !== "" && !isBlank(f.title.value),
    onConfirm: (f) => {
      const propertyId = Number(f.property.value);
      store.createTask(
        { id: 0, propertyId, title: f.title.value.trim(), description: f.description.value.trim() },
        newSchedule({ startDate: day, frequency: "ONCE" }),
      );
      ui.expanded.add(propertyId);
      render();
    },
  });
}

function newSchedule(fields) {
  return {
    id: 0, taskId: 0, validFrom: fields.startDate, every: 1, weekdays: 0, dayOfMonth: 0,
    endDate: null, mode: "FIXED", ...fields,
  };
}

// MARK: - Objekte

function viewProperties() {
  const s = store.snapshot;
  let h = bar("Objekte", { right: iconButton("new-property", icons.plus, "Objekt hinzufügen") });
  h += '<div class="content">';
  if (s.properties.length === 0) {
    h += `<div class="empty">${icons.house}<h2>Noch keine Objekte</h2><p>Mit + das erste Objekt anlegen, z. B. ein Haus.</p></div>`;
  } else {
    const openCount = A.groupBy(A.openItems(s, D.today()), (i) => i.task.propertyId);
    const taskCount = A.groupBy(s.tasks, (t) => t.propertyId);
    h += '<section class="group">';
    for (const p of s.properties) {
      const tasks = taskCount.get(p.id)?.length ?? 0;
      const open = openCount.get(p.id)?.length ?? 0;
      const sub = [isBlank(p.address) ? null : p.address, `${tasks} ${tasks === 1 ? "Aufgabe" : "Aufgaben"}`].filter(Boolean).join(" · ");
      h += `<a class="row nav" href="#/objekte/${p.id}">
        <div class="grow"><div>${esc(p.name)}</div><div class="caption muted">${esc(sub)}</div></div>
        ${open > 0 ? `<span class="badge">${open} offen</span>` : ""}
        <span class="chev-right" aria-hidden="true">${icons.right}</span>
      </a>`;
    }
    h += "</section>";
  }
  return { html: h + "</div>" };
}

function propertySheet(initial) {
  sheet({
    title: initial ? "Objekt bearbeiten" : "Neues Objekt",
    html: `<label class="field"><span>Name</span><input name="name" value="${esc(initial?.name ?? "")}" autocomplete="off" autofocus></label>
      <label class="field"><span>Adresse (optional)</span><textarea name="address" rows="2">${escText(initial?.address)}</textarea></label>
      <label class="field"><span>Notizen (optional)</span><textarea name="notes" rows="3">${escText(initial?.notes)}</textarea></label>`,
    valid: (f) => !isBlank(f.name.value),
    onConfirm: (f) => store.saveProperty({
      id: initial?.id ?? 0,
      name: f.name.value.trim(),
      address: f.address.value.trim(),
      notes: f.notes.value.trim(),
    }),
  });
}

function viewPropertyDetail(propertyId) {
  const s = store.snapshot;
  const today = D.today();
  const property = s.propertyById.get(propertyId);
  if (!property) {
    return { html: bar("Objekt", { left: backLink("#/objekte", "Objekte") }) + hint("Objekt nicht gefunden.") };
  }
  const tasks = s.tasks.filter((t) => t.propertyId === propertyId);
  let h = bar(property.name, {
    left: backLink("#/objekte", "Objekte"),
    right: `<a class="bar-btn" href="#/objekte/${propertyId}/aufgabe/neu" aria-label="Aufgabe hinzufügen" title="Aufgabe hinzufügen">${icons.plus}</a>` +
      iconButton("property-menu", icons.more, "Mehr", `data-id="${propertyId}"`),
  });
  h += '<div class="content">';
  if (!isBlank(property.address) || !isBlank(property.notes)) {
    h += '<section class="group">';
    if (!isBlank(property.address)) h += `<div class="row"><div>${esc(property.address)}</div></div>`;
    if (!isBlank(property.notes)) h += `<div class="row"><div class="muted">${esc(property.notes)}</div></div>`;
    h += "</section>";
  }
  h += sectionHeader(`Aufgaben (${tasks.length})`);
  h += '<section class="group">';
  if (tasks.length === 0) h += '<div class="row muted">Noch keine Aufgaben. Mit „+ Aufgabe“ anlegen.</div>';
  for (const task of tasks) {
    const versions = s.versionsOf(task.id);
    const version = R.versionAt(versions, today) ?? versions[0] ?? null;
    const next = A.nextDue(s, task, today);
    h += `<a class="row nav" href="#/objekte/${propertyId}/aufgabe/${task.id}">
      <div class="grow">
        <div>${esc(task.title)}</div>
        <div class="subhead muted">${esc(version ? R.describe(version) : "Kein Plan")}</div>
        <div class="caption ${next !== null && next < today ? "danger" : "muted"}">${esc(nextLabel(next, today))}</div>
      </div>
      <span class="chev-right" aria-hidden="true">${icons.right}</span>
    </a>`;
  }
  h += "</section></div>";
  return { html: h };
}

function nextLabel(next, today) {
  if (next === null) return "Keine weiteren Termine";
  if (next < today) return `Überfällig seit ${Fmt.date(next)}`;
  if (next === today) return "Fällig: heute";
  return `Nächste Fälligkeit: ${Fmt.date(next)}`;
}

// MARK: - Aufgabe bearbeiten

function loadEdit(propertyId, taskId) {
  const today = D.today();
  const e = {
    key: `${propertyId}/${taskId}`,
    propertyId,
    taskId,
    today,
    title: "",
    description: "",
    frequency: "WEEKLY",
    every: 1,
    weekdays: R.weekdayBit(today),
    dayOfMonth: D.dayOfMonth(today),
    startDate: today,
    endDate: null,
    mode: "FIXED",
    hasHistory: false,
    missing: false,
  };
  if (taskId !== 0) {
    const task = store.task(taskId);
    if (!task) return { ...e, missing: true };
    e.title = task.title;
    e.description = task.description;
    const s = store.currentSchedule(taskId, today);
    if (s) {
      e.frequency = s.frequency;
      e.every = Math.max(s.every, 1);
      e.weekdays = R.effectiveWeekdays(s);
      e.dayOfMonth = R.effectiveDayOfMonth(s);
      e.startDate = s.startDate;
      e.endDate = s.endDate;
      e.mode = s.mode;
    }
    e.hasHistory = store.hasHistory(taskId, today);
  }
  return e;
}

function draftOf(e) {
  const once = e.frequency === "ONCE";
  return newSchedule({
    startDate: e.startDate,
    frequency: e.frequency,
    every: once ? 1 : e.every,
    weekdays: e.frequency === "WEEKLY" ? (e.weekdays !== 0 ? e.weekdays : R.weekdayBit(e.startDate)) : 0,
    dayOfMonth: e.frequency === "MONTHLY" ? e.dayOfMonth : 0,
    endDate: once ? null : e.endDate,
    mode: once ? "FIXED" : e.mode,
  });
}

function previewHtml(e) {
  const draft = draftOf(e);
  let text;
  if (R.isFlexible(draft)) {
    const n = Math.max(draft.every, 1);
    text = `Erste Fälligkeit am ${Fmt.date(draft.startDate)}, danach jeweils ` +
      `${n} ${R.unitLabel(draft.frequency, n)} nach der letzten Erledigung.`;
  } else {
    const dates = R.preview(draft, e.today, 5);
    text = dates.length === 0 ? "Keine kommenden Termine." : "Nächste Termine: " + dates.map(Fmt.dateWeekday).join(", ");
  }
  return `<div class="strong subhead">${esc(R.describe(draft))}</div>
    <div class="subhead">${esc(text)}</div>
    ${e.taskId === 0 && draft.startDate < e.today
      ? '<div class="caption danger">Termine zwischen Beginn und heute erscheinen als überfällig.</div>' : ""}`;
}

function viewTaskEdit(propertyId, taskId) {
  if (!ui.edit || ui.edit.key !== `${propertyId}/${taskId}`) ui.edit = loadEdit(propertyId, taskId);
  const e = ui.edit;
  const back = backLink(`#/objekte/${propertyId}`, "Zurück");
  if (e.missing || !store.snapshot.propertyById.has(propertyId)) {
    return { html: bar("Aufgabe", { left: back }) + hint("Aufgabe nicht gefunden.") };
  }
  const isNew = taskId === 0;
  const once = e.frequency === "ONCE";
  const fixed = e.mode === "FIXED";

  let h = bar(isNew ? "Neue Aufgabe" : "Aufgabe bearbeiten", {
    left: back,
    right: `<button type="button" class="bar-btn strong" data-action="save-task" ${isBlank(e.title) ? "disabled" : ""}>Speichern</button>`,
  });
  h += '<div class="content form">';

  h += `<section class="group">
    <label class="field"><span>Titel</span><input data-field="title" value="${esc(e.title)}" autocomplete="off" ${isNew ? "autofocus" : ""}></label>
    <label class="field"><span>Beschreibung (optional)</span><textarea data-field="description" rows="2">${escText(e.description)}</textarea></label>
  </section>`;

  h += sectionHeader("Wiederholung");
  h += `<section class="group"><label class="field inline"><span>Wiederholung</span>
    <select data-field="frequency">${options(["ONCE", "DAILY", "WEEKLY", "MONTHLY", "YEARLY"].map((f) => [f, R.label(f)]), e.frequency)}</select>
  </label></section>`;

  if (!once) {
    const mode = (value, title, subtitle) => `<label class="row radio">
      <input type="radio" name="mode" value="${value}" ${e.mode === value ? "checked" : ""}>
      <div class="grow"><div>${title}</div><div class="caption muted">${subtitle}</div></div>
    </label>`;
    h += `<section class="group">
      ${mode("FIXED", "Fester Rhythmus", "Z. B. jeden Montag Mülltonnen – unabhängig davon, wann zuletzt erledigt.")}
      ${mode("AFTER_COMPLETION", "Nach letzter Erledigung", "Z. B. Filterwechsel 3 Monate nach dem letzten Wechsel.")}
    </section>`;

    h += '<section class="group">';
    h += stepper("every", e.every, `${fixed ? "Alle" : "Abstand:"} ${e.every} ${R.unitLabel(e.frequency, e.every)}`, 1, 999);
    if (fixed && e.frequency === "WEEKLY") {
      h += `<div class="row column"><div class="subhead muted">An diesen Tagen</div><div class="weekdays">
        ${Fmt.weekdays.map((label, i) => {
          const selected = (e.weekdays & (1 << i)) !== 0;
          return `<button type="button" class="weekday ${selected ? "selected" : ""}" data-action="weekday" data-bit="${1 << i}" aria-pressed="${selected}">${label}</button>`;
        }).join("")}
      </div></div>`;
    }
    if (fixed && e.frequency === "MONTHLY") h += stepper("dayOfMonth", e.dayOfMonth, `Tag im Monat: ${e.dayOfMonth}.`, 1, 31);
    h += "</section>";
    if (fixed && e.frequency === "MONTHLY") h += sectionFooter("In kürzeren Monaten gilt der letzte Tag.");
  }

  const startLabel = once ? "Datum" : (e.mode === "AFTER_COMPLETION" ? "Erste Fälligkeit" : "Beginn");
  h += `<section class="group">
    <label class="field inline"><span>${startLabel}</span><input type="date" data-field="startDate" value="${D.iso(e.startDate)}" required></label>
    ${once ? "" : `<label class="row toggle"><span class="grow">Enddatum</span><input type="checkbox" class="switch" data-field="hasEnd" ${e.endDate !== null ? "checked" : ""}></label>`}
    ${!once && e.endDate !== null
      ? `<label class="field inline"><span>Ende</span><input type="date" data-field="endDate" value="${D.iso(e.endDate)}" required></label>` : ""}
  </section>`;

  h += sectionHeader("Vorschau");
  h += `<section class="group"><div class="row column" data-preview>${previewHtml(e)}</div></section>`;
  if (e.hasHistory) {
    h += sectionFooter("Planänderungen gelten ab heute. Vergangene Termine und Erledigungen bleiben unverändert, damit Berichte stimmen.");
  }

  if (!isNew) {
    h += `<section class="group"><button type="button" class="row link-row danger center" data-action="delete-task">Aufgabe löschen</button></section>`;
  }
  h += "</div>";

  return {
    html: h,
    mount(root) {
      const save = root.querySelector('[data-action="save-task"]');
      root.querySelectorAll("[data-field]").forEach((el) => {
        const field = el.dataset.field;
        if (field === "title" || field === "description") {
          // Text fields update the state without re-rendering, so typing keeps focus.
          el.addEventListener("input", () => {
            e[field] = el.value;
            if (field === "title") save.disabled = isBlank(e.title);
          });
          return;
        }
        el.addEventListener("change", () => {
          if (field === "frequency") e.frequency = el.value;
          if (field === "hasEnd") e.endDate = el.checked ? D.plusYears(e.startDate, 1) : null;
          if (field === "startDate" || field === "endDate") {
            const d = D.parseIso(el.value);
            if (d !== null) e[field] = d;
          }
          render();
        });
      });
      root.querySelectorAll('input[name="mode"]').forEach((el) => {
        el.addEventListener("change", () => {
          e.mode = el.value;
          render();
        });
      });
      root.querySelector("[autofocus]")?.focus();
    },
  };
}

function saveTask() {
  const e = ui.edit;
  if (!e || isBlank(e.title)) return;
  const task = { id: e.taskId, propertyId: e.propertyId, title: e.title.trim(), description: e.description.trim() };
  if (e.taskId === 0) store.createTask(task, draftOf(e));
  else store.updateTask(task, draftOf(e), e.today);
  ui.edit = null;
  location.hash = `#/objekte/${e.propertyId}`;
}

// MARK: - Berichte

function viewReports() {
  const s = store.snapshot;
  const today = D.today();
  const r = ui.report;
  if (r.propertyId !== null && !s.propertyById.has(r.propertyId)) r.propertyId = null;
  const invalid = r.from > r.to;
  const lastMonth = D.minusMonths(today, 1);
  const presets = [
    ["Dieser Monat", D.firstOfMonth(today), D.lastOfMonth(today)],
    ["Letzter Monat", D.firstOfMonth(lastMonth), D.lastOfMonth(lastMonth)],
    ["Letzte 7 Tage", today - 6, today],
    ["Dieses Jahr", D.firstOfYear(today), D.lastOfYear(today)],
  ];

  let h = bar("Berichte", {
    right: iconButton("open-report", icons.external, "In neuem Tab öffnen", invalid ? "disabled" : "") +
      iconButton("print-report", icons.printer, "Drucken / PDF", invalid ? "disabled" : ""),
  });
  h += `<div class="report-controls">
    <label class="field inline"><span>Objekt</span>
      <select data-field="r-property">${options([["", "Alle Objekte"], ...s.properties.map((p) => [p.id, p.name])], r.propertyId ?? "")}</select>
    </label>
    <div class="chips">${presets.map(([label, a, b]) =>
      `<button type="button" class="chip ${r.from === a && r.to === b ? "active" : ""}" data-action="preset" data-from="${a}" data-to="${b}">${label}</button>`).join("")}
    </div>
    <div class="dates">
      <label class="field"><span>Von</span><input type="date" data-field="r-from" value="${D.iso(r.from)}" required></label>
      <label class="field"><span>Bis</span><input type="date" data-field="r-to" value="${D.iso(r.to)}" required></label>
    </div>
    <div class="segmented" role="group" aria-label="Berichtsart">${Report.REPORT_TYPES.map((t) =>
      `<button type="button" class="${r.type === t.id ? "active" : ""}" data-action="report-type" data-value="${t.id}" aria-pressed="${r.type === t.id}">${t.label}</button>`).join("")}
    </div>
  </div>`;
  h += invalid ? hint("„Von“ liegt nach „Bis“.") : '<iframe class="report-frame" title="Bericht"></iframe>';

  return {
    className: "view-report",
    html: h,
    mount(root) {
      root.querySelectorAll("[data-field]").forEach((el) => {
        el.addEventListener("change", () => {
          const f = el.dataset.field;
          if (f === "r-property") r.propertyId = el.value === "" ? null : Number(el.value);
          if (f === "r-from" || f === "r-to") {
            const d = D.parseIso(el.value);
            if (d !== null) r[f === "r-from" ? "from" : "to"] = d;
          }
          render();
        });
      });
      const frame = root.querySelector(".report-frame");
      if (frame) frame.srcdoc = reportHtml();
    },
  };
}

function reportHtml() {
  const r = ui.report;
  return Report.build(store.snapshot, {
    propertyId: r.propertyId, from: r.from, to: r.to, type: r.type, today: D.today(), author: prefs.author,
  });
}

function reportJobName() {
  const r = ui.report;
  return `${Report.reportType(r.type).label} ${Fmt.date(r.from)} bis ${Fmt.date(r.to)}`;
}

function printReport() {
  const frame = viewEl.querySelector(".report-frame");
  if (!frame?.contentWindow) {
    alertDialog("Hinweis", "Kein Bericht zum Drucken vorhanden.");
    return;
  }
  // The title becomes the suggested PDF file name.
  const title = document.title;
  document.title = reportJobName();
  frame.contentDocument.title = reportJobName();
  frame.contentWindow.addEventListener("afterprint", () => { document.title = title; }, { once: true });
  frame.contentWindow.focus();
  frame.contentWindow.print();
  setTimeout(() => { document.title = title; }, 1000);
}

function openReport() {
  const html = reportHtml().replace(/<title>.*?<\/title>/, `<title>${esc(reportJobName())}</title>`);
  const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
  window.open(url, "_blank");
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

// MARK: - Einstellungen

function viewSettings() {
  const theme = [["SYSTEM", "System"], ["LIGHT", "Hell"], ["DARK", "Dunkel"]];
  const notifState = Reminders.permission();
  let h = bar("Einstellungen");
  h += '<div class="content form">';

  h += sectionHeader("Dein Name");
  h += `<section class="group"><label class="field"><span class="visually-hidden">Name</span>
    <input data-field="userName" value="${esc(prefs.userName)}" placeholder="Name" autocomplete="name"></label></section>`;
  h += sectionFooter("Wird bei Erledigungen gespeichert und in Berichten angezeigt.");

  h += sectionHeader("Design");
  h += `<section class="group"><div class="row"><div class="segmented grow" role="group" aria-label="Design">
    ${theme.map(([v, label]) =>
      `<button type="button" class="${prefs.themeMode === v ? "active" : ""}" data-action="theme" data-value="${v}" aria-pressed="${prefs.themeMode === v}">${label}</button>`).join("")}
  </div></div></section>`;

  h += sectionHeader("Erinnerung");
  h += `<section class="group">
    <label class="row toggle"><div class="grow"><div>Tägliche Erinnerung</div>
      <div class="caption muted">Benachrichtigung mit den offenen Aufgaben des Tages</div></div>
      <input type="checkbox" class="switch" data-field="reminder" ${prefs.reminderEnabled ? "checked" : ""}></label>
    ${prefs.reminderEnabled ? stepper("reminderHour", prefs.reminderHour, `Uhrzeit: ${String(prefs.reminderHour).padStart(2, "0")}:00`, 0, 23) : ""}
  </section>`;
  if (prefs.reminderEnabled) {
    let note = "Web-Apps können nicht im Hintergrund geweckt werden: Die Erinnerung erscheint einmal am Tag, " +
      "sobald die App ab dieser Uhrzeit geöffnet ist.";
    if (notifState === "denied") note += " Mitteilungen sind für diese Seite blockiert – bitte in den Browser-Einstellungen erlauben.";
    if (notifState === "unsupported") note += " Dieser Browser unterstützt keine Mitteilungen. Auf iPhone/iPad funktionieren sie nur, wenn die App über „Zum Home-Bildschirm“ installiert wurde.";
    h += sectionFooter(note);
  }

  h += sectionHeader("Datensicherung");
  h += `<section class="group">
    <button type="button" class="row link-row" data-action="export">Sicherung exportieren</button>
    <button type="button" class="row link-row" data-action="import">Sicherung importieren</button>
  </section>`;
  const lastBackup = D.parseIso(prefs.lastBackup);
  h += sectionFooter((lastBackup === null ? "Noch keine Sicherung exportiert. " : `Letzte Sicherung: ${Fmt.date(lastBackup)}. `) +
    "Alle Daten liegen nur in diesem Browser auf diesem Gerät. Exportiere regelmäßig eine Sicherung " +
    "(z. B. in iCloud Drive oder auf einen PC), damit beim Löschen der Browserdaten oder bei einem Gerätewechsel nichts " +
    "verloren geht – die App erinnert einmal im Monat daran. Sicherungen der Android- und iOS-App können hier " +
    "importiert werden und umgekehrt.");

  h += sectionHeader("Über");
  h += `<section class="group">
    <div class="row"><div class="grow">Facility Planer</div></div>
    <div class="row"><div class="grow">Autor</div><span class="muted">Geray S. Karademir</span></div>
  </section>`;

  if (ui.installPrompt) {
    h += sectionHeader("App");
    h += '<section class="group"><button type="button" class="row link-row" data-action="install">Als App installieren</button></section>';
  }
  h += '<input type="file" accept="application/json,.json" data-field="importFile" hidden>';
  h += "</div>";

  return {
    html: h,
    mount(root) {
      root.querySelector('[data-field="userName"]').addEventListener("input", (ev) => prefs.set({ userName: ev.target.value }));
      root.querySelector('[data-field="reminder"]').addEventListener("change", async (ev) => {
        const on = ev.target.checked;
        prefs.set({ reminderEnabled: on });
        if (on && !(await Reminders.requestPermission())) {
          await alertDialog("Erinnerung", Reminders.permission() === "unsupported"
            ? "Dieser Browser unterstützt keine Mitteilungen. Auf iPhone/iPad funktionieren sie nur, wenn die App über „Teilen → Zum Home-Bildschirm“ installiert wurde (iOS 16.4 oder neuer)."
            : "Ohne Berechtigung kann keine Erinnerung angezeigt werden. Mitteilungen lassen sich in den Browser- bzw. Systemeinstellungen erlauben.");
        }
        render();
        Reminders.check(store, prefs);
      });
      root.querySelector('[data-field="importFile"]').addEventListener("change", async (ev) => {
        const file = ev.target.files?.[0];
        ev.target.value = "";
        if (file) await importBackup(file);
      });
    },
  };
}

async function exportBackup() {
  const name = Backup.defaultFileName(D.today());
  const text = store.exportBackup();
  const file = new File([text], name, { type: "application/json" });
  // On phones and tablets the share sheet can save to Files / iCloud Drive / mail.
  if (matchMedia("(pointer: coarse)").matches && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: name });
      backupDone();
      return;
    } catch (e) {
      if (e.name === "AbortError") return;
    }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  backupDone();
}

function backupDone() {
  prefs.set({ lastBackup: D.iso(D.today()) });
  if (route().tab === "einstellungen") render();
}

const BACKUP_NOTICE_MONTHS = 1;
let backupNoticeOpen = false;

/**
 * Once a month (counted from the last export, or from the last time the note was skipped)
 * suggests exporting a backup, because the data exists only in this browser.
 */
async function checkBackupNotice() {
  if (backupNoticeOpen || store.snapshot.properties.length === 0) return;
  const today = D.today();
  // First use: start counting now instead of asking right away.
  if (prefs.backupNoticeAt === "" && prefs.lastBackup === "") {
    prefs.set({ backupNoticeAt: D.iso(today) });
    return;
  }
  const since = Math.max(D.parseIso(prefs.lastBackup) ?? -Infinity, D.parseIso(prefs.backupNoticeAt) ?? -Infinity);
  if (D.plusMonths(since, BACKUP_NOTICE_MONTHS) > today) return;
  // Don't cover a sheet or dialog the user is working in.
  if (document.querySelector("dialog[open]")) return;

  backupNoticeOpen = true;
  prefs.set({ backupNoticeAt: D.iso(today) });
  const last = D.parseIso(prefs.lastBackup);
  const ok = await confirmDialog({
    title: "Datensicherung",
    message: (last === null ? "Es wurde noch keine Sicherung exportiert. " : `Letzte Sicherung: ${Fmt.date(last)}. `) +
      "Alle Daten liegen nur in diesem Browser. Jetzt eine Sicherung exportieren, damit beim Löschen der " +
      "Browserdaten oder bei Verlust des Geräts nichts verloren geht?",
    confirm: "Jetzt exportieren",
    cancel: "Später",
  });
  backupNoticeOpen = false;
  if (ok) exportBackup().catch((e) => alertDialog("Datensicherung", `Fehler: ${e.message}`));
}

async function importBackup(file) {
  const ok = await confirmDialog({
    title: "Sicherung importieren?",
    message: "Alle aktuellen Daten in diesem Browser werden durch den Inhalt der Sicherung ersetzt.",
    confirm: "Ersetzen",
    destructive: true,
  });
  if (!ok) return;
  try {
    store.importBackup(await file.text());
    await alertDialog("Datensicherung", "Sicherung importiert.");
  } catch (e) {
    await alertDialog("Datensicherung", `Fehler: ${e.message}`);
  }
}

function applyTheme() {
  const root = document.documentElement;
  if (prefs.themeMode === "SYSTEM") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", prefs.themeMode === "DARK" ? "dark" : "light");
}

// MARK: - Actions (event delegation)

const actions = {
  "day": (el) => { ui.day += Number(el.dataset.delta); render(); },
  "day-today": () => { ui.day = D.today(); render(); },
  "toggle-group": (el) => {
    const id = Number(el.dataset.id);
    if (ui.expanded.has(id)) ui.expanded.delete(id);
    else ui.expanded.add(id);
    render();
  },
  "done": (el) => {
    const item = findItem(el);
    if (item) store.record({ taskId: item.task.id, dueDate: item.dueDate, status: "DONE", by: prefs.author });
  },
  "item-menu": async (el) => {
    const item = findItem(el);
    if (!item) return;
    const status = await actionMenu(item.task.title, [
      { label: "Erledigt mit Notiz …", value: "DONE" },
      { label: "Überspringen …", value: "SKIPPED" },
    ]);
    if (status) noteSheet(item, status);
  },
  "undo": (el) => store.undo(Number(el.dataset.id)),
  "add-oneoff": () => oneOffSheet(),
  "add-time": (el) => {
    const property = store.snapshot.propertyById.get(Number(el.dataset.id));
    if (property) timeSheet(property);
  },
  "delete-time": async (el) => {
    const entry = store.snapshot.timeEntries.find((e) => e.id === Number(el.dataset.id));
    if (!entry) return;
    const ok = await confirmDialog({
      title: "Arbeitszeit löschen?",
      message: `${Fmt.time(entry.startTime)} – ${Fmt.time(entry.endTime)} (${Fmt.duration(Backup.entryMinutes(entry))}) wird gelöscht.`,
      confirm: "Löschen",
      destructive: true,
    });
    if (ok) store.deleteTimeEntry(entry.id);
  },
  "new-property": () => propertySheet(null),
  "property-menu": async (el) => {
    const property = store.snapshot.propertyById.get(Number(el.dataset.id));
    if (!property) return;
    const choice = await actionMenu(null, [
      { label: "Objekt bearbeiten", value: "edit" },
      { label: "Objekt löschen", value: "delete", destructive: true },
    ]);
    if (choice === "edit") propertySheet(property);
    if (choice === "delete") {
      const ok = await confirmDialog({
        title: "Objekt löschen?",
        message: `„${property.name}“ wird mit allen Aufgaben und dem gesamten Erledigungsverlauf gelöscht. Das kann nicht rückgängig gemacht werden.`,
        confirm: "Löschen",
        destructive: true,
      });
      if (ok) {
        location.hash = "#/objekte";
        store.deleteProperty(property.id);
      }
    }
  },
  "step": (el) => {
    const { field } = el.dataset;
    const clamp = (v) => Math.min(Math.max(v, Number(el.dataset.min)), Number(el.dataset.max));
    const delta = Number(el.dataset.delta);
    if (field === "reminderHour") {
      prefs.set({ reminderHour: clamp(prefs.reminderHour + delta), lastReminder: "" });
      Reminders.check(store, prefs);
    } else if (ui.edit) {
      ui.edit[field] = clamp(ui.edit[field] + delta);
    }
    render();
  },
  "weekday": (el) => {
    ui.edit.weekdays ^= Number(el.dataset.bit);
    render();
  },
  "save-task": () => saveTask(),
  "delete-task": async () => {
    const e = ui.edit;
    const ok = await confirmDialog({
      title: "Aufgabe löschen?",
      message: "Die Aufgabe und alle bisherigen Erledigungen werden gelöscht. Wenn der Verlauf als Nachweis erhalten bleiben soll, stattdessen ein Enddatum setzen.",
      confirm: "Löschen",
      destructive: true,
    });
    if (ok) {
      ui.edit = null;
      location.hash = `#/objekte/${e.propertyId}`;
      store.deleteTask(e.taskId);
    }
  },
  "preset": (el) => {
    ui.report.from = Number(el.dataset.from);
    ui.report.to = Number(el.dataset.to);
    render();
  },
  "report-type": (el) => { ui.report.type = el.dataset.value; render(); },
  "print-report": () => printReport(),
  "open-report": () => openReport(),
  "theme": (el) => {
    prefs.set({ themeMode: el.dataset.value });
    applyTheme();
    render();
  },
  "export": () => exportBackup().catch((e) => alertDialog("Datensicherung", `Fehler: ${e.message}`)),
  "import": () => viewEl.querySelector('[data-field="importFile"]').click(),
  "install": async () => {
    const p = ui.installPrompt;
    ui.installPrompt = null;
    await p?.prompt();
    render();
  },
};

viewEl.addEventListener("click", (ev) => {
  const el = ev.target.closest("[data-action]");
  if (!el || el.disabled || !viewEl.contains(el)) return;
  const fn = actions[el.dataset.action];
  if (fn) {
    ev.preventDefault();
    fn(el);
  }
});

// MARK: - Start

applyTheme();
store.subscribe(() => {
  render();
  Reminders.check(store, prefs);
  if (store.saveError) {
    const msg = store.saveError;
    store.saveError = null;
    alertDialog("Fehler beim Speichern", msg);
  }
});

window.addEventListener("hashchange", () => {
  render();
  window.scrollTo(0, 0);
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") return;
  // A new day started while the app was in the background: follow it if "today" was shown.
  const today = D.today();
  if (ui.day === ui.lastToday) ui.day = today;
  ui.lastToday = today;
  render();
  Reminders.check(store, prefs);
  checkBackupNotice();
});

window.addEventListener("beforeinstallprompt", (ev) => {
  ev.preventDefault();
  ui.installPrompt = ev;
  if (route().tab === "einstellungen") render();
});

setInterval(() => Reminders.check(store, prefs), 60_000);

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
// Ask the browser not to evict the data under storage pressure.
navigator.storage?.persist?.().catch(() => {});

render();
Reminders.check(store, prefs);
if (store.saveError) alertDialog("Fehler beim Speichern", store.saveError);
else checkBackupNotice();
