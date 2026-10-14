// Facility Planer · Author: Geray S. Karademir

import * as D from "./day.js";

/**
 * The complete data set in the JSON format of the Android app's backup (version 2).
 * The web app also stores its data in this format, so a backup is simply a copy of it, and
 * backup files can be moved between the Android, iOS and web app in all directions.
 *
 * In memory, dates are epoch days and times are minutes (see day.js); they are converted
 * to yyyy-MM-dd and HH:mm only here.
 *
 * Enum values match the Android app:
 *   frequency: ONCE | DAILY | WEEKLY | MONTHLY | YEARLY
 *   mode:      FIXED | AFTER_COMPLETION
 *   status:    DONE | SKIPPED
 */

export const APP_NAME = "FacilityPlaner";
export const CURRENT_VERSION = 2;

export const ROUNDING_MINUTES = 15;

export class BackupError extends Error {
  constructor() {
    super("Keine gültige Sicherungsdatei");
  }
}

export function emptyData() {
  return { properties: [], tasks: [], schedules: [], records: [], timeEntries: [] };
}

/** Counted working time: always rounded up to the next quarter hour. */
export function roundedMinutes(start, end) {
  const exact = Math.max(end - start, 0);
  return Math.ceil(exact / ROUNDING_MINUTES) * ROUNDING_MINUTES;
}

export const entryMinutes = (e) => roundedMinutes(e.startTime, e.endTime);

// Decoding (lenient: missing optional fields get the same defaults as on Android)

function req(obj, key, check) {
  const v = obj?.[key];
  if (v === undefined || v === null || !check(v)) throw new BackupError();
  return v;
}

const isInt = (v) => Number.isInteger(v);
const isStr = (v) => typeof v === "string";
const optStr = (obj, key) => (isStr(obj[key]) ? obj[key] : "");

function day(obj, key) {
  const d = D.parseIso(req(obj, key, isStr));
  if (d === null) throw new BackupError();
  return d;
}

function time(obj, key) {
  const t = D.parseTime(req(obj, key, isStr));
  if (t === null) throw new BackupError();
  return t;
}

function oneOf(obj, key, values, fallback) {
  const v = obj[key];
  if (v === undefined || v === null) {
    if (fallback !== undefined) return fallback;
    throw new BackupError();
  }
  if (!values.includes(v)) throw new BackupError();
  return v;
}

function list(obj, key, optional, decodeItem) {
  const v = obj[key];
  if ((v === undefined || v === null) && optional) return [];
  if (!Array.isArray(v)) throw new BackupError();
  return v.map((item) => {
    if (typeof item !== "object" || item === null) throw new BackupError();
    return decodeItem(item);
  });
}

/** Parses backup JSON text into the in-memory data set; throws BackupError. */
export function decode(text) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new BackupError();
  }
  if (typeof raw !== "object" || raw === null || raw.app !== APP_NAME) throw new BackupError();

  return {
    properties: list(raw, "properties", false, (p) => ({
      id: req(p, "id", isInt),
      name: req(p, "name", isStr),
      address: optStr(p, "address"),
      notes: optStr(p, "notes"),
    })),
    tasks: list(raw, "tasks", false, (t) => ({
      id: req(t, "id", isInt),
      propertyId: req(t, "propertyId", isInt),
      title: req(t, "title", isStr),
      description: optStr(t, "description"),
    })),
    schedules: list(raw, "schedules", false, (s) => ({
      id: req(s, "id", isInt),
      taskId: req(s, "taskId", isInt),
      validFrom: day(s, "validFrom"),
      startDate: day(s, "startDate"),
      frequency: oneOf(s, "frequency", ["ONCE", "DAILY", "WEEKLY", "MONTHLY", "YEARLY"]),
      every: isInt(s.every) ? s.every : 1,
      weekdays: isInt(s.weekdays) ? s.weekdays : 0,
      dayOfMonth: isInt(s.dayOfMonth) ? s.dayOfMonth : 0,
      endDate: s.endDate == null ? null : day(s, "endDate"),
      mode: oneOf(s, "mode", ["FIXED", "AFTER_COMPLETION"], "FIXED"),
    })),
    records: list(raw, "records", false, (r) => ({
      id: req(r, "id", isInt),
      taskId: req(r, "taskId", isInt),
      dueDate: day(r, "dueDate"),
      status: oneOf(r, "status", ["DONE", "SKIPPED"]),
      completedAt: req(r, "completedAt", isInt),
      completedBy: optStr(r, "completedBy"),
      note: optStr(r, "note"),
    })),
    // Missing in backups from before version 2.
    timeEntries: list(raw, "timeEntries", true, (e) => ({
      id: req(e, "id", isInt),
      propertyId: req(e, "propertyId", isInt),
      date: day(e, "date"),
      startTime: time(e, "startTime"),
      endTime: time(e, "endTime"),
      workedBy: optStr(e, "workedBy"),
    })),
  };
}

/** The data set as backup JSON text. */
export function encode(data, { pretty = false, exportedAt = null } = {}) {
  const file = {
    app: APP_NAME,
    version: CURRENT_VERSION,
    ...(exportedAt ? { exportedAt } : {}),
    properties: data.properties.map((p) => ({ id: p.id, name: p.name, address: p.address, notes: p.notes })),
    tasks: data.tasks.map((t) => ({ id: t.id, propertyId: t.propertyId, title: t.title, description: t.description })),
    schedules: data.schedules.map((s) => ({
      id: s.id,
      taskId: s.taskId,
      validFrom: D.iso(s.validFrom),
      startDate: D.iso(s.startDate),
      frequency: s.frequency,
      every: s.every,
      weekdays: s.weekdays,
      dayOfMonth: s.dayOfMonth,
      ...(s.endDate !== null ? { endDate: D.iso(s.endDate) } : {}),
      mode: s.mode,
    })),
    records: data.records.map((r) => ({
      id: r.id,
      taskId: r.taskId,
      dueDate: D.iso(r.dueDate),
      status: r.status,
      completedAt: r.completedAt,
      completedBy: r.completedBy,
      note: r.note,
    })),
    timeEntries: data.timeEntries.map((e) => ({
      id: e.id,
      propertyId: e.propertyId,
      date: D.iso(e.date),
      startTime: D.timeText(e.startTime),
      endTime: D.timeText(e.endTime),
      workedBy: e.workedBy,
    })),
  };
  return pretty ? JSON.stringify(file, null, 2) : JSON.stringify(file);
}

/** File name suggested for an export, as on Android. */
export const defaultFileName = (today) => `facility-sicherung-${D.iso(today)}.json`;

/** Local time as yyyy-MM-ddTHH:mm:ss. */
export function timestamp(date = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${D.iso(D.fromDate(date))}T${p(date.getHours())}:${p(date.getMinutes())}:${p(date.getSeconds())}`;
}
