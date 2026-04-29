import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import {
  db,
  usersTable,
  kbStagingDocsTable,
  knowledgebaseDocsTable,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

import { buildTestAppWithRouters } from "./test-app";
import knowledgebaseStagingRouter from "../routes/admin/knowledgebase-staging";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const TEST_TAG = `kb-push-${randomUUID().slice(0, 8)}`;

const seededUserIds: number[] = [];
const seededStagingIds: number[] = [];
const seededTitles: string[] = [];

let app: ReturnType<typeof buildTestAppWithRouters>;
let adminCookie: string;

async function seedAdmin(): Promise<void> {
  const email = `${TEST_TAG}-admin@example.test`;
  const passwordHash = await bcrypt.hash("irrelevant", 4);
  const [row] = await db
    .insert(usersTable)
    .values({
      email,
      name: "Push Admin",
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
}

async function seedStaging(opts: {
  title: string;
  category: string;
  status: "approved" | "pending_review" | "pushed";
  source?: string;
  content?: string;
  editedContent?: string;
}): Promise<number> {
  const [row] = await db
    .insert(kbStagingDocsTable)
    .values({
      title: opts.title,
      category: opts.category,
      content: opts.content ?? "raw extracted content",
      editedContent: opts.editedContent,
      status: opts.status,
      source: opts.source ?? "blitz",
    })
    .returning({ id: kbStagingDocsTable.id });
  seededStagingIds.push(row.id);
  seededTitles.push(opts.title);
  return row.id;
}

beforeAll(async () => {
  app = buildTestAppWithRouters([knowledgebaseStagingRouter]);
  await seedAdmin();
});

afterAll(async () => {
  if (seededStagingIds.length > 0) {
    await db.delete(kbStagingDocsTable).where(inArray(kbStagingDocsTable.id, seededStagingIds));
  }
  if (seededTitles.length > 0) {
    await db.delete(knowledgebaseDocsTable).where(inArray(knowledgebaseDocsTable.title, seededTitles));
  }
  if (seededUserIds.length > 0) {
    await db.delete(usersTable).where(inArray(usersTable.id, seededUserIds));
  }
});

describe("POST /admin/knowledgebase/staging/push-approved", () => {
  it("inserts approved staging rows into knowledgebase_docs and marks staging status as pushed", async () => {
    const titleA = `${TEST_TAG}-doc-a`;
    const titleB = `${TEST_TAG}-doc-b`;
    const stagingIdA = await seedStaging({
      title: titleA,
      category: "curriculum",
      status: "approved",
      content: "How to set up a campaign in DIYTrax — full walkthrough.",
    });
    const stagingIdB = await seedStaging({
      title: titleB,
      category: "sop",
      status: "approved",
      content: "Original raw transcript",
      editedContent: "Edited and cleaned SOP content",
    });

    const res = await request(app)
      .post("/api/push-approved")
      .set("Cookie", adminCookie);

    expect(res.status).toBe(200);
    expect(res.body.pushed).toBe(2);
    expect(res.body.totalInLiveKb).toBeGreaterThanOrEqual(2);

    const [stagedA] = await db
      .select()
      .from(kbStagingDocsTable)
      .where(eq(kbStagingDocsTable.id, stagingIdA));
    const [stagedB] = await db
      .select()
      .from(kbStagingDocsTable)
      .where(eq(kbStagingDocsTable.id, stagingIdB));
    expect(stagedA.status).toBe("pushed");
    expect(stagedB.status).toBe("pushed");

    const [liveA] = await db
      .select()
      .from(knowledgebaseDocsTable)
      .where(eq(knowledgebaseDocsTable.title, titleA));
    const [liveB] = await db
      .select()
      .from(knowledgebaseDocsTable)
      .where(eq(knowledgebaseDocsTable.title, titleB));
    expect(liveA).toBeDefined();
    expect(liveA.category).toBe("curriculum");
    expect(liveA.content).toContain("DIYTrax");
    expect(liveB).toBeDefined();
    expect(liveB.category).toBe("sop");
    // edited_content takes precedence over content
    expect(liveB.content).toBe("Edited and cleaned SOP content");
  });

  it("upserts on title — re-pushing an approved doc with the same title updates the live row", async () => {
    const title = `${TEST_TAG}-upsert`;
    // First pass — insert
    const firstStagingId = await seedStaging({
      title,
      category: "strategy",
      status: "approved",
      content: "first version",
    });
    let res = await request(app).post("/api/push-approved").set("Cookie", adminCookie);
    expect(res.status).toBe(200);

    const [liveAfterFirst] = await db
      .select()
      .from(knowledgebaseDocsTable)
      .where(eq(knowledgebaseDocsTable.title, title));
    expect(liveAfterFirst.content).toBe("first version");
    const idAfterFirst = liveAfterFirst.id;

    // Second pass — new staging row with the same title, updated content
    const secondStagingId = await seedStaging({
      title,
      category: "platform_guide",
      status: "approved",
      content: "second version with updated guidance",
    });
    res = await request(app).post("/api/push-approved").set("Cookie", adminCookie);
    expect(res.status).toBe(200);
    expect(res.body.pushed).toBe(1);

    const [liveAfterSecond] = await db
      .select()
      .from(knowledgebaseDocsTable)
      .where(eq(knowledgebaseDocsTable.title, title));
    expect(liveAfterSecond.id).toBe(idAfterFirst); // same row, upserted
    expect(liveAfterSecond.content).toBe("second version with updated guidance");
    expect(liveAfterSecond.category).toBe("platform_guide");

    // Both staging rows are now "pushed"
    const stagedRows = await db
      .select()
      .from(kbStagingDocsTable)
      .where(inArray(kbStagingDocsTable.id, [firstStagingId, secondStagingId]));
    expect(stagedRows.every((r) => r.status === "pushed")).toBe(true);
  });
});
