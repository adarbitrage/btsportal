import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import {
  db,
  usersTable,
  kbStagingDocsTable,
  aiLiveDocumentsTable,
  kbTriageAuditLogTable,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

import { buildTestAppWithRouters } from "./test-app";
import knowledgebaseStagingRouter from "../routes/admin/knowledgebase-staging";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const TEST_TAG = `kb-dup-${randomUUID().slice(0, 8)}`;

const seededUserIds: number[] = [];
const seededStagingIds: number[] = [];
const seededLiveIds: number[] = [];

let app: ReturnType<typeof buildTestAppWithRouters>;
let adminCookie: string;

async function seedAdmin(): Promise<void> {
  const email = `${TEST_TAG}-admin@example.test`;
  const passwordHash = await bcrypt.hash("irrelevant", 4);
  const [row] = await db
    .insert(usersTable)
    .values({
      email,
      name: "Dup Admin",
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
  content: string;
  status?: string;
  editedContent?: string;
  targetLiveDocId?: number;
}): Promise<number> {
  const [row] = await db
    .insert(kbStagingDocsTable)
    .values({
      title: opts.title,
      category: "curriculum",
      content: opts.content,
      editedContent: opts.editedContent,
      status: opts.status ?? "needs_review",
      source: "blitz",
      targetLiveDocId: opts.targetLiveDocId,
    })
    .returning({ id: kbStagingDocsTable.id });
  seededStagingIds.push(row.id);
  return row.id;
}

async function seedLiveDoc(opts: { title: string; content: string; deletedAt?: Date }): Promise<number> {
  const [row] = await db
    .insert(aiLiveDocumentsTable)
    .values({
      title: opts.title,
      content: opts.content,
      deletedAt: opts.deletedAt,
    })
    .returning({ id: aiLiveDocumentsTable.id });
  seededLiveIds.push(row.id);
  return row.id;
}

// Cluster-unique concept so shared-dev-DB rows never join our cluster.
const CONCEPT = `Zq${TEST_TAG.replace(/-/g, "")} Widget Calibration`;
const BODY = `${TEST_TAG} calibrating the zq widget requires setting the flux threshold before the run starts and re-checking the alignment values after every batch completes so drift never accumulates over longer sessions. `.repeat(4);

beforeAll(async () => {
  app = buildTestAppWithRouters([knowledgebaseStagingRouter]);
  await seedAdmin();
});

afterAll(async () => {
  if (seededStagingIds.length > 0) {
    await db.delete(kbTriageAuditLogTable).where(inArray(kbTriageAuditLogTable.stagingDocId, seededStagingIds));
    await db.delete(kbStagingDocsTable).where(inArray(kbStagingDocsTable.id, seededStagingIds));
  }
  if (seededLiveIds.length > 0) {
    await db.delete(aiLiveDocumentsTable).where(inArray(aiLiveDocumentsTable.id, seededLiveIds));
  }
  if (seededUserIds.length > 0) {
    await db.delete(usersTable).where(inArray(usersTable.id, seededUserIds));
  }
});

describe("KB duplicate grouping & merge aid routes", () => {
  it("GET /duplicates clusters title variants and marks similar live docs; resolve marks others merged", async () => {
    const liveId = await seedLiveDoc({ title: CONCEPT, content: `${TEST_TAG} live body about something else entirely` });
    const deadLiveId = await seedLiveDoc({
      title: `What is ${CONCEPT}?`,
      content: "deleted live doc must be ignored",
      deletedAt: new Date(),
    });

    const idA = await seedStaging({ title: `What is ${CONCEPT}?`, content: BODY });
    const idB = await seedStaging({ title: CONCEPT, content: `${BODY} Extra trailing sentence for variety.` });
    const idC = await seedStaging({ title: `${CONCEPT} explained`, content: BODY, editedContent: BODY });
    // Approved doc with same title must NOT appear (needs_review only).
    const idApproved = await seedStaging({ title: CONCEPT, content: BODY, status: "approved" });

    const res = await request(app).get("/api/duplicates").set("Cookie", adminCookie);
    expect(res.status).toBe(200);

    const cluster = (res.body.clusters as Array<{ key: string; docs: Array<{ id: number; liveSimilar: { liveDocId: number; reason: string } | null }> }>)
      .find((c) => c.docs.some((d) => d.id === idA));
    expect(cluster).toBeDefined();
    const ids = cluster!.docs.map((d) => d.id).sort((a, b) => a - b);
    expect(ids).toEqual([idA, idB, idC].sort((a, b) => a - b));
    expect(ids).not.toContain(idApproved);

    // Similar-live-doc indicator points at the NON-deleted live doc for the
    // exact-concept titles (A and B). C's title ("… explained") adds a token,
    // so it only matches via content — and its content differs, so it's null.
    for (const d of cluster!.docs.filter((x) => x.id === idA || x.id === idB)) {
      expect(d.liveSimilar).toMatchObject({ liveDocId: liveId, reason: "title" });
      expect(d.liveSimilar!.liveDocId).not.toBe(deadLiveId);
    }

    // ── Resolve: keep A (edited title + content), merge B and C ──
    const resolveRes = await request(app)
      .post("/api/duplicates/resolve")
      .set("Cookie", adminCookie)
      .send({
        canonicalId: idA,
        mergedIds: [idB, idC],
        title: `${CONCEPT} (canonical)`,
        content: "Merged canonical body chosen by the reviewer.",
      });
    expect(resolveRes.status).toBe(200);
    expect(resolveRes.body.merged).toBe(2);
    expect(resolveRes.body.skipped).toEqual([]);
    expect(resolveRes.body.canonical.status).toBe("needs_review"); // never auto-approved
    expect(resolveRes.body.canonical.title).toBe(`${CONCEPT} (canonical)`);
    expect(resolveRes.body.canonical.editedContent).toBe("Merged canonical body chosen by the reviewer.");

    const mergedRows = await db
      .select()
      .from(kbStagingDocsTable)
      .where(inArray(kbStagingDocsTable.id, [idB, idC]));
    for (const row of mergedRows) {
      expect(row.status).toBe("merged");
      expect(row.mergedIntoId).toBe(idA);
    }

    const audit = await db
      .select()
      .from(kbTriageAuditLogTable)
      .where(inArray(kbTriageAuditLogTable.stagingDocId, [idB, idC]));
    expect(audit.filter((a) => a.eventType === "merged_duplicate")).toHaveLength(2);

    // ── Idempotent replay: already-merged ids are skipped, not clobbered ──
    const replay = await request(app)
      .post("/api/duplicates/resolve")
      .set("Cookie", adminCookie)
      .send({ canonicalId: idA, mergedIds: [idB, idC] });
    expect(replay.status).toBe(200);
    expect(replay.body.merged).toBe(0);
    expect(replay.body.skipped.sort((a: number, b: number) => a - b)).toEqual([idB, idC].sort((a, b) => a - b));
  });

  it("rejects resolve with a non-needs_review canonical, missing ids, or canonical in mergedIds", async () => {
    const approvedId = await seedStaging({ title: `${TEST_TAG} approved doc`, content: BODY, status: "approved" });
    const pendingId = await seedStaging({ title: `${TEST_TAG} pending doc`, content: BODY });

    const conflict = await request(app)
      .post("/api/duplicates/resolve")
      .set("Cookie", adminCookie)
      .send({ canonicalId: approvedId, mergedIds: [pendingId] });
    expect(conflict.status).toBe(409);

    const missing = await request(app)
      .post("/api/duplicates/resolve")
      .set("Cookie", adminCookie)
      .send({ canonicalId: pendingId, mergedIds: [] });
    expect(missing.status).toBe(400);

    const selfMerge = await request(app)
      .post("/api/duplicates/resolve")
      .set("Cookie", adminCookie)
      .send({ canonicalId: pendingId, mergedIds: [pendingId] });
    expect(selfMerge.status).toBe(400);
  });

  it("GET /live-similarity excludes a draft's own update target but flags other drafts", async () => {
    const concept = `Xw${TEST_TAG.replace(/-/g, "")} Ledger Sync`;
    const liveId = await seedLiveDoc({ title: concept, content: `${TEST_TAG} live ledger sync body` });

    const updateDraftId = await seedStaging({
      title: concept,
      content: "revision of the live doc",
      targetLiveDocId: liveId,
    });
    const newDraftId = await seedStaging({ title: `What is ${concept}?`, content: "an unrelated body" });

    const res = await request(app).get("/api/live-similarity").set("Cookie", adminCookie);
    expect(res.status).toBe(200);
    expect(res.body.matches[String(updateDraftId)]).toBeUndefined();
    expect(res.body.matches[String(newDraftId)]).toMatchObject({ liveDocId: liveId, reason: "title" });
  });

  it("GET /live-doc/:id returns a non-deleted live doc and 404s deleted ones", async () => {
    const liveId = await seedLiveDoc({ title: `${TEST_TAG} readable live doc`, content: "readable body" });
    const deadId = await seedLiveDoc({ title: `${TEST_TAG} deleted live doc`, content: "gone", deletedAt: new Date() });

    const ok = await request(app).get(`/api/live-doc/${liveId}`).set("Cookie", adminCookie);
    expect(ok.status).toBe(200);
    expect(ok.body.title).toBe(`${TEST_TAG} readable live doc`);

    const dead = await request(app).get(`/api/live-doc/${deadId}`).set("Cookie", adminCookie);
    expect(dead.status).toBe(404);
  });

  it("POST /duplicates/propose-merge validates input (no LLM call on bad input)", async () => {
    const res = await request(app)
      .post("/api/duplicates/propose-merge")
      .set("Cookie", adminCookie)
      .send({ ids: [123456789] });
    expect(res.status).toBe(400);
  });
});
