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
import { embedQuery, toVectorLiteral, EMBEDDING_MODEL } from "./kb-embeddings.js";

export type RetrievalSurface = "chat" | "voice";

/** A prior conversation turn, used to resolve short follow-up questions. */
export interface RetrievalTurn {
  role: "user" | "assistant";
  content: string;
}

/**
 * An EPHEMERAL draft evaluated through the shared ranking path (Task #1804).
 * Never persisted, never embedded into the DB — it exists only for the
 * duration of one retrieval call so the review self-test measures the draft
 * with EXACTLY the ranking the live assistant uses.
 */
export interface EphemeralCandidate {
  title: string;
  content: string;
  /** Doc class the draft would publish as (drives the curated-tier rule). */
  docClass?: string | null;
  /** Taxonomy tags the draft would carry (drives the tag-boost tier). */
  tags?: string[];
  /**
   * Pre-computed ad-hoc embedding of the draft text (computed once per
   * self-test run by the caller and DISCARDED afterwards). null/omitted =
   * lexical-only assessment for the draft.
   */
  embedding?: number[] | null;
}

/** How the ephemeral candidate fared inside the shared retrieval/ranking path. */
export interface CandidateAssessment {
  /** ts_rank of the draft vs the SAME primary tsquery (incl. synonym OR). */
  lexRank: number;
  /** Cosine of draft embedding vs the SAME query embedding (0 if unavailable). */
  semanticScore: number;
  /** False = query or candidate embedding unavailable this run. */
  semanticAvailable: boolean;
  /** Draft clears the live confidence bar (lexical OR semantic floor). */
  clearsFloor: boolean;
  /** Draft ranked within the limit in the shared tier/blend merge vs live docs. */
  wouldSurface: boolean;
}

export interface SurfaceRetrievalOptions {
  surface: RetrievalSurface;
  /** Category scope to retrieve within. Empty → no member-facing results. */
  categories: string[];
  /** Max docs to return (default: voice 4, chat 6). */
  limit?: number;
  /** Prior turns (EXCLUDING the current message) for follow-up resolution. */
  history?: RetrievalTurn[];
  /** Ephemeral draft to assess through the same ranking (never returned in docs). */
  candidate?: EphemeralCandidate;
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
  /** Blitz guide section anchor (1–23) when the doc was authored from the guide. */
  blitzSection: number | null;
  /** Base lexical ts_rank of the precise/fallback match (0 for grounded docs). */
  rank: number;
  /** Cosine similarity of the doc embedding to the query (0 when unavailable). */
  semanticScore: number;
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
  /**
   * Max query↔doc embedding cosine similarity observed (0 when the semantic
   * layer is unavailable — no key, no embeddings, or the embed call failed).
   */
  topSemanticScore: number;
  /** Whether the query was detected as a "where do I find X" navigation ask. */
  isNavigationQuery: boolean;
  /** Controlled tags the query referenced (drove the tag boost). */
  detectedTags: string[];
  /** Present only when an ephemeral candidate was passed in the options. */
  candidate?: CandidateAssessment;
}

/**
 * Minimum precise-match ts_rank for a result to count as a confident answer.
 * Deliberately low: any genuine precise (AND-of-terms) lexical match clears it,
 * while the pre-launch empty citable set (no docs) and loose word-OR-only
 * fallback matches correctly read as "not confident".
 */
export const CONFIDENCE_FLOOR = 0.01;

/**
 * Minimum query↔doc cosine similarity (text-embedding-3-small) for a SEMANTIC
 * match to count as a confident answer on its own (Task #1803). Calibrated by
 * the two-group suite in __tests__/kb-semantic-calibration.test.ts: casually
 * phrased questions that ARE covered by the citable corpus must clear it, while
 * out-of-scope questions must stay below it. A semantic hit BELOW this floor
 * never flips `confident` — the decline-rather-than-guess contract is
 * unchanged. Recalibrate whenever {@link EMBEDDING_MODEL} changes.
 */
export const SEMANTIC_CONFIDENCE_FLOOR = 0.5;

/** Blend weights for hybrid ordering within the same curated/tag tier. */
const LEXICAL_BLEND_WEIGHT = 0.5;
const SEMANTIC_BLEND_WEIGHT = 0.5;

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

// A bare affirmation ("yes", "sure, go ahead") carries NO topical content of
// its own — its referent is whatever the assistant just offered, not the
// member's own previous question. Matched against the normalized whole reply.
const BARE_AFFIRMATION =
  /^(?:yes|yeah|yep|yup|sure|ok|okay|please|yes please|please do|go ahead|go for it|do it|sounds good|sounds great|absolutely|definitely|of course|let's do it|lets do it|why not|walk me through it|show me)(?:[\s,!.]*(?:please|thanks|thank you))?[\s!.]*$/;

/** True when the member's reply is a contentless yes/confirmation. */
export function isBareAffirmation(query: string): boolean {
  return BARE_AFFIRMATION.test(query.trim().toLowerCase());
}

/**
 * Pull the assistant's trailing offer/question out of its last message so a
 * "yes" can resolve against it (e.g. "Want me to walk you through domain and
 * subdomain setup?"). Takes the LAST question-terminated sentence of the
 * message; returns null when the assistant didn't end on a question.
 */
export function extractAssistantOffer(content: string): string | null {
  const plain = content
    .replace(/```[\s\S]*?```/g, " ") // code blocks
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // markdown links → label
    .replace(/[*_`#>|-]/g, " ") // markdown decoration
    .replace(/\s+/g, " ")
    .trim();
  const questions = plain.match(/[^.!?]{3,300}\?/g);
  if (!questions || questions.length === 0) return null;
  const offer = questions[questions.length - 1].trim();
  // Only trust it as the referent when it actually ends the message (allowing
  // trailing whitespace/punctuation) — a mid-message question isn't an offer.
  if (!plain.endsWith(offer)) return null;

  // Distill to the topical core: the lexical layer (websearch_to_tsquery) ANDs
  // every term, so conversational boilerplate ("Want me to walk you through …
  // next?") would demand docs contain "want"/"walk"/"next" and match nothing.
  const core = offer
    .replace(/\?+\s*$/, "")
    .replace(
      /^(?:do you want(?: me)?|would you like(?: me)?|want me|want|should i|shall i|can i|need me)\s*(?:to\s+)?/i,
      "",
    )
    .replace(/^(?:walk you through|go over|show you|cover|explain|help(?: you)?(?: with)?|get into|dive into)\s+/i, "")
    .replace(/\s+(?:next|now|first|as well|too|instead)\s*$/i, "")
    .trim();
  return core.length >= 3 ? core : offer;
}

/**
 * When the current query is a follow-up, prepend its referent so the short
 * follow-up resolves against it:
 * - a bare affirmation ("yes") resolves against the assistant's own trailing
 *   offer question ("Want me to walk you through domain/subdomain setup?"),
 *   falling back to the prior member question if the assistant didn't offer;
 * - any other short follow-up ("is it free?") resolves against the prior
 *   member question, as before.
 * Otherwise the query is returned unchanged.
 */
export function buildHistoryAwareQuery(query: string, history: readonly RetrievalTurn[]): string {
  if (!history.length || !isFollowUp(query)) return query;

  if (isBareAffirmation(query)) {
    const lastAssistant = [...history].reverse().find((h) => h.role === "assistant");
    const offer = lastAssistant ? extractAssistantOffer(lastAssistant.content) : null;
    // The affirmation itself carries no topical content — search the offer alone.
    if (offer) return offer;
  }

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

  // 1. Curated/overview/navigation docs strictly above any non-curated content.
  parts.push(sql`CASE WHEN doc_class IN ('curated', 'overview', 'navigation') THEN 0 ELSE 1 END ASC`);

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
    blitzSection: r.blitz_section == null ? null : Number(r.blitz_section),
    rank: typeof r.rank === "number" ? r.rank : parseFloat(String(r.rank ?? 0)) || 0,
    semanticScore:
      typeof r.semantic_score === "number"
        ? r.semantic_score
        : parseFloat(String(r.semantic_score ?? 0)) || 0,
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

const ROW_COLUMNS = sql`id, title, content, category, doc_class, home_root, node, tags, source_path, source_label, blitz_section`;

// ───────────────────────────────────────────────────────────────────────────
// Shared hybrid tier/blend ordering (single source of truth).
// ───────────────────────────────────────────────────────────────────────────

/** Cosine similarity between two embedding vectors (0 when either is empty). */
export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** The minimal doc shape the shared hybrid ordering needs. */
export interface HybridRankable {
  docClass: string | null;
  tags: string[];
  rank: number;
  semanticScore: number;
}

/**
 * Sort a pool with the EXACT tier rules the live hybrid merge uses:
 * curated/overview/navigation precedence, then detected-tag boost, then the
 * lexical+semantic blend. Mutates + returns the array. This is the ONLY
 * implementation of the ordering — the live merge and the review self-test's
 * candidate assessment both go through it (no parallel ranking math).
 */
export function sortHybridPool<T extends HybridRankable>(
  pool: T[],
  detectedTags: readonly string[],
): T[] {
  const maxLex = pool.reduce((m, d) => Math.max(m, d.rank), 0);
  const tagSet = new Set(detectedTags);
  const curatedTier = (d: HybridRankable) =>
    d.docClass === "curated" || d.docClass === "overview" || d.docClass === "navigation" ? 0 : 1;
  const tagTier = (d: HybridRankable) => (d.tags.some((t) => tagSet.has(t)) ? 0 : 1);
  const blended = (d: HybridRankable) =>
    LEXICAL_BLEND_WEIGHT * (maxLex > 0 ? d.rank / maxLex : 0) +
    SEMANTIC_BLEND_WEIGHT * d.semanticScore;
  return pool.sort(
    (a, b) =>
      curatedTier(a) - curatedTier(b) ||
      tagTier(a) - tagTier(b) ||
      blended(b) - blended(a),
  );
}

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
        ORDER BY CASE doc_class
            WHEN 'navigation' THEN 0
            WHEN 'overview' THEN 1
            ELSE 2
          END, id ASC
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
      topSemanticScore: 0,
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

  // The query embedding is fetched IN PARALLEL with the primary lexical query.
  // null (no key / API failure / empty query) = lexical-only turn — identical
  // to pre-hybrid behaviour by construction.
  // When an ephemeral candidate was passed, score it against the EXACT same
  // primary tsquery (incl. the synonym OR) the live docs are matched with —
  // computed in SQL so stemming/ranking are identical; nothing is stored.
  const candidateText = opts.candidate
    ? `${opts.candidate.title}\n\n${opts.candidate.content}`
    : null;
  const [primary, queryEmbedding, candidateLexResult] = await Promise.all([
    db.execute(sql`
      SELECT ${ROW_COLUMNS},
        ts_rank(search_vector, ${primaryTsquery}) AS rank
      FROM ai_live_documents
      WHERE search_vector @@ ${primaryTsquery}
        AND category = ANY(${categoriesArray}::text[])
        AND audience <> 'admin'
        AND ${citableDocFilter()}
      ORDER BY ${buildBoostedOrderBy(synonymOr, detectedTags)}
      LIMIT ${limit}`),
    embedQuery(query).catch((err) => {
      console.error("[kb-retrieval] query embedding failed — lexical-only this turn:", err);
      return null;
    }),
    candidateText != null
      ? db
          .execute(sql`
            SELECT ts_rank(to_tsvector('english', ${candidateText}), ${primaryTsquery}) AS rank`)
          .catch((err) => {
            console.error("[kb-retrieval] candidate lexical scoring failed:", err);
            return null;
          })
      : Promise.resolve(null),
  ]);

  const rows = primary.rows as Record<string, unknown>[];
  const primaryMaxRank = rows.reduce(
    (m, r) => Math.max(m, typeof r.rank === "number" ? r.rank : parseFloat(String(r.rank ?? 0)) || 0),
    0,
  );

  // ── Semantic candidates (Task #1803) ──────────────────────────────────────
  // ADDITIONAL ranking signal, same scope + citable gate + admin guard as the
  // lexical query. Docs without embeddings simply never appear here (graceful
  // lexical-only degradation). semantic_score = cosine similarity.
  let semanticRows: Record<string, unknown>[] = [];
  let topSemanticScore = 0;
  if (queryEmbedding) {
    try {
      const qvec = toVectorLiteral(queryEmbedding);
      const semantic = await db.execute(sql`
        SELECT ${ROW_COLUMNS},
          0::float4 AS rank,
          1 - (embedding <=> ${qvec}::vector) AS semantic_score
        FROM ai_live_documents
        WHERE embedding IS NOT NULL
          -- Freshness guard: an embedding generated BEFORE the row's last edit
          -- is stale and must never influence ranking/confidence; such rows are
          -- lexical-only until the re-embed/backfill catches up.
          AND embedding_generated_at IS NOT NULL
          AND embedding_generated_at >= updated_at
          -- Model guard: during a model transition, vectors from the OLD model
          -- must not influence ranking/confidence while the backfill runs.
          AND embedding_model = ${EMBEDDING_MODEL}
          AND category = ANY(${categoriesArray}::text[])
          AND audience <> 'admin'
          AND ${citableDocFilter()}
        ORDER BY embedding <=> ${qvec}::vector
        LIMIT ${limit}`);
      semanticRows = semantic.rows as Record<string, unknown>[];
      topSemanticScore = semanticRows.reduce(
        (m, r) => Math.max(m, parseFloat(String(r.semantic_score ?? 0)) || 0),
        0,
      );
    } catch (err) {
      console.error("[kb-retrieval] semantic search failed — lexical-only this turn:", err);
      semanticRows = [];
      topSemanticScore = 0;
    }
  }

  // ── Loose fallback ─────────────────────────────────────────────────────────
  // When the precise (AND-of-terms) query found too few docs, widen to a word-OR
  // net (raw query words + matched synonym terms) so the assistant still has
  // best-effort context. These matches do NOT count toward confidence.
  if (rows.length + semanticRows.filter((s) => !rows.some((r) => Number(r.id) === Number(s.id))).length < fallbackMin) {
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

  // ── Hybrid merge (Task #1803) ─────────────────────────────────────────────
  // When the semantic layer produced candidates, merge them with the lexical
  // rows and re-rank in JS using the SAME tier rules the SQL ORDER BY encodes
  // (curated precedence first, then tag boost), with a lexical+semantic blend
  // replacing raw ts_rank as the final tiebreaker. When there are NO semantic
  // rows (no key / no embeddings / API failure), the lexical rows keep their
  // SQL ordering untouched — pre-hybrid behaviour exactly.
  let docs: RetrievedDoc[];
  let mergedPool: RetrievedDoc[];
  if (semanticRows.length > 0) {
    const lexDocs = rows.map((r) => mapRow(r, false));
    const byId = new Map<number, RetrievedDoc>();
    for (const d of lexDocs) byId.set(d.id, d);
    for (const s of semanticRows) {
      const sd = mapRow(s, false);
      const existing = byId.get(sd.id);
      if (existing) existing.semanticScore = Math.max(existing.semanticScore, sd.semanticScore);
      else byId.set(sd.id, sd);
    }
    mergedPool = sortHybridPool([...byId.values()], detectedTags);
    docs = mergedPool.slice(0, limit);
  } else {
    mergedPool = rows.map((r) => mapRow(r, false));
    docs = mergedPool.slice(0, limit);
  }

  // ── Ephemeral candidate assessment (Task #1804) ───────────────────────────
  // Inject the draft as a pseudo-doc into a COPY of the merged pool and rank
  // it with the SAME sortHybridPool ordering the live merge uses. The
  // candidate is never included in the returned docs and nothing is stored.
  let candidateAssessment: CandidateAssessment | undefined;
  if (opts.candidate) {
    const lexRow = candidateLexResult
      ? (candidateLexResult.rows as Array<{ rank: unknown }>)[0]
      : undefined;
    const candLexRank = lexRow ? parseFloat(String(lexRow.rank ?? 0)) || 0 : 0;
    const candEmbedding = opts.candidate.embedding ?? null;
    const semanticAvailable = queryEmbedding != null && candEmbedding != null;
    const candSemanticScore = semanticAvailable
      ? cosineSimilarity(queryEmbedding!, candEmbedding!)
      : 0;

    const candidateDoc: HybridRankable & { isCandidate: true } = {
      isCandidate: true,
      docClass: opts.candidate.docClass ?? null,
      tags: opts.candidate.tags ?? [],
      rank: candLexRank,
      semanticScore: candSemanticScore,
    };
    const assessmentPool: Array<HybridRankable & { isCandidate?: boolean }> = [
      ...mergedPool.map((d) => ({
        docClass: d.docClass,
        tags: d.tags,
        rank: d.rank,
        semanticScore: d.semanticScore,
      })),
      candidateDoc,
    ];
    sortHybridPool(assessmentPool, detectedTags);
    const position = assessmentPool.findIndex((d) => d.isCandidate);

    candidateAssessment = {
      lexRank: candLexRank,
      semanticScore: candSemanticScore,
      semanticAvailable,
      clearsFloor:
        candLexRank >= CONFIDENCE_FLOOR || candSemanticScore >= SEMANTIC_CONFIDENCE_FLOOR,
      wouldSurface: position >= 0 && position < limit,
    };
  }

  // Prepend the navigation-grounded doc so it leads navigation answers (dedup).
  if (navDoc) {
    const navId = navDoc.id;
    docs = [navDoc, ...docs.filter((d) => d.id !== navId)].slice(0, limit);
  }

  docs = docs.map(scrubDoc);

  // Confidence: a precise lexical match, a grounded navigation answer, OR a
  // semantic match at/above the calibrated floor. A semantic-only hit BELOW
  // the floor NEVER counts — decline-rather-than-guess is preserved.
  const confident =
    primaryMaxRank >= CONFIDENCE_FLOOR ||
    navDoc != null ||
    topSemanticScore >= SEMANTIC_CONFIDENCE_FLOOR;
  if (!confident) {
    // Cheap retrieval-gap signal: a future content-gap radar can consume these.
    console.log(
      `[kb-retrieval] no confident match (surface=${opts.surface}, lex=${primaryMaxRank.toFixed(4)}, sem=${topSemanticScore.toFixed(4)}) for query: ${rawQuery.slice(0, 120)}`,
    );
  }

  return {
    docs,
    confident,
    topScore: primaryMaxRank,
    topSemanticScore,
    isNavigationQuery: navQuery,
    detectedTags,
    ...(candidateAssessment ? { candidate: candidateAssessment } : {}),
  };
}
