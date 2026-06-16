import { Router, type IRouter } from "express";
import { db, announcementsTable } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import {
  ListAnnouncementsResponse,
  CreateAnnouncementBody,
  UpdateAnnouncementBody,
} from "@workspace/api-zod";
import { requirePermission } from "../middleware/rbac";

const router: IRouter = Router();

router.get("/announcements", async (req, res): Promise<void> => {
  const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 10;

  const announcements = await db
    .select()
    .from(announcementsTable)
    .orderBy(desc(announcementsTable.createdAt))
    .limit(limit);

  res.json(ListAnnouncementsResponse.parse(announcements));
});

router.get(
  "/admin/announcements",
  requirePermission("communications:view"),
  async (req, res): Promise<void> => {
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;

    const announcements = await db
      .select()
      .from(announcementsTable)
      .orderBy(desc(announcementsTable.createdAt))
      .limit(limit);

    res.json(ListAnnouncementsResponse.parse(announcements));
  }
);

router.post(
  "/admin/announcements",
  requirePermission("communications:manage"),
  async (req, res): Promise<void> => {
    const parsed = CreateAnnouncementBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Title and body are required" });
      return;
    }

    const title = parsed.data.title.trim();
    const body = parsed.data.body.trim();
    const { type } = parsed.data;

    if (!title || !body) {
      res.status(400).json({ error: "Title and body are required" });
      return;
    }

    const [created] = await db
      .insert(announcementsTable)
      .values({
        title,
        body,
        ...(type ? { type } : {}),
      })
      .returning();

    res.status(201).json(created);
  }
);

router.put(
  "/admin/announcements/:id",
  requirePermission("communications:manage"),
  async (req, res): Promise<void> => {
    const rawId = req.params.id as string;
    if (!/^[0-9]+$/.test(rawId)) {
      res.status(400).json({ error: "Invalid announcement id" });
      return;
    }
    const id = parseInt(rawId, 10);

    const parsed = UpdateAnnouncementBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Title and body are required" });
      return;
    }

    const title = parsed.data.title.trim();
    const body = parsed.data.body.trim();
    const { type } = parsed.data;

    if (!title || !body) {
      res.status(400).json({ error: "Title and body are required" });
      return;
    }

    // Note: editing does NOT re-trigger new-content texts. The scheduled-comms
    // SMS dedup is keyed per-announcement id (content_alert_sms_<id>_<member>),
    // and the announcement id is preserved on update, so already-texted members
    // are never re-texted by an edit.
    const [updated] = await db
      .update(announcementsTable)
      .set({
        title,
        body,
        ...(type ? { type } : {}),
      })
      .where(eq(announcementsTable.id, id))
      .returning();

    if (!updated) {
      res.status(404).json({ error: "Announcement not found" });
      return;
    }

    res.json(updated);
  }
);

router.delete(
  "/admin/announcements/:id",
  requirePermission("communications:manage"),
  async (req, res): Promise<void> => {
    const rawId = req.params.id as string;
    if (!/^[0-9]+$/.test(rawId)) {
      res.status(400).json({ error: "Invalid announcement id" });
      return;
    }
    const id = parseInt(rawId, 10);

    const [deleted] = await db
      .delete(announcementsTable)
      .where(eq(announcementsTable.id, id))
      .returning();

    if (!deleted) {
      res.status(404).json({ error: "Announcement not found" });
      return;
    }

    res.status(204).end();
  }
);

export default router;
