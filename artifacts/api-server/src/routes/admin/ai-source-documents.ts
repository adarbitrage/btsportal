import { Router, type IRouter } from "express";
import { db, aiSourceDocumentsTable } from "@workspace/db";
import { eq, and, desc, sql } from "drizzle-orm";
import { requirePermission } from "../../middleware/rbac";
import { getParam } from "../../lib/params";
import {
  isSourceFolder,
  resolveSourceFolder,
  AUTHORITY_ROLES,
  DEFAULT_AUTHORITY_ROLE,
  type AuthorityRole,
} from "../../lib/kb-taxonomy";

// AI Source Knowledge — the RAW-SOURCE layer behind the assistant. Mounted at
// /admin/ai-source-documents. Deliberately standalone from both the legacy
// /admin/chat/knowledgebase routes AND the curated /admin/ai-live-documents
// routes — it reads/writes ONLY the new ai_source_documents table and is NEVER
// wired into any member-facing retrieval path (mining input, not citable).
const router: IRouter = Router();

const isAuthorityRole = (v: unknown): v is AuthorityRole =>
  typeof v === "string" && (AUTHORITY_ROLES as readonly string[]).includes(v);

/** GET /admin/ai-source-documents?folder=&search= — list (optionally by folder). */
router.get("/admin/ai-source-documents", requirePermission("chat:view"), async (req, res): Promise<void> => {
  const folder = req.query.folder as string | undefined;
  const search = req.query.search as string | undefined;

  const conditions: any[] = [];

  if (folder) {
    if (!isSourceFolder(folder)) {
      res.status(400).json({ error: "Unknown source folder" });
      return;
    }
    conditions.push(eq(aiSourceDocumentsTable.sourceType, folder));
  }

  // Blended relevance search: OR-style tsquery (any word can match) with a
  // pg_trgm fuzzy fallback for close/misspelled queries. Mirrors the existing
  // ai-live-documents admin search.
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
        to_tsvector('english', ${aiSourceDocumentsTable.title} || ' ' || ${aiSourceDocumentsTable.content}) @@ ${orTsquery}
        OR similarity(${aiSourceDocumentsTable.title}, ${search}) > 0.15
        OR word_similarity(${search}, ${aiSourceDocumentsTable.title}) > 0.2
        OR word_similarity(${search}, ${aiSourceDocumentsTable.content}) > 0.15
      )`,
    );
  }

  const orderBy =
    search && orTsquery
      ? sql`GREATEST(
          ts_rank(
            setweight(to_tsvector('english', ${aiSourceDocumentsTable.title}), 'A') ||
              setweight(to_tsvector('english', ${aiSourceDocumentsTable.content}), 'B'),
            ${orTsquery}
          ),
          similarity(${aiSourceDocumentsTable.title}, ${search}),
          word_similarity(${search}, ${aiSourceDocumentsTable.title}),
          word_similarity(${search}, ${aiSourceDocumentsTable.content})
        ) DESC`
      : desc(aiSourceDocumentsTable.updatedAt);

  const docs = await db
    .select()
    .from(aiSourceDocumentsTable)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(orderBy);

  // Per-folder counts power the library folder navigation.
  const folderCounts = await db
    .select({ folder: aiSourceDocumentsTable.sourceType, cnt: sql<number>`count(*)::int` })
    .from(aiSourceDocumentsTable)
    .groupBy(aiSourceDocumentsTable.sourceType);

  res.json({
    documents: docs,
    counts: folderCounts.reduce((acc, c) => ({ ...acc, [c.folder]: c.cnt }), {} as Record<string, number>),
  });
});

/** GET /admin/ai-source-documents/:id — fetch a single source document. */
router.get("/admin/ai-source-documents/:id", requirePermission("chat:view"), async (req, res): Promise<void> => {
  const id = parseInt(getParam(req.params.id));
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid document ID" });
    return;
  }

  const [doc] = await db.select().from(aiSourceDocumentsTable).where(eq(aiSourceDocumentsTable.id, id));
  if (!doc) {
    res.status(404).json({ error: "Document not found" });
    return;
  }

  res.json(doc);
});

/** POST /admin/ai-source-documents — create a source document. */
router.post("/admin/ai-source-documents", requirePermission("chat:manage"), async (req, res): Promise<void> => {
  const { title, content, sourceType, authorityRole, sourceName, sourceId, provenanceNote } = req.body as {
    title?: string;
    content?: string;
    sourceType?: string;
    authorityRole?: string;
    sourceName?: string;
    sourceId?: number;
    provenanceNote?: string;
  };

  if (!title || !content) {
    res.status(400).json({ error: "Title and content are required" });
    return;
  }
  if (!sourceType || !isSourceFolder(sourceType)) {
    res.status(400).json({ error: "A valid source folder is required" });
    return;
  }

  // Default the authority role from the folder when not explicitly provided.
  const folder = resolveSourceFolder(sourceType);
  const role = isAuthorityRole(authorityRole)
    ? authorityRole
    : folder?.defaultAuthorityRole ?? DEFAULT_AUTHORITY_ROLE;

  const [doc] = await db
    .insert(aiSourceDocumentsTable)
    .values({
      title: title.trim(),
      content,
      sourceType,
      authorityRole: role,
      sourceName: sourceName?.trim() || null,
      sourceId: typeof sourceId === "number" && Number.isFinite(sourceId) ? sourceId : null,
      provenanceNote: provenanceNote?.trim() || null,
    })
    .returning();

  res.status(201).json(doc);
});

export default router;
