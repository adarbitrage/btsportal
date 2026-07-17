/**
 * Review-gate risk analysis (Task #1752 — "Sharpen the review-and-publish gate").
 *
 * PURE, line-oriented analysis of a staging draft's CURRENT text so the
 * reviewer sees risky passages before publish:
 *   - flags threaded from synthesis: inline [SITUATIONAL] / [CONTEXT-BOUND] /
 *     [ANOMALY] bullet tags and "> ⚠️ SOURCE CONFLICT (for reviewer):" blockquotes
 *     (the exact contract kb-synthesis instructs the model to emit),
 *   - situational numbers (dollar figures, per-day/week/month rates, percents)
 *     on lines NOT already tagged situational,
 *   - time-sensitive phrasing ("right now", "currently", month-year dates …),
 *   - residual private-content matches (the deterministic PRIVACY_RULES set —
 *     coach surnames, emails, phones, old brand).
 *
 * This runs at REVIEW time against editedContent ?? content (so it stays
 * accurate through edits/refines) via GET /staging/:id/review-insights, and its
 * summary-level detectors also feed computeRiskFlags (kb-flags.ts) so the
 * existing chip/severity pattern surfaces the same signals at triage.
 */

import { PRIVACY_RULES } from "./content-privacy-filter";
import type { FlagSeverity } from "./kb-flags";

// Local mirror of kb-synthesis's SOURCE_CONFLICT_MARKER payload — kept as a
// bare substring (no "> ⚠️" prefix) so mangled markdown still matches. A unit
// test asserts the real marker contains this prefix so the two never drift.
export const SOURCE_CONFLICT_PREFIX = "SOURCE CONFLICT (for reviewer):";

// Local mirror of kb-nav-grounding's NAV_CONFLICT_MARKER payload — same
// bare-substring pattern; a unit test asserts the real marker contains this
// prefix so the two never drift.
export const NAV_CONFLICT_PREFIX = "NAVIGATION CONFLICT (for reviewer):";

// Local mirrors of kb-synthesis's approved-baseline markers (Task: baseline
// injection) — same bare-substring pattern; unit tests assert the real markers
// contain these prefixes so the two never drift.
export const BASELINE_CONFLICT_PREFIX = "BASELINE CONFLICT (for reviewer):";
export const COACHING_DRIFT_PREFIX = "COACHING DRIFT (for reviewer):";

export type ReviewHighlightKind =
  | "source_conflict"
  | "navigation_conflict"
  | "baseline_conflict"
  | "coaching_drift"
  | "synthesis_situational"
  | "synthesis_context_bound"
  | "synthesis_anomaly"
  | "situational_number"
  | "time_sensitive"
  | "privacy_residue";

export interface ReviewHighlight {
  kind: ReviewHighlightKind;
  severity: FlagSeverity;
  label: string;
  /** Exact matched substring (for in-line marking). */
  excerpt: string;
  /** 0-based line index in the analyzed content. */
  line: number;
  /** The full text of that line (for exact-match soften/remove actions). */
  lineText: string;
  note: string;
}

export const HIGHLIGHT_META: Record<
  ReviewHighlightKind,
  { severity: FlagSeverity; label: string; note: string }
> = {
  source_conflict: {
    severity: "critical",
    label: "Source conflict",
    note: "Synthesis found sources that genuinely disagree — adjudicate and rewrite or remove this blockquote before publishing.",
  },
  navigation_conflict: {
    severity: "high",
    label: "Navigation conflict",
    note: "The draft references a legacy portal location (or one the nav map can't confirm) — rewrite it to the current page name/path (or adjudicate the mapping) and remove this blockquote before publishing.",
  },
  baseline_conflict: {
    severity: "critical",
    label: "Baseline conflict",
    note: "A curriculum source contradicts the published, human-edited baseline doc — decide which position is current truth, rewrite accordingly and remove this blockquote before publishing.",
  },
  coaching_drift: {
    severity: "medium",
    label: "Coaching drift",
    note: "Multiple coaching sources consistently teach this differently than the published baseline. The baseline text was kept — decide whether the field process has evolved, then update or dismiss and remove this blockquote.",
  },
  synthesis_situational: {
    severity: "high",
    label: "Situational (from synthesis)",
    note: "Figures here are one member's situation or a point-in-time answer — keep the context attached or soften; never publish as a universal target.",
  },
  synthesis_context_bound: {
    severity: "medium",
    label: "Context-bound walkthrough",
    note: "Live screen-share narration — topic evidence, not standalone quotable teaching. Rework into general guidance or remove.",
  },
  synthesis_anomaly: {
    severity: "medium",
    label: "Segment anomaly",
    note: "The source segment boundaries were unreliable — verify this passage reads as a complete, correct thought.",
  },
  situational_number: {
    severity: "medium",
    label: "Unverified figure",
    note: "A specific number that is not tagged situational — confirm it is a universal, current figure (not one member's case) before publishing.",
  },
  time_sensitive: {
    severity: "medium",
    label: "Time-sensitive phrasing",
    note: "Phrasing tied to a point in time — this will age. Rewrite timelessly or confirm it will stay true.",
  },
  privacy_residue: {
    severity: "high",
    label: "Private-content match",
    note: "Matches the privacy scrub rules (name/email/phone/old brand). It WILL be auto-scrubbed at publish, but verify the sentence still reads correctly and no member context leaks around it.",
  },
};

// ── Pattern vocabularies ─────────────────────────────────────────────────────

const SYNTH_TAGS: ReadonlyArray<{ tag: string; kind: ReviewHighlightKind }> = [
  { tag: "[SITUATIONAL]", kind: "synthesis_situational" },
  { tag: "[SITUATIONAL NUMBER", kind: "synthesis_situational" },
  { tag: "[CONTEXT-BOUND]", kind: "synthesis_context_bound" },
  { tag: "[CONTEXT-BOUND WALKTHROUGH", kind: "synthesis_context_bound" },
  { tag: "[ANOMALY]", kind: "synthesis_anomaly" },
  { tag: "[SEGMENT ANOMALY", kind: "synthesis_anomaly" },
];

const NUMBER_PATTERNS: ReadonlyArray<RegExp> = [
  /\$\s?\d[\d,]*(?:\.\d+)?[kKmM]?\b/g, // $40, $1,500, $10k
  /\b\d[\d,]*(?:\.\d+)?\s*(?:\/|per\s+)(?:day|week|month|year|click|lead|sale)\b/gi,
  /\b\d{1,3}(?:\.\d+)?\s?%/g,
];

const TIME_SENSITIVE_PATTERNS: ReadonlyArray<RegExp> = [
  /\b(?:right now|currently|at the moment|as of (?:now|today|this writing)|these days|recently|lately)\b/gi,
  /\b(?:this|last|next)\s+(?:week|month|year|quarter)\b/gi,
  /\b(?:just|newly)\s+(?:launched|released|added|changed|updated|rolled out)\b/gi,
  /\bbrand[- ]new\b/gi,
  /\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+20\d{2}\b/g,
  /\b(?:in|since|back in|as of)\s+20\d{2}\b/gi,
];

function findMatches(line: string, re: RegExp): string[] {
  const out: string[] = [];
  const rx = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
  for (const m of line.matchAll(rx)) {
    if (m[0]) out.push(m[0]);
  }
  return out;
}

/** Analyze a draft's current text. Pure — unit-tested. */
export function analyzeDraftForReview(content: string): ReviewHighlight[] {
  const lines = content.split("\n");
  const highlights: ReviewHighlight[] = [];
  const seen = new Set<string>();

  const push = (kind: ReviewHighlightKind, excerpt: string, line: number) => {
    const key = `${kind}|${line}|${excerpt}`;
    if (seen.has(key)) return;
    seen.add(key);
    const meta = HIGHLIGHT_META[kind];
    highlights.push({
      kind,
      severity: meta.severity,
      label: meta.label,
      excerpt,
      line,
      lineText: lines[line],
      note: meta.note,
    });
  };

  lines.forEach((line, i) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    // 1. Source-conflict blockquotes (synthesis contract).
    if (trimmed.includes(SOURCE_CONFLICT_PREFIX)) {
      push("source_conflict", trimmed, i);
    }

    // 1b. Navigation-conflict blockquotes (navigation grounding contract).
    if (trimmed.includes(NAV_CONFLICT_PREFIX)) {
      push("navigation_conflict", trimmed, i);
    }

    // 1c. Approved-baseline blockquotes (baseline-injection contract).
    if (trimmed.includes(BASELINE_CONFLICT_PREFIX)) {
      push("baseline_conflict", trimmed, i);
    }
    if (trimmed.includes(COACHING_DRIFT_PREFIX)) {
      push("coaching_drift", trimmed, i);
    }

    // 2. Inline synthesis tags.
    let synthTagged = false;
    for (const { tag, kind } of SYNTH_TAGS) {
      const at = line.indexOf(tag);
      if (at !== -1) {
        synthTagged = true;
        // Excerpt is the exact substring from the line (through the closing
        // bracket for prefix-form tags) so inline <mark>ing always matches.
        let excerpt = tag;
        if (!tag.endsWith("]")) {
          const close = line.indexOf("]", at);
          excerpt = close !== -1 ? line.slice(at, close + 1) : line.slice(at).trimEnd();
        }
        push(kind, excerpt, i);
      }
    }

    // 3. Situational numbers — only on lines NOT already synthesis-tagged
    //    (a tagged line already carries the stronger signal).
    if (!synthTagged) {
      for (const re of NUMBER_PATTERNS) {
        for (const m of findMatches(line, re)) push("situational_number", m, i);
      }
    }

    // 4. Time-sensitive phrasing.
    for (const re of TIME_SENSITIVE_PATTERNS) {
      for (const m of findMatches(line, re)) push("time_sensitive", m, i);
    }

    // 5. Residual private-content matches (deterministic scrub rules).
    for (const rule of PRIVACY_RULES) {
      for (const m of findMatches(line, rule.pattern)) {
        // Skip pure-whitespace cleanup rules and empty matches.
        if (!m.trim()) continue;
        push("privacy_residue", m, i);
      }
    }
  });

  return highlights;
}

// ── Summary-level detectors (feed computeRiskFlags) ──────────────────────────

export function hasSourceConflictMarker(content: string): boolean {
  return content.includes(SOURCE_CONFLICT_PREFIX);
}

export function hasNavigationConflictMarker(content: string): boolean {
  return content.includes(NAV_CONFLICT_PREFIX);
}

export function hasBaselineConflictMarker(content: string): boolean {
  return content.includes(BASELINE_CONFLICT_PREFIX);
}

export function hasCoachingDriftMarker(content: string): boolean {
  return content.includes(COACHING_DRIFT_PREFIX);
}

export function hasSynthesisRiskTags(content: string): boolean {
  return SYNTH_TAGS.some(({ tag }) => content.includes(tag));
}

export function hasTimeSensitivePhrasing(content: string): boolean {
  return TIME_SENSITIVE_PATTERNS.some((re) =>
    new RegExp(re.source, re.flags.replace("g", "")).test(content),
  );
}

export function hasPrivacyResidue(content: string): boolean {
  return PRIVACY_RULES.some((rule) => {
    const rx = new RegExp(rule.pattern.source, rule.pattern.flags.replace("g", ""));
    const m = content.match(rx);
    return m !== null && m[0].trim().length > 0;
  });
}
