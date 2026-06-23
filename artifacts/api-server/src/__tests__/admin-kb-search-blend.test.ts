import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import { db, usersTable, knowledgebaseDocsTable } from "@workspace/db";
import { inArray } from "drizzle-orm";

import { buildTestAppWithRouters } from "./test-app";
import adminChatRouter from "../routes/admin-chat";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const TAG = `kbblend-${randomUUID().slice(0, 8)}`;

const seededUserIds: number[] = [];
const seededTitles: string[] = [];

let app: ReturnType<typeof buildTestAppWithRouters>;
let adminCookie: string;

async function seedDoc(title: string, content: string) {
  seededTitles.push(title);
  await db.insert(knowledgebaseDocsTable).values({
    title,
    content,
    category: "strategy",
    audience: "admin",
  });
}

function searchKb(term: string) {
  return request(app)
    .get(`/api/admin/chat/knowledgebase?search=${encodeURIComponent(term)}`)
    .set("Cookie", adminCookie);
}

beforeAll(async () => {
  app = buildTestAppWithRouters([adminChatRouter]);

  const email = `${TAG}-admin@example.test`;
  const passwordHash = await bcrypt.hash("irrelevant", 4);
  const [row] = await db
    .insert(usersTable)
    .values({
      email,
      name: "KB Blend Admin",
      passwordHash,
      role: "admin",
      sourceProduct: "lifetime",
      emailVerified: true,
      onboardingComplete: true,
    })
    .returning({ id: usersTable.id });
  seededUserIds.push(row.id);
  const token = jwt.sign({ userId: row.id, email }, JWT_SECRET, { expiresIn: "1h" });
  adminCookie = `access_token=${token}`;

  await seedDoc(
    `${TAG} Affiliate Marketing Fundamentals`,
    "A complete primer on affiliate marketing strategy, campaign structure, and conversion tracking.",
  );
});

afterAll(async () => {
  if (seededTitles.length > 0) {
    await db.delete(knowledgebaseDocsTable).where(inArray(knowledgebaseDocsTable.title, seededTitles));
  }
  if (seededUserIds.length > 0) {
    await db.delete(usersTable).where(inArray(usersTable.id, seededUserIds));
  }
});

describe("GET /admin/chat/knowledgebase — blended exact + fuzzy search", () => {
  it("returns the doc on an exact full-text term", async () => {
    const res = await searchKb("affiliate");
    expect(res.status).toBe(200);
    const titles = (res.body as any[]).map((d) => d.title);
    expect(titles).toContain(`${TAG} Affiliate Marketing Fundamentals`);
  });

  it("still returns the doc on a misspelled query (fuzzy fallback)", async () => {
    // "afiliate" / "marketting" would both miss a strict plainto_tsquery
    const res = await searchKb("afiliate marketting");
    expect(res.status).toBe(200);
    const titles = (res.body as any[]).map((d) => d.title);
    expect(titles).toContain(`${TAG} Affiliate Marketing Fundamentals`);
  });

  it("returns the doc when only one of several words matches (OR semantics)", async () => {
    // strict plainto_tsquery would AND every word and drop this on the unrelated terms
    const res = await searchKb("affiliate widgets sprockets");
    expect(res.status).toBe(200);
    const titles = (res.body as any[]).map((d) => d.title);
    expect(titles).toContain(`${TAG} Affiliate Marketing Fundamentals`);
  });
});
