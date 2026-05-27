import { Router, type Request, type Response } from "express";
import { getUserEntitlements } from "../lib/entitlements";
import { loadFullTree } from "../storage/assistant-cards";

const router = Router();

router.get("/assistant/cards", async (req: Request, res: Response): Promise<void> => {
  const userId = req.userId!;

  try {
    const entitlements = await getUserEntitlements(userId);
    const groups = await loadFullTree(true);

    const result = groups.map((group) => ({
      id: group.id,
      name: group.name,
      description: group.description,
      icon: group.icon,
      sortOrder: group.sortOrder,
      cards: group.cards.map((card) => {
        const locked = card.entitlementKey != null && !entitlements.has(card.entitlementKey);

        if (locked) {
          return {
            id: card.id,
            groupId: card.groupId,
            title: card.title,
            description: card.description,
            icon: card.icon,
            entitlementKey: card.entitlementKey,
            sortOrder: card.sortOrder,
            locked: true,
            upgradeProduct: card.upgradeProduct
              ? {
                  id: card.upgradeProduct.id,
                  name: card.upgradeProduct.name,
                  priceDisplay: card.upgradeProduct.priceDisplay,
                }
              : null,
            questions: [],
          };
        }

        return {
          id: card.id,
          groupId: card.groupId,
          title: card.title,
          description: card.description,
          icon: card.icon,
          entitlementKey: card.entitlementKey,
          sortOrder: card.sortOrder,
          locked: false,
          upgradeProduct: null,
          questions: card.questions.map((q) => ({
            id: q.id,
            cardId: q.cardId,
            body: q.body,
            sortOrder: q.sortOrder,
          })),
        };
      }),
    }));

    res.json({ groups: result });
  } catch (error) {
    console.error("[Assistant Cards] Error loading cards:", error);
    res.status(500).json({ error: "Failed to load assistant cards" });
  }
});

export default router;
