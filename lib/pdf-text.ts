/**
 * Drawing primitives shared by the printed forms.
 *
 * pdf-lib gives you baselines and raw coordinates; these wrap that into the
 * operations the forms actually need - text optically centred in a box, text
 * that shrinks to fit a cell, and hairline rules.
 */
import { PDFFont, PDFImage, PDFPage, rgb } from "pdf-lib";

export const BLACK = rgb(0, 0, 0);
export const LINE_W = 0.5;
export const LEADING = 10.0;

export function wrap(text: string, font: PDFFont, size: number, width: number) {
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

export function ellipsize(line: string, font: PDFFont, size: number, width: number) {
  if (font.widthOfTextAtSize(line, size) <= width) return line;
  let s = line;
  while (s && font.widthOfTextAtSize(`${s}...`, size) > width) s = s.slice(0, -1);
  return `${s.trimEnd()}...`;
}

/**
 * Wrap `text` into a width x height cell, shrinking the font a half-point at
 * a time; the smaller the font, the more lines the box can hold.  Nothing is
 * dropped silently: text that cannot fit even at `floor` is ellipsized.
 */
export function fit(
  text: string, font: PDFFont, width: number, height: number,
  size = 8.0, floor = 6.0,
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
export function baseline(
  center: number, size: number, n = 1, index = 0, leading = LEADING,
) {
  return center + ((n - 1) * leading) / 2 - index * leading - 0.35 * size;
}

export function text(
  page: PDFPage, s: string, x: number, y: number, font: PDFFont, size: number,
) {
  page.drawText(s, { x, y, size, font, color: BLACK });
}

export function centred(
  page: PDFPage, s: string, left: number, right: number, y: number,
  font: PDFFont, size: number,
) {
  const x = (left + right) / 2 - font.widthOfTextAtSize(s, size) / 2;
  page.drawText(s, { x, y, size, font, color: BLACK });
}

export function rule(
  page: PDFPage, x1: number, y1: number, x2: number, y2: number,
  dash?: number[], thickness = LINE_W,
) {
  page.drawLine({
    start: { x: x1, y: y1 },
    end: { x: x2, y: y2 },
    thickness,
    color: BLACK,
    dashArray: dash,
  });
}

/**
 * A signature sitting on a ruled line: scaled to fit the box, centred over
 * the rule, resting just above it so it reads as written on the line.
 */
export function drawSignature(
  page: PDFPage, img: PDFImage,
  left: number, right: number, ruleY: number, maxHeight: number,
) {
  const maxWidth = right - left;
  const scale = Math.min(maxWidth / img.width, maxHeight / img.height);
  const w = img.width * scale;
  const h = img.height * scale;
  page.drawImage(img, {
    x: (left + right) / 2 - w / 2,
    y: ruleY + 1,
    width: w,
    height: h,
  });
}

export function drawBlock(
  page: PDFPage, value: string, font: PDFFont, sizeHint: number,
  left: number, right: number, center: number,
  align: "center" | "left", height: number, pad = 2.0,
) {
  const width = right - left - 2 * pad;
  const { lines, size, leading } = fit(value, font, width, height, sizeHint);
  lines.forEach((line, i) => {
    const y = baseline(center, size, lines.length, i, leading);
    if (align === "center") centred(page, line, left, right, y, font, size);
    else text(page, line, left + pad, y, font, size);
  });
}
