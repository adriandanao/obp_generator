"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { type Cutoff, cutoffsAround, dueCutoff } from "@/lib/cutoff";
import { fmtShort, isoOf } from "@/lib/dates";
import type { Entry, ParseResult } from "@/lib/types";

type Draft = Entry & { include: boolean; label: string };

type Defaults = {
  position: string;
  from: string;
  to: string;
  purpose: string;
  timeIn: string;
  timeOut: string;
  personnel: string;
};

const DEFAULTS_KEY = "obp-slips.defaults.v1";

const EMPTY_DEFAULTS: Defaults = {
  position: "",
  from: "Head Office",
  to: "",
  purpose: "",
  timeIn: "",
  timeOut: "",
  personnel: "",
};

function loadDefaults(): Defaults {
  if (typeof window === "undefined") return EMPTY_DEFAULTS;
  try {
    const raw = window.localStorage.getItem(DEFAULTS_KEY);
    return raw ? { ...EMPTY_DEFAULTS, ...JSON.parse(raw) } : EMPTY_DEFAULTS;
  } catch {
    return EMPTY_DEFAULTS;
  }
}

function saveDefaults(d: Defaults) {
  try {
    window.localStorage.setItem(DEFAULTS_KEY, JSON.stringify(d));
  } catch {
    /* private mode - defaults just won't stick */
  }
}

/** Local calendar date - toISOString() would roll over a day ahead of UTC. */
function todayIso() {
  const n = new Date();
  return isoOf(n.getFullYear(), n.getMonth() + 1, n.getDate());
}

/** Sentinel option values for the cut-off picker. */
const FILE_RANGE = "file";
const CUSTOM = "custom";

export default function Page() {
  const [file, setFile] = useState<File | null>(null);
  const [over, setOver] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [result, setResult] = useState<ParseResult | null>(null);
  const [rows, setRows] = useState<Draft[]>([]);

  const [empno, setEmpno] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [includeAbsent, setIncludeAbsent] = useState(false);
  const [holidays, setHolidays] = useState("");
  const [cutoffs, setCutoffs] = useState<Cutoff[]>([]);
  const [cutoffId, setCutoffId] = useState<string>(FILE_RANGE);

  const [position, setPosition] = useState("");
  const [slipDate, setSlipDate] = useState("");

  const inputRef = useRef<HTMLInputElement>(null);
  const defaultsRef = useRef<Defaults>(EMPTY_DEFAULTS);

  // "Today" is only known on the client, so the cut-off calendar is built
  // after mount rather than during render.
  useEffect(() => {
    const d = loadDefaults();
    defaultsRef.current = d;
    setPosition(d.position);

    const today = todayIso();
    setSlipDate(today); // held as ISO for the picker, printed as dd-MMM-yy
    setCutoffs(cutoffsAround(today));
    const due = dueCutoff(today);
    if (due) {
      setCutoffId(due.id);
      setFrom(due.start);
      setTo(due.end);
    }
  }, []);

  const analyse = useCallback(
    async (theFile: File, over: Partial<Record<string, string | boolean>> = {}) => {
      setScanning(true);
      setError(null);
      try {
        const fd = new FormData();
        fd.set("file", theFile);
        const opts = { empno, from, to, includeAbsent, holidays, ...over };
        for (const [k, v] of Object.entries(opts)) {
          if (v !== "" && v != null && v !== false) fd.set(k, String(v));
        }

        const res = await fetch("/api/parse", { method: "POST", body: fd });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error ?? "Could not read that file.");

        const parsed = data as ParseResult;
        setResult(parsed);
        if (!empno && parsed.employees.length === 1) setEmpno(parsed.empno);
        // Seed the pickers with the file's own range so there is something to
        // nudge, rather than two empty date fields.
        setFrom((v) => v || parsed.rangeStart);
        setTo((v) => v || parsed.rangeEnd);

        const d = defaultsRef.current;
        setRows(
          parsed.missing.map((m) => ({
            iso: m.iso,
            label: m.label,
            include: true,
            from: d.from,
            to: d.to,
            purpose: d.purpose,
            timeIn: d.timeIn || parsed.shiftIn || "",
            timeOut: d.timeOut || parsed.shiftOut || "",
            personnel: d.personnel,
          })),
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setResult(null);
        setRows([]);
      } finally {
        setScanning(false);
      }
    },
    [empno, from, to, includeAbsent, holidays],
  );

  function onPick(f: File | null | undefined) {
    if (!f) return;
    setFile(f);
    setEmpno("");
    // Keep whichever cut-off is selected; only fall back to the file's own
    // range when the picker is not on a period.
    const sel = cutoffs.find((c) => c.id === cutoffId);
    const range = sel ? { from: sel.start, to: sel.end } : { from: "", to: "" };
    setFrom(range.from);
    setTo(range.to);
    void analyse(f, { empno: "", ...range });
  }

  function pickCutoff(id: string) {
    setCutoffId(id);
    if (id === CUSTOM) return;

    const c = cutoffs.find((x) => x.id === id);
    const range = c ? { from: c.start, to: c.end } : { from: "", to: "" };
    setFrom(range.from);
    setTo(range.to);
    if (file) void analyse(file, range);
  }

  const chosen = useMemo(() => rows.filter((r) => r.include), [rows]);
  const incomplete = useMemo(
    () => chosen.filter((r) => !r.purpose.trim()).length,
    [chosen],
  );

  function update(iso: string, patch: Partial<Draft>) {
    setRows((rs) => rs.map((r) => (r.iso === iso ? { ...r, ...patch } : r)));
  }

  /** Copy the first included row's details into every row below it. */
  function fillDown() {
    const first = rows.find((r) => r.include);
    if (!first) return;
    setRows((rs) =>
      rs.map((r) =>
        r.iso === first.iso
          ? r
          : {
              ...r,
              from: first.from,
              to: first.to,
              purpose: first.purpose,
              timeIn: first.timeIn,
              timeOut: first.timeOut,
              personnel: first.personnel,
            },
      ),
    );
  }

  async function generate() {
    if (!result) return;
    setRendering(true);
    setError(null);
    try {
      const entries: Entry[] = chosen.map(({ include, label, ...e }) => e);
      const res = await fetch("/api/pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          header: {
            name: result.name,
            position,
            date: slipDate ? fmtShort(slipDate) : "",
          },
          entries,
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
        res.headers
          .get("Content-Disposition")
          ?.match(/filename="([^"]+)"/)?.[1] ?? "OBP.pdf";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      const first = chosen[0];
      const next: Defaults = {
        position,
        from: first?.from ?? defaultsRef.current.from,
        to: first?.to ?? defaultsRef.current.to,
        purpose: first?.purpose ?? defaultsRef.current.purpose,
        timeIn: first?.timeIn ?? defaultsRef.current.timeIn,
        timeOut: first?.timeOut ?? defaultsRef.current.timeOut,
        personnel: first?.personnel ?? defaultsRef.current.personnel,
      };
      defaultsRef.current = next;
      saveDefaults(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRendering(false);
    }
  }

  const pages = Math.max(1, Math.ceil(chosen.length / 4));

  return (
    <main>
      <h1>Official Business Slips</h1>
      <p className="sub">
        Upload a timekeeping export, say what you were doing on the days with no
        record, and print the slips.
      </p>

      {/* ---------------------------------------------------------- upload */}
      <section className="panel">
        <h2>1 &middot; Attendance export</h2>
        <div
          className={`drop${over ? " over" : ""}`}
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            onPick(e.dataTransfer.files?.[0]);
          }}
        >
          <strong>{file ? file.name : "Drop the .XLS here, or click to browse"}</strong>
          <span>
            {file
              ? `${(file.size / 1024).toFixed(0)} KB — click to choose another`
              : "The export with empno, ddate, hrswrk… columns"}
          </span>
          <input
            ref={inputRef}
            type="file"
            accept=".xls,.xlsx,.xlsm,.csv"
            onChange={(e) => onPick(e.target.files?.[0])}
          />
        </div>

        {result && (
          <>
            <div className="facts" style={{ marginTop: 18 }}>
              <div className="fact">
                <div className="k">Employee</div>
                <div className="v">
                  {result.name} <span style={{ color: "var(--muted)", fontWeight: 400 }}>({result.empno})</span>
                </div>
              </div>
              <div className="fact">
                <div className="k">Range</div>
                <div className="v">
                  {fmtShort(result.rangeStart)} &ndash; {fmtShort(result.rangeEnd)}
                </div>
              </div>
              <div className="fact">
                <div className="k">Rows in file</div>
                <div className="v">{result.rowCount}</div>
              </div>
              {result.shiftIn && (
                <div className="fact">
                  <div className="k">Shift</div>
                  <div className="v">
                    {result.shiftIn} &ndash; {result.shiftOut}
                  </div>
                </div>
              )}
            </div>

            {result.employees.length > 1 && (
              <div style={{ marginTop: 18, maxWidth: 320 }}>
                <label htmlFor="emp">Employee</label>
                <select
                  id="emp"
                  value={empno}
                  onChange={(e) => {
                    setEmpno(e.target.value);
                    if (file) void analyse(file, { empno: e.target.value });
                  }}
                >
                  <option value="">Choose&hellip;</option>
                  {result.employees.map((e) => (
                    <option key={e.empno} value={e.empno}>
                      {e.name} ({e.empno})
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="grid range" style={{ marginTop: 18 }}>
              <div>
                <label htmlFor="cutoff">Cut-off period</label>
                <select
                  id="cutoff"
                  value={cutoffId}
                  onChange={(e) => pickCutoff(e.target.value)}
                >
                  {cutoffs.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                  <option value={FILE_RANGE}>Whatever the file covers</option>
                  <option value={CUSTOM}>Custom&hellip;</option>
                </select>
              </div>
              <div>
                <label htmlFor="from">From</label>
                <input
                  id="from"
                  type="date"
                  value={from}
                  max={to || undefined}
                  onChange={(e) => {
                    setFrom(e.target.value);
                    setCutoffId(CUSTOM);
                  }}
                />
              </div>
              <div>
                <label htmlFor="to">To</label>
                <input
                  id="to"
                  type="date"
                  value={to}
                  min={from || undefined}
                  onChange={(e) => {
                    setTo(e.target.value);
                    setCutoffId(CUSTOM);
                  }}
                />
              </div>
              <div>
                <label htmlFor="hol">Holidays (optional)</label>
                <input
                  id="hol"
                  type="text"
                  placeholder="25-Dec-26, 30-Dec-26"
                  value={holidays}
                  onChange={(e) => setHolidays(e.target.value)}
                />
              </div>
            </div>

            <div className="row" style={{ marginTop: 14 }}>
              <label style={{ margin: 0, display: "flex", gap: 7, alignItems: "center" }}>
                <input
                  type="checkbox"
                  checked={includeAbsent}
                  onChange={(e) => setIncludeAbsent(e.target.checked)}
                />
                Also include days flagged absent that <em>do</em> have clock-ins
              </label>
              <div className="spacer" />
              <button onClick={() => file && analyse(file)} disabled={scanning || !file}>
                {scanning ? "Reading…" : "Re-scan"}
              </button>
            </div>

            <p className="hint">
              A Mon&ndash;Fri date counts as missing when it has no row in the
              file, or has a row the clock never registered &mdash; rest days,
              holidays and leave are set aside. It opens on the cut-off you are
              currently filing for; editing either date switches to Custom.
            </p>
          </>
        )}

        {error && (
          <div className="note err" style={{ marginTop: 16 }}>
            {error}
          </div>
        )}
      </section>

      {/* ------------------------------------------------------- the days */}
      {result && (
        <section className="panel">
          <h2>2 &middot; Missing work days</h2>

          {result.skipped.length > 0 && (
            <div className="note" style={{ marginBottom: 16 }}>
              Skipped {result.skipped.length} day
              {result.skipped.length === 1 ? "" : "s"}:
              <ul>
                {result.skipped.map((s) => (
                  <li key={`${s.iso}-${s.reason}`}>
                    <strong>{s.label}</strong> &mdash; {s.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {rows.length === 0 ? (
            <p className="empty">
              No missing work days in this range. Try widening it above.
            </p>
          ) : (
            <>
              <div className="row" style={{ marginBottom: 12 }}>
                <span className="count">
                  {chosen.length} of {rows.length} selected
                </span>
                <span style={{ color: "var(--muted)" }}>
                  &rarr; {pages} page{pages === 1 ? "" : "s"}, 2 copies each
                </span>
                <div className="spacer" />
                <button onClick={fillDown} disabled={!chosen.length}>
                  Copy first row down
                </button>
                <button
                  onClick={() =>
                    setRows((rs) => rs.map((r) => ({ ...r, include: true })))
                  }
                >
                  Select all
                </button>
                <button
                  onClick={() =>
                    setRows((rs) => rs.map((r) => ({ ...r, include: false })))
                  }
                >
                  Clear
                </button>
              </div>

              <div className="tbl-wrap">
                <table>
                  <thead>
                    <tr>
                      <th />
                      <th>Date</th>
                      <th>From</th>
                      <th>To</th>
                      <th>Purpose</th>
                      <th style={{ width: 78 }}>Time In</th>
                      <th style={{ width: 78 }}>Time Out</th>
                      <th>Personnel in charge</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.iso} className={r.include ? "" : "off"}>
                        <td className="tick">
                          <input
                            type="checkbox"
                            aria-label={`Include ${r.label}`}
                            checked={r.include}
                            onChange={(e) =>
                              update(r.iso, { include: e.target.checked })
                            }
                          />
                        </td>
                        <td className="day">{r.label}</td>
                        {(
                          [
                            ["from", "Head Office"],
                            ["to", "Client site"],
                            ["purpose", "What you were doing"],
                            ["timeIn", "08:30"],
                            ["timeOut", "17:30"],
                            ["personnel", "Who you saw"],
                          ] as const
                        ).map(([key, placeholder]) => (
                          <td key={key}>
                            <input
                              type="text"
                              aria-label={`${key} for ${r.label}`}
                              placeholder={placeholder}
                              value={r[key]}
                              disabled={!r.include}
                              onChange={(e) =>
                                update(r.iso, { [key]: e.target.value })
                              }
                            />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>
      )}

      {/* ----------------------------------------------------------- print */}
      {result && rows.length > 0 && (
        <section className="panel">
          <h2>3 &middot; Print</h2>
          <div className="grid cols-3">
            <div>
              <label htmlFor="name">Name</label>
              <input id="name" type="text" value={result.name} readOnly />
            </div>
            <div>
              <label htmlFor="pos">Position</label>
              <input
                id="pos"
                type="text"
                placeholder="Your job title"
                value={position}
                onChange={(e) => setPosition(e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="sdate">Date on the slip</label>
              <input
                id="sdate"
                type="date"
                value={slipDate}
                onChange={(e) => setSlipDate(e.target.value)}
              />
            </div>
          </div>

          <div className="row" style={{ marginTop: 18 }}>
            <button
              className="primary"
              onClick={generate}
              disabled={
                rendering || scanning || !chosen.length || incomplete > 0 ||
                !position.trim()
              }
            >
              {rendering ? "Rendering…" : `Generate PDF (${chosen.length})`}
            </button>
            {incomplete > 0 && (
              <span style={{ color: "var(--muted)" }}>
                {incomplete} selected day{incomplete === 1 ? "" : "s"} still
                need a purpose
              </span>
            )}
            {!position.trim() && incomplete === 0 && (
              <span style={{ color: "var(--muted)" }}>Add your position first</span>
            )}
          </div>
        </section>
      )}
    </main>
  );
}
