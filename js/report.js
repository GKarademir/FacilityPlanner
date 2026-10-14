// Facility Planer · Author: Geray S. Karademir

import * as D from "./day.js";
import * as Fmt from "./fmt.js";
import * as A from "./agenda.js";
import { entryMinutes } from "./backup.js";

/**
 * Reports are plain HTML (same as on Android/iOS): shown in an iframe in the app and printed
 * through the browser's print dialog, which can also save an A4 PDF.
 */

export const REPORT_TYPES = [
  { id: "PROTOCOL", label: "Leistungsnachweis", landscape: false },
  { id: "MATRIX", label: "Übersicht", landscape: true },
];

export function reportType(id) {
  return REPORT_TYPES.find((t) => t.id === id) ?? REPORT_TYPES[0];
}

export function esc(text) {
  return String(text ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("\n", "<br>");
}

export function build(s, { propertyId, from, to, type, today, author }) {
  const rows = A.reportRows(s, { propertyId, from, to, today });
  const property = propertyId !== null ? s.propertyById.get(propertyId) : null;
  let scope = "Alle Objekte";
  if (property) scope = property.address.trim() === "" ? property.name : `${property.name}, ${property.address}`;
  const times = s.timeEntries.filter((e) =>
    (propertyId === null || e.propertyId === propertyId) && e.date >= from && e.date <= to);
  const c = {
    scope, from, to, today, author, rows, times,
    showProperty: propertyId === null,
    propertyName: (e) => s.propertyById.get(e.propertyId)?.name ?? "",
  };
  return type === "MATRIX" ? matrix(c) : protocolReport(c);
}

// Leistungsnachweis: summary + one line per due date

function protocolReport(c) {
  let sb = head("Leistungsnachweis", false);
  sb += "<h1>Leistungsnachweis</h1>";
  sb += meta(c);

  if (c.rows.length === 0) {
    sb += "<p>Im gewählten Zeitraum sind keine Aufgaben fällig.</p>";
  } else {
    sb += '<h2>Zusammenfassung</h2><div class="scroll"><table><thead><tr>';
    if (c.showProperty) sb += "<th>Objekt</th>";
    sb += "<th>Aufgabe</th><th>Fällig</th><th>Erledigt</th><th>davon verspätet</th>" +
      "<th>Übersprungen</th><th>Nicht erledigt</th><th>Quote</th></tr></thead><tbody>";
    for (const t of A.summarize(c.rows)) {
      sb += "<tr>";
      if (c.showProperty) sb += `<td>${esc(t.property?.name)}</td>`;
      sb += `<td>${esc(t.task.title)}</td>`;
      sb += `<td class="num">${t.due}</td>`;
      sb += `<td class="num done">${t.done}</td>`;
      sb += `<td class="num${t.late > 0 ? " late" : ""}">${t.late}</td>`;
      sb += `<td class="num${t.skipped > 0 ? " skipped" : ""}">${t.skipped}</td>`;
      sb += `<td class="num${t.missed > 0 ? " missed" : ""}">${t.missed}</td>`;
      sb += `<td class="num">${t.rate !== null ? `${t.rate} %` : "–"}</td>`;
      sb += "</tr>";
    }
    sb += "</tbody></table></div>";

    sb += '<h2>Einzelnachweis</h2><div class="scroll"><table><thead><tr>';
    if (c.showProperty) sb += "<th>Objekt</th>";
    sb += "<th>Aufgabe</th><th>Fällig am</th><th>Status</th><th>Erledigt am</th>" +
      "<th>Durch</th><th>Notiz</th></tr></thead><tbody>";
    for (const r of c.rows) {
      const [cls, label] = statusText(r);
      sb += "<tr>";
      if (c.showProperty) sb += `<td>${esc(r.property?.name)}</td>`;
      sb += `<td>${esc(r.task.title)}</td>`;
      sb += `<td class="nowrap">${Fmt.date(r.dueDate)}</td>`;
      sb += `<td class="nowrap ${cls}">${label}</td>`;
      sb += `<td class="nowrap">${r.record ? Fmt.dateMillis(r.record.completedAt) : ""}</td>`;
      sb += `<td>${esc(r.record?.completedBy)}</td>`;
      sb += `<td>${esc(r.record?.note)}</td>`;
      sb += "</tr>";
    }
    sb += "</tbody></table></div>";
  }
  if (c.times.length > 0) {
    sb += timeSummary(c);
    sb += timeDetails(c);
  }
  sb += signature();
  sb += "</body></html>";
  return sb;
}

// Arbeitszeit

const sumMinutes = (entries) => entries.reduce((m, e) => m + entryMinutes(e), 0);

/** Total time per property, plus an overall total when there is more than one property. */
function timeSummary(c) {
  const byProperty = [...A.groupBy(c.times, (e) => e.propertyId).values()]
    .sort((a, b) => A.cmp([c.propertyName(a[0]).toLowerCase()], [c.propertyName(b[0]).toLowerCase()]));
  let sb = '<h2>Arbeitszeit – Zusammenfassung</h2><div class="scroll"><table><thead><tr>';
  sb += "<th>Objekt</th><th>Tage</th><th>Einsätze</th><th>Gesamtzeit</th></tr></thead><tbody>";
  for (const entries of byProperty) {
    sb += `<tr><td>${esc(c.propertyName(entries[0]))}</td>`;
    sb += `<td class="num">${new Set(entries.map((e) => e.date)).size}</td>`;
    sb += `<td class="num">${entries.length}</td>`;
    sb += `<td class="num">${Fmt.duration(sumMinutes(entries))}</td></tr>`;
  }
  if (byProperty.length > 1) {
    sb += '<tr class="total"><td>Gesamt</td>';
    sb += `<td class="num">${new Set(c.times.map((e) => e.date)).size}</td>`;
    sb += `<td class="num">${c.times.length}</td>`;
    sb += `<td class="num">${Fmt.duration(sumMinutes(c.times))}</td></tr>`;
  }
  sb += "</tbody></table></div>";
  return sb;
}

function timeDetails(c) {
  let sb = '<h2>Arbeitszeit – Einzelnachweis</h2><div class="scroll"><table><thead><tr><th>Datum</th>';
  if (c.showProperty) sb += "<th>Objekt</th>";
  sb += "<th>Von</th><th>Bis</th><th>Dauer</th><th>Durch</th></tr></thead><tbody>";
  const sorted = [...c.times].sort((a, b) =>
    A.cmp([a.date, a.startTime, c.propertyName(a).toLowerCase()], [b.date, b.startTime, c.propertyName(b).toLowerCase()]));
  for (const e of sorted) {
    sb += `<tr><td class="nowrap">${Fmt.date(e.date)}</td>`;
    if (c.showProperty) sb += `<td>${esc(c.propertyName(e))}</td>`;
    sb += `<td class="nowrap">${Fmt.time(e.startTime)}</td>`;
    sb += `<td class="nowrap">${Fmt.time(e.endTime)}</td>`;
    sb += `<td class="num">${Fmt.duration(entryMinutes(e))}</td>`;
    sb += `<td>${esc(e.workedBy)}</td></tr>`;
  }
  sb += "</tbody></table></div>";
  return sb;
}

// Übersicht: tasks × days (≤ 31 days) or tasks × months

function matrix(c) {
  let sb = head("Übersicht", true);
  sb += "<h1>Übersicht</h1>";
  sb += meta(c);

  if (c.rows.length === 0) {
    sb += "<p>Im gewählten Zeitraum sind keine Aufgaben fällig.</p>";
    if (c.times.length > 0) sb += timeSummary(c);
    sb += "</body></html>";
    return sb;
  }

  const byTask = A.groupedByTask(c.rows);
  const days = D.daysBetween(c.from, c.to) + 1;
  sb += '<div class="scroll"><table class="matrix"><thead><tr><th class="name">Aufgabe</th>';

  if (days <= 31) {
    const dates = Array.from({ length: days }, (_, i) => c.from + i);
    for (const d of dates) {
      sb += `<th class="${weekend(d)}">${D.dayOfMonth(d)}<br>${Fmt.weekdays[D.weekday(d) - 1]}</th>`;
    }
    sb += "</tr></thead><tbody>";
    for (const taskRows of byTask) {
      const byDate = new Map();
      for (const r of taskRows) if (!byDate.has(r.dueDate)) byDate.set(r.dueDate, r);
      sb += `<tr><td class="name">${taskName(taskRows[0], c.showProperty)}</td>`;
      for (const d of dates) {
        const r = byDate.get(d);
        if (r) {
          const [cls, sym] = symbol(r);
          sb += `<td class="${cls} ${weekend(d)}">${sym}</td>`;
        } else {
          sb += `<td class="${weekend(d)}"></td>`;
        }
      }
      sb += "</tr>";
    }
    sb += "</tbody></table></div>";
    sb += '<p class="legend">✓ erledigt · ✓! verspätet erledigt · – übersprungen · ' +
      "✗ nicht erledigt · ○ offen · leer = nicht fällig</p>";
  } else {
    const months = [];
    for (let m = D.monthIndex(c.from); m <= D.monthIndex(c.to); m++) months.push(m);
    for (const m of months) sb += `<th>${Fmt.month(m)}</th>`;
    sb += "</tr></thead><tbody>";
    for (const taskRows of byTask) {
      sb += `<tr><td class="name">${taskName(taskRows[0], c.showProperty)}</td>`;
      for (const m of months) {
        const inMonth = taskRows.filter((r) => D.monthIndex(r.dueDate) === m);
        const done = inMonth.filter((r) => r.state === "done").length;
        const missed = inMonth.filter((r) => r.state === "missed").length;
        const due = inMonth.filter((r) => r.state !== "open").length;
        const text = inMonth.length === 0 ? "" : (due === 0 ? "○" : `${done}/${due}`);
        const cls = missed > 0 ? "missed" : (due > 0 ? "done" : "open");
        sb += `<td class="${cls}">${text}</td>`;
      }
      sb += "</tr>";
    }
    sb += "</tbody></table></div>";
    sb += '<p class="legend">Zahl = erledigt / fällig (inkl. übersprungen) · ' +
      "○ nur noch offene Termine · rot = mindestens ein Termin nicht erledigt</p>";
  }
  if (c.times.length > 0) sb += timeSummary(c);
  sb += signature();
  sb += "</body></html>";
  return sb;
}

// Helpers

function statusText(r) {
  switch (r.state) {
    case "done": {
      const late = A.delayDays(r);
      return late > 0 ? ["late", `Erledigt (+${late} T.)`] : ["done", "Erledigt"];
    }
    case "skipped": return ["skipped", "Übersprungen"];
    case "missed": return ["missed", "Nicht erledigt"];
    default: return ["open", "Offen"];
  }
}

function symbol(r) {
  switch (r.state) {
    case "done": return A.delayDays(r) > 0 ? ["late", "✓!"] : ["done", "✓"];
    case "skipped": return ["skipped", "–"];
    case "missed": return ["missed", "✗"];
    default: return ["open", "○"];
  }
}

function taskName(r, showProperty) {
  const title = esc(r.task.title);
  return showProperty ? `${title}<br><span class="sub">${esc(r.property?.name)}</span>` : title;
}

const weekend = (d) => (D.isWeekend(d) ? "we" : "");

function meta(c) {
  const by = c.author.trim() === "" ? "" : ` von ${esc(c.author)}`;
  return `<div class="meta"><b>Objekt:</b> ${esc(c.scope)}<br>` +
    `<b>Zeitraum:</b> ${Fmt.date(c.from)} – ${Fmt.date(c.to)}<br>` +
    `<b>Erstellt:</b> ${Fmt.date(c.today)}${by}</div>`;
}

function signature() {
  return '<div class="sign"><div>Ort, Datum</div><div>Unterschrift</div></div>';
}

function head(title, landscape) {
  return `<!DOCTYPE html>
<html lang="de"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
@page { size: A4 ${landscape ? "landscape" : "portrait"}; margin: 12mm; }
* { box-sizing: border-box; }
html { color-scheme: light; }
body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; font-size: 12px; color: #1a1a1a; background: #fff; margin: 12px; -webkit-text-size-adjust: 100%; }
h1 { font-size: 20px; margin: 0 0 6px; }
h2 { font-size: 14px; margin: 18px 0 6px; }
.meta { color: #444; margin-bottom: 12px; line-height: 1.6; }
.scroll { overflow-x: auto; }
table { border-collapse: collapse; width: 100%; }
th, td { border: 1px solid #c8c8c8; padding: 4px 6px; text-align: left; vertical-align: top; }
th { background: #e8f0ee; font-weight: 600; }
tr { page-break-inside: avoid; }
td.num { text-align: right; white-space: nowrap; }
.nowrap { white-space: nowrap; }
.done { color: #1b6e2f; }
.late { color: #a15c00; }
.skipped { color: #6b5d00; }
.missed { color: #b3261e; font-weight: 600; }
.open { color: #666; }
tr.total td { font-weight: 600; background: #f5f5f5; }
.sub { color: #777; font-size: 10px; }
table.matrix th, table.matrix td { text-align: center; padding: 2px 3px; font-size: 10px; }
table.matrix th.name, table.matrix td.name { text-align: left; white-space: nowrap; font-size: 11px; }
.we { background: #f2f2f2; }
.legend { margin-top: 8px; color: #555; font-size: 11px; }
.sign { margin-top: 48px; display: flex; gap: 48px; }
.sign div { flex: 1; border-top: 1px solid #333; padding-top: 4px; font-size: 11px; color: #555; }
@media print { body { margin: 0; font-size: 10px; } .scroll { overflow: visible; } th, .we, tr.total td { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
</style></head><body>
`;
}
