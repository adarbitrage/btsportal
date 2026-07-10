import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
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

// Capture the exact prompt the merge proposal feeds the LLM so we can assert it
// is built ONLY from the selected subset of drafts (no real network call).
const llmCalls: Array<{ label: string; systemPrompt: string; userContent: string }> = [];
vi.mock("../lib/kb-synthesis.js", () => ({
  callLLMWithRetry: vi.fn(async (label: string, systemPrompt: string, userContent: string) => {
    llmCalls.push({ label, systemPrompt, userContent });
    return JSON.stringify({ title: "Merged canonical title", content: "Merged canonical body." });
  }),
}));

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

  it("resolve createNew makes a new needs_review doc, folds ALL sources into it, is auditable & reversible", async () => {
    const idA = await seedStaging({ title: `${TEST_TAG} createnew A`, content: `${BODY} createnew-a` });
    const idB = await seedStaging({ title: `${TEST_TAG} createnew B`, content: `${BODY} createnew-b` });
    const idC = await seedStaging({ title: `${TEST_TAG} createnew C`, content: `${BODY} createnew-c` });

    const res = await request(app)
      .post("/api/duplicates/resolve")
      .set("Cookie", adminCookie)
      .send({
        createNew: true,
        mergedIds: [idA, idB, idC],
        title: `${TEST_TAG} the AI merge doc`,
        content: "Best-of merged content authored by the AI.",
      });
    expect(res.status).toBe(200);
    expect(res.body.created).toBe(true);
    expect(res.body.merged).toBe(3);
    const newId = res.body.canonical.id as number;
    seededStagingIds.push(newId);
    expect(newId).not.toBe(idA);
    expect(res.body.canonical.status).toBe("needs_review");
    expect(res.body.canonical.title).toBe(`${TEST_TAG} the AI merge doc`);
    expect(res.body.canonical.content).toBe("Best-of merged content authored by the AI.");

    // Every original is now merged into the NEW doc, gone from the review queue.
    const sources = await db.select().from(kbStagingDocsTable).where(inArray(kbStagingDocsTable.id, [idA, idB, idC]));
    for (const row of sources) {
      expect(row.status).toBe("merged");
      expect(row.mergedIntoId).toBe(newId);
    }

    // Auditable: a merged_duplicate row per source + an ai_merge_created row on the new doc.
    const srcAudit = await db.select().from(kbTriageAuditLogTable).where(inArray(kbTriageAuditLogTable.stagingDocId, [idA, idB, idC]));
    expect(srcAudit.filter((a) => a.eventType === "merged_duplicate")).toHaveLength(3);
    const newAudit = await db.select().from(kbTriageAuditLogTable).where(eq(kbTriageAuditLogTable.stagingDocId, newId));
    expect(newAudit.filter((a) => a.eventType === "ai_merge_created")).toHaveLength(1);

    // Reversible: unmerge one source restores it to needs_review; new doc untouched.
    const undo = await request(app).post("/api/duplicates/unmerge").set("Cookie", adminCookie).send({ id: idA });
    expect(undo.status).toBe(200);
    const [restored] = await db.select().from(kbStagingDocsTable).where(eq(kbStagingDocsTable.id, idA));
    expect(restored.status).toBe("needs_review");
    const [newDoc] = await db.select().from(kbStagingDocsTable).where(eq(kbStagingDocsTable.id, newId));
    expect(newDoc.status).toBe("needs_review");

    // Idempotent replay: sources already merged → nothing flips → 409, no orphan doc.
    const before = await db.select().from(kbStagingDocsTable).where(eq(kbStagingDocsTable.status, "needs_review"));
    const replay = await request(app)
      .post("/api/duplicates/resolve")
      .set("Cookie", adminCookie)
      .send({ createNew: true, mergedIds: [idB, idC], title: "x", content: "y" });
    expect(replay.status).toBe(409);
    const after = await db.select().from(kbStagingDocsTable).where(eq(kbStagingDocsTable.status, "needs_review"));
    expect(after.length).toBe(before.length); // no new orphan doc created
  });

  it("resolve createNew rejects missing title/content", async () => {
    const id1 = await seedStaging({ title: `${TEST_TAG} createnew-bad 1`, content: BODY });
    const id2 = await seedStaging({ title: `${TEST_TAG} createnew-bad 2`, content: BODY });
    const noTitle = await request(app)
      .post("/api/duplicates/resolve")
      .set("Cookie", adminCookie)
      .send({ createNew: true, mergedIds: [id1, id2], content: "body only" });
    expect(noTitle.status).toBe(400);
    const noContent = await request(app)
      .post("/api/duplicates/resolve")
      .set("Cookie", adminCookie)
      .send({ createNew: true, mergedIds: [id1, id2], title: "title only" });
    expect(noContent.status).toBe(400);
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

  it("POST /duplicates/unmerge restores a merged draft to needs_review with an audit row; 409s non-merged; 404s missing", async () => {
    const canonicalId = await seedStaging({ title: `${TEST_TAG} unmerge canonical`, content: BODY });
    const mergedId = await seedStaging({ title: `${TEST_TAG} unmerge victim`, content: BODY });

    await request(app)
      .post("/api/duplicates/resolve")
      .set("Cookie", adminCookie)
      .send({ canonicalId, mergedIds: [mergedId] });

    const [before] = await db.select().from(kbStagingDocsTable).where(eq(kbStagingDocsTable.id, mergedId));
    expect(before.status).toBe("merged");
    expect(before.mergedIntoId).toBe(canonicalId);

    const res = await request(app)
      .post("/api/duplicates/unmerge")
      .set("Cookie", adminCookie)
      .send({ id: mergedId });
    expect(res.status).toBe(200);
    expect(res.body.doc.status).toBe("needs_review");
    expect(res.body.doc.mergedIntoId).toBeNull();

    const [after] = await db.select().from(kbStagingDocsTable).where(eq(kbStagingDocsTable.id, mergedId));
    expect(after.status).toBe("needs_review");
    expect(after.mergedIntoId).toBeNull();

    const audit = await db
      .select()
      .from(kbTriageAuditLogTable)
      .where(eq(kbTriageAuditLogTable.stagingDocId, mergedId));
    const unmergedEvents = audit.filter((a) => a.eventType === "unmerged");
    expect(unmergedEvents).toHaveLength(1);
    expect(unmergedEvents[0].aiReasoning).toContain(`#${canonicalId}`);

    // Replay: draft is no longer merged → conditional UPDATE matches nothing → 409.
    const replay = await request(app)
      .post("/api/duplicates/unmerge")
      .set("Cookie", adminCookie)
      .send({ id: mergedId });
    expect(replay.status).toBe(409);
    const audit2 = await db
      .select()
      .from(kbTriageAuditLogTable)
      .where(eq(kbTriageAuditLogTable.stagingDocId, mergedId));
    expect(audit2.filter((a) => a.eventType === "unmerged")).toHaveLength(1);

    const missing = await request(app)
      .post("/api/duplicates/unmerge")
      .set("Cookie", adminCookie)
      .send({ id: 999999999 });
    expect(missing.status).toBe(404);

    const badInput = await request(app)
      .post("/api/duplicates/unmerge")
      .set("Cookie", adminCookie)
      .send({});
    expect(badInput.status).toBe(400);
  });

  it("POST /duplicates/propose-merge validates input (no LLM call on bad input)", async () => {
    const res = await request(app)
      .post("/api/duplicates/propose-merge")
      .set("Cookie", adminCookie)
      .send({ ids: [123456789] });
    expect(res.status).toBe(400);
  });

  it("POST /duplicates/propose-merge builds the proposal from ONLY the selected subset", async () => {
    const canonicalId = await seedStaging({ title: `${TEST_TAG} propose canonical`, content: `${BODY} canonical-only-marker` });
    const selected = await seedStaging({ title: `${TEST_TAG} propose selected`, content: `${BODY} selected-only-marker` });
    const excluded = await seedStaging({ title: `${TEST_TAG} propose excluded`, content: `${BODY} excluded-only-marker` });

    llmCalls.length = 0;
    const res = await request(app)
      .post("/api/duplicates/propose-merge")
      .set("Cookie", adminCookie)
      .send({ ids: [canonicalId, selected] }); // excluded deliberately left out
    expect(res.status).toBe(200);
    expect(res.body.sourceIds.sort((a: number, b: number) => a - b)).toEqual([canonicalId, selected].sort((a, b) => a - b));
    expect(res.body.sourceIds).not.toContain(excluded);

    // The prompt the LLM saw must include the selected drafts' bodies and NOT
    // the excluded draft's — proving the merge is scoped to the subset.
    expect(llmCalls).toHaveLength(1);
    const { userContent } = llmCalls[0];
    expect(userContent).toContain("canonical-only-marker");
    expect(userContent).toContain("selected-only-marker");
    expect(userContent).not.toContain("excluded-only-marker");
    expect(userContent).not.toContain(`staging #${excluded}`);
  });

  it("DELETE /duplicates/:id soft-deletes with an audit row, is idempotent, and 404s/400s bad input", async () => {
    const victim = await seedStaging({ title: `${TEST_TAG} delete victim`, content: BODY });

    const res = await request(app)
      .delete(`/api/duplicates/${victim}`)
      .set("Cookie", adminCookie);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: victim, deleted: true });

    // Soft-delete: row still exists but its status excludes it from every
    // review surface (needs_review / merged lists never query 'deleted').
    const [row] = await db.select().from(kbStagingDocsTable).where(eq(kbStagingDocsTable.id, victim));
    expect(row.status).toBe("deleted");
    expect(row.mergedIntoId).toBeNull();

    const audit = await db
      .select()
      .from(kbTriageAuditLogTable)
      .where(eq(kbTriageAuditLogTable.stagingDocId, victim));
    expect(audit.filter((a) => a.eventType === "deleted_duplicate")).toHaveLength(1);

    // It must NOT reappear in the duplicates listing.
    const listed = await request(app).get("/api/duplicates").set("Cookie", adminCookie);
    const stillListed = (listed.body.clusters as Array<{ docs: Array<{ id: number }> }>).some((c) =>
      c.docs.some((d) => d.id === victim),
    );
    expect(stillListed).toBe(false);

    // Idempotent replay: already-deleted is a soft success, no second audit row.
    const replay = await request(app)
      .delete(`/api/duplicates/${victim}`)
      .set("Cookie", adminCookie);
    expect(replay.status).toBe(200);
    expect(replay.body).toMatchObject({ id: victim, alreadyDeleted: true });
    const audit2 = await db
      .select()
      .from(kbTriageAuditLogTable)
      .where(eq(kbTriageAuditLogTable.stagingDocId, victim));
    expect(audit2.filter((a) => a.eventType === "deleted_duplicate")).toHaveLength(1);

    // A non-needs_review draft (e.g. already approved) cannot be deleted here.
    const approved = await seedStaging({ title: `${TEST_TAG} approved not-deletable`, content: BODY, status: "approved" });
    const conflict = await request(app).delete(`/api/duplicates/${approved}`).set("Cookie", adminCookie);
    expect(conflict.status).toBe(409);
    const [approvedRow] = await db.select().from(kbStagingDocsTable).where(eq(kbStagingDocsTable.id, approved));
    expect(approvedRow.status).toBe("approved");

    const missing = await request(app).delete("/api/duplicates/999999999").set("Cookie", adminCookie);
    expect(missing.status).toBe(404);

    const bad = await request(app).delete("/api/duplicates/abc").set("Cookie", adminCookie);
    expect(bad.status).toBe(400);
  });

  it("resolve with a SUBSET marks only the selected drafts merged, leaving excluded ones in needs_review", async () => {
    const canonicalId = await seedStaging({ title: `${TEST_TAG} subset canonical`, content: BODY });
    const mergeMe = await seedStaging({ title: `${TEST_TAG} subset true dup`, content: BODY });
    const keepSeparate = await seedStaging({ title: `${TEST_TAG} subset distinct`, content: BODY });

    const res = await request(app)
      .post("/api/duplicates/resolve")
      .set("Cookie", adminCookie)
      .send({ canonicalId, mergedIds: [mergeMe] }); // keepSeparate deliberately excluded
    expect(res.status).toBe(200);
    expect(res.body.merged).toBe(1);
    expect(res.body.mergedIds).toEqual([mergeMe]);

    const [mergedRow] = await db.select().from(kbStagingDocsTable).where(eq(kbStagingDocsTable.id, mergeMe));
    expect(mergedRow.status).toBe("merged");
    expect(mergedRow.mergedIntoId).toBe(canonicalId);

    // The excluded draft is untouched — still its own needs-review draft.
    const [excludedRow] = await db.select().from(kbStagingDocsTable).where(eq(kbStagingDocsTable.id, keepSeparate));
    expect(excludedRow.status).toBe("needs_review");
    expect(excludedRow.mergedIntoId).toBeNull();
  });

  it("GET /duplicates/merged groups merged drafts by canonical; restore removes a draft from the list", async () => {
    const canonicalId = await seedStaging({ title: `${TEST_TAG} merged-list canonical`, content: BODY });
    const mergedA = await seedStaging({ title: `${TEST_TAG} merged-list victim A`, content: BODY });
    const mergedB = await seedStaging({ title: `${TEST_TAG} merged-list victim B`, content: BODY });

    await request(app)
      .post("/api/duplicates/resolve")
      .set("Cookie", adminCookie)
      .send({ canonicalId, mergedIds: [mergedA, mergedB] });

    const listed = await request(app).get("/api/duplicates/merged").set("Cookie", adminCookie);
    expect(listed.status).toBe(200);
    const group = (listed.body.groups as MergedGroupShape[]).find((g) => g.canonicalId === canonicalId);
    expect(group).toBeDefined();
    expect(group!.canonicalTitle).toBe(`${TEST_TAG} merged-list canonical`);
    expect(group!.docs.map((d) => d.id).sort((a, b) => a - b)).toEqual([mergedA, mergedB].sort((a, b) => a - b));

    // Restore one → it leaves the merged list and returns to needs_review.
    const restore = await request(app)
      .post("/api/duplicates/unmerge")
      .set("Cookie", adminCookie)
      .send({ id: mergedA });
    expect(restore.status).toBe(200);

    const [restored] = await db.select().from(kbStagingDocsTable).where(eq(kbStagingDocsTable.id, mergedA));
    expect(restored.status).toBe("needs_review");
    expect(restored.mergedIntoId).toBeNull();

    const afterList = await request(app).get("/api/duplicates/merged").set("Cookie", adminCookie);
    const groupAfter = (afterList.body.groups as MergedGroupShape[]).find((g) => g.canonicalId === canonicalId);
    expect(groupAfter).toBeDefined();
    expect(groupAfter!.docs.map((d) => d.id)).toEqual([mergedB]);
  });
});

interface MergedGroupShape {
  canonicalId: number;
  canonicalTitle: string | null;
  canonicalStatus: string | null;
  docs: Array<{ id: number; title: string; homeRoot: string | null; node: string | null; createdAt: string }>;
}
