import * as XLSX from "xlsx";

import { eachDay, fmtLabel, fmtShort, isWeekday, parseDate } from "./dates";
import type { DayNote, ParseResult } from "./types";

type Row = Record<string, unknown> & { _iso?: string | null };

/** The export uses 0/1, true/false, "", 0.0 and text interchangeably. */
export function truthy(value: unknown): boolean {
  if (value == null) return false;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  const text = String(value).trim();
  if (text === "" || text === "0" || text === "0.0") return false;
  const n = Number(text);
  return Number.isNaN(n) ? true : n !== 0;
}

/** "0758" -> "07:58". Anything unrecognised is passed through untouched. */
function fmtPunch(value: unknown): string {
  const s = String(value ?? "").trim();
  if (!s) return "";
  if (/^\d{1,2}:\d{2}$/.test(s)) return s.length === 4 ? `0${s}` : s;
  const digits = s.replace(/\D/g, "");
  if (digits.length === 4) return `${digits.slice(0, 2)}:${digits.slice(2)}`;
  if (digits.length === 3) return `0${digits[0]}:${digits.slice(1)}`;
  return s;
}

/**
 * The day's span according to the clock: the first in and the last out across
 * the export's 25 in/out pairs.  Either can be blank on its own - a day where
 * someone clocked in and never out is exactly the case an OB slip explains.
 */
export function punchWindow(row: Record<string, unknown>): {
  timeIn: string;
  timeOut: string;
} {
  let timeIn = "";
  let timeOut = "";
  for (let i = 1; i <= 25; i++) {
    const a = fmtPunch(row[`in${i}`]);
    if (a && !timeIn) timeIn = a;
    const b = fmtPunch(row[`out${i}`]);
    if (b) timeOut = b;
  }
  return { timeIn, timeOut };
}

/**
 * Did the clock account for the whole day - punched in *and* out?
 *
 * Anything less needs explaining: no punch at all is a day not worked, and a
 * punch on one side only is a day someone left without tapping out, which is
 * precisely what an OB slip covers.  This is a far more reliable signal than
 * abs_flag, which some exports set on days that were plainly worked and clear
 * on days that plainly were not.
 */
export function isFullyClocked(row: Record<string, unknown>): boolean {
  const { timeIn, timeOut } = punchWindow(row);
  return Boolean(timeIn && timeOut);
}

/** Rest days show up as do_flag, or as an ss_code ending in "DO". */
export function isRestDay(row: Record<string, unknown>): boolean {
  const ss = String(row.ss_code ?? "").trim().toUpperCase();
  return truthy(row.do_flag) || ss.endsWith("DO");
}

/** "HO/WARE (08:30 - 17:30)" -> ["08:30", "17:30"] */
export function shiftTimes(value: unknown): [string | null, string | null] {
  const m = /(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})/.exec(String(value ?? ""));
  return m ? [m[1], m[2]] : [null, null];
}

/** "DANAO, ADRIAN F." -> "Adrian F. Danao" */
export function prettyName(raw: unknown): string {
  let text = String(raw ?? "").trim();
  if (text.includes(",")) {
    const [last, ...rest] = text.split(",");
    text = `${rest.join(",").trim()} ${last.trim()}`;
  }
  return text
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

function readSheet(buf: Buffer): Row[] {
  const wb = XLSX.read(buf, { type: "buffer", cellDates: true });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) return [];
  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: "",
  });
  // Normalise headers to lower case; the exports are inconsistent about it.
  return raw.map((r) => {
    const out: Row = {};
    for (const [k, v] of Object.entries(r)) out[k.trim().toLowerCase()] = v;
    return out;
  });
}

export type ParseOptions = {
  empno?: string;
  from?: string;
  to?: string;
  includeAbsent?: boolean;
  /** ISO dates to treat as holidays. */
  holidays?: string[];
};

export class ParseError extends Error {}

export function analyse(buf: Buffer, opts: ParseOptions = {}): ParseResult {
  let rows = readSheet(buf);
  if (!rows.length) throw new ParseError("The sheet has no data rows.");

  for (const r of rows) r._iso = parseDate(r.ddate);
  rows = rows.filter((r) => r._iso);
  if (!rows.length) {
    throw new ParseError(
      "No readable dates in the 'ddate' column - is this a timekeeping export?",
    );
  }

  const employees = [
    ...new Map(
      rows.map((r) => [
        String(r.empno ?? "").trim(),
        { empno: String(r.empno ?? "").trim(), name: prettyName(r.empname) },
      ]),
    ).values(),
  ];

  if (opts.empno) {
    rows = rows.filter((r) => String(r.empno ?? "").trim() === opts.empno);
    if (!rows.length) throw new ParseError(`No rows for empno ${opts.empno}.`);
  } else if (employees.length > 1) {
    throw new ParseError(
      `This export covers ${employees.length} employees - pick one.`,
    );
  }

  const present = new Set(rows.map((r) => r._iso as string));
  const sorted = [...present].sort();
  const start = opts.from || sorted[0];
  const end = opts.to || sorted[sorted.length - 1];
  if (start > end) throw new ParseError("The start date is after the end date.");

  const holidays = new Set(opts.holidays ?? []);
  const byDate = new Map(rows.map((r) => [r._iso as string, r]));
  const missing: { iso: string; timeIn: string; timeOut: string }[] = [];
  const NO_PUNCH = { timeIn: "", timeOut: "" };
  const skipped: DayNote[] = [];
  const note = (iso: string, reason: string) =>
    skipped.push({ iso, label: fmtLabel(iso), reason });

  // One pass over the calendar. Weekends are never work days, so they are
  // neither offered nor reported, whatever the row says.
  for (const iso of eachDay(start, end)) {
    if (!isWeekday(iso)) continue;

    if (holidays.has(iso)) {
      note(iso, "holiday");
      continue;
    }

    const r = byDate.get(iso);
    if (!r) {
      missing.push({ iso, ...NO_PUNCH }); // no row at all
      continue;
    }

    const reasons: string[] = [];
    const holName = String(r.hol_name ?? "").trim();
    if (truthy(r.hol_flag) || holName) {
      reasons.push(holName ? `holiday - ${holName}` : "holiday");
    }
    if (isRestDay(r)) reasons.push("rest day");
    if (truthy(r.leave) || truthy(r.lv_type)) {
      const kind = String(r.lv_type || r.leave || "").trim();
      reasons.push(kind ? `leave - ${kind}` : "leave");
    }

    if (reasons.length) {
      note(iso, reasons.join(", "));
      continue;
    }

    const clock = punchWindow(r);
    if (!isFullyClocked(r)) {
      // Nothing recorded, or only one side of the day. Either way it needs a
      // slip, and whatever the clock did catch is carried across.
      missing.push({ iso, ...clock });
    } else if (opts.includeAbsent && truthy(r.abs_flag)) {
      // Clocked in and out, yet flagged absent - an anomaly worth seeing.
      missing.push({ iso, ...clock });
    }
  }

  const uniqueMissing = [...new Map(missing.map((m) => [m.iso, m])).values()]
    .sort((a, b) => (a.iso < b.iso ? -1 : 1));
  skipped.sort((a, b) => (a.iso < b.iso ? -1 : 1));

  // Read identity off the whole sheet, not row 0: exports vary the spelling
  // between rows ("DANAO, ADRIAN F" vs "DANAO, ADRIAN F.").
  const rawName = rows
    .map((r) => String(r.empname ?? "").trim())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)[0];
  const [shiftIn, shiftOut] = shiftTimes(rows.find((r) => String(r.shift ?? "").trim())?.shift);

  return {
    empno: String(rows[0].empno ?? "").trim(),
    name: prettyName(rawName),
    shiftIn,
    shiftOut,
    rangeStart: start,
    rangeEnd: end,
    rowCount: present.size,
    missing: uniqueMissing.map((m) => ({ ...m, label: fmtLabel(m.iso) })),
    skipped,
    employees,
  };
}

export { fmtLabel, fmtShort };
