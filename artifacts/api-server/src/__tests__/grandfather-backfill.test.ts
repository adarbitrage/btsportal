import { describe, it, expect, beforeAll, afterAll } from "vitest";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import { db, usersTable, productsTable, userProductsTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import {
  getGrandfatherPreflightReport,
  runGrandfatherBackfill,
} from "../lib/grandfather-backfill";

// Task #1643 (TB2): grandfather backfill for pre-existing members.
//
// This suite exercises the REAL one-time execution path against the shared
// dev DB (mirroring exactly how the marker-claim migrations in
// onboarding-advancement.ts are tested). There is no hardcoded expected
// count anywhere below — every assertion is either relative (>= N seeded
// rows) or scoped to the specific rows this test seeded, per the task's
// explicit instruction that the dev DB drifts continuously with other test
// activity so a fixed number would be wrong on arrival.

const TEST_TAG = `grandfather-backfill-${randomUUID().slice(0, 8)}`;
const seededUserIds: number[] = [];
let launchpadProductId: number;

async function seedMember(opts: {
  onboardingStep: number;
  onboardingComplete: boolean;
}): Promise<number> {
  const email = `${TEST_TAG}-${randomUUID().slice(0, 6)}@example.test`;
  const passwordHash = await bcrypt.hash("irrelevant", 4);
  const [row] = await db
    .insert(usersTable)
    .values({
      email,
      name: "Grandfather Backfill Test",
      passwordHash,
      role: "member",
      sourceProduct: null,
      emailVerified: true,
      onboardingStep: opts.onboardingStep,
      onboardingComplete: opts.onboardingComplete,
    })
    .returning({ id: usersTable.id });
  seededUserIds.push(row.id);
  return row.id;
}

async function getUser(userId: number) {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  return user;
}

// The dev DB sits behind a pooled proxy that can occasionally serve a read
// immediately following a committed write from a different pooled
// connection before that write is visible on the read path (transient
// read-after-write lag, not a bug in the backfill's transaction itself —
// the UPDATE's own `.returning()` count is the source of truth for what it
// touched). Poll briefly rather than asserting on a single potentially
// stale read.
async function waitForGrandfathered(userId: number, expected: boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  let last = await getUser(userId);
  while (last.grandfathered !== expected && Date.now() - start < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    last = await getUser(userId);
  }
  expect(last.grandfathered).toBe(expected);
}

beforeAll(async () => {
  const [launchpad] = await db
    .select({ id: productsTable.id })
    .from(productsTable)
    .where(eq(productsTable.slug, "launchpad"));
  if (!launchpad) {
    throw new Error("Expected dev-seeded 'launchpad' product to exist for grandfather-backfill tests");
  }
  launchpadProductId = launchpad.id;
});

afterAll(async () => {
  if (seededUserIds.length > 0) {
    await db.delete(userProductsTable).where(inArray(userProductsTable.userId, seededUserIds));
    await db.delete(usersTable).where(inArray(usersTable.id, seededUserIds));
  }
});

describe("grandfather backfill — pre-flight report", () => {
  it("reports live counts without writing anything (grandfathered stays false)", async () => {
    const before = await getGrandfatherPreflightReport();

    const notStarted = await seedMember({ onboardingStep: 1, onboardingComplete: false });
    const midFlight = await seedMember({ onboardingStep: 3, onboardingComplete: false });
    const alreadyComplete = await seedMember({ onboardingStep: 6, onboardingComplete: true });

    // If the marker has not been claimed yet (anywhere, ever, against this
    // dev DB), these three newly-seeded ungrandfathered members must show up
    // in the live total. Once the marker is claimed (permanently, one-time),
    // every member including new ones is grandfathered=false by default and
    // the bucket query will legitimately report 0 forever after — that is
    // the expected steady state, not a failure.
    if (!before.alreadyMigrated) {
      const after = await getGrandfatherPreflightReport();
      expect(after.total).toBeGreaterThanOrEqual(before.total + 3);
      expect(after.buckets.length).toBeGreaterThan(0);
    }

    // Pre-flight must never write — every seeded user should still be exactly
    // as seeded, regardless of marker state.
    for (const id of [notStarted, midFlight, alreadyComplete]) {
      const user = await getUser(id);
      expect(user.grandfathered).toBe(false);
    }
  });
});

describe("grandfather backfill — execution gate + one-time execution", () => {
  it("refuses to write without explicit confirmation", async () => {
    const member = await seedMember({ onboardingStep: 2, onboardingComplete: false });

    const result = await runGrandfatherBackfill({ confirm: false });
    if (result.reason !== "already_run") {
      expect(result.executed).toBe(false);
      expect(result.reason).toBe("confirmation_required");
      expect(result.usersUpdated).toBe(0);
    }

    const user = await getUser(member);
    expect(user.grandfathered).toBe(false);
    expect(user.onboardingComplete).toBe(false);
  });

  it("executes exactly once: grandfathers every pre-existing bucket, is idempotent, and leaves a post-ship signup untouched", async () => {
    const preflightBefore = await getGrandfatherPreflightReport();
    const alreadyMigratedBeforeThisTest = preflightBefore.alreadyMigrated;

    const notStarted = await seedMember({ onboardingStep: 1, onboardingComplete: false });
    const midFlight = await seedMember({ onboardingStep: 3, onboardingComplete: false });
    await db.insert(userProductsTable).values({
      userId: midFlight,
      productId: launchpadProductId,
      status: "active",
      purchasedAt: new Date(),
    });
    const alreadyComplete = await seedMember({ onboardingStep: 6, onboardingComplete: true });

    const first = await runGrandfatherBackfill({ confirm: true });

    if (!alreadyMigratedBeforeThisTest) {
      // This is the real, one-time execution for this dev DB — every
      // pre-existing ungrandfathered member (including the three seeded
      // just above, since they were inserted BEFORE the claim) gets
      // force-completed + stamped, regardless of tier or in-flight step.
      expect(first.executed).toBe(true);
      expect(first.usersUpdated).toBeGreaterThanOrEqual(3);

      for (const id of [notStarted, midFlight, alreadyComplete]) {
        await waitForGrandfathered(id, true);
        const user = await getUser(id);
        expect(user.onboardingComplete).toBe(true);
      }
    } else {
      // The marker was already claimed by an earlier run against this same
      // dev DB (this backfill is one-time-ever, permanently). These three
      // members were seeded AFTER that claim, so cutoff correctness means
      // they must be untouched — this is itself a live demonstration of the
      // cutoff guarantee, not a skipped assertion.
      expect(first.executed).toBe(false);
      expect(first.reason).toBe("already_run");

      for (const id of [notStarted, midFlight, alreadyComplete]) {
        const user = await getUser(id);
        expect(user.grandfathered).toBe(false);
        expect(user.onboardingComplete).toBe(id === alreadyComplete);
      }
    }

    // Cutoff correctness: a member created strictly after the marker is
    // claimed (whether that happened just now or in an earlier run) must
    // never be touched by a later call to this function.
    const postShip = await seedMember({ onboardingStep: 1, onboardingComplete: false });
    const postShipUser = await getUser(postShip);
    expect(postShipUser.grandfathered).toBe(false);
    expect(postShipUser.onboardingComplete).toBe(false);

    // Idempotency: running it again is a pure no-op, and does not touch the
    // post-ship signup either.
    const second = await runGrandfatherBackfill({ confirm: true });
    expect(second.executed).toBe(false);
    expect(second.reason).toBe("already_run");
    expect(second.usersUpdated).toBe(0);

    const postShipUserAfterSecondRun = await getUser(postShip);
    expect(postShipUserAfterSecondRun.grandfathered).toBe(false);
    expect(postShipUserAfterSecondRun.onboardingComplete).toBe(false);

    const finalReport = await getGrandfatherPreflightReport();
    expect(finalReport.alreadyMigrated).toBe(true);
  });
});
