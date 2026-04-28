import { Router, type IRouter } from "express";
import bcrypt from "bcryptjs";
import { db, usersTable, sessionsTable } from "@workspace/db";
import { eq, and, isNull } from "drizzle-orm";
import { getUserEntitlements, getUserProducts, getHighestProductLabel, getSupportTicketLimit, getEntitlementsList } from "../lib/entitlements";
import {
  GetCurrentMemberResponse,
  GetMemberProductsResponse,
  GetMemberEntitlementsResponse,
  ChangeMemberPasswordBody,
  ChangeMemberPasswordResponse,
} from "@workspace/api-zod";
import { queueGHLSync } from "../lib/ghl-queue";

const router: IRouter = Router();
const BCRYPT_ROUNDS = 12;

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

export default router;
