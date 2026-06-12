import { getParam } from "../lib/params";
import { Router, type Request, type Response } from "express";
import { db, affiliateProfilesTable, referralLinksTable, referralClicksTable, productsTable } from "@workspace/db";
import { eq, and, gte, sql } from "drizzle-orm";

const router = Router();

const COOKIE_MAX_AGE_DAYS = parseInt(process.env.BTS_REF_COOKIE_DAYS || "30", 10);
const DEDUP_WINDOW_MINUTES = parseInt(process.env.CLICK_DEDUP_MINUTES || "5", 10);

const PRODUCT_DESTINATIONS: Record<string, string> = {
  reserve_income: "https://buildtestscale.com/reserve-income",
  backroad: "https://buildtestscale.com/backroad",
  offmarket: "https://buildtestscale.com/offmarket",
  launchpad: "https://buildtestscale.com/launchpad",
  "3month": "https://buildtestscale.com/3month",
  "6month": "https://buildtestscale.com/6month",
  "1year": "https://buildtestscale.com/1year",
  lifetime: "https://buildtestscale.com/lifetime",
};

router.get("/go/:productSlug", async (req: Request, res: Response) => {
  const productSlug = getParam(req.params.productSlug);
  const affiliateCode = req.query.ref as string;

  const destination = PRODUCT_DESTINATIONS[productSlug] || `https://buildtestscale.com/${productSlug}`;

  if (!affiliateCode) {
    res.redirect(302, destination);
    return;
  }

  res.cookie("bts_ref", affiliateCode, {
    maxAge: COOKIE_MAX_AGE_DAYS * 24 * 60 * 60 * 1000,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
  });

  res.redirect(302, destination);

  trackClick(affiliateCode, productSlug, req).catch(err => {
    console.error("[Referral] Click tracking error:", err);
  });
});

async function trackClick(affiliateCode: string, productSlug: string, req: Request): Promise<void> {
  const [affiliate] = await db
    .select({ id: affiliateProfilesTable.id })
    .from(affiliateProfilesTable)
    .where(and(
      eq(affiliateProfilesTable.affiliateCode, affiliateCode),
      eq(affiliateProfilesTable.status, "active")
    ))
    .limit(1);

  if (!affiliate) return;

  const [product] = await db
    .select({ id: productsTable.id })
    .from(productsTable)
    .where(eq(productsTable.slug, productSlug))
    .limit(1);

  if (!product) return;

  const [referralLink] = await db
    .select({ id: referralLinksTable.id, clickCount: referralLinksTable.clickCount })
    .from(referralLinksTable)
    .where(and(
      eq(referralLinksTable.affiliateId, affiliate.id),
      eq(referralLinksTable.productId, product.id)
    ))
    .limit(1);

  let linkId: number;

  if (referralLink) {
    linkId = referralLink.id;
  } else {
    const [newLink] = await db.insert(referralLinksTable).values({
      affiliateId: affiliate.id,
      productId: product.id,
      slug: productSlug,
    }).returning();
    linkId = newLink.id;
  }

  const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.ip || "unknown";
  const dedupCutoff = new Date(Date.now() - DEDUP_WINDOW_MINUTES * 60 * 1000);

  const [recentClick] = await db
    .select({ id: referralClicksTable.id })
    .from(referralClicksTable)
    .where(and(
      eq(referralClicksTable.referralLinkId, linkId),
      eq(referralClicksTable.ipAddress, ip),
      gte(referralClicksTable.clickedAt, dedupCutoff)
    ))
    .limit(1);

  if (recentClick) return;

  await db.insert(referralClicksTable).values({
    referralLinkId: linkId,
    ipAddress: ip,
    userAgent: req.headers["user-agent"] || null,
    referer: req.headers.referer || null,
  });

  await db.update(referralLinksTable)
    .set({ clickCount: sql`click_count + 1` })
    .where(eq(referralLinksTable.id, linkId));

  await db.update(affiliateProfilesTable)
    .set({ lifetimeClicks: sql`lifetime_clicks + 1` })
    .where(eq(affiliateProfilesTable.id, affiliate.id));
}

export default router;
