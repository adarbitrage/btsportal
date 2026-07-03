import { describe, it, expect, beforeAll, afterAll } from "vitest";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import {
  db,
  usersTable,
  productsTable,
  userProductsTable,
  onboardingEffectsTable,
  sequenceEnrollmentsTable,
  partnerAssignmentsTable,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

import { claimOnboardingEffect, ONBOARDING_EFFECT } from "../lib/onboarding-effects";
import {
  applyCreationTimeOnboardingDefaults,
  computeUpgradeReentryStep,
  maybeForceOnboardingReentry,
} from "../lib/onboarding-variant";
import { insertUserProductGrant, extendActiveGrantExpiry } from "../lib/external-grant-product";

// Task #1642 (TB1): tier-aware once-only completion effects + upgrade hook.
// Uses the PRE-EXISTING dev-seeded "launchpad" (rank 1) and "3month" (rank 2,
// resolves to "full") products, same convention as onboarding-variant.test.ts.

const TEST_TAG = `onboarding-effects-${randomUUID().slice(0, 8)}`;
const seededUserIds: number[] = [];

let launchpadProductId: number;
let fullTierProductId: number;

async function seedMember(opts: {
  onboardingVariant?: "none" | "launchpad" | "full";
  onboardingStep?: number;
  onboardingComplete?: boolean;
} = {}): Promise<number> {
  const email = `${TEST_TAG}-${randomUUID().slice(0, 6)}@example.test`;
  const passwordHash = await bcrypt.hash("irrelevant", 4);
  const [row] = await db
    .insert(usersTable)
    .values({
      email,
      name: "Onboarding Effects Test",
      passwordHash,
      role: "member",
      sourceProduct: null,
      emailVerified: true,
      onboardingVariant: opts.onboardingVariant,
      onboardingStep: opts.onboardingStep,
      onboardingComplete: opts.onboardingComplete,
    })
    .returning({ id: usersTable.id });
  seededUserIds.push(row.id);
  return row.id;
}

async function grantProduct(userId: number, productId: number): Promise<void> {
  await db.insert(userProductsTable).values({
    userId,
    productId,
    status: "active",
    purchasedAt: new Date(),
  });
}

async function getUser(userId: number) {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  return user;
}

beforeAll(async () => {
  const [launchpad] = await db.select({ id: productsTable.id }).from(productsTable).where(eq(productsTable.slug, "launchpad"));
  const [threeMonth] = await db.select({ id: productsTable.id }).from(productsTable).where(eq(productsTable.slug, "3month"));
  if (!launchpad || !threeMonth) {
    throw new Error("Expected dev-seeded 'launchpad' and '3month' products to exist for onboarding-effects tests");
  }
  launchpadProductId = launchpad.id;
  fullTierProductId = threeMonth.id;
});

afterAll(async () => {
  if (seededUserIds.length > 0) {
    await db.delete(sequenceEnrollmentsTable).where(inArray(sequenceEnrollmentsTable.userId, seededUserIds));
    await db.delete(onboardingEffectsTable).where(inArray(onboardingEffectsTable.userId, seededUserIds));
    await db.delete(partnerAssignmentsTable).where(inArray(partnerAssignmentsTable.memberId, seededUserIds));
    await db.delete(userProductsTable).where(inArray(userProductsTable.userId, seededUserIds));
    await db.delete(usersTable).where(inArray(usersTable.id, seededUserIds));
  }
});

describe("claimOnboardingEffect — per-(member, effect) idempotency ledger", () => {
  it("returns true the first time an effect is claimed for a member, false thereafter", async () => {
    const userId = await seedMember();

    const first = await claimOnboardingEffect(userId, ONBOARDING_EFFECT.COMPLETION_CANCEL_SEQUENCES);
    expect(first).toBe(true);

    const second = await claimOnboardingEffect(userId, ONBOARDING_EFFECT.COMPLETION_CANCEL_SEQUENCES);
    expect(second).toBe(false);
  });

  it("tracks each effect independently — claiming one effect does not block a different effect for the same member", async () => {
    const userId = await seedMember();

    expect(await claimOnboardingEffect(userId, ONBOARDING_EFFECT.CREATION_NURTURE_FRONTEND_TO_UPGRADE)).toBe(true);
    expect(await claimOnboardingEffect(userId, ONBOARDING_EFFECT.COMPLETION_CANCEL_SEQUENCES)).toBe(true);
  });

  it("re-running applyCreationTimeOnboardingDefaults for the same 'none'-tier member does not double-claim the creation effect", async () => {
    const userId = await seedMember();

    await applyCreationTimeOnboardingDefaults(userId);
    const claimedAgain = await claimOnboardingEffect(userId, ONBOARDING_EFFECT.CREATION_NURTURE_FRONTEND_TO_UPGRADE);
    expect(claimedAgain).toBe(false);

    // Calling the whole function again must be a safe no-op too (no throw).
    await expect(applyCreationTimeOnboardingDefaults(userId)).resolves.toBe("none");
  });
});

describe("computeUpgradeReentryStep — carries satisfied steps into the new variant", () => {
  it("a never-stepped 'none' member always lands on the new variant's first step", () => {
    expect(computeUpgradeReentryStep("none", 1, false, "launchpad")).toBe(1);
    expect(computeUpgradeReentryStep("none", 1, false, "full")).toBe(1);
  });

  it("an in-progress launchpad member carries satisfied steps into 'full'", () => {
    // On launchpad step 3 (kickoff_booked) means steps 1-2 (welcome, profile)
    // are satisfied; full's array is [welcome, profile, kickoff_booked,
    // partner_call_booked, pillars_watched, partner_call_completed] — first
    // unsatisfied is kickoff_booked (step 3), since full still requires it.
    expect(computeUpgradeReentryStep("launchpad", 3, false, "full")).toBe(3);
  });

  it("a fully-completed launchpad member lands on 'partner_call_booked' (step 4) in full", () => {
    // completed launchpad carries {welcome, profile, kickoff_booked,
    // pillars_watched}; full's first NOT-satisfied step is partner_call_booked.
    expect(computeUpgradeReentryStep("launchpad", 4, true, "full")).toBe(4);
  });
});

describe("maybeForceOnboardingReentry — upgrade hook at the grant seam", () => {
  it("none -> launchpad: flips onboardingComplete false and sets step 1", async () => {
    const userId = await seedMember({ onboardingVariant: "none", onboardingStep: 1, onboardingComplete: true });
    await grantProduct(userId, launchpadProductId);

    await maybeForceOnboardingReentry(userId);

    const user = await getUser(userId);
    expect(user.onboardingVariant).toBe("launchpad");
    expect(user.onboardingComplete).toBe(false);
    expect(user.onboardingStep).toBe(1);
  });

  it("none -> full: flips onboardingComplete false and sets step 1", async () => {
    const userId = await seedMember({ onboardingVariant: "none", onboardingStep: 1, onboardingComplete: true });
    await grantProduct(userId, fullTierProductId);

    await maybeForceOnboardingReentry(userId);

    const user = await getUser(userId);
    expect(user.onboardingVariant).toBe("full");
    expect(user.onboardingComplete).toBe(false);
    expect(user.onboardingStep).toBe(1);
  });

  it("launchpad -> full: carries satisfied steps forward instead of resetting to step 1", async () => {
    // Member fully completed launchpad onboarding already.
    const userId = await seedMember({ onboardingVariant: "launchpad", onboardingStep: 4, onboardingComplete: true });
    await grantProduct(userId, launchpadProductId);
    await grantProduct(userId, fullTierProductId);

    await maybeForceOnboardingReentry(userId);

    const user = await getUser(userId);
    expect(user.onboardingVariant).toBe("full");
    expect(user.onboardingComplete).toBe(false);
    // welcome, profile, kickoff_booked, pillars_watched satisfied -> first
    // unsatisfied full step is partner_call_booked (step 4).
    expect(user.onboardingStep).toBe(4);
  });

  it("is a no-op for a same-tier grant (e.g. adding a second launchpad-rank product)", async () => {
    const userId = await seedMember({ onboardingVariant: "launchpad", onboardingStep: 3, onboardingComplete: false });
    await grantProduct(userId, launchpadProductId);

    await maybeForceOnboardingReentry(userId);

    const user = await getUser(userId);
    expect(user.onboardingVariant).toBe("launchpad");
    expect(user.onboardingComplete).toBe(false);
    expect(user.onboardingStep).toBe(3);
  });

  it("is a no-op for a lower-rank addition to an existing 'full' member (never regresses)", async () => {
    const userId = await seedMember({ onboardingVariant: "full", onboardingStep: 6, onboardingComplete: true });
    await grantProduct(userId, fullTierProductId);
    await grantProduct(userId, launchpadProductId);

    await maybeForceOnboardingReentry(userId);

    const user = await getUser(userId);
    expect(user.onboardingVariant).toBe("full");
    expect(user.onboardingComplete).toBe(true);
    expect(user.onboardingStep).toBe(6);
  });

  it("never throws for a nonexistent user id", async () => {
    await expect(maybeForceOnboardingReentry(-999999)).resolves.toBeUndefined();
  });
});

describe("insertUserProductGrant — wires the upgrade hook at the real grant seam", () => {
  it("granting a launchpad product to a fresh none-tier member forces onboarding re-entry", async () => {
    const userId = await seedMember({ onboardingVariant: "none", onboardingStep: 1, onboardingComplete: true });

    const result = await insertUserProductGrant({
      userId,
      productId: launchpadProductId,
      externalSource: "manual",
      externalOrderId: `${TEST_TAG}-order-${randomUUID().slice(0, 8)}`,
    });
    expect(result.alreadyGranted).toBe(false);

    const user = await getUser(userId);
    expect(user.onboardingVariant).toBe("launchpad");
    expect(user.onboardingComplete).toBe(false);
    expect(user.onboardingStep).toBe(1);
  });

  it("granting a 3month (full-tier) product to a fresh none-tier member forces onboarding re-entry", async () => {
    const userId = await seedMember({ onboardingVariant: "none", onboardingStep: 1, onboardingComplete: true });

    await insertUserProductGrant({
      userId,
      productId: fullTierProductId,
      externalSource: "manual",
      externalOrderId: `${TEST_TAG}-order-${randomUUID().slice(0, 8)}`,
    });

    const user = await getUser(userId);
    expect(user.onboardingVariant).toBe("full");
    expect(user.onboardingComplete).toBe(false);
    expect(user.onboardingStep).toBe(1);
  });
});

describe("extendActiveGrantExpiry — demotion/expiry path must NEVER re-open onboarding", () => {
  it("extending an active grant's expiry leaves onboardingComplete/step untouched", async () => {
    const userId = await seedMember({ onboardingVariant: "full", onboardingStep: 6, onboardingComplete: true });
    await db.insert(userProductsTable).values({
      userId,
      productId: fullTierProductId,
      status: "active",
      purchasedAt: new Date(),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });

    await extendActiveGrantExpiry({
      userId,
      productId: fullTierProductId,
      newExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      externalSource: "manual",
      externalOrderId: `${TEST_TAG}-extend-${randomUUID().slice(0, 8)}`,
    });

    const user = await getUser(userId);
    expect(user.onboardingVariant).toBe("full");
    expect(user.onboardingComplete).toBe(true);
    expect(user.onboardingStep).toBe(6);
  });

  it("does not call the upgrade hook even when the member's persisted variant is stale/lower than their products", async () => {
    // Simulate a member whose persisted variant lags their real products
    // (shouldn't normally happen, but proves extendActiveGrantExpiry never
    // re-resolves/re-enters onboarding regardless).
    const userId = await seedMember({ onboardingVariant: "none", onboardingStep: 1, onboardingComplete: true });
    await db.insert(userProductsTable).values({
      userId,
      productId: fullTierProductId,
      status: "active",
      purchasedAt: new Date(),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });

    await extendActiveGrantExpiry({
      userId,
      productId: fullTierProductId,
      newExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      externalSource: "manual",
      externalOrderId: `${TEST_TAG}-extend-${randomUUID().slice(0, 8)}`,
    });

    const user = await getUser(userId);
    expect(user.onboardingVariant).toBe("none");
    expect(user.onboardingComplete).toBe(true);
    expect(user.onboardingStep).toBe(1);
  });
});
