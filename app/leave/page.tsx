"use client";

import { useEffect, useMemo, useState } from "react";

import { countWeekdays, fmtShort, isoOf } from "@/lib/dates";
import type { LeaveKind, LeavePeriod } from "@/lib/types";
import SignatureField, { loadSignature } from "../signature";

const DEFAULTS_KEY = "obp-slips.leave.v1";

const KINDS: { value: LeaveKind; label: string }[] = [
  { value: "vacation", label: "Vacation Leave" },
  { value: "sick", label: "Sick Leave" },
  { value: "emergency", label: "Emergency Leave" },
  { value: "other", label: "Other" },
];

type Saved = { name: string; position: string; department: string };

function todayIso() {
  const n = new Date();
  return isoOf(n.getFullYear(), n.getMonth() + 1, n.getDate());
}

function loadSaved(): Saved {
  const empty = { name: "", position: "", department: "" };
  if (typeof window === "undefined") return empty;
  try {
    const raw = window.localStorage.getItem(DEFAULTS_KEY);
    return raw ? { ...empty, ...JSON.parse(raw) } : empty;
  } catch {
    return empty;
  }
}

/** A period the user has not customised keeps tracking the weekday count. */
type Row = LeavePeriod & { autoDays: boolean };

const newRow = (iso: string): Row => ({ from: iso, to: iso, days: "", autoDays: true });

export default function LeavePage() {
  const [name, setName] = useState("");
  const [position, setPosition] = useState("");
  const [department, setDepartment] = useState("");
  const [datePrepared, setDatePrepared] = useState("");
  const [kind, setKind] = useState<LeaveKind>("vacation");
  const [otherText, setOtherText] = useState("");
  const [recordUnder, setRecordUnder] = useState<"VL" | "SL">("VL");
  const [reason, setReason] = useState("");
  const [signature, setSignature] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const s = loadSaved();
    setName(s.name);
    setPosition(s.position);
    setDepartment(s.department);
    setSignature(loadSignature());

    const today = todayIso();
    setDatePrepared(today);
    setRows([newRow(today)]);
  }, []);

  /** Sick leave is recorded under SL, everything else under VL - overridable. */
  function pickKind(k: LeaveKind) {
    setKind(k);
    setRecordUnder(k === "sick" ? "SL" : "VL");
  }

  function update(i: number, patch: Partial<Row>) {
    setRows((rs) =>
      rs.map((r, j) => {
        if (j !== i) return r;
        const next = { ...r, ...patch };
        if (patch.days !== undefined) next.autoDays = false;
        if (next.to < next.from) next.to = next.from;
        return next;
      }),
    );
  }

  /** The count shown for a row: auto unless the user typed over it. */
  const daysFor = (r: Row) =>
    r.autoDays ? String(countWeekdays(r.from, r.to)) : r.days;

  const valid = useMemo(
    () => Boolean(name.trim()) && rows.length > 0 && rows.every((r) => r.from && r.to),
    [name, rows],
  );

  async function generate() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/leave-pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          position,
          department,
          datePrepared: datePrepared ? fmtShort(datePrepared) : "",
          kind,
          otherText,
          recordUnder,
          reason,
          periods: rows.map((r) => ({ from: r.from, to: r.to, days: daysFor(r) })),
          signature,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? "Could not render the PDF.");
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download =
        res.headers.get("Content-Disposition")?.match(/filename="([^"]+)"/)?.[1] ??
        "AFL.pdf";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      try {
        window.localStorage.setItem(
          DEFAULTS_KEY,
          JSON.stringify({ name: name.trim(), position, department }),
        );
      } catch {
        /* private mode - defaults just won't stick */
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main>
      <h1>Application for Leave</h1>
      <p className="sub">
        HRM F015. One form per period, two copies per page &mdash; the leave
        balances are left blank to fill in by hand.
      </p>

      <section className="panel">
        <h2>1 &middot; Employee</h2>
        <div className="grid cols-4">
          <div>
            <label htmlFor="lname">Name of employee</label>
            <input id="lname" type="text" value={name}
                   onChange={(e) => setName(e.target.value)} placeholder="Adrian F. Danao" />
          </div>
          <div>
            <label htmlFor="lpos">Position</label>
            <input id="lpos" type="text" value={position}
                   onChange={(e) => setPosition(e.target.value)} placeholder="Your job title" />
          </div>
          <div>
            <label htmlFor="ldept">Section / Department</label>
            <input id="ldept" type="text" value={department}
                   onChange={(e) => setDepartment(e.target.value)} placeholder="e.g. IT" />
          </div>
          <div>
            <label htmlFor="lprep">Date prepared</label>
            <input id="lprep" type="date" value={datePrepared}
                   onChange={(e) => setDatePrepared(e.target.value)} />
          </div>
        </div>
      </section>

      <section className="panel">
        <h2>2 &middot; Type of leave</h2>
        <div className="row" style={{ gap: 18 }}>
          {KINDS.map((k) => (
            <label key={k.value} className="choice">
              <input type="radio" name="kind" checked={kind === k.value}
                     onChange={() => pickKind(k.value)} />
              {k.label}
            </label>
          ))}
          {kind === "other" && (
            <input type="text" style={{ maxWidth: 260 }} value={otherText}
                   onChange={(e) => setOtherText(e.target.value)}
                   placeholder="Please specify" />
          )}
        </div>

        <div className="row" style={{ marginTop: 14, gap: 18 }}>
          <span style={{ fontSize: 12, color: "var(--muted)" }}>
            Record the dates under
          </span>
          {(["VL", "SL"] as const).map((c) => (
            <label key={c} className="choice">
              <input type="radio" name="under" checked={recordUnder === c}
                     onChange={() => setRecordUnder(c)} />
              {c}
            </label>
          ))}
        </div>
      </section>

      <section className="panel">
        <h2>3 &middot; Periods</h2>
        <p className="hint" style={{ marginTop: 0, marginBottom: 12 }}>
          Each period prints its own form. Days counts Mon&ndash;Fri only &mdash;
          type over it for half-days or a different rule.
        </p>

        <div className="tbl-wrap">
          <table style={{ minWidth: 620 }}>
            <thead>
              <tr>
                <th style={{ width: 180 }}>From</th>
                <th style={{ width: 180 }}>To</th>
                <th style={{ width: 110 }}>No. of days</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td>
                    <input type="date" value={r.from} max={r.to || undefined}
                           aria-label={`Period ${i + 1} from`}
                           onChange={(e) => update(i, { from: e.target.value })} />
                  </td>
                  <td>
                    <input type="date" value={r.to} min={r.from || undefined}
                           aria-label={`Period ${i + 1} to`}
                           onChange={(e) => update(i, { to: e.target.value })} />
                  </td>
                  <td>
                    <input type="text" value={daysFor(r)}
                           aria-label={`Period ${i + 1} days`}
                           onChange={(e) => update(i, { days: e.target.value })} />
                  </td>
                  <td>
                    <button className="link" disabled={rows.length === 1}
                            onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}>
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="row" style={{ marginTop: 12 }}>
          <button onClick={() => setRows((rs) => [...rs, newRow(todayIso())])}>
            Add period
          </button>
          <span style={{ color: "var(--muted)" }}>
            {rows.length} form{rows.length === 1 ? "" : "s"}, 2 copies each
          </span>
        </div>
      </section>

      <section className="panel">
        <h2>4 &middot; Reason</h2>
        <label htmlFor="lreason">Reason / explanation for leave application</label>
        <textarea id="lreason" value={reason} onChange={(e) => setReason(e.target.value)}
                  placeholder="Left blank on the form if you'd rather write it in" />

        <div style={{ marginTop: 18 }}>
          <label>Signature (optional)</label>
          <SignatureField value={signature} onChange={setSignature} />
        </div>

        <div className="row" style={{ marginTop: 18 }}>
          <button className="primary" onClick={generate} disabled={busy || !valid}>
            {busy ? "Rendering…" : `Generate PDF (${rows.length})`}
          </button>
          {!name.trim() && (
            <span style={{ color: "var(--muted)" }}>Add the employee name first</span>
          )}
        </div>

        {error && <div className="note err" style={{ marginTop: 16 }}>{error}</div>}
      </section>
    </main>
  );
}
