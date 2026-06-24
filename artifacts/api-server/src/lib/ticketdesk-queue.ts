/**
 * BullMQ queue for async, non-blocking TicketDesk conversation delivery.
 *
 * Mirrors the GHL sync queue pattern so TicketDesk outages never slow or
 * fail a member's ticket-create request.  Jobs retry up to MAX_ATTEMPTS
 * times with exponential back-off.
 *
 * Delivery outcome tracking
 * ─────────────────────────
 * Every ticket carries a `delivery_status` column that this module writes
 * after each terminal outcome:
 *   - 'delivered'  Job succeeded — TicketDesk accepted the conversation.
 *   - 'skipped'    TICKETDESK_API_KEY is absent; no delivery attempted.
 *   - 'failed'     All MAX_ATTEMPTS retries exhausted without success.
 *
 * For 'skipped' and 'failed' outcomes a fallback notification email is sent
 * to the configured support inbox (SUPPORT_INBOX_EMAIL env var) so the team
 * always has visibility into member requests even when TicketDesk is
 * unreachable or unconfigured.
 *
 * Queue is disabled (no-op) in test environments without an explicit
 * REDIS_URL — same guard used by the GHL queue to keep unit tests clean.
 */

import { Queue, Worker, type Job, type ConnectionOptions } from "bullmq";
import IORedis from "ioredis";
import sgMail from "@sendgrid/mail";
import * as ticketDesk from "./ticketdesk-client";
import { type TicketDeskConversationInput } from "./ticketdesk-client";
import { QUEUE_REDIS_OPTIONS, makeThrottledRedisErrorLogger } from "./redis";
import { db, ticketsTable, usersTable, ticketMessagesTable } from "@workspace/db";
import { eq, and, isNull, isNotNull, lt, asc, desc, inArray, sql } from "drizzle-orm";

const EXPLICIT_REDIS_URL = process.env.REDIS_URL;
const REDIS_URL = EXPLICIT_REDIS_URL || "redis://localhost:6379";
const QUEUE_NAME = "ticketdesk-delivery";
const MAX_ATTEMPTS = 5;
const BASE_DELAY = 30_000;

const IS_TEST_ENV =
  process.env.NODE_ENV === "test" || process.env.VITEST === "true";
const QUEUE_DISABLED = IS_TEST_ENV && !EXPLICIT_REDIS_URL;

const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY || "";
const FROM_EMAIL_TRANSACTIONAL =
  process.env.FROM_EMAIL_TRANSACTIONAL || "noreply@buildtestscale.com";
const FROM_NAME_DEFAULT = process.env.FROM_NAME_DEFAULT || "Build Test Scale";

/**
 * The support inbox that receives fallback notifications when TicketDesk
 * delivery fails or is skipped.  Operators can set this independently from
 * the transactional "from" address so a monitored shared mailbox receives
 * the alerts.
 */
const SUPPORT_INBOX_EMAIL =
  process.env.SUPPORT_INBOX_EMAIL || "support@buildtestscale.com";

if (SENDGRID_API_KEY) {
  sgMail.setApiKey(SENDGRID_API_KEY);
}

let connection: IORedis | null = null;
let queue: Queue | null = null;
let worker: Worker | null = null;
let warnedDisabled = false;

function warnDisabledOnce(): void {
  if (warnedDisabled) return;
  warnedDisabled = true;
  console.log(
    "[TicketDesk Queue] Disabled (no REDIS_URL in test environment); jobs are no-ops.",
  );
}

function getConnection(): ConnectionOptions {
  if (!connection) {
    connection = new IORedis(REDIS_URL, { ...QUEUE_REDIS_OPTIONS });
    connection.on("error", makeThrottledRedisErrorLogger("[TicketDesk Queue]"));
  }
  return connection as unknown as ConnectionOptions;
}

function getQueue(): Queue {
  if (!queue) {
    queue = new Queue(QUEUE_NAME, {
      connection: getConnection(),
      defaultJobOptions: {
        attempts: MAX_ATTEMPTS,
        backoff: { type: "exponential", delay: BASE_DELAY },
        removeOnComplete: { count: 1000 },
        removeOnFail: { count: 5000 },
      },
    });
  }
  return queue;
}

export type TicketDeskDeliveryJobData = TicketDeskConversationInput;

/**
 * Update the delivery_status column on the ticket row.  Accepts either the
 * internal DB id (fast path) or falls back to a lookup by ticket number.
 * All errors are swallowed — a failed status write must never cascade into
 * a job failure or prevent the fallback email from going out.
 */
async function updateDeliveryStatus(
  ticketId: number | undefined,
  btsTicketNumber: string,
  status: "delivered" | "skipped" | "failed",
  errorMsg?: string,
): Promise<void> {
  try {
    const patch = {
      deliveryStatus: status,
      deliveryLastAttemptAt: new Date(),
      ...(errorMsg !== undefined
        ? { deliveryLastError: errorMsg.slice(0, 1000) }
        : {}),
    };

    if (ticketId) {
      await db
        .update(ticketsTable)
        .set(patch)
        .where(eq(ticketsTable.id, ticketId));
    } else {
      await db
        .update(ticketsTable)
        .set(patch)
        .where(eq(ticketsTable.ticketNumber, btsTicketNumber));
    }
  } catch (err) {
    console.error(
      `[TicketDesk Queue] Failed to update delivery_status for ${btsTicketNumber}:`,
      err,
    );
  }
}

/**
 * Send a plain-text/HTML notification email to the support inbox so the team
 * is aware of every member ticket that didn't make it into TicketDesk.
 *
 * Gated on:
 *   - Not running in a test environment (IS_TEST_ENV)
 *   - SENDGRID_API_KEY being present (otherwise logs a warning and returns)
 */
export async function sendSupportFallbackEmail(
  data: TicketDeskDeliveryJobData,
  reason: string,
): Promise<void> {
  if (IS_TEST_ENV) return;

  if (!SENDGRID_API_KEY) {
    console.warn(
      `[TicketDesk Queue] Cannot send fallback notification for ${data.btsTicketNumber}: SENDGRID_API_KEY not set.`,
    );
    return;
  }

  sgMail.setApiKey(SENDGRID_API_KEY);

  const subject = `[Support Ticket Not Delivered] ${data.btsTicketNumber} — ${data.subject}`;
  const text = [
    `A member support ticket was NOT delivered to TicketDesk.`,
    ``,
    `Reason: ${reason}`,
    ``,
    `Ticket number : ${data.btsTicketNumber}`,
    `Member email  : ${data.contactEmail}`,
    `Member name   : ${data.contactName}`,
    `Subject       : ${data.subject}`,
    ``,
    `--- Message body ---`,
    data.body,
    `---`,
    ``,
    `Please follow up with the member directly and/or manually create the`,
    `conversation in TicketDesk once the underlying issue is resolved.`,
  ].join("\n");

  const html = `
<p>A member support ticket was <strong>NOT delivered</strong> to TicketDesk.</p>
<p><strong>Reason:</strong> ${htmlEscape(reason)}</p>
<table style="border-collapse:collapse;margin:12px 0;">
  <tr><td style="padding:4px 12px 4px 0;font-weight:bold;color:#555;">Ticket number</td><td>${htmlEscape(data.btsTicketNumber)}</td></tr>
  <tr><td style="padding:4px 12px 4px 0;font-weight:bold;color:#555;">Member email</td><td>${htmlEscape(data.contactEmail)}</td></tr>
  <tr><td style="padding:4px 12px 4px 0;font-weight:bold;color:#555;">Member name</td><td>${htmlEscape(data.contactName)}</td></tr>
  <tr><td style="padding:4px 12px 4px 0;font-weight:bold;color:#555;">Subject</td><td>${htmlEscape(data.subject)}</td></tr>
</table>
<p><strong>Message body:</strong></p>
<pre style="background:#f5f5f5;padding:12px;border-radius:4px;white-space:pre-wrap;">${htmlEscape(data.body)}</pre>
<p style="color:#888;font-size:13px;">Please follow up with the member directly and/or manually create the conversation in TicketDesk once the underlying issue is resolved.</p>
`.trim();

  try {
    await sgMail.send({
      to: SUPPORT_INBOX_EMAIL,
      from: { email: FROM_EMAIL_TRANSACTIONAL, name: FROM_NAME_DEFAULT },
      subject,
      text,
      html,
    });
    console.log(
      `[TicketDesk Queue] Sent fallback notification for ${data.btsTicketNumber} to ${SUPPORT_INBOX_EMAIL}`,
    );
  } catch (err) {
    console.error(
      `[TicketDesk Queue] Failed to send fallback notification for ${data.btsTicketNumber}:`,
      err,
    );
  }
}

function htmlEscape(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function processJob(
  job: Job<TicketDeskDeliveryJobData>,
): Promise<void> {
  const { contactEmail, btsTicketNumber, ticketId } = job.data;
  try {
    const result = await ticketDesk.createConversation(job.data);
    console.log(
      `[TicketDesk Queue] Delivered ticket ${btsTicketNumber} for ${contactEmail} → conversation ${result.id}`,
    );
    void updateDeliveryStatus(ticketId, btsTicketNumber, "delivered");
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(
      `[TicketDesk Queue] Job ${job.id} failed (attempt ${job.attemptsMade + 1}/${MAX_ATTEMPTS}) for ticket ${btsTicketNumber}: ${msg}`,
    );
    throw error;
  }
}

/**
 * Enqueues a TicketDesk conversation delivery job.
 * Returns the job ID, or null when the queue is disabled or TicketDesk is
 * not configured (TICKETDESK_API_KEY absent).
 *
 * When TicketDesk is not configured the ticket is immediately marked as
 * 'skipped' and a fallback notification email is sent to the support inbox
 * so the team can follow up manually.
 */
export async function queueTicketDeskDelivery(
  data: TicketDeskDeliveryJobData,
): Promise<string | null> {
  if (QUEUE_DISABLED) {
    warnDisabledOnce();
    return null;
  }

  if (!ticketDesk.isConfigured()) {
    console.log(
      `[TicketDesk Queue] Skipped delivery for ${data.btsTicketNumber} — TICKETDESK_API_KEY not configured`,
    );
    void updateDeliveryStatus(data.ticketId, data.btsTicketNumber, "skipped", "TICKETDESK_API_KEY not configured");
    void sendSupportFallbackEmail(data, "TICKETDESK_API_KEY not configured — delivery skipped");
    return null;
  }

  try {
    const q = getQueue();
    const job = await q.add("create_conversation", data);
    console.log(
      `[TicketDesk Queue] Queued delivery for ticket ${data.btsTicketNumber} (job ${job.id})`,
    );
    return job.id ?? null;
  } catch (error) {
    console.error(
      `[TicketDesk Queue] Failed to enqueue delivery for ${data.btsTicketNumber}:`,
      error,
    );
    return null;
  }
}

/**
 * Re-queue (or re-attempt) TicketDesk delivery for a ticket whose previous
 * delivery failed or was skipped.  Powers the admin Ticket Queue's "Retry
 * delivery" row action and bulk retry.
 *
 * Reconstructs the original delivery payload from the ticket row, its owning
 * member, and the first member message (the same shape the create-ticket path
 * and the startup backfill build), resets the row to 'pending' (clearing the
 * stale last-error), and re-enqueues a delivery job.  Only tickets currently in
 * 'failed' or 'skipped' are retryable — anything else is a no-op so a stray
 * retry can't clobber an in-flight or already-delivered ticket.
 *
 * Returns a discriminated result the route layer can map onto an HTTP status.
 */
export type RetryDeliveryResult =
  | { ok: true }
  | { ok: false; reason: "not_found" | "not_retryable" | "enqueue_failed" };

export async function retryTicketDeskDelivery(
  ticketId: number,
): Promise<RetryDeliveryResult> {
  const [ticket] = await db
    .select({
      id: ticketsTable.id,
      ticketNumber: ticketsTable.ticketNumber,
      subject: ticketsTable.subject,
      userId: ticketsTable.userId,
      deliveryStatus: ticketsTable.deliveryStatus,
    })
    .from(ticketsTable)
    .where(eq(ticketsTable.id, ticketId))
    .limit(1);

  if (!ticket) return { ok: false, reason: "not_found" };

  if (ticket.deliveryStatus !== "failed" && ticket.deliveryStatus !== "skipped") {
    return { ok: false, reason: "not_retryable" };
  }

  let member: { email: string; name: string } | undefined;
  if (ticket.userId != null) {
    const [found] = await db
      .select({ email: usersTable.email, name: usersTable.name })
      .from(usersTable)
      .where(eq(usersTable.id, ticket.userId))
      .limit(1);
    member = found;
  }

  const [firstMsg] = await db
    .select({ body: ticketMessagesTable.body })
    .from(ticketMessagesTable)
    .where(
      and(
        eq(ticketMessagesTable.ticketId, ticket.id),
        eq(ticketMessagesTable.senderType, "member"),
      ),
    )
    .orderBy(asc(ticketMessagesTable.createdAt))
    .limit(1);

  const data: TicketDeskDeliveryJobData = {
    contactEmail: member?.email ?? "unknown",
    contactName: member?.name ?? "Unknown Member",
    subject: ticket.subject,
    body:
      firstMsg?.body ??
      "(original message not found; open the admin portal to view the full ticket)",
    btsTicketNumber: ticket.ticketNumber,
    ticketId: ticket.id,
  };

  // Reset to 'pending' and clear the stale error so the queue badge reflects
  // the in-flight retry immediately. queueTicketDeskDelivery rewrites the
  // status again on its own terminal outcome (delivered/skipped/failed).
  try {
    await db
      .update(ticketsTable)
      .set({ deliveryStatus: "pending", deliveryLastError: null })
      .where(eq(ticketsTable.id, ticket.id));
  } catch (err) {
    console.error(
      `[TicketDesk Queue] Failed to reset delivery_status for ${ticket.ticketNumber} before retry:`,
      err,
    );
  }

  const jobId = await queueTicketDeskDelivery(data);

  // queueTicketDeskDelivery returns null for three reasons: the queue is
  // disabled (test env), TicketDesk is unconfigured (handled as a 'skipped'
  // terminal outcome + support email), or the enqueue genuinely threw. Only
  // the last leaves the row stuck at 'pending' with no job — surface that as a
  // failure so the route returns a 5xx instead of a false-positive success.
  if (jobId === null && !QUEUE_DISABLED && ticketDesk.isConfigured()) {
    return { ok: false, reason: "enqueue_failed" };
  }

  return { ok: true };
}

export function startTicketDeskWorker(): void {
  if (QUEUE_DISABLED) {
    warnDisabledOnce();
    return;
  }
  if (worker) return;

  try {
    worker = new Worker(QUEUE_NAME, processJob, {
      connection: getConnection(),
      concurrency: 3,
    });

    worker.on("completed", (job) => {
      console.log(
        `[TicketDesk Worker] Job ${job.id} completed: ${job.name}`,
      );
    });

    worker.on("failed", (job, err) => {
      if (!job) return;
      console.error(
        `[TicketDesk Worker] Job ${job.id} failed: ${err.message}`,
      );

      // On the final attempt (all retries exhausted) mark the ticket as
      // permanently failed and notify the support inbox so no member
      // request is silently lost.
      const finalAttempts = job.opts?.attempts ?? MAX_ATTEMPTS;
      if (job.attemptsMade >= finalAttempts) {
        const data = job.data as TicketDeskDeliveryJobData;
        void updateDeliveryStatus(
          data.ticketId,
          data.btsTicketNumber,
          "failed",
          err.message,
        );
        void sendSupportFallbackEmail(
          data,
          `All ${finalAttempts} delivery attempts failed. Last error: ${err.message}`,
        );
      }
    });

    worker.on("error", (err) => {
      console.error("[TicketDesk Worker] Worker error:", err.message);
    });

    console.log("[TicketDesk Worker] Started processing delivery jobs");
  } catch (error) {
    console.error("[TicketDesk Worker] Failed to start worker:", error);
  }
}

/**
 * Idempotent startup backfill — finds portal tickets that were created before
 * this delivery-tracking feature was deployed (or whose queue job was dropped)
 * and sends a one-time fallback notification to the support inbox for each.
 *
 * Idempotency is guaranteed by the `delivery_last_attempt_at IS NULL` filter:
 * once a ticket has been processed (by a real queue job or this backfill) it
 * will never be re-notified.  The 15-minute cutoff ensures tickets whose queue
 * jobs are still in-flight are not prematurely declared as missed.
 */
export async function backfillUndeliveredTickets(): Promise<void> {
  if (IS_TEST_ENV) return;

  try {
    const cutoff = new Date(Date.now() - 15 * 60 * 1000);

    const stuck = await db
      .select({
        id: ticketsTable.id,
        ticketNumber: ticketsTable.ticketNumber,
        subject: ticketsTable.subject,
        userId: ticketsTable.userId,
      })
      .from(ticketsTable)
      .where(
        and(
          eq(ticketsTable.deliveryStatus, "pending"),
          isNull(ticketsTable.deliveryLastAttemptAt),
          lt(ticketsTable.createdAt, cutoff),
        ),
      );

    if (stuck.length === 0) {
      console.log("[TicketDesk Backfill] No undelivered tickets found.");
      return;
    }

    console.log(
      `[TicketDesk Backfill] Found ${stuck.length} undelivered ticket(s); sending fallback notifications.`,
    );

    for (const ticket of stuck) {
      let member: { email: string; name: string } | undefined;
      if (ticket.userId != null) {
        const [found] = await db
          .select({ email: usersTable.email, name: usersTable.name })
          .from(usersTable)
          .where(eq(usersTable.id, ticket.userId))
          .limit(1);
        member = found;
      }

      const [firstMsg] = await db
        .select({ body: ticketMessagesTable.body })
        .from(ticketMessagesTable)
        .where(
          and(
            eq(ticketMessagesTable.ticketId, ticket.id),
            eq(ticketMessagesTable.senderType, "member"),
          ),
        )
        .orderBy(asc(ticketMessagesTable.createdAt))
        .limit(1);

      const data: TicketDeskDeliveryJobData = {
        contactEmail: member?.email ?? "unknown",
        contactName: member?.name ?? "Unknown Member",
        subject: ticket.subject,
        body:
          firstMsg?.body ??
          "(original message not found; open the admin portal to view the full ticket)",
        btsTicketNumber: ticket.ticketNumber,
        ticketId: ticket.id,
      };

      await updateDeliveryStatus(
        ticket.id,
        ticket.ticketNumber,
        "skipped",
        "backfill: ticket predated delivery tracking or queue delivery was never attempted",
      );

      await sendSupportFallbackEmail(
        data,
        "Backfill: ticket was created before TicketDesk delivery tracking was enabled",
      );
    }

    console.log(
      `[TicketDesk Backfill] Processed ${stuck.length} ticket(s).`,
    );
  } catch (err) {
    console.error("[TicketDesk Backfill] Failed:", err);
  }
}

/**
 * Default age (minutes) past which an undelivered ticket is considered
 * "stuck". A ticket created more than this long ago that is still 'pending'
 * (never delivered) or has gone terminal 'failed' is a delivery the team
 * has lost visibility into. 30 min is comfortably past the exponential
 * back-off retry window (~15 min for 5 attempts), so a stuck ticket means a
 * sustained problem (whitelist expired, secret rotated, TicketDesk down)
 * rather than a transient retry in flight.
 */
export const TICKETDESK_STUCK_MINUTES_DEFAULT = 30;

export interface StuckTicketDeliveryStats {
  /** Total tickets stuck in 'pending' or 'failed' past the age cutoff. */
  count: number;
  /** Per-status breakdown of the stuck tickets. */
  byStatus: { pending: number; failed: number };
  /** ISO timestamp of the oldest stuck ticket's createdAt, or null. */
  oldestCreatedAt: string | null;
  /** Most recent delivery error recorded among the stuck tickets, or null. */
  lastError: string | null;
  /** Age threshold (minutes) used to decide a ticket is "stuck". */
  stuckMinutes: number;
}

/**
 * Counts support tickets whose TicketDesk delivery is stuck — i.e. still
 * 'pending' (never delivered) or terminal 'failed' — and that were created
 * longer than `stuckMinutes` ago. 'skipped' is excluded on purpose: it means
 * TicketDesk is intentionally unconfigured (fallback email already sent), not
 * that delivery is failing. Surfaced on System Health and consumed by the
 * delivery alerter so on-call is paged before a delivery outage piles up
 * silently.
 */
export async function getStuckTicketDeliveryStats(
  stuckMinutes: number = TICKETDESK_STUCK_MINUTES_DEFAULT,
  now: Date = new Date(),
): Promise<StuckTicketDeliveryStats> {
  const cutoff = new Date(now.getTime() - stuckMinutes * 60 * 1000);

  const rows = await db
    .select({
      status: ticketsTable.deliveryStatus,
      count: sql<number>`count(*)::int`,
      oldest: sql<string | null>`min(${ticketsTable.createdAt})`,
    })
    .from(ticketsTable)
    .where(
      and(
        inArray(ticketsTable.deliveryStatus, ["pending", "failed"]),
        lt(ticketsTable.createdAt, cutoff),
      ),
    )
    .groupBy(ticketsTable.deliveryStatus);

  let pending = 0;
  let failed = 0;
  let oldest: Date | null = null;
  for (const row of rows) {
    const c = Number(row.count) || 0;
    if (row.status === "pending") pending = c;
    else if (row.status === "failed") failed = c;
    if (row.oldest) {
      const d = new Date(row.oldest as unknown as string);
      if (!Number.isNaN(d.getTime()) && (!oldest || d < oldest)) oldest = d;
    }
  }

  const count = pending + failed;

  let lastError: string | null = null;
  if (count > 0) {
    const [errRow] = await db
      .select({ err: ticketsTable.deliveryLastError })
      .from(ticketsTable)
      .where(
        and(
          inArray(ticketsTable.deliveryStatus, ["pending", "failed"]),
          lt(ticketsTable.createdAt, cutoff),
          isNotNull(ticketsTable.deliveryLastError),
        ),
      )
      .orderBy(desc(ticketsTable.deliveryLastAttemptAt))
      .limit(1);
    lastError = errRow?.err ?? null;
  }

  return {
    count,
    byStatus: { pending, failed },
    oldestCreatedAt: oldest ? oldest.toISOString() : null,
    lastError,
    stuckMinutes,
  };
}

export async function shutdownTicketDeskQueue(): Promise<void> {
  if (worker) {
    await worker.close();
    worker = null;
  }
  if (queue) {
    await queue.close();
    queue = null;
  }
  if (connection) {
    await connection.quit();
    connection = null;
  }
}
