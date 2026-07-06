import { db } from "@workspace/db";
import {
  aiSourceDocumentsTable,
  kbCallScreeningsTable,
  kbScreenedExchangesTable,
} from "@workspace/db/schema";
import { eq, inArray } from "drizzle-orm";
import { createHash } from "crypto";
import { callLLM } from "./kb-synthesis.js";
import { fingerprintContent } from "./kb-source-windows.js";
import { SOURCE_FOLDERS } from "./kb-taxonomy.js";

/**
 * Coaching-transcript VALUE SCREENER (Task #1702, refined #1707).
 *
 * A RECALL-BIASED de-noiser/flagger that sits BETWEEN the existing source-level
 * screening/mining gates and the synthesis engine (synthesis is NOT modified).
 * It is deliberately NOT a "gold picker": its job is to strip confidently
 * worthless noise and surface anything uncertain for a human — never to hunt for
 * only the best moments. For each already-cleared coaching-call source it:
 *   1. DEDUP gate — flags a source ONLY when it is a near-identical WHOLE call
 *      (a re-upload of an earlier call). Topical overlap across distinct calls
 *      is NOT a duplicate.
 *   2. TOPIC-THREADED segmentation — groups the call into multi-turn segments
 *      that keep a topic (question + answer + follow-ups) together, preserving
 *      speaker roles, instead of fragmenting it into per-question atoms.
 *   3. LLM value screen per segment with a recall-biased rubric: KEEP anything
 *      plausibly instructional, DROP only confidently worthless chatter, FLAG
 *      the genuinely uncertain. Situational-number / time-sensitive answers are
 *      flagged (the `situationalNumber` signal) and KEPT with their context,
 *      never silently dropped.
 *   4. Reliability — segments are classified in small isolated chunks with
 *      retries; a segment whose classification truly fails after retries gets a
 *      distinct "error" disposition (NOT a fake "flag"), so a single failure
 *      never cascades into dropping real content.
 *   5. Durable screened-output store (kept + dropped + flagged + errored, with
 *      reasons) stamped with a per-source content fingerprint for cache reuse.
 *
 * DESIGN DECISION (documented, not asked): the screened, de-duplicated
 * representation (the KEPT segments) is what the later topic-index/extract phase
 * reads; the raw ai_source_documents.content is retained untouched for audit.
 * Member-PII scrubbing and coach-name handling live in the downstream review
 * gate, NOT here. Nothing here is auto-published. See getScreenedRepresentation.
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

// "error" is a RELIABILITY status (classification failed after retries), kept
// distinct from the genuine keep/drop/flag verdicts so a failure is never
// mistaken for a real "drop this" or "review this" decision.
export const DISPOSITIONS = ["keep", "drop", "flag", "error"] as const;
export type Disposition = (typeof DISPOSITIONS)[number];

export const DEDUP_STATUSES = ["unique", "exact_duplicate", "near_duplicate"] as const;
export type DedupStatus = (typeof DEDUP_STATUSES)[number];

// The coaching source folders this screener operates over (cleared coaching
// calls only — Blitz video / reference docs / VA transcripts are out of scope).
export const SCREENER_SOURCE_FOLDERS = SOURCE_FOLDERS.filter(
  (f) => f.slug === "group_coaching" || f.slug === "private_coaching",
).map((f) => f.slug);

// Near-duplicate similarity threshold (Jaccard over word 5-shingles). Set HIGH
// so only a near-verbatim re-upload of the SAME whole call trips it; two
// distinct calls that merely cover the same topic score well below this.
const NEAR_DUP_THRESHOLD = 0.9;
// A near-duplicate must also be a comparable-LENGTH whole call, not a short
// excerpt that happens to overlap. Guards against subset/superset false hits.
const NEAR_DUP_MIN_LENGTH_RATIO = 0.6;

// Topic-thread sizing (characters). A new member turn only starts a NEW segment
// once the current one has a coach response and has grown past MIN — so short
// follow-ups stay threaded with their topic. MAX caps runaway monologues so a
// no-question transcript still splits into auditable, droppable chunks.
const DEFAULT_MIN_SEGMENT_CHARS = 600;
const DEFAULT_MAX_SEGMENT_CHARS = 2500;

// Reliability knobs for LLM classification.
export const CLASSIFY_CHUNK_SIZE = 8;
const CLASSIFY_MAX_ATTEMPTS = 3;
const CLASSIFY_RETRY_BASE_MS = 200;

// ── Pure helpers (unit-tested) ──────────────────────────────────────────────

const isValueType = (v: unknown): v is ValueType =>
  typeof v === "string" && (VALUE_TYPES as readonly string[]).includes(v);
const isDisposition = (v: unknown): v is Disposition =>
  typeof v === "string" && (DISPOSITIONS as readonly string[]).includes(v);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

type Role = "member" | "coach";

/** A topic-threaded segment: the member turns (context) and the coach turns
 *  (teaching) for one coherent stretch of the call. Roles are preserved. */
export interface Segment {
  orderIndex: number;
  memberPrompt: string;
  coachResponse: string;
}

interface RoledTurn {
  role: Role;
  text: string;
}

/** Infer whether a turn is the member or the coach speaking. Prefers an
 *  explicit speaker label, falling back to question-likeness. */
function inferRole(speaker: string | null, text: string): Role {
  const s = (speaker || "").toLowerCase();
  if (/\b(coach|mentor|instructor|host|trainer|facilitator|teacher|expert)\b/.test(s)) return "coach";
  if (/\b(member|student|mentee|guest|caller|attendee|participant|question|audience)\b/.test(s)) return "member";
  return looksLikeQuestion(text) ? "member" : "coach";
}

/** Parse speaker-labeled dialogue lines into roled turns; returns null when the
 *  content is not speaker-labeled (fewer than 3 labeled lines). */
function parseDialogueTurns(content: string): RoledTurn[] | null {
  const lines = content.split(/\r?\n/);
  let labeled = 0;
  const raw: { speaker: string | null; text: string }[] = [];
  for (const line of lines) {
    const m = line.match(SPEAKER_LINE);
    if (m) {
      labeled++;
      raw.push({ speaker: m[1].trim(), text: m[2].trim() });
    } else if (line.trim()) {
      // Continuation of the previous turn (wrapped line).
      if (raw.length > 0) raw[raw.length - 1].text += " " + line.trim();
      else raw.push({ speaker: null, text: line.trim() });
    }
  }
  if (labeled < 3) return null;
  return raw.map((t) => ({ role: inferRole(t.speaker, t.text), text: t.text }));
}

/** Split prose into paragraph blocks (blank-line separated, falling back to
 *  sentence grouping when there are no paragraph breaks). */
function proseBlocks(content: string): string[] {
  const paras = content
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  if (paras.length > 1) return paras;
  // Single blob: group into ~3-sentence blocks so segments stay bounded.
  const sentences = (content.replace(/\s+/g, " ").trim().match(/[^.!?]+[.!?]+|\S+$/g) ?? []).map((s) =>
    s.trim(),
  );
  const blocks: string[] = [];
  for (let i = 0; i < sentences.length; i += 3) {
    blocks.push(sentences.slice(i, i + 3).join(" "));
  }
  return blocks.filter(Boolean);
}

/** Group roled turns into topic-threaded segments. A member turn opens a NEW
 *  segment only once the current one already holds a coach response and has
 *  grown past `minChars`; a hard `maxChars` cap forces a split at any boundary
 *  so runaway monologues still break into auditable chunks. */
function groupTurnsIntoSegments(turns: RoledTurn[], minChars: number, maxChars: number): Segment[] {
  const segments: Segment[] = [];
  let memberParts: string[] = [];
  let coachParts: string[] = [];
  let chars = 0;
  let hasCoach = false;

  const flush = () => {
    if (memberParts.length || coachParts.length) {
      segments.push({
        orderIndex: segments.length,
        memberPrompt: memberParts.join(" ").trim(),
        coachResponse: coachParts.join(" ").trim(),
      });
    }
    memberParts = [];
    coachParts = [];
    chars = 0;
    hasCoach = false;
  };

  for (const t of turns) {
    if (!t.text) continue;
    const hasContent = memberParts.length > 0 || coachParts.length > 0;
    const memberOpensNewTopic = t.role === "member" && hasCoach && chars >= minChars;
    const overHardCap = hasContent && chars >= maxChars;
    if (memberOpensNewTopic || overHardCap) flush();

    if (t.role === "member") memberParts.push(t.text);
    else {
      coachParts.push(t.text);
      hasCoach = true;
    }
    chars += t.text.length;
  }
  flush();
  return segments.map((s, i) => ({ ...s, orderIndex: i }));
}

/**
 * Deterministically split a cleared coaching source into TOPIC-THREADED
 * segments (member context + coach teaching), preserving speaker roles. Two
 * shapes are handled:
 *  - speaker-labeled dialogue ("Name: …") — turns are role-tagged and threaded, and
 *  - prose (the Transcript Cleaner's structured output) — paragraphs are
 *    role-tagged (question-like → member) and threaded the same way.
 * A topic (question + answer + follow-ups) stays in ONE segment rather than
 * being fragmented into per-question atoms.
 */
export function segmentTranscript(
  content: string,
  opts: { minChars?: number; maxChars?: number } = {},
): Segment[] {
  const raw = (content || "").trim();
  if (!raw) return [];
  const minChars = opts.minChars ?? DEFAULT_MIN_SEGMENT_CHARS;
  const maxChars = opts.maxChars ?? DEFAULT_MAX_SEGMENT_CHARS;

  const dialogue = parseDialogueTurns(raw);
  const turns: RoledTurn[] = dialogue
    ? dialogue
    : proseBlocks(raw).map((b) => ({ role: looksLikeQuestion(b) ? "member" : "coach", text: b }) as RoledTurn);

  return groupTurnsIntoSegments(turns, minChars, maxChars);
}

/** The disposition that downstream reads honor: an admin overrule wins over the
 *  AI verdict. */
export function effectiveDisposition(row: { disposition: string; overrideDisposition: string | null }): string {
  return row.overrideDisposition ?? row.disposition;
}

// ── LLM classification ──────────────────────────────────────────────────────

interface SegmentClassification {
  valueType: ValueType;
  disposition: Disposition;
  dropReason: string | null;
  situationalNumber: boolean;
  rationale: string;
}

const SCREENER_RUBRIC = `You screen segments of a Build Test Scale (BTS) affiliate-marketing COACHING CALL to strip out confidently worthless noise before the knowledge base indexes them.

Each segment is a topic thread: a MEMBER prompt/context (may be empty) plus the COACH response(s) on that topic.

YOUR BIAS: this is a RECALL-FIRST de-noiser, NOT a "best moments" picker. Keep anything that is plausibly instructional. Only drop what is confidently, obviously worthless. False DROPS are far worse than keeping something mediocre — when unsure, KEEP; only when you genuinely cannot tell, FLAG.

Classify each segment:
- valueType: one of ${VALUE_TYPES.join(", ")}.
- disposition:
  - "keep": has ANY plausible durable teaching value — a principle, framework, process/step, decision criteria, worked example, troubleshooting pattern, useful resource pointer, or even partial/rough guidance. This is the DEFAULT.
  - "drop": ONLY for content that is confidently worthless with no teaching value at all — greetings, scheduling/logistics, "can you hear me"/tech checks, pure filler encouragement, or off-topic chit-chat. If it teaches anything, do NOT drop it.
  - "flag": you genuinely cannot tell whether it has value. Use sparingly.
- situationalNumber: true when the answer is anchored to a time-sensitive detail OR to THIS member's specific numbers/account state (their spend, ROI, a current platform rule, a "right now" tactic). Such content is still KEPT (usually "keep", never a silent "drop") but marked so a human sees its context-bound nature. This is an INDEPENDENT signal.
- dropReason: a short reason, required when disposition is "drop" or "flag"; null for "keep".
- rationale: one concise sentence explaining the call.`;

const errorClassification = (reason: string): SegmentClassification => ({
  valueType: "unclassified",
  disposition: "error",
  dropReason: reason,
  situationalNumber: false,
  rationale: "The classifier did not return a usable verdict for this segment — needs a re-run.",
});

/** Coerce one raw LLM result into a recall-biased classification. A result that
 *  came back but is malformed defaults to "flag" (a human decision), NEVER an
 *  automatic drop and NEVER "error" (which is reserved for true failures). */
function normalizeResult(r: Record<string, unknown>): SegmentClassification {
  // The model must never assign the reliability status itself.
  const disposition: Disposition =
    isDisposition(r.disposition) && r.disposition !== "error" ? r.disposition : "flag";
  const valueType = isValueType(r.valueType) ? r.valueType : "unclassified";
  const situationalNumber =
    r.situationalNumber === true || r.timeSensitive === true || r.situational === true;
  const rationale = typeof r.rationale === "string" ? r.rationale.slice(0, 500) : "";
  let dropReason: string | null =
    typeof r.dropReason === "string" && r.dropReason.trim() ? r.dropReason.trim().slice(0, 500) : null;
  if (disposition === "keep") dropReason = null;
  else if (!dropReason) dropReason = disposition === "drop" ? "confidently low value (logistics/chatter)" : "borderline — needs review";
  return { valueType, disposition, dropReason, situationalNumber, rationale };
}

/** Classify ONE chunk in a single LLM call, with retries. Returns a map from
 *  the chunk-local index to its classification (only for indices the model
 *  actually returned). Throws if every attempt fails. */
async function classifyChunk(chunk: Segment[]): Promise<Map<number, SegmentClassification>> {
  const system =
    SCREENER_RUBRIC +
    `

Return STRICT JSON: {"results":[{"index":<0-based>,"valueType":"...","disposition":"keep|drop|flag","situationalNumber":true|false,"dropReason":"..."|null,"rationale":"..."}]}. Return exactly one result per input segment, same order.`;

  const user =
    "Screen these segments:\n\n" +
    chunk
      .map(
        (s, i) => `[${i}] MEMBER: ${s.memberPrompt || "(none)"}\n    COACH: ${s.coachResponse.slice(0, 1800)}`,
      )
      .join("\n\n");

  let lastErr: unknown;
  for (let attempt = 1; attempt <= CLASSIFY_MAX_ATTEMPTS; attempt++) {
    try {
      const rawResp = await callLLM(system, user, Math.min(4000, 300 + chunk.length * 180), true);
      const parsed = JSON.parse(rawResp) as { results?: unknown };
      const results = Array.isArray(parsed.results) ? parsed.results : null;
      if (!results) throw new Error("classifier response missing results array");
      const map = new Map<number, SegmentClassification>();
      for (const item of results) {
        if (!item || typeof item !== "object") continue;
        const r = item as Record<string, unknown>;
        const idx = typeof r.index === "number" ? r.index : Number(r.index);
        if (!Number.isInteger(idx) || idx < 0 || idx >= chunk.length) continue;
        map.set(idx, normalizeResult(r));
      }
      if (map.size === 0) throw new Error("classifier returned no usable results");
      return map;
    } catch (err) {
      lastErr = err;
      if (attempt < CLASSIFY_MAX_ATTEMPTS) await sleep(CLASSIFY_RETRY_BASE_MS * attempt);
    }
  }
  throw lastErr ?? new Error("classification failed");
}

/**
 * Classify segments reliably: process them in small ISOLATED chunks so one bad
 * chunk cannot poison the rest. A chunk that fails all retries, or a single
 * segment the model omits from an otherwise-good response, is marked with the
 * distinct "error" disposition (never a silent drop, never a fake "flag").
 */
export async function classifySegments(segments: Segment[]): Promise<SegmentClassification[]> {
  if (segments.length === 0) return [];
  const out: SegmentClassification[] = new Array(segments.length);

  for (let start = 0; start < segments.length; start += CLASSIFY_CHUNK_SIZE) {
    const chunk = segments.slice(start, start + CLASSIFY_CHUNK_SIZE);
    let map: Map<number, SegmentClassification> | null = null;
    try {
      map = await classifyChunk(chunk);
    } catch {
      map = null; // whole chunk failed after retries — isolate to these segments
    }
    for (let j = 0; j < chunk.length; j++) {
      const global = start + j;
      if (map && map.has(j)) out[global] = map.get(j)!;
      else
        out[global] = errorClassification(
          map === null ? "classifier error after retries" : "classifier omitted this segment",
        );
    }
  }
  return out;
}

// ── Dedup ───────────────────────────────────────────────────────────────────

interface CorpusDoc {
  id: number;
  content: string;
  length: number;
  normalizedHash: string;
  shingles: Set<string>;
}

interface DedupVerdict {
  status: DedupStatus;
  duplicateOfSourceId: number | null;
  similarityScore: number | null; // 0..1000
}

/** Compare a source against the rest of the coaching corpus. `others` excludes
 *  the source itself. Only a near-VERBATIM re-upload of the same whole call is
 *  treated as a near-duplicate; distinct calls on the same topic stay unique. */
export function detectDuplicate(self: CorpusDoc, others: CorpusDoc[]): DedupVerdict {
  for (const o of others) {
    if (o.normalizedHash === self.normalizedHash) {
      return { status: "exact_duplicate", duplicateOfSourceId: o.id, similarityScore: 1000 };
    }
  }
  let best = 0;
  let bestId: number | null = null;
  for (const o of others) {
    // Require comparable length so a short excerpt can't near-match a full call.
    const lo = Math.min(self.length, o.length);
    const hi = Math.max(self.length, o.length);
    if (hi === 0 || lo / hi < NEAR_DUP_MIN_LENGTH_RATIO) continue;
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
  errorCount: number;
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
    length: normalizeForDedup(r.content).length,
    normalizedHash: exactDedupHash(r.content),
    shingles: contentShingles(r.content),
  }));
}

/**
 * Screen a single source. Idempotent + cache-aware: if a screening already
 * exists whose content fingerprint still matches, it is a no-op (skipped)
 * unless `force`. Persists the whole screened output (kept + dropped + flagged
 * + errored segments, with reasons) transactionally.
 */
export async function screenSource(opts: {
  sourceDocId: number;
  corpus: CorpusDoc[];
  force?: boolean;
}): Promise<ScreenSourceResult> {
  const { sourceDocId, corpus, force } = opts;

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

  if (existing && !force && existing.contentFingerprint === contentFingerprint) {
    const errorCount = Math.max(
      0,
      existing.exchangeCount - existing.keptCount - existing.droppedCount - existing.flaggedCount,
    );
    return {
      sourceDocId,
      screeningId: existing.id,
      skipped: true,
      dedupStatus: existing.dedupStatus as DedupStatus,
      exchangeCount: existing.exchangeCount,
      keptCount: existing.keptCount,
      droppedCount: existing.droppedCount,
      flaggedCount: existing.flaggedCount,
      errorCount,
    };
  }

  // Dedup verdict against the rest of the coaching corpus.
  const self: CorpusDoc = {
    id: source.id,
    content: source.content,
    length: normalizeForDedup(source.content).length,
    normalizedHash: exactDedupHash(source.content),
    shingles: contentShingles(source.content),
  };
  const others = corpus.filter((c) => c.id !== source.id);
  const dedup = detectDuplicate(self, others);

  // Segment + classify (skip classification for exact duplicates — the earlier
  // source already carries the content).
  const segments = dedup.status === "exact_duplicate" ? [] : segmentTranscript(source.content);
  const classifications = await classifySegments(segments);

  let keptCount = 0;
  let droppedCount = 0;
  let flaggedCount = 0;
  let errorCount = 0;
  for (const c of classifications) {
    if (c.disposition === "keep") keptCount++;
    else if (c.disposition === "drop") droppedCount++;
    else if (c.disposition === "flag") flaggedCount++;
    else errorCount++;
  }

  const screeningId = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(kbCallScreeningsTable)
      .values({
        sourceDocId,
        contentFingerprint,
        dedupStatus: dedup.status,
        normalizedHash: self.normalizedHash,
        duplicateOfSourceId: dedup.duplicateOfSourceId,
        similarityScore: dedup.similarityScore,
        exchangeCount: segments.length,
        keptCount,
        droppedCount,
        flaggedCount,
      })
      .onConflictDoUpdate({
        target: kbCallScreeningsTable.sourceDocId,
        set: {
          contentFingerprint,
          dedupStatus: dedup.status,
          normalizedHash: self.normalizedHash,
          duplicateOfSourceId: dedup.duplicateOfSourceId,
          similarityScore: dedup.similarityScore,
          exchangeCount: segments.length,
          keptCount,
          droppedCount,
          flaggedCount,
          updatedAt: new Date(),
        },
      })
      .returning({ id: kbCallScreeningsTable.id });

    // Replace any prior screened output for this source (re-run is authoritative).
    await tx.delete(kbScreenedExchangesTable).where(eq(kbScreenedExchangesTable.screeningId, row.id));

    if (segments.length > 0) {
      await tx.insert(kbScreenedExchangesTable).values(
        segments.map((s, i) => {
          const c = classifications[i];
          return {
            screeningId: row.id,
            sourceDocId,
            orderIndex: i,
            memberPrompt: s.memberPrompt,
            coachResponse: s.coachResponse,
            valueType: c.valueType,
            disposition: c.disposition,
            dropReason: c.dropReason,
            situationalNumber: c.situationalNumber,
            rationale: c.rationale,
          };
        }),
      );
    }
    return row.id;
  });

  return {
    sourceDocId,
    screeningId,
    skipped: false,
    dedupStatus: dedup.status,
    exchangeCount: segments.length,
    keptCount,
    droppedCount,
    flaggedCount,
    errorCount,
  };
}

/**
 * The screened representation a downstream reader consumes: the KEPT segments
 * (honoring admin overrides) joined back into a compact transcript. Dropped,
 * flagged, and errored segments are excluded. The raw source content is left
 * untouched for audit.
 */
export async function getScreenedRepresentation(sourceDocId: number): Promise<string> {
  const [screening] = await db
    .select()
    .from(kbCallScreeningsTable)
    .where(eq(kbCallScreeningsTable.sourceDocId, sourceDocId));
  if (!screening) return "";

  const rows = await db
    .select()
    .from(kbScreenedExchangesTable)
    .where(eq(kbScreenedExchangesTable.screeningId, screening.id))
    .orderBy(kbScreenedExchangesTable.orderIndex);

  return rows
    .filter((r) => effectiveDisposition(r) === "keep")
    .map((r) => (r.memberPrompt ? `Q: ${r.memberPrompt}\nA: ${r.coachResponse}` : r.coachResponse))
    .join("\n\n");
}

// ── Background pilot run state ───────────────────────────────────────────────

export interface ScreenerProgress {
  running: boolean;
  total: number;
  processed: number;
  kept: number;
  dropped: number;
  flagged: number;
  errors: number;
  duplicates: number;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
}

let state: ScreenerProgress = {
  running: false,
  total: 0,
  processed: 0,
  kept: 0,
  dropped: 0,
  flagged: 0,
  errors: 0,
  duplicates: 0,
  startedAt: null,
  finishedAt: null,
  error: null,
};

export function getScreenerState(): ScreenerProgress {
  return { ...state };
}

export function isScreenerRunning(): boolean {
  return state.running;
}

/**
 * Screen a chosen subset of sources in the background (fire-and-forget). Each
 * source is screened in isolation so one failure does not abort the run.
 */
export async function screenSourcesBackground(
  sourceDocIds: number[],
  opts: { force?: boolean } = {},
): Promise<void> {
  if (state.running) return;
  state = {
    running: true,
    total: sourceDocIds.length,
    processed: 0,
    kept: 0,
    dropped: 0,
    flagged: 0,
    errors: 0,
    duplicates: 0,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    error: null,
  };

  try {
    const corpus = await loadCoachingCorpus();
    for (const id of sourceDocIds) {
      try {
        const r = await screenSource({ sourceDocId: id, corpus, force: opts.force });
        state.kept += r.keptCount;
        state.dropped += r.droppedCount;
        state.flagged += r.flaggedCount;
        state.errors += r.errorCount;
        if (r.dedupStatus !== "unique") state.duplicates += 1;
      } catch (err) {
        // Isolate a per-source failure; keep going.
        state.error = err instanceof Error ? err.message : String(err);
      } finally {
        state.processed += 1;
      }
    }
  } catch (err) {
    state.error = err instanceof Error ? err.message : String(err);
  } finally {
    state.running = false;
    state.finishedAt = new Date().toISOString();
  }
}
