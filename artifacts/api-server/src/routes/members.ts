import { Router, type IRouter } from "express";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { db, usersTable, sessionsTable } from "@workspace/db";
import { eq, and, isNull, ne } from "drizzle-orm";
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

  const token = crypto.randomBytes(32).toString("hex");
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const expires = new Date(Date.now() + EMAIL_CHANGE_EXPIRY_HOURS * 60 * 60 * 1000);

  await db
    .update(usersTable)
    .set({
      pendingEmail: newEmail,
      emailChangeToken: tokenHash,
      emailChangeExpires: expires,
    })
    .where(eq(usersTable.id, userId));

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
