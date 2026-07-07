/**
 * DB-backed BTS house-term auto-correct overrides (Task #1676).
 *
 * The Transcript Cleaner auto-corrects near-miss spellings of BTS's proprietary
 * tools via a CODE baseline alias map (`BTS_TERM_ALIASES`) plus a conservative
 * fuzzy pass. Historically a newly-observed misspelling that the fuzzy pass
 * didn't catch required a one-line code change. This module lets an admin add a
 * confirmed misspelling → canonical pair with NO deploy: rows in
 * `bts_house_term_aliases` are merged with the code baseline into the EFFECTIVE
 * alias map that {@link normalizeBtsHouseTerms} reads at clean/refine time.
 *
 * Mirrors the kb-tool-tags pattern: only ADDITIONS live in the DB (the shipped
 * baseline stays authoritative in code and is never duplicated), the merged map
 * is cached in memory and registered into the cleaner via
 * {@link setEffectiveHouseTermAliases}, refreshed on boot and after every admin
 * mutation. A DB read failure keeps the last good map — it never collapses.
 */

import { db } from "@workspace/db";
import { btsHouseTermAliasesTable } from "@workspace/db/schema";
import {
  BTS_TERM_ALIASES,
  setEffectiveHouseTermAliases,
} from "./transcript-cleaner.js";

/**
 * Build the effective alias map: the lowercased code baseline first, then the
 * enabled DB overrides on top (a DB row with the same key wins; disabled rows
 * are ignored so the baseline still applies).
 */
function buildEffectiveAliasMap(
  rows: { misspelling: string; canonical: string; enabled: boolean }[],
): Record<string, string> {
  const map: Record<string, string> = {};
  for (const [key, canonical] of Object.entries(BTS_TERM_ALIASES)) {
    map[key.toLowerCase()] = canonical;
  }
  for (const row of rows) {
    if (!row.enabled) continue;
    const key = row.misspelling.trim().toLowerCase();
    const canonical = row.canonical.trim();
    if (key && canonical) map[key] = canonical;
  }
  return map;
}

let cache: Record<string, string> = buildEffectiveAliasMap([]);

/** The merged effective alias map currently in effect (synchronous accessor). */
export function getEffectiveHouseTermAliasMap(): Readonly<Record<string, string>> {
  return cache;
}

/**
 * Re-read the enabled overrides from the DB, rebuild the effective alias map,
 * and register it with the cleaner. Call on boot and after every admin mutation.
 * On a DB error the previous map is kept — the vocabulary never collapses.
 */
export async function refreshHouseTermAliasCache(): Promise<void> {
  try {
    const rows = await db
      .select({
        misspelling: btsHouseTermAliasesTable.misspelling,
        canonical: btsHouseTermAliasesTable.canonical,
        enabled: btsHouseTermAliasesTable.enabled,
      })
      .from(btsHouseTermAliasesTable);
    cache = buildEffectiveAliasMap(rows);
  } catch (err) {
    console.error("[bts-house-terms] refreshHouseTermAliasCache failed — keeping last map:", err);
  }
  setEffectiveHouseTermAliases(cache);
}
