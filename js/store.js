// Facility Planer · Author: Geray S. Karademir

import * as Backup from "./backup.js";
import * as R from "./recurrence.js";
import { Snapshot } from "./agenda.js";

/**
 * All data of the app (iOS: AppStore). The data set is small, so it is kept in memory and
 * written to the browser's localStorage as backup JSON after every change.
 */

const DATA_KEY = "facilityplaner.data";

export class Store {
  constructor() {
    this.listeners = new Set();
    this.saveError = null;
    this.data = Backup.emptyData();
    let text = null;
    try {
      text = localStorage.getItem(DATA_KEY);
    } catch {
      this.saveError = "Der Browser erlaubt keinen Speicher. Daten gehen beim Schließen verloren.";
    }
    if (text) {
      try {
        this.data = Backup.decode(text);
      } catch {
        // Keep the unreadable data instead of overwriting it with an empty data set.
        try {
          localStorage.setItem(`${DATA_KEY}.defekt-${Date.now()}`, text);
        } catch { /* nothing more we can do */ }
      }
    }
    this.snapshot = new Snapshot(this.data);
  }

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Applies a change, builds the new snapshot, saves and notifies. */
  commit(change) {
    change(this.data);
    this.snapshot = new Snapshot(this.data);
    this.save();
    for (const fn of this.listeners) fn(this.snapshot);
  }

  save() {
    try {
      localStorage.setItem(DATA_KEY, Backup.encode(this.data));
    } catch (e) {
      this.saveError = `Daten konnten nicht gespeichert werden: ${e.message}`;
    }
  }

  static nextId(items) {
    return items.reduce((m, x) => Math.max(m, x.id), 0) + 1;
  }

  // Properties

  saveProperty(property) {
    this.commit((d) => {
      if (property.id === 0) {
        d.properties.push({ ...property, id: Store.nextId(d.properties) });
      } else {
        const i = d.properties.findIndex((p) => p.id === property.id);
        if (i >= 0) d.properties[i] = { ...property };
      }
    });
  }

  /** Deletes the property with all its tasks, schedules, records and working times. */
  deleteProperty(propertyId) {
    this.commit((d) => {
      const taskIds = new Set(d.tasks.filter((t) => t.propertyId === propertyId).map((t) => t.id));
      d.records = d.records.filter((r) => !taskIds.has(r.taskId));
      d.schedules = d.schedules.filter((s) => !taskIds.has(s.taskId));
      d.tasks = d.tasks.filter((t) => !taskIds.has(t.id));
      d.timeEntries = d.timeEntries.filter((e) => e.propertyId !== propertyId);
      d.properties = d.properties.filter((p) => p.id !== propertyId);
    });
  }

  // Tasks & schedules

  task(id) {
    return this.data.tasks.find((t) => t.id === id) ?? null;
  }

  schedulesFor(taskId) {
    return this.data.schedules.filter((s) => s.taskId === taskId).sort((a, b) => a.validFrom - b.validFrom);
  }

  createTask(task, schedule) {
    this.commit((d) => {
      const id = Store.nextId(d.tasks);
      d.tasks.push({ ...task, id });
      d.schedules.push({ ...schedule, id: Store.nextId(d.schedules), taskId: id, validFrom: schedule.startDate });
    });
  }

  /** The schedule version that applies today (or the last one, if the task starts later). */
  currentSchedule(taskId, today) {
    const versions = this.schedulesFor(taskId);
    return R.versionAt(versions, today) ?? versions[versions.length - 1] ?? null;
  }

  /** True once the task has a past: recorded completions or a schedule already in effect. */
  hasHistory(taskId, today) {
    const versions = this.schedulesFor(taskId);
    return versions.length > 1 ||
      this.data.records.some((r) => r.taskId === taskId) ||
      versions.some((v) => v.validFrom < today);
  }

  /**
   * Saves title/description and, if the rule changed, the schedule.
   * Without history the schedule is simply replaced. With history a new version is
   * added that applies from today, so the past stays exactly as it was planned.
   */
  updateTask(task, schedule, today) {
    const current = this.currentSchedule(task.id, today);
    const history = this.hasHistory(task.id, today);
    this.commit((d) => {
      const ti = d.tasks.findIndex((t) => t.id === task.id);
      if (ti >= 0) d.tasks[ti] = { ...task };
      if (current && sameRule(current, schedule)) return;
      if (current && !history) {
        const i = d.schedules.findIndex((s) => s.id === current.id);
        if (i >= 0) d.schedules[i] = { ...schedule, id: current.id, taskId: task.id, validFrom: schedule.startDate };
      } else {
        d.schedules = d.schedules.filter((s) => !(s.taskId === task.id && s.validFrom >= today));
        d.schedules.push({ ...schedule, id: Store.nextId(d.schedules), taskId: task.id, validFrom: today });
      }
    });
  }

  deleteTask(taskId) {
    this.commit((d) => {
      d.records = d.records.filter((r) => r.taskId !== taskId);
      d.schedules = d.schedules.filter((s) => s.taskId !== taskId);
      d.tasks = d.tasks.filter((t) => t.id !== taskId);
    });
  }

  // Records

  /** One record per task and due date; marking again replaces the old record. */
  record({ taskId, dueDate, status, note = "", by = "" }) {
    this.commit((d) => {
      d.records = d.records.filter((r) => !(r.taskId === taskId && r.dueDate === dueDate));
      d.records.push({
        id: Store.nextId(d.records),
        taskId,
        dueDate,
        status,
        completedAt: Date.now(),
        completedBy: by,
        note,
      });
    });
  }

  undo(recordId) {
    this.commit((d) => {
      d.records = d.records.filter((r) => r.id !== recordId);
    });
  }

  // Working time

  addTimeEntry(entry) {
    this.commit((d) => {
      d.timeEntries.push({ ...entry, id: Store.nextId(d.timeEntries) });
    });
  }

  deleteTimeEntry(entryId) {
    this.commit((d) => {
      d.timeEntries = d.timeEntries.filter((e) => e.id !== entryId);
    });
  }

  // Backup

  /** Everything as a backup file (pretty-printed JSON). */
  exportBackup() {
    return Backup.encode(this.data, { pretty: true, exportedAt: Backup.timestamp() });
  }

  /** Replaces ALL data in this browser with the content of the backup file. */
  importBackup(text) {
    const file = Backup.decode(text);
    this.commit((d) => {
      Object.assign(d, file);
    });
  }
}

function sameRule(a, b) {
  return a.startDate === b.startDate &&
    a.frequency === b.frequency &&
    a.every === b.every &&
    a.weekdays === b.weekdays &&
    a.dayOfMonth === b.dayOfMonth &&
    a.endDate === b.endDate &&
    a.mode === b.mode;
}

/** Small user settings (iOS: UserDefaults). */
export class Prefs {
  static KEY = "facilityplaner.prefs";

  constructor() {
    let saved = {};
    try {
      saved = JSON.parse(localStorage.getItem(Prefs.KEY) ?? "{}") ?? {};
    } catch { /* defaults */ }
    /** Stored with every completion and shown in reports ("Durch"). */
    this.userName = typeof saved.userName === "string" ? saved.userName : "";
    this.reminderEnabled = typeof saved.reminderEnabled === "boolean" ? saved.reminderEnabled : false;
    this.reminderHour = Number.isInteger(saved.reminderHour) ? saved.reminderHour : 7;
    /** SYSTEM | LIGHT | DARK */
    this.themeMode = ["SYSTEM", "LIGHT", "DARK"].includes(saved.themeMode) ? saved.themeMode : "SYSTEM";
    /** Day (iso) of the last reminder shown, so it appears at most once a day. */
    this.lastReminder = typeof saved.lastReminder === "string" ? saved.lastReminder : "";
    /** Day (iso) of the last backup export; "" if never. */
    this.lastBackup = typeof saved.lastBackup === "string" ? saved.lastBackup : "";
    /** Day (iso) the monthly backup note was last shown or skipped (or the app first used). */
    this.backupNoticeAt = typeof saved.backupNoticeAt === "string" ? saved.backupNoticeAt : "";
  }

  set(changes) {
    Object.assign(this, changes);
    try {
      localStorage.setItem(Prefs.KEY, JSON.stringify({
        userName: this.userName,
        reminderEnabled: this.reminderEnabled,
        reminderHour: this.reminderHour,
        themeMode: this.themeMode,
        lastReminder: this.lastReminder,
        lastBackup: this.lastBackup,
        backupNoticeAt: this.backupNoticeAt,
      }));
    } catch { /* settings are a convenience */ }
  }

  /** The name as saved with completions and time entries. */
  get author() {
    return this.userName.trim();
  }
}
