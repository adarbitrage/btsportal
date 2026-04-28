import { Router, type IRouter } from "express";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { db, usersTable, sessionsTable, emailChangeHistoryTable, passwordResetAttemptsTable } from "@workspace/db";
import { eq, and, gt, gte, isNull, desc, sql } from "drizzle-orm";
import { generateAccessToken } from "../middleware/auth";
import { abuseRateLimit, ipKey } from "../middleware/abuse-rate-limit";
import { queueGHLSync } from "../lib/ghl-queue";
import { CommunicationService } from "../lib/communication-service";
import { emitWebhookEvent } from "../lib/webhook-events";
import { getRedis } from "../lib/redis";

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

  const emailKey = int32FromHexHash(emailHash);
  const ipKey = ipHash ? int32FromHexHash(ipHash) : null;
  const lockKeys =
    ipKey != null ? [emailKey, ipKey].sort((a, b) => a - b) : [emailKey];

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

async function createSession(userId: number, req: any): Promise<string> {
  const refreshToken = crypto.randomBytes(48).toString("hex");
  const refreshTokenHash = crypto.createHash("sha256").update(refreshToken).digest("hex");
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  await db.insert(sessionsTable).values({
    userId,
    refreshTokenHash,
    expiresAt,
    ipAddress: req.ip || req.connection?.remoteAddress,
    userAgent: req.headers["user-agent"] || null,
  });

  return refreshToken;
}

router.post("/auth/register", async (req, res): Promise<void> => {
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

  const [existing] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.email, email.toLowerCase()));
  if (existing) {
    res.status(409).json({ error: "Email already registered" });
    return;
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const emailVerifyToken = crypto.randomBytes(32).toString("hex");
  const emailVerifyExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);

  const [user] = await db.insert(usersTable).values({
    name,
    email: email.toLowerCase(),
    passwordHash,
    phone: phone || null,
    emailVerified: false,
    emailVerifyToken,
    emailVerifyExpires,
  }).returning();

  console.log(`[AUTH] Email verification token for ${email}: ${emailVerifyToken}`);
  CommunicationService.sendEmailNow({
    templateSlug: "email_verification",
    to: email.toLowerCase(),
    variables: { member_name: name, verify_token: emailVerifyToken },
    userId: user.id,
  });

  const refreshToken = await createSession(user.id, req);
  setAuthCookies(res, user.id, user.email, refreshToken);

  emitWebhookEvent("member.created", {
    user_id: user.id,
    email: user.email,
    name: user.name,
  }).catch(() => {});

  res.status(201).json({ id: user.id, email: user.email, name: user.name, role: user.role, onboardingComplete: user.onboardingComplete, onboardingStep: user.onboardingStep });
});

router.post("/auth/login", async (req, res): Promise<void> => {
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

  const passwordValid = await bcrypt.compare(password, user.passwordHash);
  if (!passwordValid) {
    const newCount = (user.failedLoginCount || 0) + 1;
    const updates: any = { failedLoginCount: newCount };
    if (newCount >= 5) {
      updates.lockedUntil = new Date(Date.now() + 15 * 60 * 1000);
    }
    await db.update(usersTable).set(updates).where(eq(usersTable.id, user.id));
    await respondInvalidCredentials();
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

  const refreshToken = await createSession(user.id, req);
  setAuthCookies(res, user.id, user.email, refreshToken);

  res.json({ id: user.id, email: user.email, name: user.name, role: user.role, onboardingComplete: user.onboardingComplete, onboardingStep: user.onboardingStep });
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
    res.status(401).json({ error: "User not found" });
    return;
  }

  await db.update(sessionsTable).set({ revokedAt: new Date() }).where(eq(sessionsTable.id, session.id));

  const newRefreshToken = await createSession(user.id, req);
  setAuthCookies(res, user.id, user.email, newRefreshToken);

  res.json({ id: user.id, email: user.email, name: user.name, role: user.role, onboardingComplete: user.onboardingComplete, onboardingStep: user.onboardingStep });
});

router.post("/auth/logout", async (req, res): Promise<void> => {
  const token = req.cookies?.refresh_token;
  if (token) {
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    await db.update(sessionsTable).set({ revokedAt: new Date() }).where(eq(sessionsTable.refreshTokenHash, tokenHash));
  }

  res.clearCookie("access_token", { path: "/" });
  res.clearCookie("refresh_token", { path: "/api/auth" });
  res.clearCookie("csrf_token", { path: "/" });
  res.json({ success: true });
});

// IP-based, Redis-backed limiter for the /auth/reset-password endpoint
// (brought in alongside Task #91). Forgot-password uses the DB-backed
// `processForgotPasswordRequest` helper below instead, because that endpoint
// must continue to rate-limit even when Redis is offline (Task #91 spec).
const RESET_PASSWORD_LIMITS = {
  perIp: { max: 10, windowSeconds: 15 * 60 },
} as const;

const resetPasswordIpLimiter = abuseRateLimit({
  name: "reset-password",
  maxRequests: RESET_PASSWORD_LIMITS.perIp.max,
  windowSeconds: RESET_PASSWORD_LIMITS.perIp.windowSeconds,
  keyResolver: ipKey("reset-password"),
  message: "Too many password reset attempts. Please try again later.",
});

router.post("/auth/forgot-password", async (req, res): Promise<void> => {
  // Always return the same friendly response, regardless of whether the email
  // exists or whether the request was throttled by the rate limit. This avoids
  // leaking which addresses have an account and which are being rate-limited.
  res.json({ message: "If that email exists, we sent a reset link." });

  // Fire-and-forget the actual work so the response timing is the same on
  // every call. The rate-limit check is enforced inside the helper, backed by
  // the `password_reset_attempts` table so it survives Redis being offline.
  void processForgotPasswordRequest(req.body?.email, req.ip).catch((err) =>
    console.error("[AUTH] Unexpected error processing forgot-password:", err),
  );
});

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

  emitWebhookEvent("member.email_changed", {
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
  }).from(usersTable).where(eq(usersTable.id, req.userId));

  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  res.json(user);
});

export default router;
