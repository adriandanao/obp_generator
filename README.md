# HR Forms

Two printable forms, one app:

- **Official Business** (`/`) — upload a timekeeping export, fill in what you
  were doing on the days with no record, print the slips.
- **Application for Leave** (`/leave`) — HRM F015, one form per leave period.

```bash
npm install
npm run dev      # http://localhost:3210
```

No database, no accounts. Files are parsed in memory and never written to disk;
your defaults live in `localStorage`.

## Getting the PDF out

Generating shows a **Download** link plus, where the browser supports sharing
files, **Save to Files**. On desktop the download also fires automatically;
the visible link is the actual mechanism, not a fallback.

That indirection is deliberate, because the usual "click a hidden anchor"
trick fails on mobile Safari three separate ways:

- the click lands *after* `await fetch(...)`, so the tap no longer counts as a
  user activation and Safari navigates instead of downloading — the PDF opens
  in a viewer tab with no way to save it;
- revoking the object URL right after `click()` can pull it away before
  Safari is done with it;
- a blob typed `application/pdf` is claimed by Safari's built-in viewer.

So the download blob is typed `application/octet-stream`, the URL lives until
it is replaced, the automatic click is skipped on iOS, and the user gets a
real link to tap. `app/download.ts` carries the detail.

## Signatures

Both forms take an optional signature for the **Prepared by** line — draw it
with a mouse, trackpad or finger, or upload a photo of your signature on white
paper. Uploads have their background keyed out to transparency and both paths
are cropped to the ink, so it lands over the printed name the way wet ink
would rather than as a white box.

It is stored as a PNG data URL in `localStorage` and shared by both forms, so
you capture it once. It never reaches a server except as part of the render
request, and nothing is persisted server-side.

**Noted by** and **Approved by** are deliberately left as blank ruled lines.
Those signatures belong to whoever approves the request, and are not the
app's to place.

## Official Business slips

### How it works

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

## Application for Leave

`/leave` is independent of the attendance scan — you enter the employee
details, the type of leave, and one or more periods. **Each period prints its
own form**, since the form carries a single From / To / No. of days. Add a
period for each unbroken stretch of leave.

- **No. of days** counts Mon–Fri only and updates as you change the dates;
  type over it for half-days or a different counting rule and it stops
  tracking.
- **Record the dates under** picks the VL or SL column for the From / To /
  No. of days values. It follows the leave type (Sick → SL, everything else →
  VL) until you override it.
- The **leave-balance grid** (Allowable, Taken prior, Balance, Applied for,
  Remaining) is deliberately left blank — HR fills those from the 201 file,
  and wrong numbers on a signed form are worse than blank ones.

### A caveat on this layout

Unlike the OB slip, `lib/afl-pdf.ts` was rebuilt from a **photograph of a
printed form**, not measured from a source PDF. The structure is right and it
prints correctly on Letter, but the constants are proportional judgements
rather than measurements. If the original file turns up, re-measure and replace
the numbers at the top of that file; nothing else has to change.

There is no logo on this form, matching the photo.

```bash
npx tsx scripts/preview-leave.mjs afl.pdf   # sample form for eyeballing
```

## Layout of the OB slip

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
  page.tsx                 OB slips - upload, grid, print
  leave/page.tsx           leave applications
  nav.tsx                  the two tabs
  api/parse/route.ts       POST an export -> employee, range, missing days
  api/pdf/route.ts         POST header + entries -> application/pdf
  api/leave-pdf/route.ts   POST a leave request -> application/pdf
  signature.tsx            draw / upload a signature, shared by both forms
  download.ts              handing the PDF to the browser (mobile Safari quirks)
  download-panel.tsx       the Download / Save to Files result panel
lib/
  attendance.ts            reading the export, finding the gaps
  obp-pdf.ts               the OB slip renderer (measured)
  afl-pdf.ts               the leave form renderer (from a photo)
  pdf-text.ts              drawing primitives shared by both
  signature.ts             validates an incoming signature PNG
  cutoff.ts                the payroll cut-off calendar
  dates.ts                 calendar helpers (UTC only, never local time)
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
