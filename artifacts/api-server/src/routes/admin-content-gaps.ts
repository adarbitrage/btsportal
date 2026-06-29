/**
 * Admin Content-Gap Radar list (Task #8).
 *
 * Lightweight browse view over the questions the AI assistants could not
 * confidently answer (logged by lib/content-gap-radar.ts). Sorted by frequency
 * or recency so the highest-demand gaps surface first and authors know which
 * truth docs to write next.
 *
 * Read-only for now; the richer triage workflow (assign / dismiss / link-to-draft)
 * is a later phase.
 */

import { Router, type Request, type Response } from "express";
import { db, contentGapQuestionsTable } from "@workspace/db";
import { and, desc, eq, sql, type SQL } from "drizzle-orm";
import { requirePermission } from "../middleware/rbac";

const router = Router();

type SortKey = "frequency" | "recent";

function parseSort(value: unknown): SortKey {
  const str = Array.isArray(value) ? value[0] : value;
  return str === "recent" ? "recent" : "frequency";
}

function parseSurface(value: unknown): "chat" | "voice" | null {
  const str = Array.isArray(value) ? value[0] : value;
  return str === "chat" || str === "voice" ? str : null;
}

/**
 * GET /api/admin/content-gaps
 *   ?sort=frequency|recent  (default: frequency)
 *   ?surface=chat|voice     (optional filter)
 *   ?page=&limit=           (limit capped at 100)
 *
 * Returns the grouped/counted unanswered questions plus summary totals.
 */
router.get(
  "/admin/content-gaps",
  requirePermission("chat:manage"),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const sort = parseSort(req.query.sort);
      const surface = parseSurface(req.query.surface);
      const page = Math.max(parseInt(String(req.query.page ?? "1"), 10) || 1, 1);
      const limit = Math.min(
        Math.max(parseInt(String(req.query.limit ?? "25"), 10) || 25, 1),
        100,
      );
      const offset = (page - 1) * limit;

      const conditions: SQL[] = [];
      if (surface) {
        conditions.push(eq(contentGapQuestionsTable.surface, surface));
      }
      const where = conditions.length > 0 ? and(...conditions) : undefined;

      const orderBy =
        sort === "recent"
          ? [desc(contentGapQuestionsTable.lastAskedAt), desc(contentGapQuestionsTable.askCount)]
          : [desc(contentGapQuestionsTable.askCount), desc(contentGapQuestionsTable.lastAskedAt)];

      const [rows, [countRow], [summaryRow]] = await Promise.all([
        db
          .select({
            id: contentGapQuestionsTable.id,
            surface: contentGapQuestionsTable.surface,
            questionText: contentGapQuestionsTable.questionText,
            topScore: contentGapQuestionsTable.topScore,
            nearMisses: contentGapQuestionsTable.nearMisses,
            askCount: contentGapQuestionsTable.askCount,
            firstAskedAt: contentGapQuestionsTable.firstAskedAt,
            lastAskedAt: contentGapQuestionsTable.lastAskedAt,
          })
          .from(contentGapQuestionsTable)
          .where(where)
          .orderBy(...orderBy)
          .limit(limit)
          .offset(offset),
        db
          .select({ count: sql<number>`count(*)::int` })
          .from(contentGapQuestionsTable)
          .where(where),
        db
          .select({
            distinctQuestions: sql<number>`count(*)::int`,
            totalAsks: sql<number>`coalesce(sum(${contentGapQuestionsTable.askCount}), 0)::int`,
            chatQuestions: sql<number>`coalesce(sum(case when ${contentGapQuestionsTable.surface} = 'chat' then 1 else 0 end), 0)::int`,
            voiceQuestions: sql<number>`coalesce(sum(case when ${contentGapQuestionsTable.surface} = 'voice' then 1 else 0 end), 0)::int`,
          })
          .from(contentGapQuestionsTable),
      ]);

      const total = countRow?.count ?? 0;

      res.json({
        questions: rows,
        summary: {
          distinctQuestions: summaryRow?.distinctQuestions ?? 0,
          totalAsks: summaryRow?.totalAsks ?? 0,
          chatQuestions: summaryRow?.chatQuestions ?? 0,
          voiceQuestions: summaryRow?.voiceQuestions ?? 0,
        },
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      });
    } catch (error) {
      console.error("[ContentGaps] list error:", error);
      res.status(500).json({ error: "Failed to load content gaps" });
    }
  },
);

export default router;
