import { Router, type IRouter } from "express";
import { requirePageAccess } from "../middleware/require-page-access";

/**
 * Gated front-end curriculum content endpoints (de-bundle enforcement).
 *
 * Serves the bodies of the 7 Pillars, Quick-Start Guide, Pillars-to-Blitz,
 * and Tips & Tricks pages from the server so no course copy ships in the
 * portal bundle. Each endpoint sits behind requirePageAccess on its OWN page
 * key — the exact middleware (and 403 CONTENT_NOT_OWNED shape) the Blitz
 * guide uses. Admin/coach role bypasses ride the middleware unchanged.
 *
 * The content module is dynamically imported (Blitz-guide pattern) so the
 * course copy stays out of any statically-analyzable client graph and only
 * loads when an authorized request arrives.
 */
const router: IRouter = Router();

const PAGE_KEYS = [
  "seven-pillars",
  "quick-start",
  "pillars-to-blitz",
  "tips-and-tricks",
  "frontend-welcome",
] as const;

for (const pageKey of PAGE_KEYS) {
  router.get(`/curriculum/${pageKey}`, requirePageAccess(pageKey), async (_req, res): Promise<void> => {
    try {
      const { CURRICULUM_CONTENT } = await import("../lib/curriculum-content");
      const content = CURRICULUM_CONTENT[pageKey];
      if (!content) {
        res.status(500).json({ error: "Curriculum content unavailable" });
        return;
      }
      res.json({ content });
    } catch (err) {
      console.error(`[Curriculum] Failed to load content for ${pageKey}:`, err);
      res.status(500).json({ error: "Curriculum content unavailable" });
    }
  });
}

export default router;
