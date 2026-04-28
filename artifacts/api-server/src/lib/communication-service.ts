import { Queue, type JobsOptions, type Job } from "bullmq";
import sgMail from "@sendgrid/mail";
import twilio from "twilio";
import crypto from "crypto";
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
const FROM_NAME_DEFAULT = process.env.FROM_NAME_DEFAULT || "Build Test Scale";

const PORTAL_URL = process.env.PORTAL_URL || "https://portal.buildtestscale.com";
const UNSUBSCRIBE_SECRET = process.env.UNSUBSCRIBE_SECRET || "bts-unsub-secret-change-me";

if (SENDGRID_API_KEY) {
  sgMail.setApiKey(SENDGRID_API_KEY);
}

let twilioClient: ReturnType<typeof twilio> | null = null;
if (TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN) {
  twilioClient = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
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

function replaceVariables(template: string, variables: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    return variables[key] !== undefined ? variables[key] : match;
  });
}

function getCommonVariables(extra?: Record<string, string>): Record<string, string> {
  return {
    portal_url: PORTAL_URL,
    support_email: FROM_EMAIL_TRANSACTIONAL,
    company_name: "Build Test Scale",
    current_year: new Date().getFullYear().toString(),
    ...extra,
  };
}

export function generateUnsubscribeToken(email: string): string {
  const hmac = crypto.createHmac("sha256", UNSUBSCRIBE_SECRET);
  hmac.update(email.toLowerCase());
  return hmac.digest("hex");
}

export function verifyUnsubscribeToken(email: string, token: string): boolean {
  const expected = generateUnsubscribeToken(email);
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(token));
  } catch {
    return false;
  }
}

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
}): Promise<{ success: boolean; messageId?: string; error?: string }> {
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
      await db.insert(communicationLogTable).values({
        userId,
        channel: "email",
        templateSlug,
        recipientEmail: to,
        subject,
        fromEmail: from,
        status: "suppressed",
        category,
        metadata: { reason: suppression.reason },
      });
      return { success: false, error: `Suppressed: ${suppression.reason}` };
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
    return { success: true, error: "SendGrid not configured (skipped)" };
  }

  try {
    let finalHtml = html;
    const headers: Record<string, string> = {};

    if (isMarketing && includeUnsubscribe) {
      const token = generateUnsubscribeToken(to);
      const unsubscribeUrl = `${PORTAL_URL}/api/email/unsubscribe?email=${encodeURIComponent(to)}&token=${token}`;
      headers["List-Unsubscribe"] = `<${unsubscribeUrl}>`;
      headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";
      finalHtml += `\n<p style="text-align:center;font-size:12px;color:#999;margin-top:40px;">You are receiving this email because you are a member of Build Test Scale. <a href="${unsubscribeUrl}" style="color:#999;">Unsubscribe</a></p>`;
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

    return { success: true, messageId };
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[Comms] Email send failed to ${to}:`, errorMessage);

    await db.update(communicationLogTable)
      .set({ status: "failed", errorMessage })
      .where(eq(communicationLogTable.id, logEntry.id));

    return { success: false, error: errorMessage };
  }
}

async function sendSmsDirect(params: {
  to: string;
  body: string;
  userId?: number;
  templateSlug?: string;
}): Promise<{ success: boolean; messageSid?: string; error?: string }> {
  const { to, body, userId, templateSlug } = params;

  if (userId) {
    const [user] = await db
      .select({ smsOptIn: usersTable.smsOptIn, phone: usersTable.phone })
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .limit(1);

    if (!user?.smsOptIn) {
      console.log(`[Comms] SMS to user ${userId} skipped: not opted in`);
      return { success: false, error: "User not opted in to SMS" };
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
    return { success: true, error: "Twilio not configured (skipped)" };
  }

  try {
    const message = await twilioClient.messages.create({
      to,
      from: TWILIO_PHONE_NUMBER,
      body,
      statusCallback: `${PORTAL_URL}/api/webhooks/twilio`,
    });

    await db.update(communicationLogTable)
      .set({ status: "sent", twilioMessageSid: message.sid })
      .where(eq(communicationLogTable.id, logEntry.id));

    return { success: true, messageSid: message.sid };
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[Comms] SMS send failed to ${to}:`, errorMessage);

    await db.update(communicationLogTable)
      .set({ status: "failed", errorMessage })
      .where(eq(communicationLogTable.id, logEntry.id));

    return { success: false, error: errorMessage };
  }
}

export const CommunicationService = {
  async queueEmail(params: {
    templateSlug: string;
    to: string;
    variables?: Record<string, string>;
    userId?: number;
    category?: string;
  }): Promise<void> {
    const { templateSlug, to, variables = {}, userId, category } = params;

    const [template] = await db
      .select()
      .from(emailTemplatesTable)
      .where(and(eq(emailTemplatesTable.slug, templateSlug), eq(emailTemplatesTable.active, true)))
      .limit(1);

    if (!template) {
      console.error(`[Comms] Email template not found: ${templateSlug}`);
      return;
    }

    const allVars = getCommonVariables(variables);
    const subject = replaceVariables(template.subject, allVars);
    const html = replaceVariables(template.htmlBody, allVars);
    const text = replaceVariables(template.textBody, allVars);
    const emailCategory = category || template.category;

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

    if (!queued) {
      recordQueueFallback("email", { recipient: to, reason: "queue_unavailable" });
      await sendEmailDirect(jobData);
    }
  },

  async queueSms(params: {
    templateSlug: string;
    to: string;
    variables?: Record<string, string>;
    userId?: number;
  }): Promise<void> {
    const { templateSlug, to, variables = {}, userId } = params;

    const [template] = await db
      .select()
      .from(smsTemplatesTable)
      .where(and(eq(smsTemplatesTable.slug, templateSlug), eq(smsTemplatesTable.active, true)))
      .limit(1);

    if (!template) {
      console.error(`[Comms] SMS template not found: ${templateSlug}`);
      return;
    }

    const allVars = getCommonVariables(variables);
    const body = replaceVariables(template.body, allVars);

    const jobData = { to, body, userId, templateSlug };

    const queued = await tryEnqueue(getSmsQueue, "send-sms", jobData, {
      attempts: 3,
      backoff: { type: "exponential", delay: 5000 },
      removeOnComplete: 100,
      removeOnFail: 200,
    });

    if (!queued) {
      recordQueueFallback("sms", { recipient: to, reason: "queue_unavailable" });
      await sendSmsDirect(jobData);
    }
  },

  async sendEmailNow(params: {
    templateSlug: string;
    to: string;
    variables?: Record<string, string>;
    userId?: number;
    category?: string;
  }): Promise<{ success: boolean; messageId?: string; error?: string }> {
    const { templateSlug, to, variables = {}, userId, category } = params;

    const [template] = await db
      .select()
      .from(emailTemplatesTable)
      .where(and(eq(emailTemplatesTable.slug, templateSlug), eq(emailTemplatesTable.active, true)))
      .limit(1);

    if (!template) {
      console.error(`[Comms] Email template not found: ${templateSlug}`);
      return { success: false, error: `Template not found: ${templateSlug}` };
    }

    const allVars = getCommonVariables(variables);
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
      includeUnsubscribe: false,
    });
  },

  async sendSmsNow(params: {
    templateSlug: string;
    to: string;
    variables?: Record<string, string>;
    userId?: number;
  }): Promise<{ success: boolean; messageSid?: string; error?: string }> {
    const { templateSlug, to, variables = {}, userId } = params;

    const [template] = await db
      .select()
      .from(smsTemplatesTable)
      .where(and(eq(smsTemplatesTable.slug, templateSlug), eq(smsTemplatesTable.active, true)))
      .limit(1);

    if (!template) {
      console.error(`[Comms] SMS template not found: ${templateSlug}`);
      return { success: false, error: `Template not found: ${templateSlug}` };
    }

    const allVars = getCommonVariables(variables);
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
