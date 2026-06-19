// Server-side limits for Compliance Review form attachments.
//
// Members upload creative files (images, PDFs, ZIPs) through the presigned-URL
// flow and the Compliance form persists them as ticket attachments that admins
// open directly. Without limits a member could attach an unbounded number of
// huge or unexpected file types. These constants + validators are the single
// source of truth for the per-file size, total size, file-count, and content
// type rules. The client mirrors them for fast feedback, but the server is the
// authority (it validates against the *actual* stored object metadata).

export const COMPLIANCE_MAX_FILES = 100;
export const COMPLIANCE_MAX_FILE_SIZE_BYTES = 100 * 1024 * 1024; // 100 MB per file
export const COMPLIANCE_MAX_TOTAL_SIZE_BYTES = 500 * 1024 * 1024; // 500 MB per submission

// Expected creative file types. Browsers are inconsistent about ZIP MIME types
// and sometimes send application/octet-stream for them, so the validator also
// accepts a file whose extension is on the allow-list below.
export const COMPLIANCE_ALLOWED_CONTENT_TYPES: ReadonlySet<string> = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/gif",
  "image/webp",
  "image/bmp",
  "image/tiff",
  "application/pdf",
  "application/zip",
  "application/x-zip",
  "application/x-zip-compressed",
  "multipart/x-zip",
]);

export const COMPLIANCE_ALLOWED_EXTENSIONS: ReadonlySet<string> = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".bmp",
  ".tif",
  ".tiff",
  ".pdf",
  ".zip",
]);

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 bytes";
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024) return `${Math.round(bytes / (1024 * 1024))} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${Math.round(bytes)} bytes`;
}

function extensionOf(fileName: string | null | undefined): string {
  if (!fileName) return "";
  const dot = fileName.lastIndexOf(".");
  if (dot < 0) return "";
  return fileName.slice(dot).toLowerCase();
}

// A file is allowed if its content type is on the allow-list, OR (for generic
// content types like application/octet-stream) its extension is on the
// extension allow-list.
export function isAllowedAttachmentType(
  contentType: string | null | undefined,
  fileName: string | null | undefined,
): boolean {
  const ct = (contentType ?? "").trim().toLowerCase();
  if (ct && COMPLIANCE_ALLOWED_CONTENT_TYPES.has(ct)) return true;
  const ext = extensionOf(fileName);
  if (ext && COMPLIANCE_ALLOWED_EXTENSIONS.has(ext)) return true;
  return false;
}

export type AttachmentToValidate = {
  fileName?: string | null;
  fileSize: number;
  contentType?: string | null;
};

// Returns a human-readable error message if the attachment set violates a
// limit, or null if everything is acceptable. The message is safe to surface
// directly to the member.
export function validateComplianceAttachments(
  attachments: AttachmentToValidate[],
): string | null {
  if (attachments.length > COMPLIANCE_MAX_FILES) {
    return `Too many files. You can upload at most ${COMPLIANCE_MAX_FILES} files per submission (you attached ${attachments.length}).`;
  }

  let total = 0;
  for (const a of attachments) {
    const size = Number.isFinite(a.fileSize) ? a.fileSize : 0;
    const label = a.fileName ?? "file";

    if (!isAllowedAttachmentType(a.contentType, a.fileName)) {
      const typeSuffix = a.contentType ? ` (${a.contentType})` : "";
      return `"${label}" has an unsupported file type${typeSuffix}. Allowed types are images, PDF, and ZIP files.`;
    }

    if (size > COMPLIANCE_MAX_FILE_SIZE_BYTES) {
      return `"${label}" is too large (${formatBytes(size)}). The maximum size per file is ${formatBytes(COMPLIANCE_MAX_FILE_SIZE_BYTES)}.`;
    }

    total += size;
  }

  if (total > COMPLIANCE_MAX_TOTAL_SIZE_BYTES) {
    return `Your files total ${formatBytes(total)}, which exceeds the ${formatBytes(COMPLIANCE_MAX_TOTAL_SIZE_BYTES)} limit per submission.`;
  }

  return null;
}
