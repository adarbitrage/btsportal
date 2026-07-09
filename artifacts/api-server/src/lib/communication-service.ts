import { Queue, type JobsOptions, type Job } from "bullmq";
import sgMail from "@sendgrid/mail";
import twilio from "twilio";
import {
  db,
  emailTemplatesTable,
  smsTemplatesTable,
  communicationLogTable,
  emailUnsubscribesTable,
  emailBouncesTable,
  usersTable,
} from "@workspace/db";
import { eq, and, gte } from "drizzle-orm";
import { getRedisConnection } from "./redis";
import { recordQueueFallback } from "./queue-fallback-tracker";
import {
  getPortalUrl,
  getPortalUrlStatus,
  PORTAL_URL_SETTING_KEY,
} from "./portal-url-settings";
import { brandStrings } from "@workspace/brand-config";
import { DEFAULT_TICKETDESK_URL } from "@workspace/support-config";
import { renderPitchStackHtml } from "./pitch-resolver";
import { qualifyPublicAssetUrl, qualifyPersonBlockImgSrcs } from "./seed-templates";

// Queue-fallback events are persisted to the audit log inside
// `recordQueueFallback` (entityType="queue"). We used to also write a
// duplicate `entityType="communication"` row from this file, which doubled
// disk usage and confused anyone reading the raw audit_log table. The single
// "queue" row already carries channel, recipient, and reason in both its
// description and metadata, and is the row the System Health UI and
// `getQueueFallbackStatsFromDb` filter on.

const QUEUE_ADD_TIMEOUT_MS = Number.parseInt(
  process.env.QUEUE_ADD_TIMEOUT_MS || "2000",
  10,
);

const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY || "";
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID || "";
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || "";
const TWILIO_PHONE_NUMBER = process.env.TWILIO_PHONE_NUMBER || "";

const FROM_EMAIL_TRANSACTIONAL = process.env.FROM_EMAIL_TRANSACTIONAL || "noreply@buildtestscale.com";
const FROM_EMAIL_MARKETING = process.env.FROM_EMAIL_MARKETING || "team@buildtestscale.com";
const FROM_NAME_DEFAULT = process.env.FROM_NAME_DEFAULT || brandStrings("bts").full;


// Twilio's delivery-status callback hits OUR API server (it's not a branded
// member-facing link), so it still uses the global PORTAL_URL env var rather
// than the per-tenant portal URL resolver. The single API server fronts every
// tenant's portal so a per-tenant override would be wrong here.
const TWILIO_CALLBACK_BASE =
  process.env.PORTAL_URL || "https://portal.buildtestscale.com";

if (SENDGRID_API_KEY) {
  sgMail.setApiKey(SENDGRID_API_KEY);
}

let twilioClient: ReturnType<typeof twilio> | null = null;
if (TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN) {
  if (!TWILIO_ACCOUNT_SID.startsWith("AC")) {
    console.warn(
      "[communication-service] TWILIO_ACCOUNT_SID does not start with \"AC\"; " +
        "Twilio SMS is disabled. Provide the Account SID (starts with AC), " +
        "not an API Key SID (SK...) or auth token.",
    );
  } else {
    try {
      twilioClient = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
    } catch (err) {
      console.warn(
        "[communication-service] Failed to initialize Twilio client; SMS disabled:",
        err instanceof Error ? err.message : err,
      );
    }
  }
}

let emailQueue: Queue | null = null;
let smsQueue: Queue | null = null;

function getEmailQueue(): Queue {
  if (!emailQueue) {
    emailQueue = new Queue("email", { connection: getRedisConnection() });
  }
  return emailQueue;
}

function getSmsQueue(): Queue {
  if (!smsQueue) {
    smsQueue = new Queue("sms", { connection: getRedisConnection() });
  }
  return smsQueue;
}

type ConnectionLike = {
  status?: string;
  on?: (event: string, listener: () => void) => unknown;
  off?: (event: string, listener: () => void) => unknown;
};

type EnqueuedJob = Pick<Job, "id" | "remove">;

/**
 * Wait for the underlying Redis connection to reach the "ready" state, or
 * resolve false if it stays in a non-ready state past timeoutMs (or
 * transitions to a known-dead state). Resolves immediately if already ready
 * or already dead. Does not throw.
 */
async function waitForReady(
  conn: ConnectionLike,
  timeoutMs: number,
): Promise<boolean> {
  if (conn.status === "ready") return true;
  if (conn.status === "end" || conn.status === "close") return false;

  return new Promise<boolean>((resolve) => {
    let done = false;
    const finish = (v: boolean) => {
      if (done) return;
      done = true;
      conn.off?.("ready", onReady);
      conn.off?.("end", onDead);
      conn.off?.("close", onDead);
      clearTimeout(timer);
      resolve(v);
    };
    const onReady = () => finish(true);
    const onDead = () => finish(false);
    conn.on?.("ready", onReady);
    conn.on?.("end", onDead);
    conn.on?.("close", onDead);
    const timer = setTimeout(() => finish(false), timeoutMs);
  });
}

/**
 * Try to enqueue a job, falling back to a direct send when Redis is offline or
 * slow to respond. Returns true if the job was successfully queued, false if
 * the caller must run the fallback path themselves.
 *
 * Strategy (chosen to avoid duplicate sends):
 *   1. Build the queue (which lazily opens the Redis connection).
 *   2. Wait up to timeoutMs for the connection to be "ready". If it never
 *      becomes ready in that window, return false without ever calling
 *      queue.add() — so there's no orphan job that can sneak through later
 *      when Redis recovers.
 *   3. Once ready, call queue.add() and race it against the remaining budget.
 *      In the rare case Redis dies between "ready" and the LPUSH being
 *      acknowledged, the add() may hang. If it eventually resolves after we
 *      already returned false, attempt to remove the orphan job from the queue
 *      so the worker can't send a duplicate. Worst case, if cleanup fails, log
 *      it loudly so operators know a duplicate may have shipped.
 *   4. Late rejections from add() are swallowed so they don't surface as
 *      unhandled rejections.
 */
export async function tryEnqueue(
  getQueue: () => Queue,
  jobName: string,
  data: unknown,
  opts: JobsOptions,
  timeoutMs: number = QUEUE_ADD_TIMEOUT_MS,
): Promise<boolean> {
  const start = Date.now();
  let queue: Queue;
  try {
    queue = getQueue();
  } catch {
    return false;
  }

  const conn = (queue.opts as { connection?: ConnectionLike }).connection;
  if (!conn) return false;

  const ready = await waitForReady(conn, timeoutMs);
  if (!ready) return false;

  const remaining = Math.max(50, timeoutMs - (Date.now() - start));

  let addPromise: Promise<EnqueuedJob>;
  try {
    addPromise = queue.add(jobName, data, opts);
  } catch {
    return false;
  }

  let timer: NodeJS.Timeout | undefined;
  let timedOut = false;

  const racedResult = await Promise.race<"queued" | "failed" | "timeout">([
    addPromise.then(
      () => "queued" as const,
      () => "failed" as const,
    ),
    new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => {
        timedOut = true;
        resolve("timeout");
      }, remaining);
    }),
  ]);

  if (timer) clearTimeout(timer);

  if (racedResult === "queued") {
    return true;
  }

  if (racedResult === "failed") {
    return false;
  }

  // Timeout: schedule cleanup of the (potential) orphan job so the worker
  // can't deliver a duplicate after our caller direct-sends.
  if (timedOut) {
    addPromise.then(
      async (job) => {
        try {
          if (job?.remove) {
            await job.remove();
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.warn(
            `[Comms] Orphaned ${jobName} job ${job?.id ?? "?"} could not be removed; ` +
              `the worker may deliver a duplicate. Reason: ${msg}`,
          );
        }
      },
      () => {
        // Late rejection — nothing to clean up, swallow so it isn't unhandled.
      },
    );
  }

  return false;
}

/**
 * Outcome of a queueEmail/queueSms call. Lets callers that care about the
 * fate of the message (e.g. the admin Flexy regenerate-password handler)
 * distinguish queued (good — worker will deliver), sent_direct (good — the
 * queue was unavailable so we sent inline), skipped (template missing or
 * provider not configured — nothing was sent and that's expected), and
 * failed (direct send blew up). Most callers ignore the return value and
 * treat the call as fire-and-forget, which is fine — the outcome is purely
 * informational.
 */
export type CommunicationOutcome =
  | { result: "queued" }
  | { result: "sent_direct" }
  | { result: "skipped"; reason: string }
  | { result: "failed"; reason: string };

/**
 * Result of a direct email send via sendEmailDirect. Discriminated on
 * `status` so callers can switch on it without parsing strings.
 *   - sent: SendGrid accepted the message.
 *   - skipped: We deliberately did not send (provider not configured, or
 *     the recipient is suppressed). The `reason` is for logging only.
 *   - failed: We tried to send and it errored. `error` is the underlying
 *     message from the provider or DB.
 */
export type EmailDirectResult =
  // `logId` is the row id of the `communication_log` row this send wrote
  // (or null on the early-skip paths that don't create a log row, e.g. the
  // marketing-suppression branch that returns before insert is reached).
  // Callers thread it into `recordQueueFallback({ commsLogId })` so the
  // fallback audit row links to the exact send instead of relying on the
  // channel + recipient + time-window heuristic.
  | { status: "sent"; messageId: string; logId: number }
  | { status: "skipped"; reason: string; logId: number | null }
  | { status: "failed"; error: string; logId: number };

/**
 * Result of a direct SMS send via sendSmsDirect. Same shape as
 * EmailDirectResult but carries a Twilio message SID instead of a
 * SendGrid message ID on success.
 *   - skipped: provider not configured, or the user is not opted in.
 */
export type SmsDirectResult =
  // `logId` mirrors EmailDirectResult.logId. The `not_opted_in` skip path
  // returns before any log row is inserted, so it's null there.
  | { status: "sent"; messageSid: string; logId: number }
  | { status: "skipped"; reason: string; logId: number | null }
  | { status: "failed"; error: string; logId: number };

// Exported (in addition to being used internally) so the Task #1717
// structural `{{` guard test can render every lifecycle template through
// the EXACT production interpolation path rather than reimplementing it —
// a copy in the test file could silently drift from this regex and stop
// catching the class of bug it exists to catch.
export function replaceVariables(template: string, variables: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    return variables[key] !== undefined ? variables[key] : match;
  });
}

// Stable token written to communication_log.errorMessage and to the audit
// metadata of skipped sends so the System Health page, the admin
// Communications Log dialog, and external dashboards can all key off the
// same string. Don't change without grepping for callers.
export const SKIP_REASON_PORTAL_URL_UNCONFIGURED = "portal_url_unconfigured";

// Per-tenant override key wins over caller-supplied variables (see
// getCommonVariables). Match the same `{{portal_url}}` token the
// substitution pass uses so a caller that passes its own value in
// `variables.portal_url` is treated as having the link covered and the
// production-skip guard stays out of its way.
const PORTAL_URL_TOKEN = /\{\{\s*portal_url\s*\}\}/;

/**
 * True if any of the template fields contain `{{portal_url}}`. We check the
 * raw template strings (not the rendered output) so the skip decision is
 * deterministic regardless of whether the caller supplied an override.
 * Callers thread in only the fields they have — emails use subject + bodies,
 * SMS uses body only.
 */
function templateUsesPortalUrl(
  fields: ReadonlyArray<string | null | undefined>,
): boolean {
  return fields.some((field) => typeof field === "string" && PORTAL_URL_TOKEN.test(field));
}

/**
 * Decide whether a template that needs `{{portal_url}}` should be skipped
 * because no portal URL is configured in production. Returns false (don't
 * skip) when:
 *   - the template doesn't reference `{{portal_url}}` at all
 *   - the caller supplied an explicit `portal_url` override in `variables`
 *   - the resolver returned a value (DB row, env var, or dev default)
 *   - we are not running in production (NODE_ENV !== "production")
 *
 * The dev/test escape hatch matters: portal-url-settings always returns the
 * `http://localhost:5000` dev default outside production, so this guard is
 * effectively production-only. That mirrors the existing comment in
 * `getCommonVariables` — we deliberately don't drop sends in development.
 */
async function shouldSkipForMissingPortalUrl(
  templateFields: ReadonlyArray<string | null | undefined>,
  callerVariables: Record<string, string> | undefined,
): Promise<boolean> {
  if (process.env.NODE_ENV !== "production") return false;
  if (callerVariables && typeof callerVariables.portal_url === "string" && callerVariables.portal_url !== "") {
    return false;
  }
  if (!templateUsesPortalUrl(templateFields)) return false;
  const portalUrl = await getPortalUrl();
  return !portalUrl;
}

/**
 * Insert a `communication_log` row recording a portal-url-driven skip so
 * operators tracing a missed password reset can see exactly why the send
 * didn't happen. Mirrors the columns the normal send path populates so the
 * existing Communications Log dialog renders these rows without special
 * cases. The audit signal that surfaces on the System Health page is the
 * `portalUrl` block on `/admin/system/health` — this row is the
 * per-recipient breadcrumb the on-call admin clicks into from there.
 */
async function logPortalUrlSkip(params: {
  channel: "email" | "sms";
  templateSlug: string;
  userId?: number;
  recipientEmail?: string;
  recipientPhone?: string;
  subject?: string;
  category?: string;
}): Promise<number> {
  console.error(
    `[Comms] Skipping ${params.channel} template "${params.templateSlug}" to ${
      params.recipientEmail ?? params.recipientPhone ?? "unknown"
    }: no portal URL configured (set ${PORTAL_URL_SETTING_KEY} in admin settings or the PORTAL_URL env var). The template references {{portal_url}} and we refuse to ship a broken link in production.`,
  );
  const [row] = await db
    .insert(communicationLogTable)
    .values({
      userId: params.userId,
      channel: params.channel,
      templateSlug: params.templateSlug,
      recipientEmail: params.recipientEmail,
      recipientPhone: params.recipientPhone,
      subject: params.subject,
      status: "skipped",
      category: params.category,
      errorMessage: SKIP_REASON_PORTAL_URL_UNCONFIGURED,
      metadata: {
        reason: SKIP_REASON_PORTAL_URL_UNCONFIGURED,
        setting: PORTAL_URL_SETTING_KEY,
      },
    })
    .returning({ id: communicationLogTable.id });
  return row.id;
}

/**
 * Build the {{portal_url}}, {{support_email}}, etc. template variables every
 * branded email/SMS shares. The portal URL is resolved per-call via the
 * per-tenant resolver (system_settings → PORTAL_URL env → dev default) so a
 * tenant that has saved their own portal domain in the admin UI never ships
 * members a link to a different tenant's portal.
 *
 * Behavior when nothing is configured:
 *   - In non-production (NODE_ENV !== "production") the resolver returns its
 *     dev default ("http://localhost:5000") so tests and `pnpm dev` keep
 *     working without setup.
 *   - In production with neither a DB row nor PORTAL_URL env var, the
 *     resolver returns null. We DO NOT skip the email — that would silently
 *     drop password resets and verifications operators expected to send. We
 *     fall back to an empty string for {{portal_url}}, which produces a
 *     visibly-broken (but not wrong-tenant) link, and log a loud error so
 *     operators notice. Callers that build a URL where the portal value is
 *     load-bearing (e.g. the email-change "restart" link in admin-panel)
 *     should resolve the portal URL themselves and skip when null — see
 *     `getPortalUrl` callers.
 *
 * A caller-supplied `extra.portal_url` still wins via the trailing spread,
 * which preserves the pre-existing override used by the admin broadcast
 * route and a handful of tests.
 */
async function getCommonVariables(
  extra?: Record<string, string>,
): Promise<Record<string, string>> {
  const portalUrl = await getPortalUrl();
  if (!portalUrl) {
    console.error(
      `[Comms] No portal URL configured (set ${PORTAL_URL_SETTING_KEY} in admin settings or the PORTAL_URL env var). Emails using {{portal_url}} will render with an empty value.`,
    );
  }
  // Task #1714: header brand resolution lives here (the seam that already
  // knows the brand at render time), driven through single-brace tokens
  // since the substitution pass only matches `{{word}}` (not the dotted
  // `brand.short`-style tokens `@workspace/brand-config` exposes elsewhere).
  // Every caller today is BTS-only (no brand-substituted nurture send exists
  // yet — the sequence engine that would drive one is stubbed/out of scope),
  // so `brand` always resolves to "bts" and `logo_html` always renders the
  // hosted logo image. A future nurture-send caller can override `brand` in
  // `extra` to get the resolved brand's marked wordmark as styled text
  // instead — only `bts` has a logo asset; front-end brands are text marks.
  const brand = extra?.brand ?? "bts";
  const brandInfo = brandStrings(brand);
  // Task #1717: route the logo through the same qualifyPublicAssetUrl seam
  // used by renderPersonBlock, so both image sources in a lifecycle email
  // share one place that guarantees an absolute https URL (or degrades to no
  // image) rather than ever emitting a relative path Gmail can't resolve.
  const qualifiedLogoUrl = qualifyPublicAssetUrl("/images/bts-logo.png", portalUrl);
  const logoHtml =
    brand === "bts" && qualifiedLogoUrl
      ? `<img src="${qualifiedLogoUrl}" alt="${brandInfo.full}" width="160" style="display:inline-block;max-width:160px;height:auto;border:0;">`
      : brand === "bts"
        ? ""
        : `<span style="font-size:22px;font-weight:bold;color:#1a1a2e;letter-spacing:0.3px;">${brandInfo.full}</span>`;

  // Task #1790: qualify any root-relative img src values left in
  // person_block_html at send time — the same discipline the logo already
  // follows. renderPersonBlock now emits a root-relative src (instead of
  // falling back to initials) when its caller omitted portalUrl, so this
  // seam is the mandatory backstop that makes the absolute URL inevitable.
  const rawPersonBlock = extra?.person_block_html;
  const qualifiedPersonBlock = rawPersonBlock !== undefined
    ? qualifyPersonBlockImgSrcs(rawPersonBlock, portalUrl)
    : undefined;

  const finalExtra: Record<string, string> | undefined =
    qualifiedPersonBlock !== undefined && qualifiedPersonBlock !== rawPersonBlock
      ? { ...extra, person_block_html: qualifiedPersonBlock }
      : extra;

  return {
    portal_url: portalUrl ?? "",
    support_email: FROM_EMAIL_TRANSACTIONAL,
    // Trademark-marked per Task #1635 — this is the full brand display name
    // used in every transactional email's {{company_name}} token.
    company_name: brandInfo.full,
    logo_html: logoHtml,
    ticketdesk_url: DEFAULT_TICKETDESK_URL,
    // Empty-safe defaults for the Task #1714 layout slots — most templates
    // never populate these, so they must resolve to "" rather than leaving
    // a literal `{{person_block_html}}`/`{{pitch_block_html}}` in the sent
    // email. Booking sends (call-bookings.ts, scheduled-comms.ts) override
    // both via `extra`.
    person_block_html: "",
    pitch_block_html: "",
    current_year: new Date().getFullYear().toString(),
    ...finalExtra,
  };
}

// Token generation/verification moved to ./unsubscribe-token (Task #1770) so
// scheduled-comms can build unsubscribe URLs without importing this module
// (which its tests mock wholesale). Imported + re-exported here because this
// module also uses generateUnsubscribeToken internally (marketing footer) and
// existing callers import both from here.
import { generateUnsubscribeToken, verifyUnsubscribeToken } from "./unsubscribe-token";
export { generateUnsubscribeToken, verifyUnsubscribeToken };

async function isEmailSuppressed(email: string): Promise<{ suppressed: boolean; reason?: string }> {
  const normalizedEmail = email.toLowerCase();

  const [unsubscribe] = await db
    .select({ id: emailUnsubscribesTable.id })
    .from(emailUnsubscribesTable)
    .where(and(eq(emailUnsubscribesTable.email, normalizedEmail), eq(emailUnsubscribesTable.active, true)))
    .limit(1);

  if (unsubscribe) {
    return { suppressed: true, reason: "unsubscribed" };
  }

  const [hardBounce] = await db
    .select({ id: emailBouncesTable.id })
    .from(emailBouncesTable)
    .where(and(
      eq(emailBouncesTable.email, normalizedEmail),
      eq(emailBouncesTable.bounceType, "hard"),
      eq(emailBouncesTable.suppressed, true),
    ))
    .limit(1);

  if (hardBounce) {
    return { suppressed: true, reason: "hard_bounce" };
  }

  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const softBounces = await db
    .select({ id: emailBouncesTable.id })
    .from(emailBouncesTable)
    .where(and(
      eq(emailBouncesTable.email, normalizedEmail),
      eq(emailBouncesTable.bounceType, "soft"),
      gte(emailBouncesTable.bouncedAt, sevenDaysAgo),
    ));

  if (softBounces.length >= 3) {
    await db.update(emailBouncesTable)
      .set({ suppressed: true })
      .where(and(
        eq(emailBouncesTable.email, normalizedEmail),
        eq(emailBouncesTable.bounceType, "soft"),
      ));
    return { suppressed: true, reason: "soft_bounce_threshold" };
  }

  return { suppressed: false };
}

async function sendEmailDirect(params: {
  to: string;
  subject: string;
  html: string;
  text: string;
  fromEmail?: string;
  fromName?: string;
  category?: string;
  userId?: number;
  templateSlug?: string;
  includeUnsubscribe?: boolean;
}): Promise<EmailDirectResult> {
  const {
    to,
    subject,
    html,
    text,
    fromEmail,
    fromName = FROM_NAME_DEFAULT,
    category = "transactional",
    userId,
    templateSlug,
    includeUnsubscribe = false,
  } = params;

  const isMarketing = category === "marketing";
  const from = fromEmail || (isMarketing ? FROM_EMAIL_MARKETING : FROM_EMAIL_TRANSACTIONAL);

  if (isMarketing) {
    const suppression = await isEmailSuppressed(to);
    if (suppression.suppressed) {
      console.log(`[Comms] Email to ${to} suppressed: ${suppression.reason}`);
      const [suppressedLog] = await db.insert(communicationLogTable).values({
        userId,
        channel: "email",
        templateSlug,
        recipientEmail: to,
        subject,
        fromEmail: from,
        status: "suppressed",
        category,
        metadata: { reason: suppression.reason },
      }).returning({ id: communicationLogTable.id });
      return {
        status: "skipped",
        reason: `suppressed:${suppression.reason ?? "unknown"}`,
        logId: suppressedLog.id,
      };
    }
  }

  const [logEntry] = await db.insert(communicationLogTable).values({
    userId,
    channel: "email",
    templateSlug,
    recipientEmail: to,
    subject,
    fromEmail: from,
    status: "sending",
    category,
  }).returning();

  if (!SENDGRID_API_KEY) {
    console.log(`[Comms] SendGrid not configured. Would send email to ${to}: "${subject}"`);
    await db.update(communicationLogTable)
      .set({ status: "skipped", errorMessage: "SendGrid not configured" })
      .where(eq(communicationLogTable.id, logEntry.id));
    return { status: "skipped", reason: "provider_not_configured", logId: logEntry.id };
  }

  try {
    let finalHtml = html;
    const headers: Record<string, string> = {};

    if (isMarketing && includeUnsubscribe) {
      const token = generateUnsubscribeToken(to);
      // Resolve the per-tenant portal URL for the branded unsubscribe link so
      // members on a custom-domain tenant don't see a buildtestscale.com URL.
      // Falls back to the env var (TWILIO_CALLBACK_BASE happens to share the
      // same source) when nothing is configured — better a same-product URL
      // than an empty one in the List-Unsubscribe header, which some inbox
      // providers reject outright.
      const portalUrl = (await getPortalUrl()) ?? TWILIO_CALLBACK_BASE;
      const unsubscribeUrl = `${portalUrl}/api/email/unsubscribe?email=${encodeURIComponent(to)}&token=${token}`;
      headers["List-Unsubscribe"] = `<${unsubscribeUrl}>`;
      headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";
      finalHtml += `\n<p style="text-align:center;font-size:12px;color:#999;margin-top:40px;">You are receiving this email because you are a member of ${brandStrings("bts").full}. <a href="${unsubscribeUrl}" style="color:#999;">Unsubscribe</a></p>`;
    }

    const msg: sgMail.MailDataRequired = {
      to,
      from: { email: from, name: fromName },
      subject,
      html: finalHtml,
      text,
      categories: [category],
      headers,
      customArgs: {
        log_id: logEntry.id.toString(),
      },
    };

    const [response] = await sgMail.send(msg);
    const messageId = response?.headers?.["x-message-id"] || "";

    await db.update(communicationLogTable)
      .set({ status: "sent", sendgridMessageId: messageId })
      .where(eq(communicationLogTable.id, logEntry.id));

    return { status: "sent", messageId, logId: logEntry.id };
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[Comms] Email send failed to ${to}:`, errorMessage);

    await db.update(communicationLogTable)
      .set({ status: "failed", errorMessage })
      .where(eq(communicationLogTable.id, logEntry.id));

    return { status: "failed", error: errorMessage, logId: logEntry.id };
  }
}

async function sendSmsDirect(params: {
  to: string;
  body: string;
  userId?: number;
  templateSlug?: string;
}): Promise<SmsDirectResult> {
  const { to, body, userId, templateSlug } = params;

  if (userId) {
    const [user] = await db
      .select({ smsOptIn: usersTable.smsOptIn, phone: usersTable.phone })
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .limit(1);

    if (!user?.smsOptIn) {
      console.log(`[Comms] SMS to user ${userId} skipped: not opted in`);
      // No log row was inserted on the not-opted-in path, so there's no
      // logId to thread back to recordQueueFallback.
      return { status: "skipped", reason: "not_opted_in", logId: null };
    }
  }

  const [logEntry] = await db.insert(communicationLogTable).values({
    userId,
    channel: "sms",
    templateSlug,
    recipientPhone: to,
    status: "sending",
  }).returning();

  if (!twilioClient || !TWILIO_PHONE_NUMBER) {
    console.log(`[Comms] Twilio not configured. Would send SMS to ${to}: "${body}"`);
    await db.update(communicationLogTable)
      .set({ status: "skipped", errorMessage: "Twilio not configured" })
      .where(eq(communicationLogTable.id, logEntry.id));
    return { status: "skipped", reason: "provider_not_configured", logId: logEntry.id };
  }

  try {
    const message = await twilioClient.messages.create({
      to,
      from: TWILIO_PHONE_NUMBER,
      body,
      statusCallback: `${TWILIO_CALLBACK_BASE}/api/webhooks/twilio`,
    });

    await db.update(communicationLogTable)
      .set({ status: "sent", twilioMessageSid: message.sid })
      .where(eq(communicationLogTable.id, logEntry.id));

    return { status: "sent", messageSid: message.sid, logId: logEntry.id };
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[Comms] SMS send failed to ${to}:`, errorMessage);

    await db.update(communicationLogTable)
      .set({ status: "failed", errorMessage })
      .where(eq(communicationLogTable.id, logEntry.id));

    return { status: "failed", error: errorMessage, logId: logEntry.id };
  }
}

/**
 * Task #1715: resolve the `pitch_block_html` variable for a lifecycle send,
 * unless the caller already supplied one explicitly (booking/scheduled sends
 * that want to control the slot themselves stay untouched) or this is a
 * marketing/broadcast send (`queueBroadcastEmail` always passes
 * category: "marketing" — out of scope per the task's "marketing-blast-only
 * injection paths" exclusion) or there's no `userId` to resolve a tier for
 * (e.g. an address-only notification with no member record).
 *
 * A resolver failure is treated the same as an empty stack (renders
 * nothing) rather than blocking the send — a broken pitch lookup should
 * never prevent a lifecycle email from going out.
 */
async function resolvePitchBlockHtmlForSend(
  variables: Record<string, string>,
  userId: number | undefined,
  emailCategory: string,
): Promise<string | undefined> {
  if (variables.pitch_block_html !== undefined) return undefined;
  if (!userId) return undefined;
  if (emailCategory === "marketing") return undefined;
  try {
    return await renderPitchStackHtml(userId);
  } catch (err) {
    console.error(`[Comms] Pitch resolver failed for user ${userId}:`, err);
    return "";
  }
}

export const CommunicationService = {
  async queueEmail(params: {
    templateSlug: string;
    to: string;
    variables?: Record<string, string>;
    userId?: number;
    category?: string;
  }): Promise<CommunicationOutcome> {
    const { templateSlug, to, variables = {}, userId, category } = params;

    const [template] = await db
      .select()
      .from(emailTemplatesTable)
      .where(and(eq(emailTemplatesTable.slug, templateSlug), eq(emailTemplatesTable.active, true)))
      .limit(1);

    if (!template) {
      console.error(`[Comms] Email template not found: ${templateSlug}`);
      return { result: "skipped", reason: "template_not_found" };
    }

    if (
      await shouldSkipForMissingPortalUrl(
        [template.subject, template.htmlBody, template.textBody],
        variables,
      )
    ) {
      const emailCategory = category || template.category;
      await logPortalUrlSkip({
        channel: "email",
        templateSlug,
        userId,
        recipientEmail: to,
        subject: template.subject,
        category: emailCategory,
      });
      return { result: "skipped", reason: SKIP_REASON_PORTAL_URL_UNCONFIGURED };
    }

    const emailCategory = category || template.category;
    const pitchBlockHtml = await resolvePitchBlockHtmlForSend(variables, userId, emailCategory);
    const allVars = await getCommonVariables(
      pitchBlockHtml !== undefined ? { ...variables, pitch_block_html: pitchBlockHtml } : variables,
    );
    const subject = replaceVariables(template.subject, allVars);
    const html = replaceVariables(template.htmlBody, allVars);
    const text = replaceVariables(template.textBody, allVars);

    const jobData = {
      to,
      subject,
      html,
      text,
      fromName: template.fromName || FROM_NAME_DEFAULT,
      category: emailCategory,
      userId,
      templateSlug,
      includeUnsubscribe: emailCategory === "marketing",
    };

    const queued = await tryEnqueue(getEmailQueue, "send-email", jobData, {
      attempts: 3,
      backoff: { type: "exponential", delay: 5000 },
      removeOnComplete: 100,
      removeOnFail: 200,
    });

    if (queued) {
      return { result: "queued" };
    }

    console.warn(`[Comms] Queue unavailable, sending email directly to ${to}`);
    const direct = await sendEmailDirect(jobData);
    // Record the fallback after the direct send so we can stamp the
    // resulting communication_log id onto the audit row's metadata. This
    // gives the Communications Log detail dialog an exact link instead of
    // relying on the channel + recipient + ±2-minute time-window heuristic.
    // The not-opted-in skip path (only on SMS) doesn't insert a log row, so
    // logId can be null there; for email it's always populated.
    void recordQueueFallback("email", {
      recipient: to,
      reason: "queue_unavailable",
      commsLogId: direct.logId ?? undefined,
    });
    switch (direct.status) {
      case "sent":
        return { result: "sent_direct" };
      case "skipped":
        return { result: "skipped", reason: direct.reason };
      case "failed":
        return { result: "failed", reason: direct.error };
    }
  },

  async queueSms(params: {
    templateSlug: string;
    to: string;
    variables?: Record<string, string>;
    userId?: number;
  }): Promise<CommunicationOutcome> {
    const { templateSlug, to, variables = {}, userId } = params;

    const [template] = await db
      .select()
      .from(smsTemplatesTable)
      .where(and(eq(smsTemplatesTable.slug, templateSlug), eq(smsTemplatesTable.active, true)))
      .limit(1);

    if (!template) {
      console.error(`[Comms] SMS template not found: ${templateSlug}`);
      return { result: "skipped", reason: "template_not_found" };
    }

    if (
      await shouldSkipForMissingPortalUrl([template.body], variables)
    ) {
      await logPortalUrlSkip({
        channel: "sms",
        templateSlug,
        userId,
        recipientPhone: to,
      });
      return { result: "skipped", reason: SKIP_REASON_PORTAL_URL_UNCONFIGURED };
    }

    const allVars = await getCommonVariables(variables);
    const body = replaceVariables(template.body, allVars);

    const jobData = { to, body, userId, templateSlug };

    const queued = await tryEnqueue(getSmsQueue, "send-sms", jobData, {
      attempts: 3,
      backoff: { type: "exponential", delay: 5000 },
      removeOnComplete: 100,
      removeOnFail: 200,
    });

    if (queued) {
      return { result: "queued" };
    }

    console.warn(`[Comms] Queue unavailable, sending SMS directly to ${to}`);
    const direct = await sendSmsDirect(jobData);
    // See queueEmail above for the rationale: recording after the direct
    // send lets us stamp the communication_log id onto the audit row.
    void recordQueueFallback("sms", {
      recipient: to,
      reason: "queue_unavailable",
      commsLogId: direct.logId ?? undefined,
    });
    switch (direct.status) {
      case "sent":
        return { result: "sent_direct" };
      case "skipped":
        return { result: "skipped", reason: direct.reason };
      case "failed":
        return { result: "failed", reason: direct.error };
    }
  },

  async sendEmailNow(params: {
    templateSlug: string;
    to: string;
    variables?: Record<string, string>;
    userId?: number;
    category?: string;
  }): Promise<EmailDirectResult> {
    const { templateSlug, to, variables = {}, userId, category } = params;

    const [template] = await db
      .select()
      .from(emailTemplatesTable)
      .where(and(eq(emailTemplatesTable.slug, templateSlug), eq(emailTemplatesTable.active, true)))
      .limit(1);

    if (!template) {
      console.error(`[Comms] Email template not found: ${templateSlug}`);
      return { status: "skipped", reason: `template_not_found:${templateSlug}`, logId: null };
    }

    if (
      await shouldSkipForMissingPortalUrl(
        [template.subject, template.htmlBody, template.textBody],
        variables,
      )
    ) {
      const emailCategory = category || template.category;
      const logId = await logPortalUrlSkip({
        channel: "email",
        templateSlug,
        userId,
        recipientEmail: to,
        subject: template.subject,
        category: emailCategory,
      });
      return { status: "skipped", reason: SKIP_REASON_PORTAL_URL_UNCONFIGURED, logId };
    }

    const emailCategory = category || template.category;
    const pitchBlockHtml = await resolvePitchBlockHtmlForSend(variables, userId, emailCategory);
    const allVars = await getCommonVariables(
      pitchBlockHtml !== undefined ? { ...variables, pitch_block_html: pitchBlockHtml } : variables,
    );
    const subject = replaceVariables(template.subject, allVars);
    const html = replaceVariables(template.htmlBody, allVars);
    const text = replaceVariables(template.textBody, allVars);

    return sendEmailDirect({
      to,
      subject,
      html,
      text,
      fromName: template.fromName || FROM_NAME_DEFAULT,
      category: category || template.category,
      userId,
      templateSlug,
      // Intentional global behavior change (task 1730): direct sends now
      // append the unsubscribe footer for marketing-category emails, matching
      // the queued-send path above. Transactional emails never include it.
      includeUnsubscribe: emailCategory === "marketing",
    });
  },

  async sendSmsNow(params: {
    templateSlug: string;
    to: string;
    variables?: Record<string, string>;
    userId?: number;
  }): Promise<SmsDirectResult> {
    const { templateSlug, to, variables = {}, userId } = params;

    const [template] = await db
      .select()
      .from(smsTemplatesTable)
      .where(and(eq(smsTemplatesTable.slug, templateSlug), eq(smsTemplatesTable.active, true)))
      .limit(1);

    if (!template) {
      console.error(`[Comms] SMS template not found: ${templateSlug}`);
      return { status: "skipped", reason: `template_not_found:${templateSlug}`, logId: null };
    }

    if (
      await shouldSkipForMissingPortalUrl([template.body], variables)
    ) {
      const logId = await logPortalUrlSkip({
        channel: "sms",
        templateSlug,
        userId,
        recipientPhone: to,
      });
      return { status: "skipped", reason: SKIP_REASON_PORTAL_URL_UNCONFIGURED, logId };
    }

    const allVars = await getCommonVariables(variables);
    const body = replaceVariables(template.body, allVars);

    return sendSmsDirect({ to, body, userId, templateSlug });
  },

  async queueBroadcastEmail(params: {
    templateSlug: string;
    recipientList: Array<{ email: string; userId?: number; variables?: Record<string, string> }>;
  }): Promise<{ queued: number; suppressed: number }> {
    const { templateSlug, recipientList } = params;
    let queued = 0;
    let suppressed = 0;

    for (const recipient of recipientList) {
      const suppression = await isEmailSuppressed(recipient.email);
      if (suppression.suppressed) {
        suppressed++;
        continue;
      }

      await this.queueEmail({
        templateSlug,
        to: recipient.email,
        variables: recipient.variables,
        userId: recipient.userId,
        category: "marketing",
      });
      queued++;
    }

    return { queued, suppressed };
  },

  sendEmailDirect,
  sendSmsDirect,
  isEmailSuppressed,
};
