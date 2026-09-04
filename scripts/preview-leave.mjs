/** Renders a sample leave form for eyeballing: node --import tsx scripts/preview-leave.mjs out.pdf */
import { writeFileSync } from "node:fs";
import { renderLeaveForms } from "../lib/afl-pdf.ts";

const out = process.argv[2] ?? "afl-preview.pdf";
writeFileSync(out, await renderLeaveForms({
  name: "Adrian F. Danao",
  position: "Odoo Functional Consultant",
  department: "IT / Professional Services",
  datePrepared: "04-Sep-26",
  kind: "vacation",
  otherText: "",
  recordUnder: "VL",
  reason: "Out of town for a family commitment; work has been endorsed to the team.",
  periods: [
    { from: "2026-08-21", to: "2026-08-24", days: "2" },
    { from: "2026-08-27", to: "2026-08-27", days: "1" },
  ],
}));
console.log("wrote", out);
