/**
 * Knowledge-base content privacy filter.
 *
 * Centralized scrubbing applied to EVERY piece of content that enters the AI
 * assistant knowledge base (knowledgebase_docs) — seed ingestion, admin manual
 * create/edit, and staging "push to live" — AND at answer-retrieval time on
 * every AI surface (chat RAG, voice KB search, 800-number KB search) so that
 * PII which predates a rule or entered through any bypassed path can never
 * reach a model or caller.
 *
 * HOW TO FORBID AN ADDITIONAL NAME:
 *   Add a rule to PRIVACY_RULES below in the "ADD NEW FORBIDDEN NAMES HERE"
 *   section. Rules run top-to-bottom, so put the most specific (multi-word)
 *   phrase BEFORE the bare surname so the longer match wins.
 *   - To remove a name entirely:        replacement: ""
 *   - To replace with a neutral term:    replacement: "the instructor"
 *
 * NOTE: This intentionally does NOT touch account-access data (user logins,
 * agency API config). It only sanitizes free-text knowledge-base content.
 */

export interface PrivacyRule {
  /** Must include the global flag so all occurrences are replaced. */
  pattern: RegExp;
  replacement: string;
}

/**
 * OLD-PROGRAM / OLD-BRAND REBRAND VOCABULARY — single source of truth.
 *
 * Transcripts from the old program still reference the old brand ("Cherrington
 * Media", "TCE", "The Cherrington Experience"), the founder ("Adam Cherrington")
 * and garbled/phonetic mistranscriptions of these (e.g. "the Cherring method").
 * As part of the portal rebrand these are converted to BTS wording so the mined
 * AI source-knowledge is on-brand.
 *
 * Policy (confirmed with the user):
 *   - Company / program references (Cherrington Media, TCE, The Cherrington
 *     Experience, and garbled/phonetic variants such as "the Cherring method")
 *     -> rebrand to "BTS".
 *   - The founder's personal name "Adam Cherrington" (and misspellings like
 *     "Adam Charrington") -> reduce to just "Adam" (keep the first name, drop
 *     the surname) — consistent with the first-name-only privacy convention.
 *
 * This constant feeds BOTH the transcript-cleaner prompts (clean + refine) and
 * the retrieval-time privacy rules below, so the two stay in lockstep. The
 * cleaner rewords lightly for natural flow; the privacy filter is the blunt
 * safety net for anything the cleaner missed (including the misspellings).
 */
export const OLD_BRAND_REBRAND_GUIDANCE: string[] = [
  'Company / program names — "Cherrington Media", "TCE", "The Cherrington Experience", and obvious phonetic or garbled mistranscriptions of these (e.g. "the Cherring method", "Charrington Media", "the Cherrington program") -> rebrand to "BTS", rewording lightly so the sentence still flows naturally rather than a rigid word-for-word swap.',
  'The founder\'s personal name — "Adam Cherrington" (and misspellings like "Adam Charrington") -> reduce to just "Adam" (keep the first name, drop the surname).',
];

export const PRIVACY_RULES: PrivacyRule[] = [
  // --- Generic PII: email addresses ---
  // Matches any RFC-5321-style address regardless of domain or who it belongs
  // to. Must run BEFORE named-person rules so an address like
  // "coach@buildtestscale.com" is caught here and not partially munged below.
  {
    pattern: /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g,
    replacement: "[contact redacted]",
  },

  // --- Generic PII: phone numbers ---
  // Covers the common North-American and international formats found in
  // knowledge-base content:
  //   +1 555-555-5555  /  (555) 555-5555  /  555.555.5555  /  5555555555
  // The leading word-boundary anchor (\b or a look-behind) is intentionally
  // omitted because phone numbers can appear without surrounding spaces (e.g.
  // after a colon). The trailing \b prevents a partial match on longer digit
  // strings (credit cards, etc.).
  {
    pattern: /(?:\+?1[\s.\-]?)?\(?\d{3}\)?[\s.\-]?\d{3}[\s.\-]?\d{4}\b/g,
    replacement: "[phone redacted]",
  },

  // --- Coaches: full name -> first name only ---
  // NOTE: surnames have spelling variants in the source content (e.g. the
  // transcripts/QA articles use both "Wissbaum" and "Wisbaum"); each pattern
  // must tolerate every variant seen in the wild.
  { pattern: /Sasha\s+Bob[iy]lev/gi, replacement: "Sasha" },
  { pattern: /Bruce\s+Clark/gi, replacement: "Bruce" },
  { pattern: /Michael\s+Wiss?baum/gi, replacement: "Michael" },
  { pattern: /Todd\s+Rupp/gi, replacement: "Todd" },
  // Shephard / Shepard / Shepherd / Sheperd — tolerates any h-insertion and
  // the a/e vowel variant seen across source files.
  { pattern: /Robin\s+Sheph?[ae]rd/gi, replacement: "Robin" },

  // --- Coaches: strip orphaned surnames (left over from chunk splits) ---
  { pattern: /\bBob[iy]lev\b/gi, replacement: "" },
  { pattern: /\bWiss?baum\b/gi, replacement: "" },
  { pattern: /\bRupp\b/gi, replacement: "" },
  { pattern: /\bSheph?[ae]rd\b/gi, replacement: "" },
  { pattern: /\bClark\b/gi, replacement: "Bruce" },

  // --- Old brand rebrand: Adam Cherrington -> "Adam"; company/program -> "BTS" ---
  // Aligned with OLD_BRAND_REBRAND_GUIDANCE (single source above). Ordered
  // specific -> general so the longest match wins. Founder's personal name keeps
  // the first name only (matches the coach convention); every company / program
  // reference (including phonetic/garbled variants) resolves to "BTS".
  { pattern: /\bAdam\s+Ch[ae]rrington\b/gi, replacement: "Adam" },
  { pattern: /\b(?:The\s+)?Ch[ae]rrington\s+Experience\b/gi, replacement: "BTS" },
  { pattern: /Ch[ae]rrington ?Media Support/gi, replacement: "BTS Support" },
  { pattern: /Ch[ae]rringtonmedia/gi, replacement: "BTS" },
  { pattern: /Ch[ae]rringtong? ?Media/gi, replacement: "BTS" },
  { pattern: /Ch[ae]rrington Mentees/gi, replacement: "BTS members" },
  { pattern: /Ch[ae]rrington Support/gi, replacement: "BTS Support" },
  // Garbled/phonetic variant of the program name (e.g. "the Cherring method").
  { pattern: /\bCh[ae]rring\s+method\b/gi, replacement: "BTS" },
  // Old program acronym (always uppercase in the wild).
  { pattern: /\bTCE\b/g, replacement: "BTS" },
  // Bare surname / -ton(g) variants -> BTS.
  { pattern: /\bCh[ae]rringtong?\b/gi, replacement: "BTS" },

  // ============================================================
  // ADD NEW FORBIDDEN NAMES HERE.
  // Example — remove a full name entirely:
  //   { pattern: /\bJane Doe\b/gi, replacement: "" },
  // Example — replace with a neutral term:
  //   { pattern: /\bJohn Smith\b/gi, replacement: "the coach" },
  // ============================================================

  // --- Cleanup: collapse artifacts left by the rules above ---
  { pattern: /\bthe the (agency|support|mentees|instructor)\b/gi, replacement: "the $1" },
  { pattern: / {2,}/g, replacement: " " },
];

/** Apply every privacy rule to a single string. Returns "" for nullish input. */
export function scrubPrivateContent(text: string | null | undefined): string {
  if (!text) return text ?? "";
  let out = text;
  for (const rule of PRIVACY_RULES) {
    out = out.replace(rule.pattern, rule.replacement);
  }
  return out;
}

/**
 * Convenience helper for knowledge-base docs: scrubs `title` and `content`
 * (leaving other fields untouched). Only scrubs fields that are present.
 */
export function scrubKbDoc<T extends { title?: string | null; content?: string | null }>(
  doc: T,
): T {
  const out: T = { ...doc };
  // Only scrub when the field is a non-null string — preserve null/undefined as-is
  // so the caller's DB constraints (NOT NULL vs nullable) are not silently violated.
  if (doc.title != null) out.title = scrubPrivateContent(doc.title) as T["title"];
  if (doc.content != null) out.content = scrubPrivateContent(doc.content) as T["content"];
  return out;
}
