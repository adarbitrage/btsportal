/**
 * Transcript Cleaner engine (Task #1468).
 *
 * A generic, tool-agnostic transcript-cleanup service built on the existing
 * Anthropic client. It does NOT assume any single transcription product's
 * output shape: the cleanup + authority-attribution logic degrades gracefully
 * when expected structure (timestamps, speaker names, labels) is absent, and
 * flags genuinely ambiguous files for manual review rather than guessing.
 *
 * Behaviour is informed by the plan #1483 triage findings (the known legacy
 * batch is clean prose with named `Name:` labels, little timestamp/whitespace
 * cruft) but treats those as DEFAULTS, not a contract — later hand-uploaded
 * files come from other tools and may lack names/timestamps/labels entirely.
 *
 * Two AI entry points:
 *  - {@link cleanTranscript}:   one structured-JSON call that reattributes
 *    stray-label segments while preserving each distinct speaker, labels the
 *    source of authority, normalises BTS terminology via the glossary, strips
 *    cruft, proposes a title, and emits per-item review flags + confidence.
 *  - {@link refineTranscript}:  a follow-up call that takes the current cleaned
 *    transcript + an admin instruction and returns an updated transcript +
 *    refreshed flags.
 *
 * NOTE: privacy scrubbing is intentionally NOT done here — per #1483, PII is
 * handled at answer time, and cleaned transcripts are raw source material, not
 * citable truth, so they never enter a member-facing retrieval path.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getAnthropicClient } from "@workspace/integrations-anthropic-ai";
import { db, coachesTable } from "@workspace/db";
import {
  resolveSourceFolder,
  authorityRoleFromCoachType,
  AUTHORITY_ROLES,
  DEFAULT_AUTHORITY_ROLE,
  type AuthorityRole,
  type SourceFolder,
} from "./kb-taxonomy";
import type { TranscriptCleanerFlag, TranscriptCleanerChatTurn } from "@workspace/db";

const MODEL = "claude-sonnet-4-6";
// Output cap for a single clean/refine pass. Raised from 8192 so the largest
// stitched multi-part transcripts (the biggest is an 11-part call ≈ 7.6k tokens
// of input, with cleaned output of comparable size) clean in one pass without
// the model's JSON reply being truncated mid-value.
const MAX_TOKENS = 16384;
// How many times to re-request when the model returns unparseable JSON. The
// failure is non-deterministic (an occasional escaping slip), so a fresh
// generation almost always succeeds; truncation (stop_reason="max_tokens") is
// NOT retried because it would deterministically truncate again.
const MAX_JSON_ATTEMPTS = 3;

// ───────────────────────────────────────────────────────────────────────────
// Roster — the live coach / VA name→type map for deterministic authority swaps.
// ───────────────────────────────────────────────────────────────────────────

/**
 * Build a name→coaches.type map from the live roster, keyed by the lowercased
 * coach/VA first name (e.g. "sasha" → "strategic_coach", "neil" → "va"). Used
 * for the deterministic, high-confidence authority swap on NAMED transcripts.
 */
export async function loadRosterMap(): Promise<Map<string, string>> {
  const rows = await db.select({ name: coachesTable.name, type: coachesTable.type }).from(coachesTable);
  const map = new Map<string, string>();
  for (const r of rows) {
    const name = (r.name ?? "").trim().toLowerCase();
    if (name) map.set(name, r.type ?? "strategic_coach");
  }
  return map;
}

function containsWholeWord(haystack: string, needle: string): boolean {
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped}\\b`, "i").test(haystack);
}

/**
 * Scan raw transcript text for roster names. A name is only treated as a
 * deterministic authority when it appears as a SPEAKER LABEL — at the start of a
 * line, optionally prefixed with "Coach "/"VA ", followed by a label delimiter
 * (`:`/`-`). Names that appear only mid-sentence (inline mentions) are returned
 * separately as `inlineOnly` and must NOT drive a high-confidence swap: a coach
 * being talked *about* is not the same as the coach being the speaker.
 *
 * `labelMatched` is empty when the transcript uses numbered/unlabelled speakers,
 * in which case the AI inference path takes over.
 */
export function detectRosterAuthority(
  rawText: string,
  roster: ReadonlyMap<string, string>,
): {
  labelMatched: Array<{ name: string; role: AuthorityRole }>;
  inlineOnly: string[];
} {
  const labelMatched: Array<{ name: string; role: AuthorityRole }> = [];
  const inlineOnly: string[] = [];
  const seen = new Set<string>();
  for (const [name, type] of roster) {
    if (seen.has(name)) continue;
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Speaker-label context ONLY: line start, optional "Coach "/"VA " prefix,
    // the name, then a label delimiter. Deliberately no whole-text fallback —
    // an inline mention must not be promoted to deterministic authority.
    const labelRe = new RegExp(`(^|\\n)\\s*(coach\\s+|va\\s+)?${escaped}\\b\\s*[:\\-–]`, "i");
    if (labelRe.test(rawText)) {
      labelMatched.push({ name, role: authorityRoleFromCoachType(type) });
      seen.add(name);
    } else if (containsWholeWord(rawText, name)) {
      inlineOnly.push(name);
      seen.add(name);
    }
  }
  return { labelMatched, inlineOnly };
}

// ───────────────────────────────────────────────────────────────────────────
// Glossary — canonical BTS product/process term names for spelling/normalising.
// ───────────────────────────────────────────────────────────────────────────

let GLOSSARY_TERMS_CACHE: string[] | null = null;

/**
 * Extract the canonical term names (first "Item" column) from the messy
 * markdown-table glossary so the AI can normalise BTS-specific product/process
 * names to their correct spelling. Cached per-process. Tolerant of the table's
 * trailing-empty-cell noise; filters out the header, URLs, and junk rows.
 */
export function loadGlossaryTerms(): string[] {
  if (GLOSSARY_TERMS_CACHE) return GLOSSARY_TERMS_CACHE;
  let raw = "";
  try {
    raw = readFileSync(join(__dirname, "..", "knowledge-base", "glossary.txt"), "utf8");
  } catch {
    GLOSSARY_TERMS_CACHE = [];
    return GLOSSARY_TERMS_CACHE;
  }
  const terms: string[] = [];
  const seen = new Set<string>();
  for (const line of raw.split("\n")) {
    if (!line.includes("|")) continue;
    const cells = line.split("|").map((c) => c.trim());
    // cells[0] is the leading empty before the first pipe; the term is cells[1].
    const term = cells[1] ?? "";
    if (!term) continue;
    if (term === "Item" || /^-+$/.test(term)) continue; // header / separator
    if (term.length < 2 || term.length > 60) continue; // junk / paragraph spill
    if (/^https?:\/\//i.test(term)) continue;
    const key = term.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    terms.push(term);
  }
  GLOSSARY_TERMS_CACHE = terms;
  return terms;
}

// ───────────────────────────────────────────────────────────────────────────
// Result shapes.
// ───────────────────────────────────────────────────────────────────────────

export interface CleanTranscriptResult {
  cleanedContent: string;
  authorityRole: AuthorityRole;
  authorityConfidence: "high" | "low";
  authorityEvidence: string;
  suggestedTitle: string;
  titleNeedsInput: boolean;
  flags: TranscriptCleanerFlag[];
}

export interface RefineTranscriptResult {
  cleanedContent: string;
  flags: TranscriptCleanerFlag[];
  authorityRole?: AuthorityRole;
  authorityConfidence?: "high" | "low";
  authorityEvidence?: string;
  assistantMessage: string;
}

const isAuthorityRole = (v: unknown): v is AuthorityRole =>
  typeof v === "string" && (AUTHORITY_ROLES as readonly string[]).includes(v);

/** Slice the outermost JSON object out of an AI response (tolerates ``` fences). */
function sliceJsonCandidate(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    throw new Error("AI response did not contain a JSON object");
  }
  return candidate.slice(start, end + 1);
}

/**
 * Pull the first JSON object out of an AI text response. Tolerant of two common
 * LLM slips: ``` fences (handled by {@link sliceJsonCandidate}) and trailing
 * commas before a closing `}`/`]`. Anything beyond that (a genuinely malformed
 * or truncated reply) throws, and the caller's retry loop re-requests a fresh
 * generation rather than guessing at a repair.
 */
function extractJson(text: string): any {
  const candidate = sliceJsonCandidate(text);
  try {
    return JSON.parse(candidate);
  } catch {
    // Strip trailing commas (e.g. `"a": 1, }`) and retry once.
    return JSON.parse(candidate.replace(/,(\s*[}\]])/g, "$1"));
  }
}

/**
 * Make one structured-JSON request to the model and parse the reply, retrying
 * the whole call when the JSON comes back unparseable. The parse failure is
 * non-deterministic (an occasional escaping slip in an otherwise-fine reply), so
 * a fresh generation almost always succeeds. A truncated reply
 * (stop_reason="max_tokens") is surfaced immediately with a clear message
 * instead of being retried, because it would just truncate again.
 */
async function requestCleanerJson(args: { system: string; userMessage: string }): Promise<any> {
  const anthropic = getAnthropicClient();
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_JSON_ATTEMPTS; attempt++) {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: args.system,
      messages: [{ role: "user", content: args.userMessage }],
    });
    if (response.stop_reason === "max_tokens") {
      throw new Error(
        "AI response hit the output token limit before completing — the transcript is too large to clean in a single pass.",
      );
    }
    const text = response.content[0]?.type === "text" ? response.content[0].text : "";
    try {
      return extractJson(text);
    } catch (err) {
      lastError = err;
    }
  }
  throw new Error(
    `AI returned unparseable JSON after ${MAX_JSON_ATTEMPTS} attempts: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
  );
}

function expectedSpeakers(folder: SourceFolder | null): string {
  switch (folder?.slug) {
    case "private_coaching":
      return "one authority (the coach) and one member";
    case "group_coaching":
      return "one authority (the coach) and several members";
    case "one_on_one_va":
      return "one authority (the VA) and one member";
    case "blitz_video":
    case "other_video":
      return "usually a single presenter/authority talking to camera";
    default:
      return "an unknown number of speakers — infer them from the content";
  }
}

function callTypeLabel(folder: SourceFolder | null): string {
  return folder?.label ?? "Transcript";
}

// ───────────────────────────────────────────────────────────────────────────
// Cleanup engine.
// ───────────────────────────────────────────────────────────────────────────

const CLEAN_SYSTEM_PROMPT = [
  "You are a meticulous transcript-cleaning assistant for an affiliate-marketing",
  "coaching membership (BTS). You clean RAW call/video transcripts that come from",
  "many different transcription tools, so you must NOT assume any particular shape.",
  "",
  "Your job, returning STRICT JSON only:",
  "1. Reattribute mislabelled segments to the correct person while PRESERVING each",
  "   distinct speaker. Transcription tools often split one real person across two",
  "   labels (Speaker 3 / Speaker 4) or bleed one person's words into another's",
  "   label — merge/reassign those. Never invent or drop a real speaker.",
  "2. Identify the SOURCE OF AUTHORITY — the coach/VA doing the teaching/answering/",
  "   directing, as opposed to the member(s) asking questions or describing their",
  "   situation. Label that speaker with their authority role title (e.g. 'Coach'",
  "   or 'VA'), not a personal name. Label the others 'Member 1', 'Member 2', etc.",
  "   When speakers are only numbered, infer the authority PURELY from",
  "   conversational role (who teaches/answers vs who asks). No knowledge of BTS",
  "   training concepts is needed; the teacher/answerer pattern is the signal and",
  "   may only resolve by mid-call. Report your confidence + the evidence.",
  "3. Fix spelling and normalise BTS product/process names to the supplied glossary",
  "   spellings. Do not otherwise reword what people said.",
  "4. Strip useless cruft: standalone timestamps, transcription-tool artefacts,",
  "   excess blank space. Keep the actual dialogue intact.",
  "5. Mark low-confidence spots (uncertain attribution, ambiguous speaker, garbled",
  "   text) as review flags instead of guessing.",
  "6. Propose a descriptive title: <authority> — <call type> — <date/time>",
  "   (e.g. 'Coach Sasha — Private Coaching — 2025-01-14 2pm'). Take the date/time",
  "   from the content/source if present; if it cannot be determined, omit it and",
  "   set titleNeedsInput=true.",
  "",
  "DEGRADE GRACEFULLY: if the transcript has no timestamps, no speaker names, only",
  "numbered/unlabelled speakers, or is a single undelimited block, clean what you",
  "can and flag what is genuinely ambiguous — do not error or fabricate structure.",
  "",
  "Return ONLY a JSON object with keys: cleanedTranscript (string), authority",
  "({ label, confidence: 'high'|'low', evidence, detectedName }), suggestedTitle",
  "(string), detectedDateTime (string|null), titleNeedsInput (boolean), flags",
  "(array of { type, text, reason, confidence }).",
].join("\n");

export async function cleanTranscript(args: {
  rawText: string;
  transcriptType?: string | null;
  sourceName?: string | null;
  proposedTitle?: string | null;
  roster: ReadonlyMap<string, string>;
}): Promise<CleanTranscriptResult> {
  const { rawText, transcriptType, sourceName, proposedTitle, roster } = args;
  const folder = resolveSourceFolder(transcriptType ?? null);
  const rosterHit = detectRosterAuthority(rawText, roster);
  const glossaryTerms = loadGlossaryTerms();

  const userMessage = [
    `Transcript type: ${folder ? folder.label : "(untagged — infer the call type)"}`,
    `Expected speakers: ${expectedSpeakers(folder)}`,
    sourceName ? `Source / original filename: ${sourceName}` : null,
    proposedTitle ? `An approved title already exists (do not override it): ${proposedTitle}` : null,
    rosterHit.labelMatched.length > 0
      ? `Known roster names present as SPEAKER LABELS (treat the matching speaker as the AUTHORITY, high confidence): ${rosterHit.labelMatched.map((m) => m.name).join(", ")}`
      : rosterHit.inlineOnly.length > 0
        ? `Roster names mentioned inline but NOT as speaker labels: ${rosterHit.inlineOnly.join(", ")}. Do NOT assume these people are the authority — they may just be talked about. Infer the authority from conversational role and report your confidence.`
        : "No known roster names detected — infer the authority from conversational role and report your confidence.",
    glossaryTerms.length > 0
      ? `Canonical BTS terms (normalise spelling to these exact forms when referenced): ${glossaryTerms.join(", ")}`
      : null,
    "",
    "RAW TRANSCRIPT:",
    "<<<TRANSCRIPT",
    rawText,
    "TRANSCRIPT",
    "",
    "Return the strict JSON object now.",
  ]
    .filter((l) => l !== null)
    .join("\n");

  const parsed = await requestCleanerJson({ system: CLEAN_SYSTEM_PROMPT, userMessage });

  const cleanedContent = typeof parsed.cleanedTranscript === "string" ? parsed.cleanedTranscript.trim() : rawText;
  const flags: TranscriptCleanerFlag[] = Array.isArray(parsed.flags)
    ? parsed.flags
        .filter((f: any) => f && typeof f === "object")
        .map((f: any) => ({
          type: String(f.type ?? "general"),
          text: f.text ? String(f.text) : undefined,
          reason: String(f.reason ?? "Flagged for review"),
          confidence: f.confidence ? String(f.confidence) : "low",
        }))
    : [];

  // Authority resolution. A deterministic, high-confidence swap is only safe
  // when the roster names that appear as SPEAKER LABELS resolve to a single,
  // unambiguous authority role:
  //   - exactly one distinct role among label matches → deterministic + high.
  //   - several label matches with CONFLICTING roles → ambiguous: fall back to
  //     the folder default but flag it low-confidence for manual confirmation
  //     (never silently auto-pick the first match).
  //   - no label matches → AI inference, default the role from the folder.
  let authorityRole: AuthorityRole;
  let authorityConfidence: "high" | "low";
  let authorityEvidence: string;
  const aiAuthority = parsed.authority ?? {};
  const labelRoles = Array.from(new Set(rosterHit.labelMatched.map((m) => m.role)));
  if (labelRoles.length === 1) {
    authorityRole = labelRoles[0];
    authorityConfidence = "high";
    const names = rosterHit.labelMatched.map((m) => m.name).join(", ");
    authorityEvidence = `Matched live roster name(s) "${names}" as speaker label(s) — deterministic authority swap.`;
  } else if (labelRoles.length > 1) {
    authorityRole = folder?.defaultAuthorityRole ?? DEFAULT_AUTHORITY_ROLE;
    authorityConfidence = "low";
    const detail = rosterHit.labelMatched.map((m) => `${m.name}=${m.role}`).join(", ");
    authorityEvidence = `Multiple roster names with different authority roles appear as speaker labels (${detail}) — cannot deterministically pick one; confirm or override.`;
  } else {
    authorityRole = folder?.defaultAuthorityRole ?? DEFAULT_AUTHORITY_ROLE;
    authorityConfidence = aiAuthority.confidence === "high" ? "high" : "low";
    authorityEvidence = String(aiAuthority.evidence ?? "Authority inferred from conversational role.");
  }

  if (authorityConfidence === "low") {
    flags.push({
      type: "low_confidence_attribution",
      reason: `Authority mapping is low-confidence — confirm or override. ${authorityEvidence}`,
      confidence: "low",
    });
  }

  const titleNeedsInput = parsed.titleNeedsInput === true || !parsed.detectedDateTime;
  const suggestedTitle = typeof parsed.suggestedTitle === "string" && parsed.suggestedTitle.trim()
    ? parsed.suggestedTitle.trim()
    : `${callTypeLabel(folder)}${sourceName ? ` — ${sourceName}` : ""}`;

  if (titleNeedsInput) {
    flags.push({
      type: "title_date",
      reason: "The date/time could not be determined from the content — supply it in the title.",
      confidence: "low",
    });
  }

  return {
    cleanedContent,
    authorityRole,
    authorityConfidence,
    authorityEvidence,
    suggestedTitle,
    titleNeedsInput,
    flags,
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Refinement chat.
// ───────────────────────────────────────────────────────────────────────────

const REFINE_SYSTEM_PROMPT = [
  "You are refining an already-cleaned call transcript based on an admin's",
  "instruction (e.g. 'Speaker 4 from 12:30 on is the member', 'Speaker 2 is the",
  "authority', 'merge the two coach labels'). Apply the change faithfully while",
  "preserving every distinct speaker and the authority labelling convention",
  "(authority role title vs Member N).",
  "",
  "Return STRICT JSON only with keys: cleanedTranscript (string, the full updated",
  "transcript), flags (array of { type, text, reason, confidence } — the refreshed",
  "review flags), authority (OPTIONAL — include ONLY if the instruction changed the",
  `authority mapping: { role: one of ${AUTHORITY_ROLES.join("/")}, confidence:`,
  "'high'|'low', evidence }), message (a one-sentence summary of what you changed).",
].join("\n");

export async function refineTranscript(args: {
  currentCleaned: string;
  instruction: string;
  transcriptType?: string | null;
  chatHistory?: TranscriptCleanerChatTurn[];
}): Promise<RefineTranscriptResult> {
  const { currentCleaned, instruction, transcriptType, chatHistory } = args;
  const folder = resolveSourceFolder(transcriptType ?? null);

  const priorTurns = (chatHistory ?? [])
    .slice(-6)
    .map((t) => `${t.role === "user" ? "Admin" : "Assistant"}: ${t.content}`)
    .join("\n");

  const userMessage = [
    `Transcript type: ${folder ? folder.label : "(untagged)"}`,
    priorTurns ? `Earlier refinement conversation:\n${priorTurns}` : null,
    "",
    "CURRENT CLEANED TRANSCRIPT:",
    "<<<TRANSCRIPT",
    currentCleaned,
    "TRANSCRIPT",
    "",
    `Admin instruction: ${instruction}`,
    "",
    "Return the strict JSON object now.",
  ]
    .filter((l) => l !== null)
    .join("\n");

  const parsed = await requestCleanerJson({ system: REFINE_SYSTEM_PROMPT, userMessage });

  const cleanedContent = typeof parsed.cleanedTranscript === "string" ? parsed.cleanedTranscript.trim() : currentCleaned;
  const flags: TranscriptCleanerFlag[] = Array.isArray(parsed.flags)
    ? parsed.flags
        .filter((f: any) => f && typeof f === "object")
        .map((f: any) => ({
          type: String(f.type ?? "general"),
          text: f.text ? String(f.text) : undefined,
          reason: String(f.reason ?? "Flagged for review"),
          confidence: f.confidence ? String(f.confidence) : "low",
        }))
    : [];

  const aiAuthority = parsed.authority ?? null;
  const result: RefineTranscriptResult = {
    cleanedContent,
    flags,
    assistantMessage: typeof parsed.message === "string" ? parsed.message : "Transcript updated.",
  };
  if (aiAuthority && typeof aiAuthority === "object") {
    if (aiAuthority.confidence === "high" || aiAuthority.confidence === "low") {
      result.authorityConfidence = aiAuthority.confidence;
    }
    if (aiAuthority.evidence != null) {
      result.authorityEvidence = String(aiAuthority.evidence);
    }
    // The role lives under `authority.role` (the prompt's contract); accept a
    // legacy top-level `authorityRole` too so older response shapes still apply.
    if (isAuthorityRole(aiAuthority.role)) {
      result.authorityRole = aiAuthority.role;
    } else if (isAuthorityRole(parsed.authorityRole)) {
      result.authorityRole = parsed.authorityRole;
    }
  } else if (isAuthorityRole(parsed.authorityRole)) {
    result.authorityRole = parsed.authorityRole;
  }
  return result;
}
