import { Router, type IRouter } from "express";
import { db, productsTable } from "@workspace/db";
import { ListPlansResponse, ListProductsResponse } from "@workspace/api-zod";
import { listUpgradeablePlans } from "../lib/plans";

const router: IRouter = Router();

router.get("/products", async (_req, res): Promise<void> => {
  const products = await db.select().from(productsTable).orderBy(productsTable.sortOrder);
  res.json(ListProductsResponse.parse(products));
});

// Public list of the upgradeable membership plans rendered on /plans. Plan
// name, priceDisplay, durationDays, and entitlement keys come from the
// `products` table so admin product edits propagate automatically.
router.get("/plans", async (_req, res): Promise<void> => {
  const plans = await listUpgradeablePlans();
  res.json(ListPlansResponse.parse(plans));
});

export default router;
