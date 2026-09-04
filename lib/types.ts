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
