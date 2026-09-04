/**
 * Signature images arrive from the browser as PNG data URLs - either drawn on
 * a canvas or uploaded and keyed to transparency there. The server only has
 * to check that what it got is really a small PNG before handing it to
 * pdf-lib.
 */
const PNG_PREFIX = "data:image/png;base64,";
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
export const MAX_SIGNATURE_BYTES = 400_000;

export class SignatureError extends Error {}

/** Returns null for "no signature"; throws SignatureError on a bad one. */
export function decodeSignature(value: unknown): Uint8Array | null {
  const s = String(value ?? "").trim();
  if (!s) return null;

  if (!s.startsWith(PNG_PREFIX)) {
    throw new SignatureError("The signature must be a PNG data URL.");
  }

  let bytes: Buffer;
  try {
    bytes = Buffer.from(s.slice(PNG_PREFIX.length), "base64");
  } catch {
    throw new SignatureError("The signature image could not be decoded.");
  }

  if (!bytes.length) throw new SignatureError("The signature image is empty.");
  if (bytes.length > MAX_SIGNATURE_BYTES) {
    throw new SignatureError(
      `The signature image is ${Math.round(bytes.length / 1024)} KB; the limit is ` +
      `${Math.round(MAX_SIGNATURE_BYTES / 1024)} KB.`,
    );
  }
  if (!PNG_MAGIC.every((b, i) => bytes[i] === b)) {
    throw new SignatureError("That file does not look like a PNG.");
  }

  return new Uint8Array(bytes);
}
