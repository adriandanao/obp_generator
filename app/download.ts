"use client";

/**
 * Handing a rendered PDF to the browser.
 *
 * The obvious approach - fetch, make a blob URL, click a hidden anchor - is
 * unreliable on mobile Safari for three reasons, all of which bite here:
 *
 *  1. The click lands after `await fetch(...)`, by which point the tap that
 *     started it no longer counts as a user activation. Safari then refuses
 *     the download and navigates instead, which is why the PDF appeared in a
 *     new tab with no way to save it.
 *  2. Revoking the object URL straight after `click()` can pull it away
 *     before Safari has finished with it.
 *  3. A blob typed `application/pdf` is claimed by Safari's built-in viewer
 *     and shown inline rather than downloaded.
 *
 * So: type the download blob `application/octet-stream`, keep the URL alive
 * until it is replaced, and always give the user a real link to tap. The
 * automatic click is a convenience for desktop, not the mechanism.
 */

export type Ready = {
  url: string;
  filename: string;
  /** Kept as a real PDF for the share sheet, which uses the MIME type. */
  file: File;
};

/** iPadOS reports itself as a Mac, so touch support is part of the test. */
export function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  return /Macintosh/.test(ua) && typeof document !== "undefined" && "ontouchend" in document;
}

export function canShareFile(r: Ready | null): boolean {
  if (!r || typeof navigator === "undefined") return false;
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  return Boolean(nav.canShare?.({ files: [r.file] }));
}

/** Opens the OS share sheet - "Save to Files" on iOS. */
export async function shareFile(r: Ready): Promise<void> {
  await navigator.share({ files: [r.file], title: r.filename });
}

export function filenameFrom(res: Response, fallback: string): string {
  return res.headers.get("Content-Disposition")?.match(/filename="([^"]+)"/)?.[1] ?? fallback;
}

/**
 * Turns the response into something downloadable. Revoke the previous
 * Ready's url when you replace it.
 */
export async function toReady(res: Response, fallback: string): Promise<Ready> {
  const buf = await res.arrayBuffer();
  const filename = filenameFrom(res, fallback);
  return {
    // octet-stream so Safari saves it instead of previewing it
    url: URL.createObjectURL(new Blob([buf], { type: "application/octet-stream" })),
    filename,
    file: new File([buf], filename, { type: "application/pdf" }),
  };
}

/**
 * Fire the download without waiting for a tap. Desktop browsers honour this;
 * iOS is skipped deliberately, because there the click would open a viewer
 * tab and the user would lose the page they were on.
 */
export function autoDownload(r: Ready): void {
  if (isIOS()) return;
  const a = document.createElement("a");
  a.href = r.url;
  a.download = r.filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}
