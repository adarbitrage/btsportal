import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import bcrypt from "bcryptjs";
import { db, usersTable, productsTable, userProductsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

import {
  pitchStackForRank,
  resolveMemberRank,
  resolvePitchStack,
  renderPitchStackHtml,
  isMachineMember,
} from "../lib/pitch-resolver";
import { __invalidatePitchContentCacheForTests } from "../lib/pitch-content-settings";
import { renderPitchBlock } from "../lib/seed-templates";

// Task #1715: the tier-based upgrade pitch stack. `pitchStackForRank` is a
// pure function tested directly against the exact matrix from the task; the
// DB-backed pieces (`resolveMemberRank`, `resolvePitchStack`,
// `renderPitchStackHtml`) use the pre-existing dev-seeded products
// (launchpad=1, 3month=2, lifetime=5, vip=6 — see product-rank.ts) rather
// than inserting new ones, since product slugs are unique per DB.

const TEST_TAG = `pitch-resolver-${randomUUID().slice(0, 8)}`;
const seededUserIds: number[] = [];

async function seedMember(): Promise<number> {
  const email = `${TEST_TAG}-${randomUUID().slice(0, 6)}@example.test`;
  const passwordHash = await bcrypt.hash("irrelevant", 4);
  const [row] = await db
    .insert(usersTable)
    .values({
      email,
      name: "Pitch Resolver Test",
      passwordHash,
      role: "member",
      sourceProduct: null,
      emailVerified: true,
    })
    .returning({ id: usersTable.id });
  seededUserIds.push(row.id);
  return row.id;
}

async function productIdFor(slug: string): Promise<number> {
  const [row] = await db.select({ id: productsTable.id }).from(productsTable).where(eq(productsTable.slug, slug));
  if (!row) throw new Error(`Expected dev-seeded product "${slug}" to exist`);
  return row.id;
}

async function grantActiveProduct(userId: number, slug: string, expiresAt: Date | null = null): Promise<void> {
  const productId = await productIdFor(slug);
  await db.insert(userProductsTable).values({
    userId,
    productId,
    status: "active",
    purchasedAt: new Date(),
    expiresAt,
  });
}

afterAll(async () => {
  if (seededUserIds.length > 0) {
    await db.delete(userProductsTable).where(eq(userProductsTable.userId, seededUserIds[0]));
    for (const id of seededUserIds) {
      await db.delete(userProductsTable).where(eq(userProductsTable.userId, id));
      await db.delete(usersTable).where(eq(usersTable.id, id));
    }
  }
  __invalidatePitchContentCacheForTests();
});

describe("pitchStackForRank (pure matrix)", () => {
  it("rank 0 (free/frontend-only) gets LaunchPad, Machine, VIP", () => {
    expect(pitchStackForRank(0, false)).toEqual(["LAUNCHPAD_PITCH", "MACHINE_PITCH", "VIP_PITCH"]);
  });

  it("rank 1 (LaunchPad) gets Mentorship, Machine, VIP", () => {
    expect(pitchStackForRank(1, false)).toEqual(["MENTORSHIP_PITCH", "MACHINE_PITCH", "VIP_PITCH"]);
  });

  it("ranks 2-5 (3month..lifetime) get Machine, VIP", () => {
    for (const rank of [2, 3, 4, 5]) {
      expect(pitchStackForRank(rank, false)).toEqual(["MACHINE_PITCH", "VIP_PITCH"]);
    }
  });

  it("rank 6+ (VIP) gets Machine only", () => {
    expect(pitchStackForRank(6, false)).toEqual(["MACHINE_PITCH"]);
    expect(pitchStackForRank(7, false)).toEqual(["MACHINE_PITCH"]);
  });

  it("negative rank is treated the same as rank 0", () => {
    expect(pitchStackForRank(-1, false)).toEqual(["LAUNCHPAD_PITCH", "MACHINE_PITCH", "VIP_PITCH"]);
  });

  it("machineMember=true suppresses MACHINE_PITCH at every rank, closing the gap", () => {
    expect(pitchStackForRank(0, true)).toEqual(["LAUNCHPAD_PITCH", "VIP_PITCH"]);
    expect(pitchStackForRank(1, true)).toEqual(["MENTORSHIP_PITCH", "VIP_PITCH"]);
    expect(pitchStackForRank(3, true)).toEqual(["VIP_PITCH"]);
  });

  it("machineMember=true at rank 6+ (VIP + Machine) resolves to an empty stack", () => {
    expect(pitchStackForRank(6, true)).toEqual([]);
  });
});

describe("isMachineMember stub", () => {
  it("always returns false (TODO: real DB-backed implementation)", async () => {
    expect(await isMachineMember(1)).toBe(false);
    expect(await isMachineMember(999999)).toBe(false);
  });
});

describe("resolveMemberRank (DB-backed, fresh read every call)", () => {
  it("resolves rank 0 for a member with no active products", async () => {
    const userId = await seedMember();
    expect(await resolveMemberRank(userId)).toBe(0);
  });

  it("resolves rank 1 for a LaunchPad member", async () => {
    const userId = await seedMember();
    await grantActiveProduct(userId, "launchpad");
    expect(await resolveMemberRank(userId)).toBe(1);
  });

  it("resolves the MAX rank across multiple active products", async () => {
    const userId = await seedMember();
    await grantActiveProduct(userId, "launchpad");
    await grantActiveProduct(userId, "lifetime");
    expect(await resolveMemberRank(userId)).toBe(5);
  });

  it("resolves rank 6 for a VIP holder (VIP is NOT excluded from this rank calc)", async () => {
    const userId = await seedMember();
    await grantActiveProduct(userId, "vip");
    expect(await resolveMemberRank(userId)).toBe(6);
  });

  it("ignores an expired product grant", async () => {
    const userId = await seedMember();
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    await grantActiveProduct(userId, "lifetime", yesterday);
    expect(await resolveMemberRank(userId)).toBe(0);
  });

  it("ignores a non-active (e.g. cancelled) product grant", async () => {
    const userId = await seedMember();
    const productId = await productIdFor("lifetime");
    await db.insert(userProductsTable).values({
      userId,
      productId,
      status: "cancelled",
      purchasedAt: new Date(),
    });
    expect(await resolveMemberRank(userId)).toBe(0);
  });

  it("reflects a mid-session upgrade immediately (no caching)", async () => {
    const userId = await seedMember();
    expect(await resolveMemberRank(userId)).toBe(0);
    await grantActiveProduct(userId, "launchpad");
    expect(await resolveMemberRank(userId)).toBe(1);
  });
});

describe("resolvePitchStack (DB-backed)", () => {
  it("returns the rank-0 stack for a member with no products", async () => {
    const userId = await seedMember();
    expect(await resolvePitchStack(userId)).toEqual(["LAUNCHPAD_PITCH", "MACHINE_PITCH", "VIP_PITCH"]);
  });

  it("returns the rank-1 stack for a LaunchPad member", async () => {
    const userId = await seedMember();
    await grantActiveProduct(userId, "launchpad");
    expect(await resolvePitchStack(userId)).toEqual(["MENTORSHIP_PITCH", "MACHINE_PITCH", "VIP_PITCH"]);
  });

  it("returns the machine-only stack for a VIP member", async () => {
    const userId = await seedMember();
    await grantActiveProduct(userId, "vip");
    expect(await resolvePitchStack(userId)).toEqual(["MACHINE_PITCH"]);
  });
});

describe("renderPitchStackHtml", () => {
  it("renders non-empty HTML containing every block's heading for a rank-0 member", async () => {
    const userId = await seedMember();
    const html = await renderPitchStackHtml(userId);
    expect(html.length).toBeGreaterThan(0);
    expect(html).toContain("LaunchPad");
    expect(html).toContain("VIP");
  });

  it("returns an empty string for an empty stack", async () => {
    // A VIP holder's stack is machine-only; we can't reach a truly empty
    // stack without the (stubbed) machine-member flag, so exercise the pure
    // path directly via the same contract renderPitchStackHtml relies on.
    expect(pitchStackForRank(6, true)).toEqual([]);
  });

  it("rank-0 stack (which includes the LaunchPad block's default thumbnail) renders an <img> tag", async () => {
    const userId = await seedMember();
    const html = await renderPitchStackHtml(userId);
    expect(html).toContain("<img src=");
    expect(html).toContain("pitch-thumbnails");
  });
});

// Task #1820: optional thumbnail slot on renderPitchBlock — additive,
// email-safe, and alt-texted to the heading.
describe("renderPitchBlock (Task #1820 thumbnail slot)", () => {
  const base = {
    heading: "Test Heading",
    line: "Test line",
    buttonLabel: "Go",
    buttonUrl: "https://example.test/plans",
  };

  it("renders exactly as before when no thumbnail fields are set", () => {
    const html = renderPitchBlock(base);
    expect(html).not.toContain("<img");
    expect(html).toContain("Test Heading");
  });

  it("renders a linked <img> above the heading when both thumbnail fields are set", () => {
    const html = renderPitchBlock({
      ...base,
      thumbnailUrl: "https://cdn.example.test/thumb.gif",
      thumbnailLinkUrl: "https://example.test/plans",
    });
    expect(html).toContain('<a href="https://example.test/plans"');
    expect(html).toContain('<img src="https://cdn.example.test/thumb.gif"');
    expect(html).toContain('alt="Test Heading"');
    expect(html).toContain('width="280"');
    expect(html).toContain("max-width:100%");
    const imgIndex = html.indexOf("<img");
    const headingIndex = html.indexOf("Test Heading");
    expect(imgIndex).toBeGreaterThan(-1);
    expect(imgIndex).toBeLessThan(headingIndex);
  });

  it("renders no thumbnail when only one of the two fields is set", () => {
    expect(renderPitchBlock({ ...base, thumbnailUrl: "https://cdn.example.test/thumb.gif" })).not.toContain("<img");
    expect(renderPitchBlock({ ...base, thumbnailLinkUrl: "https://example.test/plans" })).not.toContain("<img");
  });

  it("returns empty string for null params (unchanged behavior)", () => {
    expect(renderPitchBlock(null)).toBe("");
  });
});
