import { Router, type Request, type Response } from "express";
import { db, knowledgebaseBookmarksTable } from "@workspace/db";
import { sql, and, eq, inArray } from "drizzle-orm";

const router = Router();

/**
 * Fetch the set of doc ids the given user has bookmarked, restricted to the
 * supplied candidate ids when provided (avoids loading the entire bookmark set
 * when we only need to annotate a page of results).
 */
async function getBookmarkedDocIds(
  userId: number,
  docIds?: number[],
): Promise<Set<number>> {
  if (docIds && docIds.length === 0) return new Set();
  const where = docIds
    ? and(
        eq(knowledgebaseBookmarksTable.userId, userId),
        inArray(knowledgebaseBookmarksTable.docId, docIds),
      )
    : eq(knowledgebaseBookmarksTable.userId, userId);
  const rows = await db
    .select({ docId: knowledgebaseBookmarksTable.docId })
    .from(knowledgebaseBookmarksTable)
    .where(where);
  return new Set(rows.map((r) => r.docId));
}

/**
 * Build an OR-style tsquery from a plain search string.
 *
 * Strategy:
 *   1. Run the query through `to_tsvector` so Postgres stems/normalises every
 *      word (e.g. "starting" → "start") and strips stop-words.
 *   2. Collect the resulting lexemes and join them with the tsquery OR operator
 *      `|`, so *any* single-word match surfaces a document instead of requiring
 *      all words to match (the old implicit-AND behaviour of plainto_tsquery).
 *   3. Fall back to `plainto_tsquery` when to_tsvector produces no lexemes
 *      (e.g. the entire query was stop-words), which would otherwise yield NULL.
 *
 * Returns a SQL fragment that evaluates to a tsquery value.
 */
function buildOrTsquery(q: string) {
  return sql`(
    SELECT COALESCE(
      NULLIF(
        (SELECT to_tsquery('english', string_agg(lexeme, ' | '))
         FROM unnest(to_tsvector('english', ${q}))),
        NULL
      ),
      plainto_tsquery('english', ${q})
    )
  )`;
}

/**
 * Weighted tsvector for ranking: title hits (weight A) outrank body hits (B).
 * The existing GIN index covers to_tsvector('english', title || ' ' || content)
 * and is used for the WHERE @@ clause; the weighted vector is computed only for
 * the ORDER BY expression so no index change is needed.
 */
function buildWeightedVector() {
  return sql`(
    setweight(to_tsvector('english', title), 'A') ||
    setweight(to_tsvector('english', content), 'B')
  )`;
}

/**
 * Trigram-similarity fallback used when the full-text search returns no rows
 * (e.g. a misspelled query whose lexeme matches nothing).  Requires pg_trgm.
 * Ranks by the best of title-similarity, word-similarity-in-title, and
 * word-similarity-in-content so misspelled title terms still surface the
 * correct lesson.
 */
async function trigramFallback(
  q: string,
  category: string | null,
  limit: number,
): Promise<any[]> {
  try {
    const categoryClause = category
      ? sql`AND category = ${category}`
      : sql``;

    const result = await db.execute(
      sql`SELECT
            id,
            title,
            category,
            source_path,
            source_label,
            left(content, 300) AS snippet,
            GREATEST(
              similarity(title, ${q}),
              word_similarity(${q}, title),
              word_similarity(${q}, content)
            ) AS rank
          FROM knowledgebase_docs
          WHERE
            (
              similarity(title, ${q}) > 0.15
              OR word_similarity(${q}, title) > 0.2
              OR word_similarity(${q}, content) > 0.15
            )
            AND audience = 'member'
            AND source_path IS NOT NULL
            ${categoryClause}
          ORDER BY rank DESC
          LIMIT ${limit}`,
    );
    return result.rows as any[];
  } catch {
    return [];
  }
}

router.get("/kb/browse", async (req: Request, res: Response): Promise<void> => {
  if (!req.userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const rawLimit = parseInt(String(req.query.limit ?? "30"), 10);
  const limit = isNaN(rawLimit) || rawLimit < 1 ? 30 : Math.min(rawLimit, 50);
  const category = typeof req.query.category === "string" && req.query.category ? req.query.category : null;

  try {
    let results;
    if (category) {
      results = await db.execute(
        sql`SELECT
              id,
              title,
              category,
              source_path,
              source_label,
              left(content, 200) AS snippet
            FROM knowledgebase_docs
            WHERE
              audience = 'member'
              AND source_path IS NOT NULL
              AND category = ${category}
            ORDER BY title ASC
            LIMIT ${limit}`,
      );
    } else {
      results = await db.execute(
        sql`SELECT
              id,
              title,
              category,
              source_path,
              source_label,
              left(content, 200) AS snippet
            FROM knowledgebase_docs
            WHERE
              audience = 'member'
              AND source_path IS NOT NULL
            ORDER BY category ASC, title ASC
            LIMIT ${limit}`,
      );
    }

    const rawRows = results.rows as any[];
    const bookmarked = await getBookmarkedDocIds(
      req.userId,
      rawRows.map((r) => r.id as number),
    );

    const rows = rawRows.map((r) => ({
      id: r.id as number,
      title: r.title as string,
      category: r.category as string,
      sourcePath: (r.source_path as string | null) ?? null,
      sourceLabel: (r.source_label as string | null) ?? null,
      snippet: (r.snippet as string | null) ?? "",
      rank: 0,
      isBookmarked: bookmarked.has(r.id as number),
    }));

    res.json({ results: rows });
  } catch (err) {
    console.error("[KB Browse] Error:", err instanceof Error ? err.message : err);
    res.status(500).json({ error: "Browse failed" });
  }
});

router.get("/kb/counts", async (req: Request, res: Response): Promise<void> => {
  if (!req.userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  try {
    const results = await db.execute(
      sql`SELECT category, COUNT(*)::int AS count
            FROM knowledgebase_docs
            WHERE
              audience = 'member'
              AND source_path IS NOT NULL
            GROUP BY category`,
    );

    const counts: Record<string, number> = {};
    for (const r of results.rows as any[]) {
      counts[r.category as string] = Number(r.count);
    }

    res.json({ counts });
  } catch (err) {
    console.error("[KB Counts] Error:", err instanceof Error ? err.message : err);
    res.status(500).json({ error: "Counts failed" });
  }
});

router.get("/kb/search", async (req: Request, res: Response): Promise<void> => {
  if (!req.userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  if (!q || q.length < 2) {
    res.json({ results: [] });
    return;
  }

  const rawLimit = parseInt(String(req.query.limit ?? "20"), 10);
  const limit = isNaN(rawLimit) || rawLimit < 1 ? 20 : Math.min(rawLimit, 50);

  const category =
    typeof req.query.category === "string" && req.query.category
      ? req.query.category
      : null;

  try {
    const orTsquery = buildOrTsquery(q);
    const weightedVector = buildWeightedVector();
    const categoryClause = category ? sql`AND category = ${category}` : sql``;

    const ftResult = await db.execute(
      sql`SELECT
            id,
            title,
            category,
            source_path,
            source_label,
            ts_headline(
              'english',
              content,
              ${orTsquery},
              'StartSel=[[[HL]]], StopSel=[[[/HL]]], MaxWords=35, MinWords=15, ShortWord=3, HighlightAll=false, MaxFragments=1, FragmentDelimiter=" … "'
            ) AS snippet,
            ts_rank_cd(
              ${weightedVector},
              ${orTsquery}
            ) AS rank
          FROM knowledgebase_docs
          WHERE
            to_tsvector('english', title || ' ' || content) @@ ${orTsquery}
            AND audience = 'member'
            AND source_path IS NOT NULL
            ${categoryClause}
          ORDER BY rank DESC
          LIMIT ${limit}`,
    );

    let rows = ftResult.rows as any[];
    let usedFallback = false;

    if (rows.length === 0) {
      rows = await trigramFallback(q, category, limit);
      usedFallback = rows.length > 0;
    }

    const bookmarked = await getBookmarkedDocIds(
      req.userId,
      rows.map((r) => r.id as number),
    );

    const results = rows.map((r) => ({
      id: r.id as number,
      title: r.title as string,
      category: r.category as string,
      sourcePath: (r.source_path as string | null) ?? null,
      sourceLabel: (r.source_label as string | null) ?? null,
      snippet: (r.snippet as string | null) ?? "",
      rank: parseFloat(r.rank),
      isBookmarked: bookmarked.has(r.id as number),
    }));

    res.json({ results, usedFallback });
  } catch (err) {
    console.error(
      "[KB Search] Error:",
      err instanceof Error ? err.message : err,
    );
    res.status(500).json({ error: "Search failed" });
  }
});

/**
 * Toggle a bookmark for the authenticated member on a single KB doc.
 * Returns the resulting bookmark state so the client can update optimistically.
 */
router.post(
  "/kb/bookmarks/:docId",
  async (req: Request, res: Response): Promise<void> => {
    if (!req.userId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const docId = parseInt(String(req.params.docId), 10);
    if (isNaN(docId)) {
      res.status(400).json({ error: "Invalid document ID" });
      return;
    }

    try {
      const [doc] = (
        await db.execute(
          sql`SELECT id FROM knowledgebase_docs
              WHERE id = ${docId}
                AND audience = 'member'
                AND source_path IS NOT NULL`,
        )
      ).rows as any[];

      if (!doc) {
        res.status(404).json({ error: "Article not found" });
        return;
      }

      const [existing] = await db
        .select()
        .from(knowledgebaseBookmarksTable)
        .where(
          and(
            eq(knowledgebaseBookmarksTable.userId, req.userId),
            eq(knowledgebaseBookmarksTable.docId, docId),
          ),
        );

      if (existing) {
        await db
          .delete(knowledgebaseBookmarksTable)
          .where(eq(knowledgebaseBookmarksTable.id, existing.id));
        res.json({ isBookmarked: false });
      } else {
        await db
          .insert(knowledgebaseBookmarksTable)
          .values({ userId: req.userId, docId })
          .onConflictDoNothing();
        res.json({ isBookmarked: true });
      }
    } catch (err) {
      console.error(
        "[KB Bookmark] Error:",
        err instanceof Error ? err.message : err,
      );
      res.status(500).json({ error: "Failed to update bookmark" });
    }
  },
);

/**
 * List the authenticated member's bookmarked KB articles, most-recently saved
 * first. Joins against knowledgebase_docs so renamed/removed/admin-only docs are
 * filtered out and never surface stale bookmarks.
 */
router.get(
  "/kb/bookmarks",
  async (req: Request, res: Response): Promise<void> => {
    if (!req.userId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    try {
      const results = await db.execute(
        sql`SELECT
              d.id,
              d.title,
              d.category,
              d.source_path,
              d.source_label,
              left(d.content, 200) AS snippet
            FROM knowledgebase_bookmarks b
            INNER JOIN knowledgebase_docs d ON d.id = b.doc_id
            WHERE
              b.user_id = ${req.userId}
              AND d.audience = 'member'
              AND d.source_path IS NOT NULL
            ORDER BY b.created_at DESC`,
      );

      const rows = (results.rows as any[]).map((r) => ({
        id: r.id as number,
        title: r.title as string,
        category: r.category as string,
        sourcePath: (r.source_path as string | null) ?? null,
        sourceLabel: (r.source_label as string | null) ?? null,
        snippet: (r.snippet as string | null) ?? "",
        rank: 0,
        isBookmarked: true,
      }));

      res.json({ results: rows });
    } catch (err) {
      console.error(
        "[KB Bookmarks] Error:",
        err instanceof Error ? err.message : err,
      );
      res.status(500).json({ error: "Failed to load bookmarks" });
    }
  },
);

export default router;
