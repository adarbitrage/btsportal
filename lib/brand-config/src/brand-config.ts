/**
 * Single source of truth for per-offer brand strings.
 *
 * Brand strings are kept in code config intentionally — an admin-editable
 * table would risk corrupting the token keys that lessons and email templates
 * embed. If a slug needs to be promoted to a DB-editable source later, this
 * module is the one place to update.
 *
 * Exports:
 *   - `BRAND_TABLE`          — raw locked table (slug → { full, short })
 *   - `brandTokens(slug)`    — flat token map for `substituteString`
 *   - `brandStrings(slug)`   — `{ full, short, possessive, shortPossessive }`
 *                              for the client hook
 */

export type BrandSlug =
  | "yse_front_end"
  | "backroad"
  | "offmarket"
  | "reserve_income"
  | "silent_partner"
  | "test_like_mad"
  | "bts";

interface BrandEntry {
  full: string;
  short: string;
}

/**
 * Locked brand table.  `bts` is the canonical fallback used when no per-offer
 * brand is resolved.
 *
 * NOTE: `test_like_mad` short form is "Test Like Mad" pending owner
 * confirmation (candidate: "TLM").  Change the single value here if confirmed.
 */
export const BRAND_TABLE: Record<BrandSlug, BrandEntry> = {
  yse_front_end:    { full: "Your Second Engine",             short: "YSE" },
  backroad:         { full: "The Backroad System",            short: "Backroad" },
  offmarket:        { full: "The Off-Market Affiliate System", short: "Off-Market" },
  reserve_income:   { full: "The Reserve Income System",      short: "Reserve Income" },
  silent_partner:   { full: "The Silent Partner System",      short: "Silent Partner" },
  test_like_mad:    { full: "Test Like Mad",                  short: "Test Like Mad" },
  bts:              { full: "Build Test Scale",               short: "BTS" },
};

/**
 * Trademark glyph appended to every brand's FULL display name (Task #1635).
 * Short forms (e.g. "BTS", "YSE") are never marked. Kept as a single named
 * constant so the mark itself — and any future decision to drop it — lives
 * in exactly one place.
 */
const TM = "\u2122";

/**
 * Derive the possessive form: append `'` when the string ends in `s` or `S`
 * (case-insensitive — handles acronyms like "BTS"), else append `'s`.
 *
 * IMPORTANT: always call this on the UNMARKED name (`entry.full`/`entry.short`,
 * never a string with `TM` already appended). A possessive built from the
 * marked name would render "Build Test Scale™'s" — the mark glyph sitting
 * mid-word before the apostrophe — which is not how ™ possessives are
 * conventionally written.
 */
function possessive(str: string): string {
  return str.toLowerCase().endsWith("s") ? `${str}'` : `${str}'s`;
}

/**
 * Returns the flat token map consumed by `substituteString`.
 *
 * Keys:
 *   `brand`                — full brand name, trademark-marked
 *   `brand.short`          — short brand name (unmarked)
 *   `brand.possessive`     — possessive of the full name (derived from the
 *                            UNMARKED name, so no mark glyph appears mid-word)
 *   `brand.short.possessive` — possessive of the short name (unmarked)
 *
 * Unknown slugs fall back to the `bts` entry so callers never receive
 * undefined tokens.
 */
export function brandTokens(slug: string): Record<string, string> {
  const entry = (BRAND_TABLE as Record<string, BrandEntry>)[slug] ?? BRAND_TABLE.bts;
  return {
    "brand":                   `${entry.full}${TM}`,
    "brand.short":             entry.short,
    "brand.possessive":        possessive(entry.full),
    "brand.short.possessive":  possessive(entry.short),
  };
}

export interface BrandStrings {
  full: string;
  short: string;
  possessive: string;
  shortPossessive: string;
}

/**
 * Returns the brand strings object used by the client-side brand hook.
 *
 * `full` carries the trademark mark; `short` and both possessive forms are
 * always derived from/equal to the unmarked name.
 *
 * Unknown slugs fall back to the `bts` entry.
 */
export function brandStrings(slug: string): BrandStrings {
  const entry = (BRAND_TABLE as Record<string, BrandEntry>)[slug] ?? BRAND_TABLE.bts;
  return {
    full:           `${entry.full}${TM}`,
    short:          entry.short,
    possessive:     possessive(entry.full),
    shortPossessive: possessive(entry.short),
  };
}
