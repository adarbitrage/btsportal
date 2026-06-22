import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import { db, usersTable, knowledgebaseDocsTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

// Runtime regression guard for the Knowledge Base browse landing's per-category
// article-count cards. The cards are sourced from `GET /api/kb/counts`, which
// must:
//   1. Require authentication (401 without a userId).
//   2. Return a `{ counts: { [category]: number } }` shape.
//   3. Count ONLY rows the browse/search surface actually shows — i.e.
//      `audience = 'member'` AND `source_path IS NOT NULL`. A regression here
//      (wrong filter, counting admin/internal or destination-less docs) would
//      silently over- or under-count and mislead members.

vi.mock("../lib/redis", () => ({
  getRedis: () => null,
  isRedisConnected: async () => false,
  getRedisConnection: vi.fn(),
  createRedisConnection: vi.fn(),
}));

import { buildTestAppWithRouters } from "./test-app";
import kbSearchRouter from "../routes/kb-search";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";

function signCookie(userId: number, email: string): string {
  const token = jwt.sign({ userId, email }, JWT_SECRET, { expiresIn: "1h" });
  return `access_token=${token}`;
}

describe("GET /kb/counts", () => {
  const PREFIX = `__kbcounts_test__${randomUUID().slice(0, 8)}`;
  // Two distinct, test-only categories so our assertions are not affected by
  // any pre-seeded KB rows in the shared test database.
  const CAT_VISIBLE = `${PREFIX}-cat-a`;
  const CAT_MIXED = `${PREFIX}-cat-b`;
  // A category whose only rows are excluded (admin / null source_path) must not
  // appear in the counts map at all.
  const CAT_HIDDEN = `${PREFIX}-cat-c`;

  let app: ReturnType<typeof buildTestAppWithRouters>;
  let userId: number;
  let cookie: string;
  const createdDocIds: number[] = [];

  beforeAll(async () => {
    app = buildTestAppWithRouters([kbSearchRouter]);

    const email = `kb-counts-${randomUUID().slice(0, 8)}@example.test`;
    const passwordHash = await bcrypt.hash("irrelevant-test-password", 4);
    const [user] = await db
      .insert(usersTable)
      .values({
        email,
        name: "KB Counts Tester",
        passwordHash,
        role: "member",
        emailVerified: true,
        onboardingComplete: true,
      })
      .returning({ id: usersTable.id });
    userId = user.id;
    cookie = signCookie(userId, email);

    const docs = [
      // CAT_VISIBLE: two member docs WITH a source_path -> both count.
      { title: `${PREFIX} A1`, category: CAT_VISIBLE, audience: "member", sourcePath: "/blitz/guide/1" },
      { title: `${PREFIX} A2`, category: CAT_VISIBLE, audience: "member", sourcePath: "/blitz/guide/2" },
      // CAT_VISIBLE: a member doc with NULL source_path -> excluded.
      { title: `${PREFIX} A3-null-path`, category: CAT_VISIBLE, audience: "member", sourcePath: null },
      // CAT_VISIBLE: an admin doc with a source_path -> excluded.
      { title: `${PREFIX} A4-admin`, category: CAT_VISIBLE, audience: "admin", sourcePath: "/blitz/guide/3" },

      // CAT_MIXED: one visible member doc -> counts 1; plus excluded rows.
      { title: `${PREFIX} B1`, category: CAT_MIXED, audience: "member", sourcePath: "/resources/x" },
      { title: `${PREFIX} B2-admin`, category: CAT_MIXED, audience: "admin", sourcePath: "/resources/y" },

      // CAT_HIDDEN: only excluded rows -> must be absent from counts.
      { title: `${PREFIX} C1-null-path`, category: CAT_HIDDEN, audience: "member", sourcePath: null },
      { title: `${PREFIX} C2-admin`, category: CAT_HIDDEN, audience: "admin", sourcePath: "/sop/z" },
    ];

    for (const d of docs) {
      const [row] = await db
        .insert(knowledgebaseDocsTable)
        .values({
          title: d.title,
          category: d.category,
          content: `Test content for ${d.title}`,
          audience: d.audience,
          sourcePath: d.sourcePath,
        })
        .returning({ id: knowledgebaseDocsTable.id });
      createdDocIds.push(row.id);
    }
  });

  afterAll(async () => {
    if (createdDocIds.length > 0) {
      await db
        .delete(knowledgebaseDocsTable)
        .where(inArray(knowledgebaseDocsTable.id, createdDocIds));
    }
    if (userId) {
      await db.delete(usersTable).where(eq(usersTable.id, userId));
    }
  });

  it("requires authentication (401 without a userId)", async () => {
    const res = await request(app).get("/api/kb/counts");
    expect(res.status).toBe(401);
  });

  it("returns a { counts: { [category]: number } } shape", async () => {
    const res = await request(app).get("/api/kb/counts").set("Cookie", cookie);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("counts");
    expect(res.body.counts).toBeTypeOf("object");
    expect(res.body.counts).not.toBeNull();
    expect(Array.isArray(res.body.counts)).toBe(false);

    for (const [category, count] of Object.entries(res.body.counts)) {
      expect(typeof category).toBe("string");
      expect(typeof count).toBe("number");
      expect(Number.isInteger(count)).toBe(true);
    }
  });

  it("counts only member docs with a non-null source_path", async () => {
    const res = await request(app).get("/api/kb/counts").set("Cookie", cookie);

    expect(res.status).toBe(200);
    const counts = res.body.counts as Record<string, number>;

    // CAT_VISIBLE: exactly the two visible member docs (null-path + admin excluded).
    expect(counts[CAT_VISIBLE]).toBe(2);
    // CAT_MIXED: only the single visible member doc.
    expect(counts[CAT_MIXED]).toBe(1);
    // CAT_HIDDEN: every row excluded, so the category must not appear at all.
    expect(counts).not.toHaveProperty(CAT_HIDDEN);
  });
});
