/**
 * Payroll cut-off periods.
 *
 * Two per month:
 *   25th of the previous month -> 10th, filed on the 20th
 *   11th -> 24th,                       filed on the 5th of the next month
 *
 * Change the four day-of-month numbers below if the calendar ever moves; the
 * rest of the file derives everything from them.
 */
import { MONTHS, isoOf } from "./dates";

const FIRST = { startDay: 25, endDay: 10, fileDay: 20 };
const SECOND = { startDay: 11, endDay: 24, fileDay: 5 };

export type Cutoff = {
  /** Stable option value, e.g. "2026-08-11_2026-08-24". */
  id: string;
  start: string;
  end: string;
  fileBy: string;
  /** "11 – 24 Aug 2026 · due 5 Sep" */
  label: string;
};

const prevMonth = (y: number, m: number) =>
  m === 1 ? { y: y - 1, m: 12 } : { y, m: m - 1 };
const nextMonth = (y: number, m: number) =>
  m === 12 ? { y: y + 1, m: 1 } : { y, m: m + 1 };

function span(start: string, end: string, fileBy: string): string {
  const [sy, sm, sd] = start.split("-").map(Number);
  const [ey, em, ed] = end.split("-").map(Number);
  const [, fm, fd] = fileBy.split("-").map(Number);
  // Collapse "11 Aug – 24 Aug 2026" to "11 – 24 Aug 2026" within one month.
  const head =
    sy !== ey ? `${sd} ${MONTHS[sm - 1]} ${sy}`
    : sm === em ? `${sd}`
    : `${sd} ${MONTHS[sm - 1]}`;
  return `${head} – ${ed} ${MONTHS[em - 1]} ${ey} · due ${fd} ${MONTHS[fm - 1]}`;
}

function make(start: string, end: string, fileBy: string): Cutoff {
  return { id: `${start}_${end}`, start, end, fileBy, label: span(start, end, fileBy) };
}

/** The period ending on the 10th of the given month. */
export function firstCutoff(y: number, m: number): Cutoff {
  const p = prevMonth(y, m);
  return make(
    isoOf(p.y, p.m, FIRST.startDay),
    isoOf(y, m, FIRST.endDay),
    isoOf(y, m, FIRST.fileDay),
  );
}

/** The period ending on the 24th of the given month. */
export function secondCutoff(y: number, m: number): Cutoff {
  const n = nextMonth(y, m);
  return make(
    isoOf(y, m, SECOND.startDay),
    isoOf(y, m, SECOND.endDay),
    isoOf(n.y, n.m, SECOND.fileDay),
  );
}

/** Every cut-off from `back` months ago to `forward` months ahead, oldest first. */
export function cutoffsAround(todayIso: string, back = 3, forward = 1): Cutoff[] {
  const [y, m] = todayIso.split("-").map(Number);
  const out: Cutoff[] = [];
  for (let i = -back; i <= forward; i++) {
    const t = m - 1 + i;
    const yy = y + Math.floor(t / 12);
    const mm = ((t % 12) + 12) % 12 + 1;
    out.push(firstCutoff(yy, mm), secondCutoff(yy, mm));
  }
  return out.sort((a, b) => (a.end < b.end ? -1 : 1));
}

/**
 * The period you would be filing right now: the earliest one whose filing date
 * has not yet passed.
 */
export function dueCutoff(todayIso: string): Cutoff | undefined {
  const all = cutoffsAround(todayIso);
  return all.find((c) => c.fileBy >= todayIso) ?? all[all.length - 1];
}
