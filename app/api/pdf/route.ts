import { NextResponse } from "next/server";

import { renderSlips } from "@/lib/obp-pdf";
import type { Entry, PdfRequest, SlipHeader } from "@/lib/types";

export const runtime = "nodejs";

const clean = (v: unknown) => String(v ?? "").trim();

export async function POST(req: Request) {
  let body: PdfRequest;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const header: SlipHeader = {
    name: clean(body?.header?.name),
    position: clean(body?.header?.position),
    date: clean(body?.header?.date),
  };
  if (!header.name) {
    return NextResponse.json({ error: "The slip needs a name." }, { status: 400 });
  }

  const raw = Array.isArray(body?.entries) ? body.entries : [];
  const entries: Entry[] = raw.map((e) => ({
    iso: clean(e?.iso),
    from: clean(e?.from),
    to: clean(e?.to),
    purpose: clean(e?.purpose),
    timeIn: clean(e?.timeIn),
    timeOut: clean(e?.timeOut),
    personnel: clean(e?.personnel),
  }));

  if (!entries.length) {
    return NextResponse.json({ error: "There are no days to print." }, { status: 400 });
  }
  const bad = entries.find((e) => !/^\d{4}-\d{2}-\d{2}$/.test(e.iso));
  if (bad) {
    return NextResponse.json(
      { error: `Bad date on one of the rows: ${bad.iso || "(blank)"}` },
      { status: 400 },
    );
  }
  const blank = entries.find((e) => !e.purpose);
  if (blank) {
    return NextResponse.json(
      { error: `Every day needs a purpose - ${blank.iso} is blank.` },
      { status: 400 },
    );
  }

  try {
    const bytes = await renderSlips(header, entries);
    const slug = header.name.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const filename = `OBP-${slug || "slips"}-${entries[0].iso}.pdf`;
    return new NextResponse(Buffer.from(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": String(bytes.length),
      },
    });
  } catch (err) {
    console.error("render failed", err);
    return NextResponse.json({ error: "Could not render the PDF." }, { status: 500 });
  }
}
