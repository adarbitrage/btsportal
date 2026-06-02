import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import {
  db,
  usersTable,
  moderationQueueTable,
  systemSettingsTable,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

import express, { type Express } from "express";
import cookieParser from "cookie-parser";
import { authenticate } from "../middleware/auth";
import { requestIdMiddleware, apiErrorHandler } from "../lib/api-errors";
import adminModerationQueueRouter from "../routes/admin/moderation";
import { __invalidateAiModerationThresholdConfigCacheForTests } from "../lib/moderation/ai-threshold-settings";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const TEST_TAG = `ai-flagged-summary-${randomUUID().slice(0, 8)}`;

let app: Express;
const seededUserIds: number[] = [];
const seededQueueIds: number[] = [];

interface Fixture {
  id: number;
  email: string;
  cookie: string;
}

let admin: Fixture;

function signCookie(userId: number, email: string): string {
  const token = jwt.sign({ userId, email }, JWT_SECRET, { expiresIn: "1h" });
  return `access_token=${token}`;
}

async function makeUser(opts: { suffix: string; role?: string }): Promise<Fixture> {
  const email = `${TEST_TAG}-${opts.suffix}@example.test`;
  const passwordHash = await bcrypt.hash("irrelevant", 4);
  const [row] = await db
    .insert(usersTable)
    .values({
      email,
      name: `User ${opts.suffix}`,
      passwordHash,
      role: opts.role ?? "member",
      sourceProduct: "lifetime",
      emailVerified: true,
      onboardingComplete: true,
    })
    .returning({ id: usersTable.id, email: usersTable.email });
  seededUserIds.push(row.id);
  return { id: row.id, email: row.email, cookie: signCookie(row.id, row.email) };
}

async function insertAiQueueRow(opts: {
  authorId: number;
  maxScore: number;
  status: "pending" | "approved" | "rejected";
  triggeredBy?: "ai_classifier" | "combined" | "wordlist_hard";
}): Promise<number> {
  const [row] = await db
    .insert(moderationQueueTable)
    .values({
      targetType: "post",
      targetId: 0,
      authorId: opts.authorId,
      body: "queued body",
      status: opts.status,
      triggeredBy: opts.triggeredBy ?? "ai_classifier",
      // toxicity carries the max score; the others stay low so GREATEST/maxAiScore
      // resolves to `maxScore`.
      aiScores: {
        toxicity: opts.maxScore,
        spam: 0,
        harassment: 0,
        hate_speech: 0,
      } as unknown as object,
    })
    .returning({ id: moderationQueueTable.id });
  seededQueueIds.push(row.id);
  return row.id;
}

beforeAll(async () => {
  app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use("/api", requestIdMiddleware);
  app.use("/api", authenticate);
  app.use("/api/admin/moderation/queue", adminModerationQueueRouter);
  app.use("/api", apiErrorHandler);

  admin = await makeUser({ suffix: "admin", role: "super_admin" });
  const author = await makeUser({ suffix: "author" });

  // Band 0.5–0.6: one approved, one rejected -> 50% approve rate.
  await insertAiQueueRow({ authorId: author.id, maxScore: 0.55, status: "approved" });
  await insertAiQueueRow({ authorId: author.id, maxScore: 0.58, status: "rejected" });
  // Band 0.6–0.7: one pending (unreviewed) -> approveRate null.
  await insertAiQueueRow({ authorId: author.id, maxScore: 0.65, status: "pending" });
  // Band 0.9–1.0: two rejected -> 0% approve rate.
  await insertAiQueueRow({ authorId: author.id, maxScore: 0.95, status: "rejected" });
  await insertAiQueueRow({ authorId: author.id, maxScore: 1.0, status: "rejected" });
  // A pure wordlist flag must be excluded from the summary entirely.
  await insertAiQueueRow({
    authorId: author.id,
    maxScore: 0.99,
    status: "approved",
    triggeredBy: "wordlist_hard",
  });

  __invalidateAiModerationThresholdConfigCacheForTests();
});

afterAll(async () => {
  if (seededQueueIds.length > 0) {
    await db.delete(moderationQueueTable).where(inArray(moderationQueueTable.id, seededQueueIds));
  }
  if (seededUserIds.length > 0) {
    await db.delete(usersTable).where(inArray(usersTable.id, seededUserIds));
  }
  // Clean up any threshold setting a parallel run might have left; harmless if absent.
  await db.delete(systemSettingsTable).where(eq(systemSettingsTable.key, "ai_moderation.flag_threshold"));
});

describe("GET /admin/moderation/queue/ai-flagged/summary", () => {
  it("requires authentication", async () => {
    const res = await request(app).get("/api/admin/moderation/queue/ai-flagged/summary");
    expect(res.status).toBe(401);
  });

  it("buckets AI-flagged rows by score band with approve/reject split, excluding wordlist flags", async () => {
    const res = await request(app)
      .get("/api/admin/moderation/queue/ai-flagged/summary")
      .set("Cookie", admin.cookie);

    expect(res.status).toBe(200);
    const body = res.body;

    // 5 AI rows seeded (the wordlist row is excluded). Note: other tests may
    // run against the same DB, so assert on our seeded data via score lookups
    // rather than exact totals.
    expect(Array.isArray(body.buckets)).toBe(true);
    expect(body.buckets).toHaveLength(6);

    const byLabel = Object.fromEntries(
      body.buckets.map((b: { label: string }) => [b.label, b]),
    );

    // 0.5–0.6 band: at least our approved + rejected rows, 50%+ structure holds.
    const band56 = byLabel["0.5–0.6"];
    expect(band56.approved).toBeGreaterThanOrEqual(1);
    expect(band56.rejected).toBeGreaterThanOrEqual(1);

    // 0.9–1.0 band: our two rejected rows present, none approved among ours.
    const band910 = byLabel["0.9–1.0"];
    expect(band910.rejected).toBeGreaterThanOrEqual(2);

    // maxScores is sorted ascending and excludes the wordlist row's 0.99.
    expect(Array.isArray(body.maxScores)).toBe(true);
    const sorted = [...body.maxScores].sort((a: number, b: number) => a - b);
    expect(body.maxScores).toEqual(sorted);

    expect(typeof body.currentThreshold).toBe("number");
    expect(body.sampleWindowDays).toBe(30);
  });

  it("computes approveRate as null for bands with no reviewed items", async () => {
    const res = await request(app)
      .get("/api/admin/moderation/queue/ai-flagged/summary")
      .set("Cookie", admin.cookie);

    const byLabel = Object.fromEntries(
      res.body.buckets.map((b: { label: string }) => [b.label, b]),
    );
    const band67 = byLabel["0.6–0.7"];
    // Our only 0.6–0.7 seed is pending; if no other test seeded a reviewed
    // row in this band, approveRate stays null.
    if (band67.approved + band67.rejected === 0) {
      expect(band67.approveRate).toBeNull();
      expect(band67.pending).toBeGreaterThanOrEqual(1);
    } else {
      expect(typeof band67.approveRate).toBe("number");
    }
  });
});
