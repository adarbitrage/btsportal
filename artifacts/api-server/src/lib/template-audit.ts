import crypto from "node:crypto";

/**
 * Audit-log shape for email/SMS template create/update/delete writes.
 *
 * These rows are surfaced by the Communications Log detail dialog so support
 * can see "did someone edit this template right before the send?" in one
 * click, and they're filterable on the Audit Log page so admins can audit
 * template changes directly. They follow the same `{ before, after }`
 * `changeDiff` shape as other admin update rows (e.g. `update` on `user`).
 *
 * Match-key contract for the comms-log "related audit" lookup:
 *  - `metadata.templateSlug` is the join key against `communication_log.template_slug`
 *  - `entityType` distinguishes channel: `email_template` vs `sms_template`
 *  - `metadata.channel` mirrors the entityType ("email" / "sms") so audit-log
 *    consumers don't need to know the entity-type→channel mapping
 */
export const TEMPLATE_CREATE_ACTION_TYPE = "template_create";
export const TEMPLATE_UPDATE_ACTION_TYPE = "template_update";
export const TEMPLATE_DELETE_ACTION_TYPE = "template_delete";

export const TEMPLATE_AUDIT_ACTION_TYPES = [
  TEMPLATE_CREATE_ACTION_TYPE,
  TEMPLATE_UPDATE_ACTION_TYPE,
  TEMPLATE_DELETE_ACTION_TYPE,
] as const;

export const EMAIL_TEMPLATE_ENTITY_TYPE = "email_template";
export const SMS_TEMPLATE_ENTITY_TYPE = "sms_template";

/**
 * Long body fields are stored as a `{ length, sha256 }` summary in
 * changeDiff so the audit log doesn't bloat with full HTML/text bodies on
 * every save. The shorter scalar fields (slug, name, subject, etc.) are
 * stored verbatim so admins can read the actual change inline.
 *
 * Threshold is small enough that any realistic email/SMS body summarises,
 * and big enough that short single-line fields like subject never get
 * hashed instead of shown.
 */
const BODY_SUMMARY_THRESHOLD = 256;

export type BodySummary = { length: number; sha256: string };

export function summarizeBody(value: unknown): unknown {
  if (typeof value !== "string") return value;
  if (value.length < BODY_SUMMARY_THRESHOLD) return value;
  const hash = crypto.createHash("sha256").update(value).digest("hex").slice(0, 12);
  return { length: value.length, sha256: hash } satisfies BodySummary;
}

/**
 * Deep-equality check that treats arrays/objects as equal when their JSON
 * serialisation matches. Good enough for the simple jsonb shapes we store
 * on template rows (string[] for `variables`).
 */
function isEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Compute a `{ before, after, changedFields }` diff over the named fields
 * of two row snapshots. Long body fields (htmlBody, textBody, body) are
 * replaced with `{ length, sha256 }` summaries in the returned diff so the
 * audit row stays compact.
 *
 * Only fields that actually changed appear in `before`/`after`; this keeps
 * the diff focused so an admin reading the audit log can see at a glance
 * what was touched.
 */
export function diffTemplateFields<T extends Record<string, unknown>>(
  before: T,
  after: Partial<T>,
  fields: readonly (keyof T)[],
): { before: Partial<T>; after: Partial<T>; changedFields: string[] } {
  const beforeDiff: Partial<T> = {};
  const afterDiff: Partial<T> = {};
  const changedFields: string[] = [];
  for (const field of fields) {
    if (!(field in after)) continue;
    const beforeValue = before[field];
    const afterValue = after[field];
    if (isEqual(beforeValue, afterValue)) continue;
    beforeDiff[field] = summarizeBody(beforeValue) as T[keyof T];
    afterDiff[field] = summarizeBody(afterValue) as T[keyof T];
    changedFields.push(String(field));
  }
  return { before: beforeDiff, after: afterDiff, changedFields };
}

/**
 * Snapshot a template row for the `{ before }` (delete) or `{ after }`
 * (create) side of an audit diff, with long body fields summarised.
 */
export function snapshotTemplateForDiff<T extends Record<string, unknown>>(
  row: T,
  fields: readonly (keyof T)[],
): Partial<T> {
  const out: Partial<T> = {};
  for (const field of fields) {
    out[field] = summarizeBody(row[field]) as T[keyof T];
  }
  return out;
}

export const EMAIL_TEMPLATE_DIFF_FIELDS = [
  "slug",
  "name",
  "subject",
  "htmlBody",
  "textBody",
  "category",
  "fromName",
  "variables",
  "active",
] as const;

export const SMS_TEMPLATE_DIFF_FIELDS = [
  "slug",
  "name",
  "body",
  "variables",
  "active",
] as const;
