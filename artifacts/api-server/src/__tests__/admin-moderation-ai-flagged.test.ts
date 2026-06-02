import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import {
  db,
  usersTable,
  communityCategoriesTable,
  communityPostsTable,
  moderationQueueTable,
  userStrikesTable,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

import express, { type Express } from "express";
import cookieParser from "cookie-parser";
import { authenticate } from "../middleware/auth";
import { requestIdMiddleware, apiErrorHandler } from "../lib/api-errors";
import adminModerationQueueRouter from "../routes/admin/moderation";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const TEST_TAG = `mod-ai-${randomUUID().slice(0, 8)}`;

let app: Express;

const seededUserIds: number[] = [];
const seededPostIds: number[] = [];
const seededQueueIds: number[] = [];
let categoryId: number;

interface Fixture {
  id: number;
  email: string;
  cookie: string;
}

let admin: Fixture;
let member: Fixture;
let author: Fixture;

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

async function insertPost(authorId: number, body = "flagged body"): Promise<number> {
  const [row] = await db
    .insert(communityPostsTable)
    .values({
      authorId,
      categoryId,
      content: body,
      status: "shadow_hidden",
    })
    .returning({ id: communityPostsTable.id });
  seededPostIds.push(row.id);
  return row.id;
}

type Scores = { toxicity?: number; spam?: number; harassment?: number; hate_speech?: number };

async function insertQueueRow(opts: {
  authorId: number;
  triggeredBy: string;
  aiScores?: Scores;
  flagThreshold?: number | null;
  status?: string;
  createdAt?: Date;
  body?: string;
}): Promise<number> {
  const targetId = await insertPost(opts.authorId, opts.body ?? "queued body");
  const scores: Required<Scores> = {
    toxicity: opts.aiScores?.toxicity ?? 0,
    spam: opts.aiScores?.spam ?? 0,
    harassment: opts.aiScores?.harassment ?? 0,
    hate_speech: opts.aiScores?.hate_speech ?? 0,
  };
  const [row] = await db
    .insert(moderationQueueTable)
    .values({
      targetType: "post",
      targetId,
      authorId: opts.authorId,
      body: opts.body ?? "queued body",
      status: opts.status ?? "pending",
      triggeredBy: opts.triggeredBy,
      wordlistMatches: [] as unknown as object,
      aiScores: scores as unknown as object,
      flagThreshold: opts.flagThreshold ?? null,
      ...(opts.createdAt ? { createdAt: opts.createdAt } : {}),
    })
    .returning({ id: moderationQueueTable.id });
  seededQueueIds.push(row.id);
  return row.id;
}

function aiFlagged(query: Record<string, string | number> = {}) {
  return request(app)
    .get("/api/admin/moderation/queue/ai-flagged")
    .query(query)
    .set("Cookie", admin.cookie);
}

beforeAll(async () => {
  app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use("/api", requestIdMiddleware);
  app.use("/api", authenticate);
  app.use("/api/admin/moderation/queue", adminModerationQueueRouter);
  app.use("/api", apiErrorHandler);

  const [cat] = await db
    .insert(communityCategoriesTable)
    .values({
      name: `${TEST_TAG} Category`,
      slug: `${TEST_TAG}-cat`,
      description: "test",
      sortOrder: 1,
      isActive: true,
    })
    .returning({ id: communityCategoriesTable.id });
  categoryId = cat.id;

  admin = await makeUser({ suffix: "admin", role: "super_admin" });
  member = await makeUser({ suffix: "member" });
  author = await makeUser({ suffix: "author" });
});

afterAll(async () => {
  if (seededUserIds.length > 0) {
    await db.delete(userStrikesTable).where(inArray(userStrikesTable.userId, seededUserIds));
    await db.delete(moderationQueueTable).where(inArray(moderationQueueTable.authorId, seededUserIds));
    await db.delete(communityPostsTable).where(inArray(communityPostsTable.authorId, seededUserIds));
    await db.delete(usersTable).where(inArray(usersTable.id, seededUserIds));
  }
  if (categoryId) {
    await db.delete(communityCategoriesTable).where(eq(communityCategoriesTable.id, categoryId));
  }
});

describe("GET /admin/moderation/queue/ai-flagged", () => {
  it("excludes wordlist-only flags and returns only ai_classifier/combined rows with maxScore and flagThreshold", async () => {
    const aiId = await insertQueueRow({
      authorId: author.id,
      triggeredBy: "ai_classifier",
      aiScores: { toxicity: 0.8, spam: 0.1, harassment: 0.2, hate_speech: 0.05 },
      flagThreshold: 0.7,
    });
    const combinedId = await insertQueueRow({
      authorId: author.id,
      triggeredBy: "combined",
      aiScores: { toxicity: 0.4, spam: 0.6, harassment: 0.3, hate_speech: 0.1 },
      flagThreshold: 0.5,
    });
    const hardId = await insertQueueRow({ authorId: author.id, triggeredBy: "wordlist_hard" });
    const softId = await insertQueueRow({ authorId: author.id, triggeredBy: "wordlist_soft" });

    const res = await aiFlagged();
    expect(res.status).toBe(200);

    const ids = res.body.items.map((r: { id: number }) => r.id);
    expect(ids).toContain(aiId);
    expect(ids).toContain(combinedId);
    expect(ids).not.toContain(hardId);
    expect(ids).not.toContain(softId);

    const aiRow = res.body.items.find((r: { id: number }) => r.id === aiId);
    expect(aiRow.triggeredBy).toBe("ai_classifier");
    // maxScore is GREATEST of the per-class scores (0.8 here).
    expect(aiRow.maxScore).toBeCloseTo(0.8, 5);
    expect(aiRow.flagThreshold).toBeCloseTo(0.7, 5);

    const combinedRow = res.body.items.find((r: { id: number }) => r.id === combinedId);
    expect(combinedRow.maxScore).toBeCloseTo(0.6, 5);
    expect(combinedRow.flagThreshold).toBeCloseTo(0.5, 5);
  });

  it("narrows results by from/to date bounds (inclusive on createdAt)", async () => {
    const oldId = await insertQueueRow({
      authorId: author.id,
      triggeredBy: "ai_classifier",
      aiScores: { toxicity: 0.9 },
      flagThreshold: 0.6,
      createdAt: new Date("2020-01-01T00:00:00Z"),
    });
    const recentId = await insertQueueRow({
      authorId: author.id,
      triggeredBy: "ai_classifier",
      aiScores: { toxicity: 0.9 },
      flagThreshold: 0.6,
      createdAt: new Date("2020-06-01T00:00:00Z"),
    });

    const res = await aiFlagged({ from: "2020-03-01T00:00:00Z", to: "2020-09-01T00:00:00Z" });
    expect(res.status).toBe(200);
    const ids = res.body.items.map((r: { id: number }) => r.id);
    expect(ids).toContain(recentId);
    expect(ids).not.toContain(oldId);
  });

  it("narrows results by minScore/maxScore band on the highest per-class score", async () => {
    const lowId = await insertQueueRow({
      authorId: author.id,
      triggeredBy: "ai_classifier",
      aiScores: { toxicity: 0.2, spam: 0.1 },
      flagThreshold: 0.5,
    });
    const midId = await insertQueueRow({
      authorId: author.id,
      triggeredBy: "ai_classifier",
      aiScores: { toxicity: 0.55, spam: 0.1 },
      flagThreshold: 0.5,
    });
    const highId = await insertQueueRow({
      authorId: author.id,
      triggeredBy: "ai_classifier",
      aiScores: { toxicity: 0.95, spam: 0.1 },
      flagThreshold: 0.5,
    });

    const res = await aiFlagged({ minScore: 0.5, maxScore: 0.7 });
    expect(res.status).toBe(200);
    const ids = res.body.items.map((r: { id: number }) => r.id);
    expect(ids).toContain(midId);
    expect(ids).not.toContain(lowId);
    expect(ids).not.toContain(highId);
  });

  it("filters by status", async () => {
    const pendingId = await insertQueueRow({
      authorId: author.id,
      triggeredBy: "ai_classifier",
      aiScores: { toxicity: 0.8 },
      flagThreshold: 0.5,
      status: "pending",
    });
    const approvedId = await insertQueueRow({
      authorId: author.id,
      triggeredBy: "ai_classifier",
      aiScores: { toxicity: 0.8 },
      flagThreshold: 0.5,
      status: "approved",
    });

    const res = await aiFlagged({ status: "approved" });
    expect(res.status).toBe(200);
    const ids = res.body.items.map((r: { id: number }) => r.id);
    expect(ids).toContain(approvedId);
    expect(ids).not.toContain(pendingId);
    for (const item of res.body.items) {
      expect(item.status).toBe("approved");
    }
  });

  it("paginates via cursor in descending id order", async () => {
    const created: number[] = [];
    for (let i = 0; i < 3; i++) {
      created.push(
        await insertQueueRow({
          authorId: author.id,
          triggeredBy: "ai_classifier",
          aiScores: { toxicity: 0.8 },
          flagThreshold: 0.5,
          body: `paginate-${TEST_TAG}-${i}`,
        }),
      );
    }
    // Newest first: created[2], created[1], created[0].
    const sortedDesc = [...created].sort((a, b) => b - a);

    const firstPage = await aiFlagged({ limit: 2 });
    expect(firstPage.status).toBe(200);
    // Restrict to just the rows this test created so unrelated seeded rows
    // don't perturb the assertions.
    const firstOurs = firstPage.body.items
      .map((r: { id: number }) => r.id)
      .filter((id: number) => created.includes(id));
    expect(firstOurs[0]).toBe(sortedDesc[0]);
    expect(firstPage.body.hasMore).toBe(true);
    expect(firstPage.body.nextCursor).toBeTruthy();

    const secondPage = await aiFlagged({ limit: 2, cursor: firstPage.body.nextCursor });
    expect(secondPage.status).toBe(200);
    const secondOurs = secondPage.body.items
      .map((r: { id: number }) => r.id)
      .filter((id: number) => created.includes(id));
    // The oldest of our three rows must show up only after paging past the cursor.
    expect(secondOurs).toContain(sortedDesc[2]);
    // Cursor strictly advances: every id in page two is below the cursor.
    const cursorId = Number(firstPage.body.nextCursor);
    for (const id of secondPage.body.items.map((r: { id: number }) => r.id)) {
      expect(id).toBeLessThan(cursorId);
    }
  });

  it("is 403 for a plain member", async () => {
    const res = await request(app)
      .get("/api/admin/moderation/queue/ai-flagged")
      .set("Cookie", member.cookie);
    expect(res.status).toBe(403);
  });
});
