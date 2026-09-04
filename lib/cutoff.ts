/**
 * Payroll cut-off periods.
 *
 * Two per month, and a period's last day is also the day you file it:
 *   21st of the previous month -> 5th, filed on the 5th
 *   6th -> 20th,                       filed on the 20th
 *
 * They tile with no gaps: ... 6-20 | 21-5 | 6-20 ...  Change the two pairs of
 * day-of-month numbers below if the calendar ever moves; everything else here
 * derives from them.
 */
import { MONTHS, isoOf } from "./dates";

const FIRST = { startDay: 21, endDay: 5 };
const SECOND = { startDay: 6, endDay: 20 };

export type Cutoff = {
  /** Stable option value, e.g. "2026-08-21_2026-09-05". */
  id: string;
  start: string;
  /** Last day of the period - inclusive, and the day it is filed. */
  end: string;
  /** Kept distinct from `end` so the two can be decoupled later. */
  fileBy: string;
  /** "21 Aug – 5 Sep 2026" */
  label: string;
};

const prevMonth = (y: number, m: number) =>
  m === 1 ? { y: y - 1, m: 12 } : { y, m: m - 1 };

function span(start: string, end: string): string {
  const [sy, sm, sd] = start.split("-").map(Number);
  const [ey, em, ed] = end.split("-").map(Number);
  // Collapse "6 Sep – 20 Sep 2026" to "6 – 20 Sep 2026" within one month.
  const head =
    sy !== ey ? `${sd} ${MONTHS[sm - 1]} ${sy}`
    : sm === em ? `${sd}`
    : `${sd} ${MONTHS[sm - 1]}`;
  return `${head} – ${ed} ${MONTHS[em - 1]} ${ey}`;
}

function make(start: string, end: string): Cutoff {
  return { id: `${start}_${end}`, start, end, fileBy: end, label: span(start, end) };
}

/** The period ending on the 5th of the given month. */
export function firstCutoff(y: number, m: number): Cutoff {
  const p = prevMonth(y, m);
  return make(isoOf(p.y, p.m, FIRST.startDay), isoOf(y, m, FIRST.endDay));
}

/** The period ending on the 20th of the given month. */
export function secondCutoff(y: number, m: number): Cutoff {
  return make(isoOf(y, m, SECOND.startDay), isoOf(y, m, SECOND.endDay));
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
