// Images sent to a model: the type is read from the bytes, never from a file name, and only the four
// types every vision API takes are allowed. Intake turns everything else into PNG first.

export type ImageMediaType = "image/png" | "image/jpeg" | "image/gif" | "image/webp";

/** The largest image a model is sent. Anthropic refuses more than 5 MB per image. */
export const MAX_IMAGE_BYTES = 5_000_000;
/** At most this many images in one briefing. */
export const MAX_PACK_IMAGES = 20;
/**
 * Tokens one image costs at most. Anthropic shrinks an image to about 1.15 megapixels (1568 px on the
 * long edge), which is about 1,600 tokens (width x height / 750); a smaller image costs less.
 */
export const IMAGE_TOKENS = 1600;

/** The image type from its first bytes, or undefined when it is not one a model takes. */
export function sniffImage(b: Uint8Array): ImageMediaType | undefined {
  const at = (i: number, ...xs: number[]) => xs.every((x, j) => b[i + j] === x);
  if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "image/png";
  if (at(0, 0xff, 0xd8, 0xff)) return "image/jpeg";
  if (at(0, 0x47, 0x49, 0x46, 0x38)) return "image/gif";
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return "image/webp";
  return undefined;
}

export interface ModelImage { mediaType: ImageMediaType; base64: string }

/** Bytes to what a provider sends, or why they cannot be sent. */
export function toModelImage(bytes: Uint8Array, label: string): ModelImage {
  const mediaType = sniffImage(bytes);
  if (!mediaType) throw new Error(`${label} is not a PNG, JPEG, GIF or WebP image`);
  if (bytes.length > MAX_IMAGE_BYTES) throw new Error(`${label} is ${(bytes.length / 1e6).toFixed(1)} MB; a model takes at most ${MAX_IMAGE_BYTES / 1e6} MB per image`);
  return { mediaType, base64: Buffer.from(bytes).toString("base64") };
}
