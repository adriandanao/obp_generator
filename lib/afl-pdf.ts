/**
 * Renderer for HRM F015 - AFL Application for Leave.
 *
 * Unlike the OB slip, this one was rebuilt from a photograph of a printed
 * form rather than measured from a source PDF, so the constants below are
 * proportional judgements, not measurements. They reproduce the structure -
 * header block, the four leave-type checkboxes, the twin-block table, reason
 * line, three signature blocks and the distribution list - at sizes that
 * print correctly on Letter. If the original file turns up, re-measure and
 * replace these numbers; nothing else needs to change.
 *
 * Two identical copies per page, split by the "=====" rule the form uses.
 */
import { PDFDocument, PDFFont, PDFPage, StandardFonts } from "pdf-lib";

import { fmtShort } from "./dates";
import { baseline, centred, drawBlock, rule, text } from "./pdf-text";
import type { LeaveKind, LeaveRequest } from "./types";

const PAGE_W = 612;
const PAGE_H = 792;
const X0 = 51;
const XN = 561;

/** Baseline of the first title line, per copy. */
const FORM_TOPS = [762, 386];
const SEP_Y = 400;

// Offsets from a copy's title baseline.
const DY_TITLE2 = -16;
const DY_NAME = -38;
const DY_POSITION = -53;
const DY_RULE1 = -61;
const DY_CHECK_HDR = -73;
const DY_RULE2 = -79;
const DY_CHECK1 = -92;
const DY_CHECK2 = -106;
const DY_RULE3 = -114;
const DY_TABLE_TOP = -126;
const DY_REASON_LABEL = -232;
const DY_REASON_TEXT = -240;
const DY_SIGN_LABEL = -272;
const DY_SIGN_NAME = -292;
const DY_SIGN_RULE = -296;
const DY_DIST = -310;
const DY_DIST_LINES = [-322, -333, -344];

const ROW_H = 15;
const ROWS = 6;
/** label | VL | SL | spacer | label | VL | SL
 *  The right-hand VL/SL are wider than the left: they hold dates, not counts. */
const COLS = [51, 250, 292, 334, 350, 462, 512, 561];

// The second column of each field row starts here.
const X_RIGHT = 345;

const SIZE_TITLE = 11;
const SIZE_SUBTITLE = 9.5;
const SIZE_BODY = 9;
const SIZE_CELL = 8;
const BOX = 7;

const LEFT_ROWS = [
  "Allowable Leave",
  "Leaves taken prior to this leave",
  "Balance to-date",
  "Leaves applied for",
  "Remaining leaves",
];

type Fonts = { regular: PDFFont; bold: PDFFont };

/** "Label: <value>" on a ruled line running to `lineEnd`. */
function field(
  page: PDFPage, x: number, y: number, label: string, value: string,
  lineEnd: number, fonts: Fonts,
) {
  text(page, label, x, y, fonts.regular, SIZE_BODY);
  const lineStart = x + fonts.regular.widthOfTextAtSize(label, SIZE_BODY) + 2;
  rule(page, lineStart, y - 2.5, lineEnd, y - 2.5);
  if (value) text(page, value, lineStart + 3, y, fonts.regular, SIZE_BODY);
}

function checkbox(
  page: PDFPage, x: number, y: number, label: string, checked: boolean, fonts: Fonts,
) {
  rule(page, x, y, x + BOX, y);
  rule(page, x, y + BOX, x + BOX, y + BOX);
  rule(page, x, y, x, y + BOX);
  rule(page, x + BOX, y, x + BOX, y + BOX);
  if (checked) {
    rule(page, x + 1, y + 1, x + BOX - 1, y + BOX - 1);
    rule(page, x + 1, y + BOX - 1, x + BOX - 1, y + 1);
  }
  text(page, label, x + BOX + 4, y, fonts.regular, SIZE_BODY);
}

function drawTable(page: PDFPage, top: number, req: LeaveRequest, period: number, fonts: Fonts) {
  const bottom = top - ROWS * ROW_H;

  for (let i = 0; i <= ROWS; i++) {
    const y = top - i * ROW_H;
    rule(page, X0, y, XN, y);
  }
  for (const x of COLS) rule(page, x, bottom, x, top);

  const mid = (i: number) => top - i * ROW_H - ROW_H / 2;
  const cell = (s: string, a: number, b: number, i: number, align: "left" | "center") =>
    drawBlock(page, s, fonts.regular, SIZE_CELL, COLS[a], COLS[b], mid(i), align, ROW_H - 2, 3);

  // headers
  cell("Leave Record to-date", 0, 1, 0, "left");
  cell("VL", 1, 2, 0, "center");
  cell("SL", 2, 3, 0, "center");
  cell("Leave to be taken", 4, 5, 0, "left");
  cell("VL", 5, 6, 0, "center");
  cell("SL", 6, 7, 0, "center");

  LEFT_ROWS.forEach((label, i) => cell(label, 0, 1, i + 1, "left"));

  // Right block: only the three "leave to be taken" rows carry values; the
  // balance columns opposite are left blank for HR to fill from the 201 file.
  const p = req.periods[period];
  const values: [string, string][] = [
    ["From", p ? fmtShort(p.from) : ""],
    ["To:", p ? fmtShort(p.to) : ""],
    ["No of days", p?.days ?? ""],
  ];
  const valueCol = req.recordUnder === "SL" ? 6 : 5;
  values.forEach(([label, value], i) => {
    cell(label, 4, 5, i + 1, "left");
    if (value) cell(value, valueCol, valueCol + 1, i + 1, "center");
  });
}

function drawForm(page: PDFPage, top: number, req: LeaveRequest, period: number, fonts: Fonts) {
  text(page, "HRM F015 – AFL Application for Leave", X0, top, fonts.bold, SIZE_TITLE);
  text(page, "OVGC Application for Leave", X0, top + DY_TITLE2, fonts.bold, SIZE_SUBTITLE);

  field(page, X0, top + DY_NAME, "Name of Employee:", req.name, 330, fonts);
  field(page, X_RIGHT, top + DY_NAME, "Section/Department:", req.department, XN, fonts);
  field(page, X0, top + DY_POSITION, "Position:", req.position, 330, fonts);
  field(page, X_RIGHT, top + DY_POSITION, "Date Prepared:", req.datePrepared, XN, fonts);

  rule(page, X0, top + DY_RULE1, XN, top + DY_RULE1);
  centred(page, "Please check type of leave applied for", X0, XN,
          top + DY_CHECK_HDR, fonts.regular, SIZE_BODY);
  rule(page, X0, top + DY_RULE2, XN, top + DY_RULE2);

  const on = (k: LeaveKind) => req.kind === k;
  checkbox(page, X0 + 9, top + DY_CHECK1, "Vacation Leave", on("vacation"), fonts);
  checkbox(page, 210, top + DY_CHECK1, "Emergency Leave", on("emergency"), fonts);
  checkbox(page, X0 + 9, top + DY_CHECK2, "Sick  Leave", on("sick"), fonts);
  checkbox(page, 210, top + DY_CHECK2, "Other", on("other"), fonts);

  const otherX = 210 + BOX + 4 + fonts.regular.widthOfTextAtSize("Other", SIZE_BODY) + 4;
  rule(page, otherX, top + DY_CHECK2 - 2.5, 470, top + DY_CHECK2 - 2.5);
  if (on("other") && req.otherText) {
    text(page, req.otherText, otherX + 3, top + DY_CHECK2, fonts.regular, SIZE_BODY);
  }

  rule(page, X0, top + DY_RULE3, XN, top + DY_RULE3);

  drawTable(page, top + DY_TABLE_TOP, req, period, fonts);

  text(page, "Reason/explanation for leave application:", X0,
       top + DY_REASON_LABEL, fonts.regular, SIZE_BODY);
  if (req.reason.trim()) {
    drawBlock(page, req.reason, fonts.regular, SIZE_BODY, X0, XN,
              top + DY_REASON_TEXT - 9, "left", 26, 0);
  }

  text(page, "Prepared by:", X0, top + DY_SIGN_LABEL, fonts.regular, SIZE_BODY);
  text(page, "Noted by:", 250, top + DY_SIGN_LABEL, fonts.regular, SIZE_BODY);
  text(page, "Approved by:", 400, top + DY_SIGN_LABEL, fonts.regular, SIZE_BODY);

  if (req.name) {
    text(page, req.name.toUpperCase(), X0, top + DY_SIGN_NAME, fonts.regular, SIZE_BODY);
  }
  for (const [a, b] of [[X0, 210], [250, 390], [400, 540]]) {
    rule(page, a, top + DY_SIGN_RULE, b, top + DY_SIGN_RULE);
  }

  text(page, "Distribution:", X0, top + DY_DIST, fonts.regular, SIZE_BODY);
  ["201 File", "HRM", "Payroll"].forEach((line, i) => {
    text(page, line, X0 + 24, top + DY_DIST_LINES[i], fonts.regular, SIZE_BODY);
  });
}

/** The "=====" rule the form uses between the two copies. */
function drawSeparator(page: PDFPage, fonts: Fonts) {
  const seg = "=";
  const w = fonts.regular.widthOfTextAtSize(seg, 9);
  const n = Math.floor((XN - X0) / w);
  text(page, seg.repeat(n), X0, SEP_Y, fonts.regular, 9);
}

/** One form per leave period, two identical copies per page. */
export async function renderLeaveForms(req: LeaveRequest): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle("Application for Leave");
  const fonts: Fonts = {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
  };

  const count = Math.max(1, req.periods.length);
  for (let i = 0; i < count; i++) {
    const page = doc.addPage([PAGE_W, PAGE_H]);
    for (const top of FORM_TOPS) drawForm(page, top, req, i, fonts);
    drawSeparator(page, fonts);
  }

  return doc.save();
}
