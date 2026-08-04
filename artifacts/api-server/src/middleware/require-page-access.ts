import type { Request, Response, NextFunction, RequestHandler } from "express";
import { getAccessiblePageKeys } from "../lib/content-access-resolver";

/**
 * Server-side ownership guard for Content Access Map page keys.
 *
 * Resolves the SAME map the sidebar/route guards use (admin/coach bypass is
 * inside getAccessiblePageKeys) and FAILS CLOSED:
 *   - unauthenticated → 401
 *   - resolver error  → 403 (never open on infrastructure failure)
 *   - page not in the member's accessible set → 403 with upgrade info
 */
export function requirePageAccess(pageKey: string): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const userId = req.userId;
    if (!userId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    let accessible: string[];
    try {
      accessible = await getAccessiblePageKeys(userId);
    } catch (err) {
      console.error(`[ContentAccess] requirePageAccess(${pageKey}) resolver error:`, err);
      res.status(403).json({
        error: "CONTENT_NOT_OWNED",
        pageKey,
        message: "We couldn't verify access to this content. Please try again.",
      });
      return;
    }
    if (!accessible.includes(pageKey)) {
      res.status(403).json({
        error: "CONTENT_NOT_OWNED",
        pageKey,
        message: "This content isn't included in your current products.",
        upgrade: {
          reason: `Access to this page requires a product that includes "${pageKey}".`,
          learnMorePath: "/",
        },
      });
      return;
    }
    next();
  };
}
