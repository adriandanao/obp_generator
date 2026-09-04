import { NextResponse } from "next/server";

import { renderLeaveForms } from "@/lib/afl-pdf";
import { SignatureError, decodeSignature } from "@/lib/signature";
import type { LeaveKind, LeavePeriod, LeaveRequest } from "@/lib/types";

export const runtime = "nodejs";

const KINDS: LeaveKind[] = ["vacation", "sick", "emergency", "other"];
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const clean = (v: unknown) => String(v ?? "").trim();

export async function POST(req: Request) {
  let body: Partial<LeaveRequest>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const name = clean(body?.name);
  if (!name) {
    return NextResponse.json({ error: "The form needs a name." }, { status: 400 });
  }

  const kind = KINDS.includes(body?.kind as LeaveKind)
    ? (body!.kind as LeaveKind)
    : "vacation";

  const rawPeriods = Array.isArray(body?.periods) ? body.periods : [];
  const periods: LeavePeriod[] = rawPeriods.map((p) => ({
    from: clean(p?.from),
    to: clean(p?.to),
    days: clean(p?.days),
  }));

  if (!periods.length) {
    return NextResponse.json({ error: "Add at least one leave period." }, { status: 400 });
  }
  for (const p of periods) {
    if (!ISO.test(p.from) || !ISO.test(p.to)) {
      return NextResponse.json(
        { error: "Every period needs a start and end date." },
        { status: 400 },
      );
    }
    if (p.from > p.to) {
      return NextResponse.json(
        { error: `That period starts after it ends (${p.from} to ${p.to}).` },
        { status: 400 },
      );
    }
  }

  const request: LeaveRequest = {
    name,
    position: clean(body?.position),
    department: clean(body?.department),
    datePrepared: clean(body?.datePrepared),
    kind,
    otherText: clean(body?.otherText),
    recordUnder: body?.recordUnder === "SL" ? "SL" : "VL",
    reason: clean(body?.reason),
    periods,
  };

  let signature: Uint8Array | null;
  try {
    signature = decodeSignature((body as { signature?: unknown })?.signature);
  } catch (err) {
    if (err instanceof SignatureError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }

  try {
    const bytes = await renderLeaveForms(request, signature);
    const slug = name.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const filename = `AFL-${slug || "leave"}-${periods[0].from}.pdf`;
    return new NextResponse(Buffer.from(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": String(bytes.length),
      },
    });
  } catch (err) {
    console.error("leave render failed", err);
    return NextResponse.json({ error: "Could not render the PDF." }, { status: 500 });
  }
}
