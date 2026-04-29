import { Router, type IRouter } from "express";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { db, usersTable, sessionsTable, emailChangeAttemptsTable } from "@workspace/db";
import { eq, and, isNull, ne, gte, sql, desc } from "drizzle-orm";
import { getUserEntitlements, getUserProducts, getHighestProductLabel, getSupportTicketLimit, getEntitlementsList } from "../lib/entitlements";
import {
  GetCurrentMemberResponse,
  GetMemberProductsResponse,
  GetMemberEntitlementsResponse,
  ChangeMemberPasswordBody,
  ChangeMemberPasswordResponse,
  RequestMemberEmailChangeBody as RequestEmailChangeBody,
  RequestMemberEmailChangeResponse as RequestEmailChangeResponse,
  CancelMemberEmailChangeResponse as CancelEmailChangeResponse,
} from "@workspace/api-zod";
import { queueGHLSync } from "../lib/ghl-queue";
import { CommunicationService } from "../lib/communication-service";

const router: IRouter = Router();
const BCRYPT_ROUNDS = 12;
const EMAIL_CHANGE_EXPIRY_HOURS = 24;

// Per-user rate limits for email-change requests. Each successful POST to
// /members/me/email logs a row in `email_change_attempts`; we count the rows
// in the trailing windows below to decide whether to accept the next attempt.
const EMAIL_CHANGE_HOURLY_LIMIT = 3;
const EMAIL_CHANGE_DAILY_LIMIT = 10;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

function formatRetryAfter(seconds: number): string {
  if (seconds <= 60) return "in less than a minute";
  if (seconds < 60 * 60) {
    const minutes = Math.ceil(seconds / 60);
    return `in about ${minutes} minute${minutes === 1 ? "" : "s"}`;
  }
  const hours = Math.ceil(seconds / 3600);
  return `in about ${hours} hour${hours === 1 ? "" : "s"}`;
}

router.get("/members/me", async (req, res): Promise<void> => {
  const userId = req.userId!;
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  const entitlements = await getUserEntitlements(userId);
  const products = await getUserProducts(userId);
  const highest = getHighestProductLabel(entitlements);
  const ticketLimit = getSupportTicketLimit(entitlements);

  // Surface the most recent admin-cancelled email change so the security
  // page can explain why a previously-pending change has disappeared.
  // We only look at the very latest attempt — if the member has since
  // started a new attempt (or completed one) the cancellation is no
  // longer the freshest signal and we hide it to avoid stale toasts on
  // the account page.
  const [latestAttempt] = await db
    .select({
      newEmail: emailChangeAttemptsTable.newEmail,
      cancelledAt: emailChangeAttemptsTable.cancelledAt,
      cancelledByAdminId: emailChangeAttemptsTable.cancelledByAdminId,
    })
    .from(emailChangeAttemptsTable)
    .where(eq(emailChangeAttemptsTable.userId, userId))
    .orderBy(desc(emailChangeAttemptsTable.createdAt))
    .limit(1);

  // Pass the Date instance through unchanged: GetCurrentMemberResponse.parse()
  // is generated from `format: date-time` and therefore expects a real Date.
  // res.json() serialises it to an ISO string before it goes over the wire.
  const lastAdminCancelledEmailChange =
    latestAttempt &&
    latestAttempt.cancelledByAdminId != null &&
    latestAttempt.cancelledAt &&
    latestAttempt.newEmail
      ? {
          newEmail: latestAttempt.newEmail,
          cancelledAt: latestAttempt.cancelledAt,
        }
      : null;

  res.json(GetCurrentMemberResponse.parse({
    id: user.id,
    name: user.name,
    email: user.email,
    pendingEmail:
      user.pendingEmail &&
      user.emailChangeExpires &&
      user.emailChangeExpires > new Date()
        ? user.pendingEmail
        : null,
    lastAdminCancelledEmailChange,
    phone: user.phone,
    timezone: user.timezone,
    sourceProduct: user.sourceProduct,
    role: user.role,
    onboardingComplete: user.onboardingComplete,
    onboardingStep: user.onboardingStep,
    experienceLevel: user.experienceLevel,
    primaryGoal: user.primaryGoal,
    smsOptIn: user.smsOptIn,
    marketingOptIn: user.marketingOptIn,
    currentStreak: user.currentStreak,
    memberSince: user.memberSince.toISOString().split("T")[0],
    highestProductName: highest.name,
    highestProductSlug: highest.slug,
    entitlements: getEntitlementsList(entitlements),
    products,
    ticketLimit,
  }));
});

router.post("/members/me/onboarding-complete", async (req, res): Promise<void> => {
  const userId = req.userId!;
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  if (user.onboardingComplete) {
    res.json({ message: "Onboarding already completed" });
    return;
  }

  await db.update(usersTable).set({ onboardingComplete: true }).where(eq(usersTable.id, userId));

  await queueGHLSync({
    action: "add_tags",
    userId,
    tags: ["onboarding_complete"],
    customFields: {
      onboarding_complete: "true",
      onboarding_completed_at: new Date().toISOString(),
    },
  });

  await queueGHLSync({
    action: "add_note",
    userId,
    noteBody: "Portal onboarding completed",
  });

  const { cancelSequence, enrollInSequence } = await import("../lib/sequence-helpers");
  await cancelSequence(userId, "onboarding_frontend");
  await cancelSequence(userId, "onboarding_mentorship");
  await enrollInSequence(userId, "nurture_frontend_to_upgrade");

  res.json({ message: "Onboarding marked as complete" });
});

router.get("/members/me/products", async (req, res): Promise<void> => {
  const userId = req.userId!;
  const products = await getUserProducts(userId);
  res.json(GetMemberProductsResponse.parse(products));
});

router.get("/members/me/entitlements", async (req, res): Promise<void> => {
  const userId = req.userId!;
  const entitlements = await getUserEntitlements(userId);
  const highest = getHighestProductLabel(entitlements);
  const ticketLimit = getSupportTicketLimit(entitlements);

  res.json(GetMemberEntitlementsResponse.parse({
    entitlements: getEntitlementsList(entitlements),
    highestProductName: highest.name,
    highestProductSlug: highest.slug,
    ticketLimit,
  }));
});

router.post("/members/me/password", async (req, res): Promise<void> => {
  const userId = req.userId!;

  const parsed = ChangeMemberPasswordBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body", details: parsed.error.issues });
    return;
  }

  const { currentPassword, newPassword } = parsed.data;

  if (!/[a-zA-Z]/.test(newPassword) || !/[0-9]/.test(newPassword)) {
    res.status(400).json({
      error: "Password must be at least 8 characters with at least 1 letter and 1 number",
    });
    return;
  }

  if (currentPassword === newPassword) {
    res.status(400).json({ error: "New password must be different from current password" });
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  const valid = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!valid) {
    res.status(400).json({ error: "Current password is incorrect" });
    return;
  }

  const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
  await db.update(usersTable).set({ passwordHash }).where(eq(usersTable.id, userId));

  await db
    .update(sessionsTable)
    .set({ revokedAt: new Date() })
    .where(and(eq(sessionsTable.userId, userId), isNull(sessionsTable.revokedAt)));

  res.clearCookie("access_token", { path: "/" });
  res.clearCookie("refresh_token", { path: "/api/auth" });
  res.clearCookie("csrf_token", { path: "/" });

  res.json(
    ChangeMemberPasswordResponse.parse({
      message: "Password updated successfully. Please sign in again.",
    }),
  );
});

router.post("/members/me/email", async (req, res): Promise<void> => {
  const userId = req.userId!;

  const parsed = RequestEmailChangeBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid request body",
      details: parsed.error.issues,
    });
    return;
  }

  const { currentPassword } = parsed.data;
  const newEmail = parsed.data.newEmail.trim().toLowerCase();

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  if (newEmail === user.email.toLowerCase()) {
    res.status(400).json({ error: "New email must be different from your current email." });
    return;
  }

  const valid = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!valid) {
    res.status(400).json({ error: "Current password is incorrect." });
    return;
  }

  const [conflict] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(and(eq(usersTable.email, newEmail), ne(usersTable.id, userId)))
    .limit(1);
  if (conflict) {
    res
      .status(400)
      .json({ error: "That email address is already in use on another account." });
    return;
  }

  // Per-user rate limit: 3 requests/hour and 10 requests/day. Counted from the
  // `email_change_attempts` table so the cap survives Redis being offline.
  // Wrapped in a transaction with a per-user Postgres advisory lock so the
  // count + insert is serialized per user — concurrent requests from the
  // same account cannot all observe a pre-insert count and slip through.
  const now = new Date();
  const hourAgo = new Date(now.getTime() - HOUR_MS);
  const dayAgo = new Date(now.getTime() - DAY_MS);

  const token = crypto.randomBytes(32).toString("hex");
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const expires = new Date(Date.now() + EMAIL_CHANGE_EXPIRY_HOURS * 60 * 60 * 1000);

  type RateLimitResult =
    | { allowed: true }
    | { allowed: false; retryAfterSeconds: number };

  const result = await db.transaction(async (tx): Promise<RateLimitResult> => {
    // Per-user advisory lock that lives for the duration of this txn.
    // Two namespaces (constant + userId) guarantee no collision with other
    // advisory locks elsewhere in the system.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(842317, ${userId})`);

    const [counts] = await tx
      .select({
        hour: sql<number>`count(*) filter (where ${emailChangeAttemptsTable.createdAt} >= ${hourAgo})`.mapWith(Number),
        day: sql<number>`count(*) filter (where ${emailChangeAttemptsTable.createdAt} >= ${dayAgo})`.mapWith(Number),
        oldestInHour: sql<Date | null>`min(${emailChangeAttemptsTable.createdAt}) filter (where ${emailChangeAttemptsTable.createdAt} >= ${hourAgo})`,
        oldestInDay: sql<Date | null>`min(${emailChangeAttemptsTable.createdAt}) filter (where ${emailChangeAttemptsTable.createdAt} >= ${dayAgo})`,
      })
      .from(emailChangeAttemptsTable)
      .where(
        and(
          eq(emailChangeAttemptsTable.userId, userId),
          gte(emailChangeAttemptsTable.createdAt, dayAgo),
        ),
      );

    const hourCount = counts?.hour ?? 0;
    const dayCount = counts?.day ?? 0;

    if (hourCount >= EMAIL_CHANGE_HOURLY_LIMIT || dayCount >= EMAIL_CHANGE_DAILY_LIMIT) {
      const oldest =
        dayCount >= EMAIL_CHANGE_DAILY_LIMIT
          ? counts?.oldestInDay
          : counts?.oldestInHour;
      const windowMs = dayCount >= EMAIL_CHANGE_DAILY_LIMIT ? DAY_MS : HOUR_MS;
      const oldestDate = oldest ? new Date(oldest as string | Date) : now;
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((oldestDate.getTime() + windowMs - now.getTime()) / 1000),
      );
      return { allowed: false, retryAfterSeconds };
    }

    // Insert the attempt and update the user record in the same transaction
    // so that a follow-up request that also acquires the lock sees this row
    // in its count.
    await tx.insert(emailChangeAttemptsTable).values({
      userId,
      newEmail,
      expiresAt: expires,
    });

    await tx
      .update(usersTable)
      .set({
        pendingEmail: newEmail,
        emailChangeToken: tokenHash,
        emailChangeExpires: expires,
      })
      .where(eq(usersTable.id, userId));

    return { allowed: true };
  });

  if (!result.allowed) {
    res.setHeader("Retry-After", String(result.retryAfterSeconds));
    res.status(429).json({
      error: `You've requested too many email changes recently. Please try again ${formatRetryAfter(result.retryAfterSeconds)}.`,
      retryAfter: result.retryAfterSeconds,
    });
    return;
  }

  // Verification link to the NEW address
  CommunicationService.sendEmailNow({
    templateSlug: "email_change_verify",
    to: newEmail,
    variables: {
      member_name: user.name,
      old_email: user.email,
      new_email: newEmail,
      verify_token: token,
    },
    userId,
  }).catch((err) =>
    console.error("[Email Change] Failed to send verification email:", err),
  );

  // Notice to the OLD address
  CommunicationService.sendEmailNow({
    templateSlug: "email_change_notice",
    to: user.email,
    variables: {
      member_name: user.name,
      new_email: newEmail,
    },
    userId,
  }).catch((err) =>
    console.error("[Email Change] Failed to send notice email:", err),
  );

  res.json(
    RequestEmailChangeResponse.parse({
      message:
        "Verification link sent. Click the link in your new inbox within 24 hours to complete the change.",
      pendingEmail: newEmail,
    }),
  );
});

router.post("/members/me/email/cancel", async (req, res): Promise<void> => {
  const userId = req.userId!;

  await db
    .update(usersTable)
    .set({
      pendingEmail: null,
      emailChangeToken: null,
      emailChangeExpires: null,
    })
    .where(eq(usersTable.id, userId));

  res.json(
    CancelEmailChangeResponse.parse({
      message: "Pending email change cancelled.",
    }),
  );
});

export default router;
