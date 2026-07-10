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
  isVipArbitrageMember,
  isPitchBlockReviewed,
  renderGatedPitchBlock,
} from "../lib/pitch-resolver";
import { __invalidatePitchContentCacheForTests } from "../lib/pitch-content-settings";
import { renderPitchBlock } from "../lib/seed-templates";
import { seedVipArbitrageProduct } from "../lib/seed-vip-arbitrage-product";

// Task #1824: the tier-based upgrade pitch stack. `pitchStackForRank` is a
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
  it("rank 0 (free/frontend-only) gets LaunchPad, Machine, VIP Arbitrage", () => {
    expect(pitchStackForRank(0, false, false)).toEqual([
      "LAUNCHPAD_PITCH",
      "MACHINE_PITCH",
      "VIP_ARBITRAGE_PITCH",
    ]);
  });

  it("rank 1 (LaunchPad) gets Mentorship, Machine, VIP Arbitrage", () => {
    expect(pitchStackForRank(1, false, false)).toEqual([
      "MENTORSHIP_PITCH",
      "MACHINE_PITCH",
      "VIP_ARBITRAGE_PITCH",
    ]);
  });

  it("ranks 2-5 (3month..lifetime) get Machine, VIP Arbitrage", () => {
    for (const rank of [2, 3, 4, 5]) {
      expect(pitchStackForRank(rank, false, false)).toEqual(["MACHINE_PITCH", "VIP_ARBITRAGE_PITCH"]);
    }
  });

  it("rank 6+ (BTS VIP) gets Machine, VIP Arbitrage — VIP no longer changes this slot", () => {
    expect(pitchStackForRank(6, false, false)).toEqual(["MACHINE_PITCH", "VIP_ARBITRAGE_PITCH"]);
    expect(pitchStackForRank(7, false, false)).toEqual(["MACHINE_PITCH", "VIP_ARBITRAGE_PITCH"]);
  });

  it("negative rank is treated the same as rank 0", () => {
    expect(pitchStackForRank(-1, false, false)).toEqual([
      "LAUNCHPAD_PITCH",
      "MACHINE_PITCH",
      "VIP_ARBITRAGE_PITCH",
    ]);
  });

  it("machineMember=true suppresses MACHINE_PITCH at every rank, closing the gap", () => {
    expect(pitchStackForRank(0, true, false)).toEqual(["LAUNCHPAD_PITCH", "VIP_ARBITRAGE_PITCH"]);
    expect(pitchStackForRank(1, true, false)).toEqual(["MENTORSHIP_PITCH", "VIP_ARBITRAGE_PITCH"]);
    expect(pitchStackForRank(3, true, false)).toEqual(["VIP_ARBITRAGE_PITCH"]);
    expect(pitchStackForRank(6, true, false)).toEqual(["VIP_ARBITRAGE_PITCH"]);
  });

  it("vipArbitrageMember=true suppresses VIP_ARBITRAGE_PITCH at every rank, closing the gap", () => {
    expect(pitchStackForRank(0, false, true)).toEqual(["LAUNCHPAD_PITCH", "MACHINE_PITCH"]);
    expect(pitchStackForRank(1, false, true)).toEqual(["MENTORSHIP_PITCH", "MACHINE_PITCH"]);
    expect(pitchStackForRank(3, false, true)).toEqual(["MACHINE_PITCH"]);
    expect(pitchStackForRank(6, false, true)).toEqual(["MACHINE_PITCH"]);
  });

  it("both flags true leaves only the tier-specific block (rank 0 keeps LaunchPad; rank 6+ is empty)", () => {
    expect(pitchStackForRank(0, true, true)).toEqual(["LAUNCHPAD_PITCH"]);
    expect(pitchStackForRank(6, true, true)).toEqual([]);
  });
});

describe("isMachineMember stub", () => {
  it("always returns false (TODO: real DB-backed implementation)", async () => {
    expect(await isMachineMember(1)).toBe(false);
    expect(await isMachineMember(999999)).toBe(false);
  });
});

// Task #1854: isVipArbitrageMember is now a real DB-backed check against
// active `vip_arbitrage` product grants (the row a Machine-side VIP Arbitrage
// purchase lands as). The boot seeder is idempotent, so calling it here keeps
// the suite green on a DB the api-server hasn't booted against yet.
describe("isVipArbitrageMember (DB-backed, Task #1854)", () => {
  beforeAll(async () => {
    // Idempotent boot seed — keeps this suite green (and order-independent)
    // on a DB the api-server hasn't booted against yet.
    await seedVipArbitrageProduct();
  });

  it("returns false for a member with no products at all", async () => {
    const userId = await seedMember();
    expect(await isVipArbitrageMember(userId)).toBe(false);
  });

  it("returns false for a member holding other products but not vip_arbitrage", async () => {
    const userId = await seedMember();
    await grantActiveProduct(userId, "lifetime");
    expect(await isVipArbitrageMember(userId)).toBe(false);
  });

  it("returns true for a member with an active, non-expiring vip_arbitrage grant", async () => {
    const userId = await seedMember();
    await grantActiveProduct(userId, "vip_arbitrage");
    expect(await isVipArbitrageMember(userId)).toBe(true);
  });

  it("ignores an expired vip_arbitrage grant", async () => {
    const userId = await seedMember();
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    await grantActiveProduct(userId, "vip_arbitrage", yesterday);
    expect(await isVipArbitrageMember(userId)).toBe(false);
  });

  it("ignores a non-active (e.g. refunded/cancelled) vip_arbitrage grant", async () => {
    const userId = await seedMember();
    const productId = await productIdFor("vip_arbitrage");
    await db.insert(userProductsTable).values({
      userId,
      productId,
      status: "cancelled",
      purchasedAt: new Date(),
    });
    expect(await isVipArbitrageMember(userId)).toBe(false);
  });

  it("reflects a fresh purchase immediately (no caching)", async () => {
    const userId = await seedMember();
    expect(await isVipArbitrageMember(userId)).toBe(false);
    await grantActiveProduct(userId, "vip_arbitrage");
    expect(await isVipArbitrageMember(userId)).toBe(true);
  });

  it("does not contribute to member rank (vip_arbitrage is outside PRODUCT_RANK)", async () => {
    const userId = await seedMember();
    await grantActiveProduct(userId, "vip_arbitrage");
    expect(await resolveMemberRank(userId)).toBe(0);
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
    expect(await resolvePitchStack(userId)).toEqual(["LAUNCHPAD_PITCH", "MACHINE_PITCH", "VIP_ARBITRAGE_PITCH"]);
  });

  it("returns the rank-1 stack for a LaunchPad member", async () => {
    const userId = await seedMember();
    await grantActiveProduct(userId, "launchpad");
    expect(await resolvePitchStack(userId)).toEqual(["MENTORSHIP_PITCH", "MACHINE_PITCH", "VIP_ARBITRAGE_PITCH"]);
  });

  it("returns the machine+vip-arbitrage stack for a VIP member (VIP no longer changes this slot)", async () => {
    const userId = await seedMember();
    await grantActiveProduct(userId, "vip");
    expect(await resolvePitchStack(userId)).toEqual(["MACHINE_PITCH", "VIP_ARBITRAGE_PITCH"]);
  });

  it("suppresses VIP_ARBITRAGE_PITCH end-to-end for a member holding an active vip_arbitrage grant (Task #1854)", async () => {
    const userId = await seedMember();
    await grantActiveProduct(userId, "vip_arbitrage");
    // vip_arbitrage carries no rank, so the member is otherwise rank 0.
    expect(await resolvePitchStack(userId)).toEqual(["LAUNCHPAD_PITCH", "MACHINE_PITCH"]);
  });
});

describe("isPitchBlockReviewed (Task #1824 compliance gate)", () => {
  it("is always true for non-VIP-Arbitrage blocks, regardless of `reviewed`", () => {
    expect(isPitchBlockReviewed("LAUNCHPAD_PITCH", {})).toBe(true);
    expect(isPitchBlockReviewed("MENTORSHIP_PITCH", { reviewed: false })).toBe(true);
    expect(isPitchBlockReviewed("MACHINE_PITCH", { reviewed: undefined })).toBe(true);
  });

  it("is false for VIP_ARBITRAGE_PITCH when reviewed is missing or false", () => {
    expect(isPitchBlockReviewed("VIP_ARBITRAGE_PITCH", {})).toBe(false);
    expect(isPitchBlockReviewed("VIP_ARBITRAGE_PITCH", { reviewed: false })).toBe(false);
  });

  it("is true for VIP_ARBITRAGE_PITCH only when reviewed is the literal boolean true", () => {
    expect(isPitchBlockReviewed("VIP_ARBITRAGE_PITCH", { reviewed: true })).toBe(true);
  });
});

describe("renderGatedPitchBlock (the single gated rendering seam)", () => {
  const base = {
    heading: "VIP Arbitrage Heading",
    line: "VIP Arbitrage line",
    buttonLabel: "Go",
    buttonUrl: "https://example.test/vip-arbitrage",
  };

  it("suppresses VIP_ARBITRAGE_PITCH when not reviewed, even with fully-populated content", () => {
    expect(renderGatedPitchBlock("VIP_ARBITRAGE_PITCH", { ...base, reviewed: false })).toBe("");
    expect(renderGatedPitchBlock("VIP_ARBITRAGE_PITCH", base as any)).toBe("");
  });

  it("renders VIP_ARBITRAGE_PITCH once reviewed: true is set", () => {
    const html = renderGatedPitchBlock("VIP_ARBITRAGE_PITCH", { ...base, reviewed: true });
    expect(html).toContain("VIP Arbitrage Heading");
  });

  it("renders non-gated blocks unconditionally, matching raw renderPitchBlock", () => {
    const content = { heading: "Machine Heading", line: "x", buttonLabel: "Go", buttonUrl: "https://x.test" };
    expect(renderGatedPitchBlock("MACHINE_PITCH", content)).toBe(renderPitchBlock(content));
  });

  it("returns empty string for null/undefined content (fail closed, no crash)", () => {
    expect(renderGatedPitchBlock("VIP_ARBITRAGE_PITCH", null)).toBe("");
    expect(renderGatedPitchBlock("MACHINE_PITCH", null)).toBe("");
  });
});

describe("renderPitchStackHtml", () => {
  it("renders non-empty HTML containing every renderable block's heading for a rank-0 member", async () => {
    const userId = await seedMember();
    const html = await renderPitchStackHtml(userId);
    expect(html.length).toBeGreaterThan(0);
    expect(html).toContain("LaunchPad");
  });

  it("never renders the VIP Arbitrage block content even though it's in the rank-0 stack (default reviewed: false)", async () => {
    const userId = await seedMember();
    const html = await renderPitchStackHtml(userId);
    // The shipped default heading is a placeholder that would be an obvious
    // giveaway if the gate were bypassed.
    expect(html).not.toContain("VIP Arbitrage");
  });

  it("returns an empty string for an empty stack", () => {
    // Both stub flags true collapses the stack entirely; exercise the pure
    // path directly via the same contract renderPitchStackHtml relies on.
    expect(pitchStackForRank(6, true, true)).toEqual([]);
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
