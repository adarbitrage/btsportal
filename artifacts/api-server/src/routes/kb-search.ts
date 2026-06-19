import { Router, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

const router = Router();

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
              ts_headline(
                'english',
                content,
                plainto_tsquery('english', ${q}),
                'MaxWords=35, MinWords=15, ShortWord=3, HighlightAll=false, MaxFragments=1, FragmentDelimiter=" … "'
              ) AS snippet,
              ts_rank(
                to_tsvector('english', title || ' ' || content),
                plainto_tsquery('english', ${q})
              ) AS rank
            FROM knowledgebase_docs
            WHERE
              to_tsvector('english', title || ' ' || content) @@ plainto_tsquery('english', ${q})
              AND audience = 'member'
              AND source_path IS NOT NULL
              AND category = ${category}
            ORDER BY rank DESC
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
              ts_headline(
                'english',
                content,
                plainto_tsquery('english', ${q}),
                'MaxWords=35, MinWords=15, ShortWord=3, HighlightAll=false, MaxFragments=1, FragmentDelimiter=" … "'
              ) AS snippet,
              ts_rank(
                to_tsvector('english', title || ' ' || content),
                plainto_tsquery('english', ${q})
              ) AS rank
            FROM knowledgebase_docs
            WHERE
              to_tsvector('english', title || ' ' || content) @@ plainto_tsquery('english', ${q})
              AND audience = 'member'
              AND source_path IS NOT NULL
            ORDER BY rank DESC
            LIMIT ${limit}`,
      );
    }

    const rows = (results.rows as any[]).map((r) => ({
      id: r.id as number,
      title: r.title as string,
      category: r.category as string,
      sourcePath: (r.source_path as string | null) ?? null,
      sourceLabel: (r.source_label as string | null) ?? null,
      snippet: (r.snippet as string | null) ?? "",
      rank: parseFloat(r.rank),
    }));

    res.json({ results: rows });
  } catch (err) {
    console.error("[KB Search] Error:", err instanceof Error ? err.message : err);
    res.status(500).json({ error: "Search failed" });
  }
});

export default router;
