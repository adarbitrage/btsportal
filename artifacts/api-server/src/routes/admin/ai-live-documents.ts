import { Router, type IRouter } from "express";
import { db, aiLiveDocumentsTable } from "@workspace/db";
import { eq, and, desc, sql } from "drizzle-orm";
import { requirePermission } from "../../middleware/rbac";
import { scrubPrivateContent } from "../../lib/content-privacy-filter";
import { getParam } from "../../lib/params";

// Phase-1 CRUD for the cleanly-separated "Live AI Documents" corpus. Mounted at
// /admin/ai-live-documents. This is intentionally standalone from the legacy
// /admin/chat/knowledgebase routes — it reads/writes ONLY the new
// ai_live_documents table and is not wired into any retrieval path yet.
const router: IRouter = Router();

const chunkCount = (content: string) => Math.ceil(content.length / 500);

router.get("/admin/ai-live-documents", requirePermission("chat:view"), async (req, res): Promise<void> => {
  const category = req.query.category as string | undefined;
  const search = req.query.search as string | undefined;

  const conditions: any[] = [];

  if (category) {
    conditions.push(eq(aiLiveDocumentsTable.category, category));
  }

  // Blended relevance search: OR-style tsquery (any word can match) with a
  // pg_trgm fuzzy fallback for close/misspelled queries. Mirrors the existing
  // knowledgebase admin search.
  const orTsquery = search
    ? sql`(
        SELECT COALESCE(
          NULLIF(
            (SELECT to_tsquery('english', string_agg(lexeme, ' | '))
             FROM unnest(to_tsvector('english', ${search}))),
            NULL
          ),
          plainto_tsquery('english', ${search})
        )
      )`
    : null;

  if (search && orTsquery) {
    conditions.push(
      sql`(
        to_tsvector('english', ${aiLiveDocumentsTable.title} || ' ' || ${aiLiveDocumentsTable.content}) @@ ${orTsquery}
        OR similarity(${aiLiveDocumentsTable.title}, ${search}) > 0.15
        OR word_similarity(${search}, ${aiLiveDocumentsTable.title}) > 0.2
        OR word_similarity(${search}, ${aiLiveDocumentsTable.content}) > 0.15
      )`
    );
  }

  const orderBy =
    search && orTsquery
      ? sql`GREATEST(
          ts_rank(
            setweight(to_tsvector('english', ${aiLiveDocumentsTable.title}), 'A') ||
              setweight(to_tsvector('english', ${aiLiveDocumentsTable.content}), 'B'),
            ${orTsquery}
          ),
          similarity(${aiLiveDocumentsTable.title}, ${search}),
          word_similarity(${search}, ${aiLiveDocumentsTable.title}),
          word_similarity(${search}, ${aiLiveDocumentsTable.content})
        ) DESC`
      : desc(aiLiveDocumentsTable.updatedAt);

  const docs = await db
    .select()
    .from(aiLiveDocumentsTable)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(orderBy);

  res.json(docs.map((d) => ({ ...d, chunkCount: chunkCount(d.content) })));
});

router.post("/admin/ai-live-documents", requirePermission("chat:manage"), async (req, res): Promise<void> => {
  const { title, category, content, slug } = req.body as { title?: string; category?: string; content?: string; slug?: string };

  if (!title || !content) {
    res.status(400).json({ error: "Title and content are required" });
    return;
  }

  const trimmedSlug = slug?.trim();

  try {
    const [doc] = await db
      .insert(aiLiveDocumentsTable)
      .values({
        title: scrubPrivateContent(title),
        category: category || "faq",
        content: scrubPrivateContent(content),
        slug: trimmedSlug ? trimmedSlug : null,
      })
      .returning();

    res.status(201).json({ ...doc, chunkCount: chunkCount(doc.content) });
  } catch (err: any) {
    if (err?.code === "23505") {
      res.status(409).json({ error: "A document with that slug already exists" });
      return;
    }
    throw err;
  }
});

router.put("/admin/ai-live-documents/:id", requirePermission("chat:manage"), async (req, res): Promise<void> => {
  const id = parseInt(getParam(req.params.id));
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid document ID" });
    return;
  }

  const [existing] = await db.select().from(aiLiveDocumentsTable).where(eq(aiLiveDocumentsTable.id, id));
  if (!existing) {
    res.status(404).json({ error: "Document not found" });
    return;
  }

  const { title, category, content, slug } = req.body as { title?: string; category?: string; content?: string; slug?: string };

  const updates: Record<string, any> = {};
  if (title !== undefined) updates.title = scrubPrivateContent(title);
  if (category !== undefined) updates.category = category;
  if (content !== undefined) updates.content = scrubPrivateContent(content);
  if (slug !== undefined) {
    const trimmedSlug = slug.trim();
    updates.slug = trimmedSlug ? trimmedSlug : null;
  }

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "Nothing to update" });
    return;
  }

  try {
    const [updated] = await db
      .update(aiLiveDocumentsTable)
      .set(updates)
      .where(eq(aiLiveDocumentsTable.id, id))
      .returning();

    res.json({ ...updated, chunkCount: chunkCount(updated.content) });
  } catch (err: any) {
    if (err?.code === "23505") {
      res.status(409).json({ error: "A document with that slug already exists" });
      return;
    }
    throw err;
  }
});

router.delete("/admin/ai-live-documents/:id", requirePermission("chat:manage"), async (req, res): Promise<void> => {
  const id = parseInt(getParam(req.params.id));
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid document ID" });
    return;
  }

  const [existing] = await db.select().from(aiLiveDocumentsTable).where(eq(aiLiveDocumentsTable.id, id));
  if (!existing) {
    res.status(404).json({ error: "Document not found" });
    return;
  }

  await db.delete(aiLiveDocumentsTable).where(eq(aiLiveDocumentsTable.id, id));

  res.json({ success: true });
});

export default router;
