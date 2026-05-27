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

import sgMail from "@sendgrid/mail";
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

let sgMailInitialized = false;

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
}

let lastRun: DigestRunState | null = null;

function recordHeartbeat(result: DigestRunResult): void {
  lastRun = {
    lastRanAt: new Date(),
    lastOutcome: result.outcome,
    lastFlaggedCount: result.flagged.length,
    lastRecipient: result.recipient,
    lastReason: result.reason ?? null,
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
}

/**
 * Snapshot of the most recent digest run for the admin System Health page.
 * Returns nulls (with the cadence still populated) when the job has not yet
 * fired in this process so the UI can render a "Pending" placeholder.
 */
export function getMachineMismatchDigestStatus(): MachineMismatchDigestStatus {
  return {
    intervalMs: getRunIntervalMs(),
    lastRanAt: lastRun ? lastRun.lastRanAt.toISOString() : null,
    lastOutcome: lastRun ? lastRun.lastOutcome : null,
    lastFlaggedCount: lastRun ? lastRun.lastFlaggedCount : null,
    lastRecipient: lastRun ? lastRun.lastRecipient : null,
    lastReason: lastRun ? lastRun.lastReason : null,
  };
}

/** Test hook: reset the heartbeat state. Not intended for production use. */
export function __resetMachineMismatchDigestStateForTests(): void {
  lastRun = null;
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
export async function runMachineMismatchDigest(
  now: number = Date.now(),
): Promise<DigestRunResult> {
  const windowMs = getWindowMs();
  let flagged: FlaggedOrder[];
  try {
    flagged = await findFlaggedOrders(windowMs, now);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
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
    };
    await recordRun(result);
    return result;
  }

  if (flagged.length === 0) {
    const result: DigestRunResult = {
      outcome: "skipped_no_mismatches",
      windowMs,
      flagged: [],
      recipient: null,
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
      if (!sgMailInitialized) {
        sgMail.setApiKey(process.env.SENDGRID_API_KEY as string);
        sgMailInitialized = true;
      }
      await sgMail.send({ to, from, subject, text, html });
    }
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error("[MachineMismatchDigest] email send failed:", err);
    const result: DigestRunResult = {
      outcome: "failed",
      windowMs,
      flagged,
      recipient: to,
      reason,
    };
    await recordRun(result);
    return result;
  }

  const result: DigestRunResult = {
    outcome: "sent",
    windowMs,
    flagged,
    recipient: to,
  };
  await recordRun(result);
  return result;
}

let jobInterval: ReturnType<typeof setInterval> | null = null;
let started = false;

export function startMachineMismatchDigestJob(): void {
  if (started) return;
  started = true;
  const intervalMs = getRunIntervalMs();
  if (intervalMs <= 0) return;
  jobInterval = setInterval(() => {
    runMachineMismatchDigest().catch((err) => {
      console.error("[MachineMismatchDigest] scheduled run error:", err);
    });
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
  started = false;
}
