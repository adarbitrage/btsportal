import { Router, type Request, type Response } from "express";
import { db, communicationLogTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";

const router = Router();

router.get("/members/me/communications", async (req: Request, res: Response) => {
  if (!req.userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string) || 20));
  const offset = (page - 1) * limit;

  const communications = await db
    .select({
      id: communicationLogTable.id,
      channel: communicationLogTable.channel,
      templateSlug: communicationLogTable.templateSlug,
      recipientEmail: communicationLogTable.recipientEmail,
      subject: communicationLogTable.subject,
      status: communicationLogTable.status,
      category: communicationLogTable.category,
      deliveredAt: communicationLogTable.deliveredAt,
      openedAt: communicationLogTable.openedAt,
      createdAt: communicationLogTable.createdAt,
    })
    .from(communicationLogTable)
    .where(eq(communicationLogTable.userId, req.userId))
    .orderBy(desc(communicationLogTable.createdAt))
    .limit(limit)
    .offset(offset);

  res.json({ communications, page, limit });
});

export default router;
