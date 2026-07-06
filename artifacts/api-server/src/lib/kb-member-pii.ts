import { db } from "@workspace/db";
import { usersTable } from "@workspace/db/schema";

/**
 * Residual MEMBER-PII backstop for the coaching-transcript value screener
 * (Task #1702).
 *
 * The existing content-privacy-filter (content-privacy-filter.ts) scrubs COACH
 * surnames, VA names and old brand references, but it does NOT know the member
 * roster — a coaching call routinely names the member being coached ("okay
 * Jordan, here's what I'd do…"). This backstop removes those residual member
 * names from KEPT screened moments (and any legacy titles/labels that still
 * carry them) by matching against the live `users.name` roster in the database,
 * NOT a hard-coded list.
 *
 * Deliberately conservative to avoid clobbering ordinary words:
 *  - full "First Last" matches are always redacted (very low false-positive), and
 *  - a member's FIRST name alone is redacted ONLY when its whole full name also
 *    appears somewhere in the same content (so the first name is confirmed to
 *    refer to that member in this call), never blindly on every dictionary word.
 * House vocabulary and product names are left untouched because the member
 * roster does not contain them.
 */

const MEMBER_TOKEN = "[member]";

// A word that, even if it appears in the roster as someone's first name, is too
// common/ambiguous to redact on its own. Full-name matches are still redacted.
const AMBIGUOUS_FIRST_NAMES = new Set<string>([
  "will", "may", "mark", "grant", "rich", "hope", "art", "guy", "drew", "chase",
  "faith", "joy", "sunny", "sky", "angel", "royal", "bill", "jack", "penny",
]);

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** A normalized display name split into its usable name tokens. */
export interface MemberNameEntry {
  full: string;
  first: string;
  last: string | null;
  tokens: string[];
}

/**
 * Parse a raw `users.name` value into a name entry. Returns null for empty /
 * single-character / non-alphabetic names that are not safe to match on.
 */
export function parseMemberName(raw: string): MemberNameEntry | null {
  const cleaned = (raw || "").replace(/\s+/g, " ").trim();
  if (!cleaned) return null;
  // Only letters, spaces, hyphens and apostrophes are name-like.
  if (!/^[\p{L}][\p{L}\s'.-]*$/u.test(cleaned)) return null;
  const tokens = cleaned.split(" ").filter((t) => t.replace(/[^\p{L}]/gu, "").length >= 2);
  if (tokens.length === 0) return null;
  return {
    full: tokens.join(" "),
    first: tokens[0],
    last: tokens.length > 1 ? tokens[tokens.length - 1] : null,
    tokens,
  };
}

/**
 * A prebuilt scrubber: full-name regexes (always applied) plus a per-first-name
 * map used for the "first name confirmed by full name in same text" pass.
 */
export interface MemberPiiScrubber {
  scrub: (text: string) => string;
  memberCount: number;
}

/**
 * Build a scrubber from a roster of raw `users.name` values. Pure/synchronous so
 * it is unit-testable without a database (see loadMemberPiiScrubber for the DB
 * wiring). Names shorter than 2 tokens still contribute a first-name-only entry,
 * but a bare first name is only redacted when the FULL name appears in the text.
 */
export function buildMemberPiiScrubber(rosterNames: string[]): MemberPiiScrubber {
  const entries: MemberNameEntry[] = [];
  const seenFull = new Set<string>();
  for (const raw of rosterNames) {
    const entry = parseMemberName(raw);
    if (!entry) continue;
    const key = entry.full.toLowerCase();
    if (seenFull.has(key)) continue;
    seenFull.add(key);
    entries.push(entry);
  }

  // Full-name matchers (multi-token only) — always redacted.
  const fullMatchers = entries
    .filter((e) => e.tokens.length > 1)
    .map((e) => new RegExp(`\\b${e.tokens.map(escapeRegExp).join("\\s+")}\\b`, "gi"));

  // First-name → its full names, for the confirmed-first-name pass.
  const firstToFull = new Map<string, string[]>();
  for (const e of entries) {
    if (e.tokens.length < 2) continue; // need a full name to confirm against
    const fn = e.first.toLowerCase();
    if (AMBIGUOUS_FIRST_NAMES.has(fn)) continue;
    const list = firstToFull.get(fn) ?? [];
    list.push(e.full.toLowerCase());
    firstToFull.set(fn, list);
  }

  const scrub = (text: string): string => {
    if (!text) return text;
    let out = text;

    // Pass 1: redact every full "First Last" occurrence.
    for (const re of fullMatchers) out = out.replace(re, MEMBER_TOKEN);

    // Pass 2: redact a bare first name ONLY when that member's full name also
    // appeared in the ORIGINAL text (confirms the reference).
    const lowerOriginal = text.toLowerCase();
    for (const [first, fulls] of firstToFull) {
      const confirmed = fulls.some((full) => lowerOriginal.includes(full));
      if (!confirmed) continue;
      const re = new RegExp(`\\b${escapeRegExp(first)}\\b`, "gi");
      out = out.replace(re, MEMBER_TOKEN);
    }

    // Collapse any doubled tokens produced by adjacent redactions.
    out = out.replace(/(\[member\]\s*){2,}/g, MEMBER_TOKEN + " ").trim();
    return out;
  };

  return { scrub, memberCount: entries.length };
}

/**
 * Load the live member roster from the DB and build a scrubber. Members only
 * (role='member') — coaches/VAs/admins are handled by the coach-name filter and
 * their first names are intentionally allowed in source content.
 */
export async function loadMemberPiiScrubber(): Promise<MemberPiiScrubber> {
  const rows = await db
    .select({ name: usersTable.name, role: usersTable.role })
    .from(usersTable);
  const rosterNames = rows.filter((r) => r.role === "member").map((r) => r.name);
  return buildMemberPiiScrubber(rosterNames);
}
