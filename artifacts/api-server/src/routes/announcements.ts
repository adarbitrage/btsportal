import { Router, type IRouter } from "express";
import { db, announcementsTable } from "@workspace/db";
import { desc } from "drizzle-orm";
import {
  ListAnnouncementsResponse,
  CreateAnnouncementBody,
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

export default router;
