import { Router, type Request, type Response } from "express";
import { db, moderationWordlistTable } from "@workspace/db";
import { eq, asc, desc, ilike, and } from "drizzle-orm";
import { requirePermission } from "../../middleware/rbac";
import { invalidateWordlistCache } from "../../lib/moderation/wordlist";

const router = Router();

router.get("/", requirePermission("community:moderate"), async (req: Request, res: Response) => {
  try {
    const category = req.query.category as string | undefined;
    const severity = req.query.severity as string | undefined;
    const search = req.query.search as string | undefined;
    const sort = req.query.sort as string | undefined;
    const order = req.query.order === "desc" ? "desc" : "asc";

    const conditions = [];
    if (category) conditions.push(eq(moderationWordlistTable.category, category));
    if (severity) conditions.push(eq(moderationWordlistTable.severity, severity));
    if (search) conditions.push(ilike(moderationWordlistTable.word, `%${search}%`));

    const sortCol =
      sort === "category" ? moderationWordlistTable.category :
      sort === "severity" ? moderationWordlistTable.severity :
      sort === "createdAt" ? moderationWordlistTable.createdAt :
      moderationWordlistTable.word;

    const rows = await db
      .select()
      .from(moderationWordlistTable)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(order === "desc" ? desc(sortCol) : asc(sortCol));

    res.json(rows);
  } catch (err) {
    console.error("[Admin/Wordlist] List error:", err);
    res.status(500).json({ error: "Failed to fetch wordlist" });
  }
});

router.post("/", requirePermission("community:moderate"), async (req: Request, res: Response) => {
  try {
    const { word, category, severity } = req.body;
    if (!word || !category || !severity) {
      res.status(400).json({ error: "word, category, and severity are required" });
      return;
    }
    if (!["HARD", "SOFT"].includes(severity)) {
      res.status(400).json({ error: "severity must be HARD or SOFT" });
      return;
    }

    const normalizedWord = word.toLowerCase().trim();
    const [entry] = await db
      .insert(moderationWordlistTable)
      .values({ word: normalizedWord, category, severity })
      .returning();

    invalidateWordlistCache();
    res.status(201).json(entry);
  } catch (err: any) {
    if (err?.code === "23505") {
      res.status(409).json({ error: "Word already exists in wordlist" });
      return;
    }
    console.error("[Admin/Wordlist] Create error:", err);
    res.status(500).json({ error: "Failed to create wordlist entry" });
  }
});

router.put("/:id", requirePermission("community:moderate"), async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid ID" });
      return;
    }

    const { word, category, severity } = req.body;
    const updates: Record<string, any> = {};
    if (word !== undefined) updates.word = word.toLowerCase().trim();
    if (category !== undefined) updates.category = category;
    if (severity !== undefined) {
      if (!["HARD", "SOFT"].includes(severity)) {
        res.status(400).json({ error: "severity must be HARD or SOFT" });
        return;
      }
      updates.severity = severity;
    }

    if (Object.keys(updates).length === 0) {
      res.status(400).json({ error: "No fields to update" });
      return;
    }

    const [updated] = await db
      .update(moderationWordlistTable)
      .set(updates)
      .where(eq(moderationWordlistTable.id, id))
      .returning();

    if (!updated) {
      res.status(404).json({ error: "Wordlist entry not found" });
      return;
    }

    invalidateWordlistCache();
    res.json(updated);
  } catch (err: any) {
    if (err?.code === "23505") {
      res.status(409).json({ error: "Word already exists in wordlist" });
      return;
    }
    console.error("[Admin/Wordlist] Update error:", err);
    res.status(500).json({ error: "Failed to update wordlist entry" });
  }
});

router.delete("/:id", requirePermission("community:moderate"), async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid ID" });
      return;
    }

    const [deleted] = await db
      .delete(moderationWordlistTable)
      .where(eq(moderationWordlistTable.id, id))
      .returning();

    if (!deleted) {
      res.status(404).json({ error: "Wordlist entry not found" });
      return;
    }

    invalidateWordlistCache();
    res.json({ success: true });
  } catch (err) {
    console.error("[Admin/Wordlist] Delete error:", err);
    res.status(500).json({ error: "Failed to delete wordlist entry" });
  }
});

export default router;
