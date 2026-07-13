import { db } from "@workspace/db";
import {
  kbStagingDocsTable,
  aiLiveDocumentsTable,
  kbCorpusSweepRunsTable,
  type CorpusSweepResult,
} from "@workspace/db/schema";
import { eq, sql, desc, notInArray } from "drizzle-orm";
import { callLLMWithRetry } from "./kb-synthesis.js";
import { retrieveSurfaceAware } from "./kb-retrieval.js";
import { HOME_ROOTS } from "./kb-taxonomy.js";

/**
 * Corpus sweep (Task #1903): cross-document correction proposals.
 *
 * When a reviewer spots incorrect terminology (phrase mode) or a flawed concept
 * (concept mode) that may span multiple docs, the sweep finds every affected
 * staging draft / live doc and — after the reviewer confirms — appends a
 * structured NOTE to each (staging → admin_notes, live → reviewer_notes,
 * append-only, same dual-column rule as the review page's leave-note action).
 * The sweep NEVER modifies a document body; the reviewer applies edits
 * doc-by-doc through the normal editor/refine flow.
 */

// Staging drafts in these states are out of the review pipeline — never sweep them.
export const SWEEP_EXCLUDED_STAGING_STATUSES = ["rejected", "deleted"];

export interface SweepDocMatch {
  kind: "staging" | "live";
  id: number;
  title: string;
  status: string | null;
  /** Matched snippets (per occurrence, ±80 chars of context). */
  snippets: string[];
  matchCount: number;
}

// ── Phrase mode ───────────────────────────────────────────────────────────────

/** Escape LIKE/ILIKE metacharacters in a user-supplied phrase. */
function escapeLike(phrase: string): string {
  return phrase.replace(/([\\%_])/g, "\\$1");
}

/** Extract every case-insensitive occurrence of `phrase` in `text` as a ±80-char snippet. */
export function extractSnippets(text: string, phrase: string, cap = 5): string[] {
  const snippets: string[] = [];
  const lower = text.toLowerCase();
  const needle = phrase.toLowerCase();
  if (!needle) return snippets;
  let idx = 0;
  while (snippets.length < cap) {
    const at = lower.indexOf(needle, idx);
    if (at === -1) break;
    const start = Math.max(0, at - 80);
    const end = Math.min(text.length, at + needle.length + 80);
    const snippet =
      (start > 0 ? "…" : "") +
      text.substring(start, end).replace(/\s+/g, " ").trim() +
      (end < text.length ? "…" : "");
    snippets.push(snippet);
    idx = at + needle.length;
  }
  return snippets;
}

function countOccurrences(text: string, phrase: string): number {
  const lower = text.toLowerCase();
  const needle = phrase.toLowerCase();
  if (!needle) return 0;
  let count = 0;
  let idx = 0;
  while (true) {
    const at = lower.indexOf(needle, idx);
    if (at === -1) break;
    count += 1;
    idx = at + needle.length;
  }
  return count;
}

/**
 * Phrase-mode preview: instant DB search for every non-rejected/non-deleted
 * staging draft and non-deleted live doc whose effective text (or title)
 * contains any of the phrases (case-insensitive). Returns per-doc matched
 * snippets. Read-only.
 */
export async function phraseSweepPreview(phrases: string[]): Promise<SweepDocMatch[]> {
  const clean = phrases.map((p) => p.trim()).filter(Boolean);
  if (clean.length === 0) return [];

  // OR the phrases together in SQL for candidate rows; snippets computed in JS.
  const stagingConds = clean.map(
    (p) =>
      sql`(coalesce(${kbStagingDocsTable.editedContent}, ${kbStagingDocsTable.content}, '') ILIKE ${"%" + escapeLike(p) + "%"} OR ${kbStagingDocsTable.title} ILIKE ${"%" + escapeLike(p) + "%"})`,
  );
  const stagingWhere = stagingConds.reduce((acc, c) => sql`${acc} OR ${c}`);
  const stagingRows = await db
    .select({
      id: kbStagingDocsTable.id,
      title: kbStagingDocsTable.title,
      status: kbStagingDocsTable.status,
      content: kbStagingDocsTable.content,
      editedContent: kbStagingDocsTable.editedContent,
    })
    .from(kbStagingDocsTable)
    .where(
      sql`${notInArray(kbStagingDocsTable.status, SWEEP_EXCLUDED_STAGING_STATUSES)} AND (${stagingWhere})`,
    )
    .orderBy(kbStagingDocsTable.id);

  const liveConds = clean.map(
    (p) =>
      sql`(${aiLiveDocumentsTable.content} ILIKE ${"%" + escapeLike(p) + "%"} OR ${aiLiveDocumentsTable.title} ILIKE ${"%" + escapeLike(p) + "%"})`,
  );
  const liveWhere = liveConds.reduce((acc, c) => sql`${acc} OR ${c}`);
  const liveRows = await db
    .select({
      id: aiLiveDocumentsTable.id,
      title: aiLiveDocumentsTable.title,
      content: aiLiveDocumentsTable.content,
    })
    .from(aiLiveDocumentsTable)
    .where(sql`${aiLiveDocumentsTable.deletedAt} IS NULL AND (${liveWhere})`)
    .orderBy(aiLiveDocumentsTable.id);

  const matches: SweepDocMatch[] = [];
  for (const r of stagingRows) {
    const effective = `${r.title}\n${r.editedContent ?? r.content ?? ""}`;
    const snippets: string[] = [];
    let matchCount = 0;
    for (const p of clean) {
      matchCount += countOccurrences(effective, p);
      snippets.push(...extractSnippets(effective, p));
    }
    if (matchCount > 0) {
      matches.push({ kind: "staging", id: r.id, title: r.title, status: r.status, snippets: snippets.slice(0, 8), matchCount });
    }
  }
  for (const r of liveRows) {
    const effective = `${r.title}\n${r.content ?? ""}`;
    const snippets: string[] = [];
    let matchCount = 0;
    for (const p of clean) {
      matchCount += countOccurrences(effective, p);
      snippets.push(...extractSnippets(effective, p));
    }
    if (matchCount > 0) {
      matches.push({ kind: "live", id: r.id, title: r.title, status: "live", snippets: snippets.slice(0, 8), matchCount });
    }
  }
  return matches;
}

// ── Note writing (shared by both modes) ───────────────────────────────────────

/**
 * Append a sweep note to one doc. Staging → admin_notes, live → reviewer_notes.
 * Append-only merge (existing note preserved + blank-line separated) — the same
 * dual-column rule as the review page's leave-note action. Never touches the
 * document body.
 */
export async function appendSweepNote(
  kind: "staging" | "live",
  id: number,
  entry: string,
): Promise<{ ok: boolean; title?: string; error?: string }> {
  if (kind === "live") {
    const [target] = await db
      .select({ id: aiLiveDocumentsTable.id, title: aiLiveDocumentsTable.title, reviewerNotes: aiLiveDocumentsTable.reviewerNotes })
      .from(aiLiveDocumentsTable)
      .where(sql`${aiLiveDocumentsTable.id} = ${id} AND ${aiLiveDocumentsTable.deletedAt} IS NULL`);
    if (!target) return { ok: false, error: "Live document not found" };
    const merged = target.reviewerNotes ? `${target.reviewerNotes}\n\n${entry}` : entry;
    await db
      .update(aiLiveDocumentsTable)
      .set({ reviewerNotes: merged, updatedAt: new Date() })
      .where(eq(aiLiveDocumentsTable.id, id));
    return { ok: true, title: target.title };
  }
  const [target] = await db
    .select({ id: kbStagingDocsTable.id, title: kbStagingDocsTable.title, adminNotes: kbStagingDocsTable.adminNotes })
    .from(kbStagingDocsTable)
    .where(eq(kbStagingDocsTable.id, id));
  if (!target) return { ok: false, error: "Staging draft not found" };
  const merged = target.adminNotes ? `${target.adminNotes}\n\n${entry}` : entry;
  await db.update(kbStagingDocsTable).set({ adminNotes: merged }).where(eq(kbStagingDocsTable.id, id));
  return { ok: true, title: target.title };
}

/** Build the structured phrase-mode note for one doc. */
export function buildPhraseNote(
  phrases: string[],
  replacement: string,
  snippets: string[],
): string {
  const stamp = new Date().toISOString().slice(0, 10);
  return (
    `[Corpus sweep (phrase) ${stamp}]\n` +
    `Proposed terminology change: ${phrases.map((p) => `"${p}"`).join(" / ")} → "${replacement}"\n` +
    `Matches found in this doc:\n` +
    snippets.map((s) => `• ${s}`).join("\n") +
    `\nThis sweep writes notes only — apply the change through the normal editor/refine flow if it belongs here (definitional/intentional mentions may be fine as-is).`
  );
}

/**
 * Phrase-mode confirm: append the proposed-change note to each selected target.
 * Snippets are recomputed per doc at confirm time so the note reflects the
 * doc's current text.
 */
export async function phraseSweepConfirm(
  phrases: string[],
  replacement: string,
  targets: Array<{ kind: "staging" | "live"; id: number }>,
): Promise<Array<{ kind: string; id: number; ok: boolean; title?: string; error?: string }>> {
  const preview = await phraseSweepPreview(phrases);
  const byKey = new Map(preview.map((m) => [`${m.kind}:${m.id}`, m]));
  const results: Array<{ kind: string; id: number; ok: boolean; title?: string; error?: string }> = [];
  for (const t of targets) {
    const match = byKey.get(`${t.kind}:${t.id}`);
    if (!match) {
      results.push({ kind: t.kind, id: t.id, ok: false, error: "No phrase match in this doc (it may have changed since preview)" });
      continue;
    }
    const note = buildPhraseNote(phrases, replacement, match.snippets);
    const outcome = await appendSweepNote(t.kind, t.id, note);
    results.push({ kind: t.kind, id: t.id, ...outcome });
  }
  return results;
}

// ── Concept mode (background job) ─────────────────────────────────────────────

// Cap the candidate set so a run stays bounded (one LLM call per candidate).
const CONCEPT_MAX_CANDIDATES = 20;
// Per-doc judgment budget. Escalation in callLLMWithRetry is the backstop.
const CONCEPT_JUDGE_MAX_TOKENS = 6000;
// A 'running' row untouched for this long is considered interrupted (restart).
export const CONCEPT_RUN_STALE_MS = 15 * 60 * 1000;

let _conceptSweepRunning = false;
export function isConceptSweepRunning(): boolean {
  return _conceptSweepRunning;
}

interface ConceptCandidate {
  kind: "staging" | "live";
  id: number;
  title: string;
  content: string;
}

/** Build a loose OR ts_query from the significant words of the concept descriptions. */
function buildLooseTsQuery(text: string): string | null {
  const words = Array.from(
    new Set(
      text
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length > 3),
    ),
  ).slice(0, 12);
  if (words.length === 0) return null;
  return words.map((w) => `${w}:*`).join(" | ");
}

async function gatherConceptCandidates(incorrect: string, correct: string): Promise<ConceptCandidate[]> {
  const seen = new Set<string>();
  const candidates: ConceptCandidate[] = [];
  const push = (c: ConceptCandidate) => {
    const key = `${c.kind}:${c.id}`;
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push(c);
  };

  // 1. Surface-aware retrieval over the live corpus (semantic + lexical hybrid).
  try {
    const live = await retrieveSurfaceAware(incorrect, {
      surface: "chat",
      categories: HOME_ROOTS.map((r) => r.slug),
      limit: 8,
    });
    for (const d of live.docs) {
      push({ kind: "live", id: d.id, title: d.title, content: d.content ?? "" });
    }
  } catch {
    // Retrieval is one of several candidate sources; lexical passes below still run.
  }

  // 2. Loose lexical search (OR of significant words) over live + staging so
  //    non-citable live docs and in-flight drafts are also candidates.
  const tsq = buildLooseTsQuery(`${incorrect} ${correct}`);
  if (tsq) {
    try {
      const liveRows = await db
        .select({ id: aiLiveDocumentsTable.id, title: aiLiveDocumentsTable.title, content: aiLiveDocumentsTable.content })
        .from(aiLiveDocumentsTable)
        .where(
          sql`${aiLiveDocumentsTable.deletedAt} IS NULL AND ${aiLiveDocumentsTable.searchVector} @@ to_tsquery('english', ${tsq})`,
        )
        .orderBy(sql`ts_rank(${aiLiveDocumentsTable.searchVector}, to_tsquery('english', ${tsq})) DESC`)
        .limit(10);
      for (const r of liveRows) push({ kind: "live", id: r.id, title: r.title, content: r.content ?? "" });
    } catch {
      // Malformed tsquery from odd input — staging pass may still work.
    }
    try {
      const stagingRows = await db
        .select({
          id: kbStagingDocsTable.id,
          title: kbStagingDocsTable.title,
          content: kbStagingDocsTable.content,
          editedContent: kbStagingDocsTable.editedContent,
        })
        .from(kbStagingDocsTable)
        .where(
          sql`${notInArray(kbStagingDocsTable.status, SWEEP_EXCLUDED_STAGING_STATUSES)} AND to_tsvector('english', ${kbStagingDocsTable.title} || ' ' || coalesce(${kbStagingDocsTable.editedContent}, ${kbStagingDocsTable.content}, '')) @@ to_tsquery('english', ${tsq})`,
        )
        .orderBy(
          sql`ts_rank(to_tsvector('english', ${kbStagingDocsTable.title} || ' ' || coalesce(${kbStagingDocsTable.editedContent}, ${kbStagingDocsTable.content}, '')), to_tsquery('english', ${tsq})) DESC`,
        )
        .limit(10);
      for (const r of stagingRows) {
        push({ kind: "staging", id: r.id, title: r.title, content: r.editedContent ?? r.content ?? "" });
      }
    } catch {
      // Same — loud failures happen per-doc during judgment, not here.
    }
  }

  return candidates.slice(0, CONCEPT_MAX_CANDIDATES);
}

/** One bounded LLM judgment per candidate doc. Exported for tests. */
export async function judgeConceptInDoc(
  incorrect: string,
  correct: string,
  doc: ConceptCandidate,
): Promise<{ containsFlaw: boolean; evidence: string; proposedCorrection: string }> {
  const system = `You audit ONE BTS (Build Test Scale) knowledge-base document for a specific flawed concept/wording.

FLAWED concept (what should NOT be taught): ${incorrect}
CORRECT framing: ${correct}

Judge whether THIS document actually asserts or teaches the flawed concept. Definitional mentions, explicit corrections of the flaw, or unrelated uses of similar words do NOT count — only content that would lead a reader to believe the flawed concept.

Return ONLY JSON:
{"contains_flaw": true|false, "evidence": "<EXACT quote from the document showing the flaw, or empty string>", "proposed_correction": "<2-4 sentence per-doc note proposing how to correct this doc's wording, or empty string>"}
- "evidence" must be copied verbatim from the document. Never fabricate a quote.
- When contains_flaw is false, evidence and proposed_correction must be empty strings.`;
  const user = `DOCUMENT TITLE: ${doc.title}\n\nDOCUMENT BODY:\n${doc.content.substring(0, 11000)}`;
  const raw = (await callLLMWithRetry("concept-sweep", system, user, CONCEPT_JUDGE_MAX_TOKENS, true)).trim();
  let parsed: { contains_flaw?: unknown; evidence?: unknown; proposed_correction?: unknown };
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("AI returned malformed concept-sweep JSON");
  }
  const containsFlaw = parsed.contains_flaw === true;
  return {
    containsFlaw,
    evidence: containsFlaw && typeof parsed.evidence === "string" ? parsed.evidence.trim() : "",
    proposedCorrection:
      containsFlaw && typeof parsed.proposed_correction === "string" ? parsed.proposed_correction.trim() : "",
  };
}

/**
 * Start a concept sweep as a BACKGROUND job. Returns the run id immediately;
 * progress and per-doc verdicts persist on kb_corpus_sweep_runs so the run can
 * never be lost to a connection timeout. Per-doc LLM failures are recorded
 * loudly as verdict 'error' — never coerced to 'no match'.
 */
export async function startConceptSweep(
  incorrect: string,
  correct: string,
  userId: number | null,
): Promise<number> {
  const [run] = await db
    .insert(kbCorpusSweepRunsTable)
    .values({
      mode: "concept",
      status: "running",
      incorrectConcept: incorrect,
      correctConcept: correct,
      createdBy: userId,
    })
    .returning({ id: kbCorpusSweepRunsTable.id });

  _conceptSweepRunning = true;
  void runConceptSweep(run.id, incorrect, correct)
    .catch(async (err) => {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[CorpusSweep] run ${run.id} failed: ${msg}`);
      await db
        .update(kbCorpusSweepRunsTable)
        .set({ status: "failed", error: msg, finishedAt: new Date() })
        .where(eq(kbCorpusSweepRunsTable.id, run.id))
        .catch(() => {});
    })
    .finally(() => {
      _conceptSweepRunning = false;
    });
  return run.id;
}

async function runConceptSweep(runId: number, incorrect: string, correct: string): Promise<void> {
  const candidates = await gatherConceptCandidates(incorrect, correct);
  await db
    .update(kbCorpusSweepRunsTable)
    .set({ total: candidates.length })
    .where(eq(kbCorpusSweepRunsTable.id, runId));

  const results: CorpusSweepResult[] = [];
  for (const c of candidates) {
    try {
      const judged = await judgeConceptInDoc(incorrect, correct, c);
      results.push({
        kind: c.kind,
        id: c.id,
        title: c.title,
        verdict: judged.containsFlaw ? "yes" : "no",
        ...(judged.containsFlaw
          ? { evidence: judged.evidence, proposedCorrection: judged.proposedCorrection }
          : {}),
      });
    } catch (err) {
      // Loud per-doc failure: never treat an LLM failure as "no match".
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[CorpusSweep] run ${runId} — judgment failed for ${c.kind} #${c.id}: ${msg}`);
      results.push({ kind: c.kind, id: c.id, title: c.title, verdict: "error", error: msg });
    }
    await db
      .update(kbCorpusSweepRunsTable)
      .set({ processed: results.length, results })
      .where(eq(kbCorpusSweepRunsTable.id, runId));
  }

  await db
    .update(kbCorpusSweepRunsTable)
    .set({ status: "ready", finishedAt: new Date() })
    .where(eq(kbCorpusSweepRunsTable.id, runId));
}

/** Build the structured concept-mode note for one doc. */
export function buildConceptNote(
  incorrect: string,
  correct: string,
  result: CorpusSweepResult,
): string {
  const stamp = new Date().toISOString().slice(0, 10);
  return (
    `[Corpus sweep (concept) ${stamp}]\n` +
    `Flagged concept: ${incorrect}\n` +
    `Correct framing: ${correct}\n` +
    (result.evidence ? `Evidence in this doc: "${result.evidence}"\n` : "") +
    `Proposed correction: ${result.proposedCorrection || "(see flagged concept above)"}\n` +
    `This sweep writes notes only — apply the change through the normal editor/refine flow.`
  );
}

/**
 * Confirm a ready concept run: append notes to the selected targets (which must
 * be results of THIS run) and mark the run confirmed. Idempotent per target —
 * already-noted results are skipped.
 */
export async function confirmConceptSweep(
  runId: number,
  targets: Array<{ kind: "staging" | "live"; id: number }>,
): Promise<{ written: number; results: CorpusSweepResult[] } | { error: string; status?: number }> {
  const [run] = await db
    .select()
    .from(kbCorpusSweepRunsTable)
    .where(eq(kbCorpusSweepRunsTable.id, runId));
  if (!run) return { error: "Run not found", status: 404 };
  if (run.status !== "ready" && run.status !== "confirmed") {
    return { error: `Run is not ready for confirmation (status: ${run.status})`, status: 400 };
  }

  const results = (run.results ?? []).slice();
  const wanted = new Set(targets.map((t) => `${t.kind}:${t.id}`));
  let written = 0;
  for (const r of results) {
    if (!wanted.has(`${r.kind}:${r.id}`) || r.noted) continue;
    const note = buildConceptNote(run.incorrectConcept, run.correctConcept, r);
    const outcome = await appendSweepNote(r.kind, r.id, note);
    if (outcome.ok) {
      r.noted = true;
      written += 1;
    } else {
      r.error = outcome.error;
    }
  }

  await db
    .update(kbCorpusSweepRunsTable)
    .set({ results, status: "confirmed", notesWrittenAt: new Date() })
    .where(eq(kbCorpusSweepRunsTable.id, runId));
  return { written, results };
}

/**
 * List recent concept runs (newest first), self-healing interrupted ones: a
 * 'running' row whose updated_at is older than CONCEPT_RUN_STALE_MS is marked
 * failed (server restart / stall) so the UI never shows a forever-spinner.
 */
export async function listConceptSweepRuns(limit = 10) {
  const rows = await db
    .select()
    .from(kbCorpusSweepRunsTable)
    .orderBy(desc(kbCorpusSweepRunsTable.startedAt))
    .limit(limit);
  const now = Date.now();
  for (const r of rows) {
    if (
      r.status === "running" &&
      !_conceptSweepRunning &&
      now - new Date(r.updatedAt).getTime() > CONCEPT_RUN_STALE_MS
    ) {
      r.status = "failed";
      r.error = "Run interrupted (server restart or stall) — start a new sweep.";
      await db
        .update(kbCorpusSweepRunsTable)
        .set({ status: "failed", error: r.error, finishedAt: new Date() })
        .where(eq(kbCorpusSweepRunsTable.id, r.id));
    }
  }
  return rows;
}
