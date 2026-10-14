// Facility Planer · Author: Geray S. Karademir

import * as D from "./day.js";
import * as R from "./recurrence.js";

/** Lexicographic comparison of two arrays of numbers/strings (like Swift tuple <). */
export function cmp(a, b) {
  for (let i = 0; i < a.length; i++) {
    if (a[i] < b[i]) return -1;
    if (a[i] > b[i]) return 1;
  }
  return 0;
}

const lower = (s) => (s ?? "").toLowerCase();

/** Immutable view of all data, with lookup helpers. Every screen derives what it needs from it. */
export class Snapshot {
  constructor(data) {
    /** Sorted by name. */
    this.properties = [...data.properties].sort((a, b) => cmp([lower(a.name), a.id], [lower(b.name), b.id]));
    /** Sorted by title. */
    this.tasks = [...data.tasks].sort((a, b) => cmp([lower(a.title), a.id], [lower(b.title), b.id]));
    this.records = data.records;
    /** Sorted by date and start time. */
    this.timeEntries = [...data.timeEntries].sort((a, b) =>
      cmp([a.date, a.startTime, a.id], [b.date, b.startTime, b.id]));

    this.propertyById = new Map(data.properties.map((p) => [p.id, p]));
    this.taskById = new Map(data.tasks.map((t) => [t.id, t]));
    /** Schedule versions per task id, sorted by validFrom. */
    this.schedules = groupBy(data.schedules, (s) => s.taskId);
    for (const v of this.schedules.values()) v.sort((a, b) => a.validFrom - b.validFrom);
    this.recordsByTask = groupBy(data.records, (r) => r.taskId);
  }

  versionsOf(taskId) { return this.schedules.get(taskId) ?? []; }
  recordsOf(taskId) { return this.recordsByTask.get(taskId) ?? []; }

  timeEntriesOn(propertyId, day) {
    return this.timeEntries.filter((e) => e.propertyId === propertyId && e.date === day);
  }
}

export function groupBy(items, key) {
  const map = new Map();
  for (const item of items) {
    const k = key(item);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(item);
  }
  return map;
}

/** How far back unfinished fixed-rhythm dates stay on the todo list. Reports always show them. */
export const LOOKBACK_DAYS = 60;

/**
 * Everything due on day or overdue (within the lookback) that has no record yet.
 * Items: { task, property, dueDate }
 */
export function openItems(s, day) {
  const out = [];
  for (const task of s.tasks) {
    const versions = s.versionsOf(task.id);
    if (versions.length === 0) continue;
    const recs = s.recordsOf(task.id);
    const recorded = new Set(recs.map((r) => r.dueDate));
    const property = s.propertyById.get(task.propertyId) ?? null;

    for (const d of R.fixedDueDates(versions, day - LOOKBACK_DAYS, day)) {
      if (!recorded.has(d)) out.push({ task, property, dueDate: d });
    }

    const current = R.versionAt(versions, day);
    if (current && R.isFlexible(current)) {
      const due = R.flexibleDue(current, recs);
      if (due !== null && due <= day && !recorded.has(due)) out.push({ task, property, dueDate: due });
    }
  }
  return out.sort((a, b) =>
    cmp([lower(a.property?.name), a.task.propertyId, a.dueDate, lower(a.task.title)],
      [lower(b.property?.name), b.task.propertyId, b.dueDate, lower(b.task.title)]));
}

/** Records marked on day (done or skipped), newest first. Items: { task, property, record } */
export function completedOn(s, day) {
  return s.records
    .filter((r) => R.completedDate(r) === day)
    .map((r) => {
      const task = s.taskById.get(r.taskId);
      return task ? { task, property: s.propertyById.get(task.propertyId) ?? null, record: r } : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.record.completedAt - a.record.completedAt);
}

/** Earliest open due date (overdue or upcoming) of a task. */
export function nextDue(s, task, today) {
  const versions = s.versionsOf(task.id);
  const recs = s.recordsOf(task.id);
  const recorded = new Set(recs.map((r) => r.dueDate));
  const fixed = R.fixedDueDates(versions, today - LOOKBACK_DAYS, D.plusYears(today, 2))
    .find((d) => !recorded.has(d)) ?? null;
  let flexible = null;
  const current = R.versionAt(versions, today) ?? versions[0] ?? null;
  if (current && R.isFlexible(current)) {
    const due = R.flexibleDue(current, recs);
    if (due !== null && !recorded.has(due)) flexible = due;
  }
  const candidates = [fixed, flexible].filter((d) => d !== null);
  return candidates.length ? Math.min(...candidates) : null;
}

/** Days between due date and completion; > 0 means late. */
export function delayDays(row) {
  return row.record ? D.daysBetween(row.dueDate, R.completedDate(row.record)) : 0;
}

/**
 * One row per due date in from...to: every planned date plus every recorded one.
 * Past dates without a record are missed, today and later are open.
 * Rows: { task, property, dueDate, state: done|skipped|missed|open, record }
 */
export function reportRows(s, { propertyId, from, to, today }) {
  const out = [];
  for (const task of s.tasks) {
    if (propertyId !== null && task.propertyId !== propertyId) continue;
    const versions = s.versionsOf(task.id);
    const recs = s.recordsOf(task.id);
    const byDue = new Map();
    for (const r of recs) if (!byDue.has(r.dueDate)) byDue.set(r.dueDate, r);

    const dates = new Set(R.fixedDueDates(versions, from, to));
    for (const r of recs) if (r.dueDate >= from && r.dueDate <= to) dates.add(r.dueDate);
    const current = R.versionAt(versions, today) ?? versions[0] ?? null;
    if (current && R.isFlexible(current)) {
      const due = R.flexibleDue(current, recs);
      if (due !== null && due >= from && due <= to) dates.add(due);
    }

    const property = s.propertyById.get(task.propertyId) ?? null;
    for (const d of [...dates].sort((a, b) => a - b)) {
      const record = byDue.get(d) ?? null;
      const state = record ? (record.status === "DONE" ? "done" : "skipped") : (d < today ? "missed" : "open");
      out.push({ task, property, dueDate: d, state, record });
    }
  }
  return out.sort((a, b) =>
    cmp([lower(a.property?.name), a.task.propertyId, lower(a.task.title), a.task.id, a.dueDate],
      [lower(b.property?.name), b.task.propertyId, lower(b.task.title), b.task.id, b.dueDate]));
}

/** Rows grouped by task, keeping the order of first appearance. */
export function groupedByTask(rows) {
  return [...groupBy(rows, (r) => r.task.id).values()];
}

/** One summary per task, in the order the tasks first appear in rows. */
export function summarize(rows) {
  return groupedByTask(rows).map((r) => {
    const count = (f) => r.filter(f).length;
    const done = count((x) => x.state === "done");
    const missed = count((x) => x.state === "missed");
    const skipped = count((x) => x.state === "skipped");
    return {
      task: r[0].task,
      property: r[0].property,
      done,
      late: count((x) => x.state === "done" && delayDays(x) > 0),
      skipped,
      missed,
      open: count((x) => x.state === "open"),
      due: done + skipped + missed,
      /** Completion rate in percent, skipped dates not counted. */
      rate: done + missed > 0 ? Math.floor((done * 100) / (done + missed)) : null,
    };
  });
}
