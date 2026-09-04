import { NextResponse } from "next/server";

import { ParseError, analyse } from "@/lib/attendance";
import { parseDate } from "@/lib/dates";

export const runtime = "nodejs";

const MAX_BYTES = 5 * 1024 * 1024;

export async function POST(req: Request) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Expected a multipart upload." }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file was uploaded." }, { status: 400 });
  }
  if (file.size === 0) {
    return NextResponse.json({ error: "That file is empty." }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `That file is ${(file.size / 1e6).toFixed(1)} MB; the limit is 5 MB.` },
      { status: 413 },
    );
  }

  const str = (key: string) => {
    const v = form.get(key);
    return typeof v === "string" && v.trim() ? v.trim() : undefined;
  };

  const holidays = (str("holidays") ?? "")
    .split(/[\n,]/)
    .map((s) => s.split("#")[0].trim())
    .filter(Boolean)
    .map(parseDate)
    .filter((d): d is string => Boolean(d));

  try {
    const result = analyse(Buffer.from(await file.arrayBuffer()), {
      empno: str("empno"),
      from: str("from") ? parseDate(str("from")) ?? undefined : undefined,
      to: str("to") ? parseDate(str("to")) ?? undefined : undefined,
      includeAbsent: form.get("includeAbsent") === "true",
      holidays,
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof ParseError) {
      return NextResponse.json({ error: err.message }, { status: 422 });
    }
    console.error("parse failed", err);
    return NextResponse.json(
      { error: "Could not read that file. Is it a timekeeping export?" },
      { status: 422 },
    );
  }
}
