"use client";

import { useEffect, useRef, useState } from "react";

export const SIGNATURE_KEY = "obp-slips.signature.v1";

/** Roughly the printed size, at 4x for a clean 300dpi-ish result. */
const PAD_W = 640;
const PAD_H = 180;
const STROKE = 2.6;

export function loadSignature(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(SIGNATURE_KEY);
  } catch {
    return null;
  }
}

function save(value: string | null) {
  try {
    if (value) window.localStorage.setItem(SIGNATURE_KEY, value);
    else window.localStorage.removeItem(SIGNATURE_KEY);
  } catch {
    /* private mode - the signature just won't persist */
  }
}

/**
 * Crop to the inked pixels and drop anything near-white to transparency, so
 * an uploaded scan sits over the printed name the way wet ink would rather
 * than covering it with a white rectangle.
 */
function clean(source: HTMLCanvasElement, keyOutWhite: boolean): string | null {
  const ctx = source.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  const { width, height } = source;
  const img = ctx.getImageData(0, 0, width, height);
  const d = img.data;

  if (keyOutWhite) {
    for (let i = 0; i < d.length; i += 4) {
      const lum = (d[i] + d[i + 1] + d[i + 2]) / 3;
      if (lum > 200) d[i + 3] = 0;
      else if (lum > 140) d[i + 3] = Math.round(d[i + 3] * (1 - (lum - 140) / 60));
    }
  }

  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (d[(y * width + x) * 4 + 3] > 12) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null; // nothing drawn

  const pad = 4;
  minX = Math.max(0, minX - pad);
  minY = Math.max(0, minY - pad);
  maxX = Math.min(width - 1, maxX + pad);
  maxY = Math.min(height - 1, maxY + pad);

  const out = document.createElement("canvas");
  out.width = maxX - minX + 1;
  out.height = maxY - minY + 1;
  const octx = out.getContext("2d");
  if (!octx) return null;
  const tmp = document.createElement("canvas");
  tmp.width = width;
  tmp.height = height;
  tmp.getContext("2d")?.putImageData(img, 0, 0);
  octx.drawImage(tmp, minX, minY, out.width, out.height, 0, 0, out.width, out.height);
  return out.toDataURL("image/png");
}

export default function SignatureField({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (v: string | null) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const drawing = useRef(false);
  const dirty = useRef(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c || value) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.lineWidth = STROKE;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#111827";
    dirty.current = false;
  }, [value]);

  function at(e: React.PointerEvent<HTMLCanvasElement>) {
    const c = canvasRef.current!;
    const r = c.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / r.width) * c.width,
      y: ((e.clientY - r.top) / r.height) * c.height,
    };
  }

  function down(e: React.PointerEvent<HTMLCanvasElement>) {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = true;
    const { x, y } = at(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
  }

  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const { x, y } = at(e);
    ctx.lineTo(x, y);
    ctx.stroke();
    dirty.current = true;
  }

  function up() {
    drawing.current = false;
  }

  function useDrawing() {
    setError(null);
    const c = canvasRef.current;
    if (!c || !dirty.current) {
      setError("Draw your signature first.");
      return;
    }
    const out = clean(c, false);
    if (!out) {
      setError("Nothing was drawn.");
      return;
    }
    onChange(out);
    save(out);
  }

  function clearPad() {
    const c = canvasRef.current;
    const ctx = c?.getContext("2d");
    if (c && ctx) ctx.clearRect(0, 0, c.width, c.height);
    dirty.current = false;
    setError(null);
  }

  function upload(file: File | null | undefined) {
    setError(null);
    if (!file) return;
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) {
      setError("Use a PNG, JPG or WebP image.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        // Cap the long edge; a phone photo is far larger than the form needs.
        const scale = Math.min(1, 1000 / Math.max(img.width, img.height));
        const c = document.createElement("canvas");
        c.width = Math.round(img.width * scale);
        c.height = Math.round(img.height * scale);
        c.getContext("2d")?.drawImage(img, 0, 0, c.width, c.height);
        const out = clean(c, true);
        if (!out) {
          setError("That image looks blank once the background is removed.");
          return;
        }
        if (out.length > 400_000) {
          setError("That image is too detailed - try a smaller crop.");
          return;
        }
        onChange(out);
        save(out);
      };
      img.onerror = () => setError("That image could not be read.");
      img.src = String(reader.result);
    };
    reader.onerror = () => setError("That file could not be read.");
    reader.readAsDataURL(file);
  }

  function remove() {
    onChange(null);
    save(null);
    setError(null);
  }

  return (
    <div>
      {value ? (
        <div className="sig-preview">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={value} alt="Your saved signature" />
          <div className="row">
            <button onClick={remove}>Remove</button>
            <span className="hint" style={{ margin: 0 }}>
              Saved in this browser and reused on both forms.
            </span>
          </div>
        </div>
      ) : (
        <>
          <canvas
            ref={canvasRef}
            className="sig-pad"
            width={PAD_W}
            height={PAD_H}
            onPointerDown={down}
            onPointerMove={move}
            onPointerUp={up}
            onPointerLeave={up}
          />
          <div className="row" style={{ marginTop: 10 }}>
            <button className="primary" onClick={useDrawing}>Use this signature</button>
            <button onClick={clearPad}>Clear</button>
            <div className="spacer" />
            <button onClick={() => fileRef.current?.click()}>Upload an image</button>
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              style={{ display: "none" }}
              onChange={(e) => upload(e.target.files?.[0])}
            />
          </div>
          <p className="hint">
            Draw with a mouse, trackpad or finger &mdash; or upload a photo of
            your signature on white paper and the background is removed for you.
          </p>
        </>
      )}
      {error && <div className="note err" style={{ marginTop: 10 }}>{error}</div>}
    </div>
  );
}
