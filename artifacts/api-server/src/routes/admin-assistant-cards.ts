import { Router, type Request, type Response } from "express";
import {
  db,
  assistantCardGroupsTable,
  assistantCardsTable,
  assistantCardQuestionsTable,
  productsTable,
} from "@workspace/db";
import { eq, asc, sql } from "drizzle-orm";
import { requirePermission } from "../middleware/rbac";
import { reorderGroups, reorderCards, reorderQuestions, loadFullTree } from "../storage/assistant-cards";

const router = Router();
const PERM = "content:manage" as const;

function parseId(raw: string): number | null {
  const n = parseInt(raw, 10);
  return isNaN(n) ? null : n;
}

router.get("/admin/assistant/groups", requirePermission(PERM), async (_req: Request, res: Response): Promise<void> => {
  try {
    const groups = await db
      .select()
      .from(assistantCardGroupsTable)
      .orderBy(asc(assistantCardGroupsTable.sortOrder));
    res.json(groups);
  } catch (error) {
    console.error("[Admin Assistant] Error listing groups:", error);
    res.status(500).json({ error: "Failed to list groups" });
  }
});

router.post("/admin/assistant/groups", requirePermission(PERM), async (req: Request, res: Response): Promise<void> => {
  try {
    const { name, description, icon, sortOrder } = req.body as {
      name: string;
      description?: string;
      icon?: string;
      sortOrder?: number;
    };

    if (!name) {
      res.status(400).json({ error: "name is required" });
      return;
    }

    let order = sortOrder;
    if (order === undefined) {
      const [maxRow] = await db
        .select({ max: sql<number>`COALESCE(MAX(${assistantCardGroupsTable.sortOrder}), -1)` })
        .from(assistantCardGroupsTable);
      order = (maxRow?.max ?? -1) + 1;
    }

    const [group] = await db
      .insert(assistantCardGroupsTable)
      .values({ name, description: description ?? null, icon: icon ?? null, sortOrder: order })
      .returning();

    res.status(201).json(group);
  } catch (error) {
    console.error("[Admin Assistant] Error creating group:", error);
    res.status(500).json({ error: "Failed to create group" });
  }
});

router.put("/admin/assistant/groups/:id", requirePermission(PERM), async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseId(req.params.id);
    if (id === null) { res.status(400).json({ error: "Invalid group ID" }); return; }

    const { name, description, icon, sortOrder, isActive } = req.body as {
      name?: string;
      description?: string;
      icon?: string;
      sortOrder?: number;
      isActive?: boolean;
    };

    const updates: Partial<typeof assistantCardGroupsTable.$inferInsert> = {};
    if (name !== undefined) updates.name = name;
    if (description !== undefined) updates.description = description;
    if (icon !== undefined) updates.icon = icon;
    if (sortOrder !== undefined) updates.sortOrder = sortOrder;
    if (isActive !== undefined) updates.isActive = isActive;

    if (Object.keys(updates).length === 0) { res.status(400).json({ error: "No fields to update" }); return; }

    const [updated] = await db
      .update(assistantCardGroupsTable)
      .set(updates)
      .where(eq(assistantCardGroupsTable.id, id))
      .returning();

    if (!updated) { res.status(404).json({ error: "Group not found" }); return; }

    res.json(updated);
  } catch (error) {
    console.error("[Admin Assistant] Error updating group:", error);
    res.status(500).json({ error: "Failed to update group" });
  }
});

router.delete("/admin/assistant/groups/:id", requirePermission(PERM), async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseId(req.params.id);
    if (id === null) { res.status(400).json({ error: "Invalid group ID" }); return; }

    const [updated] = await db
      .update(assistantCardGroupsTable)
      .set({ isActive: false })
      .where(eq(assistantCardGroupsTable.id, id))
      .returning();

    if (!updated) { res.status(404).json({ error: "Group not found" }); return; }

    res.json({ message: "Group soft-deleted" });
  } catch (error) {
    console.error("[Admin Assistant] Error deleting group:", error);
    res.status(500).json({ error: "Failed to delete group" });
  }
});

router.post("/admin/assistant/groups/reorder", requirePermission(PERM), async (req: Request, res: Response): Promise<void> => {
  try {
    const { ordered_ids } = req.body as { ordered_ids: number[] };
    if (!Array.isArray(ordered_ids) || ordered_ids.some((id) => typeof id !== "number")) {
      res.status(400).json({ error: "ordered_ids must be an array of numbers" });
      return;
    }
    await reorderGroups(ordered_ids);
    res.json({ message: "Groups reordered" });
  } catch (error) {
    console.error("[Admin Assistant] Error reordering groups:", error);
    res.status(500).json({ error: "Failed to reorder groups" });
  }
});

router.get("/admin/assistant/cards", requirePermission(PERM), async (_req: Request, res: Response): Promise<void> => {
  try {
    const cards = await db
      .select({
        id: assistantCardsTable.id,
        groupId: assistantCardsTable.groupId,
        title: assistantCardsTable.title,
        description: assistantCardsTable.description,
        icon: assistantCardsTable.icon,
        entitlementKey: assistantCardsTable.entitlementKey,
        upgradeProductId: assistantCardsTable.upgradeProductId,
        sortOrder: assistantCardsTable.sortOrder,
        isActive: assistantCardsTable.isActive,
        createdAt: assistantCardsTable.createdAt,
        updatedAt: assistantCardsTable.updatedAt,
        upgradeProductName: productsTable.name,
      })
      .from(assistantCardsTable)
      .leftJoin(productsTable, eq(assistantCardsTable.upgradeProductId, productsTable.id))
      .orderBy(asc(assistantCardsTable.sortOrder));

    res.json(cards);
  } catch (error) {
    console.error("[Admin Assistant] Error listing cards:", error);
    res.status(500).json({ error: "Failed to list cards" });
  }
});

router.post("/admin/assistant/cards", requirePermission(PERM), async (req: Request, res: Response): Promise<void> => {
  try {
    const { groupId, title, description, icon, entitlementKey, upgradeProductId, sortOrder } = req.body as {
      groupId: number;
      title: string;
      description?: string;
      icon?: string;
      entitlementKey?: string;
      upgradeProductId?: number;
      sortOrder?: number;
    };

    if (!groupId || !title) {
      res.status(400).json({ error: "groupId and title are required" });
      return;
    }

    let order = sortOrder;
    if (order === undefined) {
      const [maxRow] = await db
        .select({ max: sql<number>`COALESCE(MAX(${assistantCardsTable.sortOrder}), -1)` })
        .from(assistantCardsTable)
        .where(eq(assistantCardsTable.groupId, groupId));
      order = (maxRow?.max ?? -1) + 1;
    }

    const [card] = await db
      .insert(assistantCardsTable)
      .values({
        groupId,
        title,
        description: description ?? null,
        icon: icon ?? null,
        entitlementKey: entitlementKey ?? null,
        upgradeProductId: upgradeProductId ?? null,
        sortOrder: order,
      })
      .returning();

    res.status(201).json(card);
  } catch (error) {
    console.error("[Admin Assistant] Error creating card:", error);
    res.status(500).json({ error: "Failed to create card" });
  }
});

router.put("/admin/assistant/cards/:id", requirePermission(PERM), async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseId(req.params.id);
    if (id === null) { res.status(400).json({ error: "Invalid card ID" }); return; }

    const { groupId, title, description, icon, entitlementKey, upgradeProductId, sortOrder, isActive } = req.body as {
      groupId?: number;
      title?: string;
      description?: string;
      icon?: string;
      entitlementKey?: string | null;
      upgradeProductId?: number | null;
      sortOrder?: number;
      isActive?: boolean;
    };

    const updates: Partial<typeof assistantCardsTable.$inferInsert> = {};
    if (groupId !== undefined) updates.groupId = groupId;
    if (title !== undefined) updates.title = title;
    if (description !== undefined) updates.description = description;
    if (icon !== undefined) updates.icon = icon;
    if (entitlementKey !== undefined) updates.entitlementKey = entitlementKey;
    if (upgradeProductId !== undefined) updates.upgradeProductId = upgradeProductId;
    if (sortOrder !== undefined) updates.sortOrder = sortOrder;
    if (isActive !== undefined) updates.isActive = isActive;

    if (Object.keys(updates).length === 0) { res.status(400).json({ error: "No fields to update" }); return; }

    const [updated] = await db
      .update(assistantCardsTable)
      .set(updates)
      .where(eq(assistantCardsTable.id, id))
      .returning();

    if (!updated) { res.status(404).json({ error: "Card not found" }); return; }

    res.json(updated);
  } catch (error) {
    console.error("[Admin Assistant] Error updating card:", error);
    res.status(500).json({ error: "Failed to update card" });
  }
});

router.delete("/admin/assistant/cards/:id", requirePermission(PERM), async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseId(req.params.id);
    if (id === null) { res.status(400).json({ error: "Invalid card ID" }); return; }

    const [updated] = await db
      .update(assistantCardsTable)
      .set({ isActive: false })
      .where(eq(assistantCardsTable.id, id))
      .returning();

    if (!updated) { res.status(404).json({ error: "Card not found" }); return; }

    res.json({ message: "Card soft-deleted" });
  } catch (error) {
    console.error("[Admin Assistant] Error deleting card:", error);
    res.status(500).json({ error: "Failed to delete card" });
  }
});

router.post("/admin/assistant/cards/reorder", requirePermission(PERM), async (req: Request, res: Response): Promise<void> => {
  try {
    const { ordered_ids } = req.body as { ordered_ids: number[] };
    if (!Array.isArray(ordered_ids) || ordered_ids.some((id) => typeof id !== "number")) {
      res.status(400).json({ error: "ordered_ids must be an array of numbers" });
      return;
    }
    await reorderCards(ordered_ids);
    res.json({ message: "Cards reordered" });
  } catch (error) {
    console.error("[Admin Assistant] Error reordering cards:", error);
    res.status(500).json({ error: "Failed to reorder cards" });
  }
});

router.get("/admin/assistant/questions", requirePermission(PERM), async (req: Request, res: Response): Promise<void> => {
  try {
    const cardIdParam = req.query.cardId as string | undefined;

    let query = db
      .select()
      .from(assistantCardQuestionsTable)
      .orderBy(asc(assistantCardQuestionsTable.sortOrder));

    if (cardIdParam) {
      const cardId = parseId(cardIdParam);
      if (cardId === null) { res.status(400).json({ error: "Invalid cardId" }); return; }
      const questions = await db
        .select()
        .from(assistantCardQuestionsTable)
        .where(eq(assistantCardQuestionsTable.cardId, cardId))
        .orderBy(asc(assistantCardQuestionsTable.sortOrder));
      res.json(questions);
      return;
    }

    const questions = await query;
    res.json(questions);
  } catch (error) {
    console.error("[Admin Assistant] Error listing questions:", error);
    res.status(500).json({ error: "Failed to list questions" });
  }
});

router.post("/admin/assistant/questions", requirePermission(PERM), async (req: Request, res: Response): Promise<void> => {
  try {
    const { cardId, body, sortOrder, generatedBy, retrievalConfidence, sourceKbDocIds } = req.body as {
      cardId: number;
      body: string;
      sortOrder?: number;
      generatedBy?: string;
      retrievalConfidence?: number | null;
      sourceKbDocIds?: number[];
    };

    if (!cardId || !body) {
      res.status(400).json({ error: "cardId and body are required" });
      return;
    }

    let order = sortOrder;
    if (order === undefined) {
      const [maxRow] = await db
        .select({ max: sql<number>`COALESCE(MAX(${assistantCardQuestionsTable.sortOrder}), -1)` })
        .from(assistantCardQuestionsTable)
        .where(eq(assistantCardQuestionsTable.cardId, cardId));
      order = (maxRow?.max ?? -1) + 1;
    }

    const [question] = await db
      .insert(assistantCardQuestionsTable)
      .values({
        cardId,
        body,
        sortOrder: order,
        generatedBy: generatedBy ?? "manual",
        retrievalConfidence: retrievalConfidence ?? null,
        sourceKbDocIds: sourceKbDocIds ?? [],
      })
      .returning();

    res.status(201).json(question);
  } catch (error) {
    console.error("[Admin Assistant] Error creating question:", error);
    res.status(500).json({ error: "Failed to create question" });
  }
});

router.put("/admin/assistant/questions/:id", requirePermission(PERM), async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseId(req.params.id);
    if (id === null) { res.status(400).json({ error: "Invalid question ID" }); return; }

    const { cardId, body, sortOrder, isActive, generatedBy, retrievalConfidence, sourceKbDocIds } = req.body as {
      cardId?: number;
      body?: string;
      sortOrder?: number;
      isActive?: boolean;
      generatedBy?: string;
      retrievalConfidence?: number | null;
      sourceKbDocIds?: number[];
    };

    const updates: Partial<typeof assistantCardQuestionsTable.$inferInsert> = {};
    if (cardId !== undefined) updates.cardId = cardId;
    if (body !== undefined) updates.body = body;
    if (sortOrder !== undefined) updates.sortOrder = sortOrder;
    if (isActive !== undefined) updates.isActive = isActive;
    if (generatedBy !== undefined) updates.generatedBy = generatedBy;
    if (retrievalConfidence !== undefined) updates.retrievalConfidence = retrievalConfidence;
    if (sourceKbDocIds !== undefined) updates.sourceKbDocIds = sourceKbDocIds;

    if (Object.keys(updates).length === 0) { res.status(400).json({ error: "No fields to update" }); return; }

    const [updated] = await db
      .update(assistantCardQuestionsTable)
      .set(updates)
      .where(eq(assistantCardQuestionsTable.id, id))
      .returning();

    if (!updated) { res.status(404).json({ error: "Question not found" }); return; }

    res.json(updated);
  } catch (error) {
    console.error("[Admin Assistant] Error updating question:", error);
    res.status(500).json({ error: "Failed to update question" });
  }
});

router.delete("/admin/assistant/questions/:id", requirePermission(PERM), async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseId(req.params.id);
    if (id === null) { res.status(400).json({ error: "Invalid question ID" }); return; }

    const [updated] = await db
      .update(assistantCardQuestionsTable)
      .set({ isActive: false })
      .where(eq(assistantCardQuestionsTable.id, id))
      .returning();

    if (!updated) { res.status(404).json({ error: "Question not found" }); return; }

    res.json({ message: "Question soft-deleted" });
  } catch (error) {
    console.error("[Admin Assistant] Error deleting question:", error);
    res.status(500).json({ error: "Failed to delete question" });
  }
});

router.post("/admin/assistant/questions/reorder", requirePermission(PERM), async (req: Request, res: Response): Promise<void> => {
  try {
    const { ordered_ids } = req.body as { ordered_ids: number[] };
    if (!Array.isArray(ordered_ids) || ordered_ids.some((id) => typeof id !== "number")) {
      res.status(400).json({ error: "ordered_ids must be an array of numbers" });
      return;
    }
    await reorderQuestions(ordered_ids);
    res.json({ message: "Questions reordered" });
  } catch (error) {
    console.error("[Admin Assistant] Error reordering questions:", error);
    res.status(500).json({ error: "Failed to reorder questions" });
  }
});

router.get("/admin/assistant/tree", requirePermission(PERM), async (_req: Request, res: Response): Promise<void> => {
  try {
    const groups = await loadFullTree(false);
    res.json({ groups });
  } catch (error) {
    console.error("[Admin Assistant] Error loading tree:", error);
    res.status(500).json({ error: "Failed to load tree" });
  }
});

export default router;
