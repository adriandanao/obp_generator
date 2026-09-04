# OB Slips

Upload a timekeeping export, fill in what you were doing on the days with no
record, and print Official Business Slips.

```bash
npm install
npm run dev      # http://localhost:3000
```

No database, no accounts. Files are parsed in memory and never written to disk;
your defaults (position, usual From/To, personnel) live in `localStorage`.

## How it works

1. **Upload** — the export is read with SheetJS, which handles the old BIFF2
   `.XLS` these systems produce as well as modern `.xlsx`.
2. **Scan** — a Mon–Fri date is a missing work day when it has *no row at all*,
   or has a row **the clock never registered** (no `in1…in25` / `out1…out25`).
   Holidays, rest days and approved leave are listed as skipped, never offered.
   Weekends are neither. The range defaults to the cut-off period you are
   currently filing for (below).

   Punches, not `abs_flag`, are the signal: the exports set `abs_flag` on days
   that were plainly worked — clocked in at 07:54 and out at 18:02 — so trusting
   it alone produces slips for days you were present. Rest days likewise show up
   as an `ss_code` ending in `DO` rather than as `do_flag`. Tick **Also include
   days flagged absent that do have clock-ins** to see those anomalies anyway.
3. **Fill** — one row per missing day. *Copy first row down* propagates the
   first row's details to the rest, which is usually what you want.
4. **Print** — four entries per slip, two identical copies per page separated
   by the "cut here" line, extra pages as needed.

Time In / Time Out are seeded from the `shift` column: `HO/WARE (08:30 - 17:30)`
becomes 08:30 / 17:30.

### Cut-off periods

Two per month, computed in `lib/cutoff.ts`:

| Period | Filed on |
| --- | --- |
| 21st of the previous month → 5th | the 5th |
| 6th → 20th | the 20th |

A period's last day is also the day you file it, and that day counts as part of
the period. They tile with no gaps: `… 6–20 | 21–5 | 6–20 …`

The picker opens on the period you are currently filing for — the earliest one
whose filing date has not yet passed — and sets the two date fields to match.
Editing either date by hand switches the picker to **Custom**; **Whatever the
file covers** falls back to the export's own first and last dates.

If the calendar ever moves, change the two pairs of day-of-month numbers at the
top of `lib/cutoff.ts`; everything else derives from them.

### If your export only lists absences

Some exports contain *only* the absent days. Those rows have no punches, so
they are detected on their own — just make sure **From** / **To** cover the
period you are filing for rather than only what the file happens to span.

## Layout

`lib/obp-pdf.ts` reproduces the printed form rather than approximating it —
column stops, the 28pt row pitch, the four Helvetica sizes, and the offsets of
the signature block are all measured from the reference PDF. Against that
reference all 42 rules land within 0.20pt and all 42 text elements within
0.80pt.

Regenerate the reference slip to re-check after changing the renderer:

```bash
npx tsx scripts/verify-layout.mjs reference.pdf
```

Cell text wraps to two lines at 8pt; longer text shrinks by half-points and
takes a third line rather than being cut, and is ellipsized only if it still
will not fit.

## Project structure

```
app/
  page.tsx              the whole UI - upload, grid, print
  api/parse/route.ts    POST an export -> employee, range, missing days
  api/pdf/route.ts      POST header + entries -> application/pdf
lib/
  attendance.ts         reading the export, finding the gaps
  obp-pdf.ts            the form renderer
  cutoff.ts             the payroll cut-off calendar
  dates.ts              calendar helpers (UTC only, never local time)
```

## Command-line version

`cli/obp_slips.py` does the same job from a terminal, prompting day by day and
remembering your answers in `obp_config.json`. It needs `reportlab`, plus
`xlrd` for `.xls` or `openpyxl` for `.xlsx`.

```bash
python cli/obp_slips.py AD-09-04-26.XLS --dry-run
python cli/obp_slips.py AD-09-04-26.XLS --from 01-Aug-26 --to 31-Aug-26
```

It renders through reportlab rather than pdf-lib, so its output is verified
against the reference PDF separately — there it matches all 42 rules exactly.
