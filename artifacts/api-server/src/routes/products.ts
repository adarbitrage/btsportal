import { Router, type IRouter } from "express";
import { db, productsTable } from "@workspace/db";
import { ListProductsResponse } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/products", async (_req, res): Promise<void> => {
  const products = await db.select().from(productsTable).orderBy(productsTable.sortOrder);
  res.json(ListProductsResponse.parse(products));
});

export default router;
