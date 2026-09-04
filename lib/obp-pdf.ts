/**
 * Renderer for the Official Business Slip.
 *
 * Every constant below was measured off the printed form: the column stops,
 * the 28pt row pitch, the four Helvetica sizes and the offsets of the
 * signature block.  The DY_* values are offsets from the top rule of a slip's
 * table, so one slip can be stamped at any anchor on the page.  Output is
 * geometrically identical to the reference PDF - see scripts/verify-layout.mjs.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { PDFDocument, PDFFont, PDFImage, PDFPage, StandardFonts, rgb } from "pdf-lib";

import { fmtShort } from "./dates";
import type { Entry, SlipHeader } from "./types";

const PAGE_W = 612;
const PAGE_H = 792;
const COLS = [51.0, 111.1, 160.4, 209.6, 324.8, 384.9, 449.2, 561.0];
const ROW_H = 28.0;
const ROWS_PER_SLIP = 4;
const HDR_H = 26.0;
const SLIP_TOPS = [628.2, 257.8]; // top rule of the upper / lower copy
const CUT_Y = 396.0;

const DY_TITLE = 33.1; // baseline of "OFFICIAL BUSINESS SLIP"
const DY_FIELDS = 10.1; // baseline of Name / Position / Date
const DY_FIELD_RULE = 8.0; // the little underlines beneath their values
const DY_SPLIT = -13.0; // rule that halves "Origin / Destination"
const DY_PREPARED = -167.9; // baseline of "Prepared by:" and the name
const DY_SIG_RULE = -170.0;
const DY_SIG1 = -176.5; // "SIGN OVER PRINTED NAME"
const DY_SIG2 = -185.0; // "(INDICATE DATE PREPARED)"

// Letterhead logo, centred above the title on each copy.
const LOGO_X = 206.9;
const LOGO_W = 198.2;
const LOGO_H = 46.0;
const DY_LOGO = 46.0; // bottom edge of the logo

const SIZE_TITLE = 9;
const SIZE_FIELD = 8;
const SIZE_THEAD = 7;
const SIZE_CELL = 8;
const SIZE_SMALL = 6;
const LINE_W = 0.5;
const BLACK = rgb(0, 0, 0);

type Resources = { regular: PDFFont; bold: PDFFont; logo: PDFImage | null };

/**
 * The letterhead, read once from disk.  A missing file is a deployment
 * problem, not a reason to refuse the slip - warn and print without it.
 */
let logoBytes: Uint8Array | null | undefined;
function loadLogo(): Uint8Array | null {
  if (logoBytes === undefined) {
    try {
      logoBytes = new Uint8Array(readFileSync(join(process.cwd(), "assets", "logo.png")));
    } catch (err) {
      console.warn("obp-pdf: assets/logo.png missing, printing without it", err);
      logoBytes = null;
    }
  }
  return logoBytes;
}

// ---------------------------------------------------------------- text ----

function wrap(text: string, font: PDFFont, size: number, width: number) {
  const lines: string[] = [];
  let cur = "";
  for (const word of String(text).split(/\s+/).filter(Boolean)) {
    const trial = cur ? `${cur} ${word}` : word;
    if (!cur || font.widthOfTextAtSize(trial, size) <= width) {
      cur = trial;
    } else {
      lines.push(cur);
      cur = word;
    }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [""];
}

function ellipsize(line: string, font: PDFFont, size: number, width: number) {
  if (font.widthOfTextAtSize(line, size) <= width) return line;
  let s = line;
  while (s && font.widthOfTextAtSize(`${s}...`, size) > width) s = s.slice(0, -1);
  return `${s.trimEnd()}...`;
}

/**
 * Wrap `text` into a width x height cell, shrinking the font a half-point at
 * a time; the smaller the font, the more lines the row can hold.  At 8pt in a
 * 26pt row that is the two lines the printed form uses.  Nothing is dropped
 * silently: text that cannot fit even at `floor` is ellipsized.
 */
function fit(
  text: string,
  font: PDFFont,
  width: number,
  height: number,
  size = 8.0,
  floor = 6.0,
) {
  for (let s = size; s >= floor; s -= 0.5) {
    const leading = s + 2.0;
    const allowed = Math.max(1, Math.floor(height / leading));
    const lines = wrap(text, font, s, width);
    const fits = lines.every((ln) => font.widthOfTextAtSize(ln, s) <= width);
    if (lines.length <= allowed && fits) return { lines, size: s, leading };
  }

  const s = floor;
  const leading = floor + 2.0;
  const allowed = Math.max(1, Math.floor(height / leading));
  let lines = wrap(text, font, s, width);
  if (lines.length > allowed) {
    const kept = lines.slice(0, allowed);
    kept[allowed - 1] = ellipsize(lines.slice(allowed - 1).join(" "), font, s, width);
    lines = kept;
  }
  return { lines: lines.map((ln) => ellipsize(ln, font, s, width)), size: s, leading };
}

/** Baseline of line `index` of an n-line block optically centred on `center`. */
function baseline(center: number, size: number, n: number, index: number, leading: number) {
  return center + ((n - 1) * leading) / 2 - index * leading - 0.35 * size;
}

// -------------------------------------------------------------- drawing ----

function text(page: PDFPage, s: string, x: number, y: number, font: PDFFont, size: number) {
  page.drawText(s, { x, y, size, font, color: BLACK });
}

function centred(
  page: PDFPage, s: string, left: number, right: number, y: number,
  font: PDFFont, size: number,
) {
  const x = (left + right) / 2 - font.widthOfTextAtSize(s, size) / 2;
  page.drawText(s, { x, y, size, font, color: BLACK });
}

function rule(page: PDFPage, x1: number, y1: number, x2: number, y2: number, dash?: number[]) {
  page.drawLine({
    start: { x: x1, y: y1 },
    end: { x: x2, y: y2 },
    thickness: LINE_W,
    color: BLACK,
    dashArray: dash,
  });
}

function drawBlock(
  page: PDFPage, value: string, font: PDFFont, left: number, right: number,
  center: number, align: "center" | "left", pad = 2.0, height = ROW_H - 2.0,
) {
  const width = right - left - 2 * pad;
  const { lines, size, leading } = fit(value, font, width, height, SIZE_CELL);
  lines.forEach((line, i) => {
    const y = baseline(center, size, lines.length, i, leading);
    if (align === "center") centred(page, line, left, right, y, font, size);
    else text(page, line, left + pad, y, font, size);
  });
}

// The header underlines start just after the label and overhang the value.
// Calibrated against the reference PDF using pdf-lib's own Helvetica metrics,
// which differ from other renderers' by a few hundredths of a point per glyph.
const RULE_PAD_START = 1.38;
const RULE_PAD_END = 7.49;

/** "Name: <value>" plus the underline the form puts beneath the value. */
function drawField(
  page: PDFPage, x: number, label: string, value: string, top: number, font: PDFFont,
) {
  text(page, `${label} ${value}`, x, top + DY_FIELDS, font, SIZE_FIELD);
  const y = top + DY_FIELD_RULE;
  rule(
    page,
    x + font.widthOfTextAtSize(`${label} `, SIZE_FIELD) + RULE_PAD_START, y,
    x + font.widthOfTextAtSize(`${label} ${value}`, SIZE_FIELD) + RULE_PAD_END, y,
  );
}

function drawSlip(
  page: PDFPage, top: number, header: SlipHeader, entries: Entry[], res: Resources,
) {
  const { regular, bold, logo } = res;
  const x0 = COLS[0];
  const xn = COLS[COLS.length - 1];
  const hdrBot = top - HDR_H;
  const bottom = hdrBot - ROWS_PER_SLIP * ROW_H;
  const split = top + DY_SPLIT;

  if (logo) {
    page.drawImage(logo, {
      x: LOGO_X, y: top + DY_LOGO, width: LOGO_W, height: LOGO_H,
    });
  }

  centred(page, "OFFICIAL BUSINESS SLIP", 0, PAGE_W, top + DY_TITLE, bold, SIZE_TITLE);

  drawField(page, COLS[0], "Name:", header.name, top, regular);
  drawField(page, COLS[3], "Position:", header.position, top, regular);
  drawField(page, COLS[5], "Date:", header.date, top, regular);

  // grid
  for (const y of [top, hdrBot, bottom]) rule(page, x0, y, xn, y);
  for (let i = 1; i < ROWS_PER_SLIP; i++) {
    const y = hdrBot - i * ROW_H;
    rule(page, x0, y, xn, y);
  }
  COLS.forEach((x, i) => rule(page, x, bottom, x, i === 2 ? split : top));
  rule(page, COLS[1], split, COLS[3], split);

  // column headings
  const band = (top + hdrBot) / 2;
  const head: [string, number, number][] = [
    ["Date", 0, 1],
    ["Purpose (s)", 3, 4],
    ["Time In", 4, 5],
    ["Time Out", 5, 6],
    ["Personnel In Charge / Signature", 6, 7],
  ];
  for (const [label, a, b] of head) {
    centred(page, label, COLS[a], COLS[b], baseline(band, SIZE_THEAD, 1, 0, 0), bold, SIZE_THEAD);
  }
  centred(page, "Origin / Destination", COLS[1], COLS[3],
          baseline((split + top) / 2, SIZE_THEAD, 1, 0, 0), bold, SIZE_THEAD);
  centred(page, "From", COLS[1], COLS[2],
          baseline((hdrBot + split) / 2, SIZE_THEAD, 1, 0, 0), bold, SIZE_THEAD);
  centred(page, "To", COLS[2], COLS[3],
          baseline((hdrBot + split) / 2, SIZE_THEAD, 1, 0, 0), bold, SIZE_THEAD);

  // data
  entries.forEach((e, i) => {
    const mid = hdrBot - i * ROW_H - ROW_H / 2;
    const cells: [string, number, number, "center" | "left"][] = [
      [fmtShort(e.iso), 0, 1, "center"],
      [e.from, 1, 2, "center"],
      [e.to, 2, 3, "center"],
      [e.purpose, 3, 4, "left"],
      [e.timeIn, 4, 5, "center"],
      [e.timeOut, 5, 6, "center"],
      [e.personnel, 6, 7, "center"],
    ];
    for (const [value, a, b, align] of cells) {
      if (String(value ?? "").trim()) {
        drawBlock(page, String(value), regular, COLS[a], COLS[b], mid, align);
      }
    }
  });

  // signature blocks
  text(page, "Prepared by:", COLS[0], top + DY_PREPARED, regular, SIZE_FIELD);
  text(page, "Approved by:", COLS[4], top + DY_PREPARED, regular, SIZE_FIELD);
  text(page, header.name.toUpperCase(), COLS[1], top + DY_PREPARED, regular, SIZE_FIELD);
  rule(page, COLS[1], top + DY_SIG_RULE, COLS[1] + 90.5, top + DY_SIG_RULE);
  rule(page, COLS[5], top + DY_SIG_RULE, COLS[5] + 110.0, top + DY_SIG_RULE);
  for (const x of [COLS[1], COLS[5]]) {
    text(page, "SIGN OVER PRINTED NAME", x, top + DY_SIG1, regular, SIZE_SMALL);
    text(page, "(INDICATE DATE PREPARED)", x, top + DY_SIG2, regular, SIZE_SMALL);
  }
}

function drawCutLine(page: PDFPage, font: PDFFont) {
  rule(page, 25.5, CUT_Y, 290.2, CUT_Y, [2, 2]);
  rule(page, 321.8, CUT_Y, 586.5, CUT_Y, [2, 2]);
  centred(page, "cut here", 0, PAGE_W, CUT_Y - 2.0, font, SIZE_SMALL);
}

/** Four entries per slip; two identical copies per page. */
export async function renderSlips(
  header: SlipHeader,
  entries: Entry[],
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle("Official Business Slip");
  const raw = loadLogo();
  const res: Resources = {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
    logo: raw ? await doc.embedPng(raw) : null,
  };

  const chunks: Entry[][] = [];
  for (let i = 0; i < entries.length; i += ROWS_PER_SLIP) {
    chunks.push(entries.slice(i, i + ROWS_PER_SLIP));
  }
  if (!chunks.length) chunks.push([]);

  for (const chunk of chunks) {
    const page = doc.addPage([PAGE_W, PAGE_H]);
    for (const top of SLIP_TOPS) drawSlip(page, top, header, chunk, res);
    drawCutLine(page, res.regular);
  }

  return doc.save();
}

export const LAYOUT = { PAGE_W, PAGE_H, COLS, ROW_H, ROWS_PER_SLIP, SLIP_TOPS };
