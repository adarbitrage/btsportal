import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import { db, usersTable, knowledgebaseDocsTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import {
  BLITZ_PHASE_ORDER,
  BLITZ_PHASE_MAP,
} from "@workspace/blitz-curriculum";

// Regression guard: the member-facing "Training" KB category (category key
// `curriculum`) must be populated, single-sourced from @workspace/blitz-curriculum,
// so GET /api/kb/counts reports it and GET /api/kb/browse surfaces it. Before
// this work the category was empty and the AI assistant / KB browse could not
// answer curriculum questions.
//
// We exercise the real builder via seedMemberBroadContent so the test fails if
// the curriculum docs stop being produced or stop carrying a member-visible
// source_path. We tag the seeded rows by their stable, curriculum-derived
// titles and clean those up afterwards.

vi.mock("../lib/redis", () => ({
  getRedis: () => null,
  isRedisConnected: async () => false,
  getRedisConnection: vi.fn(),
  createRedisConnection: vi.fn(),
}));

import { buildTestAppWithRouters } from "./test-app";
import kbSearchRouter from "../routes/kb-search";
import { seedMemberBroadContent } from "../lib/seed-kb-member-content";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";

function signCookie(userId: number, email: string): string {
  const token = jwt.sign({ userId, email }, JWT_SECRET, { expiresIn: "1h" });
  return `access_token=${token}`;
}

// Titles the curriculum builder produces (single-sourced from the skeleton).
const CURRICULUM_TITLES = [
  "BTS Training Curriculum Overview",
  ...BLITZ_PHASE_ORDER.map((k) => `Training Curriculum: ${BLITZ_PHASE_MAP[k].label}`),
];

describe("KB curriculum (Training) category seeding contract", () => {
  let app: ReturnType<typeof buildTestAppWithRouters>;
  let userId: number;
  let cookie: string;

  beforeAll(async () => {
    app = buildTestAppWithRouters([kbSearchRouter]);

    const email = `kb-curriculum-${randomUUID().slice(0, 8)}@example.test`;
    const passwordHash = await bcrypt.hash("irrelevant-test-password", 4);
    const [user] = await db
      .insert(usersTable)
      .values({
        email,
        name: "KB Curriculum Tester",
        passwordHash,
        role: "member",
        emailVerified: true,
        onboardingComplete: true,
      })
      .returning({ id: usersTable.id });
    userId = user.id;
    cookie = signCookie(userId, email);

    // Run the real seeder; it upserts the curriculum docs (idempotent).
    await seedMemberBroadContent();
  });

  afterAll(async () => {
    if (userId) {
      await db.delete(usersTable).where(eq(usersTable.id, userId));
    }
  });

  it("counts endpoint includes curriculum with count > 0", async () => {
    const res = await request(app).get("/api/kb/counts").set("Cookie", cookie);
    expect(res.status).toBe(200);
    const counts = res.body.counts as Record<string, number>;
    expect(typeof counts["curriculum"]).toBe("number");
    expect(counts["curriculum"]).toBeGreaterThan(0);
  });

  it("seeds an overview doc plus one doc per phase, all in the curriculum category", async () => {
    const rows = await db
      .select({
        title: knowledgebaseDocsTable.title,
        category: knowledgebaseDocsTable.category,
        audience: knowledgebaseDocsTable.audience,
        sourcePath: knowledgebaseDocsTable.sourcePath,
      })
      .from(knowledgebaseDocsTable)
      .where(inArray(knowledgebaseDocsTable.title, CURRICULUM_TITLES));

    // Every expected curriculum-derived title must be present.
    const seededTitles = new Set(rows.map((r) => r.title));
    for (const title of CURRICULUM_TITLES) {
      expect(seededTitles.has(title)).toBe(true);
    }

    // All must be member-visible curriculum docs with a destination path.
    for (const row of rows) {
      expect(row.category).toBe("curriculum");
      expect(row.audience).toBe("member");
      expect(row.sourcePath).toBeTruthy();
    }
  });

  it("browse?category=curriculum returns only curriculum rows", async () => {
    const res = await request(app)
      .get("/api/kb/browse?category=curriculum")
      .set("Cookie", cookie);
    expect(res.status).toBe(200);
    const results = res.body.results as Array<{ category: string; title: string }>;
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBeGreaterThan(0);
    for (const row of results) {
      expect(row.category).toBe("curriculum");
    }
  });
});
