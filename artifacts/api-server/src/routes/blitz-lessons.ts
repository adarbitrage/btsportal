import { Router, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { blitzLessonsTable } from "@workspace/db/schema";
import { and, eq, ne, asc } from "drizzle-orm";
import { requirePageAccess } from "../middleware/require-page-access";
import { requirePermission } from "../middleware/rbac";

const router = Router();

// Server-side ownership gate (fail-closed): every Blitz lesson endpoint
// requires the `blitz` page key via the Content Access Map.
router.use("/blitz/lessons", requirePageAccess("blitz"));
router.use("/blitz/guide", requirePageAccess("blitz"));

/**
 * GET /blitz/guide — the written guide body HTML.
 *
 * Deliberately served from behind the ownership gate instead of shipping in
 * the portal's client bundle (where any member could read it from the static
 * JS). Delivery seam only: the HTML itself is the same shared
 * @workspace/blitz-curriculum source the caption/section tooling parses.
 */
router.get("/blitz/guide", async (_req: Request, res: Response) => {
  try {
    const { BLITZ_BODY_HTML } = await import(
      "@workspace/blitz-curriculum/blitz-body-html"
    );
    res.json({ html: BLITZ_BODY_HTML });
  } catch (err) {
    console.error("[blitz-guide] load error:", err);
    res.status(500).json({ error: "Failed to load the Blitz guide" });
  }
});

/**
 * GET /admin/blitz-archive-guide — the ARCHIVED guide snapshot, admin-only
 * (matches the AdminRoute permission on /blitz-archive/guide). Same delivery
 * seam as /blitz/guide: never bundled into the client.
 */
router.get(
  "/admin/blitz-archive-guide",
  requirePermission("content:manage"),
  async (_req: Request, res: Response) => {
    try {
      const { BLITZ_ARCHIVE_HTML } = await import("../lib/blitz-archive-html");
      res.json({ html: BLITZ_ARCHIVE_HTML });
    } catch (err) {
      console.error("[blitz-archive-guide] load error:", err);
      res.status(500).json({ error: "Failed to load the archived Blitz guide" });
    }
  },
);

router.get("/blitz/lessons", async (_req: Request, res: Response) => {
  try {
    const rows = await db
      .select({
        id: blitzLessonsTable.id,
        title: blitzLessonsTable.title,
        category: blitzLessonsTable.category,
        tags: blitzLessonsTable.tags,
        sourceVideoTitle: blitzLessonsTable.sourceVideoTitle,
        phase: blitzLessonsTable.phase,
        module: blitzLessonsTable.module,
        lessonId: blitzLessonsTable.lessonId,
        lessonType: blitzLessonsTable.lessonType,
        networkPath: blitzLessonsTable.networkPath,
        publisherPath: blitzLessonsTable.publisherPath,
        blitzOrder: blitzLessonsTable.blitzOrder,
      })
      .from(blitzLessonsTable)
      .where(ne(blitzLessonsTable.status, "rejected"))
      .orderBy(asc(blitzLessonsTable.blitzOrder), asc(blitzLessonsTable.id));

    res.json({ lessons: rows });
  } catch (err) {
    console.error("[blitz-lessons] list error:", err);
    res.status(500).json({ error: "Failed to load Blitz lessons" });
  }
});

router.get("/blitz/lessons/:id", async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "Invalid lesson id" });
      return;
    }

    const [row] = await db
      .select()
      .from(blitzLessonsTable)
      .where(
        and(
          eq(blitzLessonsTable.id, id),
          ne(blitzLessonsTable.status, "rejected"),
        ),
      )
      .limit(1);

    if (!row) {
      res.status(404).json({ error: "Lesson not found" });
      return;
    }

    res.json({
      lesson: {
        id: row.id,
        title: row.title,
        category: row.category,
        tags: row.tags,
        content: row.editedContent || row.content,
        sourceVideoTitle: row.sourceVideoTitle,
        sourceVideoId: row.sourceVideoId,
        phase: row.phase,
        module: row.module,
        lessonId: row.lessonId,
        lessonType: row.lessonType,
        networkPath: row.networkPath,
        publisherPath: row.publisherPath,
        blitzOrder: row.blitzOrder,
      },
    });
  } catch (err) {
    console.error("[blitz-lessons] detail error:", err);
    res.status(500).json({ error: "Failed to load lesson" });
  }
});

export default router;
