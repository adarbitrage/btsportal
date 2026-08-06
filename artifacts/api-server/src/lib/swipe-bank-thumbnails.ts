/**
 * Swipe Resource Bank thumbnail pipeline (Task #2104).
 *
 * Thumbnails are generated at upload/registration time from the ORIGINAL
 * bytes (originals are never modified) and stored as separate objects in
 * private object storage, served only through the gated thumbnail proxy.
 */
import sharp from "sharp";

export const THUMBNAIL_MAX_WIDTH = 480;
export const THUMBNAIL_CONTENT_TYPE = "image/webp";

/** Mime types we attempt thumbnail generation for. */
const THUMBNAILABLE_MIME_PREFIXES = [
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/gif",
  "image/avif",
  "image/tiff",
];

export function isThumbnailableMime(mimeType: string): boolean {
  const mt = (mimeType || "").toLowerCase().split(";")[0].trim();
  return THUMBNAILABLE_MIME_PREFIXES.includes(mt);
}

/**
 * Generates a downscaled webp thumbnail from original image bytes.
 * Returns null for non-image (or unsupported) inputs; NEVER throws for
 * unsupported mime types — but does throw on corrupt bytes of a claimed
 * supported type so the caller can surface a loud registration error.
 */
export async function generateThumbnail(
  original: Buffer,
  mimeType: string,
): Promise<{ bytes: Buffer; contentType: string } | null> {
  if (!isThumbnailableMime(mimeType)) return null;
  const bytes = await sharp(original, { animated: false })
    .rotate()
    .resize({ width: THUMBNAIL_MAX_WIDTH, withoutEnlargement: true })
    .webp({ quality: 80 })
    .toBuffer();
  return { bytes, contentType: THUMBNAIL_CONTENT_TYPE };
}
