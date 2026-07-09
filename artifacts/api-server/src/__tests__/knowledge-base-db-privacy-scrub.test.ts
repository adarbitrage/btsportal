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
  aiLiveDocumentsTable,
  kbDocProvenanceTable,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

import { buildTestAppWithRouters } from "./test-app";
import adminChatRouter from "../routes/admin-chat";
import knowledgebaseStagingRouter from "../routes/admin/knowledgebase-staging";
import { searchTranscripts } from "../routes/openai/knowledge-base";

/**
 * Pin the privacy scrub on the DATABASE knowledge-base paths.
 *
 * The static-file scrub is covered by knowledge-base-privacy-scrub.test.ts, but
 * coach/instructor surnames can also reach members through DB content. The
 * legacy `knowledgebase_docs` table (member-facing KB) is written by the admin
 * KB CRUD, and the assistant's corpus `ai_live_documents` is written by the
 * staging "push to live" flow — every path routes free text through
 * scrubPrivateContent():
 *   1. Admin manual create  — POST /admin/chat/knowledgebase   (legacy table)
 *   2. Admin manual edit     — PUT  /admin/chat/knowledgebase/:id (legacy table)
 *   3. Staging "push to live"— POST /push-approved              (ai_live_documents)
 * searchTranscripts() folds matching ai_live_documents rows into the chat
 * reply. NOTE (Task #1826): the legacy table and ai_live_documents are fully
 * decoupled — an admin legacy-KB write no longer reaches the assistant, so the
 * retrieval probe goes through the push-approved pipeline.
 *
 * These tests plant a forbidden coach FULL name through each write path and
 * assert the stored title/content keeps only the first name, then prove the
 * surname can't re-surface through the searchTranscripts() retrieval path. If a
 * future refactor drops the scrub from any of these ingestion points, a test
 * here fails.
 */

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const TEST_TAG = `kb-db-scrub-${randomUUID().slice(0, 8)}`;

// Bruce Clark -> "Bruce". A unique marker keeps full-text search deterministic
// and proves we're inspecting the row we planted, not a coincidental match.
const FORBIDDEN_FULL_NAME = "Bruce Clark";
const ALLOWED_FIRST_NAME = "Bruce";
const FORBIDDEN_SURNAME = "Clark";

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
      name: "Scrub Admin",
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

beforeAll(async () => {
  app = buildTestAppWithRouters([adminChatRouter, knowledgebaseStagingRouter]);
  await seedAdmin();
});

afterAll(async () => {
  if (seededStagingIds.length > 0) {
    await db.delete(kbStagingDocsTable).where(inArray(kbStagingDocsTable.id, seededStagingIds));
  }
  if (seededTitles.length > 0) {
    await db
      .delete(knowledgebaseDocsTable)
      .where(inArray(knowledgebaseDocsTable.title, seededTitles));
    const liveRows = await db
      .select({ id: aiLiveDocumentsTable.id })
      .from(aiLiveDocumentsTable)
      .where(inArray(aiLiveDocumentsTable.title, seededTitles));
    if (liveRows.length > 0) {
      const ids = liveRows.map((r) => r.id);
      await db.delete(kbDocProvenanceTable).where(inArray(kbDocProvenanceTable.docId, ids));
      await db.delete(aiLiveDocumentsTable).where(inArray(aiLiveDocumentsTable.id, ids));
    }
  }
  if (seededUserIds.length > 0) {
    await db.delete(usersTable).where(inArray(usersTable.id, seededUserIds));
  }
});

describe("knowledgebase_docs DB ingestion — coach surname privacy scrub", () => {
  it("strips a coach surname on admin manual create (POST /admin/chat/knowledgebase)", async () => {
    const title = `${TEST_TAG} create ${FORBIDDEN_FULL_NAME} guide`;
    seededTitles.push(title);

    const res = await request(app)
      .post("/api/admin/chat/knowledgebase")
      .set("Cookie", adminCookie)
      .send({
        title,
        category: "faq",
        content: `Reach out to ${FORBIDDEN_FULL_NAME} for campaign reviews on DIYTrax.`,
      });

    expect(res.status).toBe(201);
    // Track whatever title actually landed (post-scrub) for retrieval + cleanup.
    seededTitles.push(res.body.title);

    expect(res.body.title).toContain(ALLOWED_FIRST_NAME);
    expect(res.body.title).not.toContain(FORBIDDEN_SURNAME);
    expect(res.body.content).toContain(ALLOWED_FIRST_NAME);
    expect(res.body.content).not.toContain(FORBIDDEN_SURNAME);

    // Confirm the persisted row (not just the response) is clean.
    const [stored] = await db
      .select()
      .from(knowledgebaseDocsTable)
      .where(eq(knowledgebaseDocsTable.id, res.body.id));
    expect(stored).toBeDefined();
    expect(stored.title).not.toContain(FORBIDDEN_SURNAME);
    expect(stored.content).not.toContain(FORBIDDEN_SURNAME);
  });

  it("strips a coach surname on admin manual edit (PUT /admin/chat/knowledgebase/:id)", async () => {
    // Seed a clean row directly, then edit it with a surname via the route.
    const title = `${TEST_TAG} edit target`;
    seededTitles.push(title);
    const [seed] = await db
      .insert(knowledgebaseDocsTable)
      .values({ title, category: "faq", content: "Clean starter content." })
      .returning({ id: knowledgebaseDocsTable.id });

    const res = await request(app)
      .put(`/api/admin/chat/knowledgebase/${seed.id}`)
      .set("Cookie", adminCookie)
      .send({
        content: `Updated: ${FORBIDDEN_FULL_NAME} now hosts the Friday call.`,
      });

    expect(res.status).toBe(200);
    expect(res.body.content).toContain(ALLOWED_FIRST_NAME);
    expect(res.body.content).not.toContain(FORBIDDEN_SURNAME);

    const [stored] = await db
      .select()
      .from(knowledgebaseDocsTable)
      .where(eq(knowledgebaseDocsTable.id, seed.id));
    expect(stored.content).not.toContain(FORBIDDEN_SURNAME);
  });

  it("strips a coach surname on staging push-to-live (POST /push-approved)", async () => {
    const title = `${TEST_TAG} pushed ${FORBIDDEN_FULL_NAME} sop`;
    seededTitles.push(title);
    const [staging] = await db
      .insert(kbStagingDocsTable)
      .values({
        title,
        category: "sop",
        content: `Escalate to ${FORBIDDEN_FULL_NAME} when a campaign stalls.`,
        status: "approved",
        source: "blitz",
      })
      .returning({ id: kbStagingDocsTable.id });
    seededStagingIds.push(staging.id);

    const res = await request(app)
      .post("/api/push-approved")
      .set("Cookie", adminCookie);
    expect(res.status).toBe(200);

    // Push-approved publishes into the assistant corpus (ai_live_documents),
    // never the legacy table. The live title is itself scrubbed, so look it up
    // by the scrubbed form.
    const scrubbedTitle = title.replace(FORBIDDEN_FULL_NAME, ALLOWED_FIRST_NAME);
    seededTitles.push(scrubbedTitle);
    const [live] = await db
      .select()
      .from(aiLiveDocumentsTable)
      .where(eq(aiLiveDocumentsTable.title, scrubbedTitle));
    expect(live).toBeDefined();
    expect(live.title).not.toContain(FORBIDDEN_SURNAME);
    expect(live.content).toContain(ALLOWED_FIRST_NAME);
    expect(live.content).not.toContain(FORBIDDEN_SURNAME);
  });

  it("never surfaces a planted surname through searchTranscripts() retrieval", async () => {
    // A unique, searchable keyword so full-text search reliably returns our row.
    // Retrieval reads ai_live_documents, which only the review pipeline and the
    // Live AI Documents admin write (the legacy admin KB CRUD is decoupled), so
    // plant the doc through the push-approved pipeline.
    const keyword = `Scrubprobe${TEST_TAG.replace(/[^a-z0-9]/gi, "")}`;
    const title = `${TEST_TAG} retrieval ${keyword}`;
    seededTitles.push(title);

    const [staging] = await db
      .insert(kbStagingDocsTable)
      .values({
        title,
        category: "faq",
        content: `${keyword}: contact ${FORBIDDEN_FULL_NAME} about the live coaching schedule.`,
        status: "approved",
        source: "blitz",
      })
      .returning({ id: kbStagingDocsTable.id });
    seededStagingIds.push(staging.id);

    const pushRes = await request(app)
      .post("/api/push-approved")
      .set("Cookie", adminCookie);
    expect(pushRes.status).toBe(200);

    const retrieved = await searchTranscripts(keyword, 3);
    expect(retrieved).toContain(keyword);
    expect(retrieved).toContain(ALLOWED_FIRST_NAME);
    expect(retrieved).not.toContain(FORBIDDEN_FULL_NAME);
    expect(retrieved).not.toContain(FORBIDDEN_SURNAME);
  });
});
