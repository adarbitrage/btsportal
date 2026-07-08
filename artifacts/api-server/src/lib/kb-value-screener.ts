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
// follow-ups stay threaded with their topic. Topic boundaries are the ONLY
// normal split trigger (Task #1742): a single coherent thread (member question
// → coach explanation → resolution) must live in ONE segment, never fragmented
// by a character count. The EMERGENCY ceiling below is a safety valve for
// pathological input only (unlabeled monologues, parser misreads): once a
// segment grows past it, it is closed at the next MEMBER-TURN boundary (never
// mid-sentence) and marked as an anomaly for auditability. A hard fallback at
// 1.5x the ceiling closes at ANY turn boundary so a member-less monologue
// cannot grow without bound (turn boundaries are sentence boundaries — the
// oversize-turn pre-split only cuts at sentence/paragraph ends).
const DEFAULT_MIN_SEGMENT_CHARS = 600;
const DEFAULT_EMERGENCY_SEGMENT_CHARS = 12000;
const EMERGENCY_HARD_FACTOR = 1.5;

// Reliability knobs for LLM classification. Chunks are bounded by BOTH a
// segment count and a total-passage char budget: with topic-threaded segments
// now allowed to grow to the emergency ceiling, eight ceiling-size segments
// would make one enormous prompt — the char budget keeps each classify call's
// input bounded regardless of segment size.
export const CLASSIFY_CHUNK_SIZE = 8;
export const CLASSIFY_CHUNK_CHAR_BUDGET = 30000;
// Per-segment passage cap in the classify prompt — must comfortably exceed the
// emergency ceiling so even an anomaly-size segment is classified on its FULL
// text, never a truncated view.
export const CLASSIFY_PASSAGE_MAX_CHARS = 13000;
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
// A bare speaker label on its OWN line (the Transcript Cleaner's real output
// format: "Coach" / "Member" alone on a line, speech on the following lines).
// An optional trailing colon is tolerated; no other punctuation.
const BARE_LABEL_LINE = /^\s*([\p{L}][\p{L} .'\-]{0,30}?):?\s*$/u;
// The cleaner's canonical speaker labels appearing INLINE inside a turn body —
// the fingerprint of a cleaner output that drifted mid-document into colon
// dialogue (Task #1746). Deliberately the CLOSED canonical set: matching
// arbitrary capitalized words would split on "Note:", "Warning:" etc.
const INLINE_SPEAKER_LABEL = /\b(Coach|Member|VA)\s*:\s*/g;
// A turn must contain at least this many inline labels before the repair
// fires: real drift stretches alternate speakers (the audited cases carried
// 3–64), while a single incidental "Coach:" inside quoted speech is left alone.
export const INLINE_LABEL_REPAIR_MIN = 2;

type Role = "member" | "coach";

/** A topic-threaded segment: ONE role-labeled transcript passage (inline
 *  "Coach:"/"Member:" speaker labels preserved) plus the member question that
 *  prompted the teaching (anchor context), when one exists. */
export interface Segment {
  orderIndex: number;
  // The full passage with inline speaker labels, one turn per line.
  passage: string;
  // The member question/context that opened this topic (null when none).
  anchorQuestion: string | null;
  // TRUE when the segment contains ONLY member speech (no coach turn) — used
  // by the Q/A pairing rule so an orphan question is never dropped
  // independently of its answer.
  memberOnly: boolean;
  // TRUE when this segment was closed by the EMERGENCY size ceiling (or still
  // overran it at the end of the transcript) rather than a topic boundary —
  // pathological-input territory, surfaced as an anomaly for auditability.
  emergencySplit: boolean;
}

export interface RoledTurn {
  role: Role;
  text: string;
}

/** Map an explicit speaker label to a role, or null when unrecognized. */
function roleFromLabel(speaker: string | null): Role | null {
  const s = (speaker || "").toLowerCase();
  if (/\b(coach|mentor|instructor|host|trainer|facilitator|teacher|expert)\b/.test(s)) return "coach";
  if (/\b(member|student|mentee|guest|caller|attendee|participant|question|audience)\b/.test(s)) return "member";
  return null;
}

/** Infer whether a turn is the member or the coach speaking. Prefers an
 *  explicit speaker label; question-likeness is a LAST resort for truly
 *  unlabeled prose. */
function inferRole(speaker: string | null, text: string): Role {
  return roleFromLabel(speaker) ?? (looksLikeQuestion(text) ? "member" : "coach");
}

/**
 * Parse the Transcript Cleaner's real output format: a bare speaker label
 * ("Coach" / "Member" / a name) on its OWN line, with the speech on the
 * following lines. Returns null when the content does not look bare-labeled:
 * we require at least 3 label lines AND every distinct label to either be a
 * recognized role word or recur (a one-off capitalized line is a heading, not
 * a speaker).
 */
export function parseBareLabelTurns(content: string): RoledTurn[] | null {
  const lines = content.split(/\r?\n/);

  // First pass: count how often each candidate bare-label line occurs. A real
  // speaker label recurs (Coach/Member alternate); a heading appears once.
  const occurrences = new Map<string, number>();
  for (const line of lines) {
    const m = line.match(BARE_LABEL_LINE);
    if (m) {
      const key = m[1].trim().toLowerCase();
      occurrences.set(key, (occurrences.get(key) ?? 0) + 1);
    }
  }
  const isLabelLine = (line: string): string | null => {
    const m = line.match(BARE_LABEL_LINE);
    if (!m) return null;
    const label = m[1].trim();
    if (roleFromLabel(label) !== null) return label;
    if ((occurrences.get(label.toLowerCase()) ?? 0) >= 2) return label;
    return null;
  };

  // Second pass: build turns.
  const turns: { speaker: string; parts: string[] }[] = [];
  let labeled = 0;
  for (const line of lines) {
    const label = isLabelLine(line);
    if (label !== null) {
      labeled++;
      turns.push({ speaker: label, parts: [] });
    } else if (line.trim()) {
      if (turns.length > 0) turns[turns.length - 1].parts.push(line.trim());
      // Preamble before the first label is kept as an unlabeled turn.
      else turns.push({ speaker: "", parts: [line.trim()] });
    }
  }
  if (labeled < 3) return null;
  return turns
    .map((t) => ({ speaker: t.speaker, text: t.parts.join(" ").trim() }))
    .filter((t) => t.text)
    .map((t) => ({ role: inferRole(t.speaker || null, t.text), text: t.text }));
}

/**
 * Defense-in-depth repair (Task #1746): a bare-label document whose cleaner
 * output drifted mid-transcript into inline colon dialogue parses as ONE giant
 * pseudo-turn with dozens of `Coach:`/`Member:` labels glued inside its body —
 * collapsing real turns (and every topic boundary) into a single blob. This
 * splits such a turn body back into proper roled turns at each inline canonical
 * label. Only fires when a turn carries at least {@link INLINE_LABEL_REPAIR_MIN}
 * inline labels (a lone incidental "Coach:" inside quoted speech is left alone).
 * Returns the repaired turns plus how many inline labels were split out, so the
 * caller can surface a LOUD anomaly signal instead of absorbing drift silently.
 */
export function repairInlineLabeledTurns(turns: RoledTurn[]): {
  turns: RoledTurn[];
  inlineLabelRepairCount: number;
} {
  const out: RoledTurn[] = [];
  let inlineLabelRepairCount = 0;
  for (const turn of turns) {
    const re = new RegExp(INLINE_SPEAKER_LABEL.source, "g");
    const matches = [...turn.text.matchAll(re)];
    if (matches.length < INLINE_LABEL_REPAIR_MIN) {
      out.push(turn);
      continue;
    }
    let last = 0;
    let role: Role = turn.role;
    for (const m of matches) {
      const before = turn.text.slice(last, m.index).trim();
      if (before) out.push({ role, text: before });
      // "VA" is an authority label; roleFromLabel doesn't know it.
      role = m[1] === "VA" ? "coach" : roleFromLabel(m[1]) ?? role;
      last = (m.index ?? 0) + m[0].length;
      inlineLabelRepairCount++;
    }
    const tail = turn.text.slice(last).trim();
    if (tail) out.push({ role, text: tail });
  }
  return { turns: out, inlineLabelRepairCount };
}

/** Parse colon-labeled dialogue lines ("Name: text") into roled turns; returns
 *  null unless a MAJORITY of non-empty lines are colon-labeled (incidental
 *  colons inside speech must not flip a prose transcript into dialogue mode). */
export function parseDialogueTurns(content: string): RoledTurn[] | null {
  const lines = content.split(/\r?\n/);
  let labeled = 0;
  let nonEmpty = 0;
  const raw: { speaker: string | null; text: string }[] = [];
  for (const line of lines) {
    if (line.trim()) nonEmpty++;
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
  if (labeled < 3 || labeled * 2 <= nonEmpty) return null;
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

/**
 * Split one over-long text into sub-texts at sentence (or paragraph)
 * boundaries, each at most `maxChars` (a single sentence longer than the cap
 * stays whole — the anomaly flag catches that pathological case). Safety net
 * for any format the parser still misreads: no single turn may glue an entire
 * call into one giant pseudo-turn.
 */
export function splitOversizeText(text: string, maxChars: number): string[] {
  const t = (text || "").trim();
  if (t.length <= maxChars) return t ? [t] : [];
  // Prefer paragraph boundaries, then sentences.
  const units: string[] = [];
  for (const para of t.split(/\n\s*\n/)) {
    const p = para.replace(/\s+/g, " ").trim();
    if (!p) continue;
    if (p.length <= maxChars) units.push(p);
    else units.push(...(p.match(/[^.!?]+[.!?]+(?:\s|$)|[^.!?]+$/g) ?? [p]).map((s) => s.trim()).filter(Boolean));
  }
  const out: string[] = [];
  let cur = "";
  for (const u of units) {
    if (cur && cur.length + 1 + u.length > maxChars) {
      out.push(cur);
      cur = u;
    } else {
      cur = cur ? cur + " " + u : u;
    }
  }
  if (cur) out.push(cur);
  return out;
}

/** Render turns as ONE role-labeled passage (inline speaker labels, one turn
 *  per line) and derive the anchor question (member speech before the first
 *  coach turn). */
function turnsToSegment(turns: RoledTurn[]): Omit<Segment, "orderIndex" | "emergencySplit"> {
  const passage = turns
    .map((t) => `${t.role === "coach" ? "Coach" : "Member"}: ${t.text}`)
    .join("\n");
  const firstCoach = turns.findIndex((t) => t.role === "coach");
  const anchor = turns
    .filter((t, i) => t.role === "member" && (firstCoach === -1 || i < firstCoach))
    .map((t) => t.text)
    .join(" ")
    .trim();
  return {
    passage,
    anchorQuestion: anchor ? anchor.slice(0, 2000) : null,
    memberOnly: firstCoach === -1 && turns.length > 0,
  };
}

/** Group roled turns into topic-threaded segments. A member turn opening a new
 *  topic (once the current segment already holds a coach response and has
 *  grown past `minChars`) is the ONLY normal split trigger — a coherent thread
 *  is never fragmented by size. The `emergencyChars` ceiling is a safety valve
 *  for pathological input: once the current segment exceeds it, it is closed at
 *  the next MEMBER-TURN boundary (preferred) or — past 1.5x the ceiling — at
 *  ANY turn boundary (never mid-sentence, since turns only ever start at
 *  sentence/paragraph boundaries), and the closed segment is marked
 *  `emergencySplit` as an audit anomaly. */
function groupTurnsIntoSegments(turns: RoledTurn[], minChars: number, emergencyChars: number): Segment[] {
  const segments: Segment[] = [];
  let current: RoledTurn[] = [];
  let chars = 0;
  let hasCoach = false;

  const flush = (emergency: boolean) => {
    if (current.length) {
      segments.push({
        orderIndex: segments.length,
        ...turnsToSegment(current),
        // A segment that still overran the ceiling at flush time (e.g. end of
        // transcript) is anomalous even when the flush itself wasn't forced.
        emergencySplit: emergency || chars > emergencyChars,
      });
    }
    current = [];
    chars = 0;
    hasCoach = false;
  };

  for (const t of turns) {
    if (!t.text) continue;
    const memberOpensNewTopic = t.role === "member" && hasCoach && chars >= minChars;
    // Emergency ceiling (pathological input only): close at a member-turn
    // boundary once past the ceiling; at the hard fallback (1.5x), close at
    // any turn boundary so a member-less monologue stays bounded. The hard cap
    // is checked INCLUDING the incoming turn (Task #1746): otherwise pre-split
    // ≤ceiling chunks re-glue past the cap on the final end-of-input flush,
    // which never gets another boundary check.
    const emergencyMemberBoundary = t.role === "member" && current.length > 0 && chars > emergencyChars;
    const emergencyHard =
      current.length > 0 && chars + t.text.length > emergencyChars * EMERGENCY_HARD_FACTOR;
    if (emergencyMemberBoundary || emergencyHard) flush(true);
    else if (memberOpensNewTopic) flush(false);

    current.push(t);
    if (t.role === "coach") hasCoach = true;
    chars += t.text.length;
  }
  flush(false);
  return segments;
}

/**
 * Deterministically split a cleared coaching source into TOPIC-THREADED
 * segments — ONE role-labeled passage each, with the member question that
 * opened the topic as anchor context. Three shapes are handled, in order:
 *  1. bare speaker-label-on-own-line (the Transcript Cleaner's real output:
 *     "Coach" / "Member" alone on a line, speech on the following lines);
 *  2. colon-labeled dialogue ("Name: …") — engaged only when a MAJORITY of
 *     lines are labeled, so incidental colons in speech can't glue the call
 *     into giant pseudo-turns;
 *  3. prose fallback — paragraphs role-guessed by question-likeness (last
 *     resort for truly unlabeled content).
 * Segments split ONLY at topic boundaries; the emergency ceiling (with an
 * oversize-turn pre-split at sentence/paragraph boundaries as a last-resort
 * safety net) bounds pathological input, marking such segments as anomalies.
 */
export function segmentTranscript(
  content: string,
  opts: { minChars?: number; emergencyChars?: number } = {},
): Segment[] {
  return segmentTranscriptDetailed(content, opts).segments;
}

/** {@link segmentTranscript} plus the repair telemetry the screener persists:
 *  how many inline speaker labels had to be split out of glued turn bodies
 *  (Task #1746) — >0 means the stored content violates the cleaner's format
 *  contract and is surfaced as a LOUD anomaly, never absorbed silently. */
export function segmentTranscriptDetailed(
  content: string,
  opts: { minChars?: number; emergencyChars?: number } = {},
): { segments: Segment[]; inlineLabelRepairCount: number } {
  const raw = (content || "").trim();
  if (!raw) return { segments: [], inlineLabelRepairCount: 0 };
  const minChars = opts.minChars ?? DEFAULT_MIN_SEGMENT_CHARS;
  const emergencyChars = opts.emergencyChars ?? DEFAULT_EMERGENCY_SEGMENT_CHARS;

  const parsed: RoledTurn[] =
    parseBareLabelTurns(raw) ??
    parseDialogueTurns(raw) ??
    proseBlocks(raw).map((b) => ({ role: looksLikeQuestion(b) ? "member" : "coach", text: b }) as RoledTurn);

  // Mixed-format repair (Task #1746): split inline `Coach:`/`Member:` labels
  // glued inside a turn body back into proper roled turns, restoring member/
  // coach roles and topic boundaries the format drift destroyed.
  const { turns, inlineLabelRepairCount } = repairInlineLabeledTurns(parsed);
  if (inlineLabelRepairCount > 0) {
    console.warn(
      `[ValueScreener] ANOMALY inline_label_repair: split ${inlineLabelRepairCount} inline speaker label(s) out of glued turn bodies — the stored content violates the cleaner bare-label format contract.`,
    );
  }

  // Last-resort safety net: no single TURN may exceed the emergency ceiling
  // (a parser misread can glue an entire call into one pseudo-turn). The
  // pre-split cuts only at sentence/paragraph boundaries, so downstream turn
  // boundaries are never mid-sentence.
  const bounded = turns.flatMap((t) =>
    t.text.length <= emergencyChars
      ? [t]
      : splitOversizeText(t.text, emergencyChars).map((text) => ({ role: t.role, text })),
  );

  return { segments: groupTurnsIntoSegments(bounded, minChars, emergencyChars), inlineLabelRepairCount };
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
  contextBound: boolean;
  rationale: string;
}

// Distinct marker for an EMPTY LLM completion (typically a reasoning model
// exhausting max_completion_tokens on hidden reasoning: finish_reason=length).
// Recorded distinctly so it is never mistaken for a JSON parse failure.
export const EMPTY_COMPLETION_REASON = "empty response — token budget exhausted";

export const SCREENER_RUBRIC = `You screen segments of a Build Test Scale (BTS) affiliate-marketing COACHING CALL to strip out confidently worthless noise before the knowledge base indexes them.

Each segment is a topic thread: a role-labeled transcript passage (inline Coach:/Member: speaker labels), optionally preceded by the ANCHOR member question that prompted it.

YOUR BIAS: this is a RECALL-FIRST de-noiser, NOT a "best moments" picker. Keep anything that is plausibly instructional. Only drop what is confidently, obviously worthless. False DROPS are far worse than keeping something mediocre — when unsure, KEEP; only when you genuinely cannot tell, FLAG.

Classify each segment:
- valueType: one of ${VALUE_TYPES.join(", ")}.
- disposition:
  - "keep": has ANY plausible durable teaching value — a principle, framework, process/step, decision criteria, worked example, troubleshooting pattern, useful resource pointer, or even partial/rough guidance. This is the DEFAULT.
  - "drop": ONLY for content that is confidently worthless with no teaching value at all — greetings, scheduling/logistics, "can you hear me"/tech checks, pure filler encouragement, or off-topic chit-chat. If it teaches anything, do NOT drop it.
  - "flag": you genuinely cannot tell whether it has value. Use sparingly.
    ALSO "flag" (never "keep", never "drop"): member GRIEVANCE segments — a member complaining about or disputing billing, charges, refunds, guarantees, cancellations, or support responsiveness, or recounting what they were told about such policies, where the coach gives NO real teaching in response (only acknowledges, sympathizes, or redirects to support). A member's recollection of policy/billing/refund/guarantee terms is hearsay, not knowledge — such segments are pre-sorted for human review, NOT dropped. BUT if the coach responds with genuine guidance or teaching in the same segment, "keep" it as usual.
- situationalNumber: true when the answer is anchored to a time-sensitive detail OR to THIS member's specific numbers/account state (their spend, ROI, a current platform rule, a "right now" tactic). Such content is still KEPT (usually "keep", never a silent "drop") but marked so a human sees its context-bound nature. This is an INDEPENDENT signal.
- contextBound: true when the segment is live screen-share WALKTHROUGH NARRATION — the coach navigating a tool on screen ("click the edit button…", "you see my screen?", "now scroll down here"). Such keeps are topic evidence but NOT standalone quotable teaching; mark them so downstream synthesis treats them as evidence, not quotes. This is an INDEPENDENT signal and never a reason to drop.
- dropReason: a short reason, required when disposition is "drop" or "flag"; null for "keep".
- rationale: one concise sentence explaining the call.`;

const errorClassification = (reason: string): SegmentClassification => ({
  valueType: "unclassified",
  disposition: "error",
  dropReason: reason,
  situationalNumber: false,
  contextBound: false,
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
  const contextBound = r.contextBound === true || r.walkthrough === true;
  const rationale = typeof r.rationale === "string" ? r.rationale.slice(0, 500) : "";
  let dropReason: string | null =
    typeof r.dropReason === "string" && r.dropReason.trim() ? r.dropReason.trim().slice(0, 500) : null;
  if (disposition === "keep") dropReason = null;
  else if (!dropReason) dropReason = disposition === "drop" ? "confidently low value (logistics/chatter)" : "borderline — needs review";
  return { valueType, disposition, dropReason, situationalNumber, contextBound, rationale };
}

/** Classify ONE chunk in a single LLM call, with retries. Returns a map from
 *  the chunk-local index to its classification (only for indices the model
 *  actually returned). Throws if every attempt fails. */
async function classifyChunk(chunk: Segment[]): Promise<Map<number, SegmentClassification>> {
  const system =
    SCREENER_RUBRIC +
    `

Return STRICT JSON: {"results":[{"index":<0-based>,"valueType":"...","disposition":"keep|drop|flag","situationalNumber":true|false,"contextBound":true|false,"dropReason":"..."|null,"rationale":"..."}]}. Return exactly one result per input segment, same order.`;

  const user =
    "Screen these segments:\n\n" +
    chunk
      .map(
        (s, i) =>
          `[${i}]${s.anchorQuestion ? ` ANCHOR QUESTION: ${s.anchorQuestion.slice(0, 400)}\n    ` : " "}PASSAGE:\n${s.passage.slice(0, CLASSIFY_PASSAGE_MAX_CHARS)}`,
      )
      .join("\n\n");

  let lastErr: unknown;
  for (let attempt = 1; attempt <= CLASSIFY_MAX_ATTEMPTS; attempt++) {
    try {
      // gpt-5 is a reasoning model: hidden reasoning tokens count against
      // max_completion_tokens, so the budget must leave generous headroom or
      // the response comes back EMPTY (finish_reason=length) and every
      // segment errors out. Keep this floor high — larger (emergency-ceiling)
      // segments also demand more reasoning headroom, hence the raised base.
      const rawResp = await callLLM(system, user, 8000 + chunk.length * 400, true);
      // An EMPTY completion is a token-budget failure, NOT a parse failure —
      // record and log it distinctly so it is diagnosable.
      if (!rawResp || !rawResp.trim()) {
        console.warn(`[ValueScreener] ${EMPTY_COMPLETION_REASON} (attempt ${attempt}/${CLASSIFY_MAX_ATTEMPTS})`);
        throw new Error(EMPTY_COMPLETION_REASON);
      }
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
      console.warn(
        `[ValueScreener] classify attempt ${attempt}/${CLASSIFY_MAX_ATTEMPTS} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
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

  // Chunk by BOTH segment count and total passage chars: segments can now run
  // up to the emergency ceiling, so a count-only chunk could balloon the
  // prompt. A chunk always takes at least one segment (progress guarantee).
  const chunkStarts: number[] = [];
  {
    let start = 0;
    while (start < segments.length) {
      chunkStarts.push(start);
      let end = start + 1;
      let chars = Math.min(segments[start].passage.length, CLASSIFY_PASSAGE_MAX_CHARS);
      while (end < segments.length && end - start < CLASSIFY_CHUNK_SIZE) {
        const next = Math.min(segments[end].passage.length, CLASSIFY_PASSAGE_MAX_CHARS);
        if (chars + next > CLASSIFY_CHUNK_CHAR_BUDGET) break;
        chars += next;
        end++;
      }
      start = end;
    }
  }

  for (let c = 0; c < chunkStarts.length; c++) {
    const start = chunkStarts[c];
    const chunkEnd = c + 1 < chunkStarts.length ? chunkStarts[c + 1] : segments.length;
    const chunk = segments.slice(start, chunkEnd);
    let map: Map<number, SegmentClassification> | null = null;
    let chunkFailReason = "classifier error after retries";
    try {
      map = await classifyChunk(chunk);
    } catch (err) {
      map = null; // whole chunk failed after retries — isolate to these segments
      const msg = err instanceof Error ? err.message : String(err);
      chunkFailReason = msg.includes(EMPTY_COMPLETION_REASON)
        ? EMPTY_COMPLETION_REASON
        : `classifier error after retries: ${msg.slice(0, 200)}`;
    }
    for (let j = 0; j < chunk.length; j++) {
      const global = start + j;
      if (map && map.has(j)) out[global] = map.get(j)!;
      else
        out[global] = errorClassification(
          map === null ? chunkFailReason : "classifier omitted this segment",
        );
    }
  }
  return out;
}

/**
 * The recorded drop reason for a fold — the STRUCTURED marker the reviewer
 * surface keys on (never string-match passage text to detect a fold).
 */
export const QA_FOLD_DROP_REASON = "member question folded into the following kept segment as anchor context";

/** The anchor-question slot cap applied when folding (chars). */
export const QA_FOLD_ANCHOR_MAX_CHARS = 2000;

/**
 * Q/A pairing rule (post-classification): a member-only question segment is
 * NEVER dropped independently of its answer. When the FOLLOWING segment is a
 * kept coach segment, the member question is folded into it as anchor context
 * (and the question row's dropReason records the fold); the question is only
 * truly dropped when its answer is dropped too. Mutates and returns the inputs.
 */
export function applyQaPairing(
  segments: Segment[],
  classifications: SegmentClassification[],
): { segments: Segment[]; classifications: SegmentClassification[] } {
  for (let i = 0; i + 1 < segments.length; i++) {
    const seg = segments[i];
    const cls = classifications[i];
    if (!seg.memberOnly || cls.disposition !== "drop") continue;
    const next = segments[i + 1];
    const nextCls = classifications[i + 1];
    if (next.memberOnly || nextCls.disposition !== "keep") continue;

    const question = foldQuestionText(seg).slice(0, QA_FOLD_ANCHOR_MAX_CHARS);
    next.anchorQuestion = next.anchorQuestion
      ? `${question} ${next.anchorQuestion}`.slice(0, QA_FOLD_ANCHOR_MAX_CHARS)
      : question;
    cls.dropReason = QA_FOLD_DROP_REASON;
  }
  return { segments, classifications };
}

/** The member question text a fold carries over (pre-cap). */
function foldQuestionText(seg: { passage: string; anchorQuestion: string | null }): string {
  return seg.anchorQuestion ?? seg.passage.replace(/^Member:\s*/gm, "").trim();
}

/**
 * Structured fold signals for the reviewer surface, derived from the recorded
 * fold marker (dropReason) — NOT from string-matching passage text.
 *  - foldedIntoNext: this dropped row is a Q/A fold; its question lives on in
 *    the following kept segment's anchor slot (merged, nothing discarded).
 *  - foldTruncated: the original member text was longer than the anchor-slot
 *    cap, so the cleaned transcript will NOT carry the full question.
 */
export function deriveFoldSignals(e: {
  dropReason: string | null;
  passage: string;
  anchorQuestion: string | null;
}): { foldedIntoNext: boolean; foldTruncated: boolean } {
  const foldedIntoNext = e.dropReason === QA_FOLD_DROP_REASON;
  return {
    foldedIntoNext,
    foldTruncated: foldedIntoNext && foldQuestionText(e).length > QA_FOLD_ANCHOR_MAX_CHARS,
  };
}

// ── Anomaly signals (audit surface) ─────────────────────────────────────────

export const SEGMENT_MAX_CHARS = DEFAULT_EMERGENCY_SEGMENT_CHARS;

// Expected content-per-segment yardstick for the low_segment_count check.
// Deliberately DECOUPLED from the emergency ceiling: topic-threaded segments
// typically run far smaller than the ceiling, so "one segment per ~10k chars"
// remains the plausibility floor for a full-length call.
const LOW_COUNT_CHARS_PER_SEGMENT = 10000;

export const ANOMALY_FLAGS = [
  "oversized_segment",
  "low_segment_count",
  "all_error",
  "emergency_split",
  "inline_label_repair",
] as const;
export type AnomalyFlag = (typeof ANOMALY_FLAGS)[number];

/**
 * Per-screening anomaly signals for the admin audit surface. A screening with
 * an anomalous shape is flagged for attention rather than silently passing:
 *  - oversized_segment: some segment exceeds ~2x the max-char cap — genuine
 *    mega-segment / parser-failure territory. Trivial overshoots (a few chars
 *    past the cap) are harmless: synthesis joins kept segments and reads them
 *    in its own windows, so size only matters once a single keep/drop verdict
 *    becomes meaningless;
 *  - low_segment_count: a full-length call yielded implausibly few segments
 *    (the mega-segment signature);
 *  - all_error: every segment errored (e.g. an unresolved token-budget run);
 *  - emergency_split: one or more segments were closed by the EMERGENCY size
 *    ceiling rather than a topic boundary (pathological input — unlabeled
 *    monologue or a parser misread) and deserve a human look;
 *  - inline_label_repair: segmentation had to split inline `Coach:`/`Member:`
 *    labels out of glued turn bodies (Task #1746) — the stored content
 *    violates the cleaner's bare-label format contract and should be repaired
 *    at the source.
 */
export function computeAnomalyFlags(sc: {
  exchangeCount: number;
  keptCount: number;
  droppedCount: number;
  flaggedCount: number;
  maxSegmentChars: number;
  sourceCharCount: number;
  dedupStatus?: string;
  emergencySplitCount?: number;
  inlineLabelRepairCount?: number;
}): AnomalyFlag[] {
  const flags: AnomalyFlag[] = [];
  if (sc.maxSegmentChars > SEGMENT_MAX_CHARS * 2) flags.push("oversized_segment");
  // Expect at least one segment per ~10k chars of content; a 50k-char call
  // that yields 2 segments is anomalous. Exact duplicates legitimately have
  // zero segments, so skip the check for them.
  if (
    sc.dedupStatus !== "exact_duplicate" &&
    sc.sourceCharCount >= 8000 &&
    sc.exchangeCount < Math.ceil(sc.sourceCharCount / LOW_COUNT_CHARS_PER_SEGMENT)
  ) {
    flags.push("low_segment_count");
  }
  const errors = sc.exchangeCount - sc.keptCount - sc.droppedCount - sc.flaggedCount;
  if (sc.exchangeCount > 0 && errors >= sc.exchangeCount) flags.push("all_error");
  if ((sc.emergencySplitCount ?? 0) > 0) flags.push("emergency_split");
  if ((sc.inlineLabelRepairCount ?? 0) > 0) flags.push("inline_label_repair");
  return flags;
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
  const { segments, inlineLabelRepairCount } =
    dedup.status === "exact_duplicate"
      ? { segments: [] as Segment[], inlineLabelRepairCount: 0 }
      : segmentTranscriptDetailed(source.content);
  if (inlineLabelRepairCount > 0) {
    console.warn(
      `[ValueScreener] ANOMALY source ${sourceDocId}: inline_label_repair fired (${inlineLabelRepairCount} label(s)) — stored content needs format repair.`,
    );
  }
  const classifications = await classifySegments(segments);
  // Q/A pairing: never drop a member-only question independently of its answer.
  applyQaPairing(segments, classifications);
  const maxSegmentChars = segments.reduce((m, s) => Math.max(m, s.passage.length), 0);
  const sourceCharCount = source.content.trim().length;
  const emergencySplitCount = segments.filter((s) => s.emergencySplit).length;

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
        maxSegmentChars,
        sourceCharCount,
        emergencySplitCount,
        inlineLabelRepairCount,
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
          maxSegmentChars,
          sourceCharCount,
          emergencySplitCount,
          inlineLabelRepairCount,
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
            passage: s.passage,
            anchorQuestion: s.anchorQuestion,
            valueType: c.valueType,
            disposition: c.disposition,
            dropReason: c.dropReason,
            situationalNumber: c.situationalNumber,
            contextBound: c.contextBound,
            rationale: c.rationale,
            emergencySplit: s.emergencySplit,
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

// ── Screening flags carried into synthesis (Task #1751) ─────────────────────
//
// Per-source aggregate of the screener's per-segment risk signals. These are
// threaded through the synthesis extract phase into the consolidation prompt so
// situational numbers, walkthrough narration and segmenter anomalies reach the
// draft (and its reviewer) instead of silently vanishing when the extract is
// flattened to a plain string.

export interface ScreeningFlags {
  /** ≥1 kept segment carries a member-specific / time-sensitive number. */
  situationalNumbers: boolean;
  /** ≥1 kept segment is live screen-share walkthrough narration. */
  contextBound: boolean;
  /** ≥1 kept segment was closed by the segmenter's emergency ceiling. */
  segmentAnomaly: boolean;
}

export const EMPTY_SCREENING_FLAGS: Readonly<ScreeningFlags> = Object.freeze({
  situationalNumbers: false,
  contextBound: false,
  segmentAnomaly: false,
});

// Inline passage markers the synthesis map phase is instructed to honor. They
// travel WITH the passage text, so the risk signal survives the LLM extraction.
export const SITUATIONAL_NUMBER_MARKER =
  "[SITUATIONAL NUMBER — the figures in this passage are one member's specific situation or a point-in-time answer; context-bound illustrations ONLY, never universal targets]";
export const CONTEXT_BOUND_MARKER =
  "[CONTEXT-BOUND WALKTHROUGH — live screen-share narration; topic evidence, not standalone quotable teaching]";
export const SEGMENT_ANOMALY_MARKER =
  "[SEGMENT ANOMALY — segment closed by the emergency size ceiling, not a topic boundary; passage boundaries may be unreliable]";

/** Render one kept segment for the screened representation, prefixing the
 *  inline flag markers (and anchor question) it carries. Pure — unit-tested. */
export function annotateKeptPassage(row: {
  passage: string;
  anchorQuestion: string | null;
  situationalNumber: boolean;
  contextBound: boolean;
  emergencySplit: boolean;
}, annotateFlags: boolean): string {
  const base =
    row.anchorQuestion && !row.passage.includes(row.anchorQuestion)
      ? `[Anchor question] ${row.anchorQuestion}\n${row.passage}`
      : row.passage;
  if (!annotateFlags) return base;
  const markers: string[] = [];
  if (row.situationalNumber) markers.push(SITUATIONAL_NUMBER_MARKER);
  if (row.contextBound) markers.push(CONTEXT_BOUND_MARKER);
  if (row.emergencySplit) markers.push(SEGMENT_ANOMALY_MARKER);
  return markers.length ? `${markers.join("\n")}\n${base}` : base;
}

/**
 * The screened representation a downstream reader consumes: the KEPT segments
 * (honoring admin overrides) joined back into a compact transcript, plus the
 * per-source aggregate {@link ScreeningFlags}. Dropped, flagged, and errored
 * segments are excluded. The raw source content is left untouched for audit.
 * With `annotateFlags`, each risky kept segment is prefixed with its inline
 * marker so the flag travels with the text through LLM extraction.
 */
export async function getScreenedRepresentationDetailed(
  sourceDocId: number,
  opts: { annotateFlags?: boolean } = {},
): Promise<{ content: string; flags: ScreeningFlags }> {
  const [screening] = await db
    .select()
    .from(kbCallScreeningsTable)
    .where(eq(kbCallScreeningsTable.sourceDocId, sourceDocId));
  if (!screening) return { content: "", flags: { ...EMPTY_SCREENING_FLAGS } };

  const rows = await db
    .select()
    .from(kbScreenedExchangesTable)
    .where(eq(kbScreenedExchangesTable.screeningId, screening.id))
    .orderBy(kbScreenedExchangesTable.orderIndex);

  const kept = rows.filter((r) => effectiveDisposition(r) === "keep");
  const flags: ScreeningFlags = {
    situationalNumbers: kept.some((r) => r.situationalNumber),
    contextBound: kept.some((r) => r.contextBound),
    segmentAnomaly: kept.some((r) => r.emergencySplit),
  };
  const content = kept
    .map((r) => annotateKeptPassage(r, opts.annotateFlags === true))
    .join("\n\n");
  return { content, flags };
}

/** Back-compat plain-text view of {@link getScreenedRepresentationDetailed}. */
export async function getScreenedRepresentation(sourceDocId: number): Promise<string> {
  return (await getScreenedRepresentationDetailed(sourceDocId)).content;
}

/**
 * The single content-resolution seam for synthesis-side readers (topic
 * indexing, per-node extraction, the refine chat's source-material fetch).
 *
 * Returns the screened kept-segments representation when the source has a
 * completed screening with at least one effectively-kept segment carrying
 * non-empty passage text; otherwise returns the raw content unchanged.
 * Fallback guards (never feed empty/garbage content into synthesis):
 *  - no screening row → raw
 *  - zero kept segments (incl. all-error screenings) → raw
 *  - kept segments but empty passage text (pre-overhaul runs stored the
 *    passage elsewhere) → raw
 * A DB failure here must never block synthesis — it also falls back to raw.
 */
export async function resolveSourceContentForSynthesis(
  sourceDocId: number,
  rawContent: string,
  opts: { annotateFlags?: boolean } = {},
): Promise<{ content: string; screened: boolean; flags: ScreeningFlags }> {
  try {
    const { content: screened, flags } = await getScreenedRepresentationDetailed(sourceDocId, opts);
    if (screened.trim().length > 0) return { content: screened, screened: true, flags };
  } catch (err) {
    console.error(
      `[ValueScreener] screened-content resolution failed for source ${sourceDocId}, using raw:`,
      err instanceof Error ? err.message : err,
    );
  }
  return { content: rawContent, screened: false, flags: { ...EMPTY_SCREENING_FLAGS } };
}

// ── Background pilot run state ───────────────────────────────────────────────

/** Per-source outcome of a batch run — recorded for EVERY source in the batch
 *  (Task #1746: no silent skips, no counts-only reporting). */
export interface ScreenerSourceOutcome {
  sourceDocId: number;
  status: "screened" | "skipped" | "duplicate" | "error";
  /** Headline counts / error message for the admin surface. */
  detail: string;
  errorCount: number;
}

export interface ScreenerProgress {
  running: boolean;
  total: number;
  processed: number;
  kept: number;
  dropped: number;
  flagged: number;
  errors: number;
  duplicates: number;
  /** The source doc id currently being screened (null when idle / between sources). */
  currentSourceId: number | null;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
  /** One entry per source in the batch, in processing order. */
  outcomes: ScreenerSourceOutcome[];
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
  currentSourceId: null,
  startedAt: null,
  finishedAt: null,
  error: null,
  outcomes: [],
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
    currentSourceId: null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    error: null,
    outcomes: [],
  };

  try {
    const corpus = await loadCoachingCorpus();
    for (const id of sourceDocIds) {
      state.currentSourceId = id;
      try {
        const r = await screenSource({ sourceDocId: id, corpus, force: opts.force });
        state.kept += r.keptCount;
        state.dropped += r.droppedCount;
        state.flagged += r.flaggedCount;
        state.errors += r.errorCount;
        if (r.dedupStatus !== "unique") state.duplicates += 1;
        const status: ScreenerSourceOutcome["status"] = r.skipped
          ? "skipped"
          : r.dedupStatus !== "unique"
            ? "duplicate"
            : "screened";
        const detail = r.skipped
          ? "unchanged content — cached screening reused"
          : r.dedupStatus !== "unique"
            ? `${r.dedupStatus} — classification skipped`
            : `${r.exchangeCount} segments: ${r.keptCount} kept / ${r.droppedCount} dropped / ${r.flaggedCount} flagged / ${r.errorCount} errored`;
        state.outcomes.push({ sourceDocId: id, status, detail, errorCount: r.errorCount });
        // Per-source summary — LOUD when any segment carries an error
        // disposition, so a partially failed source is never a silent count.
        if (r.errorCount > 0) {
          console.warn(`[ValueScreener] source ${id}: ${detail} — ${r.errorCount} segment(s) need a re-run.`);
        } else {
          console.log(`[ValueScreener] source ${id}: ${status} — ${detail}`);
        }
      } catch (err) {
        // Isolate a per-source failure; keep going.
        const msg = err instanceof Error ? err.message : String(err);
        state.error = msg;
        state.outcomes.push({ sourceDocId: id, status: "error", detail: msg.slice(0, 300), errorCount: 0 });
        console.error(`[ValueScreener] source ${id}: FAILED — ${msg}`);
      } finally {
        state.processed += 1;
      }
    }
  } catch (err) {
    state.error = err instanceof Error ? err.message : String(err);
  } finally {
    state.running = false;
    state.currentSourceId = null;
    state.finishedAt = new Date().toISOString();
  }
}
