import { Router } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { requirePermission } from "../../middleware/rbac.js";
import { generateQuestions } from "../../services/assistantCards/questionGenerator.js";

const RELATION_DOES_NOT_EXIST = "42P01";

const router = Router();

router.post(
  "/admin/assistant/cards/:cardId/generate-questions",
  requirePermission("chat:manage"),
  async (req, res): Promise<void> => {
    req.setTimeout(60_000);
    res.setTimeout(60_000);

    const cardId = parseInt(req.params.cardId, 10);
    if (isNaN(cardId)) {
      res.status(400).json({ error: "Invalid cardId" });
      return;
    }

    const { kb_doc_ids, kb_tags, target_count } = req.body as {
      kb_doc_ids?: number[];
      kb_tags?: string[];
      target_count?: number;
    };

    let cardLabel = "";
    let cardDescription = "";

    try {
      const result = await db.execute(
        sql`SELECT label, description FROM assistant_cards WHERE id = ${cardId} AND is_active = true LIMIT 1`,
      );
      if (result.rows.length === 0) {
        res.status(404).json({ error: "Card not found" });
        return;
      }
      const card = result.rows[0] as any;
      cardLabel = card.label ?? "";
      cardDescription = card.description ?? "";
    } catch (err: any) {
      const pgCode: string | undefined = err?.cause?.code ?? err?.code;
      if (pgCode === RELATION_DOES_NOT_EXIST) {
        cardLabel = (req.body.card_label as string | undefined) ?? "";
        cardDescription = (req.body.card_description as string | undefined) ?? "";
      } else {
        throw err;
      }
    }

    const result = await generateQuestions({
      cardId,
      cardLabel,
      cardDescription,
      kbDocIds: Array.isArray(kb_doc_ids) ? kb_doc_ids : undefined,
      kbTags: Array.isArray(kb_tags) ? kb_tags : undefined,
      targetCount:
        typeof target_count === "number" && target_count > 0 && target_count <= 100
          ? target_count
          : 30,
    });

    res.json(result);
  },
);

export default router;
