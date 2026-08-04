import type { Request, Response, NextFunction, RequestHandler } from "express";
import { db, contentAccessMapTable, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { isAdminRole, isCoachRole } from "@workspace/auth";
import { getAccessiblePageKeys } from "../lib/content-access-resolver";

/**
 * Server-side ownership guard for Content Access Map page keys.
 *
 * Resolves the SAME map the sidebar/route guards use (admin/coach bypass is
 * inside getAccessiblePageKeys) and FAILS CLOSED:
 *   - unauthenticated → 401
 *   - resolver error  → 403 (never open on infrastructure failure)
 *   - page not in the member's accessible set → 403 with upgrade info
 *   - NO content_access_map row for the page → 403 for members (the resolver
 *     treats unmapped pages as open for nav purposes, but for server-enforced
 *     endpoints an absent row means the boot seed hasn't landed — deny rather
 *     than inherit open-by-default; admins/coaches still pass)
 */
export function requirePageAccess(pageKey: string): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const userId = req.userId;
    if (!userId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    let accessible: string[];
    let mapped: boolean;
    let bypass: boolean;
    try {
      const [keys, mapRows, userRows] = await Promise.all([
        getAccessiblePageKeys(userId),
        db
          .select({ id: contentAccessMapTable.id })
          .from(contentAccessMapTable)
          .where(eq(contentAccessMapTable.pageKey, pageKey))
          .limit(1),
        db
          .select({ role: usersTable.role })
          .from(usersTable)
          .where(eq(usersTable.id, userId))
          .limit(1),
      ]);
      accessible = keys;
      mapped = mapRows.length > 0;
      const role = userRows[0]?.role;
      bypass = !!role && (isAdminRole(role) || isCoachRole(role));
    } catch (err) {
      console.error(`[ContentAccess] requirePageAccess(${pageKey}) resolver error:`, err);
      res.status(403).json({
        error: "CONTENT_NOT_OWNED",
        pageKey,
        message: "We couldn't verify access to this content. Please try again.",
      });
      return;
    }
    if (!accessible.includes(pageKey) || (!mapped && !bypass)) {
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
