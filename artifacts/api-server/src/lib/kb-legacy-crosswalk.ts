/**
 * Legacy → current crosswalk (Task #3, foundation §8.1).
 *
 * Human-verified record of how *old* BTS terminology, brands, and portal
 * locations map to what members see *today*. Source material — knowledge-base
 * text, coaching transcripts, the BTS agreement, old emails — predates several
 * renames and relocations, so an answer grounded in that material can name a
 * brand, product, or page that no longer exists. This registry is the single
 * structured source the authoring step (Task #2) and the answer-time rules
 * (Task #6) consume to translate legacy phrasings into the current truth.
 *
 * This module is data only: it deliberately does NOT wire itself into any
 * prompt (that is Task #7). It is consumed by:
 *   - the navigation map / Operations seed (human-readable crosswalk doc), and
 *   - downstream authoring/answer-time translation (later tasks).
 *
 * Confidence:
 *   - "confirmed":  the mapping is established and safe to apply silently.
 *   - "uncertain":  the rename/relocation is suspected but NOT yet human-
 *                   confirmed. Flagged so a human verifies the exact mapping
 *                   before answer-time silently rewrites member-facing text.
 */

export type CrosswalkKind = "term" | "brand" | "location";
export type CrosswalkConfidence = "confirmed" | "uncertain";

export interface CrosswalkEntry {
  /** One or more legacy phrasings/aliases that should resolve to `current`. */
  legacy: string[];
  /** The current BTS phrasing / name / location to use instead. */
  current: string;
  kind: CrosswalkKind;
  /** Why the mapping exists / how to apply it. */
  note?: string;
  confidence: CrosswalkConfidence;
}

export const LEGACY_CROSSWALK: readonly CrosswalkEntry[] = [
  // ── Brands ────────────────────────────────────────────────────────────────
  {
    legacy: [
      "Cherrington",
      "Cherrington Media",
      "The Cherrington Experience",
      "TCE",
    ],
    current: "BTS (Build Test Scale)",
    kind: "brand",
    note: "The membership and all its software/coaching are branded BTS / Build Test Scale today. Older agreements, emails, and transcripts use the prior company/brand name.",
    confidence: "confirmed",
  },

  // ── Terms ─────────────────────────────────────────────────────────────────
  {
    legacy: [
      "21-day Blitz",
      "21 day Blitz",
      "14-day Blitz",
      "14 day Blitz",
      "21 Days to Scale",
    ],
    current: "The Blitz",
    kind: "term",
    note: "There is exactly one Blitz with no day-count variant. Restate any day-count phrasing simply as 'The Blitz'. (Mirrors the existing always-The-Blitz rule already enforced in the chat + voice prompts.)",
    confidence: "confirmed",
  },
  {
    legacy: ["MaxWeb", "Affiliati"],
    current: "Media Mavens (or ClickBank)",
    kind: "term",
    note: "The supported affiliate networks today are Media Mavens and ClickBank. Older lessons reference networks that are no longer part of BTS.",
    confidence: "confirmed",
  },

  // ── Locations (where to find X in the portal) ──────────────────────────────
  {
    legacy: ["Lesson Library", "training library", "course library"],
    current: "The Blitz (/blitz)",
    kind: "location",
    note: "The standalone Lesson/Training Library was retired; The Blitz is the single source for all training content and the sole progress tracker.",
    confidence: "confirmed",
  },
  {
    legacy: ["Creative Vault", "the Vault", "asset vault"],
    current: "Resource Library — Creative Drive (/resource-library)",
    kind: "location",
    note: "Downloadable ad templates, guides, logos, and the P&L Tracker live in the Resource Library (Creative Drive).",
    confidence: "uncertain",
  },
  {
    legacy: ["Launchpad onboarding call", "kick-off call", "kickoff call"],
    current: "Coaching — book a 1-on-1 / Private Coaching (/coaching/book-session)",
    kind: "location",
    note: "Legacy onboarding/kick-off call phrasing maps to today's coaching booking flow. Exact legacy→current call mapping needs human confirmation before silent rewrite.",
    confidence: "uncertain",
  },
  {
    legacy: ["quickstart guide", "getting started guide", "core training"],
    current: "7 Pillars (/core-training/7-pillars) and The Blitz (/blitz)",
    kind: "location",
    note: "Foundational/quickstart material now lives across the 7 Pillars and The Blitz. The precise legacy document → current page mapping is unconfirmed.",
    confidence: "uncertain",
  },
];

/** All crosswalk entries of a given kind. */
export function crosswalkByKind(kind: CrosswalkKind): CrosswalkEntry[] {
  return LEGACY_CROSSWALK.filter((e) => e.kind === kind);
}

/** Entries still awaiting human confirmation (uncertain mappings). */
export function uncertainCrosswalkEntries(): CrosswalkEntry[] {
  return LEGACY_CROSSWALK.filter((e) => e.confidence === "uncertain");
}
