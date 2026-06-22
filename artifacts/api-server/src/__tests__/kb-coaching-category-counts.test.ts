import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import { db, usersTable, knowledgebaseDocsTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

// Regression guard: after `seedMemberBroadContent` runs, the "coaching" and
// "faq" categories must both produce non-zero counts in GET /api/kb/counts,
// and the browse endpoint must return coaching articles with
// source_path = '/coaching'.
//
// This test inserts synthetic rows matching the shape the seeder produces, so
// the assertions are independent of the shared test-DB state while still
// exercising the exact query paths the browse/count routes use.

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

describe("KB coaching and faq category seeding contract", () => {
  const PREFIX = `__kb_coaching_seed__${randomUUID().slice(0, 8)}`;

  let app: ReturnType<typeof buildTestAppWithRouters>;
  let userId: number;
  let cookie: string;
  const createdDocIds: number[] = [];

  beforeAll(async () => {
    app = buildTestAppWithRouters([kbSearchRouter]);

    const email = `kb-coaching-${randomUUID().slice(0, 8)}@example.test`;
    const passwordHash = await bcrypt.hash("irrelevant-test-password", 4);
    const [user] = await db
      .insert(usersTable)
      .values({
        email,
        name: "KB Coaching Tester",
        passwordHash,
        role: "member",
        emailVerified: true,
        onboardingComplete: true,
      })
      .returning({ id: usersTable.id });
    userId = user.id;
    cookie = signCookie(userId, email);

    // Insert rows that match the shape seedMemberBroadContent produces for
    // coaching and faq categories (audience='member', source_path set).
    const docs = [
      {
        title: `${PREFIX} Coaching Q1`,
        category: "coaching",
        audience: "member",
        sourcePath: "/coaching",
        sourceLabel: "Coaching",
        content: "How do I book a coaching call? You can book via the portal.",
      },
      {
        title: `${PREFIX} Coaching Q2`,
        category: "coaching",
        audience: "member",
        sourcePath: "/coaching",
        sourceLabel: "Coaching",
        content: "What happens on my kick-off call? We go over your goals.",
      },
      {
        title: `${PREFIX} FAQ Q1`,
        category: "faq",
        audience: "member",
        sourcePath: "/support",
        sourceLabel: "Support",
        content: "How do I reset my password? Use the forgot password link.",
      },
    ];

    for (const d of docs) {
      const [row] = await db
        .insert(knowledgebaseDocsTable)
        .values({
          title: d.title,
          category: d.category,
          content: d.content,
          audience: d.audience,
          sourcePath: d.sourcePath,
          sourceLabel: d.sourceLabel,
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

  it("counts endpoint includes coaching with count > 0", async () => {
    const res = await request(app).get("/api/kb/counts").set("Cookie", cookie);
    expect(res.status).toBe(200);
    const counts = res.body.counts as Record<string, number>;
    expect(typeof counts["coaching"]).toBe("number");
    expect(counts["coaching"]).toBeGreaterThan(0);
  });

  it("counts endpoint includes faq with count > 0", async () => {
    const res = await request(app).get("/api/kb/counts").set("Cookie", cookie);
    expect(res.status).toBe(200);
    const counts = res.body.counts as Record<string, number>;
    expect(typeof counts["faq"]).toBe("number");
    expect(counts["faq"]).toBeGreaterThan(0);
  });

  it("browse?category=coaching returns rows with source_path='/coaching'", async () => {
    const res = await request(app)
      .get("/api/kb/browse?category=coaching")
      .set("Cookie", cookie);
    expect(res.status).toBe(200);
    const results = res.body.results as Array<{ sourcePath: string | null; title: string; category: string }>;
    expect(Array.isArray(results)).toBe(true);

    // Every returned row must be in the coaching category.
    for (const row of results) {
      expect(row.category).toBe("coaching");
    }

    // Our seeded coaching rows must be present and carry sourcePath '/coaching'.
    const seededRows = results.filter((r) => r.title.startsWith(PREFIX));
    expect(seededRows.length).toBeGreaterThanOrEqual(1);
    for (const row of seededRows) {
      expect(row.sourcePath).toBe("/coaching");
    }
  });
});
