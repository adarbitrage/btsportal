import { Router, type Request, type Response } from "express";
import { db, mediaMavensProductsTable, usersTable } from "@workspace/db";
import { eq, asc } from "drizzle-orm";
import {
  resolveReferralUrl,
  TapfiliateConfigError,
  TapfiliateApiError,
} from "../lib/tapfiliate-affiliate";

const router = Router();

router.get("/media-mavens-products/with-links", async (req: Request, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const [user] = await db
      .select({ email: usersTable.email, name: usersTable.name })
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .limit(1);

    if (!user) {
      res.status(401).json({ error: "User not found" });
      return;
    }

    const products = await db
      .select()
      .from(mediaMavensProductsTable)
      .where(eq(mediaMavensProductsTable.isActive, true))
      .orderBy(asc(mediaMavensProductsTable.displayOrder));

    // Products with NO assigned program fall back to the affiliateLink template
    // exactly as before — they never touch Tapfiliate. Products WITH an assigned
    // program must resolve a real per-user URL; if Tapfiliate is unconfigured or
    // erroring we fail loudly (below) rather than silently masking it with the
    // template.
    const results = await Promise.all(
      products.map(async (product) => {
        if (!product.tapfiliateProgramId) {
          return { ...product, resolvedAffiliateLink: product.affiliateLink };
        }

        const url = await resolveReferralUrl(
          userId,
          user.email,
          user.name,
          product.tapfiliateProgramId,
        );
        return {
          ...product,
          resolvedAffiliateLink: url ?? product.affiliateLink,
        };
      }),
    );

    res.json(results);
  } catch (error) {
    if (error instanceof TapfiliateConfigError) {
      console.error("[MediaMavens] Tapfiliate not configured:", error.message);
      res.status(503).json({
        error:
          "Affiliate links are temporarily unavailable: the Tapfiliate integration is not configured. Please contact an administrator.",
      });
      return;
    }
    if (error instanceof TapfiliateApiError) {
      console.error("[MediaMavens] Tapfiliate API error:", error.message);
      res.status(502).json({
        error:
          "Affiliate links are temporarily unavailable: the Tapfiliate service returned an error. Please try again shortly.",
      });
      return;
    }
    console.error("[MediaMavens] Error resolving affiliate links:", error);
    res.status(500).json({ error: "Failed to resolve affiliate links" });
  }
});

export default router;
