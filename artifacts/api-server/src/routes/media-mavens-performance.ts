import { Router, type Request, type Response } from "express";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  getAffiliateConversions,
  getAffiliatePayouts,
  TapfiliateConfigError,
  TapfiliateApiError,
} from "../lib/tapfiliate";
import { resolveAffiliateId } from "../lib/tapfiliate-affiliate";

const router = Router();

router.get("/affiliate/performance", async (req: Request, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const dataset = req.query.dataset as string;
    if (dataset !== "conversions" && dataset !== "payouts") {
      res.status(400).json({ error: "dataset must be 'conversions' or 'payouts'" });
      return;
    }

    const rawPage = parseInt((req.query.page as string) || "1", 10);
    const page = Number.isFinite(rawPage) && rawPage >= 1 ? rawPage : 1;

    const [user] = await db
      .select({ email: usersTable.email, name: usersTable.name })
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .limit(1);

    if (!user) {
      res.status(401).json({ error: "User not found" });
      return;
    }

    const affiliateId = await resolveAffiliateId(userId, user.email, user.name);

    if (dataset === "conversions") {
      const data = await getAffiliateConversions(affiliateId, page);
      res.json({ ...data, page });
    } else {
      const data = await getAffiliatePayouts(affiliateId, page);
      res.json({ ...data, page });
    }
  } catch (error) {
    if (error instanceof TapfiliateConfigError) {
      console.error("[MediaMavensPerformance] Tapfiliate not configured:", (error as Error).message);
      res.status(503).json({
        error:
          "Performance data is temporarily unavailable: the Tapfiliate integration is not configured. Please contact an administrator.",
      });
      return;
    }
    if (error instanceof TapfiliateApiError) {
      console.error("[MediaMavensPerformance] Tapfiliate API error:", (error as Error).message);
      res.status(502).json({
        error:
          "Performance data is temporarily unavailable: the Tapfiliate service returned an error. Please try again shortly.",
      });
      return;
    }
    console.error("[MediaMavensPerformance] Error fetching performance data:", error);
    res.status(500).json({ error: "Failed to fetch performance data" });
  }
});

export default router;
