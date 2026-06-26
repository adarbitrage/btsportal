/**
 * KB source screening (Task #2, step 15) — runs BEFORE any mining.
 *
 * Gives every transcript source a `disposition` (training | quarantined) and an
 * `authorityRole` (strategic_coach | va | curriculum | internal). Internal /
 * private recordings are auto-quarantined by NAME so the miner never drafts
 * from them and they never reach members.
 *
 * Detection is whole-phrase (e.g. "check-in", never the bare substring "check",
 * so a legit "Campaign Setup Checking" call isn't falsely flagged) plus a
 * known-internal seed name list from the corpus scan. Conservative default:
 * anything not confidently identifiable as member-facing training stays
 * quarantined until a human clears it.
 */

import {
  type SourceDisposition,
  type AuthorityRole,
  authorityRoleFromCoachType,
  DEFAULT_AUTHORITY_ROLE,
} from "./kb-taxonomy";

export interface SourceScreenResult {
  disposition: SourceDisposition;
  reason: string;
}

/** Whole-phrase internal-meeting patterns → auto-quarantine. */
const INTERNAL_PATTERNS: ReadonlyArray<{ re: RegExp; reason: string }> = [
  { re: /\bmeeting information\b/i, reason: "Personal meeting recording ('Meeting Information')" },
  // Requires a real separator between "check" and "in" so "Checking" never matches.
  { re: /\bcheck[\s_-]+in\b/i, reason: "Internal check-in" },
  { re: /\bpersonal meeting room\b/i, reason: "Personal meeting room" },
  { re: /\buntitled\b/i, reason: "Untitled / unidentifiable recording" },
  { re: /\bzoom meeting\b/i, reason: "Generic 'Zoom Meeting' (unidentifiable)" },
  { re: /\b(team|staff|internal)\b[\s\S]{0,20}\b(sync|meeting|call|standup)\b/i, reason: "Internal team/staff sync" },
  // TCE Support / Concierge "Coaching Weekly" — ambiguous internal-ops cadence;
  // quarantine pending an explicit human confirm.
  { re: /\b(support|concierge)\s+coaching\s+weekly\b/i, reason: "Ambiguous ops cadence (quarantine pending confirm)" },
];

/**
 * Known-internal people from the corpus scan (founders / staff). A source whose
 * name contains one of these is a private/internal recording. Lowercased,
 * whole-word matched.
 */
const INTERNAL_SEED_NAMES: readonly string[] = [
  "adam field",
  "dara dameron",
  "mark blyn",
  "john freese",
];

function containsWholeWord(haystack: string, needle: string): boolean {
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped}\\b`, "i").test(haystack);
}

/**
 * Screen a source NAME for disposition. Pure + name-based: returns
 * `quarantined` for any internal-pattern / seed-name match, else `training`.
 *
 * NOTE: callers decide the conservative default for genuinely unidentifiable
 * sources (e.g. a brand-new uncategorised pool) — this returns `training` only
 * when a name is recognised as member-facing, and `quarantined` otherwise via
 * {@link screenSourceName}'s explicit checks. For pools we DO trust by
 * construction (the strategic-coaching corpus, the curriculum video corpus,
 * the VA 1:1 docx pool) the populate sweep passes `trustedPool=true`.
 */
export function screenSourceName(name: string, opts?: { trustedPool?: boolean }): SourceScreenResult {
  const clean = (name ?? "").trim();
  if (!clean) {
    return { disposition: "quarantined", reason: "Empty / unidentifiable source name" };
  }

  for (const { re, reason } of INTERNAL_PATTERNS) {
    if (re.test(clean)) return { disposition: "quarantined", reason };
  }
  for (const seed of INTERNAL_SEED_NAMES) {
    if (containsWholeWord(clean, seed)) {
      return { disposition: "quarantined", reason: `Known-internal participant ('${seed}')` };
    }
  }

  // No internal signal. Trusted pools are member-facing training by
  // construction; anything else stays quarantined (conservative default).
  return opts?.trustedPool
    ? { disposition: "training", reason: "Member-facing training source" }
    : { disposition: "quarantined", reason: "Unidentified source — quarantined by default" };
}

/** Coarse source kind for a pool. */
export type SourceKind = "coaching_call" | "va_docx" | "video" | "meeting" | "unknown";

/**
 * Resolve the authority role for a source.
 *
 * @param roster - name→coaches.type map from the live `coaches` table.
 */
export function resolveAuthorityRole(
  args: {
    sourceName: string;
    sourceKind: SourceKind;
    coachName?: string | null;
    quarantined: boolean;
  },
  roster: ReadonlyMap<string, string>,
): { authorityRole: AuthorityRole; coachName: string | null } {
  const { sourceName, sourceKind, coachName, quarantined } = args;

  if (quarantined) return { authorityRole: "internal", coachName: coachName ?? null };
  if (sourceKind === "video") return { authorityRole: "curriculum", coachName: null };
  if (sourceKind === "va_docx") {
    return { authorityRole: "va", coachName: coachName ?? null };
  }

  // coaching_call: try to find a roster coach mentioned in the name (or the
  // explicit coachName) and map their type → role.
  const candidate = coachName?.trim().toLowerCase();
  if (candidate && roster.has(candidate)) {
    return { authorityRole: authorityRoleFromCoachType(roster.get(candidate)), coachName: coachName! };
  }
  for (const [name, type] of roster) {
    if (containsWholeWord(sourceName, name)) {
      return { authorityRole: authorityRoleFromCoachType(type), coachName: name };
    }
  }
  // Strategic-coaching corpus default: a member-facing 1:1/group call with no
  // resolvable coach is still a strategy call (human can correct).
  return { authorityRole: "strategic_coach", coachName: coachName ?? null };
}

export { DEFAULT_AUTHORITY_ROLE };
