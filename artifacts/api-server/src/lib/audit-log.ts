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
  /**
   * Explicit override for the ipAddress column. Takes precedence over
   * `req?.ip`, so callers that have the IP but no Request (e.g. a
   * fire-and-forget worker that received the IP through its params)
   * can populate the column without faking a Request shape.
   */
  ipAddress?: string | null;
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
      ipAddress:
        entry.ipAddress !== undefined
          ? entry.ipAddress
          : entry.req?.ip || (entry.req?.headers["x-forwarded-for"] as string) || null,
      userAgent: entry.req?.headers["user-agent"] || null,
      metadata: entry.metadata,
    });
  } catch (error) {
    console.error("[AuditLog] Failed to write audit log:", error);
  }
}

export function logAdminAction(
  req: Request,
  actionType: string,
  entityType: string,
  entityId: string | undefined,
  description: string,
  changeDiff?: Record<string, unknown>,
  metadata?: Record<string, unknown>,
) {
  return logAuditEvent({
    actorId: req.userId,
    actorEmail: req.userEmail,
    actionType,
    entityType,
    entityId,
    description,
    changeDiff,
    metadata,
    req,
  });
}

/**
 * Placeholder shown in place of a member email, name, phone number, or other
 * direct PII when the viewer doesn't have permission to see the original
 * value. The Audit Log UI already renders this exact string when
 * `metadata.recipient` is missing, so callers that strip the recipient from
 * metadata get the same UI without any client changes.
 */
export const REDACTED_RECIPIENT = "redacted";

/**
 * Per-action-type description rewriters that scrub the PII portion of a
 * known description template by anchored regex match — i.e. they don't need
 * the call site to also pass the PII as structured metadata. This is the
 * primary defense and is what guarantees historical rows (written before
 * the structured-field plumbing existed) get redacted too.
 *
 * Each rewriter:
 *  - is anchored to the exact template the writer emits, so non-conforming
 *    descriptions pass through unchanged (we'd rather miss a redaction on
 *    an unexpected description than rewrite something we didn't mean to);
 *  - replaces each PII capture with REDACTED_RECIPIENT;
 *  - is idempotent: applying it twice is a no-op (running it on an
 *    already-redacted description returns the same string).
 *
 * The set of keys here also defines PII_BEARING_ACTION_TYPES below — any
 * action type with a rewriter is treated as PII-bearing for the purposes
 * of metadata/changeDiff scrubbing.
 */
const DESCRIPTION_REWRITERS: Record<string, (description: string) => string> = {
  // "Email queue unavailable — direct-send fallback to user@example.com"
  // "SMS queue unavailable — direct-send fallback to +15551234567"
  queue_fallback: (d) =>
    d.replace(
      /^(.+ direct-send fallback to ).+$/,
      `$1${REDACTED_RECIPIENT}`,
    ),
  // "Admin started impersonating member Jane Doe (jane@example.com)"
  // The greedy `.+ \(` lets a name containing parens still get matched —
  // the LAST `(...)` on the line is treated as the email tuple.
  impersonate_start: (d) =>
    d.replace(
      /^(Admin started impersonating member ).+ \(.+\)$/,
      `$1${REDACTED_RECIPIENT} (${REDACTED_RECIPIENT})`,
    ),
  // "Regenerated Flexy password for member jane@example.com"
  regenerate_password: (d) =>
    d.replace(
      /^(Regenerated Flexy password for member ).+$/,
      `$1${REDACTED_RECIPIENT}`,
    ),
  // "Sent new Flexy password to member jane@example.com via email=sent, sms=..."
  notify_password: (d) =>
    d.replace(
      /^(Sent new Flexy password to member ).+?( via .+)$/,
      `$1${REDACTED_RECIPIENT}$2`,
    ),
  // "Cancelled pending email change for member jane@example.com (was: new@example.com)"
  cancel_email_change: (d) =>
    d.replace(
      /^(Cancelled pending email change for member ).+?( \(was: ).+?(\))$/,
      `$1${REDACTED_RECIPIENT}$2${REDACTED_RECIPIENT}$3`,
    ),
  // "Member requested email change from jane@example.com to new-jane@example.com"
  request_email_change: (d) =>
    d.replace(
      /^(Member requested email change from ).+?( to ).+$/,
      `$1${REDACTED_RECIPIENT}$2${REDACTED_RECIPIENT}`,
    ),
  // "Member confirmed email change from jane@example.com to new-jane@example.com"
  confirm_email_change: (d) =>
    d.replace(
      /^(Member confirmed email change from ).+?( to ).+$/,
      `$1${REDACTED_RECIPIENT}$2${REDACTED_RECIPIENT}`,
    ),
  // "Unlocked account for member jane@example.com (cleared lockedUntil and failedLoginCount)"
  unlock_account: (d) =>
    d.replace(
      /^(Unlocked account for member ).+?( \(cleared .+)$/,
      `$1${REDACTED_RECIPIENT}$2`,
    ),
  // "Created member jane@example.com via admin panel (sent password_reset email)"
  create_member: (d) =>
    d.replace(
      /^(Created member ).+?( via admin panel .+)$/,
      `$1${REDACTED_RECIPIENT}$2`,
    ),
  // "Resent password-setup email to member jane@example.com"
  resend_invite: (d) =>
    d.replace(
      /^(Resent password-setup email to member ).+$/,
      `$1${REDACTED_RECIPIENT}`,
    ),
};

const PII_BEARING_ACTION_TYPES = new Set<string>(
  Object.keys(DESCRIPTION_REWRITERS),
);

/**
 * Keys on `metadata` and `changeDiff` whose values are member PII. These
 * are stripped recursively from the returned `metadata` / `changeDiff` for
 * non-PII viewers so the expanded row doesn't leak the values either —
 * critical for nested blobs like `cancel_email_change`'s
 * `{ before: { pendingEmail: "..." }, after: { pendingEmail: null } }`,
 * where the real email lives one level below the top.
 *
 * Newer call sites also surface the PII at top level (e.g. `memberEmail`)
 * so the redactor has a structured handle, but the description rewriters
 * above handle redaction independently — i.e. legacy rows that lack these
 * keys are still scrubbed at the description layer.
 */
const PII_KEYS: ReadonlySet<string> = new Set([
  "recipient",
  "memberEmail",
  "memberName",
  "memberPhone",
  "previousPendingEmail",
  // Nested under cancel_email_change's before/after: the user's pending
  // email-change target. Same PII risk as `memberEmail`.
  "pendingEmail",
  // Surfaced by request_email_change / confirm_email_change so the panel
  // can show the addresses inline. Same PII risk as `memberEmail`.
  "newEmail",
  "oldEmail",
]);

type RedactableRow = {
  actionType: string | null;
  description: string | null;
  metadata: unknown;
  changeDiff?: unknown;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Recursively walks a JSON-shaped value and drops any key in PII_KEYS at
 * every nesting level. Arrays are walked element-by-element; primitives
 * are returned unchanged. The original value is not mutated.
 */
function deepStripPiiKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(deepStripPiiKeys);
  }
  if (isPlainObject(value)) {
    const next: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value)) {
      if (PII_KEYS.has(key)) continue;
      next[key] = deepStripPiiKeys(v);
    }
    return next;
  }
  return value;
}

/**
 * If `row` carries member PII in its description or structured fields,
 * return a copy with the email/name/phone scrubbed from the description and
 * stripped from `metadata` / `changeDiff`, so it can be safely returned to
 * viewers without the `members:pii` permission. Other action types are
 * returned unchanged (by reference).
 *
 * Redaction has two layers that run together:
 *  1. A per-action-type description rewriter (regex on a known template).
 *     This is what catches historical rows that were written before the
 *     call sites started passing PII as structured fields.
 *  2. Stripping known PII keys (memberEmail, memberName, recipient, ...)
 *     from `metadata` and `changeDiff` so the expanded row also doesn't
 *     leak them.
 *
 * The audit row stays intact in the database; this function only redacts
 * the shape we hand back to the API caller, so admins with PII access can
 * still investigate after the fact.
 */
export function redactAuditRowPii<T extends RedactableRow>(row: T): T {
  if (!row.actionType || !PII_BEARING_ACTION_TYPES.has(row.actionType)) {
    return row;
  }

  const rewriter = DESCRIPTION_REWRITERS[row.actionType];
  let description = row.description;
  if (typeof description === "string" && rewriter) {
    description = rewriter(description);
  }

  // Recursively scrub the structured fields too. Going deep matters
  // because some action types (notably `cancel_email_change`) put the
  // member's email inside nested before/after blobs — top-level key
  // stripping alone would still leak PII via `changeDiff.before.pendingEmail`.
  const nextMetadata: unknown = deepStripPiiKeys(row.metadata);
  const nextChangeDiff: unknown = deepStripPiiKeys(row.changeDiff);

  // Preserve the original key shape: only set `changeDiff` on the result
  // if the input row had it (callers that pass `RedactableRow` without a
  // changeDiff key shouldn't get one synthesised onto their result).
  if ("changeDiff" in row) {
    return { ...row, description, metadata: nextMetadata, changeDiff: nextChangeDiff };
  }
  return { ...row, description, metadata: nextMetadata };
}

/**
 * Backwards-compatible alias for the original queue-fallback-only redactor.
 * New code should prefer {@link redactAuditRowPii}; this export remains so
 * callers / tests that still reference the old name keep compiling.
 *
 * @deprecated Use {@link redactAuditRowPii} instead — it covers
 * queue_fallback rows AND the other admin-action rows that embed member
 * PII in their description.
 */
export const redactQueueFallbackPii = redactAuditRowPii;
