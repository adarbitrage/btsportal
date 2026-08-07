/**
 * Daily digest email of Machine orders flagged as a key mismatch (task #506).
 *
 * Background: the admin External Orders page (/admin/integrations/yse?source=machine)
 * flags Machine orders whose granted product slugs disagree with the
 * `portal_product_keys` The Machine sent. Staff only see those flags if they
 * happen to open the page. The on-call alerter
 * (`machine-mismatch-alerter.ts`) pages when a wave breaches a threshold,
 * but a steady trickle of single-order mismatches is still worth a
 * human-readable nudge so ops can reconcile.
 *
 * Behavior:
 *   - Once per day (interval, default 24h) the job finds every distinct
 *     Machine order whose granted slugs vs. portal_product_keys disagree
 *     within the trailing window (default 24h, matching the cadence).
 *   - When there are zero flagged orders, the job suppresses the email
 *     entirely — ops should not get a daily "all clear" that trains them to
 *     ignore the inbox.
 *   - Otherwise a single email is sent to the configured ops distribution
 *     list (`oncall.ops_alert_email` / `OPS_ALERT_EMAIL`) with a summary
 *     table listing each order's id, buyer email, the granted slugs we
 *     wrote, the portal_product_keys The Machine sent, and a link back into
 *     the admin Integrations page so an operator can drill in.
 *   - Selection of flagged orders reuses `computeOrderMismatch` /
 *     `parsePortalProductKeys` so this digest and the admin UI / alerter
 *     can never disagree on what counts as a mismatch.
 *   - Each run writes one audit-log row (`machine_mismatch_digest`)
 *     recording the outcome (`sent` / `skipped_no_mismatches` /
 *     `skipped_no_recipient` / `skipped_sendgrid_not_configured` /
 *     `failed`) plus the matched count so admins can confirm the job is
 *     firing even on quiet days when no email is sent.
 */

import { gatedSendEmail } from "./email-transport";
import {
  db,
  userProductsTable,
  productsTable,
  webhookLogsTable,
  usersTable,
} from "@workspace/db";
import { and, desc, eq, gte, isNotNull, sql } from "drizzle-orm";
import { logAuditEvent } from "./audit-log";
import { getOnCallDestinations } from "./oncall-settings";
import { getPortalUrl } from "./portal-url-settings";
import {
  computeOrderMismatch,
  parsePortalProductKeys,
} from "./external-order-mismatch";

export const MACHINE_MISMATCH_DIGEST_ACTION_TYPE = "machine_mismatch_digest";
export const MACHINE_MISMATCH_DIGEST_ENTITY_TYPE = "digest";
export const MACHINE_MISMATCH_DIGEST_ENTITY_ID = "machine_order_mismatch_daily";

export type DigestOutcome =
  | "sent"
  | "skipped_no_mismatches"
  | "skipped_no_recipient"
  | "skipped_sendgrid_not_configured"
  | "failed";

export interface FlaggedOrder {
  externalOrderId: string;
  userEmail: string | null;
  grantedSlugs: string[];
  portalProductKeys: string[];
  mostRecentPurchasedAt: Date | null;
}

export interface DigestRunResult {
  outcome: DigestOutcome;
  windowMs: number;
  flagged: FlaggedOrder[];
  recipient: string | null;
  reason?: string;
  /** Underlying Postgres error code (e.g. "08P01"), when a DB error caused the failure. */
  dbErrorCode?: string | null;
  /** Underlying Postgres error message, when a DB error caused the failure. */
  dbErrorMessage?: string | null;
  /** How this run was initiated. */
  trigger: DigestRunTrigger;
  /** 0 for a scheduled/manual run, 1..N for backoff retries after a failure. */
  attempt: number;
}

function parseEnvInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function getRunIntervalMs(): number {
  return parseEnvInt(
    "MACHINE_MISMATCH_DIGEST_INTERVAL_MS",
    24 * 60 * 60 * 1000,
  );
}

function getWindowMs(): number {
  return parseEnvInt(
    "MACHINE_MISMATCH_DIGEST_WINDOW_MS",
    24 * 60 * 60 * 1000,
  );
}

/**
 * Short-backoff retry cadence after a `failed` run (default 15 min). The
 * production failure this recovers from (task #2117) was a transient
 * "Authentication timed out" (08P01) burst against the prod DB — without a
 * retry the digest silently waited the full 24h interval.
 */
function getRetryBackoffMs(): number {
  return parseEnvInt(
    "MACHINE_MISMATCH_DIGEST_RETRY_BACKOFF_MS",
    15 * 60 * 1000,
  );
}

/** Bounded number of backoff retries after a failed scheduled run. */
function getMaxRetries(): number {
  return parseEnvInt("MACHINE_MISMATCH_DIGEST_MAX_RETRIES", 3);
}

/**
 * Unwrap an error's `cause` chain and pull out the underlying Postgres error
 * (code + message) when present. Drizzle throws `DrizzleQueryError` whose
 * `message` is just `Failed query: <sql>` — the real database error (e.g.
 * `08P01 Authentication timed out`) rides on `err.cause`, which the previous
 * implementation dropped, making the alert email useless for diagnosis.
 */
export function describeDigestError(err: unknown): {
  reason: string;
  dbErrorCode: string | null;
  dbErrorMessage: string | null;
} {
  const topMessage =
    err instanceof Error ? err.message : String(err);
  let dbErrorCode: string | null = null;
  let dbErrorMessage: string | null = null;
  // Walk the cause chain (bounded, defensive against cycles) looking for the
  // deepest error carrying a Postgres-style string `code`.
  let cur: unknown = err;
  for (let depth = 0; depth < 10 && cur instanceof Error; depth++) {
    const next = (cur as Error & { cause?: unknown }).cause;
    if (next instanceof Error) {
      dbErrorMessage = next.message;
      const code = (next as Error & { code?: unknown }).code;
      dbErrorCode = typeof code === "string" ? code : dbErrorCode;
      cur = next;
    } else {
      break;
    }
  }
  const reason = dbErrorMessage
    ? `${topMessage} — caused by: ${dbErrorCode ? `[${dbErrorCode}] ` : ""}${dbErrorMessage}`
    : topMessage;
  return { reason, dbErrorCode, dbErrorMessage };
}

/** How a given digest run was initiated. */
export type DigestRunTrigger = "scheduled" | "retry" | "manual";

type EmailSender = (msg: {
  to: string;
  from: string;
  subject: string;
  text: string;
  html: string;
}) => Promise<void>;

let emailSenderOverride: EmailSender | null = null;

/**
 * Test-only: replace the SendGrid send call with a stub so tests can assert
 * exactly what payload would have been delivered without configuring a real
 * SendGrid key.
 */
export function __setMachineMismatchDigestSenderForTests(
  sender: EmailSender | null,
): void {
  emailSenderOverride = sender;
}

let flaggedOrdersErrorForTests: Error | null = null;

/**
 * Test-only: force the flagged-orders DB query to throw so the `failed`
 * outcome that originates from `findFlaggedOrders` (the query, before any
 * email is attempted) can be exercised against the real schema without
 * actually corrupting the database. Pass `null` to clear the override.
 */
export function __setMachineMismatchDigestQueryErrorForTests(
  err: Error | null,
): void {
  flaggedOrdersErrorForTests = err;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildAdminUrl(portalUrl: string | null): string {
  const path = "/admin/integrations/yse?source=machine";
  if (!portalUrl) return path;
  return `${portalUrl.replace(/\/+$/, "")}${path}`;
}

function buildSubject(count: number, hours: number): string {
  return `[Daily digest] ${count} Machine order${count === 1 ? "" : "s"} flagged as key mismatch in the last ${hours}h`;
}

function buildBody(
  flagged: FlaggedOrder[],
  hours: number,
  adminUrl: string,
): { text: string; html: string } {
  const intro =
    `${flagged.length} Machine order${flagged.length === 1 ? "" : "s"} in the last ${hours}h were granted product slugs that don't match the portal_product_keys The Machine sent.`;
  const cta = `Inspect them in the admin Integrations page: ${adminUrl}`;

  const textRows = flagged.map((o) => {
    const granted = o.grantedSlugs.length > 0 ? o.grantedSlugs.join(", ") : "(none)";
    const expected =
      o.portalProductKeys.length > 0 ? o.portalProductKeys.join(", ") : "(none)";
    const buyer = o.userEmail ?? "(unknown)";
    return `- ${o.externalOrderId}\n    buyer: ${buyer}\n    granted slugs: ${granted}\n    portal_product_keys: ${expected}`;
  });
  const text = [intro, "", ...textRows, "", cta].join("\n");

  const escapedUrl = escapeHtml(adminUrl);
  const htmlRows = flagged
    .map((o) => {
      const granted =
        o.grantedSlugs.length > 0 ? o.grantedSlugs.join(", ") : "(none)";
      const expected =
        o.portalProductKeys.length > 0
          ? o.portalProductKeys.join(", ")
          : "(none)";
      const buyer = o.userEmail ?? "(unknown)";
      return [
        "<tr>",
        `<td style="padding:6px 10px;border:1px solid #ddd;font-family:monospace;">${escapeHtml(o.externalOrderId)}</td>`,
        `<td style="padding:6px 10px;border:1px solid #ddd;">${escapeHtml(buyer)}</td>`,
        `<td style="padding:6px 10px;border:1px solid #ddd;font-family:monospace;">${escapeHtml(granted)}</td>`,
        `<td style="padding:6px 10px;border:1px solid #ddd;font-family:monospace;">${escapeHtml(expected)}</td>`,
        "</tr>",
      ].join("");
    })
    .join("");
  const html = [
    `<p>${escapeHtml(intro)}</p>`,
    '<table style="border-collapse:collapse;border:1px solid #ddd;">',
    "<thead><tr>",
    '<th style="padding:6px 10px;border:1px solid #ddd;text-align:left;">Order ID</th>',
    '<th style="padding:6px 10px;border:1px solid #ddd;text-align:left;">Buyer</th>',
    '<th style="padding:6px 10px;border:1px solid #ddd;text-align:left;">Granted slugs</th>',
    '<th style="padding:6px 10px;border:1px solid #ddd;text-align:left;">portal_product_keys</th>',
    "</tr></thead>",
    `<tbody>${htmlRows}</tbody>`,
    "</table>",
    `<p>Inspect them in the admin Integrations page: <a href="${escapedUrl}">${escapedUrl}</a></p>`,
  ].join("");

  return { text, html };
}

/**
 * Find every distinct Machine order in the trailing window whose granted
 * product slugs disagree with the captured portal_product_keys. Mirrors the
 * shape used by the alerter and the admin Integrations endpoint so the three
 * consumers can never disagree on what counts as flagged.
 */
async function findFlaggedOrders(
  windowMs: number,
  now: number,
): Promise<FlaggedOrder[]> {
  if (flaggedOrdersErrorForTests) {
    throw flaggedOrdersErrorForTests;
  }
  const since = new Date(now - windowMs);
  type Row = {
    externalOrderId: string;
    userEmail: string | null;
    grantedSlugs: string[] | null;
    portalProductKeys: unknown;
    mostRecentPurchasedAt: Date | null;
  };
  const webhookExternalId = sql<string>`'machine_' || ${userProductsTable.externalOrderId}`;
  const rows = (await db
    .select({
      externalOrderId: userProductsTable.externalOrderId,
      userEmail: sql<string | null>`max(${usersTable.email})`,
      grantedSlugs: sql<string[]>`array_remove(array_agg(distinct ${productsTable.slug}), null)`,
      portalProductKeys: sql<unknown>`max((${webhookLogsTable.payload} -> 'metadata' -> 'portal_product_keys')::text)`,
      mostRecentPurchasedAt: sql<Date>`max(${userProductsTable.purchasedAt})`,
    })
    .from(userProductsTable)
    .innerJoin(productsTable, eq(userProductsTable.productId, productsTable.id))
    .leftJoin(usersTable, eq(userProductsTable.userId, usersTable.id))
    .leftJoin(
      webhookLogsTable,
      eq(webhookLogsTable.externalId, webhookExternalId),
    )
    .where(
      and(
        eq(userProductsTable.externalSource, "machine"),
        isNotNull(userProductsTable.externalOrderId),
        gte(userProductsTable.purchasedAt, since),
      ),
    )
    .groupBy(userProductsTable.externalOrderId)
    .orderBy(desc(sql`max(${userProductsTable.purchasedAt})`))) as Row[];

  const flagged: FlaggedOrder[] = [];
  for (const r of rows) {
    const granted = Array.isArray(r.grantedSlugs) ? r.grantedSlugs : [];
    const portalKeys = parsePortalProductKeys(r.portalProductKeys);
    if (computeOrderMismatch("machine", granted, portalKeys)) {
      flagged.push({
        externalOrderId: r.externalOrderId,
        userEmail: r.userEmail ?? null,
        grantedSlugs: granted,
        portalProductKeys: portalKeys,
        mostRecentPurchasedAt: r.mostRecentPurchasedAt
          ? new Date(r.mostRecentPurchasedAt)
          : null,
      });
    }
  }
  return flagged;
}

/**
 * Per-job heartbeat tracking surfaced on the admin System Health page so
 * on-call can confirm the digest is firing and see whether the most recent
 * attempt sent, was suppressed, or failed — without having to grep the
 * audit log. Updated unconditionally at the end of every `runMachineMismatchDigest`
 * call (success or failure) so a job that started silently throwing still
 * shows up here via a stale `lastRanAt`.
 */
interface DigestRunState {
  lastRanAt: Date;
  lastOutcome: DigestOutcome;
  lastFlaggedCount: number;
  lastRecipient: string | null;
  lastReason: string | null;
  lastDbErrorCode: string | null;
  lastTrigger: DigestRunTrigger;
  lastAttempt: number;
}

let lastRun: DigestRunState | null = null;

// Baseline used to compute staleness when the job has not yet reported a
// run. Set at module load — which in production is process start, the same
// moment `startMachineMismatchDigestJob` would have started scheduling. If
// no run shows up after 2 intervals from this baseline, the System Health
// panel surfaces it as stale instead of leaving it on "Pending" forever.
// Mirrors the cold-start handling in `email-change-attempts-cleanup` and
// `abuse-rate-limit-cleanup` so on-call only has to learn one rule.
let baselineSince: Date = new Date();

function recordHeartbeat(result: DigestRunResult): void {
  lastRun = {
    lastRanAt: new Date(),
    lastOutcome: result.outcome,
    lastFlaggedCount: result.flagged.length,
    lastRecipient: result.recipient,
    lastReason: result.reason ?? null,
    lastDbErrorCode: result.dbErrorCode ?? null,
    lastTrigger: result.trigger,
    lastAttempt: result.attempt,
  };
}

export interface MachineMismatchDigestStatus {
  /** Run cadence in ms — UI uses this to flag a stale heartbeat (> 2× interval). */
  intervalMs: number;
  lastRanAt: string | null;
  lastOutcome: DigestOutcome | null;
  lastFlaggedCount: number | null;
  lastRecipient: string | null;
  lastReason: string | null;
  /** Underlying Postgres error code of the last failure (e.g. "08P01"), if any. */
  lastDbErrorCode: string | null;
  /** How the last run was initiated (scheduled / retry / manual). */
  lastTrigger: DigestRunTrigger | null;
  /** 0 for a scheduled/manual run, 1..N for backoff retries after a failure. */
  lastAttempt: number | null;
  /** ISO timestamp of the next scheduled backoff retry, when one is pending. */
  nextRetryAt: string | null;
  /**
   * True when the heartbeat is older than 2× `intervalMs` — i.e. the job has
   * silently stopped firing. On a cold start (no run yet) this is computed
   * against the module-load baseline, matching `emailChangeAttemptsCleanup`
   * and `abuseRateLimitCleanup` so a never-running job still trips the alarm.
   */
  stale: boolean;
}

/**
 * Snapshot of the most recent digest run for the admin System Health page.
 * Returns nulls (with the cadence still populated) when the job has not yet
 * fired in this process so the UI can render a "Pending" placeholder.
 */
export function getMachineMismatchDigestStatus(): MachineMismatchDigestStatus {
  const intervalMs = getRunIntervalMs();
  // When the job has never reported a run we fall back to the module-load
  // baseline: if the process has been up longer than 2 intervals without a
  // single digest landing, that is itself a regression worth surfacing.
  const referenceTs = (lastRun?.lastRanAt ?? baselineSince).getTime();
  const stale = Date.now() - referenceTs > 2 * intervalMs;
  return {
    intervalMs,
    lastRanAt: lastRun ? lastRun.lastRanAt.toISOString() : null,
    lastOutcome: lastRun ? lastRun.lastOutcome : null,
    lastFlaggedCount: lastRun ? lastRun.lastFlaggedCount : null,
    lastRecipient: lastRun ? lastRun.lastRecipient : null,
    lastReason: lastRun ? lastRun.lastReason : null,
    lastDbErrorCode: lastRun ? lastRun.lastDbErrorCode : null,
    lastTrigger: lastRun ? lastRun.lastTrigger : null,
    lastAttempt: lastRun ? lastRun.lastAttempt : null,
    nextRetryAt: nextRetryAt ? nextRetryAt.toISOString() : null,
    stale,
  };
}

/** Test hook: reset the heartbeat state. Not intended for production use. */
export function __resetMachineMismatchDigestStateForTests(): void {
  lastRun = null;
  baselineSince = new Date();
  clearPendingRetry();
}

async function recordRun(result: DigestRunResult): Promise<void> {
  recordHeartbeat(result);
  try {
    await logAuditEvent({
      actionType: MACHINE_MISMATCH_DIGEST_ACTION_TYPE,
      entityType: MACHINE_MISMATCH_DIGEST_ENTITY_TYPE,
      entityId: MACHINE_MISMATCH_DIGEST_ENTITY_ID,
      description: `Machine order mismatch daily digest — ${result.outcome} (${result.flagged.length} flagged)`,
      metadata: {
        outcome: result.outcome,
        flaggedCount: result.flagged.length,
        windowMs: result.windowMs,
        recipient: result.recipient,
        reason: result.reason ?? null,
        dbErrorCode: result.dbErrorCode ?? null,
        dbErrorMessage: result.dbErrorMessage ?? null,
        trigger: result.trigger,
        attempt: result.attempt,
        sampleOrderIds: result.flagged
          .slice(0, 10)
          .map((o) => o.externalOrderId),
      },
    });
  } catch (err) {
    console.error(
      "[MachineMismatchDigest] failed to write audit row:",
      err,
    );
  }
}

/**
 * Run the digest once. Exposed for tests and any future on-demand admin
 * trigger; the scheduled job calls this on its interval.
 */
export interface DigestRunOptions {
  trigger?: DigestRunTrigger;
  /** 0 for a scheduled/manual run, 1..N for backoff retries after a failure. */
  attempt?: number;
}

export async function runMachineMismatchDigest(
  now: number = Date.now(),
  opts: DigestRunOptions = {},
): Promise<DigestRunResult> {
  const trigger = opts.trigger ?? "scheduled";
  const attempt = opts.attempt ?? 0;
  const windowMs = getWindowMs();
  let flagged: FlaggedOrder[];
  try {
    flagged = await findFlaggedOrders(windowMs, now);
  } catch (err) {
    const { reason, dbErrorCode, dbErrorMessage } = describeDigestError(err);
    console.error(
      "[MachineMismatchDigest] flagged-orders query failed:",
      err,
    );
    const result: DigestRunResult = {
      outcome: "failed",
      windowMs,
      flagged: [],
      recipient: null,
      reason,
      dbErrorCode,
      dbErrorMessage,
      trigger,
      attempt,
    };
    await recordRun(result);
    return result;
  }

  // Any run that gets past the query proves the DB is reachable again — a
  // pending backoff retry (from a previous failed scheduled run) is obsolete.
  clearPendingRetry();

  if (flagged.length === 0) {
    const result: DigestRunResult = {
      outcome: "skipped_no_mismatches",
      windowMs,
      flagged: [],
      recipient: null,
      trigger,
      attempt,
    };
    await recordRun(result);
    return result;
  }

  const dest = await getOnCallDestinations();
  const to = dest.opsAlertEmail;
  if (!to) {
    const result: DigestRunResult = {
      outcome: "skipped_no_recipient",
      windowMs,
      flagged,
      recipient: null,
      trigger,
      attempt,
    };
    await recordRun(result);
    return result;
  }

  if (!emailSenderOverride && !process.env.SENDGRID_API_KEY) {
    const result: DigestRunResult = {
      outcome: "skipped_sendgrid_not_configured",
      windowMs,
      flagged,
      recipient: to,
      trigger,
      attempt,
    };
    await recordRun(result);
    return result;
  }

  const from =
    process.env.OPS_ALERT_FROM_EMAIL ??
    process.env.FROM_EMAIL ??
    "noreply@buildtestscale.com";
  const hours = Math.round(windowMs / (60 * 60 * 1000));
  const portalUrl = await getPortalUrl().catch(() => null);
  const adminUrl = buildAdminUrl(portalUrl);
  const subject = buildSubject(flagged.length, hours);
  const { text, html } = buildBody(flagged, hours, adminUrl);

  try {
    if (emailSenderOverride) {
      await emailSenderOverride({ to, from, subject, text, html });
    } else {
      await gatedSendEmail({ to, from, subject, text, html });
    }
  } catch (err) {
    const { reason, dbErrorCode, dbErrorMessage } = describeDigestError(err);
    console.error("[MachineMismatchDigest] email send failed:", err);
    const result: DigestRunResult = {
      outcome: "failed",
      windowMs,
      flagged,
      recipient: to,
      reason,
      dbErrorCode,
      dbErrorMessage,
      trigger,
      attempt,
    };
    await recordRun(result);
    return result;
  }

  const result: DigestRunResult = {
    outcome: "sent",
    windowMs,
    flagged,
    recipient: to,
    trigger,
    attempt,
  };
  await recordRun(result);
  return result;
}

let jobInterval: ReturnType<typeof setInterval> | null = null;
let started = false;

// ---------------------------------------------------------------------------
// Failure retry backoff (task #2117). A failed run used to silently wait the
// full 24h interval; now a scheduled run that fails retries on a short
// backoff (default 15 min, bounded attempts) so a transient DB error — like
// the production "Authentication timed out" (08P01) burst — self-heals.
// ---------------------------------------------------------------------------

let retryTimer: ReturnType<typeof setTimeout> | null = null;
/** When the pending backoff retry will fire; null when none is pending. */
let nextRetryAt: Date | null = null;

function clearPendingRetry(): void {
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
  nextRetryAt = null;
}

function scheduleRetry(attempt: number): void {
  clearPendingRetry();
  const backoffMs = getRetryBackoffMs();
  if (backoffMs <= 0) return;
  nextRetryAt = new Date(Date.now() + backoffMs);
  console.log(
    `[MachineMismatchDigest] scheduling retry attempt ${attempt}/${getMaxRetries()} in ${Math.round(backoffMs / 1000)}s`,
  );
  retryTimer = setTimeout(() => {
    retryTimer = null;
    nextRetryAt = null;
    void runScheduledDigestAttempt("retry", attempt);
  }, backoffMs);
  retryTimer.unref?.();
}

/**
 * Run one scheduled (or backoff-retry) attempt and, on a `failed` outcome,
 * chain the next bounded backoff retry. Exported for tests; the interval and
 * the retry timer both funnel through here so the heartbeat's trigger/attempt
 * bookkeeping stays honest.
 */
export async function runScheduledDigestAttempt(
  trigger: "scheduled" | "retry",
  attempt: number = 0,
): Promise<DigestRunResult | null> {
  try {
    const result = await runMachineMismatchDigest(Date.now(), {
      trigger,
      attempt,
    });
    if (result.outcome === "failed") {
      if (attempt < getMaxRetries()) {
        scheduleRetry(attempt + 1);
      } else {
        console.error(
          `[MachineMismatchDigest] giving up after ${attempt} backoff retries; next attempt at the regular interval`,
        );
      }
    }
    return result;
  } catch (err) {
    // runMachineMismatchDigest handles its own failures; this only guards
    // truly unexpected throws (e.g. audit plumbing) so the timer never dies.
    console.error("[MachineMismatchDigest] scheduled run error:", err);
    return null;
  }
}

export function startMachineMismatchDigestJob(): void {
  if (started) return;
  started = true;
  const intervalMs = getRunIntervalMs();
  if (intervalMs <= 0) return;
  jobInterval = setInterval(() => {
    // A fresh interval tick supersedes any pending backoff retry.
    clearPendingRetry();
    void runScheduledDigestAttempt("scheduled", 0);
  }, intervalMs);
  jobInterval.unref?.();
  console.log(
    `[MachineMismatchDigest] Started daily digest job (every ${Math.round(intervalMs / (60 * 1000))}m)`,
  );
}

export function stopMachineMismatchDigestJob(): void {
  if (jobInterval) {
    clearInterval(jobInterval);
    jobInterval = null;
  }
  clearPendingRetry();
  started = false;
}

/** Test hook: read the pending-retry schedule without mutating it. */
export function __getMachineMismatchDigestRetryStateForTests(): {
  nextRetryAt: Date | null;
  hasTimer: boolean;
} {
  return { nextRetryAt, hasTimer: retryTimer !== null };
}
