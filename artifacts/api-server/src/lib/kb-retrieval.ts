/**
 * Surface-aware knowledge-base retrieval (Task #1406).
 *
 * The SINGLE retrieval path behind BOTH the text chat assistant
 * (`routes/chat.ts`) and the voice assistant (`routes/voice.ts`). Previously the
 * two maintained near-duplicate lexical search functions; they now both delegate
 * here so ranking, the citable gate, the synonym/alias layer, history-aware
 * follow-up resolution, functional tag boosting, navigation grounding, and the
 * "no confident match" signal stay identical across surfaces.
 *
 * What "surface-aware" means here: the path is parameterised by `surface` and
 * takes an explicit `categories` scope, which is the seam each surface uses to
 * scope itself (Task #1408). Voice (basic support) passes only the Operations
 * root; chat (the deep assistant) passes all three roots — Operations, Process,
 * and Concepts — plus the functional tag boost below. Because every citable doc
 * is seeded with `category = home_root`, scoping by category here is equivalent
 * to scoping by home root. The shared path still unifies all RANKING behaviour
 * (citable gate, synonyms, tag boost, nav grounding, confidence) across surfaces;
 * only the category scope differs per surface.
 *
 * Ranking honours the taxonomy:
 *   1. curated/overview docs rank strictly above any non-curated content;
 *   2. docs carrying a tag the query references (e.g. "Flexy" → tool:flexy) are
 *      boosted;
 *   3. synonym/alias relevance;
 *   4. base lexical relevance.
 *
 * Every returned doc is run through the answer-time privacy scrub.
 */

import { db } from "@workspace/db";
import { sql, type SQL } from "drizzle-orm";
import { scrubPrivateContent } from "./content-privacy-filter";
import { citableDocFilter } from "./kb-citable-filter";
import { buildVoiceSynonymTsquery, expandVoiceQuerySynonyms } from "./voice-synonyms";
import { detectQueryTags } from "./kb-tool-tags.js";

export type RetrievalSurface = "chat" | "voice";

/** A prior conversation turn, used to resolve short follow-up questions. */
export interface RetrievalTurn {
  role: "user" | "assistant";
  content: string;
}

export interface SurfaceRetrievalOptions {
  surface: RetrievalSurface;
  /** Category scope to retrieve within. Empty → no member-facing results. */
  categories: string[];
  /** Max docs to return (default: voice 4, chat 6). */
  limit?: number;
  /** Prior turns (EXCLUDING the current message) for follow-up resolution. */
  history?: RetrievalTurn[];
}

export interface RetrievedDoc {
  id: number;
  title: string;
  content: string;
  category: string;
  docClass: string | null;
  homeRoot: string | null;
  node: string | null;
  tags: string[];
  sourcePath: string | null;
  sourceLabel: string | null;
  /** Base lexical ts_rank of the precise/fallback match (0 for grounded docs). */
  rank: number;
  /** True when injected by navigation grounding, bypassing the category scope. */
  grounded: boolean;
}

export interface SurfaceRetrievalResult {
  docs: RetrievedDoc[];
  /**
   * False when nothing cleared the confidence bar — the answer layer should fall
   * back gracefully (decline / hand off) rather than fabricate. True when a
   * precise lexical match cleared {@link CONFIDENCE_FLOOR} or a navigation answer
   * was grounded in the portal map.
   */
  confident: boolean;
  /** Max precise-match ts_rank observed (0 when only the loose fallback matched). */
  topScore: number;
  /** Whether the query was detected as a "where do I find X" navigation ask. */
  isNavigationQuery: boolean;
  /** Controlled tags the query referenced (drove the tag boost). */
  detectedTags: string[];
}

/**
 * Minimum precise-match ts_rank for a result to count as a confident answer.
 * Deliberately low: any genuine precise (AND-of-terms) lexical match clears it,
 * while the pre-launch empty citable set (no docs) and loose word-OR-only
 * fallback matches correctly read as "not confident".
 */
export const CONFIDENCE_FLOOR = 0.01;

// ───────────────────────────────────────────────────────────────────────────
// Navigation-query detection ("where do I find X").
// ───────────────────────────────────────────────────────────────────────────

const NAV_PATTERNS: readonly RegExp[] = [
  /\bwhere\s+(can|do|should|would|could)\s+i\b/,
  /\bwhere'?s\b/,
  /\bwhere\s+is\b/,
  /\bwhere\s+are\b/,
  /\bhow\s+do\s+i\s+(find|get\s+to|navigate|access|reach|open|see)\b/,
  /\bhow\s+(can|would)\s+i\s+(find|get\s+to|navigate|access|reach|open)\b/,
  /\bhow\s+to\s+(find|get\s+to|navigate|access|reach|open)\b/,
  /\bwhich\s+(page|menu|tab|section)\b/,
  /\bwhat\s+(page|menu|tab|section)\b/,
  /\b(find|locate)\b.*\b(in\s+the\s+portal|on\s+the\s+(site|portal|dashboard|platform)|menu|sidebar|nav(igation)?)\b/,
];

/** True when the member is asking where something lives in the portal. */
export function isNavigationQuery(query: string): boolean {
  const q = query.toLowerCase();
  return NAV_PATTERNS.some((re) => re.test(q));
}

// ───────────────────────────────────────────────────────────────────────────
// History-aware follow-up resolution.
// ───────────────────────────────────────────────────────────────────────────

const FOLLOWUP_LEAD =
  /^(and|but|so|also|then|ok|okay|what about|how about|why|why not|how so|what if|more|tell me more|go on|continue|really|is it|are they|does it|do they|can it|can they|will it|what else|and then)\b/;
const ANAPHORA =
  /\b(it|its|it's|that|this|those|these|them|they|their|theirs|one|ones|the same|that one|this one)\b/;

function wordCount(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * A query is treated as a follow-up when it is too short to stand alone, leads
 * with a follow-up connective, or relies on an anaphoric reference ("it",
 * "that") — i.e. it only makes sense against the previous turn.
 */
export function isFollowUp(query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return false;
  if (wordCount(q) <= 4) return true;
  if (FOLLOWUP_LEAD.test(q)) return true;
  if (ANAPHORA.test(q) && wordCount(q) <= 8) return true;
  return false;
}

/**
 * When the current query is a follow-up, prepend the immediately preceding
 * member question so the short follow-up resolves against its referent (e.g.
 * "is it free?" after "tell me about Flexy" searches for Flexy). Otherwise the
 * query is returned unchanged.
 */
export function buildHistoryAwareQuery(query: string, history: readonly RetrievalTurn[]): string {
  if (!history.length || !isFollowUp(query)) return query;
  const priorUser = history
    .filter((h) => h.role === "user")
    .map((h) => h.content.trim())
    .filter(Boolean);
  const lastUser = priorUser[priorUser.length - 1];
  if (!lastUser) return query;
  return `${lastUser} ${query}`.trim();
}

// ───────────────────────────────────────────────────────────────────────────
// Ranking.
// ───────────────────────────────────────────────────────────────────────────

/**
 * Build the boosted ORDER BY. Fresh fragment per call so it can be embedded in
 * multiple queries without sharing a parameter list.
 */
function buildBoostedOrderBy(synonymOr: string, detectedTags: readonly string[]): SQL {
  const parts: SQL[] = [];

  // 1. Curated/overview docs strictly above any non-curated content.
  parts.push(sql`CASE WHEN doc_class IN ('curated', 'overview') THEN 0 ELSE 1 END ASC`);

  // 2. Functional tag boost: docs carrying a tag the query referenced first.
  //    Pass the tag list as a `{a,b}` text[] literal (controlled vocab — only
  //    lowercase letters/hyphens) to avoid the record→array cast pitfall.
  if (detectedTags.length > 0) {
    const tagsLiteral = `{${detectedTags.join(",")}}`;
    parts.push(
      sql`CASE WHEN EXISTS (
            SELECT 1 FROM jsonb_array_elements_text(tags) AS tg(tag)
            WHERE tg.tag = ANY(${tagsLiteral}::text[])
          ) THEN 0 ELSE 1 END ASC`,
    );
  }

  // 3. Synonym/alias relevance (when the member used a casual phrasing).
  if (synonymOr) {
    parts.push(
      sql`ts_rank(search_vector, to_tsquery('english', ${synonymOr})) DESC`,
    );
  }

  // 4. Base lexical relevance.
  parts.push(sql`rank DESC`);

  return sql.join(parts, sql`, `);
}

// ───────────────────────────────────────────────────────────────────────────
// Row mapping.
// ───────────────────────────────────────────────────────────────────────────

function mapRow(r: Record<string, unknown>, grounded: boolean): RetrievedDoc {
  return {
    id: Number(r.id),
    title: String(r.title ?? ""),
    content: String(r.content ?? ""),
    category: String(r.category ?? ""),
    docClass: (r.doc_class as string | null) ?? null,
    homeRoot: (r.home_root as string | null) ?? null,
    node: (r.node as string | null) ?? null,
    tags: Array.isArray(r.tags) ? (r.tags as string[]) : [],
    sourcePath: (r.source_path as string | null) ?? null,
    sourceLabel: (r.source_label as string | null) ?? null,
    rank: typeof r.rank === "number" ? r.rank : parseFloat(String(r.rank ?? 0)) || 0,
    grounded,
  };
}

function scrubDoc(d: RetrievedDoc): RetrievedDoc {
  return {
    ...d,
    title: scrubPrivateContent(d.title),
    content: scrubPrivateContent(d.content),
  };
}

const ROW_COLUMNS = sql`id, title, content, category, doc_class, home_root, node, tags, source_path, source_label`;

// ───────────────────────────────────────────────────────────────────────────
// Main entry point.
// ───────────────────────────────────────────────────────────────────────────

export async function retrieveSurfaceAware(
  rawQuery: string,
  opts: SurfaceRetrievalOptions,
): Promise<SurfaceRetrievalResult> {
  const limit = opts.limit ?? (opts.surface === "voice" ? 4 : 6);
  const fallbackMin = Math.max(1, Math.ceil(limit / 2));
  const navQuery = isNavigationQuery(rawQuery);

  // ── Navigation grounding ───────────────────────────────────────────────────
  // For "where do I find X" asks, fetch the current portal navigation map doc
  // directly (Operations root, navigation node) — bypassing the category scope
  // but still honouring the citable gate + admin guard — so these answers always
  // come from the current portal map rather than a stale legacy location.
  let navDoc: RetrievedDoc | null = null;
  if (navQuery) {
    try {
      const navRows = await db.execute(sql`
        SELECT ${ROW_COLUMNS}, 0::float4 AS rank
        FROM ai_live_documents
        WHERE home_root = 'operations' AND node = 'navigation'
          AND audience <> 'admin' AND ${citableDocFilter()}
        LIMIT 1`);
      const r = (navRows.rows as Record<string, unknown>[])[0];
      if (r) navDoc = mapRow(r, true);
    } catch (err) {
      console.error("[kb-retrieval] navigation grounding fetch failed:", err);
    }
  }

  if (opts.categories.length === 0) {
    const docs = navDoc ? [scrubDoc(navDoc)] : [];
    return {
      docs,
      confident: navDoc != null,
      topScore: 0,
      isNavigationQuery: navQuery,
      detectedTags: [],
    };
  }

  const query = buildHistoryAwareQuery(rawQuery, opts.history ?? []);
  const detectedTags = detectQueryTags(query);
  const synonymOr = buildVoiceSynonymTsquery(query);
  const categoriesArray = `{${opts.categories.join(",")}}`;

  const primaryTsquery = synonymOr
    ? sql`(websearch_to_tsquery('english', ${query}) || to_tsquery('english', ${synonymOr}))`
    : sql`websearch_to_tsquery('english', ${query})`;

  const primary = await db.execute(sql`
    SELECT ${ROW_COLUMNS},
      ts_rank(search_vector, ${primaryTsquery}) AS rank
    FROM ai_live_documents
    WHERE search_vector @@ ${primaryTsquery}
      AND category = ANY(${categoriesArray}::text[])
      AND audience <> 'admin'
      AND ${citableDocFilter()}
    ORDER BY ${buildBoostedOrderBy(synonymOr, detectedTags)}
    LIMIT ${limit}`);

  const rows = primary.rows as Record<string, unknown>[];
  const primaryMaxRank = rows.reduce(
    (m, r) => Math.max(m, typeof r.rank === "number" ? r.rank : parseFloat(String(r.rank ?? 0)) || 0),
    0,
  );

  // ── Loose fallback ─────────────────────────────────────────────────────────
  // When the precise (AND-of-terms) query found too few docs, widen to a word-OR
  // net (raw query words + matched synonym terms) so the assistant still has
  // best-effort context. These matches do NOT count toward confidence.
  if (rows.length < fallbackMin) {
    const orQuery = [
      ...query.trim().split(/\s+/).filter(Boolean),
      ...expandVoiceQuerySynonyms(query),
    ].join(" | ");
    if (orQuery) {
      const fallback = await db.execute(sql`
        SELECT ${ROW_COLUMNS},
          ts_rank(search_vector, to_tsquery('english', ${orQuery})) AS rank
        FROM ai_live_documents
        WHERE search_vector @@ to_tsquery('english', ${orQuery})
          AND category = ANY(${categoriesArray}::text[])
          AND audience <> 'admin'
          AND ${citableDocFilter()}
        ORDER BY ${buildBoostedOrderBy(synonymOr, detectedTags)}
        LIMIT ${limit}`);
      const seen = new Set(rows.map((r) => Number(r.id)));
      for (const r of fallback.rows as Record<string, unknown>[]) {
        if (!seen.has(Number(r.id))) {
          rows.push(r);
          seen.add(Number(r.id));
        }
      }
    }
  }

  let docs = rows.slice(0, limit).map((r) => mapRow(r, false));

  // Prepend the navigation-grounded doc so it leads navigation answers (dedup).
  if (navDoc) {
    const navId = navDoc.id;
    docs = [navDoc, ...docs.filter((d) => d.id !== navId)].slice(0, limit);
  }

  docs = docs.map(scrubDoc);

  const confident = primaryMaxRank >= CONFIDENCE_FLOOR || navDoc != null;
  if (!confident) {
    // Cheap retrieval-gap signal: a future content-gap radar can consume these.
    console.log(
      `[kb-retrieval] no confident match (surface=${opts.surface}) for query: ${rawQuery.slice(0, 120)}`,
    );
  }

  return {
    docs,
    confident,
    topScore: primaryMaxRank,
    isNavigationQuery: navQuery,
    detectedTags,
  };
}
