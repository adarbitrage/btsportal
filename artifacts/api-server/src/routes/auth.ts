import { Router, type IRouter, type Request } from "express";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { db, usersTable, sessionsTable, emailChangeHistoryTable, passwordResetAttemptsTable } from "@workspace/db";
import { eq, and, gt, gte, isNull, desc, sql } from "drizzle-orm";
import { generateAccessToken } from "../middleware/auth";
import { abuseRateLimit, ipKey, emailKey } from "../middleware/abuse-rate-limit";
import { verifyCaptcha } from "../middleware/captcha";
import { queueGHLSync } from "../lib/ghl-queue";
import { CommunicationService } from "../lib/communication-service";
import { emitWebhookEvent, type WebhookEventType } from "../lib/webhook-events";
import { getRedis } from "../lib/redis";
import { logAuditEvent } from "../lib/audit-log";
import { applyCreationTimeOnboardingDefaults } from "../lib/onboarding-variant";

// Shared identifiers for the new "rate limit hit" audit-log entries written
// by the auth endpoints. The Audit Log UI filters on these values.
export const AUTH_RATE_LIMIT_AUDIT_ACTION = "auth_rate_limit_blocked";
export const AUTH_RATE_LIMIT_AUDIT_ENTITY = "auth_rate_limit";

// Identifiers for audit rows recorded when the signup_attempted email
// throttle (see `shouldSendSignupAttemptedNotice` below) suppresses a
// notice. These rows let admins see that someone is repeatedly probing a
// specific member's address from the existing Audit Log UI — the throttle
// itself only logs to the console, which is invisible to the admin tools.
// The Audit Log filter UI surfaces both values verbatim.
export const SIGNUP_NOTICE_SUPPRESSED_AUDIT_ACTION =
  "signup_notice_suppressed";
export const SIGNUP_NOTICE_SUPPRESSED_AUDIT_ENTITY =
  "auth_signup_notice_suppression";

function extractAuthEmail(req: Request): string | undefined {
  const raw = req.body?.email;
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim().toLowerCase();
  return trimmed || undefined;
}

async function recordAuthRateLimitHit(
  endpoint: "login" | "forgot-password" | "reset-password" | "resend-verification",
  opts: { req?: Request; ip?: string; email?: string },
): Promise<void> {
  const ip = opts.ip ?? opts.req?.ip ?? undefined;
  const email = opts.email;
  const target = email ? ` (target: ${email})` : "";
  const ipLabel = ip ?? "unknown";
  await logAuditEvent({
    actionType: AUTH_RATE_LIMIT_AUDIT_ACTION,
    entityType: AUTH_RATE_LIMIT_AUDIT_ENTITY,
    entityId: endpoint,
    description: `Rate limit exceeded on POST /api/auth/${endpoint} from ${ipLabel}${target}`,
    actorEmail: email,
    metadata: { endpoint, ip: ip ?? null, email: email ?? null },
    req: opts.req,
  });
}

// How long after an email change we'll still hint the user about it.
const EMAIL_CHANGE_HINT_WINDOW_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
// Per-IP cap on how many "recently-changed" hints we expose, to deter enumeration.
const EMAIL_CHANGE_HINT_RATE_MAX = 5;
const EMAIL_CHANGE_HINT_RATE_WINDOW_SEC = 60 * 60; // 1 hour

async function shouldExposeEmailChangedHint(ip: string | undefined): Promise<boolean> {
  // If Redis is unavailable, fall back to allowing the hint — the lookup itself is
  // already O(1) on an indexed column, and missing Redis shouldn't break UX.
  const redis = getRedis();
  if (!redis || !ip) return true;

  try {
    const key = `auth:email-change-hint:${ip}`;
    const count = await redis.incr(key);
    if (count === 1) {
      await redis.expire(key, EMAIL_CHANGE_HINT_RATE_WINDOW_SEC);
    }
    return count <= EMAIL_CHANGE_HINT_RATE_MAX;
  } catch (err) {
    console.error("[AUTH] Redis error checking email-change hint rate:", err);
    return true;
  }
}

// Per-recipient throttle for the "someone tried to sign up with your email"
// notice. The register endpoint sends this email every time someone POSTs
// /auth/register against an existing address, so without a throttle an
// attacker can repeatedly hit the endpoint to flood a victim's inbox. We
// cap notices at one per address per window using a simple Redis SET NX EX
// — atomic across concurrent requests, and self-expiring so we don't have
// to schedule cleanup. If Redis is unavailable we fall through and allow
// the send: failing closed would silently drop a real anti-account-takeover
// signal, and the abuse-rate-limit middleware in front of /auth/register
// (per-IP and per-email caps) still bounds how often any single attacker
// can trigger the path in the first place.
//
// The window length is configurable via SIGNUP_ATTEMPTED_NOTICE_WINDOW_SEC
// so operators can tune the trade-off between "useful early-warning signal"
// and "noisy after the first hit" without a redeploy. We clamp to a 1h
// floor so a misconfigured zero / negative value can't disable the throttle
// entirely and re-open the spam vector this whole helper exists to close.
const SIGNUP_ATTEMPTED_NOTICE_WINDOW_DEFAULT_SEC = 24 * 60 * 60; // 24h
const SIGNUP_ATTEMPTED_NOTICE_WINDOW_MIN_SEC = 60 * 60; // 1h floor

function resolveSignupAttemptedWindowSec(): number {
  const raw = process.env.SIGNUP_ATTEMPTED_NOTICE_WINDOW_SEC;
  if (!raw) return SIGNUP_ATTEMPTED_NOTICE_WINDOW_DEFAULT_SEC;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return SIGNUP_ATTEMPTED_NOTICE_WINDOW_DEFAULT_SEC;
  }
  return Math.max(parsed, SIGNUP_ATTEMPTED_NOTICE_WINDOW_MIN_SEC);
}

function hashEmailForSignupAudit(email: string): string {
  return crypto
    .createHash("sha256")
    .update(email.toLowerCase())
    .digest("hex")
    .slice(0, 24);
}

function signupThrottleKey(hash: string): string {
  return `auth:signup-attempted-notice:${hash}`;
}

function signupAuditGateKey(hash: string): string {
  return `auth:signup-attempted-audit:${hash}`;
}

async function shouldSendSignupAttemptedNotice(email: string): Promise<boolean> {
  const redis = getRedis();
  if (!redis) return true;
  const hash = hashEmailForSignupAudit(email);
  const throttleKey = signupThrottleKey(hash);
  try {
    // SET key 1 EX <window> NX — atomic "claim the slot if not already
    // claimed". Returns "OK" the first time per window, null thereafter.
    const result = await redis.set(
      throttleKey,
      "1",
      "EX",
      resolveSignupAttemptedWindowSec(),
      "NX",
    );
    if (result === "OK") {
      // We just opened a new throttle window. Clear any leftover
      // audit-written marker from the previous window so the very first
      // suppression in THIS window produces a fresh audit row. Without
      // this, the audit gate (set on the first suppressed attempt of an
      // earlier window) could still be live across the window boundary
      // and silently swallow the audit row for the new window's
      // suppressions — see the cross-window regression test in
      // `auth-register-signup-attempted-audit.test.ts`.
      await redis
        .del(signupAuditGateKey(hash))
        .catch((err: unknown) =>
          console.error(
            "[AUTH] Redis error clearing signup audit gate on send:",
            err,
          ),
        );
      return true;
    }
    return false;
  } catch (err) {
    console.error(
      "[AUTH] Redis error checking signup_attempted throttle:",
      err,
    );
    return true;
  }
}

/**
 * Mask an email for human-readable audit-log display: keep the first
 * character of the local part and the full domain, replace the rest of the
 * local part with asterisks. Example: `jane.doe@example.com` →
 * `j*******@example.com`. The masked form is what we surface in audit-log
 * descriptions so a non-PII admin viewer can still tell which member is
 * being probed without seeing the full address.
 */
export function maskEmailForSignupAudit(email: string): string {
  const at = email.lastIndexOf("@");
  if (at <= 0 || at === email.length - 1) return "***";
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (local.length === 1) return `*@${domain}`;
  return `${local[0]}${"*".repeat(local.length - 1)}@${domain}`;
}

/**
 * Per-window dedup gate for the audit row written when the signup_attempted
 * throttle suppresses a notice. The first suppression for a given email
 * within the active throttle window writes one audit row; subsequent
 * suppressions in the same window write nothing. This is what bounds the
 * row count so an attacker can't flood the audit log itself by repeatedly
 * hitting /auth/register against the same address.
 *
 * The dedup window is anchored to the *throttle key's remaining TTL* (not
 * an independent TTL), so the audit gate expires no later than the
 * throttle window itself. Combined with `shouldSendSignupAttemptedNotice`
 * deleting this key whenever a fresh send opens a new throttle window,
 * the audit cadence tracks the throttle cadence one-for-one — a new
 * throttle window always produces at most one fresh audit row, even if
 * the previous window had already written one.
 *
 * Failure mode (Redis unavailable, missing PTTL, race): we fall through
 * and allow the audit write. The upstream per-IP / per-email register
 * limiters (`registerIpLimiter`, `registerEmailLimiter`) cap how many
 * times this code path can run per attacker per 15-minute window, so
 * the worst case without Redis is still a few rows per attacker — bounded.
 */
async function shouldRecordSignupSuppressionAudit(
  email: string,
): Promise<boolean> {
  const redis = getRedis();
  if (!redis) return true;
  const hash = hashEmailForSignupAudit(email);
  const auditKey = signupAuditGateKey(hash);
  const throttleKey = signupThrottleKey(hash);
  try {
    // Inherit the remaining TTL of the throttle key so the audit gate
    // expires together with the throttle window. PTTL returns:
    //   -2 = key does not exist (race: throttle expired between
    //        the suppress decision and this PTTL — rare; default to a
    //        full window so we still write at most one row over the
    //        next window's worth of suppressions),
    //   -1 = key exists but has no TTL (shouldn't happen for our keys;
    //        same default as -2),
    //   >0 = remaining ms.
    let ttlMs: number;
    try {
      const pttl = await redis.pttl(throttleKey);
      ttlMs =
        typeof pttl === "number" && pttl > 0
          ? pttl
          : resolveSignupAttemptedWindowSec() * 1000;
    } catch {
      ttlMs = resolveSignupAttemptedWindowSec() * 1000;
    }
    const result = await redis.set(auditKey, "1", "PX", ttlMs, "NX");
    return result === "OK";
  } catch (err) {
    console.error(
      "[AUTH] Redis error checking signup_attempted audit throttle:",
      err,
    );
    return true;
  }
}

/**
 * Write a single audit row recording that a signup_attempted notice was
 * suppressed by the throttle for `email` (a real existing-account address).
 * Subsequent suppressions for the same address within the same throttle
 * window collapse into this one row — see
 * `shouldRecordSignupSuppressionAudit`.
 *
 * The address is hashed AND masked into the row, never written in cleartext:
 *  - `metadata.emailHash` is a stable correlator so an admin can confirm
 *    multiple rows refer to the same target without exposing the address.
 *  - `metadata.maskedEmail` and the description carry the masked form so a
 *    human can tell at a glance which member is being probed.
 *
 * The source IP (when available) is recorded both in the audit row's
 * top-level `ipAddress` column (for the existing UI) via the
 * `logAuditEvent` ipAddress override, and surfaced in the description so
 * it shows up in the row summary without needing to expand the row.
 */
async function recordSignupNoticeSuppressed(opts: {
  email: string;
  ip?: string;
}): Promise<void> {
  const allowed = await shouldRecordSignupSuppressionAudit(opts.email);
  if (!allowed) return;
  const windowSec = resolveSignupAttemptedWindowSec();
  const hash = hashEmailForSignupAudit(opts.email);
  const masked = maskEmailForSignupAudit(opts.email);
  const ipLabel = opts.ip ?? "unknown";
  const windowHours = Math.max(1, Math.round(windowSec / 3600));
  await logAuditEvent({
    actionType: SIGNUP_NOTICE_SUPPRESSED_AUDIT_ACTION,
    entityType: SIGNUP_NOTICE_SUPPRESSED_AUDIT_ENTITY,
    entityId: hash,
    description: `Signup-attempted notice suppressed for ${masked} from ${ipLabel} — repeated probing of an existing account within the last ${windowHours}h`,
    metadata: {
      ip: opts.ip ?? null,
      emailHash: hash,
      maskedEmail: masked,
      windowSec,
    },
    // Use the ipAddress override rather than synthesising a Request: the
    // real Request carries the cleartext email in req.body.email and we
    // don't want any of it leaking onto the audit row.
    ipAddress: opts.ip ?? null,
  });
}

async function wasEmailRecentlyChanged(email: string): Promise<boolean> {
  const cutoff = new Date(Date.now() - EMAIL_CHANGE_HINT_WINDOW_MS);
  const [row] = await db
    .select({ id: emailChangeHistoryTable.id })
    .from(emailChangeHistoryTable)
    .where(
      and(
        eq(emailChangeHistoryTable.oldEmail, email),
        gt(emailChangeHistoryTable.changedAt, cutoff),
      ),
    )
    .orderBy(desc(emailChangeHistoryTable.changedAt))
    .limit(1);
  return Boolean(row);
}

// Per-identifier rate limits for the unauthenticated forgot-password endpoint.
// We log one row per dimension (email + IP) for each accepted request and count
// rows in the trailing windows to decide whether to accept the next attempt.
// The cap survives Redis being offline because it's enforced via the database.
const PASSWORD_RESET_EMAIL_HOURLY_LIMIT = 3;
const PASSWORD_RESET_EMAIL_DAILY_LIMIT = 10;
const PASSWORD_RESET_IP_HOURLY_LIMIT = 10;
const PASSWORD_RESET_IP_DAILY_LIMIT = 30;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
// Namespace for pg_advisory_xact_lock(int4, int4) so password-reset locks
// can never collide with advisory locks used elsewhere in the system.
const PASSWORD_RESET_LOCK_NAMESPACE = 842318;

function int32FromHexHash(hash: string): number {
  // Take the first 4 bytes of the sha256 hex digest and reinterpret as a
  // signed 32-bit integer for use as a Postgres advisory-lock key.
  return Buffer.from(hash.slice(0, 8), "hex").readInt32BE(0);
}

function hashIdentifier(kind: "email" | "ip", value: string): string {
  return crypto.createHash("sha256").update(`${kind}:${value}`).digest("hex");
}

/**
 * Reserve a slot in the password-reset rate limit. Returns `true` if the
 * caller is under both the per-email and per-IP caps and a row has been
 * recorded; `false` if either cap was already reached. The whole check +
 * insert runs in a single transaction guarded by per-identifier advisory
 * locks (sorted to avoid deadlocks) so concurrent requests targeting the
 * same email or IP cannot bypass the cap.
 */
async function reservePasswordResetSlot(
  emailHash: string,
  ipHash: string | null,
): Promise<boolean> {
  const now = new Date();
  const hourAgo = new Date(now.getTime() - HOUR_MS);
  const dayAgo = new Date(now.getTime() - DAY_MS);

  // NOTE: deliberately not named `emailKey`/`ipKey` — those are imported
  // functions from `../middleware/abuse-rate-limit` used at module scope by
  // the abuse-rate-limit middleware configs below. Reusing those names here
  // would shadow the imports inside this function and (more importantly)
  // make it dangerously easy for someone to refactor the module-scope
  // limiters into a helper that runs inside a function body — at which
  // point the call site would silently bind to one of these `number`s
  // instead of the resolver function and the rate limiter would crash at
  // request time. Keep these names distinct.
  const emailLockKey = int32FromHexHash(emailHash);
  const ipLockKey = ipHash ? int32FromHexHash(ipHash) : null;
  const lockKeys =
    ipLockKey != null
      ? [emailLockKey, ipLockKey].sort((a, b) => a - b)
      : [emailLockKey];

  return db.transaction(async (tx) => {
    let lastKey: number | null = null;
    for (const key of lockKeys) {
      if (lastKey !== null && key === lastKey) continue;
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(${PASSWORD_RESET_LOCK_NAMESPACE}, ${key})`,
      );
      lastKey = key;
    }

    const [emailCounts] = await tx
      .select({
        hour: sql<number>`count(*) filter (where ${passwordResetAttemptsTable.createdAt} >= ${hourAgo})`.mapWith(Number),
        day: sql<number>`count(*) filter (where ${passwordResetAttemptsTable.createdAt} >= ${dayAgo})`.mapWith(Number),
      })
      .from(passwordResetAttemptsTable)
      .where(
        and(
          eq(passwordResetAttemptsTable.identifierType, "email"),
          eq(passwordResetAttemptsTable.identifierHash, emailHash),
          gte(passwordResetAttemptsTable.createdAt, dayAgo),
        ),
      );

    if (
      (emailCounts?.hour ?? 0) >= PASSWORD_RESET_EMAIL_HOURLY_LIMIT ||
      (emailCounts?.day ?? 0) >= PASSWORD_RESET_EMAIL_DAILY_LIMIT
    ) {
      return false;
    }

    if (ipHash) {
      const [ipCounts] = await tx
        .select({
          hour: sql<number>`count(*) filter (where ${passwordResetAttemptsTable.createdAt} >= ${hourAgo})`.mapWith(Number),
          day: sql<number>`count(*) filter (where ${passwordResetAttemptsTable.createdAt} >= ${dayAgo})`.mapWith(Number),
        })
        .from(passwordResetAttemptsTable)
        .where(
          and(
            eq(passwordResetAttemptsTable.identifierType, "ip"),
            eq(passwordResetAttemptsTable.identifierHash, ipHash),
            gte(passwordResetAttemptsTable.createdAt, dayAgo),
          ),
        );

      if (
        (ipCounts?.hour ?? 0) >= PASSWORD_RESET_IP_HOURLY_LIMIT ||
        (ipCounts?.day ?? 0) >= PASSWORD_RESET_IP_DAILY_LIMIT
      ) {
        return false;
      }
    }

    const rows: { identifierType: string; identifierHash: string }[] = [
      { identifierType: "email", identifierHash: emailHash },
    ];
    if (ipHash) {
      rows.push({ identifierType: "ip", identifierHash: ipHash });
    }
    await tx.insert(passwordResetAttemptsTable).values(rows);

    return true;
  });
}

/**
 * Background worker for /auth/forgot-password. Enforces the per-email and
 * per-IP rate limit, and (if allowed) generates a reset token and sends the
 * password-reset email. Exported for tests so they can deterministically
 * await the work that the route handler dispatches asynchronously.
 */
export async function processForgotPasswordRequest(
  rawEmail: unknown,
  rawIp: string | undefined,
): Promise<void> {
  if (typeof rawEmail !== "string" || rawEmail.length === 0) return;

  const normalizedEmail = rawEmail.trim().toLowerCase();
  if (!normalizedEmail) return;

  const emailHash = hashIdentifier("email", normalizedEmail);
  const ipHash =
    rawIp && rawIp.length > 0 ? hashIdentifier("ip", rawIp) : null;

  let allowed: boolean;
  try {
    allowed = await reservePasswordResetSlot(emailHash, ipHash);
  } catch (err) {
    console.error("[AUTH] Password-reset rate-limit check failed:", err);
    return;
  }

  if (!allowed) {
    console.log(
      `[AUTH] Password reset request for ${normalizedEmail} suppressed by rate limit`,
    );
    await recordAuthRateLimitHit("forgot-password", {
      ip: rawIp,
      email: normalizedEmail,
    }).catch((err) =>
      console.error("[AUTH] Failed to record forgot-password rate-limit audit:", err),
    );
    return;
  }

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.email, normalizedEmail));
  if (!user) return;

  const resetToken = crypto.randomBytes(32).toString("hex");
  const resetTokenHash = crypto
    .createHash("sha256")
    .update(resetToken)
    .digest("hex");

  await db
    .update(usersTable)
    .set({
      resetToken: resetTokenHash,
      resetTokenExpires: new Date(Date.now() + 60 * 60 * 1000),
    })
    .where(eq(usersTable.id, user.id));

  console.log(`[AUTH] Password reset token for ${normalizedEmail}: ${resetToken}`);
  await CommunicationService.sendEmailNow({
    templateSlug: "password_reset",
    to: normalizedEmail,
    variables: { member_name: user.name, reset_token: resetToken },
    userId: user.id,
  }).catch((err) =>
    console.error("[AUTH] Failed to send password reset email:", err),
  );
}

const router: IRouter = Router();
const BCRYPT_ROUNDS = 12;

const COOKIE_BASE = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "strict" as const,
  path: "/",
};

function setAuthCookies(res: any, userId: number, email: string, refreshToken: string) {
  const accessToken = generateAccessToken(userId, email);

  res.cookie("access_token", accessToken, {
    ...COOKIE_BASE,
    maxAge: 15 * 60 * 1000,
  });

  res.cookie("refresh_token", refreshToken, {
    ...COOKIE_BASE,
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: "/api/auth",
  });

  const csrfToken = crypto.randomBytes(32).toString("hex");
  res.cookie("csrf_token", csrfToken, {
    httpOnly: false,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict" as const,
    path: "/",
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
}

async function createSession(
  userId: number,
  req: any,
  // When a refresh rotates an existing session (revoke old row + insert new),
  // pass the old row's `createdAt` so the new row keeps the original sign-in
  // time. `last_seen_at` is always stamped to now() (the DB default), so it
  // tracks the most recent activity while `created_at` stays the sign-in time.
  inheritCreatedAt?: Date,
): Promise<string> {
  const refreshToken = crypto.randomBytes(48).toString("hex");
  const refreshTokenHash = crypto.createHash("sha256").update(refreshToken).digest("hex");
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  await db.insert(sessionsTable).values({
    userId,
    refreshTokenHash,
    expiresAt,
    ipAddress: req.ip || req.connection?.remoteAddress,
    userAgent: req.headers["user-agent"] || null,
    ...(inheritCreatedAt ? { createdAt: inheritCreatedAt } : {}),
  });

  return refreshToken;
}

// Builds a human-friendly "Chrome on Windows" style label from a raw
// User-Agent header for the new-sign-in notification email. Best-effort only:
// User-Agent strings are unreliable, so we fall back to the raw string (or a
// generic label) rather than ever throwing or showing nothing.
function describeDevice(userAgent: string | null | undefined): string {
  const ua = (userAgent || "").trim();
  if (!ua) return "an unknown device";

  let browser: string | null = null;
  if (/\bEdg(?:e|A|iOS)?\//.test(ua)) browser = "Edge";
  else if (/\bOPR\/|\bOpera\b/.test(ua)) browser = "Opera";
  else if (/\bFirefox\//.test(ua)) browser = "Firefox";
  else if (/\bChrome\//.test(ua) && !/\bChromium\//.test(ua)) browser = "Chrome";
  else if (/\bChromium\//.test(ua)) browser = "Chromium";
  else if (/\bSafari\//.test(ua) && /\bVersion\//.test(ua)) browser = "Safari";

  let os: string | null = null;
  if (/\bWindows NT\b/.test(ua)) os = "Windows";
  else if (/\b(iPhone|iPad|iPod)\b/.test(ua)) os = "iOS";
  else if (/\bMac OS X\b/.test(ua)) os = "macOS";
  else if (/\bAndroid\b/.test(ua)) os = "Android";
  else if (/\bLinux\b/.test(ua)) os = "Linux";

  if (browser && os) return `${browser} on ${os}`;
  if (browser) return browser;
  if (os) return os;
  return ua.length > 120 ? `${ua.slice(0, 117)}...` : ua;
}

// Decides whether the current request is signing in from a device we haven't
// seen before for this user. "Device" is keyed on the User-Agent string: a
// device is recognized if any prior session row (active OR revoked) for the
// user shares the same User-Agent. We deliberately do NOT key on IP — member
// IPs rotate constantly (mobile networks, ISPs), which would make the notice
// far too noisy. The very first sign-in (no prior sessions at all) is treated
// as NOT new, so members aren't emailed a "new device" notice moments after
// verifying a brand-new account.
//
// Must be called BEFORE createSession inserts the new row, otherwise the
// just-created session would count as a prior match and every login would
// look "known".
async function isNewDeviceSignin(userId: number, req: Request): Promise<boolean> {
  const userAgent = req.headers["user-agent"] || null;
  const priorSessions = await db
    .select({ userAgent: sessionsTable.userAgent })
    .from(sessionsTable)
    .where(eq(sessionsTable.userId, userId));

  if (priorSessions.length === 0) return false;
  return !priorSessions.some((s) => s.userAgent === userAgent);
}

// Sends the "new sign-in detected" security notice. Queued (with the service's
// own direct-send fallback) so a slow/unavailable mailer never blocks or fails
// the login response. Errors are swallowed for the same reason — a failed
// notification must not break authentication.
async function sendNewDeviceNotice(
  user: { id: number; email: string; name: string },
  req: Request,
): Promise<void> {
  try {
    const ip = req.ip || req.connection?.remoteAddress || "unknown";
    await CommunicationService.queueEmail({
      templateSlug: "new_device_signin",
      to: user.email,
      userId: user.id,
      variables: {
        member_name: user.name,
        device_description: describeDevice(req.headers["user-agent"]),
        ip_address: ip,
        sign_in_time: new Date().toUTCString(),
      },
    });
  } catch (err) {
    console.error(`[Auth] Failed to send new-device notice to user ${user.id}:`, err);
  }
}

const REGISTER_LIMITS = {
  perIp: { max: 5, windowSeconds: 15 * 60 },
  perEmail: { max: 3, windowSeconds: 15 * 60 },
} as const;

const registerIpLimiter = abuseRateLimit({
  name: "register",
  maxRequests: REGISTER_LIMITS.perIp.max,
  windowSeconds: REGISTER_LIMITS.perIp.windowSeconds,
  keyResolver: ipKey("register"),
  message: "Too many requests. Please try again later.",
});

// Exported for the regression test in `auth-rate-limit.test.ts` that locks
// in: (a) constructing the per-email register limiter at module load does
// not throw, and (b) the per-email register limit is configured (max == 3).
// This guards against the historical bug where `emailKey` here resolved to
// a local `number` from another function, crashing the auth router on
// import.
export const REGISTER_EMAIL_LIMIT_MAX = REGISTER_LIMITS.perEmail.max;
export const registerEmailLimiter = abuseRateLimit({
  name: "register",
  maxRequests: REGISTER_LIMITS.perEmail.max,
  windowSeconds: REGISTER_LIMITS.perEmail.windowSeconds,
  keyResolver: emailKey("register", "email"),
  message: "Too many requests. Please try again later.",
});

// Generic message returned by /auth/register on every accepted attempt,
// regardless of whether the email is new or already in use. This is the
// anti-enumeration response: the only way to learn anything about a target
// address is to actually receive mail at it.
const REGISTER_GENERIC_MESSAGE =
  "If that email isn't already registered, we sent a link to confirm your account. Otherwise, check your inbox for a sign-in reminder.";

/**
 * Background worker for /auth/register. Runs after the route handler has
 * already returned the generic 200 response, so its outcome is invisible to
 * the caller — preventing email-enumeration via response shape OR timing.
 *
 * - If the email is brand new: create the user, send the verification email.
 * - If the email is already registered: send the existing owner a "someone
 *   tried to sign up with your email" notice and otherwise do nothing. The
 *   caller cannot tell which path ran.
 *
 * Exported for tests so they can deterministically await the work that the
 * route handler dispatches asynchronously.
 */
export async function processRegisterRequest(params: {
  email: string;
  password: string;
  name: string;
  phone?: string | null;
  // Source IP of the original /auth/register POST. Surfaced into the
  // audit row written when the signup_attempted throttle suppresses a
  // notice, so admins can see who's probing a member's address. Optional
  // because (a) tests call this helper directly without a request, and
  // (b) the underlying req.ip can be undefined in pathological proxy
  // setups; either way, an absent IP just shows up as "unknown" on the
  // audit row rather than blocking the audit write.
  ip?: string;
}): Promise<void> {
  const { email, password, name, phone, ip } = params;
  const normalizedEmail = email.toLowerCase();

  const [existing] = await db
    .select({ id: usersTable.id, name: usersTable.name, email: usersTable.email })
    .from(usersTable)
    .where(eq(usersTable.email, normalizedEmail));

  if (existing) {
    // Notify the existing owner so they can react if they didn't initiate
    // the signup (e.g. someone is probing their address, or they forgot
    // they already had an account and should sign in / reset instead).
    // The throttle below is what stops an attacker from spamming /register
    // with this address to flood the inbox: only the first attempt per
    // window actually sends mail; subsequent attempts are silent no-ops.
    if (await shouldSendSignupAttemptedNotice(existing.email)) {
      console.log(
        `[AUTH] Signup attempted on existing email ${normalizedEmail}; notifying owner`,
      );
      await CommunicationService.sendEmailNow({
        templateSlug: "signup_attempted",
        to: existing.email,
        variables: {
          member_name: existing.name,
          member_email: existing.email,
          // URL-encoded so the address survives ?email= round-trip in the
          // email's "Sign In" / "Reset Password" CTAs (preserves +, etc.)
          member_email_encoded: encodeURIComponent(existing.email),
        },
        userId: existing.id,
      }).catch((err) =>
        console.error("[AUTH] Failed to send signup_attempted notice:", err),
      );
    } else {
      console.log(
        `[AUTH] Signup attempted on existing email ${normalizedEmail}; notice suppressed by throttle`,
      );
      // Record one audit row per window so admins can see targeted probing
      // from the existing Audit Log UI. Subsequent suppressions in the same
      // window collapse into the row already written by the first call —
      // see `shouldRecordSignupSuppressionAudit` for the dedup gate.
      await recordSignupNoticeSuppressed({
        email: existing.email,
        ip,
      }).catch((err) =>
        console.error(
          "[AUTH] Failed to record signup_notice_suppressed audit:",
          err,
        ),
      );
    }
    return;
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const emailVerifyToken = crypto.randomBytes(32).toString("hex");
  const emailVerifyExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);

  let user;
  try {
    [user] = await db.insert(usersTable).values({
      name,
      email: normalizedEmail,
      passwordHash,
      phone: phone || null,
      emailVerified: false,
      emailVerifyToken,
      emailVerifyExpires,
    }).returning();
  } catch (err) {
    // Race: another concurrent request just inserted the same email.
    // Fall back to the existing-user path (notify the owner) so the
    // outcome is still indistinguishable from the outside.
    const [raced] = await db
      .select({ id: usersTable.id, name: usersTable.name, email: usersTable.email })
      .from(usersTable)
      .where(eq(usersTable.email, normalizedEmail));
    if (raced) {
      // Same throttle as the non-race path above — keep them in sync so an
      // attacker can't bypass the cap by repeatedly racing the insert.
      if (await shouldSendSignupAttemptedNotice(raced.email)) {
        await CommunicationService.sendEmailNow({
          templateSlug: "signup_attempted",
          to: raced.email,
          variables: {
            member_name: raced.name,
            member_email: raced.email,
            member_email_encoded: encodeURIComponent(raced.email),
          },
          userId: raced.id,
        }).catch((e) =>
          console.error("[AUTH] Failed to send signup_attempted notice after race:", e),
        );
      } else {
        // Same suppression-audit hook as the non-race path so racing the
        // insert can't be used to evade the audit row either.
        await recordSignupNoticeSuppressed({
          email: raced.email,
          ip,
        }).catch((err) =>
          console.error(
            "[AUTH] Failed to record signup_notice_suppressed audit after race:",
            err,
          ),
        );
      }
      return;
    }
    throw err;
  }

  console.log(`[AUTH] Email verification token for ${normalizedEmail}: ${emailVerifyToken}`);
  await CommunicationService.sendEmailNow({
    templateSlug: "email_verification",
    to: normalizedEmail,
    variables: { member_name: name, verify_token: emailVerifyToken },
    userId: user.id,
  }).catch((err) =>
    console.error("[AUTH] Failed to send email_verification:", err),
  );

  // A self-registered account has no product grants yet, so this always
  // resolves to "none" — onboarding is bypassed and the member is enrolled
  // in nurture_frontend_to_upgrade. Still must run for every new user (not
  // just paid signups) so the persisted onboardingVariant/onboardingComplete
  // state is always resolved exactly once at creation (Task #1640).
  await applyCreationTimeOnboardingDefaults(user.id).catch((err) =>
    console.error(`[AUTH] Failed to apply onboarding defaults for new user ${user.id}:`, err),
  );

  emitWebhookEvent("member.created", {
    user_id: user.id,
    email: user.email,
    name: user.name,
  }).catch(() => {});
}

// Rate limiters before `verifyCaptcha()` for the same reasons documented on
// the /auth/login route below: a 429 must short-circuit before we burn a
// Turnstile siteverify call (which would (a) hit Cloudflare's API on every
// blocked request under attack and (b) consume the user's single-use token,
// forcing a re-solve on retry).
router.post("/auth/register", registerIpLimiter, registerEmailLimiter, verifyCaptcha(), async (req, res): Promise<void> => {
  const { email, password, name, phone } = req.body;

  if (!email || !password || !name) {
    res.status(400).json({ error: "Email, password, and name are required" });
    return;
  }

  if (password.length < 8 || !/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
    res.status(400).json({ error: "Password must be at least 8 characters with at least 1 letter and 1 number" });
    return;
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    res.status(400).json({ error: "Invalid email format" });
    return;
  }

  // Always respond with the same generic message, regardless of whether the
  // email is new or already registered. The actual work runs fire-and-forget
  // so the response timing can't be used as an enumeration oracle either.
  res.status(200).json({ message: REGISTER_GENERIC_MESSAGE });

  void processRegisterRequest({ email, password, name, phone, ip: req.ip }).catch((err) =>
    console.error("[AUTH] Unexpected error processing register:", err),
  );
});

const LOGIN_LIMITS = {
  perIp: { max: 20, windowSeconds: 15 * 60 },
} as const;

const loginIpLimiter = abuseRateLimit({
  name: "login",
  maxRequests: LOGIN_LIMITS.perIp.max,
  windowSeconds: LOGIN_LIMITS.perIp.windowSeconds,
  keyResolver: ipKey("login"),
  message: "Too many login attempts. Please try again later.",
  onLimitExceeded: (req) =>
    recordAuthRateLimitHit("login", { req, email: extractAuthEmail(req) }),
});

// MIDDLEWARE ORDER MATTERS: rate limiter MUST run BEFORE `verifyCaptcha()`.
//
// Two consequences flow from this ordering:
//   1. When a request is over its per-IP budget we 429 immediately without
//      calling Cloudflare's siteverify endpoint. Under a real attack that
//      would otherwise mean one outbound HTTPS round-trip per blocked
//      request — easy to push past Turnstile's API quota and slow every
//      request down on top.
//   2. Cloudflare consumes a Turnstile token the moment we POST it to
//      siteverify; tokens are single-use. Skipping that call when we're
//      about to 429 leaves the token unused, so a user who got rate-
//      limited briefly can re-submit with the same token instead of being
//      forced to solve a fresh challenge. (See the matching portal logic in
//      `pages/Login.tsx` — it deliberately does NOT reset the widget on a
//      429 response so this saving actually reaches the user.)
//
// Reversing the order would defeat both. Add `verifyCaptcha()` AFTER the
// limiter for /auth/register and /auth/forgot-password as well.
router.post("/auth/login", loginIpLimiter, verifyCaptcha(), async (req, res): Promise<void> => {
  const { email, password } = req.body;

  if (!email || !password) {
    res.status(400).json({ error: "Email and password are required" });
    return;
  }

  const normalizedEmail = email.toLowerCase();
  const [user] = await db.select().from(usersTable).where(eq(usersTable.email, normalizedEmail));

  // Helper to send a 401 plus an optional, rate-limited hint that the entered email
  // was recently changed. We expose this on every failed-credentials path so that a
  // wrong password and an unknown email look identical from the outside.
  const respondInvalidCredentials = async (): Promise<void> => {
    const body: { error: string; emailRecentlyChanged?: boolean } = {
      error: "Invalid credentials",
    };
    const recentlyChanged = await wasEmailRecentlyChanged(normalizedEmail);
    if (recentlyChanged && (await shouldExposeEmailChangedHint(req.ip))) {
      body.emailRecentlyChanged = true;
    }
    res.status(401).json(body);
  };

  if (!user) {
    await respondInvalidCredentials();
    return;
  }

  if (user.lockedUntil && user.lockedUntil > new Date()) {
    const minutesLeft = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60000);
    res.status(423).json({ error: `Account temporarily locked. Try again in ${minutesLeft} minute(s).` });
    return;
  }

  // If a previous lock window has elapsed, the 5-strike budget refreshes:
  // the next attempt starts from a clean counter rather than ticking up from
  // the pre-lock total (which would re-lock the account on a single mistype).
  const lockExpired = Boolean(user.lockedUntil && user.lockedUntil <= new Date());
  const priorFailedCount = lockExpired ? 0 : (user.failedLoginCount || 0);

  const passwordValid = await bcrypt.compare(password, user.passwordHash);
  if (!passwordValid) {
    const newCount = priorFailedCount + 1;
    const updates: any = { failedLoginCount: newCount, lockedUntil: null };
    if (newCount >= 5) {
      updates.lockedUntil = new Date(Date.now() + 15 * 60 * 1000);
    }
    await db.update(usersTable).set(updates).where(eq(usersTable.id, user.id));
    await respondInvalidCredentials();
    return;
  }

  // Password was correct — but if the account hasn't completed email
  // verification yet (post-Task #154 register flow), we refuse to mint a
  // session. Returning a verification-specific 403 instead of the generic
  // 401 lets the SPA show a "your account isn't verified" banner with a
  // resend button. We still clear the failed-login counter because the
  // password attempt itself was legitimate; otherwise an unverified user
  // could lock themselves out by retrying. We deliberately do NOT update
  // lastLoginAt — they didn't actually log in.
  if (!user.emailVerified) {
    if (priorFailedCount > 0 || user.lockedUntil) {
      await db
        .update(usersTable)
        .set({ failedLoginCount: 0, lockedUntil: null })
        .where(eq(usersTable.id, user.id));
    }
    res.status(403).json({
      error:
        "Your account isn't verified yet. Check your inbox for the verification link, or request a new one below.",
      emailUnverified: true,
    });
    return;
  }

  const now = new Date();
  await db.update(usersTable).set({
    failedLoginCount: 0,
    lockedUntil: null,
    lastLoginAt: now,
  }).where(eq(usersTable.id, user.id));

  const lastLogin = user.lastLoginAt;
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  if (!lastLogin || lastLogin < oneDayAgo) {
    await queueGHLSync({
      action: "update_contact",
      userId: user.id,
      email: user.email,
      customFields: {
        last_portal_login: now.toISOString(),
      },
    });
  }

  // Check for an unfamiliar device BEFORE creating the session row, so the
  // row we're about to insert can't count itself as a "known" device.
  const newDevice = await isNewDeviceSignin(user.id, req);

  const refreshToken = await createSession(user.id, req);
  setAuthCookies(res, user.id, user.email, refreshToken);

  if (newDevice) {
    await sendNewDeviceNotice(
      { id: user.id, email: user.email, name: user.name },
      req,
    );
  }

  res.json({ id: user.id, email: user.email, name: user.name, role: user.role, onboardingComplete: user.onboardingComplete, onboardingStep: user.onboardingStep, onboardingVariant: user.onboardingVariant, mustChangePassword: user.mustChangePassword, timezone: user.timezone });
});

router.post("/auth/refresh", async (req, res): Promise<void> => {
  const token = req.cookies?.refresh_token;
  if (!token) {
    res.status(401).json({ error: "No refresh token" });
    return;
  }

  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const [session] = await db.select().from(sessionsTable).where(
    and(
      eq(sessionsTable.refreshTokenHash, tokenHash),
      isNull(sessionsTable.revokedAt),
      gt(sessionsTable.expiresAt, new Date())
    )
  );

  if (!session) {
    res.status(401).json({ error: "Invalid or expired refresh token" });
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, session.userId));
  if (!user) {
    // The session row points at a user that no longer exists (the user was
    // hard-deleted out from under it — operationally rare, but possible
    // after a manual fix-up). Revoke this orphaned row inline so it can't
    // keep showing up on every refresh attempt and won't sit around in the
    // sessions table waiting for `auth-token-cleanup` to expire it.
    await db
      .update(sessionsTable)
      .set({ revokedAt: new Date() })
      .where(eq(sessionsTable.id, session.id));
    res.status(401).json({ error: "User not found" });
    return;
  }

  await db.update(sessionsTable).set({ revokedAt: new Date() }).where(eq(sessionsTable.id, session.id));

  // Carry the original sign-in time forward across the rotation so the new
  // row's `created_at` keeps representing when this session began; its
  // `last_seen_at` is stamped to now() so admins can see recent activity.
  const newRefreshToken = await createSession(user.id, req, session.createdAt);
  setAuthCookies(res, user.id, user.email, newRefreshToken);

  res.json({ id: user.id, email: user.email, name: user.name, role: user.role, onboardingComplete: user.onboardingComplete, onboardingStep: user.onboardingStep, onboardingVariant: user.onboardingVariant, mustChangePassword: user.mustChangePassword, timezone: user.timezone });
});

router.post("/auth/logout", async (req, res): Promise<void> => {
  const token = req.cookies?.refresh_token;
  if (token) {
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    await db.update(sessionsTable).set({ revokedAt: new Date() }).where(eq(sessionsTable.refreshTokenHash, tokenHash));
  }

  // If there is a stale impersonation restore token, revoke its session row
  // and clear the cookie so it cannot be used after logout to obtain admin
  // cookies via /admin/impersonate/stop.
  const restoreToken = req.cookies?.imp_restore_token;
  if (restoreToken) {
    const restoreHash = crypto.createHash("sha256").update(restoreToken).digest("hex");
    await db.update(sessionsTable).set({ revokedAt: new Date() }).where(eq(sessionsTable.refreshTokenHash, restoreHash));
  }

  res.clearCookie("access_token", { path: "/" });
  res.clearCookie("refresh_token", { path: "/api/auth" });
  res.clearCookie("csrf_token", { path: "/" });
  res.clearCookie("imp_restore_token", { path: "/" });
  res.json({ success: true });
});

// IP-based, Redis-backed limiter for the /auth/reset-password endpoint
// (brought in alongside Task #91). The matching forgot-password limiters
// live below; that endpoint additionally enforces a DB-backed cap inside
// `processForgotPasswordRequest` so the floor still holds when Redis is
// offline (Task #91 spec).
const RESET_PASSWORD_LIMITS = {
  perIp: { max: 10, windowSeconds: 15 * 60 },
} as const;

const resetPasswordIpLimiter = abuseRateLimit({
  name: "reset-password",
  maxRequests: RESET_PASSWORD_LIMITS.perIp.max,
  windowSeconds: RESET_PASSWORD_LIMITS.perIp.windowSeconds,
  keyResolver: ipKey("reset-password"),
  message: "Too many password reset attempts. Please try again later.",
  // /auth/reset-password posts a token, not an email, so we only have the IP
  // to identify the source. The audit row still includes endpoint + IP so an
  // admin can correlate it with simultaneous /forgot-password or /login hits.
  onLimitExceeded: (req) => recordAuthRateLimitHit("reset-password", { req }),
});

// Redis-backed limiters for the /auth/forgot-password endpoint. We need a
// synchronous 429 (within the same request) when an attacker bursts past the
// per-IP or per-email cap — the previous design called the DB-backed limiter
// fire-and-forget, so the response went out as 200 even on rate-limited
// hits. The DB-backed `processForgotPasswordRequest` still runs after a 200
// to keep its enforcement floor in place when Redis is offline.
const FORGOT_PASSWORD_LIMITS = {
  perIp: { max: 10, windowSeconds: 60 * 60 },
  perEmail: { max: 5, windowSeconds: 60 * 60 },
} as const;

const forgotPasswordIpLimiter = abuseRateLimit({
  name: "forgot-password",
  maxRequests: FORGOT_PASSWORD_LIMITS.perIp.max,
  windowSeconds: FORGOT_PASSWORD_LIMITS.perIp.windowSeconds,
  keyResolver: ipKey("forgot-password"),
  message: "Too many password reset attempts. Please try again later.",
  onLimitExceeded: (req) =>
    recordAuthRateLimitHit("forgot-password", {
      req,
      email: extractAuthEmail(req),
    }),
});

const forgotPasswordEmailLimiter = abuseRateLimit({
  name: "forgot-password",
  maxRequests: FORGOT_PASSWORD_LIMITS.perEmail.max,
  windowSeconds: FORGOT_PASSWORD_LIMITS.perEmail.windowSeconds,
  keyResolver: emailKey("forgot-password", "email"),
  message: "Too many password reset attempts. Please try again later.",
  onLimitExceeded: (req) =>
    recordAuthRateLimitHit("forgot-password", {
      req,
      email: extractAuthEmail(req),
    }),
});

// Rate limiters before `verifyCaptcha()` for the same reasons documented on
// the /auth/login route: skip the Cloudflare siteverify call on requests
// we're about to 429, both to spare Turnstile's API budget under attack and
// to leave the user's single-use token unused for a quick retry.
router.post(
  "/auth/forgot-password",
  forgotPasswordIpLimiter,
  forgotPasswordEmailLimiter,
  verifyCaptcha(),
  async (req, res): Promise<void> => {
    // Always return the same friendly response when we don't 429, regardless
    // of whether the email exists. This avoids leaking which addresses have
    // an account.
    res.json({ message: "If that email exists, we sent a reset link." });

    // Fire-and-forget the actual work so the 200 response timing is the same
    // on every accepted call. The DB-backed cap inside the helper still runs
    // here to keep enforcement when Redis is offline.
    void processForgotPasswordRequest(req.body?.email, req.ip).catch((err) =>
      console.error("[AUTH] Unexpected error processing forgot-password:", err),
    );
  },
);

router.post("/auth/reset-password", resetPasswordIpLimiter, async (req, res): Promise<void> => {
  const { token, password } = req.body;

  if (!token || !password) {
    res.status(400).json({ error: "Token and new password are required" });
    return;
  }

  if (password.length < 8 || !/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
    res.status(400).json({ error: "Password must be at least 8 characters with at least 1 letter and 1 number" });
    return;
  }

  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const [user] = await db.select().from(usersTable).where(
    and(
      eq(usersTable.resetToken, tokenHash),
      gt(usersTable.resetTokenExpires, new Date())
    )
  );

  if (!user) {
    res.status(400).json({ error: "Invalid or expired reset token" });
    return;
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  await db.update(usersTable).set({
    passwordHash,
    resetToken: null,
    resetTokenExpires: null,
  }).where(eq(usersTable.id, user.id));

  await db.update(sessionsTable).set({ revokedAt: new Date() }).where(eq(sessionsTable.userId, user.id));

  res.clearCookie("access_token", { path: "/" });
  res.clearCookie("refresh_token", { path: "/api/auth" });
  res.clearCookie("csrf_token", { path: "/" });

  res.json({ message: "Password updated successfully. Please log in." });
});

// Anti-enumeration generic message for /auth/resend-verification. Sent on
// every accepted (non-rate-limited) request regardless of whether the email
// matched a real account or whether that account was already verified, so
// callers can't probe for membership/verification state via this endpoint.
const RESEND_VERIFICATION_GENERIC_MESSAGE =
  "If that email is registered and not yet verified, we sent a new verification link.";

const RESEND_VERIFICATION_LIMITS = {
  perIp: { max: 10, windowSeconds: 60 * 60 },
  perEmail: { max: 3, windowSeconds: 60 * 60 },
} as const;

const resendVerificationIpLimiter = abuseRateLimit({
  name: "resend-verification",
  maxRequests: RESEND_VERIFICATION_LIMITS.perIp.max,
  windowSeconds: RESEND_VERIFICATION_LIMITS.perIp.windowSeconds,
  keyResolver: ipKey("resend-verification"),
  message: "Too many verification email requests. Please try again later.",
  onLimitExceeded: (req) =>
    recordAuthRateLimitHit("resend-verification", {
      req,
      email: extractAuthEmail(req),
    }),
});

const resendVerificationEmailLimiter = abuseRateLimit({
  name: "resend-verification",
  maxRequests: RESEND_VERIFICATION_LIMITS.perEmail.max,
  windowSeconds: RESEND_VERIFICATION_LIMITS.perEmail.windowSeconds,
  keyResolver: emailKey("resend-verification", "email"),
  message: "Too many verification email requests. Please try again later.",
  onLimitExceeded: (req) =>
    recordAuthRateLimitHit("resend-verification", {
      req,
      email: extractAuthEmail(req),
    }),
});

/**
 * Background worker for /auth/resend-verification. Runs after the route
 * handler has already returned the generic 200 so its outcome is invisible
 * to the caller. Behavior:
 *   - User exists and is unverified → mint a fresh email-verification token
 *     (invalidating any previous one) and send the email_verification email.
 *   - User exists and is already verified → no-op.
 *   - User doesn't exist → no-op.
 *
 * Exported so tests can deterministically await the work the route handler
 * dispatches asynchronously.
 */
export async function processResendVerificationRequest(
  rawEmail: unknown,
): Promise<void> {
  if (typeof rawEmail !== "string") return;
  const normalizedEmail = rawEmail.trim().toLowerCase();
  if (!normalizedEmail) return;

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.email, normalizedEmail));
  if (!user) return;
  if (user.emailVerified) return;

  const emailVerifyToken = crypto.randomBytes(32).toString("hex");
  const emailVerifyExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);

  await db
    .update(usersTable)
    .set({ emailVerifyToken, emailVerifyExpires })
    .where(eq(usersTable.id, user.id));

  // Note: do NOT log the raw verify_token. The token is a live credential —
  // anyone who reads it (log aggregator, error reporter, console capture)
  // could complete the email-verification step on this user's behalf. The
  // log here records the action and the recipient so operators can correlate
  // a "resend" event with delivery, without exposing the secret itself.
  console.log(`[AUTH] Resent email verification email to ${normalizedEmail}`);
  await CommunicationService.sendEmailNow({
    templateSlug: "email_verification",
    to: normalizedEmail,
    variables: { member_name: user.name, verify_token: emailVerifyToken },
    userId: user.id,
  }).catch((err) =>
    console.error("[AUTH] Failed to resend email_verification:", err),
  );
}

router.post(
  "/auth/resend-verification",
  resendVerificationIpLimiter,
  resendVerificationEmailLimiter,
  async (req, res): Promise<void> => {
    // Always return the same generic 200 — both for a real unverified
    // account and for an unknown/already-verified email — so this endpoint
    // can't be used to probe membership or verification state.
    res.status(200).json({ message: RESEND_VERIFICATION_GENERIC_MESSAGE });

    void processResendVerificationRequest(req.body?.email).catch((err) =>
      console.error(
        "[AUTH] Unexpected error processing resend-verification:",
        err,
      ),
    );
  },
);

router.post("/auth/verify-email", async (req, res): Promise<void> => {
  const { token } = req.body;
  if (!token) {
    res.status(400).json({ error: "Token is required" });
    return;
  }

  const [user] = await db.select().from(usersTable).where(
    and(
      eq(usersTable.emailVerifyToken, token),
      gt(usersTable.emailVerifyExpires, new Date())
    )
  );

  if (!user) {
    res.status(400).json({ error: "Invalid or expired verification token" });
    return;
  }

  await db.update(usersTable).set({
    emailVerified: true,
    emailVerifyToken: null,
    emailVerifyExpires: null,
  }).where(eq(usersTable.id, user.id));

  emitWebhookEvent("member.verified", {
    user_id: user.id,
    email: user.email,
  }).catch(() => {});

  res.json({ message: "Email verified successfully" });
});

router.post("/auth/verify-email-change", async (req, res): Promise<void> => {
  const { token } = req.body ?? {};
  if (!token || typeof token !== "string") {
    res.status(400).json({ error: "Token is required" });
    return;
  }

  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.emailChangeToken, tokenHash));

  if (!user || !user.pendingEmail) {
    res.status(400).json({ error: "Invalid or expired verification link" });
    return;
  }

  if (!user.emailChangeExpires || user.emailChangeExpires <= new Date()) {
    // Token is expired — clear the stale pending change so the member isn't
    // stuck with a phantom pending email and can request a fresh change.
    await db
      .update(usersTable)
      .set({ pendingEmail: null, emailChangeToken: null, emailChangeExpires: null })
      .where(eq(usersTable.id, user.id));
    res.status(400).json({ error: "Invalid or expired verification link" });
    return;
  }

  const newEmail = user.pendingEmail.toLowerCase();
  const oldEmail = user.email;

  // Race-condition safety: ensure no one else grabbed this address while the link sat in inbox.
  const [conflict] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.email, newEmail))
    .limit(1);
  if (conflict && conflict.id !== user.id) {
    await db
      .update(usersTable)
      .set({ pendingEmail: null, emailChangeToken: null, emailChangeExpires: null })
      .where(eq(usersTable.id, user.id));
    res
      .status(400)
      .json({ error: "That email address is no longer available. Please request a new change." });
    return;
  }

  await db
    .update(usersTable)
    .set({
      email: newEmail,
      emailVerified: true,
      pendingEmail: null,
      emailChangeToken: null,
      emailChangeExpires: null,
    })
    .where(eq(usersTable.id, user.id));

  // Record the change so /auth/login can hint a stranded user toward their new address.
  await db.insert(emailChangeHistoryTable).values({
    userId: user.id,
    oldEmail,
    newEmail,
  });

  // Audit trail: record the successful confirmation against the user
  // entity so the admin Member Detail click-through panel (which scopes
  // audit rows by entityType=user / entityId=memberId) shows the
  // confirmation alongside the matching request_email_change row. Both
  // addresses are surfaced as structured fields so the PII redactor can
  // scrub them for non-PII viewers; the description includes them inline
  // so the audit-log row is self-explanatory without expansion.
  await logAuditEvent({
    actorId: user.id,
    actorEmail: newEmail,
    actionType: "confirm_email_change",
    entityType: "user",
    entityId: String(user.id),
    description: `Member confirmed email change from ${oldEmail} to ${newEmail}`,
    metadata: {
      oldEmail,
      newEmail,
    },
    req,
  });

  // Force re-login on every device with the updated address.
  await db
    .update(sessionsTable)
    .set({ revokedAt: new Date() })
    .where(and(eq(sessionsTable.userId, user.id), isNull(sessionsTable.revokedAt)));

  // Push the new contact email to GHL so CRM stays in sync.
  queueGHLSync({
    action: "update_contact",
    userId: user.id,
    email: newEmail,
  }).catch(() => {});

  emitWebhookEvent("member.email_changed" as WebhookEventType, {
    user_id: user.id,
    old_email: oldEmail,
    new_email: newEmail,
  }).catch(() => {});

  res.json({
    message:
      "Email updated successfully. Please sign in again with your new email address.",
    email: newEmail,
  });
});

router.get("/auth/me", async (req, res): Promise<void> => {
  if (!req.userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  const [user] = await db.select({
    id: usersTable.id,
    email: usersTable.email,
    name: usersTable.name,
    role: usersTable.role,
    onboardingComplete: usersTable.onboardingComplete,
    onboardingStep: usersTable.onboardingStep,
    onboardingVariant: usersTable.onboardingVariant,
    mustChangePassword: usersTable.mustChangePassword,
    timezone: usersTable.timezone,
  }).from(usersTable).where(eq(usersTable.id, req.userId));

  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  // Surface impersonation context so the portal can show the banner.
  if (req.isImpersonation && req.impersonatedBy) {
    const [adminUser] = await db
      .select({ id: usersTable.id, name: usersTable.name })
      .from(usersTable)
      .where(eq(usersTable.id, req.impersonatedBy))
      .limit(1);
    res.json({
      ...user,
      isImpersonation: true,
      impersonatedBy: adminUser ? { id: adminUser.id, name: adminUser.name } : { id: req.impersonatedBy, name: "Admin" },
    });
    return;
  }

  res.json(user);
});

// Resolve the session row backing the current request from the refresh_token
// cookie. The refresh cookie is scoped to `/api/auth`, so it IS sent to these
// /auth/sessions endpoints (which live under that path) even though the JWT
// access token is what authenticates the request. We use it only to flag
// "this device" and to spare the current session from "sign out everywhere
// else" — if it's missing or stale, callers just won't have a current row.
function getCurrentSessionHash(req: Request): string | null {
  const token = (req as any).cookies?.refresh_token;
  if (!token) return null;
  return crypto.createHash("sha256").update(token).digest("hex");
}

// Member self-service: list the authenticated user's own active sign-in
// sessions. Mirrors the admin Active-sessions card (admin-panel.ts) but scoped
// to req.userId so a member can only ever see their own devices.
router.get("/auth/sessions", async (req, res): Promise<void> => {
  if (!req.userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const currentHash = getCurrentSessionHash(req);

  const rows = await db
    .select({
      id: sessionsTable.id,
      createdAt: sessionsTable.createdAt,
      lastSeenAt: sessionsTable.lastSeenAt,
      ipAddress: sessionsTable.ipAddress,
      userAgent: sessionsTable.userAgent,
      refreshTokenHash: sessionsTable.refreshTokenHash,
    })
    .from(sessionsTable)
    .where(
      and(
        eq(sessionsTable.userId, req.userId),
        isNull(sessionsTable.revokedAt),
        gt(sessionsTable.expiresAt, new Date()),
      ),
    )
    .orderBy(desc(sessionsTable.lastSeenAt));

  const sessions = rows.map((r) => ({
    id: r.id,
    createdAt: r.createdAt,
    lastSeenAt: r.lastSeenAt,
    ipAddress: r.ipAddress,
    userAgent: r.userAgent,
    current: currentHash !== null && r.refreshTokenHash === currentHash,
  }));

  res.json({ sessions });
});

// Member self-service: end one of the authenticated user's own sessions.
// Scoped to req.userId so a member can't revoke a session they don't own by
// guessing IDs. Only acts on a still-active session so the response is
// meaningful. Ending the current session is allowed — the member's access
// token stays valid until it expires (≤15m), then refresh fails and they're
// signed out, matching the admin revoke-single behaviour.
router.post("/auth/sessions/:sessionId/revoke", async (req, res): Promise<void> => {
  if (!req.userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const sessionId = parseInt(req.params.sessionId, 10);
  if (isNaN(sessionId)) {
    res.status(400).json({ error: "Invalid session ID" });
    return;
  }

  const [session] = await db
    .select({ id: sessionsTable.id })
    .from(sessionsTable)
    .where(and(eq(sessionsTable.id, sessionId), eq(sessionsTable.userId, req.userId)))
    .limit(1);
  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  const revoked = await db
    .update(sessionsTable)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(sessionsTable.id, sessionId),
        eq(sessionsTable.userId, req.userId),
        isNull(sessionsTable.revokedAt),
      ),
    )
    .returning({ id: sessionsTable.id });

  res.json({ success: true, sessionId, revoked: revoked.length > 0 });
});

// Member self-service: "Sign out everywhere except this device". Revokes all
// of the authenticated user's active sessions except the one backing the
// current request, so the member stays signed in here while every other
// device is signed out. If the current session can't be resolved from the
// refresh cookie, we revoke nothing rather than risk signing the member out
// of their own current device.
router.post("/auth/sessions/revoke-others", async (req, res): Promise<void> => {
  if (!req.userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const currentHash = getCurrentSessionHash(req);
  if (!currentHash) {
    res.status(400).json({ error: "Could not identify the current session" });
    return;
  }

  const revoked = await db
    .update(sessionsTable)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(sessionsTable.userId, req.userId),
        isNull(sessionsTable.revokedAt),
        sql`${sessionsTable.refreshTokenHash} <> ${currentHash}`,
      ),
    )
    .returning({ id: sessionsTable.id });

  res.json({ success: true, revokedSessionCount: revoked.length });
});

export default router;
