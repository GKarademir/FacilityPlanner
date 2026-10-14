// Facility Planer · Author: Geray S. Karademir

/**
 * A calendar date without time or time zone (like java.time.LocalDate), represented as a plain
 * integer: days since 1970-01-01. All schedule logic works on these numbers, so it never shifts
 * with time zones or DST, and days compare with < and ===.
 *
 * Times of day are plain integers too: minutes since midnight, 0 ..< 1440.
 */

/** Proleptic Gregorian calendar (algorithm by Howard Hinnant). */
export function fromYmd(year, month, day) {
  const y = month <= 2 ? year - 1 : year;
  const era = Math.floor((y >= 0 ? y : y - 399) / 400);
  const yoe = y - era * 400;
  const mp = (month + 9) % 12;
  const doy = Math.floor((153 * mp + 2) / 5) + day - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

/** { year, month, day } of an epoch day. */
export function civil(epochDay) {
  const z = epochDay + 719468;
  const era = Math.floor((z >= 0 ? z : z - 146096) / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp < 10 ? mp + 3 : mp - 9;
  return { year: yoe + era * 400 + (m <= 2 ? 1 : 0), month: m, day: d };
}

/** The local calendar date of a JS Date (device time zone). */
export function fromDate(date) {
  return fromYmd(date.getFullYear(), date.getMonth() + 1, date.getDate());
}

export function today() {
  return fromDate(new Date());
}

/** Local calendar date of epoch milliseconds. */
export function fromMillis(ms) {
  return fromDate(new Date(ms));
}

export const year = (d) => civil(d).year;
export const month = (d) => civil(d).month;
export const dayOfMonth = (d) => civil(d).day;

/** ISO weekday: Monday = 1 … Sunday = 7. */
export function weekday(d) {
  return ((((d + 3) % 7) + 7) % 7) + 1;
}

export const isWeekend = (d) => weekday(d) >= 6;

/** Months since year 0, for comparing and iterating whole months (like YearMonth). */
export function monthIndex(d) {
  const c = civil(d);
  return c.year * 12 + c.month - 1;
}

export function isLeap(y) {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

export function lengthOfMonthYm(y, m) {
  switch (m) {
    case 2: return isLeap(y) ? 29 : 28;
    case 4: case 6: case 9: case 11: return 30;
    default: return 31;
  }
}

export function lengthOfMonth(d) {
  const c = civil(d);
  return lengthOfMonthYm(c.year, c.month);
}

/** First day of the month given as monthIndex. */
export function firstOfMonthIndex(index) {
  const y = Math.floor(index / 12);
  return fromYmd(y, index - y * 12 + 1, 1);
}

// Arithmetic

export const plusDays = (d, n) => d + n;
export const minusDays = (d, n) => d - n;
export const plusWeeks = (d, n) => d + 7 * n;

/** Like LocalDate.plusMonths: the day is clamped to the last day of the target month. */
export function plusMonths(d, n) {
  const c = civil(d);
  const first = civil(firstOfMonthIndex(c.year * 12 + c.month - 1 + n));
  return fromYmd(first.year, first.month, Math.min(c.day, lengthOfMonthYm(first.year, first.month)));
}

export const minusMonths = (d, n) => plusMonths(d, -n);
export const plusYears = (d, n) => plusMonths(d, 12 * n);

export function firstOfMonth(d) {
  const c = civil(d);
  return fromYmd(c.year, c.month, 1);
}

export function lastOfMonth(d) {
  const c = civil(d);
  return fromYmd(c.year, c.month, lengthOfMonthYm(c.year, c.month));
}

export const firstOfYear = (d) => fromYmd(year(d), 1, 1);
export const lastOfYear = (d) => fromYmd(year(d), 12, 31);

/** Monday of this day's week. */
export const monday = (d) => d - (weekday(d) - 1);

/** Days from a to b (positive if b is later). */
export const daysBetween = (a, b) => b - a;

export const later = (a, b) => (a > b ? a : b);

// Conversion

const pad = (n, w = 2) => String(n).padStart(w, "0");

/** ISO format yyyy-MM-dd, as in the backup file (and in <input type="date">). */
export function iso(d) {
  const c = civil(d);
  return `${pad(c.year, 4)}-${pad(c.month)}-${pad(c.day)}`;
}

/** Parses yyyy-MM-dd; null if invalid. */
export function parseIso(text) {
  if (typeof text !== "string") return null;
  const parts = text.split("-").map((p) => (/^\d+$/.test(p) ? parseInt(p, 10) : NaN));
  if (parts.length !== 3 || parts.some(Number.isNaN)) return null;
  const [y, m, d] = parts;
  if (m < 1 || m > 12 || d < 1 || d > lengthOfMonthYm(y, m)) return null;
  return fromYmd(y, m, d);
}

// Time of day (minutes since midnight)

export function time(hour, minute) {
  return Math.min(Math.max(hour * 60 + minute, 0), 24 * 60 - 1);
}

export function timeNow() {
  const now = new Date();
  return time(now.getHours(), now.getMinutes());
}

/** HH:mm, as LocalTime.toString() writes it in the backup. */
export function timeText(t) {
  return `${pad(Math.floor(t / 60))}:${pad(t % 60)}`;
}

/** Accepts HH:mm and HH:mm:ss; null if invalid. */
export function parseTime(text) {
  if (typeof text !== "string") return null;
  const parts = text.split(":");
  if (parts.length < 2 || !/^\d+$/.test(parts[0]) || !/^\d+$/.test(parts[1])) return null;
  const h = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return time(h, m);
}
