// Facility Planer · Author: Geray S. Karademir

import * as D from "./day.js";
import * as Fmt from "./fmt.js";

/** Pure date logic for schedules. No storage access, easy to test. */

export const weekdayBit = (day) => 1 << (D.weekday(day) - 1);

/** ONCE is always treated as a fixed date. */
export const isFlexible = (s) => s.mode === "AFTER_COMPLETION" && s.frequency !== "ONCE";

export const completedDate = (r) => D.fromMillis(r.completedAt);

export const effectiveWeekdays = (s) => (s.weekdays !== 0 ? s.weekdays : weekdayBit(s.startDate));

export const effectiveDayOfMonth = (s) =>
  s.dayOfMonth >= 1 && s.dayOfMonth <= 31 ? s.dayOfMonth : D.dayOfMonth(s.startDate);

/** Whether a fixed-rhythm schedule is due on d. Ignores validFrom (handled by callers). */
export function matches(s, d) {
  const start = s.startDate;
  if (d < start) return false;
  if (s.endDate !== null && d > s.endDate) return false;
  const n = Math.max(s.every, 1);
  switch (s.frequency) {
    case "ONCE":
      return d === start;
    case "DAILY":
      return D.daysBetween(start, d) % n === 0;
    case "WEEKLY": {
      if ((effectiveWeekdays(s) & weekdayBit(d)) === 0) return false;
      const weeks = D.daysBetween(D.monday(start), D.monday(d)) / 7;
      return weeks % n === 0;
    }
    case "MONTHLY": {
      const months = D.monthIndex(d) - D.monthIndex(start);
      return months % n === 0 && D.dayOfMonth(d) === Math.min(effectiveDayOfMonth(s), D.lengthOfMonth(d));
    }
    case "YEARLY": {
      const sc = D.civil(start);
      const dc = D.civil(d);
      return (dc.year - sc.year) % n === 0 &&
        dc.month === sc.month &&
        dc.day === Math.min(sc.day, D.lengthOfMonth(d));
    }
  }
  return false;
}

export function advance(date, s) {
  const n = Math.max(s.every, 1);
  switch (s.frequency) {
    case "DAILY": return D.plusDays(date, n);
    case "WEEKLY": return D.plusWeeks(date, n);
    case "MONTHLY": return D.plusMonths(date, n);
    case "YEARLY": return D.plusYears(date, n);
    default: return date;
  }
}

/** The version in effect on day, or null if the task has not started yet. */
export function versionAt(versions, day) {
  for (let i = versions.length - 1; i >= 0; i--) {
    if (versions[i].validFrom <= day) return versions[i];
  }
  return null;
}

/** All fixed-rhythm due dates in from...to, each version limited to its own period. */
export function fixedDueDates(versions, from, to) {
  const out = [];
  versions.forEach((v, i) => {
    if (isFlexible(v)) return;
    let end = to;
    if (i + 1 < versions.length) {
      const nextStart = versions[i + 1].validFrom;
      if (nextStart <= end) end = nextStart - 1;
    }
    for (let d = D.later(D.later(from, v.validFrom), v.startDate); d <= end; d++) {
      if (matches(v, d)) out.push(d);
    }
  });
  return out;
}

/**
 * Next due date of an "after completion" schedule: last completion (or skip) plus the
 * interval, never earlier than the version start and never on an already recorded date.
 */
export function flexibleDue(s, records) {
  const first = D.later(s.startDate, s.validFrom);
  let due = first;
  if (records.length > 0) {
    const last = records.reduce((a, b) => (b.completedAt > a.completedAt ? b : a));
    due = D.later(D.later(advance(completedDate(last), s), last.dueDate + 1), first);
  }
  if (s.endDate !== null && due > s.endDate) return null;
  return due;
}

/** Next count due dates from `from` on, for the preview in the task editor. */
export function preview(s, from, count = 5) {
  if (isFlexible(s)) return [s.startDate];
  const out = [];
  let d = D.later(from, s.startDate);
  const limit = D.plusYears(d, 5);
  while (out.length < count && d <= limit) {
    if (s.endDate !== null && d > s.endDate) break;
    if (matches(s, d)) out.push(d);
    d++;
  }
  return out;
}

// German texts

export function label(f) {
  return { ONCE: "Einmalig", DAILY: "Täglich", WEEKLY: "Wöchentlich", MONTHLY: "Monatlich", YEARLY: "Jährlich" }[f];
}

/** Unit word, e.g. "Tage". */
export function unitLabel(f, n) {
  switch (f) {
    case "DAILY": return n === 1 ? "Tag" : "Tage";
    case "WEEKLY": return n === 1 ? "Woche" : "Wochen";
    case "MONTHLY": return n === 1 ? "Monat" : "Monate";
    case "YEARLY": return n === 1 ? "Jahr" : "Jahre";
    default: return "";
  }
}

export function weekdayNames(mask) {
  return Fmt.weekdays.filter((_, i) => (mask & (1 << i)) !== 0).join(", ");
}

export function describe(s) {
  const n = Math.max(s.every, 1);
  let text;
  if (s.frequency === "ONCE") {
    text = `Einmalig am ${Fmt.date(s.startDate)}`;
  } else if (isFlexible(s)) {
    text = `${n} ${unitLabel(s.frequency, n)} nach letzter Erledigung`;
  } else {
    switch (s.frequency) {
      case "DAILY":
        text = n === 1 ? "Täglich" : `Alle ${n} Tage`;
        break;
      case "WEEKLY":
        text = (n === 1 ? "Wöchentlich" : `Alle ${n} Wochen`) + ": " + weekdayNames(effectiveWeekdays(s));
        break;
      case "MONTHLY":
        text = (n === 1 ? "Monatlich" : `Alle ${n} Monate`) + ` am ${effectiveDayOfMonth(s)}.`;
        break;
      case "YEARLY":
        text = (n === 1 ? "Jährlich" : `Alle ${n} Jahre`) + ` am ${Fmt.dateShort(s.startDate)}`;
        break;
    }
  }
  if (s.endDate !== null && s.frequency !== "ONCE") return `${text} (bis ${Fmt.date(s.endDate)})`;
  return text;
}
