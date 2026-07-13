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
  kbCorpusSweepRunsTable,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

// ── LLM mock ──────────────────────────────────────────────────────────────────
// Dispatch on the label so one mock serves both the concept-sweep judgments and
// the refine-failure test. Per-doc behavior is driven by the doc body content.
const llmCalls: Array<{ label: string; systemPrompt: string; userContent: string; maxTokens: unknown }> = [];
let refineShouldFail = false;
vi.mock("../lib/kb-synthesis.js", () => ({
  callLLMWithRetry: vi.fn(async (label: string, systemPrompt: string, userContent: string, maxTokens?: unknown) => {
    llmCalls.push({ label, systemPrompt, userContent, maxTokens });
    if (label === "refine") {
      if (refineShouldFail) throw new Error("LLM exploded (simulated)");
      return JSON.stringify({
        reply: "This is a corpus-wide ask — use the Corpus Sweep tool (Pipeline Tools → Corpus Sweep).",
      });
    }
    if (label === "concept-sweep") {
      if (userContent.includes("SWEEPJUDGE-FLAWED")) {
        return JSON.stringify({
          contains_flaw: true,
          evidence: "judged against SWEEPJUDGE-FLAWED individual page stats",
          proposed_correction: "Reword to compare against aggregate stats initially.",
        });
      }
      if (userContent.includes("SWEEPJUDGE-ERROR")) {
        throw new Error("Judgment call failed (simulated)");
      }
      return JSON.stringify({ contains_flaw: false, evidence: "", proposed_correction: "" });
    }
    return JSON.stringify({});
  }),
}));

// Retrieval mock: candidates from the semantic pass are controlled per test.
let retrievalDocs: Array<{ id: number; title: string; content: string }> = [];
vi.mock("../lib/kb-retrieval.js", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    retrieveSurfaceAware: vi.fn(async () => ({ docs: retrievalDocs })),
  };
});

import { buildTestAppWithRouters } from "./test-app";
import knowledgebaseStagingRouter from "../routes/admin/knowledgebase-staging";
import { extractSnippets, buildPhraseNote } from "../lib/kb-corpus-sweep";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const TEST_TAG = `kb-sweep-${randomUUID().slice(0, 8)}`;
// A phrase no other row in the shared dev DB will ever contain.
const PHRASE = `cost per ${TEST_TAG} offer click`;
const PHRASE_ALT = `cost per ${TEST_TAG} offer-page click`;

const seededUserIds: number[] = [];
const seededStagingIds: number[] = [];
const seededLiveIds: number[] = [];
const seededRunIds: number[] = [];

let app: ReturnType<typeof buildTestAppWithRouters>;
let adminCookie: string;

async function seedAdmin(): Promise<void> {
  const email = `${TEST_TAG}-admin@example.test`;
  const passwordHash = await bcrypt.hash("irrelevant", 4);
  const [row] = await db
    .insert(usersTable)
    .values({
      email,
      name: "Sweep Admin",
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
  adminNotes?: string;
}): Promise<number> {
  const [row] = await db
    .insert(kbStagingDocsTable)
    .values({
      title: opts.title,
      category: "curriculum",
      content: opts.content,
      editedContent: opts.editedContent,
      adminNotes: opts.adminNotes,
      status: opts.status ?? "needs_review",
      source: "blitz",
    })
    .returning({ id: kbStagingDocsTable.id });
  seededStagingIds.push(row.id);
  return row.id;
}

async function seedLiveDoc(opts: {
  title: string;
  content: string;
  deletedAt?: Date;
  reviewerNotes?: string;
}): Promise<number> {
  const [row] = await db
    .insert(aiLiveDocumentsTable)
    .values({
      title: opts.title,
      content: opts.content,
      deletedAt: opts.deletedAt,
      reviewerNotes: opts.reviewerNotes,
    })
    .returning({ id: aiLiveDocumentsTable.id });
  seededLiveIds.push(row.id);
  return row.id;
}

async function pollRunUntilDone(runId: number, timeoutMs = 15000): Promise<Record<string, unknown>> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const res = await request(app).get(`/api/sweep/concept/runs/${runId}`).set("Cookie", adminCookie);
    expect(res.status).toBe(200);
    if (res.body.run.status !== "running") return res.body.run;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Concept run ${runId} did not finish within ${timeoutMs}ms`);
}

beforeAll(async () => {
  app = buildTestAppWithRouters([knowledgebaseStagingRouter]);
  await seedAdmin();
});

afterAll(async () => {
  if (seededRunIds.length > 0) {
    await db.delete(kbCorpusSweepRunsTable).where(inArray(kbCorpusSweepRunsTable.id, seededRunIds));
  }
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

describe("extractSnippets", () => {
  it("returns ±80-char context per case-insensitive occurrence", () => {
    const text = `${"a".repeat(120)} The COST PER X CLICK metric matters. ${"b".repeat(120)} cost per x click again.`;
    const snippets = extractSnippets(text, "cost per x click");
    expect(snippets).toHaveLength(2);
    expect(snippets[0]).toContain("COST PER X CLICK");
    expect(snippets[0].startsWith("…")).toBe(true);
    expect(snippets[1]).toContain("cost per x click again");
  });
});

describe("phrase sweep", () => {
  it("preview finds matching in-pipeline drafts + live docs; excludes rejected/deleted; uses effective text", async () => {
    const body = `Members often ask about the ${PHRASE} when reviewing dashboards. The ${PHRASE} shows spend efficiency.`;
    const stagingId = await seedStaging({ title: `${TEST_TAG} metrics guide`, content: body });
    // editedContent WITHOUT the phrase must win over content WITH it.
    const editedAwayId = await seedStaging({
      title: `${TEST_TAG} edited-away`,
      content: `contains ${PHRASE}`,
      editedContent: "phrase was already fixed here",
    });
    // editedContent WITH the phrase must match even though content lacks it.
    const editedInId = await seedStaging({
      title: `${TEST_TAG} edited-in`,
      content: "clean original",
      editedContent: `reviewer added ${PHRASE_ALT} while editing`,
    });
    const rejectedId = await seedStaging({ title: `${TEST_TAG} rejected`, content: body, status: "rejected" });
    const liveId = await seedLiveDoc({ title: `${TEST_TAG} live doc`, content: `Live doc says ${PHRASE}.` });
    const deadLiveId = await seedLiveDoc({
      title: `${TEST_TAG} deleted live`,
      content: `Deleted doc says ${PHRASE}.`,
      deletedAt: new Date(),
    });

    const res = await request(app)
      .post("/api/sweep/phrase/preview")
      .set("Cookie", adminCookie)
      .send({ phrases: [PHRASE, PHRASE_ALT] });
    expect(res.status).toBe(200);
    const matches = res.body.matches as Array<{ kind: string; id: number; snippets: string[]; matchCount: number }>;
    const keys = matches.map((m) => `${m.kind}:${m.id}`);
    expect(keys).toContain(`staging:${stagingId}`);
    expect(keys).toContain(`staging:${editedInId}`);
    expect(keys).toContain(`live:${liveId}`);
    expect(keys).not.toContain(`staging:${editedAwayId}`);
    expect(keys).not.toContain(`staging:${rejectedId}`);
    expect(keys).not.toContain(`live:${deadLiveId}`);

    const stagingMatch = matches.find((m) => m.kind === "staging" && m.id === stagingId)!;
    expect(stagingMatch.matchCount).toBe(2);
    expect(stagingMatch.snippets[0].toLowerCase()).toContain(PHRASE.toLowerCase());
  });

  it("confirm appends a note (staging→admin_notes, live→reviewer_notes) and never touches the body", async () => {
    const body = `Optimize the ${PHRASE} before scaling.`;
    const stagingId = await seedStaging({
      title: `${TEST_TAG} confirm target`,
      content: body,
      adminNotes: "pre-existing note",
    });
    const liveId = await seedLiveDoc({ title: `${TEST_TAG} confirm live`, content: `Live: ${PHRASE}.` });
    const cleanId = await seedStaging({ title: `${TEST_TAG} clean doc`, content: "no phrase here at all" });

    const res = await request(app)
      .post("/api/sweep/phrase/confirm")
      .set("Cookie", adminCookie)
      .send({
        phrases: [PHRASE],
        replacement: "LP Event CPC",
        targets: [
          { kind: "staging", id: stagingId },
          { kind: "live", id: liveId },
          { kind: "staging", id: cleanId }, // no match → per-target failure, not a note
        ],
      });
    expect(res.status).toBe(200);
    expect(res.body.written).toBe(2);
    const failed = (res.body.results as Array<{ id: number; ok: boolean; error?: string }>).find((r) => !r.ok);
    expect(failed?.id).toBe(cleanId);

    const [stagingRow] = await db
      .select({ content: kbStagingDocsTable.content, editedContent: kbStagingDocsTable.editedContent, adminNotes: kbStagingDocsTable.adminNotes })
      .from(kbStagingDocsTable)
      .where(eq(kbStagingDocsTable.id, stagingId));
    // Body untouched, note appended below the pre-existing one.
    expect(stagingRow.content).toBe(body);
    expect(stagingRow.editedContent).toBeNull();
    expect(stagingRow.adminNotes).toContain("pre-existing note");
    expect(stagingRow.adminNotes).toContain("[Corpus sweep (phrase)");
    expect(stagingRow.adminNotes).toContain("LP Event CPC");
    expect(stagingRow.adminNotes!.indexOf("pre-existing note")).toBeLessThan(
      stagingRow.adminNotes!.indexOf("[Corpus sweep (phrase)"),
    );

    const [liveRow] = await db
      .select({ content: aiLiveDocumentsTable.content, reviewerNotes: aiLiveDocumentsTable.reviewerNotes })
      .from(aiLiveDocumentsTable)
      .where(eq(aiLiveDocumentsTable.id, liveId));
    expect(liveRow.content).toBe(`Live: ${PHRASE}.`);
    expect(liveRow.reviewerNotes).toContain("[Corpus sweep (phrase)");

    const [cleanRow] = await db
      .select({ adminNotes: kbStagingDocsTable.adminNotes })
      .from(kbStagingDocsTable)
      .where(eq(kbStagingDocsTable.id, cleanId));
    expect(cleanRow.adminNotes).toBeNull();
  });

  it("buildPhraseNote includes variants, replacement and snippets", () => {
    const note = buildPhraseNote(["a phrase", "b phrase"], "New Term", ["…snippet one…"]);
    expect(note).toContain('"a phrase" / "b phrase" → "New Term"');
    expect(note).toContain("…snippet one…");
    expect(note).toContain("notes only");
  });

  it("preview rejects empty phrase lists", async () => {
    const res = await request(app)
      .post("/api/sweep/phrase/preview")
      .set("Cookie", adminCookie)
      .send({ phrases: [" ", "x"] });
    expect(res.status).toBe(400);
  });
});

describe("concept sweep (background run)", () => {
  it("judges candidates per-doc, records loud per-doc errors, confirm writes notes idempotently", async () => {
    // Unique tokens so the loose lexical pass finds ONLY our seeded rows.
    const tokenA = `zqx${TEST_TAG.replace(/-/g, "")}alpha`;
    const tokenB = `zqx${TEST_TAG.replace(/-/g, "")}beta`;
    const flawedStagingId = await seedStaging({
      title: `${TEST_TAG} flawed draft`,
      content: `When running ${tokenA} campaigns, ads are SWEEPJUDGE-FLAWED judged against individual page stats.`,
    });
    const cleanStagingId = await seedStaging({
      title: `${TEST_TAG} clean draft`,
      content: `The ${tokenB} process compares performance against aggregate stats initially.`,
    });
    const errorLiveId = await seedLiveDoc({
      title: `${TEST_TAG} error live`,
      content: `SWEEPJUDGE-ERROR sentinel content about ${tokenA} evaluation.`,
    });
    retrievalDocs = [
      { id: errorLiveId, title: `${TEST_TAG} error live`, content: `SWEEPJUDGE-ERROR sentinel content about ${tokenA} evaluation.` },
    ];

    const startRes = await request(app)
      .post("/api/sweep/concept")
      .set("Cookie", adminCookie)
      .send({
        // Only the unique tokens exceed the 3-char tsquery-word floor, so the
        // loose lexical candidate pass finds ONLY our seeded rows (shared dev
        // DB rows can otherwise out-rank them within the per-pass caps).
        incorrectConcept: `${tokenA} is a bad way to do ads`,
        correctConcept: `${tokenB} is the fix to use now`,
      });
    expect(startRes.status).toBe(200);
    const runId = startRes.body.runId as number;
    seededRunIds.push(runId);

    const run = await pollRunUntilDone(runId);
    expect(run.status).toBe("ready");
    const results = run.results as Array<{ kind: string; id: number; verdict: string; evidence?: string; error?: string; noted?: boolean }>;
    const byKey = new Map(results.map((r) => [`${r.kind}:${r.id}`, r]));

    const flawed = byKey.get(`staging:${flawedStagingId}`);
    expect(flawed?.verdict).toBe("yes");
    expect(flawed?.evidence).toContain("SWEEPJUDGE-FLAWED");
    expect(byKey.get(`staging:${cleanStagingId}`)?.verdict).toBe("no");
    // LLM failure is a loud per-doc 'error' verdict — never coerced to 'no'.
    const errored = byKey.get(`live:${errorLiveId}`);
    expect(errored?.verdict).toBe("error");
    expect(errored?.error).toContain("Judgment call failed");

    // Confirm only the flawed doc.
    const confirmRes = await request(app)
      .post(`/api/sweep/concept/runs/${runId}/confirm`)
      .set("Cookie", adminCookie)
      .send({ targets: [{ kind: "staging", id: flawedStagingId }] });
    expect(confirmRes.status).toBe(200);
    expect(confirmRes.body.written).toBe(1);

    const [flawedRow] = await db
      .select({ content: kbStagingDocsTable.content, adminNotes: kbStagingDocsTable.adminNotes })
      .from(kbStagingDocsTable)
      .where(eq(kbStagingDocsTable.id, flawedStagingId));
    expect(flawedRow.adminNotes).toContain("[Corpus sweep (concept)");
    expect(flawedRow.adminNotes).toContain("aggregate stats initially");
    expect(flawedRow.content).toContain("SWEEPJUDGE-FLAWED"); // body untouched

    const [cleanRow] = await db
      .select({ adminNotes: kbStagingDocsTable.adminNotes })
      .from(kbStagingDocsTable)
      .where(eq(kbStagingDocsTable.id, cleanStagingId));
    expect(cleanRow.adminNotes).toBeNull();

    // Idempotent: re-confirming the same target writes nothing new.
    const confirmAgain = await request(app)
      .post(`/api/sweep/concept/runs/${runId}/confirm`)
      .set("Cookie", adminCookie)
      .send({ targets: [{ kind: "staging", id: flawedStagingId }] });
    expect(confirmAgain.status).toBe(200);
    expect(confirmAgain.body.written).toBe(0);

    // Run listing surfaces the confirmed run.
    const listRes = await request(app).get("/api/sweep/concept/runs").set("Cookie", adminCookie);
    expect(listRes.status).toBe(200);
    const listed = (listRes.body.runs as Array<{ id: number; status: string }>).find((r) => r.id === runId);
    expect(listed?.status).toBe("confirmed");
  });

  it("rejects vague concept input", async () => {
    const res = await request(app)
      .post("/api/sweep/concept")
      .set("Cookie", adminCookie)
      .send({ incorrectConcept: "short", correctConcept: "also short" });
    expect(res.status).toBe(400);
  });
});

describe("refine failure persistence (Task #1903)", () => {
  it("a refine LLM failure is persisted to the refine thread as a FAILED turn and returns 500", async () => {
    const docId = await seedStaging({
      title: `${TEST_TAG} refine target`,
      content: "Draft body that the reviewer wants refined.",
    });
    refineShouldFail = true;
    try {
      const res = await request(app)
        .post(`/api/${docId}/refine`)
        .set("Cookie", adminCookie)
        .send({ instruction: "Tighten the intro paragraph" });
      expect(res.status).toBe(500);
      expect(String(res.body.error)).toContain("LLM exploded");
    } finally {
      refineShouldFail = false;
    }

    // The failure must be pollable from the thread even after the client aborts.
    const threadRes = await request(app).get(`/api/${docId}/refine-thread`).set("Cookie", adminCookie);
    expect(threadRes.status).toBe(200);
    const thread = threadRes.body.thread as Array<{ reasoning: string | null }>;
    const failedRow = thread.find((t) => (t.reasoning ?? "").includes("Refine FAILED per instruction:"));
    expect(failedRow).toBeDefined();
    expect(failedRow!.reasoning).toContain("Tighten the intro paragraph");
    expect(failedRow!.reasoning).toContain("⚠️ Refine failed:");
    expect(failedRow!.reasoning).toContain("LLM exploded");
  });

  it("refine prompt carries the corpus-wide guardrail + raised budget; a discussion reply persists to the thread", async () => {
    const docId = await seedStaging({
      title: `${TEST_TAG} guardrail target`,
      content: "Draft body for the guardrail check.",
    });
    llmCalls.length = 0;
    const res = await request(app)
      .post(`/api/${docId}/refine`)
      .set("Cookie", adminCookie)
      .send({ instruction: "Rename this term across all drafts in the corpus" });
    expect(res.status).toBe(200);
    // Reply-only turn: discussion mode, draft untouched.
    expect(res.body.mode).toBe("discussion");
    expect(res.body.assistantMessage).toContain("Corpus Sweep");
    expect(res.body.changes).toEqual([]);

    const refineCall = llmCalls.find((c) => c.label === "refine");
    expect(refineCall).toBeDefined();
    // Guardrail: corpus-wide asks must be triaged to discussion mode and point
    // at the Corpus Sweep tool — never an edits/rewrite payload.
    expect(refineCall!.systemPrompt).toContain("CORPUS-WIDE / MULTI-DOCUMENT REQUEST");
    expect(refineCall!.systemPrompt).toContain("CORPUS SWEEP tool");
    // Raised initial budget (Task #1903): 12000, not the old starvation-prone 4000.
    expect(refineCall!.maxTokens).toBe(12000);

    const [docRow] = await db
      .select({ editedContent: kbStagingDocsTable.editedContent })
      .from(kbStagingDocsTable)
      .where(eq(kbStagingDocsTable.id, docId));
    expect(docRow.editedContent).toBeNull();

    // The successful turn is persisted server-side (pollable after an abort).
    const threadRes = await request(app).get(`/api/${docId}/refine-thread`).set("Cookie", adminCookie);
    expect(threadRes.status).toBe(200);
    const thread = threadRes.body.thread as Array<{ reasoning: string | null }>;
    const turn = thread.find((t) => (t.reasoning ?? "").includes("Discussed (no edit) per instruction:"));
    expect(turn).toBeDefined();
    expect(turn!.reasoning).toContain("Rename this term across all drafts");
  });
});
