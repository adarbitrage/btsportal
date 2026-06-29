import { Router, Request, Response } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { requirePermission } from "../../middleware/rbac.js";

// ─────────────────────────────────────────────────────────────────────────────
// Read-only archive of the old staging review queue.
//
// This serves the `kb_staging_archive` table — a frozen, fully-decoupled
// snapshot of the 310 abandoned staging drafts that were cleared out of the
// live review queue. It deliberately has NO write paths, NO pipeline, and NO
// AI-analysis hooks: its only job is to let an admin look back on the old
// drafts and pull anything worth reusing.
//
// The table lives outside the Drizzle schema on purpose (temporary), so on
// environments where it was never created (e.g. a fresh prod DB) we degrade
// gracefully to an empty list instead of throwing.
// ─────────────────────────────────────────────────────────────────────────────

const router = Router();
router.use(requirePermission("chat:manage"));

interface ArchiveDocRow {
  id: number;
  title: string;
  category: string | null;
  content: string;
  tags: string | null;
  source: string | null;
  source_video_title: string | null;
  status: string | null;
  home_root: string | null;
  node: string | null;
  doc_type: string | null;
  created_at: string | Date | null;
  archived_at: string | Date | null;
}

async function archiveTableExists(): Promise<boolean> {
  const res = await db.execute(
    sql`SELECT to_regclass('public.kb_staging_archive') AS reg`,
  );
  const rows = (res as unknown as { rows: { reg: string | null }[] }).rows ?? [];
  return Boolean(rows[0]?.reg);
}

router.get("/", async (_req: Request, res: Response) => {
  try {
    if (!(await archiveTableExists())) {
      return res.json({ docs: [], total: 0 });
    }

    const result = await db.execute(sql`
      SELECT id, title, category, content, tags, source, source_video_title,
             status, home_root, node, doc_type, created_at, archived_at
        FROM kb_staging_archive
       ORDER BY id ASC
    `);
    const rows = (result as unknown as { rows: ArchiveDocRow[] }).rows ?? [];

    const docs = rows.map((r) => ({
      id: r.id,
      title: r.title,
      category: r.category ?? "",
      content: r.content ?? "",
      tags: r.tags ?? "",
      source: r.source ?? "",
      sourceVideoTitle: r.source_video_title ?? "",
      status: r.status ?? "",
      homeRoot: r.home_root ?? "",
      node: r.node ?? "",
      docType: r.doc_type ?? "",
      createdAt: r.created_at ? new Date(r.created_at).toISOString() : null,
      archivedAt: r.archived_at ? new Date(r.archived_at).toISOString() : null,
    }));

    return res.json({ docs, total: docs.length });
  } catch (err) {
    console.error("[kb-archive] failed to list archived docs:", err);
    return res.status(500).json({ error: "Failed to load archived documents" });
  }
});

export default router;
