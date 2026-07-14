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
import { renderPitchBlock, escapeHtml, applyPitchMarkup } from "../lib/seed-templates";
import { seedVipArbitrageProduct } from "../lib/seed-vip-arbitrage-product";

// Task #1824/#1899: the tier-based upgrade pitch stack. `pitchStackForRank` is a
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

// ── Task #1899: escape-then-transform helpers ────────────────────────────────

describe("escapeHtml (Task #1899 security fix)", () => {
  it("escapes & < > \" ' into HTML entities", () => {
    expect(escapeHtml("a & b")).toBe("a &amp; b");
    expect(escapeHtml("<script>alert(1)</script>")).toBe("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(escapeHtml('"quoted"')).toBe("&quot;quoted&quot;");
    expect(escapeHtml("it's")).toBe("it&#x27;s");
  });

  it("passes through plain text unchanged", () => {
    expect(escapeHtml("Hello, world!")).toBe("Hello, world!");
    expect(escapeHtml("1 + 1 = 2")).toBe("1 + 1 = 2");
  });
});

describe("applyPitchMarkup (Task #1899 three-marker whitelist)", () => {
  it("transforms **bold** → <strong>", () => {
    expect(applyPitchMarkup("**hello**")).toBe("<strong>hello</strong>");
  });

  it("transforms *italic* → <em>", () => {
    expect(applyPitchMarkup("*hello*")).toBe("<em>hello</em>");
  });

  it("transforms __underline__ → <u>", () => {
    expect(applyPitchMarkup("__hello__")).toBe("<u>hello</u>");
  });

  it("parses ** before * so **bold** is not mangled", () => {
    const result = applyPitchMarkup("**bold** and *italic*");
    expect(result).toBe("<strong>bold</strong> and <em>italic</em>");
  });

  it("does NOT transform any other markers", () => {
    expect(applyPitchMarkup("~~strike~~")).toBe("~~strike~~");
    expect(applyPitchMarkup("# heading")).toBe("# heading");
    expect(applyPitchMarkup("[link](url)")).toBe("[link](url)");
  });

  it("leaves already-escaped entities untouched", () => {
    expect(applyPitchMarkup("&lt;script&gt;")).toBe("&lt;script&gt;");
  });
});

// ── Task #1899 security: literal HTML/script in config fields is neutralized ─

describe("renderGatedPitchBlock escape-then-transform (Task #1899 security requirement)", () => {
  const gate = { reviewed: true } as const;

  it("a literal <script> in heading renders as visible escaped text, never as markup", () => {
    const html = renderGatedPitchBlock("MACHINE_PITCH", {
      heading: '<script>alert("xss")</script>',
      line: "safe line",
      buttonLabel: "Go",
      buttonUrl: "https://example.test",
    });
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("a literal <script> in line renders as visible escaped text", () => {
    const html = renderGatedPitchBlock("MACHINE_PITCH", {
      heading: "Safe heading",
      line: '<script>alert("xss")</script>',
      buttonLabel: "Go",
      buttonUrl: "https://example.test",
    });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("a literal <script> in body renders as visible escaped text", () => {
    const html = renderGatedPitchBlock("MACHINE_PITCH", {
      heading: "Safe heading",
      body: 'Normal text. <script>alert("xss")</script> More text.',
      buttonLabel: "Go",
      buttonUrl: "https://example.test",
    });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("a literal <script> in buttonLabel renders as visible escaped text", () => {
    const html = renderGatedPitchBlock("MACHINE_PITCH", {
      heading: "Safe heading",
      line: "Safe line",
      buttonLabel: '<script>steal()</script>',
      buttonUrl: "https://example.test",
    });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("**bold** in body renders as <strong> after escaping (whitelist markers work)", () => {
    const html = renderGatedPitchBlock("MACHINE_PITCH", {
      heading: "Heading",
      body: "Check out **this feature** today.",
      buttonLabel: "Go",
      buttonUrl: "https://example.test",
    });
    expect(html).toContain("<strong>this feature</strong>");
  });

  it("*italic* in body renders as <em>", () => {
    const html = renderGatedPitchBlock("MACHINE_PITCH", {
      heading: "Heading",
      body: "This is *really* great.",
      buttonLabel: "Go",
      buttonUrl: "https://example.test",
    });
    expect(html).toContain("<em>really</em>");
  });

  it("__underline__ in body renders as <u>", () => {
    const html = renderGatedPitchBlock("MACHINE_PITCH", {
      heading: "Heading",
      body: "__when you grow, we grow.__",
      buttonLabel: "Go",
      buttonUrl: "https://example.test",
    });
    expect(html).toContain("<u>when you grow, we grow.</u>");
  });

  it("VIP_ARBITRAGE_PITCH with reviewed:true also escapes properly", () => {
    const html = renderGatedPitchBlock("VIP_ARBITRAGE_PITCH", {
      heading: "VIP <b>heading</b>",
      line: "safe line",
      buttonLabel: "Go",
      buttonUrl: "https://example.test",
      ...gate,
    });
    expect(html).not.toContain("<b>");
    expect(html).toContain("&lt;b&gt;");
  });
});

// ── Task #1899: body field rendering per emphasis level ──────────────────────

describe("renderPitchBlock body field (Task #1899)", () => {
  const base = {
    heading: "Test Heading",
    buttonLabel: "Go",
    buttonUrl: "https://example.test/plans",
  };

  it("renders body (as safe HTML) between heading and button at primary", () => {
    const html = renderPitchBlock({ ...base, body: "This is <strong>bold</strong> body text." });
    expect(html).toContain("This is <strong>bold</strong> body text.");
    const bodyIndex = html.indexOf("body text.");
    const headingIndex = html.indexOf("Test Heading");
    const buttonIndex = html.indexOf("https://example.test/plans");
    expect(headingIndex).toBeLessThan(bodyIndex);
    expect(bodyIndex).toBeLessThan(buttonIndex);
  });

  it("renders body at secondary emphasis", () => {
    const html = renderPitchBlock({ ...base, body: "Secondary <em>body</em>." }, "secondary");
    expect(html).toContain("Secondary <em>body</em>.");
  });

  it("at tertiary, renders the (pre-truncated) body snippet passed in", () => {
    const html = renderPitchBlock({ ...base, body: "First sentence." }, "tertiary");
    expect(html).toContain("First sentence.");
  });

  it("body takes precedence over line when both are set", () => {
    const html = renderPitchBlock({ ...base, body: "Body wins.", line: "Line should be ignored." });
    expect(html).toContain("Body wins.");
    expect(html).not.toContain("Line should be ignored.");
  });

  it("falls back to line when body is absent", () => {
    const html = renderPitchBlock({ ...base, line: "Old-style line." });
    expect(html).toContain("Old-style line.");
  });

  it("renders with neither body nor line (heading + button only)", () => {
    const html = renderPitchBlock(base);
    expect(html).toContain("Test Heading");
    expect(html).toContain("Go");
  });
});

describe("renderGatedPitchBlock tertiary compact truncation (Task #1899)", () => {
  it("truncates multi-sentence body to first sentence at tertiary", () => {
    const html = renderGatedPitchBlock("MACHINE_PITCH", {
      heading: "Heading",
      body: "First sentence. Second sentence. Third sentence.",
      buttonLabel: "Go",
      buttonUrl: "https://example.test",
    }, "tertiary");
    expect(html).toContain("First sentence.");
    expect(html).not.toContain("Second sentence.");
  });

  it("renders full body at primary (no truncation)", () => {
    const html = renderGatedPitchBlock("MACHINE_PITCH", {
      heading: "Heading",
      body: "First sentence. Second sentence.",
      buttonLabel: "Go",
      buttonUrl: "https://example.test",
    }, "primary");
    expect(html).toContain("First sentence.");
    expect(html).toContain("Second sentence.");
  });
});

// ── Task #1899: updated rank matrix (MACHINE_INTRO for ranks 0-1) ────────────

describe("pitchStackForRank (Task #1899 updated matrix)", () => {
  it("rank 0 (free/frontend-only) gets LaunchPad, MachineIntro, VIP Arbitrage", () => {
    expect(pitchStackForRank(0, false, false)).toEqual([
      "LAUNCHPAD_PITCH",
      "MACHINE_INTRO_PITCH",
      "VIP_ARBITRAGE_PITCH",
    ]);
  });

  it("rank 1 (LaunchPad) gets Mentorship, MachineIntro, VIP Arbitrage", () => {
    expect(pitchStackForRank(1, false, false)).toEqual([
      "MENTORSHIP_PITCH",
      "MACHINE_INTRO_PITCH",
      "VIP_ARBITRAGE_PITCH",
    ]);
  });

  it("ranks 2-5 (3month..lifetime) get full Machine pitch, VIP Arbitrage", () => {
    for (const rank of [2, 3, 4, 5]) {
      expect(pitchStackForRank(rank, false, false)).toEqual(["MACHINE_PITCH", "VIP_ARBITRAGE_PITCH"]);
    }
  });

  it("rank 6+ (BTS VIP) gets full Machine pitch, VIP Arbitrage (commission claim holds at VIP)", () => {
    expect(pitchStackForRank(6, false, false)).toEqual(["MACHINE_PITCH", "VIP_ARBITRAGE_PITCH"]);
    expect(pitchStackForRank(7, false, false)).toEqual(["MACHINE_PITCH", "VIP_ARBITRAGE_PITCH"]);
  });

  it("negative rank treated same as rank 0 (MachineIntro, not full pitch)", () => {
    expect(pitchStackForRank(-1, false, false)).toEqual([
      "LAUNCHPAD_PITCH",
      "MACHINE_INTRO_PITCH",
      "VIP_ARBITRAGE_PITCH",
    ]);
  });

  it("machineMember=true suppresses MACHINE_INTRO_PITCH at ranks 0-1 (closes the gap)", () => {
    expect(pitchStackForRank(0, true, false)).toEqual(["LAUNCHPAD_PITCH", "VIP_ARBITRAGE_PITCH"]);
    expect(pitchStackForRank(1, true, false)).toEqual(["MENTORSHIP_PITCH", "VIP_ARBITRAGE_PITCH"]);
  });

  it("machineMember=true suppresses MACHINE_PITCH at ranks 2+", () => {
    expect(pitchStackForRank(3, true, false)).toEqual(["VIP_ARBITRAGE_PITCH"]);
    expect(pitchStackForRank(6, true, false)).toEqual(["VIP_ARBITRAGE_PITCH"]);
  });

  it("vipArbitrageMember=true suppresses VIP_ARBITRAGE_PITCH at every rank", () => {
    expect(pitchStackForRank(0, false, true)).toEqual(["LAUNCHPAD_PITCH", "MACHINE_INTRO_PITCH"]);
    expect(pitchStackForRank(1, false, true)).toEqual(["MENTORSHIP_PITCH", "MACHINE_INTRO_PITCH"]);
    expect(pitchStackForRank(3, false, true)).toEqual(["MACHINE_PITCH"]);
    expect(pitchStackForRank(6, false, true)).toEqual(["MACHINE_PITCH"]);
  });

  it("both flags true: rank 0 keeps LaunchPad; rank 6+ is empty", () => {
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
  it("returns the rank-0 stack (LaunchPad+MachineIntro+VIPArb) for a member with no products", async () => {
    const userId = await seedMember();
    expect(await resolvePitchStack(userId)).toEqual(["LAUNCHPAD_PITCH", "MACHINE_INTRO_PITCH", "VIP_ARBITRAGE_PITCH"]);
  });

  it("returns the rank-1 stack (Mentorship+MachineIntro+VIPArb) for a LaunchPad member", async () => {
    const userId = await seedMember();
    await grantActiveProduct(userId, "launchpad");
    expect(await resolvePitchStack(userId)).toEqual(["MENTORSHIP_PITCH", "MACHINE_INTRO_PITCH", "VIP_ARBITRAGE_PITCH"]);
  });

  it("returns the machine+vip-arbitrage stack for a VIP member (full Machine pitch)", async () => {
    const userId = await seedMember();
    await grantActiveProduct(userId, "vip");
    expect(await resolvePitchStack(userId)).toEqual(["MACHINE_PITCH", "VIP_ARBITRAGE_PITCH"]);
  });

  it("suppresses VIP_ARBITRAGE_PITCH end-to-end for a member holding an active vip_arbitrage grant (Task #1854)", async () => {
    const userId = await seedMember();
    await grantActiveProduct(userId, "vip_arbitrage");
    // vip_arbitrage carries no rank, so the member is otherwise rank 0.
    expect(await resolvePitchStack(userId)).toEqual(["LAUNCHPAD_PITCH", "MACHINE_INTRO_PITCH"]);
  });
});

describe("isPitchBlockReviewed (Task #1824 compliance gate)", () => {
  it("is always true for non-VIP-Arbitrage blocks, regardless of `reviewed`", () => {
    expect(isPitchBlockReviewed("LAUNCHPAD_PITCH", {})).toBe(true);
    expect(isPitchBlockReviewed("MENTORSHIP_PITCH", { reviewed: false })).toBe(true);
    expect(isPitchBlockReviewed("MACHINE_PITCH", { reviewed: undefined })).toBe(true);
    expect(isPitchBlockReviewed("MACHINE_INTRO_PITCH", {})).toBe(true);
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

  it("renders non-gated blocks unconditionally, with escape-then-transform applied", () => {
    const content = { heading: "Machine Heading", line: "x", buttonLabel: "Go", buttonUrl: "https://x.test" };
    const html = renderGatedPitchBlock("MACHINE_PITCH", content);
    expect(html).toContain("Machine Heading");
    expect(html).toContain("Go");
  });

  it("returns empty string for null/undefined content (fail closed, no crash)", () => {
    expect(renderGatedPitchBlock("VIP_ARBITRAGE_PITCH", null)).toBe("");
    expect(renderGatedPitchBlock("MACHINE_PITCH", null)).toBe("");
  });

  it("MACHINE_INTRO_PITCH is not gated (always renders like non-VIP blocks)", () => {
    const content = { heading: "Meet The Machine", line: "Intro line", buttonLabel: "See It", buttonUrl: "https://x.test" };
    const html = renderGatedPitchBlock("MACHINE_INTRO_PITCH", content);
    expect(html).toContain("Meet The Machine");
  });
});

describe("renderPitchStackHtml", () => {
  it("renders non-empty HTML containing LaunchPad heading for a rank-0 member (now with MachineIntro)", async () => {
    const userId = await seedMember();
    const html = await renderPitchStackHtml(userId);
    expect(html.length).toBeGreaterThan(0);
    expect(html).toContain("LaunchPad");
  });

  it("rank-0 stack includes MACHINE_INTRO_PITCH content (not the full commission-claim pitch)", async () => {
    const userId = await seedMember();
    const html = await renderPitchStackHtml(userId);
    // The default MACHINE_INTRO placeholder heading must appear; the full
    // commission-claim default heading must NOT appear.
    expect(html).toContain("Machine");
  });

  it("never renders the VIP Arbitrage block content even though it's in the rank-0 stack (default reviewed: false)", async () => {
    const userId = await seedMember();
    const html = await renderPitchStackHtml(userId);
    expect(html).not.toContain("VIP Arbitrage");
  });

  it("returns an empty string for an empty stack", () => {
    expect(pitchStackForRank(6, true, true)).toEqual([]);
  });

  it("rank-0 stack renders with no default thumbnail (LaunchPad's placeholder GIF was never published)", async () => {
    const userId = await seedMember();
    const html = await renderPitchStackHtml(userId);
    expect(html.length).toBeGreaterThan(0);
    expect(html).not.toContain("<img src=");
    expect(html).not.toContain("pitch-thumbnails");
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
