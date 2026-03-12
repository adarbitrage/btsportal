import { Router, type IRouter } from "express";
import { db, announcementsTable } from "@workspace/db";
import { desc } from "drizzle-orm";
import { ListAnnouncementsResponse } from "@workspace/api-zod";

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

export default router;
