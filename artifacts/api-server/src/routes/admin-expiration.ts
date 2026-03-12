import { Router, type Request, type Response } from "express";
import { db, userProductsTable, productsTable, usersTable } from "@workspace/db";
import { eq, and, lt, lte, gte, isNotNull } from "drizzle-orm";

const router = Router();

function requireAdmin(req: Request, res: Response, next: Function) {
  if (!req.userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  db.select({ role: usersTable.role })
    .from(usersTable)
    .where(eq(usersTable.id, req.userId))
    .limit(1)
    .then(([user]) => {
      if (!user || user.role !== "admin") {
        res.status(403).json({ error: "Admin access required" });
        return;
      }
      next();
    })
    .catch(() => {
      res.status(500).json({ error: "Failed to verify admin status" });
    });
}

router.post("/admin/run-expiration-check", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const now = new Date();
    const thirtyDaysFromNow = new Date(now);
    thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);
    const sevenDaysFromNow = new Date(now);
    sevenDaysFromNow.setDate(sevenDaysFromNow.getDate() + 7);

    const expiredActive = await db.update(userProductsTable)
      .set({ status: "expired" })
      .where(and(
        eq(userProductsTable.status, "active"),
        isNotNull(userProductsTable.expiresAt),
        lt(userProductsTable.expiresAt, now)
      ))
      .returning();

    const expiredCancelled = await db.update(userProductsTable)
      .set({ status: "expired" })
      .where(and(
        eq(userProductsTable.status, "cancelled"),
        isNotNull(userProductsTable.expiresAt),
        lt(userProductsTable.expiresAt, now)
      ))
      .returning();

    const expiredPastDue = await db.update(userProductsTable)
      .set({ status: "expired" })
      .where(and(
        eq(userProductsTable.status, "past_due"),
        isNotNull(userProductsTable.graceExpiresAt),
        lt(userProductsTable.graceExpiresAt, now)
      ))
      .returning();

    const expiring30Days = await db
      .select({
        userId: userProductsTable.userId,
        productName: productsTable.name,
        expiresAt: userProductsTable.expiresAt,
      })
      .from(userProductsTable)
      .innerJoin(productsTable, eq(userProductsTable.productId, productsTable.id))
      .where(and(
        eq(userProductsTable.status, "active"),
        isNotNull(userProductsTable.expiresAt),
        gte(userProductsTable.expiresAt, now),
        lte(userProductsTable.expiresAt, thirtyDaysFromNow)
      ));

    const expiring7Days = expiring30Days.filter(
      (item) => item.expiresAt && item.expiresAt <= sevenDaysFromNow
    );

    for (const item of expiring30Days) {
      const isUrgent = expiring7Days.includes(item);
      console.log(`[STUB:Notification] ${isUrgent ? "URGENT" : "WARNING"}: User ${item.userId}'s "${item.productName}" expires at ${item.expiresAt?.toISOString()}`);
    }

    for (const item of expiredActive) {
      console.log(`[Expiration] Expired active product (user_product ID: ${item.id}) for user ${item.userId}`);
    }
    for (const item of expiredCancelled) {
      console.log(`[Expiration] Expired cancelled product (user_product ID: ${item.id}) for user ${item.userId}`);
    }
    for (const item of expiredPastDue) {
      console.log(`[Expiration] Expired past-due product (user_product ID: ${item.id}) for user ${item.userId}`);
    }

    res.json({
      results: {
        expiredActive: expiredActive.length,
        expiredCancelled: expiredCancelled.length,
        expiredPastDue: expiredPastDue.length,
        expiringIn30Days: expiring30Days.length,
        expiringIn7Days: expiring7Days.length,
      },
    });
  } catch (error) {
    console.error("[Admin] Error running expiration check:", error);
    res.status(500).json({ error: "Failed to run expiration check" });
  }
});

export default router;
