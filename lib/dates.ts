/**
 * Plain calendar-date helpers.
 *
 * Everything here works on `yyyy-mm-dd` strings and UTC midnight, never on
 * local time - a slip dated 24-Aug must stay 24-Aug regardless of the
 * server's timezone.
 */

export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                       "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const pad = (n: number) => String(n).padStart(2, "0");

export function isoOf(y: number, m: number, d: number): string {
  return `${y}-${pad(m)}-${pad(d)}`;
}

export function toUTC(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

export function fromUTC(ms: number): string {
  const dt = new Date(ms);
  return isoOf(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

export function addDays(iso: string, n: number): string {
  return fromUTC(toUTC(iso) + n * 86_400_000);
}

/** 0 = Sunday .. 6 = Saturday */
export function weekday(iso: string): number {
  return new Date(toUTC(iso)).getUTCDay();
}

export function isWeekday(iso: string): boolean {
  const w = weekday(iso);
  return w >= 1 && w <= 5;
}

/** "2026-08-24" -> "24-Aug-26", the form's own date format. */
export function fmtShort(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${pad(d)}-${MONTHS[m - 1]}-${pad(y % 100)}`;
}

/** "2026-08-24" -> "Mon 24-Aug-2026", for the UI. */
export function fmtLabel(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${DAYS[weekday(iso)]} ${pad(d)}-${MONTHS[m - 1]}-${y}`;
}

/** Two-digit years are always this century; the exports never predate 2000. */
function expandYear(y: number): number {
  return y < 100 ? 2000 + y : y;
}

/**
 * Accepts what the exports and the UI actually produce: Date objects,
 * Excel serial numbers, "21-Aug-26", "21-Aug-2026", "2026-08-21",
 * "08/21/2026" and "21/08/2026".
 */
export function parseDate(value: unknown): string | null {
  if (value == null || value === "") return null;

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return isoOf(value.getUTCFullYear(), value.getUTCMonth() + 1,
                 value.getUTCDate());
  }

  // Excel serial: days since 1899-12-30.
  if (typeof value === "number" && Number.isFinite(value)) {
    if (value < 1 || value > 100_000) return null;
    return fromUTC(Date.UTC(1899, 11, 30) + Math.round(value) * 86_400_000);
  }

  const text = String(value).trim();
  if (!text) return null;

  let m = /^(\d{1,2})-([A-Za-z]{3})-(\d{2}|\d{4})$/.exec(text);
  if (m) {
    const mon = MONTHS.findIndex(
      (x) => x.toLowerCase() === m![2].toLowerCase());
    if (mon >= 0) return isoOf(expandYear(+m[3]), mon + 1, +m[1]);
  }

  m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
  if (m) return isoOf(+m[1], +m[2], +m[3]);

  m = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(text);
  if (m) {
    const a = +m[1], b = +m[2], y = expandYear(+m[3]);
    // Ambiguous: prefer m/d/y unless the first field can only be a day.
    return a > 12 ? isoOf(y, b, a) : isoOf(y, a, b);
  }

  return null;
}

/** Inclusive list of every date from `start` to `end`. */
export function eachDay(start: string, end: string): string[] {
  const out: string[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
  return out;
}
