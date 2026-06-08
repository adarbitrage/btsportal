/**
 * Knowledge-base content privacy filter.
 *
 * Centralized scrubbing applied to EVERY piece of content that enters the AI
 * assistant knowledge base (knowledgebase_docs) — seed ingestion, admin manual
 * create/edit, and staging "push to live" — so that names removed for privacy
 * can never be re-introduced by a future import or upload.
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

export const PRIVACY_RULES: PrivacyRule[] = [
  // --- Coaches: full name -> first name only ---
  // NOTE: surnames have spelling variants in the source content (e.g. the
  // transcripts/QA articles use both "Wissbaum" and "Wisbaum"); each pattern
  // must tolerate every variant seen in the wild.
  { pattern: /Sasha\s+Bob[iy]lev/gi, replacement: "Sasha" },
  { pattern: /Bruce\s+Clark/gi, replacement: "Bruce" },
  { pattern: /Michael\s+Wiss?baum/gi, replacement: "Michael" },
  { pattern: /Todd\s+Rupp/gi, replacement: "Todd" },
  { pattern: /Robin\s+Shep[ah]rd/gi, replacement: "Robin" },

  // --- Coaches: strip orphaned surnames (left over from chunk splits) ---
  { pattern: /\bBob[iy]lev\b/gi, replacement: "" },
  { pattern: /\bWiss?baum\b/gi, replacement: "" },
  { pattern: /\bRupp\b/gi, replacement: "" },
  { pattern: /\bShep[ah]rd\b/gi, replacement: "" },
  { pattern: /\bClark\b/gi, replacement: "Bruce" },

  // --- Adam Cherrington / Charrington (person + agency name) ---
  { pattern: /\bAdam\s+Ch[ae]rrington\b/gi, replacement: "the instructor" },
  { pattern: /Ch[ae]rrington ?Media Support/gi, replacement: "the support team" },
  { pattern: /Ch[ae]rringtonmedia/gi, replacement: "oursupport" },
  { pattern: /Ch[ae]rringtong? ?Media/gi, replacement: "the agency" },
  { pattern: /Ch[ae]rrington Mentees/gi, replacement: "the mentees" },
  { pattern: /Ch[ae]rrington Support/gi, replacement: "support" },
  { pattern: /\bCh[ae]rringtong?\b/gi, replacement: "the agency" },

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
  if (doc.title !== undefined) out.title = scrubPrivateContent(doc.title) as T["title"];
  if (doc.content !== undefined) out.content = scrubPrivateContent(doc.content) as T["content"];
  return out;
}
