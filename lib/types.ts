/** One line on a slip. */
export type Entry = {
  /** ISO yyyy-mm-dd; the slip prints it as dd-MMM-yy. */
  iso: string;
  from: string;
  to: string;
  purpose: string;
  timeIn: string;
  timeOut: string;
  personnel: string;
};

export type SlipHeader = {
  name: string;
  position: string;
  /** Free text, printed verbatim after "Date:". */
  date: string;
};

export type DayNote = {
  iso: string;
  /** "Mon 24-Aug-2026" */
  label: string;
  reason: string;
};

export type ParseResult = {
  empno: string;
  name: string;
  shiftIn: string | null;
  shiftOut: string | null;
  rangeStart: string;
  rangeEnd: string;
  rowCount: number;
  missing: { iso: string; label: string }[];
  skipped: DayNote[];
  /** Every empno in the file, so the UI can offer a picker. */
  employees: { empno: string; name: string }[];
};

export type PdfRequest = {
  header: SlipHeader;
  entries: Entry[];
};

// --------------------------------------------------------------- leave ----

export type LeaveKind = "vacation" | "sick" | "emergency" | "other";

/** One unbroken stretch of leave; each period prints its own form. */
export type LeavePeriod = {
  /** ISO yyyy-mm-dd */
  from: string;
  to: string;
  /** Free text so half-days ("2.5") and local counting rules survive. */
  days: string;
};

export type LeaveRequest = {
  name: string;
  position: string;
  department: string;
  /** Printed verbatim after "Date Prepared:". */
  datePrepared: string;
  kind: LeaveKind;
  /** Only used when `kind` is "other". */
  otherText: string;
  /** Which column the From/To/No-of-days values go in. */
  recordUnder: "VL" | "SL";
  reason: string;
  periods: LeavePeriod[];
};
