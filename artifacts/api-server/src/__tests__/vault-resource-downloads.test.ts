import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import {
  db,
  usersTable,
  vaultCollectionsTable,
  vaultResourcesTable,
  vaultResourceRelationsTable,
  vaultFavoritesTable,
} from "@workspace/db";
import { eq, inArray, like, or } from "drizzle-orm";

// Runtime regression guard for two silent Resource Vault bugs that the
// typechecker could not see:
//   1. `POST /vault/resources/:id/download` always returned HTTP 400
//      "not downloadable" because it read a non-existent `type` column
//      instead of `resource_type`.
//   2. `seedVaultData` keyed its related-resource links by an undefined
//      `slug`, so every related id resolved to undefined and the inserts
//      blew up (or wrote dangling links). The fix keys relations off the
//      seed objects' own slugs.
// Both only surface at runtime, so a small DB-backed test pins them.

vi.mock("../lib/redis", () => ({
  getRedis: () => null,
  isRedisConnected: async () => false,
  getRedisConnection: vi.fn(),
  createRedisConnection: vi.fn(),
}));

import { buildTestAppWithRouters } from "./test-app";
import vaultRouter from "../routes/vault";
import { seedVaultData } from "../lib/seed-vault";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";

function signCookie(userId: number, email: string): string {
  const token = jwt.sign({ userId, email }, JWT_SECRET, { expiresIn: "1h" });
  return `access_token=${token}`;
}

async function insertUser(suffix: string): Promise<{ id: number; email: string }> {
  const email = `vault-dl-${suffix}-${randomUUID().slice(0, 8)}@example.test`;
  const passwordHash = await bcrypt.hash("irrelevant-test-password", 4);
  const [row] = await db
    .insert(usersTable)
    .values({
      email,
      name: `Vault DL ${suffix}`,
      passwordHash,
      role: "member",
      emailVerified: true,
      onboardingComplete: true,
    })
    .returning({ id: usersTable.id });
  return { id: row.id, email };
}

describe("POST /vault/resources/:id/download", () => {
  const TITLE_PREFIX = `__vault_dl_test__${randomUUID().slice(0, 8)}`;
  let app: ReturnType<typeof buildTestAppWithRouters>;
  let cookie: string;
  let userId: number;
  const createdResourceIds: number[] = [];

  beforeAll(async () => {
    app = buildTestAppWithRouters([vaultRouter]);
    const user = await insertUser("downloader");
    userId = user.id;
    cookie = signCookie(user.id, user.email);
  });

  afterAll(async () => {
    if (createdResourceIds.length > 0) {
      await db.delete(vaultResourcesTable).where(inArray(vaultResourcesTable.id, createdResourceIds));
    }
    await db.delete(usersTable).where(eq(usersTable.id, userId));
  });

  it("returns 200 with a downloadUrl for a file resource", async () => {
    const [resource] = await db
      .insert(vaultResourcesTable)
      .values({
        title: `${TITLE_PREFIX}-file`,
        resourceType: "file",
        fileUrl: "/vault/test-download.pdf",
        fileType: "application/pdf",
        requiredEntitlement: null,
      })
      .returning({ id: vaultResourcesTable.id });
    createdResourceIds.push(resource.id);

    const res = await request(app)
      .post(`/api/vault/resources/${resource.id}/download`)
      .set("Cookie", cookie)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.downloadUrl).toBe("/vault/test-download.pdf");
    expect(res.body.fileType).toBe("application/pdf");

    // The endpoint also bumps download_count — a sanity check that the right
    // row was matched (it reads resource_type, not the dropped `type` column).
    const [row] = await db
      .select({ downloadCount: vaultResourcesTable.downloadCount })
      .from(vaultResourcesTable)
      .where(eq(vaultResourcesTable.id, resource.id));
    expect(row?.downloadCount).toBe(1);
  });

  it("returns 400 for a non-file resource", async () => {
    const [resource] = await db
      .insert(vaultResourcesTable)
      .values({
        title: `${TITLE_PREFIX}-article`,
        resourceType: "article",
        contentHtml: "<h1>Not downloadable</h1>",
        requiredEntitlement: null,
      })
      .returning({ id: vaultResourcesTable.id });
    createdResourceIds.push(resource.id);

    const res = await request(app)
      .post(`/api/vault/resources/${resource.id}/download`)
      .set("Cookie", cookie)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not downloadable/i);
  });
});

describe("seedVaultData related-resource links + article content", () => {
  // The seed hardcodes this set of collection slugs.
  const SEED_SLUGS = [
    "templates",
    "ad-templates",
    "landing-page-templates",
    "swipe-files",
    "headline-swipes",
    "email-swipes",
    "case-studies",
    "sops",
    "campaign-sops",
    "cheat-sheets",
    "video-tutorials",
    "tools-calculators",
    "image-packs",
    "guides",
    "external-links",
  ];

  let marcusId: number;

  async function cleanupSeed() {
    const cols = await db
      .select({ id: vaultCollectionsTable.id })
      .from(vaultCollectionsTable)
      .where(inArray(vaultCollectionsTable.slug, SEED_SLUGS));
    const colIds = cols.map((c) => c.id);
    if (colIds.length > 0) {
      const resrcs = await db
        .select({ id: vaultResourcesTable.id })
        .from(vaultResourcesTable)
        .where(inArray(vaultResourcesTable.collectionId, colIds));
      const rids = resrcs.map((r) => r.id);
      if (rids.length > 0) {
        await db.delete(vaultFavoritesTable).where(inArray(vaultFavoritesTable.resourceId, rids));
        await db
          .delete(vaultResourceRelationsTable)
          .where(
            or(
              inArray(vaultResourceRelationsTable.resourceId, rids),
              inArray(vaultResourceRelationsTable.relatedResourceId, rids),
            ),
          );
        await db.delete(vaultResourcesTable).where(inArray(vaultResourcesTable.id, rids));
      }
      await db.delete(vaultCollectionsTable).where(inArray(vaultCollectionsTable.id, colIds));
    }
  }

  beforeAll(async () => {
    // The seed's collection slugs are globally unique, so clear any stray
    // seeded rows before we run it to keep this test idempotent.
    await cleanupSeed();
    const marcus = await insertUser("marcus");
    marcusId = marcus.id;
    // Seed once here so each test below is independent of run order. If
    // relations were keyed by an undefined slug, this would throw
    // (related_resource_id is NOT NULL) and the whole block would fail.
    await seedVaultData(marcusId);
  });

  afterAll(async () => {
    await cleanupSeed();
    await db.delete(usersTable).where(eq(usersTable.id, marcusId));
  });

  it("seeds relations that resolve to real resource ids (no dangling/null links)", async () => {
    const cols = await db
      .select({ id: vaultCollectionsTable.id })
      .from(vaultCollectionsTable)
      .where(inArray(vaultCollectionsTable.slug, SEED_SLUGS));
    const colIds = cols.map((c) => c.id);
    expect(colIds.length).toBe(SEED_SLUGS.length);

    const resources = await db
      .select({ id: vaultResourcesTable.id })
      .from(vaultResourcesTable)
      .where(inArray(vaultResourcesTable.collectionId, colIds));
    const resourceIds = new Set(resources.map((r) => r.id));

    const relations = await db
      .select()
      .from(vaultResourceRelationsTable)
      .where(inArray(vaultResourceRelationsTable.resourceId, [...resourceIds]));

    expect(relations.length).toBe(6);
    for (const rel of relations) {
      expect(rel.resourceId).not.toBeNull();
      expect(rel.relatedResourceId).not.toBeNull();
      expect(resourceIds.has(rel.resourceId)).toBe(true);
      expect(resourceIds.has(rel.relatedResourceId)).toBe(true);
    }
  });

  it("lands article resource content in content_html", async () => {
    const cols = await db
      .select({ id: vaultCollectionsTable.id })
      .from(vaultCollectionsTable)
      .where(inArray(vaultCollectionsTable.slug, SEED_SLUGS));
    const colIds = cols.map((c) => c.id);

    const articles = await db
      .select({
        id: vaultResourcesTable.id,
        contentHtml: vaultResourcesTable.contentHtml,
      })
      .from(vaultResourcesTable)
      .where(
        inArray(vaultResourcesTable.collectionId, colIds),
      );

    const articleRows = articles.filter((r) => r.contentHtml !== null);
    expect(articleRows.length).toBeGreaterThan(0);
    for (const a of articleRows) {
      expect(a.contentHtml && a.contentHtml.length).toBeTruthy();
    }
  });
});
