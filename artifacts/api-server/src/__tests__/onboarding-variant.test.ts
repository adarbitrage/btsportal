import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import {
  db,
  usersTable,
  productsTable,
  userProductsTable,
  sequencesTable,
  sequenceEnrollmentsTable,
} from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";

import { buildTestAppWithRouters } from "./test-app";
import onboardingRouter from "../routes/onboarding";
import { resolveOnboardingVariant, applyCreationTimeOnboardingDefaults } from "../lib/onboarding-variant";
import {
  advanceOnboardingAfterPartnerCallBooked,
  completeOnboardingAfterPartnerCallDone,
} from "../lib/onboarding-advancement";

// Task #1640 (TA1): tier resolver + per-variant step arrays. Uses the
// PRE-EXISTING dev-seeded "launchpad" (rank 1) and "3month" (rank 2, resolves
// to "full") products rather than inserting new ones, since product slugs are
// unique and these already exist in every dev DB (see product-rank.ts).

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const TEST_TAG = `onboarding-variant-${randomUUID().slice(0, 8)}`;
const seededUserIds: number[] = [];

let app: ReturnType<typeof buildTestAppWithRouters>;
let launchpadProductId: number;
let fullTierProductId: number; // "3month" — rank 2, resolves to "full"

function signCookie(userId: number, email: string): string {
  const token = jwt.sign({ userId, email }, JWT_SECRET, { expiresIn: "1h" });
  return `access_token=${token}`;
}

async function seedMemberWithNoProducts(): Promise<{ id: number; email: string; cookie: string }> {
  const email = `${TEST_TAG}-${randomUUID().slice(0, 6)}@example.test`;
  const passwordHash = await bcrypt.hash("irrelevant", 4);
  const [row] = await db
    .insert(usersTable)
    .values({
      email,
      name: "Onboarding Variant Test",
      passwordHash,
      role: "member",
      sourceProduct: null,
      emailVerified: true,
    })
    .returning({ id: usersTable.id });
  seededUserIds.push(row.id);
  return { id: row.id, email, cookie: signCookie(row.id, email) };
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

async function activeEnrollment(userId: number, slug: string) {
  const [sequence] = await db.select().from(sequencesTable).where(eq(sequencesTable.slug, slug));
  if (!sequence) return undefined;
  const [enrollment] = await db
    .select()
    .from(sequenceEnrollmentsTable)
    .where(
      and(
        eq(sequenceEnrollmentsTable.userId, userId),
        eq(sequenceEnrollmentsTable.sequenceId, sequence.id),
        eq(sequenceEnrollmentsTable.status, "active"),
      ),
    );
  return enrollment;
}

beforeAll(async () => {
  app = buildTestAppWithRouters([onboardingRouter]);

  const [launchpad] = await db.select({ id: productsTable.id }).from(productsTable).where(eq(productsTable.slug, "launchpad"));
  const [threeMonth] = await db.select({ id: productsTable.id }).from(productsTable).where(eq(productsTable.slug, "3month"));
  if (!launchpad || !threeMonth) {
    throw new Error("Expected dev-seeded 'launchpad' and '3month' products to exist for onboarding-variant tests");
  }
  launchpadProductId = launchpad.id;
  fullTierProductId = threeMonth.id;
});

afterAll(async () => {
  if (seededUserIds.length > 0) {
    await db.delete(sequenceEnrollmentsTable).where(inArray(sequenceEnrollmentsTable.userId, seededUserIds));
    await db.delete(userProductsTable).where(inArray(userProductsTable.userId, seededUserIds));
    await db.delete(usersTable).where(inArray(usersTable.id, seededUserIds));
  }
});

describe("resolveOnboardingVariant — all three tiers", () => {
  it("resolves 'none' for a member with no active products", async () => {
    const { id } = await seedMemberWithNoProducts();
    expect(await resolveOnboardingVariant(id)).toBe("none");
  });

  it("resolves 'launchpad' for a member whose highest active product is rank 1", async () => {
    const { id } = await seedMemberWithNoProducts();
    await grantProduct(id, launchpadProductId);
    expect(await resolveOnboardingVariant(id)).toBe("launchpad");
  });

  it("resolves 'full' for a member whose highest active product is rank >= 2", async () => {
    const { id } = await seedMemberWithNoProducts();
    await grantProduct(id, fullTierProductId);
    expect(await resolveOnboardingVariant(id)).toBe("full");
  });

  it("ignores an expired product grant when resolving the variant", async () => {
    const { id } = await seedMemberWithNoProducts();
    await db.insert(userProductsTable).values({
      userId: id,
      productId: fullTierProductId,
      status: "active",
      purchasedAt: new Date(),
      expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
    });
    expect(await resolveOnboardingVariant(id)).toBe("none");
  });
});

describe("applyCreationTimeOnboardingDefaults — creation-time side effects per tier", () => {
  it("'none' tier: completes onboarding immediately and enrolls in nurture_frontend_to_upgrade", async () => {
    const { id } = await seedMemberWithNoProducts();

    const variant = await applyCreationTimeOnboardingDefaults(id);
    expect(variant).toBe("none");

    const user = await getUser(id);
    expect(user.onboardingVariant).toBe("none");
    expect(user.onboardingComplete).toBe(true);

    const enrollment = await activeEnrollment(id, "nurture_frontend_to_upgrade");
    expect(enrollment).toBeTruthy();
  });

  it("'launchpad' tier: persists the variant and leaves onboarding at step 1, incomplete", async () => {
    const { id } = await seedMemberWithNoProducts();
    await grantProduct(id, launchpadProductId);

    const variant = await applyCreationTimeOnboardingDefaults(id);
    expect(variant).toBe("launchpad");

    const user = await getUser(id);
    expect(user.onboardingVariant).toBe("launchpad");
    expect(user.onboardingComplete).toBe(false);
    expect(user.onboardingStep).toBe(1);
  });

  it("'full' tier: persists the variant and leaves onboarding at step 1, incomplete", async () => {
    const { id } = await seedMemberWithNoProducts();
    await grantProduct(id, fullTierProductId);

    const variant = await applyCreationTimeOnboardingDefaults(id);
    expect(variant).toBe("full");

    const user = await getUser(id);
    expect(user.onboardingVariant).toBe("full");
    expect(user.onboardingComplete).toBe(false);
    expect(user.onboardingStep).toBe(1);
  });
});

describe("GET/PATCH /members/me/onboarding — variant-aware step arrays", () => {
  it("'launchpad' GET reports the 4-step array and total", async () => {
    const { id, cookie } = await seedMemberWithNoProducts();
    await grantProduct(id, launchpadProductId);
    await applyCreationTimeOnboardingDefaults(id);

    const res = await request(app).get("/api/members/me/onboarding").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.variant).toBe("launchpad");
    expect(res.body.totalSteps).toBe(4);
    expect(res.body.stepNames).toEqual(["welcome", "profile", "kickoff_booked", "pillars_watched"]);
  });

  it("'full' GET reports the 6-step array and total", async () => {
    const { id, cookie } = await seedMemberWithNoProducts();
    await grantProduct(id, fullTierProductId);
    await applyCreationTimeOnboardingDefaults(id);

    const res = await request(app).get("/api/members/me/onboarding").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.variant).toBe("full");
    expect(res.body.totalSteps).toBe(6);
    expect(res.body.stepNames).toEqual([
      "welcome",
      "profile",
      "kickoff_booked",
      "partner_call_booked",
      "pillars_watched",
      "partner_call_completed",
    ]);
  });

  it("'none' tier is rejected by PATCH — onboarding is not applicable", async () => {
    const { id, cookie } = await seedMemberWithNoProducts();
    await applyCreationTimeOnboardingDefaults(id);
    expect((await getUser(id)).onboardingVariant).toBe("none");

    const res = await request(app).patch("/api/members/me/onboarding").set("Cookie", cookie).send({ step: 1 });
    expect(res.status).toBe(400);
  });

  it("'launchpad' member completes onboarding directly after step 4 (pillars_watched) — no partner-call tier", async () => {
    const { id, cookie } = await seedMemberWithNoProducts();
    await grantProduct(id, launchpadProductId);
    await applyCreationTimeOnboardingDefaults(id);

    // Step 1: welcome
    let res = await request(app).patch("/api/members/me/onboarding").set("Cookie", cookie).send({ step: 1 });
    expect(res.status).toBe(200);
    expect(res.body.currentStep).toBe(2);

    // Step 2: profile — requires name/experience/goal to be filled first.
    await db
      .update(usersTable)
      .set({ experienceLevel: "beginner", primaryGoal: "income" })
      .where(eq(usersTable.id, id));
    res = await request(app).patch("/api/members/me/onboarding").set("Cookie", cookie).send({ step: 2 });
    expect(res.status).toBe(200);
    expect(res.body.currentStep).toBe(3);

    // Step 3: kickoff_booked is event-only for launchpad too — client PATCH must be rejected.
    res = await request(app).patch("/api/members/me/onboarding").set("Cookie", cookie).send({ step: 3 });
    expect(res.status).toBe(400);

    // Simulate the kickoff-booked event advancing them to step 4.
    await db.update(usersTable).set({ onboardingStep: 4 }).where(eq(usersTable.id, id));

    // Step 4: pillars_watched — the LAST launchpad step, client-advanceable,
    // and completes onboarding directly (no partner-call step exists).
    res = await request(app).patch("/api/members/me/onboarding").set("Cookie", cookie).send({ step: 4 });
    expect(res.status).toBe(200);
    expect(res.body.currentStep).toBe(4);
    expect(res.body.onboardingComplete).toBe(true);

    const user = await getUser(id);
    expect(user.onboardingComplete).toBe(true);
    expect(user.onboardingStep).toBe(4);
  });

  it("'full' member does NOT complete after step 5 (pillars_watched) — step 6 remains event-only", async () => {
    const { id, cookie } = await seedMemberWithNoProducts();
    await grantProduct(id, fullTierProductId);
    await applyCreationTimeOnboardingDefaults(id);
    await db.update(usersTable).set({ onboardingStep: 5 }).where(eq(usersTable.id, id));

    const res = await request(app).patch("/api/members/me/onboarding").set("Cookie", cookie).send({ step: 5 });
    expect(res.status).toBe(200);
    expect(res.body.currentStep).toBe(6);
    expect(res.body.onboardingComplete).toBe(false);
  });
});

describe("Event-advance functions are variant-gated (no-op for launchpad, since it has no partner-call tier)", () => {
  it("advanceOnboardingAfterPartnerCallBooked is a no-op for a launchpad member", async () => {
    const { id } = await seedMemberWithNoProducts();
    await grantProduct(id, launchpadProductId);
    await applyCreationTimeOnboardingDefaults(id);
    // Put them at what would be "step 4" (partner_call_booked) under the FULL
    // numbering, to prove the guard checks variant, not just step position.
    await db.update(usersTable).set({ onboardingStep: 4 }).where(eq(usersTable.id, id));

    const advanced = await advanceOnboardingAfterPartnerCallBooked(id);
    expect(advanced).toBe(false);
    expect((await getUser(id)).onboardingStep).toBe(4);
  });

  it("advanceOnboardingAfterPartnerCallBooked DOES advance a full-tier member on step 4", async () => {
    const { id } = await seedMemberWithNoProducts();
    await grantProduct(id, fullTierProductId);
    await applyCreationTimeOnboardingDefaults(id);
    await db.update(usersTable).set({ onboardingStep: 4 }).where(eq(usersTable.id, id));

    const advanced = await advanceOnboardingAfterPartnerCallBooked(id);
    expect(advanced).toBe(true);
    expect((await getUser(id)).onboardingStep).toBe(5);
  });

  it("completeOnboardingAfterPartnerCallDone is a no-op for a launchpad member", async () => {
    const { id } = await seedMemberWithNoProducts();
    await grantProduct(id, launchpadProductId);
    await applyCreationTimeOnboardingDefaults(id);
    await db.update(usersTable).set({ onboardingStep: 6 }).where(eq(usersTable.id, id));

    const completed = await completeOnboardingAfterPartnerCallDone(id);
    expect(completed).toBe(false);
    const user = await getUser(id);
    expect(user.onboardingComplete).toBe(false);
    expect(user.onboardingStep).toBe(6);
  });
});
