#!/usr/bin/env python3
"""
obp_slips.py - Find missing work days in a timekeeping export and turn them
into printable Official Business Slips.

  1. Reads an attendance export (.XLS / .xlsx) with the usual
     empno / empname / ddate / dday / hrswrk / ... columns.
  2. Works out which Mon-Fri dates in the covered range have NO row at all.
  3. Prompts you for the OB details of each one, remembering your last
     answers as defaults.
  4. Renders a print-ready PDF that matches the OBP form: two identical
     copies per page separated by a "cut here" line, four entries per slip.

    python obp_slips.py AD-09-04-26.XLS
    python obp_slips.py AD-09-04-26.XLS --from 01-Aug-26 --to 31-Aug-26
    python obp_slips.py AD-09-04-26.XLS --dry-run
"""

import argparse
import datetime as dt
import json
import re
import sys
from pathlib import Path

from reportlab.lib.pagesizes import letter
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.pdfgen import canvas as rl_canvas

# --------------------------------------------------------------------------
# Form geometry, measured off the sample OBP PDF.  The DY_* values are
# offsets from the top rule of a slip's table, so one slip can be stamped at
# any anchor on the page.
# --------------------------------------------------------------------------
PAGE_W, PAGE_H = letter                                  # 612 x 792
COLS = [51.0, 111.1, 160.4, 209.6, 324.8, 384.9, 449.2, 561.0]
ROW_H = 28.0
ROWS_PER_SLIP = 4
HDR_H = 26.0
SLIP_TOPS = (628.2, 257.8)      # top rule of the upper / lower copy
CUT_Y = 396.0

DY_TITLE = 33.1                 # baseline of "OFFICIAL BUSINESS SLIP"
DY_FIELDS = 10.1                # baseline of Name / Position / Date
DY_FIELD_RULE = 8.0             # the little underlines beneath their values
DY_SPLIT = -13.0                # rule that halves "Origin / Destination"
DY_PREPARED = -167.9            # baseline of "Prepared by:" and the name
DY_SIG_RULE = -170.0
DY_SIG1 = -176.5                # "SIGN OVER PRINTED NAME"
DY_SIG2 = -185.0                # "(INDICATE DATE PREPARED)"

F_TITLE = ("Helvetica-Bold", 9)
F_FIELD = ("Helvetica", 8)
F_THEAD = ("Helvetica-Bold", 7)
F_CELL = ("Helvetica", 8)
F_SMALL = ("Helvetica", 6)
LEADING = 10.0

CONFIG_PATH = Path(__file__).with_name("obp_config.json")
DATE_FMTS = ("%d-%b-%y", "%d-%b-%Y", "%Y-%m-%d", "%m/%d/%Y", "%m/%d/%y",
             "%d/%m/%Y", "%d/%m/%y")


# --------------------------------------------------------------------------
# Reading the export
# --------------------------------------------------------------------------
def load_rows(path):
    """Return the first sheet as a list of dicts keyed by lower-cased header."""
    if path.suffix.lower() in (".xls", ".xlt"):
        import xlrd
        sheet = xlrd.open_workbook(str(path)).sheet_by_index(0)
        if sheet.nrows < 1:
            return []
        hdr = [str(sheet.cell_value(0, c)).strip().lower()
               for c in range(sheet.ncols)]
        return [{hdr[c]: sheet.cell_value(r, c) for c in range(sheet.ncols)}
                for r in range(1, sheet.nrows)]

    import openpyxl
    ws = openpyxl.load_workbook(str(path), data_only=True).worksheets[0]
    rows = ws.iter_rows(values_only=True)
    hdr = [str(v or "").strip().lower() for v in next(rows)]
    return [dict(zip(hdr, r)) for r in rows if any(v is not None for v in r)]


def parse_date(value):
    if isinstance(value, dt.datetime):
        return value.date()
    if isinstance(value, dt.date):
        return value
    text = str(value or "").strip()
    if not text:
        return None
    for fmt in DATE_FMTS:
        try:
            return dt.datetime.strptime(text, fmt).date()
        except ValueError:
            pass
    return None


def truthy(value):
    """The export uses 0/1, '', 0.0 and text interchangeably for its flags."""
    text = str(value if value is not None else "").strip()
    if text in ("", "0", "0.0", "None"):
        return False
    try:
        return float(text) != 0
    except ValueError:
        return True


def shift_times(text):
    """'HO/WARE (08:30 - 17:30)' -> ('08:30', '17:30')."""
    m = re.search(r"(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})", str(text or ""))
    return (m.group(1), m.group(2)) if m else (None, None)


def pretty_name(raw):
    """'DANAO, ADRIAN F.' -> 'Adrian F. Danao'."""
    text = str(raw or "").strip()
    if "," in text:
        last, first = (p.strip() for p in text.split(",", 1))
        text = f"{first} {last}"
    return " ".join(w.capitalize() for w in text.split())


def fmt_date(d):
    return d.strftime("%d-%b-%y")


# --------------------------------------------------------------------------
# Text helpers
# --------------------------------------------------------------------------
def _wrap(text, font, size, width):
    lines, cur = [], ""
    for word in str(text).split():
        trial = f"{cur} {word}".strip()
        if not cur or stringWidth(trial, font, size) <= width:
            cur = trial
        else:
            lines.append(cur)
            cur = word
    if cur:
        lines.append(cur)
    return lines or [""]


def _ellipsize(line, font, size, width):
    if stringWidth(line, font, size) <= width:
        return line
    while line and stringWidth(line + "...", font, size) > width:
        line = line[:-1]
    return line.rstrip() + "..."


def fit(text, font, width, height, size=8.0, floor=6.0):
    """Wrap `text` into a width x height cell.

    Shrinks the font a half-point at a time; the smaller the font, the more
    lines the row can hold.  At 8pt in a 26pt-high row that means the two
    lines the printed form uses.  Nothing is dropped silently: if the text
    cannot be made to fit even at `floor`, the last line is ellipsized.
    """
    lines = [""]
    while size >= floor:
        leading = size + 2.0
        allowed = max(1, int(height // leading))
        lines = _wrap(text, font, size, width)
        if len(lines) <= allowed and all(
                stringWidth(ln, font, size) <= width for ln in lines):
            return lines, size, leading
        size -= 0.5

    size, leading = floor, floor + 2.0
    allowed = max(1, int(height // leading))
    lines = _wrap(text, font, size, width)
    if len(lines) > allowed:
        kept = lines[:allowed]
        kept[-1] = _ellipsize(" ".join(lines[allowed - 1:]), font, size, width)
        lines = kept
    return [_ellipsize(ln, font, size, width) for ln in lines], size, leading


def baseline(center, size, n_lines=1, index=0, leading=LEADING):
    """Baseline of line `index` of an n-line block optically centred on `center`."""
    top = center + (n_lines - 1) * leading / 2.0
    return top - index * leading - 0.35 * size


def draw_block(c, text, font, size_hint, x_left, x_right, center,
               align="center", pad=2.0, height=ROW_H - 2.0):
    width = x_right - x_left - 2 * pad
    lines, size, leading = fit(text, font, width, height, size=size_hint)
    c.setFont(font, size)
    for i, line in enumerate(lines):
        y = baseline(center, size, len(lines), i, leading)
        if align == "center":
            c.drawCentredString((x_left + x_right) / 2.0, y, line)
        else:
            c.drawString(x_left + pad, y, line)


# --------------------------------------------------------------------------
# Rendering
# --------------------------------------------------------------------------
def draw_field(c, x, label, value, top):
    """'Name: <value>' plus the underline the form puts beneath the value."""
    font, size = F_FIELD
    c.setFont(font, size)
    c.drawString(x, top + DY_FIELDS, f"{label} {value}")
    c.setLineWidth(0.5)
    c.line(x + stringWidth(f"{label} ", font, size) + 0.8, top + DY_FIELD_RULE,
           x + stringWidth(f"{label} {value}", font, size) + 6.8,
           top + DY_FIELD_RULE)


def draw_slip(c, top, header, entries):
    x0, xn = COLS[0], COLS[-1]
    hdr_bot = top - HDR_H
    bottom = hdr_bot - ROWS_PER_SLIP * ROW_H
    split = top + DY_SPLIT

    c.setFont(*F_TITLE)
    c.drawCentredString(PAGE_W / 2.0, top + DY_TITLE, "OFFICIAL BUSINESS SLIP")

    draw_field(c, COLS[0], "Name:", header["name"], top)
    draw_field(c, COLS[3], "Position:", header["position"], top)
    draw_field(c, COLS[5], "Date:", header["date"], top)

    # grid
    c.setLineWidth(0.5)
    for y in (top, hdr_bot, bottom):
        c.line(x0, y, xn, y)
    for i in range(1, ROWS_PER_SLIP):
        c.line(x0, hdr_bot - i * ROW_H, xn, hdr_bot - i * ROW_H)
    for i, x in enumerate(COLS):
        c.line(x, bottom, x, split if i == 2 else top)
    c.line(COLS[1], split, COLS[3], split)

    # column headings
    band = (top + hdr_bot) / 2.0
    font, size = F_THEAD
    c.setFont(font, size)
    for text, (a, b) in (("Date", (0, 1)), ("Purpose (s)", (3, 4)),
                         ("Time In", (4, 5)), ("Time Out", (5, 6)),
                         ("Personnel In Charge / Signature", (6, 7))):
        c.drawCentredString((COLS[a] + COLS[b]) / 2.0,
                            baseline(band, size), text)
    c.drawCentredString((COLS[1] + COLS[3]) / 2.0,
                        baseline((split + top) / 2.0, size),
                        "Origin / Destination")
    c.drawCentredString((COLS[1] + COLS[2]) / 2.0,
                        baseline((hdr_bot + split) / 2.0, size), "From")
    c.drawCentredString((COLS[2] + COLS[3]) / 2.0,
                        baseline((hdr_bot + split) / 2.0, size), "To")

    # data
    cell_font, cell_size = F_CELL
    for i, e in enumerate(entries):
        mid = hdr_bot - i * ROW_H - ROW_H / 2.0
        cells = ((e["date"], 0, 1, "center"), (e["from"], 1, 2, "center"),
                 (e["to"], 2, 3, "center"), (e["purpose"], 3, 4, "left"),
                 (e["time_in"], 4, 5, "center"), (e["time_out"], 5, 6, "center"),
                 (e["personnel"], 6, 7, "center"))
        for text, a, b, align in cells:
            if str(text).strip():
                draw_block(c, text, cell_font, cell_size,
                           COLS[a], COLS[b], mid, align=align)

    # signature blocks
    font, size = F_FIELD
    c.setFont(font, size)
    c.drawString(COLS[0], top + DY_PREPARED, "Prepared by:")
    c.drawString(COLS[4], top + DY_PREPARED, "Approved by:")
    c.drawString(COLS[1], top + DY_PREPARED, header["name"].upper())
    c.line(COLS[1], top + DY_SIG_RULE, COLS[1] + 90.5, top + DY_SIG_RULE)
    c.line(COLS[5], top + DY_SIG_RULE, COLS[5] + 110.0, top + DY_SIG_RULE)
    c.setFont(*F_SMALL)
    for x in (COLS[1], COLS[5]):
        c.drawString(x, top + DY_SIG1, "SIGN OVER PRINTED NAME")
        c.drawString(x, top + DY_SIG2, "(INDICATE DATE PREPARED)")


def draw_cut_line(c):
    c.setLineWidth(0.5)
    c.setDash(2, 2)
    c.line(25.5, CUT_Y, 290.2, CUT_Y)
    c.line(321.8, CUT_Y, 586.5, CUT_Y)
    c.setDash()
    c.setFont(*F_SMALL)
    c.drawCentredString(PAGE_W / 2.0, CUT_Y - 2.0, "cut here")


def render_pdf(out_path, header, entries):
    c = rl_canvas.Canvas(str(out_path), pagesize=letter)
    c.setTitle("Official Business Slip")
    pages = [entries[i:i + ROWS_PER_SLIP]
             for i in range(0, len(entries), ROWS_PER_SLIP)] or [[]]
    for chunk in pages:
        for top in SLIP_TOPS:
            draw_slip(c, top, header, chunk)
        draw_cut_line(c)
        c.showPage()
    c.save()
    return len(pages)


# --------------------------------------------------------------------------
# Remembered defaults
# --------------------------------------------------------------------------
DEFAULT_CONFIG = {
    "position": "",
    "from": "Head Office",
    "to": "",
    "purpose": "",
    "time_in": "",
    "time_out": "",
    "personnel": "",
    "holidays": [],
}


def load_config():
    cfg = dict(DEFAULT_CONFIG)
    if CONFIG_PATH.exists():
        try:
            cfg.update(json.loads(CONFIG_PATH.read_text(encoding="utf-8")))
        except (ValueError, OSError) as exc:
            print(f"  ! ignoring unreadable {CONFIG_PATH.name}: {exc}")
    return cfg


def save_config(cfg):
    try:
        CONFIG_PATH.write_text(json.dumps(cfg, indent=2), encoding="utf-8")
    except OSError as exc:
        print(f"  ! could not save defaults: {exc}")


# --------------------------------------------------------------------------
# Prompting
# --------------------------------------------------------------------------
def ask(label, default, required=False):
    suffix = f" [{default}]" if default else ""
    while True:
        try:
            answer = input(f"    {label:<12}{suffix}: ").strip()
        except EOFError:                       # piped input ran out
            raise KeyboardInterrupt
        if answer:
            return answer
        if default:
            return default
        if not required:
            return ""
        print("      (required)")


def collect_entries(missing, cfg, shift_in, shift_out):
    if not cfg.get("time_in"):
        cfg["time_in"] = shift_in or ""
    if not cfg.get("time_out"):
        cfg["time_out"] = shift_out or ""

    entries, skipped = [], []
    print("\n  Enter the OB details for each day.")
    print("  Enter accepts the [default]; type 's' at From to skip the day, "
          "'q' to stop early.\n")
    for i, day in enumerate(missing, 1):
        print(f"  [{i}/{len(missing)}] {day.strftime('%a %d-%b-%Y')}")
        origin = ask("From", cfg["from"])
        if origin.lower() == "s":
            skipped.append((day, "skipped at prompt"))
            print("    -- skipped\n")
            continue
        if origin.lower() == "q":
            skipped.extend((d, "not reached (stopped early)")
                           for d in missing[i - 1:])
            print("    -- stopping\n")
            break
        entry = {
            "date": fmt_date(day),
            "from": origin,
            "to": ask("To", cfg["to"]),
            "purpose": ask("Purpose", cfg["purpose"], required=True),
            "time_in": ask("Time In", cfg["time_in"]),
            "time_out": ask("Time Out", cfg["time_out"]),
            "personnel": ask("Personnel", cfg["personnel"]),
        }
        entries.append(entry)
        for key in ("from", "to", "purpose", "time_in", "time_out", "personnel"):
            cfg[key] = entry[key]
        print()
    return entries, skipped


# --------------------------------------------------------------------------
# Main
# --------------------------------------------------------------------------
def find_missing(rows, present, start, end, holidays, include_absent):
    """Return (missing days, [(date, why-skipped)])."""
    missing, skipped = [], []

    day = start
    while day <= end:
        if day.weekday() < 5 and day not in present:
            if day in holidays:
                skipped.append((day, holidays[day]))
            else:
                missing.append(day)
        day += dt.timedelta(days=1)

    # Rows that ARE in the file but are non-working days: reported, never prompted.
    for r in sorted(rows, key=lambda r: r["_date"]):
        if not start <= r["_date"] <= end:
            continue
        reasons = []
        hol_name = str(r.get("hol_name") or "").strip()
        if truthy(r.get("hol_flag")) or hol_name:
            reasons.append(f"holiday {hol_name}".strip())
        if truthy(r.get("do_flag")):
            reasons.append("rest day")
        if truthy(r.get("leave")) or truthy(r.get("lv_type")):
            kind = str(r.get("lv_type") or r.get("leave") or "").strip()
            reasons.append(f"leave {kind}".strip())
        if reasons:
            skipped.append((r["_date"], "in file: " + ", ".join(reasons)))
        elif include_absent and truthy(r.get("abs_flag")):
            missing.append(r["_date"])

    return sorted(set(missing)), sorted(skipped)


def main(argv=None):
    ap = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("input", type=Path, help="attendance export (.XLS/.xlsx)")
    ap.add_argument("-o", "--output", type=Path, help="output PDF path")
    ap.add_argument("--from", dest="date_from",
                    help="start of range, e.g. 01-Aug-26 (default: earliest row)")
    ap.add_argument("--to", dest="date_to",
                    help="end of range, e.g. 31-Aug-26 (default: latest row)")
    ap.add_argument("--emp", help="empno, when the export holds several people")
    ap.add_argument("--holidays", type=Path,
                    help="text file of holiday dates, one per line")
    ap.add_argument("--include-absent", action="store_true",
                    help="also treat rows already flagged absent (abs_flag) "
                         "as missing days")
    ap.add_argument("--dry-run", action="store_true",
                    help="report the missing days only; do not prompt or render")
    args = ap.parse_args(argv)

    if not args.input.exists():
        ap.error(f"no such file: {args.input}")

    rows = load_rows(args.input)
    if not rows:
        ap.error("the sheet has no data rows")

    for row in rows:
        row["_date"] = parse_date(row.get("ddate"))
    rows = [r for r in rows if r["_date"]]
    if not rows:
        ap.error("could not parse any 'ddate' values")

    # --- pick the employee -------------------------------------------------
    emps = sorted({str(r.get("empno", "")).strip() for r in rows})
    if args.emp:
        rows = [r for r in rows if str(r.get("empno", "")).strip() == args.emp]
        if not rows:
            ap.error(f"empno {args.emp} not found (file has: {', '.join(emps)})")
    elif len(emps) > 1:
        ap.error("this export covers several employees; pass --emp with one of: "
                 + ", ".join(emps))

    empno = str(rows[0].get("empno", "")).strip()
    name = pretty_name(rows[0].get("empname"))
    shift_in, shift_out = shift_times(rows[0].get("shift"))

    # --- the range ---------------------------------------------------------
    present = {r["_date"] for r in rows}
    start = parse_date(args.date_from) if args.date_from else min(present)
    end = parse_date(args.date_to) if args.date_to else max(present)
    if args.date_from and not start:
        ap.error(f"could not parse --from {args.date_from!r}")
    if args.date_to and not end:
        ap.error(f"could not parse --to {args.date_to!r}")
    if start > end:
        ap.error("--from is after --to")

    cfg = load_config()

    holidays = {}
    for text in cfg.get("holidays", []):
        d = parse_date(text)
        if d:
            holidays[d] = "holiday (config)"
    if args.holidays:
        for line in args.holidays.read_text(encoding="utf-8").splitlines():
            line = line.split("#", 1)[0].strip()
            if not line:
                continue
            d = parse_date(line)
            if d:
                holidays[d] = "holiday (--holidays)"
            else:
                print(f"  ! unparsed holiday line: {line!r}")

    missing, skipped = find_missing(rows, present, start, end, holidays,
                                    args.include_absent)

    print(f"\n  Employee : {name} ({empno})")
    print(f"  Range    : {fmt_date(start)} .. {fmt_date(end)}")
    print(f"  In file  : {len(present)} dated row(s)")
    if shift_in:
        print(f"  Shift    : {shift_in} - {shift_out}")

    if skipped:
        print(f"\n  Skipped ({len(skipped)}):")
        for d, why in skipped:
            print(f"    {d.strftime('%a %d-%b-%Y')}  {why}")

    if not missing:
        print("\n  No missing work days in this range.")
        print("  (If the export only lists absences, widen the window with "
              "--from/--to, or use --include-absent.)\n")
        return 0

    print(f"\n  Missing work days ({len(missing)}):")
    for d in missing:
        print(f"    {d.strftime('%a %d-%b-%Y')}")

    if args.dry_run:
        print()
        return 0

    print()
    cfg["position"] = ask("Position", cfg.get("position"), required=True)
    slip_date = ask("Slip date", fmt_date(dt.date.today()))

    entries, more_skipped = collect_entries(missing, cfg, shift_in, shift_out)
    save_config(cfg)

    if more_skipped:
        print("  Also skipped:")
        for d, why in more_skipped:
            print(f"    {d.strftime('%a %d-%b-%Y')}  {why}")
    if not entries:
        print("\n  Nothing to print.\n")
        return 0

    out = args.output or args.input.with_name(
        f"OBP_{empno or 'slips'}_{start:%Y%m%d}-{end:%Y%m%d}.pdf")
    header = {"name": name, "position": cfg["position"], "date": slip_date}
    pages = render_pdf(out, header, entries)
    noun = "entry" if len(entries) == 1 else "entries"
    print(f"\n  Wrote {out}  ({len(entries)} {noun}, {pages} "
          f"page{'' if pages == 1 else 's'}, 2 copies per page)\n")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        print("\n  Aborted.\n")
        sys.exit(130)
