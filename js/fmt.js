// Facility Planer · Author: Geray S. Karademir

import * as D from "./day.js";

/** German date/time formats used across the app and reports. */

export const weekdays = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
export const weekdaysLong = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"];
export const months = [
  "Januar", "Februar", "März", "April", "Mai", "Juni",
  "Juli", "August", "September", "Oktober", "November", "Dezember",
];

const pad = (n, w = 2) => String(n).padStart(w, "0");

/** dd.MM.yyyy */
export function date(d) {
  const c = D.civil(d);
  return `${pad(c.day)}.${pad(c.month)}.${pad(c.year, 4)}`;
}

/** dd.MM. */
export function dateShort(d) {
  const c = D.civil(d);
  return `${pad(c.day)}.${pad(c.month)}.`;
}

/** e.g. "Mo. 14.10." */
export const dateWeekday = (d) => `${weekdays[D.weekday(d) - 1]}. ${dateShort(d)}`;

/** e.g. "Dienstag, 14. Oktober 2026" */
export function dayLong(d) {
  const c = D.civil(d);
  return `${weekdaysLong[D.weekday(d) - 1]}, ${c.day}. ${months[c.month - 1]} ${c.year}`;
}

/** MM/yyyy of the month given as monthIndex. */
export function month(index) {
  const c = D.civil(D.firstOfMonthIndex(index));
  return `${pad(c.month)}/${pad(c.year, 4)}`;
}

/** HH:mm */
export const time = (t) => D.timeText(t);

export function timeMillis(ms) {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export const dateMillis = (ms) => date(D.fromMillis(ms));

/** Working time as hours:minutes, e.g. "1:05 h". */
export const duration = (minutes) => `${Math.floor(minutes / 60)}:${pad(minutes % 60)} h`;
