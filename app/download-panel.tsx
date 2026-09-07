"use client";

import { useState } from "react";

import { type Ready, canShareFile, shareFile } from "./download";

/**
 * The finished PDF, offered as a link the user taps themselves. That tap is
 * a fresh user activation, which is what mobile Safari needs before it will
 * save a file rather than open it in a viewer.
 */
export default function DownloadPanel({ ready }: { ready: Ready | null }) {
  const [shareError, setShareError] = useState<string | null>(null);
  if (!ready) return null;

  async function save() {
    if (!ready) return;
    setShareError(null);
    try {
      await shareFile(ready);
    } catch (err) {
      // Dismissing the share sheet is a cancel, not a failure.
      if ((err as DOMException)?.name !== "AbortError") {
        setShareError("Could not open the share sheet - use Download instead.");
      }
    }
  }

  return (
    <div className="ready">
      <div className="ready-head">
        <span className="tick" aria-hidden="true">✓</span>
        <span>
          <strong>{ready.filename}</strong> is ready.
        </span>
      </div>
      <div className="row">
        <a className="btn primary" href={ready.url} download={ready.filename}>
          Download
        </a>
        {canShareFile(ready) && (
          <button onClick={save}>Save to Files&hellip;</button>
        )}
      </div>
      <p className="hint">
        On iPhone or iPad, <strong>Save to Files</strong> is the reliable one
        &mdash; Download may open the PDF in a viewer instead.
      </p>
      {shareError && <div className="note err" style={{ marginTop: 10 }}>{shareError}</div>}
    </div>
  );
}
