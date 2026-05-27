import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

export interface KBSearchResult {
  id: number;
  title: string;
  content: string;
  category: string;
  rank: number;
}

export interface RetrieveOptions {
  categories?: string[];
  kbDocIds?: number[];
  limit?: number;
}

export async function retrieveFromKB(
  query: string,
  options?: RetrieveOptions,
): Promise<KBSearchResult[]> {
  const limit = options?.limit ?? 3;
  const categories = options?.categories;
  const kbDocIds = options?.kbDocIds;

  if (categories !== undefined && categories.length === 0) return [];
  if (kbDocIds !== undefined && kbDocIds.length === 0) return [];

  let results;

  if (kbDocIds && kbDocIds.length > 0) {
    const idsArray = `{${kbDocIds.join(",")}}`;
    results = await db.execute(
      sql`SELECT id, title, content, category,
          ts_rank(to_tsvector('english', title || ' ' || content), plainto_tsquery('english', ${query})) as rank
        FROM knowledgebase_docs
        WHERE to_tsvector('english', title || ' ' || content) @@ plainto_tsquery('english', ${query})
          AND id = ANY(${idsArray}::int[])
        ORDER BY rank DESC
        LIMIT ${limit}`,
    );
  } else if (categories && categories.length > 0) {
    const categoriesArray = `{${categories.join(",")}}`;
    results = await db.execute(
      sql`SELECT id, title, content, category,
          ts_rank(to_tsvector('english', title || ' ' || content), plainto_tsquery('english', ${query})) as rank
        FROM knowledgebase_docs
        WHERE to_tsvector('english', title || ' ' || content) @@ plainto_tsquery('english', ${query})
          AND category = ANY(${categoriesArray}::text[])
        ORDER BY rank DESC
        LIMIT ${limit}`,
    );
  } else {
    results = await db.execute(
      sql`SELECT id, title, content, category,
          ts_rank(to_tsvector('english', title || ' ' || content), plainto_tsquery('english', ${query})) as rank
        FROM knowledgebase_docs
        WHERE to_tsvector('english', title || ' ' || content) @@ plainto_tsquery('english', ${query})
        ORDER BY rank DESC
        LIMIT ${limit}`,
    );
  }

  return (results.rows as any[]).map((r) => ({
    id: r.id as number,
    title: r.title as string,
    content: r.content as string,
    category: r.category as string,
    rank: parseFloat(r.rank),
  }));
}
