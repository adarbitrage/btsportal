import { Router, type Request, type Response } from "express";
import { db, userProductsTable, productsTable, usersTable } from "@workspace/db";
import { eq, and, lt, lte, gte, isNotNull, inArray } from "drizzle-orm";
import { queueGHLSync } from "../lib/ghl-queue";
import { requirePermission } from "../middleware/rbac";
import { CommunicationService } from "../lib/communication-service";
import { PRODUCT_RANK } from "../lib/product-rank";
import { isPartnerEligibleRank, endActiveAssignment } from "../lib/partner-assignment";

const router = Router();

router.post("/admin/run-expiration-check", requirePermission("settings:manage"), async (_req: Request, res: Response) => {
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
      const [expiringUser] = await db.select({ email: usersTable.email, name: usersTable.name }).from(usersTable).where(eq(usersTable.id, item.userId)).limit(1);
      if (expiringUser) {
        const templateSlug = isUrgent ? "mentorship_expiring_urgent" : "mentorship_expiring_warning";
        CommunicationService.queueEmail({
          templateSlug,
          to: expiringUser.email,
          variables: {
            member_name: expiringUser.name,
            product_name: item.productName,
            expiration_date: item.expiresAt?.toLocaleDateString() || "",
          },
          userId: item.userId,
        });
      }
      console.log(`[Expiration] ${isUrgent ? "URGENT" : "WARNING"}: User ${item.userId}'s "${item.productName}" expires at ${item.expiresAt?.toISOString()}`);

      if (isUrgent) {
        await queueGHLSync({
          action: "add_tags",
          userId: item.userId,
          tags: ["expiring_7_days", `expiring_${item.productName.toLowerCase().replace(/\s+/g, "_")}`],
        });
      } else {
        await queueGHLSync({
          action: "add_tags",
          userId: item.userId,
          tags: ["expiring_30_days"],
        });
      }
    }

    for (const item of expiredActive) {
      console.log(`[Expiration] Expired active product (user_product ID: ${item.id}) for user ${item.userId}`);
      await queueGHLSync({
        action: "add_tags",
        userId: item.userId,
        tags: ["expired", "access_revoked"],
      });
      await queueGHLSync({
        action: "add_note",
        userId: item.userId,
        noteBody: `Product access expired (user_product ID: ${item.id})`,
      });
    }
    // Term-expiry cleanup for the accountability-partner system: when a
    // 3-Month+ (rank >= 2) grant lapses to "expired", end the member's active
    // partner assignment — UNLESS they still hold another active grant that's
    // independently qualifying (e.g. they hold both a 6-month and a lifetime
    // grant and only one expired). Scoped to `expiredActive` only: those are
    // the rows that were actually entitlement-bearing right up to the moment
    // they expired, unlike `expiredCancelled`/`expiredPastDue` which already
    // lost their active status earlier.
    if (expiredActive.length > 0) {
      const expiredProductIds = [...new Set(expiredActive.map((item) => item.productId))];
      const expiredProducts = await db
        .select({ id: productsTable.id, slug: productsTable.slug })
        .from(productsTable)
        .where(inArray(productsTable.id, expiredProductIds));
      const infoById = new Map(
        expiredProducts.map((p) => [p.id, { rank: PRODUCT_RANK[p.slug], slug: p.slug }]),
      );

      for (const item of expiredActive) {
        const info = infoById.get(item.productId);
        if (!isPartnerEligibleRank(info?.rank, info?.slug)) continue;

        const [stillQualifying] = await db
          .select({ id: userProductsTable.id })
          .from(userProductsTable)
          .innerJoin(productsTable, eq(userProductsTable.productId, productsTable.id))
          .where(
            and(
              eq(userProductsTable.userId, item.userId),
              eq(userProductsTable.status, "active"),
              inArray(productsTable.slug, Object.keys(PRODUCT_RANK).filter((slug) => isPartnerEligibleRank(PRODUCT_RANK[slug], slug))),
            ),
          )
          .limit(1);
        if (stillQualifying) continue;

        const ended = await endActiveAssignment(item.userId, "3-Month+ product access expired");
        if (ended) {
          console.log(`[Expiration] Ended partner assignment for user ${item.userId} (product access expired)`);
        }
      }
    }

    for (const item of expiredCancelled) {
      console.log(`[Expiration] Expired cancelled product (user_product ID: ${item.id}) for user ${item.userId}`);
      await queueGHLSync({
        action: "add_tags",
        userId: item.userId,
        tags: ["expired"],
      });
    }
    for (const item of expiredPastDue) {
      console.log(`[Expiration] Expired past-due product (user_product ID: ${item.id}) for user ${item.userId}`);
      await queueGHLSync({
        action: "add_tags",
        userId: item.userId,
        tags: ["expired", "payment_failed_expired"],
      });
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
