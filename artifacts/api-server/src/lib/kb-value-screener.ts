import { db } from "@workspace/db";
import {
  aiSourceDocumentsTable,
  kbCallScreeningsTable,
  kbScreenedExchangesTable,
  kbCalibrationExamplesTable,
  type KbCalibrationExample,
} from "@workspace/db/schema";
import { eq, inArray, desc } from "drizzle-orm";
import { createHash } from "crypto";
import { callLLM } from "./kb-synthesis.js";
import { fingerprintContent, mapWithConcurrency } from "./kb-source-windows.js";
import { loadMemberPiiScrubber, type MemberPiiScrubber } from "./kb-member-pii.js";
import { SOURCE_FOLDERS } from "./kb-taxonomy.js";

/**
 * Coaching-transcript VALUE SCREENER (Task #1702).
 *
 * A NEW value-screening layer that sits BETWEEN the existing source-level
 * screening/mining gates and the synthesis engine (synthesis itself is NOT
 * modified). For each already-cleared coaching-call source it:
 *   1. DEDUP gate — exact content-hash + near-duplicate similarity.
 *   2. Exchange segmentation — member prompt + coach response units.
 *   3. LLM value-type classification with keep/drop/flag disposition and a
 *      situational-number flag; works COLD with a default rubric and gets
 *      sharper as the coach-calibration set (few-shot exemplars) grows.
 *   4. Residual member-PII backstop (matches the live users roster).
 *   5. Durable screened-output store (kept AND dropped, with reasons) stamped
 *      with a per-source content fingerprint + calibration version (mirrors the
 *      kb_source_node_extracts cache pattern).
 *
 * DESIGN DECISION (recommended default, documented, not asked): the screened,
 * de-duplicated, member-PII-scrubbed representation (the KEPT exchanges) is what
 * the later topic-index/extract phase (Task 2) reads; the raw
 * ai_source_documents.content is retained untouched for audit. See
 * getScreenedRepresentation. Nothing here is auto-published.
 */

// ── Closed vocabularies (plain text, owned here — NOT pg enums) ──────────────

export const VALUE_TYPES = [
  "principle",
  "framework",
  "process",
  "worked_example",
  "troubleshooting",
  "decision_criteria",
  "resource_pointer",
  "motivation",
  "logistics",
  "chitchat",
  "situational_answer",
  "unclassified",
] as const;
export type ValueType = (typeof VALUE_TYPES)[number];

export const DISPOSITIONS = ["keep", "drop", "flag"] as const;
export type Disposition = (typeof DISPOSITIONS)[number];

export const DEDUP_STATUSES = ["unique", "exact_duplicate", "near_duplicate"] as const;
export type DedupStatus = (typeof DEDUP_STATUSES)[number];

// Value types the DEFAULT cold rubric treats as low/no durable value.
const LOW_VALUE_TYPES = new Set<ValueType>(["logistics", "chitchat", "motivation"]);

// The coaching source folders this screener operates over (cleared coaching
// calls only — Blitz video / reference docs / VA transcripts are out of scope).
export const SCREENER_SOURCE_FOLDERS = SOURCE_FOLDERS.filter(
  (f) => f.slug === "group_coaching" || f.slug === "private_coaching",
).map((f) => f.slug);

// Near-duplicate similarity threshold (Jaccard over word 5-shingles).
const NEAR_DUP_THRESHOLD = 0.82;

// ── Pure helpers (unit-tested) ──────────────────────────────────────────────

const isValueType = (v: unknown): v is ValueType =>
  typeof v === "string" && (VALUE_TYPES as readonly string[]).includes(v);
const isDisposition = (v: unknown): v is Disposition =>
  typeof v === "string" && (DISPOSITIONS as readonly string[]).includes(v);

/** Normalize content for EXACT-duplicate detection: lowercase, collapse
 *  whitespace, strip punctuation. Two transcripts that differ only in casing /
 *  spacing / punctuation normalize to the same string. */
export function normalizeForDedup(content: string): string {
  return (content || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** The stable exact-duplicate key for a source (hash of normalized content). */
export function exactDedupHash(content: string): string {
  return createHash("sha256").update(normalizeForDedup(content)).digest("hex");
}

/** Word 5-shingles of normalized content (for near-duplicate similarity). */
export function contentShingles(content: string, size = 5): Set<string> {
  const words = normalizeForDedup(content).split(" ").filter(Boolean);
  const out = new Set<string>();
  if (words.length < size) {
    if (words.length > 0) out.add(words.join(" "));
    return out;
  }
  for (let i = 0; i + size <= words.length; i++) {
    out.add(words.slice(i, i + size).join(" "));
  }
  return out;
}

/** Jaccard similarity (0..1) between two shingle sets. */
export function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const s of small) if (large.has(s)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

/** Heuristic: does a chunk of text read like a member's question/prompt? */
export function looksLikeQuestion(text: string): boolean {
  const t = (text || "").trim();
  if (!t) return false;
  if (t.includes("?")) return true;
  const lead = t.toLowerCase().slice(0, 40);
  return /^(how|what|why|when|where|which|who|should i|can i|could i|do i|does|is it|is there|are there|what's|whats|i have a question|quick question|my question)\b/.test(
    lead,
  );
}

const SPEAKER_LINE = /^\s*([\p{L}][\p{L} .'\-]{0,30}?):\s+(\S.*)$/u;

/** A segmented member-prompt + coach-response unit. */
export interface Exchange {
  orderIndex: number;
  memberPrompt: string;
  coachResponse: string;
}

interface Turn {
  speaker: string | null;
  text: string;
}

/** Parse speaker-labeled dialogue lines into turns; returns null when the
 *  content is not speaker-labeled (fewer than 3 labeled lines). */
function parseDialogueTurns(content: string): Turn[] | null {
  const lines = content.split(/\r?\n/);
  let labeled = 0;
  const turns: Turn[] = [];
  for (const line of lines) {
    const m = line.match(SPEAKER_LINE);
    if (m) {
      labeled++;
      turns.push({ speaker: m[1].trim(), text: m[2].trim() });
    } else if (line.trim()) {
      // Continuation of the previous turn (wrapped line).
      if (turns.length > 0) turns[turns.length - 1].text += " " + line.trim();
      else turns.push({ speaker: null, text: line.trim() });
    }
  }
  return labeled >= 3 ? turns : null;
}

/** Split prose into paragraph blocks (blank-line separated, falling back to
 *  sentence grouping when there are no paragraph breaks). */
function proseBlocks(content: string): string[] {
  const paras = content
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  if (paras.length > 1) return paras;
  // Single blob: group into ~3-sentence blocks so exchanges stay bounded.
  const sentences = (content.replace(/\s+/g, " ").trim().match(/[^.!?]+[.!?]+|\S+$/g) ?? []).map((s) =>
    s.trim(),
  );
  const blocks: string[] = [];
  for (let i = 0; i < sentences.length; i += 3) {
    blocks.push(sentences.slice(i, i + 3).join(" "));
  }
  return blocks.filter(Boolean);
}

/**
 * Deterministically segment a cleared coaching source into member-prompt +
 * coach-response EXCHANGES. Two shapes are handled:
 *  - speaker-labeled dialogue ("Name: …") — a question-like turn opens an
 *    exchange, following turns become the response until the next question, and
 *  - prose (the Transcript Cleaner's structured output) — a question-like
 *    paragraph opens an exchange; non-question paragraphs are responses. Prose
 *    with no questions yields coach-response-only exchanges (empty prompt).
 */
export function segmentExchanges(content: string): Exchange[] {
  const raw = (content || "").trim();
  if (!raw) return [];

  const turns = parseDialogueTurns(raw);
  const exchanges: Exchange[] = [];

  if (turns) {
    let prompt = "";
    let response: string[] = [];
    const flush = () => {
      if (prompt || response.length) {
        exchanges.push({
          orderIndex: exchanges.length,
          memberPrompt: prompt.trim(),
          coachResponse: response.join(" ").trim(),
        });
      }
      prompt = "";
      response = [];
    };
    for (const turn of turns) {
      if (looksLikeQuestion(turn.text)) {
        // A new question opens a new exchange.
        flush();
        prompt = turn.text;
      } else {
        response.push(turn.text);
      }
    }
    flush();
    return exchanges.map((e, i) => ({ ...e, orderIndex: i }));
  }

  // Prose path.
  const blocks = proseBlocks(raw);
  let prompt = "";
  let response: string[] = [];
  const flush = () => {
    if (prompt || response.length) {
      exchanges.push({
        orderIndex: exchanges.length,
        memberPrompt: prompt.trim(),
        coachResponse: response.join(" ").trim(),
      });
    }
    prompt = "";
    response = [];
  };
  for (const block of blocks) {
    if (looksLikeQuestion(block)) {
      flush();
      prompt = block;
    } else {
      response.push(block);
      // A response-only stretch is a complete unit once it has content and the
      // next block would start fresh; keep accumulating until a question.
    }
  }
  flush();

  // If prose produced one giant response-only unit, keep the per-block units
  // instead so downstream classification stays granular.
  if (exchanges.length === 1 && !exchanges[0].memberPrompt && blocks.length > 1) {
    return blocks.map((b, i) => ({ orderIndex: i, memberPrompt: "", coachResponse: b }));
  }
  return exchanges.map((e, i) => ({ ...e, orderIndex: i }));
}

/**
 * Deterministic fingerprint of the ACTIVE calibration exemplar set — the
 * "version" stamped onto each screening. Adding/removing/toggling an exemplar
 * changes this, invalidating prior screenings so they re-run against the new
 * calibration. Order-independent (sorted). Empty set → a stable cold constant.
 */
export function computeCalibrationVersion(examples: Pick<KbCalibrationExample, "id" | "label" | "valueType" | "memberPrompt" | "coachResponse">[]): string {
  const active = [...examples].sort((a, b) => a.id - b.id);
  if (active.length === 0) return "cold-v1";
  const canonical = active
    .map((e) => `${e.id}|${e.label}|${e.valueType ?? ""}|${e.memberPrompt}|${e.coachResponse}`)
    .join("\n");
  return "cal-" + fingerprintContent(canonical).slice(0, 16);
}

/** The disposition that downstream reads honor: an admin overrule wins over the
 *  AI verdict. */
export function effectiveDisposition(row: { disposition: string; overrideDisposition: string | null }): string {
  return row.overrideDisposition ?? row.disposition;
}

// ── LLM classification ──────────────────────────────────────────────────────

interface ExchangeClassification {
  valueType: ValueType;
  disposition: Disposition;
  dropReason: string | null;
  situationalNumber: boolean;
  rationale: string;
}

const COLD_RUBRIC = `You screen exchanges from a Build Test Scale (BTS) affiliate-marketing COACHING CALL for durable teaching value, to decide what belongs in the knowledge base.

Each exchange is a MEMBER prompt (may be empty) plus the COACH response.

Classify the exchange:
- valueType: one of ${VALUE_TYPES.join(", ")}.
- disposition:
  - "keep": durable, generalizable teaching — a principle, framework, repeatable process/step, decision criteria, a worked example that illustrates a general method, or a troubleshooting pattern that recurs.
  - "drop": no durable value — greetings/scheduling/logistics, pure encouragement with no substance, off-topic chit-chat, or an answer that ONLY makes sense for this one member's private situation with no extractable general lesson.
  - "flag": genuinely borderline or you are unsure. IMPORTANT: never "drop" something that MIGHT be valuable — when in doubt use "flag". Minimizing false drops matters more than minimizing flags.
- situationalNumber: true when the answer is anchored to THIS member's specific numbers or account state (their spend, their ROI, their specific campaign) such that it is context-bound rather than a general lesson. This can be true even for a "keep" (a good worked example) — it is an independent signal, not the same as "drop".
- dropReason: a short reason, required when disposition is "drop" or "flag"; null for "keep".
- rationale: one concise sentence explaining the call.`;

/** Build the few-shot block from the active calibration set (gold = keep-worthy,
 *  noise = drop-worthy). Capped so the prompt stays bounded. */
function buildFewShot(examples: KbCalibrationExample[]): string {
  if (examples.length === 0) return "";
  const cap = 24;
  const gold = examples.filter((e) => e.label === "gold").slice(0, cap / 2);
  const noise = examples.filter((e) => e.label === "noise").slice(0, cap / 2);
  const fmt = (e: KbCalibrationExample, verdict: string) =>
    `- verdict=${verdict}${e.valueType ? ` valueType=${e.valueType}` : ""}\n  MEMBER: ${e.memberPrompt || "(none)"}\n  COACH: ${e.coachResponse.slice(0, 400)}`;
  const lines: string[] = ["\nCALIBRATION EXAMPLES (this team's judgement — weight these heavily):"];
  for (const e of gold) lines.push(fmt(e, "keep"));
  for (const e of noise) lines.push(fmt(e, "drop"));
  return lines.join("\n");
}

/**
 * Classify a batch of exchanges in one LLM call (JSON mode). Returns a
 * per-exchange classification aligned to the input order. On any parse/shape
 * failure the affected exchange defaults to a conservative "flag" (never a
 * silent drop).
 */
export async function classifyExchanges(
  exchanges: Exchange[],
  calibration: KbCalibrationExample[],
): Promise<ExchangeClassification[]> {
  if (exchanges.length === 0) return [];

  const system = COLD_RUBRIC + buildFewShot(calibration) + `

Return STRICT JSON: {"results":[{"index":<0-based>,"valueType":"...","disposition":"keep|drop|flag","situationalNumber":true|false,"dropReason":"..."|null,"rationale":"..."}]}. Return exactly one result per input exchange, same order.`;

  const user =
    "Classify these exchanges:\n\n" +
    exchanges
      .map(
        (e, i) =>
          `[${i}] MEMBER: ${e.memberPrompt || "(none)"}\n    COACH: ${e.coachResponse.slice(0, 1500)}`,
      )
      .join("\n\n");

  const fallback = (): ExchangeClassification => ({
    valueType: "unclassified",
    disposition: "flag",
    dropReason: "classifier unavailable — needs human review",
    situationalNumber: false,
    rationale: "Automatic fallback: the classifier did not return a usable verdict.",
  });

  let parsed: { results?: Array<Record<string, unknown>> };
  try {
    const raw = await callLLM(system, user, Math.min(8000, 400 + exchanges.length * 160), true);
    parsed = JSON.parse(raw);
  } catch {
    return exchanges.map(fallback);
  }

  const byIndex = new Map<number, Record<string, unknown>>();
  for (const r of parsed.results ?? []) {
    const idx = typeof r.index === "number" ? r.index : Number(r.index);
    if (Number.isInteger(idx)) byIndex.set(idx, r);
  }

  return exchanges.map((_, i) => {
    const r = byIndex.get(i);
    if (!r) return fallback();
    const disposition = isDisposition(r.disposition) ? r.disposition : "flag";
    const valueType = isValueType(r.valueType) ? r.valueType : "unclassified";
    const situationalNumber = r.situationalNumber === true;
    const rationale = typeof r.rationale === "string" ? r.rationale.slice(0, 500) : "";
    let dropReason: string | null =
      typeof r.dropReason === "string" && r.dropReason.trim() ? r.dropReason.trim().slice(0, 500) : null;
    if (disposition !== "keep" && !dropReason) {
      dropReason = disposition === "drop" ? "no durable value" : "borderline — needs review";
    }
    if (disposition === "keep") dropReason = null;
    return { valueType, disposition, dropReason, situationalNumber, rationale };
  });
}

// ── Calibration set ─────────────────────────────────────────────────────────

export async function loadActiveCalibration(): Promise<KbCalibrationExample[]> {
  return db
    .select()
    .from(kbCalibrationExamplesTable)
    .where(eq(kbCalibrationExamplesTable.active, true))
    .orderBy(desc(kbCalibrationExamplesTable.createdAt));
}

export async function getCalibrationVersion(): Promise<string> {
  return computeCalibrationVersion(await loadActiveCalibration());
}

// ── Dedup ───────────────────────────────────────────────────────────────────

interface CorpusDoc {
  id: number;
  content: string;
  normalizedHash: string;
  shingles: Set<string>;
}

interface DedupVerdict {
  status: DedupStatus;
  duplicateOfSourceId: number | null;
  similarityScore: number | null; // 0..1000
}

/** Compare a source against the rest of the coaching corpus. `others` excludes
 *  the source itself. */
export function detectDuplicate(self: CorpusDoc, others: CorpusDoc[]): DedupVerdict {
  for (const o of others) {
    if (o.normalizedHash === self.normalizedHash) {
      return { status: "exact_duplicate", duplicateOfSourceId: o.id, similarityScore: 1000 };
    }
  }
  let best = 0;
  let bestId: number | null = null;
  for (const o of others) {
    const sim = jaccardSimilarity(self.shingles, o.shingles);
    if (sim > best) {
      best = sim;
      bestId = o.id;
    }
  }
  if (bestId !== null && best >= NEAR_DUP_THRESHOLD) {
    return { status: "near_duplicate", duplicateOfSourceId: bestId, similarityScore: Math.round(best * 1000) };
  }
  return { status: "unique", duplicateOfSourceId: null, similarityScore: null };
}

// ── Orchestration ───────────────────────────────────────────────────────────

export interface ScreenSourceResult {
  sourceDocId: number;
  screeningId: number;
  skipped: boolean;
  dedupStatus: DedupStatus;
  exchangeCount: number;
  keptCount: number;
  droppedCount: number;
  flaggedCount: number;
}

/** Load the coaching-source corpus (id + content) used for dedup comparison. */
async function loadCoachingCorpus(): Promise<CorpusDoc[]> {
  const rows = await db
    .select({ id: aiSourceDocumentsTable.id, content: aiSourceDocumentsTable.content })
    .from(aiSourceDocumentsTable)
    .where(inArray(aiSourceDocumentsTable.sourceType, SCREENER_SOURCE_FOLDERS));
  return rows.map((r) => ({
    id: r.id,
    content: r.content,
    normalizedHash: exactDedupHash(r.content),
    shingles: contentShingles(r.content),
  }));
}

/**
 * Screen a single source. Idempotent + cache-aware: if a screening already
 * exists whose content fingerprint AND calibration version both still match, it
 * is a no-op (skipped) unless `force`. Persists the whole screened output
 * (kept + dropped exchanges) transactionally.
 */
export async function screenSource(opts: {
  sourceDocId: number;
  calibration: KbCalibrationExample[];
  calibrationVersion: string;
  scrubber: MemberPiiScrubber;
  corpus: CorpusDoc[];
  force?: boolean;
}): Promise<ScreenSourceResult> {
  const { sourceDocId, calibration, calibrationVersion, scrubber, corpus, force } = opts;

  const [source] = await db
    .select({ id: aiSourceDocumentsTable.id, content: aiSourceDocumentsTable.content })
    .from(aiSourceDocumentsTable)
    .where(eq(aiSourceDocumentsTable.id, sourceDocId));
  if (!source) throw new Error(`Source document ${sourceDocId} not found`);

  const contentFingerprint = fingerprintContent(source.content);

  const [existing] = await db
    .select()
    .from(kbCallScreeningsTable)
    .where(eq(kbCallScreeningsTable.sourceDocId, sourceDocId));

  if (
    existing &&
    !force &&
    existing.contentFingerprint === contentFingerprint &&
    existing.calibrationVersion === calibrationVersion
  ) {
    return {
      sourceDocId,
      screeningId: existing.id,
      skipped: true,
      dedupStatus: existing.dedupStatus as DedupStatus,
      exchangeCount: existing.exchangeCount,
      keptCount: existing.keptCount,
      droppedCount: existing.droppedCount,
      flaggedCount: existing.flaggedCount,
    };
  }

  const self: CorpusDoc = {
    id: sourceDocId,
    content: source.content,
    normalizedHash: exactDedupHash(source.content),
    shingles: contentShingles(source.content),
  };
  const dedup = detectDuplicate(self, corpus.filter((c) => c.id !== sourceDocId));

  // A whole-source duplicate is not re-mined into exchanges: record the verdict
  // and store zero exchanges (nothing new to add downstream), but keep the row
  // for audit. Unique + near-dup sources are still segmented + classified
  // (near-dup is a soft signal for the admin, not an auto-skip).
  const exchanges = dedup.status === "exact_duplicate" ? [] : segmentExchanges(source.content);

  const classifications = await classifyExchanges(exchanges, calibration);

  let kept = 0;
  let dropped = 0;
  let flagged = 0;
  const rows = exchanges.map((ex, i) => {
    const c = classifications[i];
    if (c.disposition === "keep") kept++;
    else if (c.disposition === "drop") dropped++;
    else flagged++;
    // PII backstop: scrub member names out of KEPT + flagged text (the material
    // that may flow downstream / be shown). Dropped text is retained verbatim
    // for audit but also scrubbed so no member PII lingers in the store.
    return {
      orderIndex: ex.orderIndex,
      memberPrompt: scrubber.scrub(ex.memberPrompt),
      coachResponse: scrubber.scrub(ex.coachResponse),
      valueType: c.valueType,
      disposition: c.disposition,
      dropReason: c.dropReason,
      situationalNumber: c.situationalNumber,
      rationale: c.rationale,
    };
  });

  const screeningId = await db.transaction(async (tx) => {
    // Replace any prior screening for this source (re-run supersedes).
    if (existing) {
      await tx.delete(kbCallScreeningsTable).where(eq(kbCallScreeningsTable.id, existing.id));
    }
    const [screening] = await tx
      .insert(kbCallScreeningsTable)
      .values({
        sourceDocId,
        contentFingerprint,
        calibrationVersion,
        dedupStatus: dedup.status,
        normalizedHash: self.normalizedHash,
        duplicateOfSourceId: dedup.duplicateOfSourceId,
        similarityScore: dedup.similarityScore,
        exchangeCount: exchanges.length,
        keptCount: kept,
        droppedCount: dropped,
        flaggedCount: flagged,
      })
      .returning({ id: kbCallScreeningsTable.id });

    if (rows.length > 0) {
      await tx.insert(kbScreenedExchangesTable).values(
        rows.map((r) => ({ ...r, screeningId: screening.id, sourceDocId })),
      );
    }
    return screening.id;
  });

  return {
    sourceDocId,
    screeningId,
    skipped: false,
    dedupStatus: dedup.status,
    exchangeCount: exchanges.length,
    keptCount: kept,
    droppedCount: dropped,
    flaggedCount: flagged,
  };
}

/**
 * The SCREENED REPRESENTATION a later topic-index/extract phase (Task 2) reads:
 * the KEPT (effective-disposition) exchanges of a source, member-PII already
 * scrubbed, concatenated in order. Returns null when the source was never
 * screened (caller should fall back to raw only deliberately). This is the
 * documented seam of the design decision — raw content stays untouched for audit.
 */
export async function getScreenedRepresentation(sourceDocId: number): Promise<string | null> {
  const [screening] = await db
    .select({ id: kbCallScreeningsTable.id })
    .from(kbCallScreeningsTable)
    .where(eq(kbCallScreeningsTable.sourceDocId, sourceDocId));
  if (!screening) return null;

  const rows = await db
    .select()
    .from(kbScreenedExchangesTable)
    .where(eq(kbScreenedExchangesTable.screeningId, screening.id))
    .orderBy(kbScreenedExchangesTable.orderIndex);

  const kept = rows.filter((r) => effectiveDisposition(r) === "keep");
  return kept
    .map((r) => (r.memberPrompt ? `Q: ${r.memberPrompt}\nA: ${r.coachResponse}` : r.coachResponse))
    .join("\n\n");
}

// ── Background pilot runner ──────────────────────────────────────────────────

export interface ScreenerProgress {
  running: boolean;
  total: number;
  processed: number;
  kept: number;
  dropped: number;
  flagged: number;
  duplicates: number;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
}

let _state: ScreenerProgress = {
  running: false,
  total: 0,
  processed: 0,
  kept: 0,
  dropped: 0,
  flagged: 0,
  duplicates: 0,
  startedAt: null,
  finishedAt: null,
  error: null,
};

export function getScreenerState(): ScreenerProgress {
  return { ..._state };
}
export function isScreenerRunning(): boolean {
  return _state.running;
}

/**
 * Screen a chosen SUBSET of sources in the background (the pilot). Fire-and-
 * forget; progress is polled via getScreenerState.
 */
export async function screenSourcesBackground(sourceDocIds: number[], opts: { force?: boolean } = {}): Promise<void> {
  if (_state.running) return;
  _state = {
    running: true,
    total: sourceDocIds.length,
    processed: 0,
    kept: 0,
    dropped: 0,
    flagged: 0,
    duplicates: 0,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    error: null,
  };

  try {
    const calibration = await loadActiveCalibration();
    const calibrationVersion = computeCalibrationVersion(calibration);
    const scrubber = await loadMemberPiiScrubber();
    const corpus = await loadCoachingCorpus();

    // Concurrency 2 to be gentle on the LLM endpoint.
    await mapWithConcurrency(sourceDocIds, 2, async (id) => {
      try {
        const r = await screenSource({
          sourceDocId: id,
          calibration,
          calibrationVersion,
          scrubber,
          corpus,
          force: opts.force,
        });
        _state.kept += r.keptCount;
        _state.dropped += r.droppedCount;
        _state.flagged += r.flaggedCount;
        if (r.dedupStatus !== "unique") _state.duplicates += 1;
      } catch (err) {
        // Per-source failure should not abort the whole pilot.
        _state.error = err instanceof Error ? err.message : "Unknown error";
      } finally {
        _state.processed += 1;
      }
      return null;
    });
  } catch (err) {
    _state.error = err instanceof Error ? err.message : "Unknown error";
  } finally {
    _state.running = false;
    _state.finishedAt = new Date().toISOString();
  }
}
