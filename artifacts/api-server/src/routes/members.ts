import { Router, type IRouter } from "express";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { db, usersTable, sessionsTable, emailChangeAttemptsTable, productsTable } from "@workspace/db";
import { eq, and, isNull, ne, gte, sql, desc } from "drizzle-orm";
import { getUserEntitlements, getUserProducts, getHighestProductLabel, getSupportTicketLimit, getEntitlementsList } from "../lib/entitlements";
import {
  GetCurrentMemberResponse,
  GetMemberProductsResponse,
  GetMemberEntitlementsResponse,
  RequestMemberEmailChangeBody as RequestEmailChangeBody,
  RequestMemberEmailChangeResponse as RequestEmailChangeResponse,
  CancelMemberEmailChangeResponse as CancelEmailChangeResponse,
  GetMemberEmailChangePrefillResponse as EmailChangePrefillResponse,
} from "@workspace/api-zod";
import {
  ChangeMemberPasswordBody,
  ChangeMemberPasswordResponse,
  DismissAdminCancelledEmailChangeResponse,
  StartMemberCheckoutBody,
  StartMemberCheckoutResponse,
} from "@workspace/api-zod/schemas";
import { queueGHLSync } from "../lib/ghl-queue";
import { CommunicationService } from "../lib/communication-service";
import {
  getPortalUrl,
  PORTAL_URL_SETTING_KEY,
} from "../lib/portal-url-settings";
import {
  verifyEmailChangePrefillToken,
  signEmailChangePrefillToken,
  buildEmailChangeRestartUrl,
} from "../lib/email-change-prefill-token";
import { logAuditEvent } from "../lib/audit-log";
import { PRODUCT_RANK } from "../lib/product-rank";

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
      // `id` is surfaced on the response so the cancelled-email banner can
      // pass it through to the support form — POST /tickets persists it as
      // `sourceReferenceId` so the admin Ticket Detail page can deep-link
      // back to this exact attempt.
      id: emailChangeAttemptsTable.id,
      newEmail: emailChangeAttemptsTable.newEmail,
      cancelledAt: emailChangeAttemptsTable.cancelledAt,
      cancelledByAdminId: emailChangeAttemptsTable.cancelledByAdminId,
      dismissedByMemberAt: emailChangeAttemptsTable.dismissedByMemberAt,
    })
    .from(emailChangeAttemptsTable)
    .where(eq(emailChangeAttemptsTable.userId, userId))
    .orderBy(desc(emailChangeAttemptsTable.createdAt))
    .limit(1);

  // Pass the Date instance through unchanged: GetCurrentMemberResponse.parse()
  // is generated from `format: date-time` and therefore expects a real Date.
  // res.json() serialises it to an ISO string before it goes over the wire.
  // We hide the snapshot once the member dismisses the in-app banner so it
  // does not reappear on every page load — the dismissal is persisted on the
  // attempt row itself by POST /members/me/email/admin-cancellation/dismiss.
  const lastAdminCancelledEmailChange =
    latestAttempt &&
    latestAttempt.cancelledByAdminId != null &&
    latestAttempt.cancelledAt &&
    latestAttempt.newEmail &&
    latestAttempt.dismissedByMemberAt == null
      ? {
          attemptId: latestAttempt.id,
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
    ticketReplySmsOptIn: user.ticketReplySmsOptIn,
    securitySmsOptIn: user.securitySmsOptIn,
    billingSmsOptIn: user.billingSmsOptIn,
    coachingSmsOptIn: user.coachingSmsOptIn,
    contentSmsOptIn: user.contentSmsOptIn,
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
  // Clearing mustChangePassword here is what releases a forced-first-login
  // staffer (created via POST /admin/staff) from the change-password gate.
  await db
    .update(usersTable)
    .set({ passwordHash, mustChangePassword: false })
    .where(eq(usersTable.id, userId));

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

  // Snapshot any still-actionable pending change before we overwrite it so
  // we can send the dropped pending address a heads-up after the new
  // request succeeds. Only addresses whose verification link could still
  // plausibly be opened (non-expired) are worth notifying — anything past
  // its expiry would already be a dead link to the recipient.
  const replacedPendingEmail =
    user.pendingEmail &&
    user.emailChangeExpires &&
    user.emailChangeExpires > new Date() &&
    user.pendingEmail.toLowerCase() !== newEmail
      ? user.pendingEmail
      : null;

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
    // If a previous email-change is still pending on the user record, this
    // new request supersedes (replaces) it. Stamp the matching prior
    // attempt row(s) as cancelled-by-member so the admin Member Detail
    // attempts card can show "cancelled_by_member" instead of leaving the
    // row in `pending` until it eventually rolls over to expired/abandoned.
    // Match the same (newEmail, expiresAt) pair the user record carried —
    // those values were copied straight from the attempt row when the
    // earlier POST /members/me/email created it. Only touch rows that
    // aren't already cancelled so any pre-existing admin-cancellation
    // timestamp/marker is preserved.
    //
    // Re-read pending fields from inside the advisory-locked transaction
    // rather than reusing the pre-lock `user` row: under concurrent
    // double-submit, a competing request that landed first could have
    // already written its own pending change while we were waiting on the
    // lock, and we'd otherwise miss stamping that intermediate attempt.
    const [latest] = await tx
      .select({
        pendingEmail: usersTable.pendingEmail,
        emailChangeExpires: usersTable.emailChangeExpires,
      })
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .limit(1);
    if (latest?.pendingEmail) {
      const matchClauses = [
        eq(emailChangeAttemptsTable.userId, userId),
        isNull(emailChangeAttemptsTable.cancelledAt),
        sql`lower(${emailChangeAttemptsTable.newEmail}) = lower(${latest.pendingEmail})`,
      ];
      if (latest.emailChangeExpires) {
        matchClauses.push(
          eq(emailChangeAttemptsTable.expiresAt, latest.emailChangeExpires),
        );
      }
      await tx
        .update(emailChangeAttemptsTable)
        .set({ cancelledAt: now, cancelledByMember: true })
        .where(and(...matchClauses));
    }

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

  // Audit trail: record the request itself so the admin Member Detail
  // click-through panel (which scopes audit rows by entityType=user /
  // entityId=memberId) shows something happened, not "No admin audit
  // entries". The current and new addresses both appear in the
  // description so the row is self-explanatory in the audit log without
  // needing to expand it; both are surfaced as structured fields too so
  // the PII redactor has a handle to scrub them for non-PII viewers.
  await logAuditEvent({
    actorId: userId,
    actorEmail: user.email,
    actionType: "request_email_change",
    entityType: "user",
    entityId: String(userId),
    description: `Member requested email change from ${user.email} to ${newEmail}`,
    metadata: {
      memberEmail: user.email,
      newEmail,
      expiresAt: expires.toISOString(),
    },
    req,
  });

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

  // Heads-up to the previously-pending address (if any) that the change it
  // was waiting on has been replaced by a fresh request to a different
  // address — its verification link will no longer work. We do NOT attach a
  // userId because that inbox may not belong to the verified account owner;
  // the template is intentionally light on account-status language for the
  // same reason.
  if (replacedPendingEmail) {
    CommunicationService.sendEmailNow({
      templateSlug: "email_change_cancelled_by_member_pending",
      to: replacedPendingEmail,
      variables: {
        cancelled_pending_email: replacedPendingEmail,
      },
    }).catch((err) =>
      console.error(
        "[Email Change] Failed to send dropped-pending notice (replace):",
        err,
      ),
    );
  }

  res.json(
    RequestEmailChangeResponse.parse({
      message:
        "Verification link sent. Click the link in your new inbox within 24 hours to complete the change.",
      pendingEmail: newEmail,
    }),
  );
});

// Resolve the signed prefill token embedded in the
// `email_change_cancelled_by_admin` deep link into the address it carries.
// The token must have been signed for *this* authenticated member — otherwise
// a stolen/forwarded link could be used to seed someone else's email-change
// form (a phishing primitive). The signature also rules out callers
// hand-crafting a token with an arbitrary email.
router.get("/members/me/email/prefill", async (req, res): Promise<void> => {
  const userId = req.userId!;

  const tokenRaw = typeof req.query.token === "string" ? req.query.token : "";
  if (!tokenRaw) {
    res.status(400).json({ error: "Missing token." });
    return;
  }

  const payload = verifyEmailChangePrefillToken(tokenRaw);
  if (!payload) {
    res.status(410).json({
      error:
        "This pre-fill link is no longer valid — it may have expired or been altered. Please start the email change manually from your account settings.",
    });
    return;
  }

  if (payload.userId !== userId) {
    // We deliberately don't tell the caller *whose* token this is.
    res.status(403).json({
      error: "This pre-fill link wasn't issued for the signed-in account.",
    });
    return;
  }

  res.json(
    EmailChangePrefillResponse.parse({
      prefillEmail: payload.prefillEmail,
    }),
  );
});

router.post("/members/me/email/cancel", async (req, res): Promise<void> => {
  const userId = req.userId!;

  // Cancel both halves of the pending change in a single transaction:
  //   1. Clear the pending fields on the user record (the source of truth
  //      for "is there an in-flight change?")
  //   2. Stamp the matching attempt row(s) with `cancelledAt` +
  //      `cancelledByMember = true` so the admin Member Detail attempts
  //      card can show "cancelled_by_member" instead of leaving the row
  //      in `pending` forever (or rolling it over to `expired`/`abandoned`).
  // Match the same (newEmail, expiresAt) pair the user record currently
  // carries — those values were copied straight from the attempt row when
  // POST /members/me/email created it. Skip the stamping when there is no
  // pending change so re-cancelling stays a cheap idempotent no-op.
  // While we're already reading the current pending state, capture it so we
  // can fire two post-cancel notifications after the txn commits without
  // an extra DB round-trip:
  //   * Verified-address notice (with a one-click restart link) — fires
  //     whenever there was a pending change at all, mirroring the admin-
  //     cancel path so every cancellation route gives the member the same
  //     retry-in-one-click experience. Returned as `cancelled` so we can
  //     also read the verified email + name outside the txn.
  //   * Dropped-pending heads-up — only fires when the link could still
  //     plausibly be opened (non-expired); an expired pending link is
  //     already a dead end to its recipient, so notifying that inbox would
  //     be more confusing than helpful. The attempts-row stamping above
  //     still runs for any matching pending so the audit trail is complete
  //     either way.
  let droppedPendingEmail: string | null = null;
  const cancelled = await db.transaction(async (tx) => {
    const [current] = await tx
      .select({
        email: usersTable.email,
        name: usersTable.name,
        pendingEmail: usersTable.pendingEmail,
        emailChangeExpires: usersTable.emailChangeExpires,
      })
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .limit(1);

    if (
      current?.pendingEmail &&
      current.emailChangeExpires &&
      current.emailChangeExpires > new Date()
    ) {
      droppedPendingEmail = current.pendingEmail;
    }

    await tx
      .update(usersTable)
      .set({
        pendingEmail: null,
        emailChangeToken: null,
        emailChangeExpires: null,
      })
      .where(eq(usersTable.id, userId));

    if (current?.pendingEmail) {
      const matchClauses = [
        eq(emailChangeAttemptsTable.userId, userId),
        isNull(emailChangeAttemptsTable.cancelledAt),
        sql`lower(${emailChangeAttemptsTable.newEmail}) = lower(${current.pendingEmail})`,
      ];
      if (current.emailChangeExpires) {
        matchClauses.push(
          eq(emailChangeAttemptsTable.expiresAt, current.emailChangeExpires),
        );
      }
      await tx
        .update(emailChangeAttemptsTable)
        .set({ cancelledAt: new Date(), cancelledByMember: true })
        .where(and(...matchClauses));
    }

    return current ?? null;
  });

  // Fire post-cancel notifications only when there was actually a pending
  // change to cancel — re-cancel of an already-clean account is a silent
  // no-op so we don't spam either inbox with a misleading "your change
  // was cancelled" note. Both sends are fire-and-forget: the cancellation
  // itself has already succeeded and we never want a transient SendGrid/
  // Redis hiccup to surface as a member-facing 500.
  //
  // Mirrors the admin-cancel path in admin-panel.ts so every cancellation
  // route — admin or self-service — gives the member the same one-click
  // restart link in the notification to their verified address.
  if (cancelled?.pendingEmail) {
    const previousPendingEmail = cancelled.pendingEmail;
    // The restart_url CTA deep-links into the tenant's portal; if no portal
    // URL is configured in production we skip this notification rather than
    // ship a wrong-tenant link. Mirrors admin-panel.ts's admin-cancel path.
    const portalUrl = await getPortalUrl();
    if (!portalUrl) {
      console.error(
        `[Members] Skipping email_change_cancelled_by_member notice for user ${userId}: no portal URL configured (set ${PORTAL_URL_SETTING_KEY} in admin settings or PORTAL_URL env var)`,
      );
    } else {
      // Sign a short-lived prefill token tied to this member so the
      // cancellation email can deep-link straight to the email-change form
      // with the discarded address pre-filled. The token is verified
      // server-side against the authenticated session before any pre-fill
      // occurs (see GET /members/me/email/prefill above), so the URL can't
      // be used to seed a phishing form on someone else's account.
      const prefillToken = signEmailChangePrefillToken({
        userId,
        prefillEmail: previousPendingEmail,
      });
      const restartUrl = buildEmailChangeRestartUrl(portalUrl, prefillToken);

      CommunicationService.queueEmail({
        templateSlug: "email_change_cancelled_by_member",
        to: cancelled.email,
        variables: {
          member_name: cancelled.name,
          member_email: cancelled.email,
          cancelled_pending_email: previousPendingEmail,
          restart_url: restartUrl,
        },
        userId,
      }).catch((err) =>
        console.error(
          "[Members] Failed to enqueue email_change_cancelled_by_member notice:",
          err,
        ),
      );
    }
  }

  // Separate heads-up to the dropped pending address (fire-and-forget),
  // gated on the pending link being non-expired so we don't notify an
  // inbox whose verification link is already a dead end. No userId is
  // attached because that inbox may not belong to the verified account
  // owner; the template intentionally avoids account-status language for
  // the same reason.
  if (droppedPendingEmail) {
    CommunicationService.sendEmailNow({
      templateSlug: "email_change_cancelled_by_member_pending",
      to: droppedPendingEmail,
      variables: {
        cancelled_pending_email: droppedPendingEmail,
      },
    }).catch((err) =>
      console.error(
        "[Email Change] Failed to send dropped-pending notice (cancel):",
        err,
      ),
    );
  }

  res.json(
    CancelEmailChangeResponse.parse({
      message: "Pending email change cancelled.",
    }),
  );
});

// Starts a hosted-checkout flow for an upgrade tier, returning the URL the
// portal should redirect the member to. We resolve the URL on the server (not
// the client) so:
//   1. The upgrade-rank check is authoritative — a tampered client can't ask
//      us to "upgrade" them to a lower or equal tier.
//   2. The product->checkout-url mapping lives in the database, so swapping
//      cart providers doesn't need a portal release.
//   3. We can prefill the cart with the member's email/name from a trusted
//      source instead of trusting client-supplied identity.
//
// On success the cart provider's webhook (already wired up at
// /api/webhooks/thrivecart) updates entitlements when the order completes.
router.post("/members/me/checkout", async (req, res): Promise<void> => {
  const userId = req.userId!;

  const parsed = StartMemberCheckoutBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid request body",
      details: parsed.error.issues,
    });
    return;
  }

  const planSlug = parsed.data.planSlug.trim();
  // Free-form returnUrl on the request would let an attacker turn this
  // endpoint into an open redirect (we'd echo their URL back into the
  // checkout link as `return_url`, and ThriveCart bounces buyers there
  // post-purchase). We only accept a relative path that starts with `/`
  // and contains no scheme/authority — the API server prefixes its own
  // public origin before it goes into the cart link.
  const returnPath = normalizeReturnPath(parsed.data.returnPath);

  const [user] = await db
    .select({
      id: usersTable.id,
      name: usersTable.name,
      email: usersTable.email,
      sourceProduct: usersTable.sourceProduct,
    })
    .from(usersTable)
    .where(eq(usersTable.id, userId));
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  const [product] = await db
    .select({
      slug: productsTable.slug,
      name: productsTable.name,
      checkoutUrl: productsTable.checkoutUrl,
    })
    .from(productsTable)
    .where(eq(productsTable.slug, planSlug))
    .limit(1);
  if (!product) {
    res.status(404).json({ error: "Plan not found." });
    return;
  }

  if (!product.checkoutUrl) {
    res.status(409).json({
      error:
        "This plan can't be purchased online yet. Please contact support to upgrade.",
    });
    return;
  }

  // Authoritative upgrade-rank check — must be a strictly higher tier than
  // what the member currently sits on. This intentionally treats unknown
  // source products as rank 0 (same as `free`) so a brand-new user with no
  // sourceProduct can still upgrade to anything.
  const targetRank = PRODUCT_RANK[product.slug] ?? 0;
  const currentSlug = user.sourceProduct ?? "free";
  const currentRank = PRODUCT_RANK[currentSlug] ?? 0;
  if (targetRank <= currentRank) {
    res.status(409).json({
      error:
        "You're already on this plan or a higher one — pick a higher tier to upgrade.",
    });
    return;
  }

  const checkoutUrl = buildCheckoutUrl(product.checkoutUrl, {
    email: user.email,
    name: user.name,
    returnPath,
    publicOrigin: getPublicOrigin(req),
  });

  res.json(
    StartMemberCheckoutResponse.parse({
      checkoutUrl,
      planSlug: product.slug,
      planName: product.name,
    }),
  );
});

function normalizeReturnPath(input: string | undefined): string {
  const fallback = "/plans?upgraded=1";
  if (!input) return fallback;
  // Reject anything that could escape our origin: schemes, protocol-relative
  // URLs, or backslashes (Windows-style paths some browsers normalise to /).
  if (
    !input.startsWith("/") ||
    input.startsWith("//") ||
    input.startsWith("/\\") ||
    /[\r\n]/.test(input)
  ) {
    return fallback;
  }
  return input;
}

function getPublicOrigin(req: { protocol: string; get: (h: string) => string | undefined }): string {
  // PUBLIC_PORTAL_ORIGIN wins when set (e.g. https://portal.bts.example) so
  // we don't accidentally hand the cart a localhost URL in production. Fall
  // back to the request's own origin for dev/preview environments.
  const fromEnv = process.env.PUBLIC_PORTAL_ORIGIN;
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  const host = req.get("host") || "localhost";
  return `${req.protocol}://${host}`;
}

function buildCheckoutUrl(
  base: string,
  opts: { email: string; name: string; returnPath: string; publicOrigin: string },
): string {
  const url = new URL(base);
  // ThriveCart's prefill parameter names — the portal's cart links are wired
  // to ThriveCart in seed/admin, so this matches what the cart expects. Other
  // providers will safely ignore unknown query params.
  url.searchParams.set("prefilled_email", opts.email);
  const [first, ...rest] = opts.name.trim().split(/\s+/);
  if (first) url.searchParams.set("customer_first_name", first);
  if (rest.length > 0) {
    url.searchParams.set("customer_last_name", rest.join(" "));
  }
  url.searchParams.set("return_url", `${opts.publicOrigin}${opts.returnPath}`);
  return url.toString();
}

// Marks the member's most recent admin-cancelled email-change attempt as
// dismissed so the in-app banner on the account page stops re-rendering on
// every page load. We dismiss the *latest* attempt row only — that mirrors
// the same "freshest signal" logic GET /members/me uses to decide whether
// to surface the banner in the first place. If the latest attempt is not
// admin-cancelled (e.g. a newer self-initiated attempt is in flight) we
// no-op so a stray click can't quietly stamp the wrong row.
router.post(
  "/members/me/email/admin-cancellation/dismiss",
  async (req, res): Promise<void> => {
    const userId = req.userId!;

    const [latestAttempt] = await db
      .select({
        id: emailChangeAttemptsTable.id,
        cancelledByAdminId: emailChangeAttemptsTable.cancelledByAdminId,
        dismissedByMemberAt: emailChangeAttemptsTable.dismissedByMemberAt,
      })
      .from(emailChangeAttemptsTable)
      .where(eq(emailChangeAttemptsTable.userId, userId))
      .orderBy(desc(emailChangeAttemptsTable.createdAt))
      .limit(1);

    if (
      !latestAttempt ||
      latestAttempt.cancelledByAdminId == null ||
      latestAttempt.dismissedByMemberAt != null
    ) {
      res.json(
        DismissAdminCancelledEmailChangeResponse.parse({ dismissed: false }),
      );
      return;
    }

    await db
      .update(emailChangeAttemptsTable)
      .set({ dismissedByMemberAt: new Date() })
      .where(eq(emailChangeAttemptsTable.id, latestAttempt.id));

    res.json(
      DismissAdminCancelledEmailChangeResponse.parse({ dismissed: true }),
    );
  },
);

export default router;
