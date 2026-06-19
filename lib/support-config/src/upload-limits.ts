/**
 * Single source of truth for the validation rules applied to files attached to
 * support tickets (the member reply composer and any other ticket-attachment
 * flow).
 *
 * These constants are consumed in two independent places that must agree, or a
 * file the client happily uploads would be rejected by the server (a confusing
 * dead-end for the member):
 *   - the portal reply composer (`artifacts/portal/src/pages/TicketDetail.tsx`),
 *     which validates each selected file *before* requesting a presigned URL so
 *     an oversized/unsupported file never reaches object storage, and
 *   - the API server (`POST /tickets/:id/messages` in
 *     `artifacts/api-server/src/routes/tickets.ts`), which re-validates every
 *     attachment before inserting a `ticket_attachments` row so the cap can
 *     never be bypassed by a hand-crafted request.
 *
 * Keeping the limit + allow-list here, shared by both sides, makes that drift
 * impossible.
 */

/**
 * Maximum size, in bytes, of a single ticket attachment.
 *
 * Matches the 50MB cap the rest of the portal already enforces on uploads
 * (lesson resources in `admin-resources.ts`).
 */
export const TICKET_ATTACHMENT_MAX_BYTES = 50 * 1024 * 1024;

/** Human-readable form of {@link TICKET_ATTACHMENT_MAX_BYTES} for messages. */
export const TICKET_ATTACHMENT_MAX_LABEL = "50MB";

/**
 * Content types a ticket attachment is allowed to declare: images, PDFs, and
 * common office/text documents (plus ZIP for bundled files).
 */
export const TICKET_ATTACHMENT_ALLOWED_CONTENT_TYPES = [
  // Images
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  // PDF
  "application/pdf",
  // Word
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  // Excel
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  // PowerPoint
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  // Text / CSV
  "text/plain",
  "text/csv",
  // Archives
  "application/zip",
] as const;

export type TicketAttachmentContentType =
  (typeof TICKET_ATTACHMENT_ALLOWED_CONTENT_TYPES)[number];

/** Short human-readable description of the allow-list for error messages. */
export const TICKET_ATTACHMENT_ALLOWED_LABEL =
  "images, PDFs, Word/Excel/PowerPoint documents, text, CSV, and ZIP files";

/** Returns true if `contentType` is on the ticket-attachment allow-list. */
export function isAllowedTicketAttachmentType(
  contentType: string | null | undefined,
): boolean {
  if (!contentType) return false;
  return (TICKET_ATTACHMENT_ALLOWED_CONTENT_TYPES as readonly string[]).includes(
    contentType,
  );
}

/**
 * Validate a single ticket attachment by its metadata.
 *
 * Returns a clear, member-facing error message string when the file is too
 * large or its content type is not allowed, or `null` when it is acceptable.
 * Shared so the portal (pre-upload) and the API (pre-insert) report the exact
 * same reason.
 */
export function validateTicketAttachment(input: {
  fileName?: string | null;
  fileSize?: number | null;
  contentType?: string | null;
}): string | null {
  const label = input.fileName?.trim() || "This file";

  if (!isAllowedTicketAttachmentType(input.contentType)) {
    return `${label} can't be attached. Allowed types: ${TICKET_ATTACHMENT_ALLOWED_LABEL}.`;
  }

  if (
    typeof input.fileSize === "number" &&
    Number.isFinite(input.fileSize) &&
    input.fileSize > TICKET_ATTACHMENT_MAX_BYTES
  ) {
    return `${label} is too large. The maximum attachment size is ${TICKET_ATTACHMENT_MAX_LABEL}.`;
  }

  return null;
}
