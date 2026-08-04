/**
 * KB ownership-gate retrieval tests (real shared dev DB).
 *
 * The Blitz section-import corpus is stamped `owner_page_key = 'blitz'` (boot
 * migration) and retrieveSurfaceAware must gate those docs through the SAME
 * content-access check the Blitz APIs use:
 *  - FE-only member (`access: {viewerUserId}`): ZERO owner-gated docs — no
 *    titles/snippets through any path (precise, semantic, fallback).
 *  - Blitz owner: gated docs retrievable again.
 *  - Admin: role bypass.
 *  - Omitted `access`: fail-closed (gated docs excluded).
 *  - `access: "internal"` (review tooling): full corpus.
 *
 * Read-only against the corpus; only seeds/removes its own throwaway users.
 * Run with SKIP_DEV_DB_SYNC=1 --pool=threads --no-file-parallelism.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import { db, usersTable, userProductsTable, productsTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

import { retrieveSurfaceAware } from "../lib/kb-retrieval";

const TAG = `kbgate-${randomUUID().slice(0, 8)}`;
const seededUserIds: number[] = [];

// A stamped, citable Blitz doc known to exist in the corpus (owner_page_key =
// 'blitz'); its title is the query so the precise lexical pass matches it.
const BLITZ_DOC_TITLE = "The Three Phases — Build, Test, Scale";
const CATEGORIES = ["process"];

async function seedUser(role: string): Promise<number> {
  const passwordHash = await bcrypt.hash("irrelevant", 4);
  const [row] = await db
    .insert(usersTable)
    .values({
      email: `${TAG}-${randomUUID().slice(0, 6)}@example.test`,
      name: "KB Gate Test",
      passwordHash,
      role,
      emailVerified: true,
      onboardingComplete: true,
    })
    .returning({ id: usersTable.id });
  seededUserIds.push(row.id);
  return row.id;
}

async function grant(userId: number, slug: string): Promise<void> {
  const [product] = await db
    .select({ id: productsTable.id })
    .from(productsTable)
    .where(eq(productsTable.slug, slug));
  if (!product) throw new Error(`missing product slug ${slug} in dev DB`);
  await db
    .insert(userProductsTable)
    .values({ userId, productId: product.id, status: "active" });
}

async function retrieveFor(access: Parameters<typeof retrieveSurfaceAware>[1]["access"]) {
  return retrieveSurfaceAware(BLITZ_DOC_TITLE, {
    surface: "chat",
    categories: CATEGORIES,
    limit: 6,
    access,
  });
}

let feUserId: number;
let ownerUserId: number;
let adminUserId: number;

beforeAll(async () => {
  feUserId = await seedUser("member");
  await grant(feUserId, "yse_front_end");
  ownerUserId = await seedUser("member");
  await grant(ownerUserId, "yse_21_day_blitz");
  adminUserId = await seedUser("admin");
});

afterAll(async () => {
  if (seededUserIds.length > 0) {
    await db.delete(userProductsTable).where(inArray(userProductsTable.userId, seededUserIds));
    await db.delete(usersTable).where(inArray(usersTable.id, seededUserIds));
  }
});

describe("KB ownership gate (owner_page_key)", () => {
  it("sanity: the target doc is retrievable ungated (internal access)", async () => {
    const r = await retrieveFor("internal");
    expect(r.docs.some((d) => d.title === BLITZ_DOC_TITLE)).toBe(true);
    expect(r.docs.some((d) => d.ownerPageKey === "blitz")).toBe(true);
  });

  it("FE-only member gets ZERO owner-gated docs — no titles or snippets", async () => {
    const r = await retrieveFor({ viewerUserId: feUserId });
    expect(r.docs.every((d) => d.ownerPageKey === null)).toBe(true);
    expect(r.docs.some((d) => d.title === BLITZ_DOC_TITLE)).toBe(false);
  });

  it("Blitz owner retrieves the gated doc", async () => {
    const r = await retrieveFor({ viewerUserId: ownerUserId });
    expect(r.docs.some((d) => d.title === BLITZ_DOC_TITLE)).toBe(true);
  });

  it("admin role bypasses the gate", async () => {
    const r = await retrieveFor({ viewerUserId: adminUserId });
    expect(r.docs.some((d) => d.title === BLITZ_DOC_TITLE)).toBe(true);
  });

  it("omitted access fails closed — gated docs excluded", async () => {
    const r = await retrieveFor(undefined);
    expect(r.docs.every((d) => d.ownerPageKey === null)).toBe(true);
  });

  it("nonexistent viewer fails closed", async () => {
    const r = await retrieveFor({ viewerUserId: -999999 });
    expect(r.docs.every((d) => d.ownerPageKey === null)).toBe(true);
  });
});
