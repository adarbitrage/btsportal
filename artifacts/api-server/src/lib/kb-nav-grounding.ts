/**
 * KB navigation grounding (Task #1778).
 *
 * Grounds synthesized truth-doc drafts in the CURRENT portal navigation:
 *
 *  1. `buildNavigationGroundingSection()` — the member-only nav map (rendered
 *     from `@workspace/portal-nav-map`, the same registry the seeded
 *     Operations navigation doc uses) plus authoritative-navigation rules,
 *     injected into the synthesis consolidation prompt. Confirmed legacy
 *     locations (crosswalk `confidence: "confirmed"`) are rewritten to their
 *     current name/path; uncertain ones get a visible reviewer callout.
 *
 *  2. `screenDraftForLegacyNavigation()` / `applyNavigationScreen()` — a
 *     DETERMINISTIC post-draft screen over the crosswalk's location entries.
 *     If the model ignored the prompt and a legacy location phrase survives in
 *     the draft, the screen appends a `NAVIGATION CONFLICT` blockquote (same
 *     visual pattern as the synthesis SOURCE CONFLICT marker) so the reference
 *     is rewritten or flagged, never published silently.
 *
 *  3. `getNavMapVersion()` — the nav-map content hash stamped on every
 *     synthesized draft (kb_staging_docs.nav_map_version) so the boot-time
 *     drift scan (kb-nav-drift-scan.ts) knows which map a draft was written
 *     against.
 */

import {
  renderNavigationMapLines,
  computeNavMapVersion,
} from "@workspace/portal-nav-map";
import { crosswalkByKind, type CrosswalkEntry } from "./kb-legacy-crosswalk";

// Reviewer-visible navigation-conflict marker. Mirrors SOURCE_CONFLICT_MARKER
// in kb-synthesis.ts; kb-review-risk.ts keeps a bare-prefix mirror
// (NAV_CONFLICT_PREFIX) with a lockstep test so the two can never drift.
export const NAV_CONFLICT_MARKER = "> ⚠️ NAVIGATION CONFLICT (for reviewer):";

/** Content-hash version of the nav map the draft is being written against. */
export function getNavMapVersion(): string {
  return computeNavMapVersion();
}

/**
 * Prompt section: current member nav map + authoritative-navigation rules.
 * Injected into the synthesis consolidation system prompt.
 */
export function buildNavigationGroundingSection(): string {
  const mapText = renderNavigationMapLines().join("\n").trim();

  const locations = crosswalkByKind("location");
  const confirmed = locations.filter((e) => e.confidence === "confirmed");
  const uncertain = locations.filter((e) => e.confidence === "uncertain");

  const confirmedLines = confirmed
    .map((e) => `  - ${e.legacy.join(" / ")} → ${e.current}`)
    .join("\n");
  const uncertainLines = uncertain
    .map((e) => `  - ${e.legacy.join(" / ")} → possibly ${e.current}`)
    .join("\n");

  return `NAVIGATION GROUNDING — the CURRENT member portal navigation (authoritative):
${mapText}

NAVIGATION RULES:
- When the doc tells a member WHERE to find something, use ONLY the current names and paths from the map above. Source material predates several renames/relocations — never repeat an old location name as if it still exists.
- Confirmed legacy → current location mappings (REWRITE these to the current name/path whenever a source uses the old name):
${confirmedLines || "  (none)"}
- Uncertain legacy locations (the current equivalent is NOT confirmed). Do NOT silently rewrite these: keep the point, avoid asserting the old location exists, and add a visible blockquote line starting exactly "${NAV_CONFLICT_MARKER}" naming the legacy location so a human reviewer adjudicates:
${uncertainLines || "  (none)"}
- Never invent portal pages, menu names or paths that are not in the map above. If sources reference a location you cannot match to the map, flag it with the same "${NAV_CONFLICT_MARKER}" blockquote instead of guessing.
- The map is MEMBER navigation only — never direct members to admin, coach or partner areas.`;
}

// ── Deterministic post-draft screen ──────────────────────────────────────────

export interface LegacyNavMatch {
  /** The exact legacy phrase found in the draft. */
  phrase: string;
  /** 0-based line index. */
  line: number;
  entry: CrosswalkEntry;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Scan a draft for surviving legacy portal-location phrases (crosswalk
 * `kind: "location"`). Whole-phrase, case-insensitive, line-oriented; lines
 * that are already NAVIGATION CONFLICT callouts are skipped so re-screening
 * an already-flagged draft never re-flags its own callouts.
 */
export function screenDraftForLegacyNavigation(content: string): LegacyNavMatch[] {
  const locations = crosswalkByKind("location");
  const lines = content.split("\n");
  const matches: LegacyNavMatch[] = [];

  lines.forEach((lineText, i) => {
    if (lineText.includes("NAVIGATION CONFLICT (for reviewer):")) return;
    for (const entry of locations) {
      for (const legacy of entry.legacy) {
        const re = new RegExp(`(?<![\\w])${escapeRegExp(legacy)}(?![\\w])`, "i");
        const m = lineText.match(re);
        if (m && m[0]) {
          matches.push({ phrase: m[0], line: i, entry });
        }
      }
    }
  });

  return matches;
}

/**
 * Append a reviewer callout for every DISTINCT legacy location phrase that
 * survived drafting. Returns the body unchanged when the draft is clean.
 * Guarantees a stale reference is rewritten (by the prompt) or flagged (here)
 * — never published silently.
 */
export function applyNavigationScreen(body: string): string {
  const matches = screenDraftForLegacyNavigation(body);
  if (matches.length === 0) return body;

  const seen = new Set<string>();
  const callouts: string[] = [];
  const lowerBody = body.toLowerCase();
  for (const m of matches) {
    const key = m.phrase.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    // Idempotency: skip phrases already flagged by a previous screen pass.
    if (lowerBody.includes(`legacy portal location "${key}"`)) continue;
    const suffix =
      m.entry.confidence === "uncertain"
        ? " (mapping NOT confirmed — adjudicate before rewriting)"
        : "";
    callouts.push(
      `${NAV_CONFLICT_MARKER} draft still references the legacy portal location "${m.phrase}" — current: ${m.entry.current}${suffix}. Rewrite to the current name/path before publishing.`,
    );
  }

  if (callouts.length === 0) return body;
  return `${body}\n\n${callouts.join("\n")}`;
}
