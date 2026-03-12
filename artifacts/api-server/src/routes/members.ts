import { Router, type IRouter } from "express";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { getUserEntitlements, getUserProducts, getHighestProductLabel, getSupportTicketLimit, getEntitlementsList } from "../lib/entitlements";
import { GetCurrentMemberResponse, GetMemberProductsResponse, GetMemberEntitlementsResponse } from "@workspace/api-zod";

const router: IRouter = Router();
const userId = 1;

router.get("/members/me", async (_req, res): Promise<void> => {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  const entitlements = await getUserEntitlements(userId);
  const products = await getUserProducts(userId);
  const highest = getHighestProductLabel(entitlements);
  const ticketLimit = getSupportTicketLimit(entitlements);

  res.json(GetCurrentMemberResponse.parse({
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    timezone: user.timezone,
    sourceProduct: user.sourceProduct,
    onboardingComplete: user.onboardingComplete,
    currentStreak: user.currentStreak,
    memberSince: user.memberSince.toISOString().split("T")[0],
    highestProductName: highest.name,
    highestProductSlug: highest.slug,
    entitlements: getEntitlementsList(entitlements),
    products,
    ticketLimit,
  }));
});

router.get("/members/me/products", async (_req, res): Promise<void> => {
  const products = await getUserProducts(userId);
  res.json(GetMemberProductsResponse.parse(products));
});

router.get("/members/me/entitlements", async (_req, res): Promise<void> => {
  const entitlements = await getUserEntitlements(userId);
  const highest = getHighestProductLabel(entitlements);
  const ticketLimit = getSupportTicketLimit(entitlements);

  res.json(GetMemberEntitlementsResponse.parse({
    entitlements: getEntitlementsList(entitlements),
    highestProductName: highest.name,
    highestProductSlug: highest.slug,
    ticketLimit,
  }));
});

export default router;
