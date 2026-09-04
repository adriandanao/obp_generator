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
  const missing: string[] = [];
  const skipped: DayNote[] = [];

  for (const iso of eachDay(start, end)) {
    if (!isWeekday(iso) || present.has(iso)) continue;
    if (holidays.has(iso)) {
      skipped.push({ iso, label: fmtLabel(iso), reason: "holiday" });
    } else {
      missing.push(iso);
    }
  }

  // Rows that ARE in the file but are non-working days: reported, never offered.
  for (const r of rows.sort((a, b) => (a._iso! < b._iso! ? -1 : 1))) {
    const iso = r._iso as string;
    if (iso < start || iso > end) continue;

    const reasons: string[] = [];
    const holName = String(r.hol_name ?? "").trim();
    if (truthy(r.hol_flag) || holName) {
      reasons.push(holName ? `holiday - ${holName}` : "holiday");
    }
    if (truthy(r.do_flag)) reasons.push("rest day");
    if (truthy(r.leave) || truthy(r.lv_type)) {
      const kind = String(r.lv_type || r.leave || "").trim();
      reasons.push(kind ? `leave - ${kind}` : "leave");
    }

    if (reasons.length) {
      skipped.push({ iso, label: fmtLabel(iso), reason: reasons.join(", ") });
    } else if (opts.includeAbsent && truthy(r.abs_flag)) {
      missing.push(iso);
    }
  }

  const uniqueMissing = [...new Set(missing)].sort();
  skipped.sort((a, b) => (a.iso < b.iso ? -1 : 1));

  const [shiftIn, shiftOut] = shiftTimes(rows[0].shift);

  return {
    empno: String(rows[0].empno ?? "").trim(),
    name: prettyName(rows[0].empname),
    shiftIn,
    shiftOut,
    rangeStart: start,
    rangeEnd: end,
    rowCount: present.size,
    missing: uniqueMissing.map((iso) => ({ iso, label: fmtLabel(iso) })),
    skipped,
    employees,
  };
}

export { fmtLabel, fmtShort };
