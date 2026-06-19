// Server-side limits for Compliance Review form attachments.
//
// Members upload creative files (images, PDFs, ZIPs) through the presigned-URL
// flow and the Compliance form persists them as ticket attachments that admins
// open directly. Without limits a member could attach an unbounded number of
// huge or unexpected file types.
//
// The per-file size cap and content-type allow-list are NOT defined here: they
// are the exact same rules the ticket reply composer enforces, owned by the
// shared `validateTicketAttachment` in `@workspace/support-config`. Reusing it
// keeps both intake paths consistent (no duplicated limits). This module only
// adds the two *aggregate* guards the shared per-file validator does not cover —
// a per-submission file-count cap and a total-size cap — so an abusive payload
// can't fan out unbounded storage lookups or store an unbounded total.
//
// The client mirrors these rules for fast feedback, but the server is the
// authority (it validates against the *actual* stored object metadata).

import { validateTicketAttachment } from "@workspace/support-config";

export const COMPLIANCE_MAX_FILES = 100;
export const COMPLIANCE_MAX_TOTAL_SIZE_BYTES = 500 * 1024 * 1024; // 500 MB per submission

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 bytes";
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024) return `${Math.round(bytes / (1024 * 1024))} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${Math.round(bytes)} bytes`;
}

export type AttachmentToValidate = {
  fileName?: string | null;
  fileSize: number;
  contentType?: string | null;
};

// Returns a human-readable error message if the attachment set violates a
// limit, or null if everything is acceptable. The message is safe to surface
// directly to the member.
//
// Per-file size and content-type are delegated to the shared
// `validateTicketAttachment` so the Compliance form and the ticket reply
// composer enforce identical rules; only the aggregate count/total caps are
// applied here.
export function validateComplianceAttachments(
  attachments: AttachmentToValidate[],
): string | null {
  if (attachments.length > COMPLIANCE_MAX_FILES) {
    return `Too many files. You can upload at most ${COMPLIANCE_MAX_FILES} files per submission (you attached ${attachments.length}).`;
  }

  let total = 0;
  for (const a of attachments) {
    const perFileError = validateTicketAttachment({
      fileName: a.fileName,
      fileSize: a.fileSize,
      contentType: a.contentType,
    });
    if (perFileError) return perFileError;

    total += Number.isFinite(a.fileSize) ? a.fileSize : 0;
  }

  if (total > COMPLIANCE_MAX_TOTAL_SIZE_BYTES) {
    return `Your files total ${formatBytes(total)}, which exceeds the ${formatBytes(COMPLIANCE_MAX_TOTAL_SIZE_BYTES)} limit per submission.`;
  }

  return null;
}
