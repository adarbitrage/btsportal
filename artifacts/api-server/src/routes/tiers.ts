import { Router, type IRouter } from "express";
import { db, tiersTable } from "@workspace/db";
import { ListTiersResponse } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/tiers", async (_req, res): Promise<void> => {
  const tiers = await db.select().from(tiersTable).orderBy(tiersTable.level);
  const mapped = tiers.map((t) => ({
    ...t,
    priceMonthly: Number(t.priceMonthly),
  }));
  res.json(ListTiersResponse.parse(mapped));
});

export default router;
