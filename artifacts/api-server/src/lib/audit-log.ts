import { type Request } from "express";
import { db, auditLogTable } from "@workspace/db";

export interface AuditLogEntry {
  actorId?: number;
  actorEmail?: string;
  actionType: string;
  entityType: string;
  entityId?: string;
  description: string;
  changeDiff?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  req?: Request;
}

export async function logAuditEvent(entry: AuditLogEntry): Promise<void> {
  try {
    await db.insert(auditLogTable).values({
      actorId: entry.actorId,
      actorEmail: entry.actorEmail,
      actionType: entry.actionType,
      entityType: entry.entityType,
      entityId: entry.entityId,
      description: entry.description,
      changeDiff: entry.changeDiff,
      ipAddress: entry.req?.ip || entry.req?.headers["x-forwarded-for"] as string || null,
      userAgent: entry.req?.headers["user-agent"] || null,
      metadata: entry.metadata,
    });
  } catch (error) {
    console.error("[AuditLog] Failed to write audit log:", error);
  }
}

export function logAdminAction(req: Request, actionType: string, entityType: string, entityId: string | undefined, description: string, changeDiff?: Record<string, unknown>) {
  return logAuditEvent({
    actorId: req.userId,
    actorEmail: req.userEmail,
    actionType,
    entityType,
    entityId,
    description,
    changeDiff,
    req,
  });
}

/**
 * Placeholder shown in place of a member email or phone number when the
 * viewer doesn't have permission to see the original value. The Audit Log UI
 * already renders this exact string when `metadata.recipient` is missing,
 * so callers that strip the recipient from metadata get the same UI without
 * any client changes.
 */
export const REDACTED_RECIPIENT = "redacted";

type QueueFallbackRedactable = {
  actionType: string | null;
  description: string | null;
  metadata: unknown;
};

/**
 * If `row` is a queue_fallback audit row, return a copy with the recipient
 * email/phone scrubbed from both the description and the metadata so it can
 * be safely returned to viewers without the `members:pii` permission. Other
 * action types are returned unchanged.
 *
 * The audit row stays intact in the database; this function only redacts the
 * shape we hand back to the API caller, so admins with PII access can still
 * investigate after the fact.
 */
export function redactQueueFallbackPii<T extends QueueFallbackRedactable>(row: T): T {
  if (row.actionType !== "queue_fallback") return row;

  const metaObject =
    row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
      ? (row.metadata as Record<string, unknown>)
      : null;

  const recipient = metaObject?.recipient;

  // Replace the recipient inside the description (e.g. "Email queue
  // unavailable — direct-send fallback to user@example.com") via split/join
  // so we don't have to escape regex metacharacters in arbitrary email or
  // phone values.
  let description = row.description;
  if (
    typeof recipient === "string" &&
    recipient.length > 0 &&
    typeof description === "string"
  ) {
    description = description.split(recipient).join(REDACTED_RECIPIENT);
  }

  let nextMetadata: unknown = row.metadata;
  if (metaObject && "recipient" in metaObject) {
    const { recipient: _stripped, ...rest } = metaObject;
    nextMetadata = rest;
  }

  return { ...row, description, metadata: nextMetadata };
}
