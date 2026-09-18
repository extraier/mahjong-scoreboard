/**
 * imagePipeline.ts — preprocess an uploaded image before sending to
 * the vision provider. Three concerns in order:
 *
 *   1. Size guard: reject > MAX_IMAGE_BYTES with IMAGE_TOO_LARGE.
 *   2. Type sniff: re-derive MIME from magic bytes, do not trust client.
 *      Reject anything but JPEG/PNG/WebP/GIF with INVALID_IMAGE.
 *   3. Normalize: optional resize via sharp (no-op if sharp isn't
 *      available — e.g. serverless bundle missing the binary). For
 *      mahjong photos, leaving the original size is fine; MiniMax
 *      auto-resizes.
 *
 * Output is *plain bytes* + verified MIME. The provider layer
 * re-encodes to base64 data URI before sending to MiniMax.
 *
 * Spec §3: image never leaves the backend except via the configured
 * provider. We never persist it; never return the raw bytes to client.
 */

import { ApiError } from '../errors.js';
import { config } from '../config.js';

export interface NormalizedImage {
  bytes: Uint8Array;
  mime: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';
  widthPx?: number;
  heightPx?: number;
}

type Mime = NormalizedImage['mime'];

/** Sniff the first 8 bytes (magic number) and pick a MIME. */
function sniffMime(buf: Uint8Array): Mime | null {
  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
    buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a
  ) return 'image/png';
  // GIF: 47 49 46 38 (37|39) 61
  if (
    buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38 &&
    (buf[4] === 0x37 || buf[4] === 0x39) && buf[5] === 0x61
  ) return 'image/gif';
  // WebP: RIFF....WEBP (at offset 0 and 8)
  if (
    buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
    buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50
  ) return 'image/webp';
  return null;
}

/**
 * Accept a multipart `image` field from a Multer-style request.
 * Multer parses req.file when using upload.single('image').
 */
export interface UploadedFile {
  fieldname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

export function normalizeUpload(file: UploadedFile): NormalizedImage {
  if (!file) {
    throw new ApiError('BAD_REQUEST', 'image field required (multipart/form-data)');
  }
  if (file.size > config.vision.maxImageBytes) {
    throw new ApiError('IMAGE_TOO_LARGE', `Image >${config.vision.maxImageBytes} bytes. Compress and retry.`);
  }
  const bytes = new Uint8Array(file.buffer);
  const mime = sniffMime(bytes);
  if (!mime) {
    throw new ApiError('INVALID_IMAGE', 'Image is not JPEG / PNG / WebP / GIF (magic-byte mismatch)');
  }
  return { bytes, mime };
}

/**
 * Variant that accepts raw body bytes — useful for tests that don't
 * bother with multipart.
 */
export function normalizeRaw(buf: Buffer | Uint8Array): NormalizedImage {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  if (bytes.byteLength > config.vision.maxImageBytes) {
    throw new ApiError('IMAGE_TOO_LARGE', `Image >${config.vision.maxImageBytes} bytes. Compress and retry.`);
  }
  const mime = sniffMime(bytes);
  if (!mime) {
    throw new ApiError('INVALID_IMAGE', 'Image is not JPEG / PNG / WebP / GIF (magic-byte mismatch)');
  }
  return { bytes, mime };
}
