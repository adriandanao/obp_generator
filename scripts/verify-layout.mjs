/**
 * Renders the reference slip and prints its geometry, so it can be diffed
 * against the original OBP PDF.  Run with:
 *
 *   node --experimental-strip-types scripts/verify-layout.mjs out.pdf
 */
import { writeFileSync } from "node:fs";

import { renderSlips } from "../lib/obp-pdf.ts";

const header = {
  name: "Mariane A. Morillo",
  position: "Business Analyst",
  date: "19-Aug-26",
};

const mk = (iso, to, purpose, timeIn, timeOut, personnel) => ({
  iso, from: "Head Office", to, purpose, timeIn, timeOut, personnel,
});

const entries = [
  mk("2026-08-03", "Client Site - Makati", "Requirements gathering session", "08:30", "12:00", "J. Dela Cruz"),
  mk("2026-08-04", "BIR Quezon City", "Filing of documents", "09:00", "11:30", "R. Santos"),
  mk("2026-08-05", "Client Site - BGC", "User acceptance testing", "13:00", "17:00", "A. Reyes"),
  mk("2026-08-06", "Client Site - Ortigas", "Project kickoff meeting", "08:00", "16:00", "L. Cruz"),
];

const out = process.argv[2] ?? "reference.pdf";
writeFileSync(out, await renderSlips(header, entries));
console.log(`wrote ${out}`);
