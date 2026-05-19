import { db } from "@workspace/db";
import { affiliateNetworksTable } from "@workspace/db/schema";
import { inArray } from "drizzle-orm";

const REQUIRED_SLUGS = ["media-mavens", "clickbank", "affiliati", "maxweb"];

const AFFILIATE_NETWORKS = [
  {
    slug: "media-mavens",
    name: "Media Mavens",
    tagline: "Our own in-house curated network — designed specifically for this system.",
    description: "If you're brand new, start here. Media Mavens is our in-house network, built specifically for the Build Test Scale system, which gives you several real advantages over public marketplaces right from the start. Simple to sign up — no approval required.",
    highlights: [
      "Higher commissions than comparable products on other networks",
      "No chargebacks — if a customer returns a product, you keep your commission",
      "Pre-made advertorials (landing pages) for many products — meaning less work to get started",
      "Works with all three ad publishers (Caterpillar, Grasshopper, Crane)",
    ],
    publishers: "Caterpillar, Grasshopper, Crane",
    approvalLabel: "Instant signup",
    recommendedForBeginners: true,
    accentPreset: "emerald",
    logoBg: "bg-white",
    accentBorder: "border-emerald-300",
    accentBadgeBg: "bg-emerald-50",
    accentBadgeText: "text-emerald-800",
    accentBadgeBorder: "border-emerald-200",
    registerUrl: null,
    loginUrl: null,
    extraCtaLabel: "View Products",
    extraCtaHref: "/media-mavens",
    extraCtaStyle: "emerald",
    logoUrl: "/logos/media-mavens.png",
    displayOrder: 0,
    isActive: true,
  },
  {
    slug: "clickbank",
    name: "ClickBank",
    tagline: "A large public marketplace with thousands of products to promote.",
    description: "The next easiest entry point after Media Mavens. ClickBank is a large public marketplace — simple to sign up, no approval required. You'll create your own landing pages using the product's video as your source material.",
    highlights: [
      "Instant signup — no approval required",
      "Thousands of products across many verticals",
      "Works with Caterpillar and Grasshopper publishers",
      "Requires building your own jump pages from scratch",
    ],
    publishers: "Caterpillar, Grasshopper",
    approvalLabel: "Instant signup",
    recommendedForBeginners: false,
    accentPreset: "amber",
    logoBg: "bg-white",
    accentBorder: "border-amber-300",
    accentBadgeBg: "bg-amber-50",
    accentBadgeText: "text-amber-800",
    accentBadgeBorder: "border-amber-200",
    registerUrl: "https://www.clickbank.com/affiliates/",
    loginUrl: "https://accounts.clickbank.com/login.htm",
    extraCtaLabel: null,
    extraCtaHref: null,
    extraCtaStyle: "default",
    logoUrl: "/logos/clickbank.jpg",
    displayOrder: 1,
    isActive: true,
  },
  {
    slug: "affiliati",
    name: "Affiliati",
    tagline: "A curated network with many strong offers.",
    description: "Affiliati is a curated network with many strong offers. It requires account approval and proof of revenue generated from previous affiliate campaigns before you can get started. Please check with a coach before attempting to apply for an Affiliati account.",
    highlights: [
      "Requires account approval and proof of revenue from previous affiliate campaigns",
      "Check with a coach before applying",
      "Pre-made advertorials available for select products",
      "Works with Caterpillar and Grasshopper publishers",
    ],
    publishers: "Caterpillar, Grasshopper",
    approvalLabel: "Approval + proof of revenue",
    recommendedForBeginners: false,
    accentPreset: "violet",
    logoBg: "bg-white",
    accentBorder: "border-violet-300",
    accentBadgeBg: "bg-violet-50",
    accentBadgeText: "text-violet-800",
    accentBadgeBorder: "border-violet-200",
    registerUrl: "https://affiliatinetwork.com/",
    loginUrl: "https://login.affiliatinetwork.com/?ReturnUrl=%2faffiliates%2f",
    extraCtaLabel: null,
    extraCtaHref: null,
    extraCtaStyle: "default",
    logoUrl: "/logos/affiliati.png",
    displayOrder: 2,
    isActive: true,
  },
  {
    slug: "maxweb",
    name: "MaxWeb",
    tagline: "A curated network with quality offers.",
    description: "MaxWeb is a curated network with quality offers. It requires account approval and proof of revenue generated from previous affiliate campaigns before you can get started. Please check with a coach before attempting to apply for a MaxWeb account.",
    highlights: [
      "Requires account approval and proof of revenue from previous affiliate campaigns",
      "Check with a coach before applying",
      "Dedicated Account Representative listed on your MaxWeb Dashboard once approved",
      "Works with Caterpillar and Grasshopper publishers",
    ],
    publishers: "Caterpillar, Grasshopper",
    approvalLabel: "Approval + proof of revenue",
    recommendedForBeginners: false,
    accentPreset: "orange",
    logoBg: "bg-white",
    accentBorder: "border-orange-300",
    accentBadgeBg: "bg-orange-50",
    accentBadgeText: "text-orange-800",
    accentBadgeBorder: "border-orange-200",
    registerUrl: "https://affiliates-backoffice.maxweb.com/auth#signup",
    loginUrl: "https://affiliates-backoffice.maxweb.com/auth",
    extraCtaLabel: null,
    extraCtaHref: null,
    extraCtaStyle: "default",
    logoUrl: "/logos/maxweb.jpg",
    displayOrder: 3,
    isActive: true,
  },
];

export async function seedAffiliateNetworks(): Promise<void> {
  const existing = await db
    .select({ slug: affiliateNetworksTable.slug })
    .from(affiliateNetworksTable)
    .where(inArray(affiliateNetworksTable.slug, REQUIRED_SLUGS));

  const existingSlugs = new Set(existing.map((r) => r.slug));
  const toInsert = AFFILIATE_NETWORKS.filter((n) => !existingSlugs.has(n.slug));

  if (toInsert.length === 0) {
    console.log("[Seed] Affiliate networks already seeded, skipping");
    return;
  }

  await db.insert(affiliateNetworksTable).values(toInsert);
  console.log(`[Seed] Inserted ${toInsert.length} affiliate network(s): ${toInsert.map((n) => n.slug).join(", ")}`);
}
