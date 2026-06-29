import { db, ENTITLEMENT_KEYS } from "@workspace/db";
import { seedCoachRoster, generateWeeklyQaCalls } from "./lib/coaching-roster";
import {
  productsTable, entitlementsTable, userProductsTable,
  usersTable, tracksTable, modulesTable, lessonsTable, progressTable,
  ticketsTable, ticketMessagesTable, announcementsTable,
  sessionsTable, webhookLogsTable, legalDocumentsTable, signedDocumentsTable,
  communityCategoriesTable,
  communityPostsTable, communityCommentsTable, communityReactionsTable,
  communityBadgesTable, communityNotificationsTable,
  chatSessionsTable, chatMessagesTable, chatDailyUsageTable, chatPromptsTable,
  chatSystemPromptsTable, knowledgebaseDocsTable,
  affiliateProfilesTable, commissionRatesTable, referralLinksTable, referralClicksTable,
  commissionsTable, commissionPayoutsTable, affiliateResourcesTable,
  sequencesTable, sequenceStepsTable,
  winMilestonesTable, winsTable,
  toolCategoriesTable, toolsTable, toolUserDataTable, toolUsageLogTable, toolDailyUsageTable,
  chatRateLimitsTable,
} from "@workspace/db";
import { sql } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { seedCommunicationTemplates } from "./lib/seed-templates";
import { seedVaultData } from "./lib/seed-vault";
import { seedAssistantCards } from "./lib/seed-assistant-cards";
import { seedKnowledgebaseFromFiles, seedInternalSops } from "./lib/seed-kb";
import { ANTI_HALLUCINATION_SYSTEM_PROMPT } from "./lib/chat-system-prompt";
import { affiliateNetworksTable, blitzPhasesTable } from "@workspace/db/schema";
import { BLITZ_PHASES } from "./lib/blitz/sections";

async function seed() {
  console.log("Seeding database...");

  await db.execute(sql`DO $$ BEGIN
    EXECUTE (
      SELECT string_agg('TRUNCATE TABLE ' || quote_ident(tablename) || ' RESTART IDENTITY CASCADE', '; ')
      FROM pg_tables
      WHERE schemaname = 'public'
    );
  END $$`);

  // Human-readable catalog metadata for each entitlement key. The KEY SET is
  // sourced from ENTITLEMENT_KEYS (the single source of truth) below, so this
  // seeded catalog can never contain a key absent from the registry. The Record
  // type is exhaustive over the registry, so adding a key without metadata is a
  // compile error; the runtime guard also fails loudly as a backstop.
  const ENTITLEMENT_METADATA: Record<
    (typeof ENTITLEMENT_KEYS)[number],
    { description: string; category: string }
  > = {
    "content:frontend": { description: "Foundational video + text training modules", category: "content" },
    "content:advanced": { description: "Advanced pre-recorded training modules", category: "content" },
    "content:yse": { description: "YSE brand front-end content", category: "content" },
    "content:backroad": { description: "Backroad brand front-end content", category: "content" },
    "content:offmarket": { description: "Off-Market brand front-end content", category: "content" },
    "content:reserve_income": { description: "Reserve Income brand front-end content", category: "content" },
    "content:silent_partner": { description: "Silent Partner brand front-end content", category: "content" },
    "content:test_like_mad": { description: "Test Like Mad brand front-end content", category: "content" },
    "offer:cmo_bump": { description: "CMO Bump offer access", category: "offer" },
    "offer:21_day_blitz": { description: "21-Day Blitz offer access", category: "offer" },
    "offer:swipe_bank": { description: "Swipe Resource Bank offer access", category: "offer" },
    "offer:profit_maximizer": { description: "Profit Maximizer Pass offer access", category: "offer" },
    "software:base": { description: "Base software/tool access", category: "software" },
    "software:expanded": { description: "Expanded software/tool suite", category: "software" },
    "coaching:group": { description: "Live group coaching calls", category: "coaching" },
    "coaching:mastermind": { description: "Advanced mastermind sessions", category: "coaching" },
    "coaching:one_on_one:monthly": { description: "Monthly 1-on-1 coaching sessions", category: "coaching" },
    "coaching:one_on_one:weekly": { description: "Weekly 1-on-1 coaching sessions", category: "coaching" },
    "community:access": { description: "Mentorship community access", category: "community" },
    "commissions:entry": { description: "Entry-level affiliate commissions", category: "commissions" },
    "commissions:mid": { description: "Mid-tier affiliate commissions", category: "commissions" },
    "commissions:premium": { description: "Premium affiliate commissions", category: "commissions" },
    "commissions:top": { description: "Top-tier affiliate commissions", category: "commissions" },
    "support:basic": { description: "3 tickets/month, standard SLA", category: "support" },
    "support:standard": { description: "5 tickets/month", category: "support" },
    "support:enhanced": { description: "10 tickets/month", category: "support" },
    "support:unlimited": { description: "Unlimited tickets", category: "support" },
    "support:vip": { description: "Unlimited + priority SLA", category: "support" },
    "chat:basic": { description: "AI chat with basic access", category: "chat" },
    "chat:full": { description: "AI chat with full access", category: "chat" },
    "chat:custom": { description: "AI chat with custom prompts", category: "chat" },
    "access:lifetime": { description: "No expiration on access", category: "access" },
    "voice:access": { description: "Voice assistant access", category: "voice" },
  };

  const entitlementData = ENTITLEMENT_KEYS.map((key) => {
    const meta = ENTITLEMENT_METADATA[key];
    if (!meta) {
      throw new Error(
        `seed: entitlement key "${key}" is in the registry (ENTITLEMENT_KEYS) but has no catalog metadata in seed.ts. Add a description/category for it.`,
      );
    }
    return { key, description: meta.description, category: meta.category };
  });
  await db.insert(entitlementsTable).values(entitlementData);

  const productData = [
    // entitlementKeys is a JSONB array column. Drizzle's jsonb mapper runs
    // JSON.stringify on whatever we pass before sending it to Postgres, so we
    // must hand it real JS arrays here. Passing JSON.stringify([...]) (a
    // string) caused Drizzle to JSON.stringify the already-serialized string
    // a second time, producing JSONB string scalars instead of arrays — that
    // shape silently broke any raw SQL using jsonb_array_elements_text /
    // @> / ? operators against products.entitlement_keys. See migration
    // 0021_normalize_products_entitlement_keys for the one-time data fix.
    {
      slug: "reserve_income", name: "The Reserve Income System", type: "frontend",
      thrivecartProductId: "thrivecart_reserve_income",
      entitlementKeys: ["content:frontend", "content:reserve_income", "support:basic", "chat:basic", "voice:access"],
      priceDisplay: "$47–$97", sortOrder: 1,
    },
    {
      slug: "backroad", name: "The Backroad System", type: "frontend",
      thrivecartProductId: "thrivecart_backroad",
      entitlementKeys: ["content:frontend", "content:backroad", "support:basic", "chat:basic", "voice:access"],
      priceDisplay: "$47–$97", sortOrder: 2,
    },
    {
      slug: "offmarket", name: "The Off-Market Affiliate System", type: "frontend",
      thrivecartProductId: "thrivecart_offmarket",
      entitlementKeys: ["content:frontend", "content:offmarket", "support:basic", "chat:basic", "voice:access"],
      priceDisplay: "$47–$97", sortOrder: 3,
    },
    {
      slug: "launchpad", name: "BTS LaunchPad", type: "backend",
      thrivecartProductId: "thrivecart_launchpad",
      entitlementKeys: ["content:frontend", "content:advanced", "software:base", "support:standard", "chat:full", "voice:access"],
      priceDisplay: "TBD", sortOrder: 4,
      checkoutUrl: "https://bts.thrivecart.com/bts-launchpad/",
    },
    {
      slug: "3month", name: "BTS 3-Month Mentorship", type: "backend",
      thrivecartProductId: "thrivecart_3month",
      entitlementKeys: ["content:frontend", "content:advanced", "software:base", "coaching:group", "community:access", "commissions:entry", "support:enhanced", "chat:full", "voice:access"],
      durationDays: 90, priceDisplay: "TBD", sortOrder: 5,
      checkoutUrl: "https://bts.thrivecart.com/bts-3-month-mentorship/",
    },
    {
      slug: "6month", name: "BTS 6-Month Mentorship", type: "backend",
      thrivecartProductId: "thrivecart_6month",
      entitlementKeys: ["content:frontend", "content:advanced", "software:base", "software:expanded", "coaching:group", "coaching:mastermind", "community:access", "commissions:mid", "support:unlimited", "chat:full", "voice:access"],
      durationDays: 180, priceDisplay: "TBD", sortOrder: 6,
      checkoutUrl: "https://bts.thrivecart.com/bts-6-month-mentorship/",
    },
    {
      slug: "1year", name: "BTS 1-Year Mentorship", type: "backend",
      thrivecartProductId: "thrivecart_1year",
      entitlementKeys: ["content:frontend", "content:advanced", "software:base", "software:expanded", "coaching:group", "coaching:mastermind", "community:access", "commissions:premium", "support:unlimited", "chat:full", "voice:access"],
      durationDays: 365, priceDisplay: "TBD", sortOrder: 7,
      checkoutUrl: "https://bts.thrivecart.com/bts-1-year-mentorship/",
    },
    {
      slug: "lifetime", name: "BTS Lifetime Mentorship", type: "backend",
      thrivecartProductId: "thrivecart_lifetime",
      entitlementKeys: ["content:frontend", "content:advanced", "software:base", "software:expanded", "coaching:group", "coaching:mastermind", "community:access", "commissions:top", "support:vip", "chat:custom", "access:lifetime", "voice:access"],
      priceDisplay: "TBD", sortOrder: 8,
      checkoutUrl: "https://bts.thrivecart.com/bts-lifetime-mentorship/",
    },
    // Machine front-end brand products. silent_partner and test_like_mad are
    // net-new; backroad/offmarket/reserve_income are above with placeholder
    // thrivecart IDs for local testing. thrivecartProductId is null for the
    // two new Machine-only products — they are provisioned via portal_product_keys,
    // not ThriveCart webhooks.
    {
      slug: "silent_partner", name: "The Silent Partner System", type: "frontend",
      thrivecartProductId: null,
      entitlementKeys: ["content:frontend", "content:silent_partner", "support:basic", "chat:basic", "voice:access"],
      priceDisplay: null, sortOrder: 15,
    },
    {
      slug: "test_like_mad", name: "Test Like Mad", type: "frontend",
      thrivecartProductId: null,
      entitlementKeys: ["content:frontend", "content:test_like_mad", "support:basic", "chat:basic", "voice:access"],
      priceDisplay: null, sortOrder: 16,
    },
    // YSE (Your Second Engine) products — purchased via yoursecondengine.com
    // and granted to BTS via the /api/integrations/grant-product endpoint.
    // thrivecartProductId is null because these products are sold by YSE's
    // NMI-backed checkout, not ThriveCart.
    {
      slug: "yse_front_end", name: "YSE Front End", type: "frontend",
      entitlementKeys: ["content:frontend", "content:yse", "support:basic", "chat:basic", "voice:access"],
      priceDisplay: "$67", sortOrder: 9,
    },
    {
      slug: "yse_affiliate_cmo_bump", name: "CMO Bump", type: "frontend",
      entitlementKeys: ["content:frontend", "offer:cmo_bump", "support:basic", "chat:basic", "voice:access"],
      priceDisplay: "$47", sortOrder: 10,
    },
    {
      slug: "yse_21_day_blitz", name: "21-Day Blitz", type: "backend",
      entitlementKeys: ["content:frontend", "content:advanced", "offer:21_day_blitz", "software:base", "support:standard", "chat:full", "voice:access"],
      durationDays: null,
      priceDisplay: "$297", sortOrder: 11,
    },
    {
      slug: "yse_swipe_resource_bank", name: "Swipe Resource Bank", type: "frontend",
      entitlementKeys: ["content:frontend", "offer:swipe_bank", "support:basic", "chat:basic", "voice:access"],
      priceDisplay: "$97", sortOrder: 12,
    },
    {
      slug: "yse_profit_maximizer_pass", name: "Profit Maximizer Pass", type: "frontend",
      entitlementKeys: ["content:frontend", "content:advanced", "offer:profit_maximizer", "support:standard", "chat:full", "voice:access"],
      priceDisplay: "$97", sortOrder: 13,
    },
    // Example native NMI product (First Movers Club). priceCents/billingType/
    // itemType/isNativeNmi are all set; nothing is charged — this is schema-only
    // (Tier 2). Actual NMI charge calls land in Tier 3+.
    {
      slug: "first_movers_club", name: "First Movers Club", type: "backend",
      entitlementKeys: ["content:frontend", "content:advanced", "software:base", "community:access", "commissions:entry", "support:enhanced", "chat:full", "voice:access"],
      priceDisplay: "$997", sortOrder: 20,
      priceCents: 99700,
      currency: "USD",
      billingType: "one_time",
      itemType: "entitlement",
      isNativeNmi: true,
    },
  ];
  const insertedProducts = await db.insert(productsTable).values(productData).returning();
  const productsBySlug: Record<string, number> = {};
  for (const p of insertedProducts) {
    productsBySlug[p.slug] = p.id;
  }

  // ── YSE (Your Second Engine) products ────────────────────────────────────
  // Granted automatically via POST /api/integrations/grant-product when a
  // customer purchases on yoursecondengine.com. Inserted separately with
  // onConflictDoNothing so this block is safe to re-run on an existing DB
  // without wiping data (unlike the full-truncate dev seed above).
  // thrivecartProductId is intentionally null — YSE uses NMI, not ThriveCart.
  const yseProductData = [
    {
      slug: "yse_front_end",
      name: "YSE Front End ($67)",
      type: "frontend",
      thrivecartProductId: null,
      entitlementKeys: ["content:frontend", "content:yse", "support:basic", "chat:basic", "voice:access"],
      priceDisplay: "$67",
      sortOrder: 9,
    },
    {
      slug: "yse_affiliate_cmo_bump",
      name: "CMO Bump",
      type: "frontend",
      thrivecartProductId: null,
      entitlementKeys: ["content:frontend", "offer:cmo_bump", "support:basic", "chat:basic", "voice:access"],
      priceDisplay: "$47",
      sortOrder: 10,
    },
    {
      slug: "yse_21_day_blitz",
      name: "21-Day Blitz",
      type: "backend",
      thrivecartProductId: null,
      entitlementKeys: ["content:frontend", "content:advanced", "offer:21_day_blitz", "software:base", "support:standard", "chat:full", "voice:access"],
      durationDays: null,
      priceDisplay: "$297",
      sortOrder: 11,
    },
    {
      slug: "yse_swipe_resource_bank",
      name: "Swipe Resource Bank",
      type: "frontend",
      thrivecartProductId: null,
      entitlementKeys: ["content:frontend", "offer:swipe_bank", "support:basic", "chat:basic", "voice:access"],
      priceDisplay: "$97",
      sortOrder: 12,
    },
    {
      slug: "yse_profit_maximizer_pass",
      name: "Profit Maximizer Pass",
      type: "frontend",
      thrivecartProductId: null,
      entitlementKeys: ["content:frontend", "content:advanced", "offer:profit_maximizer", "support:standard", "chat:full", "voice:access"],
      priceDisplay: "$97",
      sortOrder: 13,
    },
  ];
  const insertedYseProducts = await db
    .insert(productsTable)
    .values(yseProductData)
    .onConflictDoNothing({ target: productsTable.slug })
    .returning();
  for (const p of insertedYseProducts) {
    productsBySlug[p.slug] = p.id;
  }

  const passwordHash = await bcrypt.hash("Demo1234", 12);

  const memberSince = new Date("2026-01-24T00:00:00Z");
  const [marcus] = await db.insert(usersTable).values({
    name: "Marcus Johnson", email: "marcus@example.com",
    passwordHash,
    sourceProduct: "backroad", onboardingComplete: true,
    emailVerified: true,
    currentStreak: 5, memberSince,
  }).returning();

  const [sarah] = await db.insert(usersTable).values({
    name: "Sarah Chen", email: "sarah@example.com",
    passwordHash,
    sourceProduct: "reserve_income", onboardingComplete: true,
    emailVerified: true,
    currentStreak: 2, memberSince: new Date("2026-02-15T00:00:00Z"),
  }).returning();

  const [admin] = await db.insert(usersTable).values({
    name: "Admin User", email: "admin@bts.com",
    passwordHash,
    role: "admin",
    sourceProduct: "lifetime", onboardingComplete: true,
    emailVerified: true,
    currentStreak: 0, memberSince: new Date("2025-01-01T00:00:00Z"),
  }).returning();

  const [jake] = await db.insert(usersTable).values({
    name: "Jake Rivera", email: "jake@example.com",
    passwordHash,
    sourceProduct: "1year", onboardingComplete: true,
    emailVerified: true,
    currentStreak: 8, memberSince: new Date("2025-11-01T00:00:00Z"),
  }).returning();

  const [lisa] = await db.insert(usersTable).values({
    name: "Lisa Thompson", email: "lisa@example.com",
    passwordHash,
    sourceProduct: "3month", onboardingComplete: true,
    emailVerified: true,
    currentStreak: 1, memberSince: new Date("2026-01-10T00:00:00Z"),
  }).returning();

  const sixMonthsFromNow = new Date();
  sixMonthsFromNow.setDate(sixMonthsFromNow.getDate() + 120);
  const oneYearFromNow = new Date();
  oneYearFromNow.setDate(oneYearFromNow.getDate() + 280);
  const threeMonthsFromNow = new Date();
  threeMonthsFromNow.setDate(threeMonthsFromNow.getDate() + 45);

  await db.insert(userProductsTable).values([
    { userId: marcus.id, productId: productsBySlug["backroad"], status: "active" },
    { userId: marcus.id, productId: productsBySlug["6month"], status: "active", expiresAt: sixMonthsFromNow },
    { userId: sarah.id, productId: productsBySlug["reserve_income"], status: "active" },
    { userId: admin.id, productId: productsBySlug["lifetime"], status: "active" },
    { userId: jake.id, productId: productsBySlug["1year"], status: "active", expiresAt: oneYearFromNow },
    { userId: lisa.id, productId: productsBySlug["3month"], status: "active", expiresAt: threeMonthsFromNow },
  ]);

  const [track1] = await db.insert(tracksTable).values({ title: "Affiliate Marketing Foundations", description: "Master the fundamentals of affiliate marketing from choosing a niche to launching your first campaign.", requiredEntitlement: "content:frontend", sortOrder: 1 }).returning();
  const [track2] = await db.insert(tracksTable).values({ title: "Traffic & Audience Building", description: "Learn proven strategies to drive targeted traffic and build an engaged audience.", requiredEntitlement: "content:frontend", sortOrder: 2 }).returning();
  const [track3] = await db.insert(tracksTable).values({ title: "Advanced Strategies", description: "Advanced pre-recorded training for LaunchPad and Mentorship members.", requiredEntitlement: "content:advanced", sortOrder: 3 }).returning();
  const [track4] = await db.insert(tracksTable).values({ title: "Scaling & Optimization", description: "Advanced techniques to scale your campaigns and maximize ROI.", requiredEntitlement: "content:advanced", sortOrder: 4 }).returning();

  const [mod1] = await db.insert(modulesTable).values({ trackId: track1.id, title: "The Affiliate Marketing Landscape", description: "How the model works, why it's viable, and what makes it different.", sortOrder: 1 }).returning();
  const [mod2] = await db.insert(modulesTable).values({ trackId: track1.id, title: "Choosing Your Niche & Offers", description: "Criteria for selecting profitable affiliate offers.", sortOrder: 2 }).returning();
  const [mod3] = await db.insert(modulesTable).values({ trackId: track1.id, title: "Building Your Foundation", description: "Setting up accounts, compliance, basic tracking.", sortOrder: 3 }).returning();
  const [mod4] = await db.insert(modulesTable).values({ trackId: track2.id, title: "Creating Content That Converts", description: "Advertorial and bridge page fundamentals.", sortOrder: 1 }).returning();
  const [mod5] = await db.insert(modulesTable).values({ trackId: track2.id, title: "Traffic Fundamentals", description: "Overview of traffic sources, setting up your first campaign.", sortOrder: 2 }).returning();
  const [mod6] = await db.insert(modulesTable).values({ trackId: track3.id, title: "Campaign Optimization", description: "Optimize your campaigns for maximum performance.", sortOrder: 1 }).returning();
  const [mod7] = await db.insert(modulesTable).values({ trackId: track3.id, title: "Advanced Copywriting", description: "Master advanced copywriting frameworks.", sortOrder: 2 }).returning();
  const [mod8] = await db.insert(modulesTable).values({ trackId: track4.id, title: "Scaling Facebook Ads", description: "Scale your winning campaigns profitably.", sortOrder: 1 }).returning();
  const [mod9] = await db.insert(modulesTable).values({ trackId: track4.id, title: "Analytics & Tracking Mastery", description: "Use data to optimize every aspect of your business.", sortOrder: 2 }).returning();

  const lessonData = [
    { moduleId: mod1.id, title: "Welcome to Build Test Scale", description: "Introduction to the BTS methodology.", contentType: "video", durationMinutes: 15, requiredEntitlement: "content:frontend", sortOrder: 1 },
    { moduleId: mod1.id, title: "How Affiliate Marketing Works", description: "The business model explained.", contentType: "video", durationMinutes: 20, requiredEntitlement: "content:frontend", sortOrder: 2 },
    { moduleId: mod1.id, title: "Why Affiliate Marketing is Viable", description: "Market opportunity and growth potential.", contentType: "both", durationMinutes: 12, requiredEntitlement: "content:frontend", sortOrder: 3 },
    { moduleId: mod2.id, title: "Niche Research Methods", description: "Proven methods to identify profitable niches.", contentType: "video", durationMinutes: 25, requiredEntitlement: "content:frontend", sortOrder: 1 },
    { moduleId: mod2.id, title: "Evaluating Affiliate Programs", description: "How to evaluate networks and programs.", contentType: "video", durationMinutes: 20, requiredEntitlement: "content:frontend", sortOrder: 2 },
    { moduleId: mod2.id, title: "Choosing Your First Offer", description: "Selecting winning offers.", contentType: "video", durationMinutes: 18, requiredEntitlement: "content:frontend", sortOrder: 3 },
    { moduleId: mod3.id, title: "Setting Up Your Accounts", description: "Essential tools and accounts.", contentType: "both", durationMinutes: 20, requiredEntitlement: "content:frontend", sortOrder: 1 },
    { moduleId: mod3.id, title: "Compliance Basics", description: "Understanding compliance and regulations.", contentType: "text", durationMinutes: 15, requiredEntitlement: "content:frontend", sortOrder: 2 },
    { moduleId: mod3.id, title: "Basic Tracking Setup", description: "Setting up tracking for your campaigns.", contentType: "video", durationMinutes: 22, requiredEntitlement: "content:frontend", sortOrder: 3 },
    { moduleId: mod4.id, title: "Advertorial Fundamentals", description: "Building effective advertorial pages.", contentType: "video", durationMinutes: 25, requiredEntitlement: "content:frontend", sortOrder: 1 },
    { moduleId: mod4.id, title: "Writing Headlines That Convert", description: "Master headline writing.", contentType: "video", durationMinutes: 22, requiredEntitlement: "content:frontend", sortOrder: 2 },
    { moduleId: mod4.id, title: "Basic Copywriting Frameworks", description: "Foundational copywriting.", contentType: "both", durationMinutes: 20, requiredEntitlement: "content:frontend", sortOrder: 3 },
    { moduleId: mod5.id, title: "Overview of Traffic Sources", description: "Understanding paid and organic traffic.", contentType: "video", durationMinutes: 20, requiredEntitlement: "content:frontend", sortOrder: 1 },
    { moduleId: mod5.id, title: "Native Ads Introduction", description: "Getting started with native advertising.", contentType: "video", durationMinutes: 25, requiredEntitlement: "content:frontend", sortOrder: 2 },
    { moduleId: mod5.id, title: "Your First Campaign", description: "Setting up your first paid campaign.", contentType: "both", durationMinutes: 30, requiredEntitlement: "content:frontend", sortOrder: 3 },
    { moduleId: mod6.id, title: "Split Testing Strategies", description: "Systematic approach to campaign testing.", contentType: "video", durationMinutes: 25, requiredEntitlement: "content:advanced", sortOrder: 1 },
    { moduleId: mod6.id, title: "Landing Page Optimization", description: "Maximizing conversion rates.", contentType: "video", durationMinutes: 20, requiredEntitlement: "content:advanced", sortOrder: 2 },
    { moduleId: mod6.id, title: "Budget Optimization", description: "Getting the most from your ad spend.", contentType: "both", durationMinutes: 22, requiredEntitlement: "content:advanced", sortOrder: 3 },
    { moduleId: mod7.id, title: "Advanced Headline Formulas", description: "Data-driven headline strategies.", contentType: "video", durationMinutes: 20, requiredEntitlement: "content:advanced", sortOrder: 1 },
    { moduleId: mod7.id, title: "Emotional Triggers", description: "Psychology of persuasion in copy.", contentType: "both", durationMinutes: 18, requiredEntitlement: "content:advanced", sortOrder: 2 },
    { moduleId: mod8.id, title: "When to Scale", description: "Signals that it's time to scale.", contentType: "video", durationMinutes: 15, requiredEntitlement: "content:advanced", sortOrder: 1 },
    { moduleId: mod8.id, title: "Horizontal vs Vertical Scaling", description: "Two approaches to scaling.", contentType: "video", durationMinutes: 20, requiredEntitlement: "content:advanced", sortOrder: 2 },
    { moduleId: mod8.id, title: "Scaling to $500/day", description: "Step-by-step guide.", contentType: "video", durationMinutes: 30, requiredEntitlement: "content:advanced", sortOrder: 3 },
    { moduleId: mod9.id, title: "Analytics Dashboard Setup", description: "Build your tracking dashboard.", contentType: "video", durationMinutes: 25, requiredEntitlement: "content:advanced", sortOrder: 1 },
    { moduleId: mod9.id, title: "Multi-Touch Attribution", description: "Advanced attribution models.", contentType: "both", durationMinutes: 20, requiredEntitlement: "content:advanced", sortOrder: 2 },
  ];

  const insertedLessons = await db.insert(lessonsTable).values(lessonData).returning();

  const completedLessonIds = insertedLessons.slice(0, 12).map((l) => l.id);
  for (const lessonId of completedLessonIds) {
    const completedAt = new Date(Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000);
    await db.insert(progressTable).values({ userId: marcus.id, lessonId, completedAt });
  }

  // Real coaching roster + upcoming weekly group Q&A calls. Both are seeded via
  // the shared, idempotent roster module (the same path the server uses on
  // boot), so dev and production stay in lockstep and no demo coaches exist.
  await seedCoachRoster();
  await generateWeeklyQaCalls();


  const [ticket1] = await db.insert(ticketsTable).values({ ticketNumber: "BTS-100234", userId: marcus.id, category: "billing", priority: "normal", status: "awaiting_response", subject: "Question about tier upgrade pricing" }).returning();
  await db.insert(ticketMessagesTable).values([
    { ticketId: ticket1.id, senderType: "member", body: "I'd like to know if there's a discount when upgrading from 6-Month to 1-Year Mentorship mid-cycle. Do I get prorated billing?" },
    { ticketId: ticket1.id, senderType: "admin", body: "Great question, Marcus! Yes, when upgrading tiers, you'll receive prorated billing. Would you like me to process the upgrade for you?" },
  ]);

  const [ticket2] = await db.insert(ticketsTable).values({ ticketNumber: "BTS-100189", userId: marcus.id, category: "technical", priority: "high", status: "resolved", subject: "Video not loading in Module 3", resolvedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000) }).returning();
  await db.insert(ticketMessagesTable).values([
    { ticketId: ticket2.id, senderType: "member", body: "The video in the Building Your Foundation module won't load." },
    { ticketId: ticket2.id, senderType: "admin", body: "We've fixed the video encoding issue. Please try again." },
    { ticketId: ticket2.id, senderType: "member", body: "It's working now, thank you!" },
  ]);

  await db.insert(announcementsTable).values([
    { title: "New Track: Advanced Strategies", body: "We've released advanced pre-recorded training for LaunchPad and Mentorship members!", type: "new_content" },
    { title: "Live Event: Summer Scaling Summit", body: "Join us for our annual Summer Scaling Summit. Early bird pricing for Mentorship members.", type: "event" },
    { title: "Community Milestone: 10,000 Members!", body: "We've hit 10,000 members in the BTS community!", type: "milestone" },
    { title: "Platform Update: New Video Player", body: "Upgraded video player with faster loading and adjustable playback speed.", type: "general" },
  ]);

  // Membership/Mentee Agreement is intentionally NOT seeded — that document is
  // executed and stored outside the portal. Only the Terms of Service is
  // signed in-app during onboarding.
  await db.insert(legalDocumentsTable).values([
    {
      type: "terms_of_service",
      version: 1,
      title: "Terms of Service",
      content: `# Build Test Scale Terms of Service\n\n**Last Updated:** January 2026\n\nWelcome to Build Test Scale. These Terms of Service ("Terms") govern your access to and use of the Build Test Scale member portal, training content, tools, coaching services, and community features.\n\n## 1. Acceptance of Terms\n\nBy creating an account, accessing the Platform, or using any Build Test Scale services, you agree to be bound by these Terms.\n\n## 2. Eligibility\n\nYou must be at least 18 years of age and have the legal capacity to enter into binding agreements.\n\n## 3. Account Security\n\nYou are responsible for maintaining the confidentiality of your login credentials and must notify us immediately of any unauthorized access.\n\n## 4. Acceptable Use\n\nYou agree not to copy, modify, or distribute any Platform content without written permission, use automated tools, interfere with the Platform, impersonate another person, or use the Platform for any unlawful purpose.\n\n## 5. Content & Training\n\nTraining content is provided "as is" for educational purposes. You are solely responsible for how you apply the information.\n\n## 6. Community Guidelines\n\nBe respectful, do not post spam, do not share confidential coaching details publicly, and report violations to our support team.\n\n## 7. Privacy\n\nYour use of the Platform is also governed by our Privacy Policy.\n\n## 8. Disclaimer of Warranties\n\nTHE PLATFORM IS PROVIDED "AS IS" AND "AS AVAILABLE" WITHOUT WARRANTIES OF ANY KIND.\n\n## 9. Limitation of Liability\n\nIN NO EVENT SHALL BUILD TEST SCALE BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES.\n\n## 10. Governing Law\n\nThese Terms are governed by the laws of the State of Delaware.\n\n## 11. Contact\n\nFor questions, contact us at support@buildtestscale.com or by mail at Build Test Scale, LLC, 5900 Balcones Drive STE 100, Austin, TX 78731.\n\nBy proceeding, you acknowledge that you have read, understand, and agree to these Terms of Service.`,
    },
  ]);

  await db.insert(communityCategoriesTable).values([
    { name: "Wins", slug: "wins", description: "Share your wins and successes", sortOrder: 1 },
    { name: "Questions", slug: "questions", description: "Ask questions and get help", sortOrder: 2 },
    { name: "Strategies", slug: "strategies", description: "Share and discuss strategies", sortOrder: 3 },
    { name: "Introductions", slug: "introductions", description: "Introduce yourself to the community", sortOrder: 4 },
    { name: "Accountability", slug: "accountability", description: "Stay accountable with the community", sortOrder: 5 },
    { name: "Resources", slug: "resources", description: "Share useful resources", sortOrder: 6 },
    { name: "Off-Topic", slug: "off-topic", description: "Casual conversations", sortOrder: 7 },
  ]);
  console.log("Community categories seeded.");

  const [seqOnboardingFrontend] = await db.insert(sequencesTable).values({
    slug: "onboarding_frontend",
    name: "Frontend Product Onboarding",
    description: "Welcome sequence for new frontend product purchasers",
    triggerEvent: "purchase_frontend",
    productType: "frontend",
    active: true,
  }).returning();

  const [seqOnboardingMentorship] = await db.insert(sequencesTable).values({
    slug: "onboarding_mentorship",
    name: "Mentorship Onboarding",
    description: "Welcome sequence for new mentorship members",
    triggerEvent: "purchase_backend",
    productType: "backend",
    active: true,
  }).returning();

  const [seqNurture] = await db.insert(sequencesTable).values({
    slug: "nurture_frontend_to_upgrade",
    name: "Frontend to Upgrade Nurture",
    description: "Nurture frontend customers toward mentorship upgrade",
    triggerEvent: "onboarding_complete",
    productType: "frontend",
    active: true,
  }).returning();

  const [seqReengagement] = await db.insert(sequencesTable).values({
    slug: "reengagement",
    name: "Re-engagement",
    description: "Re-engage users who have been inactive for 7+ days",
    triggerEvent: "inactivity",
    active: true,
  }).returning();

  await db.insert(sequenceStepsTable).values([
    { sequenceId: seqOnboardingFrontend.id, stepOrder: 1, channel: "email", templateRef: "onboarding_frontend_welcome", subject: "Welcome to Build Test Scale!", delayMinutes: 0 },
    { sequenceId: seqOnboardingFrontend.id, stepOrder: 2, channel: "email", templateRef: "onboarding_frontend_getting_started", subject: "Getting started: Your first steps", delayMinutes: 1440, conditions: { ifNotCompleted: "onboarding" } },
    { sequenceId: seqOnboardingFrontend.id, stepOrder: 3, channel: "email", templateRef: "onboarding_frontend_first_module", subject: "Have you checked out Module 1?", delayMinutes: 4320, conditions: { ifNotCompleted: "onboarding" } },
    { sequenceId: seqOnboardingFrontend.id, stepOrder: 4, channel: "sms", templateRef: "onboarding_frontend_checkin_sms", subject: "Quick check-in", delayMinutes: 7200, conditions: { ifNotCompleted: "onboarding" } },
    { sequenceId: seqOnboardingFrontend.id, stepOrder: 5, channel: "email", templateRef: "onboarding_frontend_tips", subject: "5 tips for your first affiliate campaign", delayMinutes: 10080 },
    { sequenceId: seqOnboardingFrontend.id, stepOrder: 6, channel: "email", templateRef: "onboarding_frontend_community", subject: "Join the BTS community", delayMinutes: 14400 },
    { sequenceId: seqOnboardingFrontend.id, stepOrder: 7, channel: "email", templateRef: "onboarding_frontend_next_steps", subject: "What's next on your journey?", delayMinutes: 20160 },
  ]);

  await db.insert(sequenceStepsTable).values([
    { sequenceId: seqOnboardingMentorship.id, stepOrder: 1, channel: "email", templateRef: "onboarding_mentorship_welcome", subject: "Welcome to BTS Mentorship!", delayMinutes: 0 },
    { sequenceId: seqOnboardingMentorship.id, stepOrder: 2, channel: "sms", templateRef: "onboarding_mentorship_welcome_sms", subject: "Welcome SMS", delayMinutes: 30 },
    { sequenceId: seqOnboardingMentorship.id, stepOrder: 3, channel: "email", templateRef: "onboarding_mentorship_coaching_intro", subject: "Your coaching calls: what to expect", delayMinutes: 1440, conditions: { ifNotCompleted: "onboarding" } },
    { sequenceId: seqOnboardingMentorship.id, stepOrder: 4, channel: "email", templateRef: "onboarding_mentorship_community_intro", subject: "Meet your fellow mentorship members", delayMinutes: 4320, conditions: { ifNotCompleted: "onboarding" } },
    { sequenceId: seqOnboardingMentorship.id, stepOrder: 5, channel: "email", templateRef: "onboarding_mentorship_tools", subject: "Your mentorship tools & software", delayMinutes: 7200, conditions: { ifNotCompleted: "onboarding" } },
    { sequenceId: seqOnboardingMentorship.id, stepOrder: 6, channel: "sms", templateRef: "onboarding_mentorship_first_call_sms", subject: "Don't miss your first coaching call", delayMinutes: 10080, conditions: { ifNotCompleted: "onboarding" } },
    { sequenceId: seqOnboardingMentorship.id, stepOrder: 7, channel: "email", templateRef: "onboarding_mentorship_week2_checkin", subject: "How's your first two weeks going?", delayMinutes: 20160, conditions: { ifNotCompleted: "onboarding" } },
  ]);

  await db.insert(sequenceStepsTable).values([
    { sequenceId: seqNurture.id, stepOrder: 1, channel: "email", templateRef: "nurture_congrats_onboarding", subject: "Congrats on completing onboarding!", delayMinutes: 0 },
    { sequenceId: seqNurture.id, stepOrder: 2, channel: "email", templateRef: "nurture_success_stories", subject: "See what mentorship members are achieving", delayMinutes: 4320 },
    { sequenceId: seqNurture.id, stepOrder: 3, channel: "email", templateRef: "nurture_coaching_preview", subject: "What live coaching looks like", delayMinutes: 10080 },
    { sequenceId: seqNurture.id, stepOrder: 4, channel: "email", templateRef: "nurture_upgrade_benefits", subject: "Ready for the next level?", delayMinutes: 20160, conditions: { ifProductLevel: ["reserve_income", "backroad", "offmarket"] } },
    { sequenceId: seqNurture.id, stepOrder: 5, channel: "email", templateRef: "nurture_limited_offer", subject: "Special mentorship offer for you", delayMinutes: 30240, conditions: { ifProductLevel: ["reserve_income", "backroad", "offmarket"] } },
  ]);

  await db.insert(sequenceStepsTable).values([
    { sequenceId: seqReengagement.id, stepOrder: 1, channel: "email", templateRef: "reengagement_miss_you", subject: "We miss you at BTS!", delayMinutes: 0, conditions: { ifNotLoggedIn: true } },
    { sequenceId: seqReengagement.id, stepOrder: 2, channel: "sms", templateRef: "reengagement_checkin_sms", subject: "Quick check-in", delayMinutes: 4320, conditions: { ifNotLoggedIn: true } },
    { sequenceId: seqReengagement.id, stepOrder: 3, channel: "email", templateRef: "reengagement_whats_new", subject: "Here's what you've been missing", delayMinutes: 10080, conditions: { ifNotLoggedIn: true } },
  ]);

  console.log("Sequences seeded: onboarding_frontend, onboarding_mentorship, nurture_frontend_to_upgrade, reengagement");

  await db.insert(chatSystemPromptsTable).values({
    name: "default",
    content: ANTI_HALLUCINATION_SYSTEM_PROMPT,
    isActive: true,
  });

  const [chatSession1] = await db.insert(chatSessionsTable).values({
    userId: marcus.id,
    title: "Help with Facebook Ads campaign setup",
  }).returning();

  await db.insert(chatMessagesTable).values([
    { sessionId: chatSession1.id, role: "user", content: "I'm ready to start my first Facebook Ads campaign for affiliate marketing. What budget should I start with?" },
    { sessionId: chatSession1.id, role: "assistant", content: "Great question, Marcus! Starting your first Facebook Ads campaign is exciting. Here's what I recommend:\n\n## Starting Budget\n- **Daily budget**: $20-50/day\n- **Test period**: 3-5 days minimum before making decisions\n- **Total initial test budget**: $100-250\n\n## Why This Range?\n1. **Too low** ($5-10/day) won't give Facebook's algorithm enough data to optimize\n2. **Too high** risks losing money before you've validated your approach\n3. **$20-50** gives you enough data for meaningful results\n\n## Quick Setup Checklist\n1. Choose your offer (what are you promoting?)\n2. Set up your bridge/advertorial page\n3. Install the Facebook Pixel\n4. Create 3-5 ad variations\n5. Start with broad targeting\n\nHave you already chosen which affiliate offer you'll be promoting?" },
    { sessionId: chatSession1.id, role: "user", content: "I'm thinking about promoting a health supplement. Is that a good niche?" },
    { sessionId: chatSession1.id, role: "assistant", content: "Health supplements can be profitable but come with important considerations:\n\n## Pros\n- Huge market demand\n- High commission rates (often 40-75%)\n- Recurring purchase potential\n\n## Challenges\n- **Strict compliance**: Facebook has very specific rules about health claims\n- **Ad account risk**: Health ads get flagged more often\n- **Competition**: Very competitive space\n\n## Compliance Tips for Health Offers\n1. Never make specific health claims (\"cures X\", \"lose 20 lbs\")\n2. Use softer language (\"may support\", \"designed to help\")\n3. Include proper disclaimers\n4. Follow FTC guidelines strictly\n\n## Recommendation\nIf you're just starting out, I'd suggest a less regulated niche first to learn the basics. Once you're comfortable with campaign mechanics, you can move into health.\n\nCheck out the **Niche Research Methods** lesson in Module 2 — it covers criteria for evaluating niches. Would you like help brainstorming alternative niches?" },
  ]);

  const [chatSession2] = await db.insert(chatSessionsTable).values({
    userId: marcus.id,
    title: "Understanding tracking and attribution",
  }).returning();

  await db.insert(chatMessagesTable).values([
    { sessionId: chatSession2.id, role: "user", content: "Can you explain how tracking works in affiliate marketing? I'm confused about postbacks." },
    { sessionId: chatSession2.id, role: "assistant", content: "Absolutely! Tracking is crucial for knowing which ads are making you money. Let me break it down:\n\n## How Affiliate Tracking Works\n\n```\nYour Ad → Tracking Link → Bridge Page → Affiliate Offer → Sale → Postback\n```\n\n## Key Concepts\n\n### 1. Tracking Links\n- Unique URLs that record clicks and their source\n- Include parameters like ad ID, creative ID, traffic source\n\n### 2. Postbacks (Server-to-Server Tracking)\n- When a sale happens, the affiliate network sends a \"postback\" to your tracker\n- This tells your tracker: \"This click converted!\"\n- It's like a receipt that connects the sale back to the specific ad\n\n### 3. Why It Matters\n- Without tracking, you're spending blind\n- With tracking, you know exactly which ads, audiences, and creatives make money\n\n## Setting Up (Simplified)\n1. Sign up for a tracker (Voluum, RedTrack)\n2. Add your traffic source (Facebook, etc.)\n3. Add your affiliate network\n4. Create a campaign with your tracking link\n5. Set up the postback URL in your affiliate network\n\nThe **Basic Tracking Setup** lesson in Module 3 walks through this step-by-step with screenshots. Want me to explain any part in more detail?" },
  ]);

  const [chatSession3] = await db.insert(chatSessionsTable).values({
    userId: marcus.id,
    title: "Billing question about tier upgrade",
  }).returning();

  await db.insert(chatMessagesTable).values([
    { sessionId: chatSession3.id, role: "user", content: "I'm currently on the 6-Month Mentorship. How do I upgrade to the 1-Year plan? Do I lose my progress?" },
    { sessionId: chatSession3.id, role: "assistant", content: "Great that you're considering upgrading! Here's what I can tell you:\n\n## What You Keep\n- **All your progress**: Course completion, streaks, everything carries over\n- **Chat history**: All your conversations stay intact\n- **Coaching call recordings**: Access to any past recordings\n\n## What You Gain with 1-Year Mentorship\n- Monthly 1-on-1 coaching sessions\n- Premium affiliate commissions tier\n- Extended access duration\n\n## For the Upgrade Process\nBilling and account changes are handled by our support team to ensure everything transitions smoothly. [SUGGEST_TICKET]\n\nI'd recommend creating a support ticket and our team can:\n1. Explain the prorated pricing\n2. Process the upgrade\n3. Ensure no disruption to your access\n\nWould you like help with anything else about the membership tiers?" },
  ]);

  await db.insert(chatRateLimitsTable).values([
    { tier: "chat:basic", dailyLimit: 20, maxOutputTokens: 1000 },
    { tier: "chat:full", dailyLimit: 50, maxOutputTokens: 2000 },
    { tier: "chat:custom", dailyLimit: 100, maxOutputTokens: 4000 },
  ]);

  await seedCommunicationTemplates();

  console.log("Seeding commission data...");

  const tiers = ["entry", "mid", "premium", "top"];
  const productSlugs = ["reserve_income", "backroad", "offmarket", "launchpad", "3month", "6month", "1year", "lifetime"];
  const rateMap: Record<string, Record<string, { rate: string; bonus: number }>> = {
    entry:   { reserve_income: { rate: "15.00", bonus: 0 }, backroad: { rate: "15.00", bonus: 0 }, offmarket: { rate: "15.00", bonus: 0 }, launchpad: { rate: "10.00", bonus: 0 }, "3month": { rate: "10.00", bonus: 0 }, "6month": { rate: "10.00", bonus: 0 }, "1year": { rate: "8.00", bonus: 0 }, lifetime: { rate: "5.00", bonus: 0 } },
    mid:     { reserve_income: { rate: "20.00", bonus: 0 }, backroad: { rate: "20.00", bonus: 0 }, offmarket: { rate: "20.00", bonus: 0 }, launchpad: { rate: "15.00", bonus: 500 }, "3month": { rate: "15.00", bonus: 500 }, "6month": { rate: "15.00", bonus: 1000 }, "1year": { rate: "12.00", bonus: 1500 }, lifetime: { rate: "10.00", bonus: 2000 } },
    premium: { reserve_income: { rate: "25.00", bonus: 0 }, backroad: { rate: "25.00", bonus: 0 }, offmarket: { rate: "25.00", bonus: 0 }, launchpad: { rate: "20.00", bonus: 1000 }, "3month": { rate: "20.00", bonus: 1000 }, "6month": { rate: "20.00", bonus: 2000 }, "1year": { rate: "18.00", bonus: 3000 }, lifetime: { rate: "15.00", bonus: 5000 } },
    top:     { reserve_income: { rate: "30.00", bonus: 500 }, backroad: { rate: "30.00", bonus: 500 }, offmarket: { rate: "30.00", bonus: 500 }, launchpad: { rate: "25.00", bonus: 2000 }, "3month": { rate: "25.00", bonus: 2000 }, "6month": { rate: "25.00", bonus: 3000 }, "1year": { rate: "22.00", bonus: 5000 }, lifetime: { rate: "20.00", bonus: 10000 } },
  };

  const rateValues = [];
  for (const tier of tiers) {
    for (const slug of productSlugs) {
      const r = rateMap[tier][slug];
      rateValues.push({
        tier,
        productId: productsBySlug[slug],
        ratePercent: r.rate,
        flatBonus: r.bonus,
      });
    }
  }
  await db.insert(commissionRatesTable).values(rateValues);
  console.log(`  Commission rates: ${rateValues.length} rates (${tiers.length} tiers × ${productSlugs.length} products)`);

  const [marcusAff] = await db.insert(affiliateProfilesTable).values({
    userId: marcus.id,
    affiliateCode: "marcus01",
    tier: "mid",
    paypalEmail: "marcus@paypal.example.com",
    taxFormSubmitted: true,
    taxFormUrl: "https://example.com/tax/marcus-w9.pdf",
    totalEarnings: 125000,
    totalPaid: 85000,
    pendingBalance: 18500,
    approvedBalance: 21500,
    lifetimeClicks: 1247,
    lifetimeConversions: 42,
  }).returning();

  const [adminAff] = await db.insert(affiliateProfilesTable).values({
    userId: admin.id,
    affiliateCode: "btsteam",
    tier: "top",
    paypalEmail: "admin@paypal.example.com",
    taxFormSubmitted: true,
    taxFormUrl: "https://example.com/tax/admin-w9.pdf",
    totalEarnings: 450000,
    totalPaid: 380000,
    pendingBalance: 32000,
    approvedBalance: 38000,
    lifetimeClicks: 5890,
    lifetimeConversions: 156,
  }).returning();

  const [jakeAff] = await db.insert(affiliateProfilesTable).values({
    userId: jake.id,
    affiliateCode: "jaker23",
    tier: "premium",
    paypalEmail: "jake@paypal.example.com",
    taxFormSubmitted: true,
    taxFormUrl: "https://example.com/tax/jake-w9.pdf",
    totalEarnings: 287500,
    totalPaid: 220000,
    pendingBalance: 28500,
    approvedBalance: 39000,
    lifetimeClicks: 3412,
    lifetimeConversions: 98,
  }).returning();

  const [lisaAff] = await db.insert(affiliateProfilesTable).values({
    userId: lisa.id,
    affiliateCode: "lisat55",
    tier: "entry",
    paypalEmail: null,
    taxFormSubmitted: false,
    totalEarnings: 15200,
    totalPaid: 5000,
    pendingBalance: 4800,
    approvedBalance: 5400,
    lifetimeClicks: 312,
    lifetimeConversions: 8,
  }).returning();

  console.log("  Affiliate profiles: 4 profiles created");

  const affiliates = [
    { aff: marcusAff, slug: "marcus01" },
    { aff: adminAff, slug: "btsteam" },
    { aff: jakeAff, slug: "jaker23" },
    { aff: lisaAff, slug: "lisat55" },
  ];

  const linkValues = [];
  for (const { aff } of affiliates) {
    for (const slug of productSlugs) {
      linkValues.push({
        affiliateId: aff.id,
        productId: productsBySlug[slug],
        slug,
        clickCount: Math.floor(Math.random() * 200) + 10,
        conversionCount: Math.floor(Math.random() * 15),
      });
    }
  }
  const insertedLinks = await db.insert(referralLinksTable).values(linkValues).returning();
  console.log(`  Referral links: ${insertedLinks.length} links created`);

  const clickValues = [];
  const userAgents = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)",
    "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36",
  ];
  const referers = [
    "https://facebook.com",
    "https://youtube.com",
    "https://google.com",
    "https://twitter.com",
    "https://instagram.com",
    null,
  ];

  for (let i = 0; i < 250; i++) {
    const link = insertedLinks[Math.floor(Math.random() * insertedLinks.length)];
    const daysAgo = Math.floor(Math.random() * 90);
    const clickedAt = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000 - Math.random() * 24 * 60 * 60 * 1000);
    clickValues.push({
      referralLinkId: link.id,
      ipAddress: `${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`,
      userAgent: userAgents[Math.floor(Math.random() * userAgents.length)],
      referer: referers[Math.floor(Math.random() * referers.length)],
      clickedAt,
    });
  }
  await db.insert(referralClicksTable).values(clickValues);
  console.log(`  Referral clicks: ${clickValues.length} clicks created`);

  const statuses = ["pending", "pending", "pending", "approved", "approved", "paid", "paid", "reversed"];
  const customerEmails = [
    "buyer1@example.com", "buyer2@example.com", "buyer3@example.com",
    "buyer4@example.com", "buyer5@example.com", "buyer6@example.com",
    "buyer7@example.com", "buyer8@example.com", "buyer9@example.com",
    "buyer10@example.com", "newcustomer@example.com", "returning@example.com",
  ];

  const commissionValues = [];
  const allAffiliates = [marcusAff, adminAff, jakeAff, lisaAff];
  const affTiers = ["mid", "top", "premium", "entry"];

  for (let i = 0; i < 28; i++) {
    const affIdx = Math.floor(Math.random() * allAffiliates.length);
    const aff = allAffiliates[affIdx];
    const tier = affTiers[affIdx];
    const prodSlug = productSlugs[Math.floor(Math.random() * productSlugs.length)];
    const prodId = productsBySlug[prodSlug];
    const rate = rateMap[tier][prodSlug];
    const status = statuses[Math.floor(Math.random() * statuses.length)];
    const daysAgo = Math.floor(Math.random() * 90);
    const createdAt = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
    const saleAmount = [4700, 4700, 9700, 19700, 29700, 49700, 79700, 149700][productSlugs.indexOf(prodSlug)] || 4700;
    const ratePercent = parseFloat(rate.rate);
    const commissionAmount = Math.round(saleAmount * (ratePercent / 100)) + rate.bonus;

    commissionValues.push({
      affiliateId: aff.id,
      productId: prodId,
      orderId: `TC-${100000 + i}`,
      customerEmail: customerEmails[Math.floor(Math.random() * customerEmails.length)],
      saleAmount,
      commissionRate: rate.rate,
      commissionAmount,
      flatBonus: rate.bonus,
      status,
      tier,
      createdAt,
      approvedAt: ["approved", "paid"].includes(status) ? new Date(createdAt.getTime() + 30 * 24 * 60 * 60 * 1000) : null,
      paidAt: status === "paid" ? new Date(createdAt.getTime() + 45 * 24 * 60 * 60 * 1000) : null,
      reversedAt: status === "reversed" ? new Date(createdAt.getTime() + 5 * 24 * 60 * 60 * 1000) : null,
      reversalReason: status === "reversed" ? "Order refunded" : null,
      fraudFlag: i === 25 ? "same_domain_email" : null,
    });
  }
  await db.insert(commissionsTable).values(commissionValues);
  console.log(`  Commissions: ${commissionValues.length} commission records created`);

  const [payout1] = await db.insert(commissionPayoutsTable).values({
    affiliateId: marcusAff.id,
    amount: 42500,
    commissionCount: 8,
    status: "paid",
    paypalEmail: "marcus@paypal.example.com",
    paypalTransactionId: "PP-TX-001234",
    notes: "Monthly payout - January 2026",
    paidAt: new Date(Date.now() - 45 * 24 * 60 * 60 * 1000),
  }).returning();

  const [payout2] = await db.insert(commissionPayoutsTable).values({
    affiliateId: adminAff.id,
    amount: 125000,
    commissionCount: 22,
    status: "paid",
    paypalEmail: "admin@paypal.example.com",
    paypalTransactionId: "PP-TX-001235",
    notes: "Monthly payout - January 2026",
    paidAt: new Date(Date.now() - 45 * 24 * 60 * 60 * 1000),
  }).returning();

  await db.insert(commissionPayoutsTable).values({
    affiliateId: jakeAff.id,
    amount: 67500,
    commissionCount: 12,
    status: "pending",
    paypalEmail: "jake@paypal.example.com",
    notes: "Pending payout - February 2026",
  });

  console.log("  Payouts: 3 payout records created (2 paid, 1 pending)");

  await db.insert(affiliateResourcesTable).values([
    {
      type: "email_swipe",
      title: "Reserve Income Email Swipe #1",
      description: "High-converting email for promoting the Reserve Income System",
      content: "Subject: How I Make $200/Day With This Simple System\n\nHey [Name],\n\nI wanted to share something that's been working incredibly well for me...\n\nThe Reserve Income System showed me how to build passive income streams using affiliate marketing. And the best part? You don't need any experience.\n\nClick here to learn more: [YOUR LINK]\n\nTo your success,\n[Your Name]",
      productSlug: "reserve_income",
      sortOrder: 1,
    },
    {
      type: "email_swipe",
      title: "Backroad System Email Swipe #1",
      description: "Introduction email for the Backroad System",
      content: "Subject: The 'Backroad' To Affiliate Profits Nobody Talks About\n\nHey [Name],\n\nMost affiliate marketers are competing on the same crowded highways...\n\nBut what if I told you there's a 'backroad' that almost nobody knows about? The Backroad System reveals untapped traffic sources that convert like crazy.\n\nCheck it out here: [YOUR LINK]\n\nBest,\n[Your Name]",
      productSlug: "backroad",
      sortOrder: 2,
    },
    {
      type: "email_swipe",
      title: "Mentorship Upgrade Email Swipe",
      description: "Email template for promoting mentorship upgrades",
      content: "Subject: Ready to Go Full-Time With Affiliate Marketing?\n\nHey [Name],\n\nIf you've been dabbling in affiliate marketing and want to take it to the next level, the BTS Mentorship program is exactly what you need.\n\nYou'll get live coaching, community access, and a proven roadmap to scale.\n\nLearn more: [YOUR LINK]\n\nLet's build something amazing,\n[Your Name]",
      productSlug: "6month",
      sortOrder: 3,
    },
    {
      type: "social_template",
      title: "Facebook Post Template - Success Story",
      description: "Share your affiliate marketing journey on Facebook",
      content: "🚀 Just hit another milestone with affiliate marketing!\n\nWhen I started with @BuildTestScale, I had no idea I could [RESULT]. The training and community support have been incredible.\n\nIf you're looking to start your own affiliate marketing journey, check out the link in my bio! 👇\n\n#AffiliateMarketing #OnlineIncome #BuildTestScale",
      sortOrder: 1,
    },
    {
      type: "social_template",
      title: "Instagram Story Template",
      description: "Instagram story promoting BTS products",
      content: "Swipe up to see the system that changed everything for me ⬆️\n\n✅ No experience needed\n✅ Step-by-step training\n✅ Live coaching support\n\nLink: [YOUR LINK]",
      sortOrder: 2,
    },
    {
      type: "social_template",
      title: "Twitter/X Thread Starter",
      description: "Twitter thread to promote affiliate marketing",
      content: "Thread: How I went from $0 to $X/month with affiliate marketing 🧵\n\n1/ Six months ago, I knew nothing about affiliate marketing. Today, I'm earning [AMOUNT] per month. Here's exactly what I did...\n\n2/ First, I joined @BuildTestScale and followed their step-by-step system. The key was [YOUR INSIGHT]...\n\n3/ The results speak for themselves. If you want to learn more, check out: [YOUR LINK]",
      sortOrder: 3,
    },
    {
      type: "banner",
      title: "Reserve Income Banner - 728x90",
      description: "Leaderboard banner ad for Reserve Income System",
      fileUrl: "https://example.com/banners/reserve-income-728x90.png",
      thumbnailUrl: "https://example.com/banners/thumbs/reserve-income-728x90.png",
      productSlug: "reserve_income",
      sortOrder: 1,
    },
    {
      type: "banner",
      title: "Backroad System Banner - 300x250",
      description: "Medium rectangle banner for Backroad System",
      fileUrl: "https://example.com/banners/backroad-300x250.png",
      thumbnailUrl: "https://example.com/banners/thumbs/backroad-300x250.png",
      productSlug: "backroad",
      sortOrder: 2,
    },
    {
      type: "banner",
      title: "BTS Mentorship Banner - 728x90",
      description: "Leaderboard banner for BTS Mentorship programs",
      fileUrl: "https://example.com/banners/mentorship-728x90.png",
      thumbnailUrl: "https://example.com/banners/thumbs/mentorship-728x90.png",
      sortOrder: 3,
    },
    {
      type: "banner",
      title: "BTS Mentorship Banner - 160x600",
      description: "Skyscraper banner for BTS Mentorship programs",
      fileUrl: "https://example.com/banners/mentorship-160x600.png",
      thumbnailUrl: "https://example.com/banners/thumbs/mentorship-160x600.png",
      sortOrder: 4,
    },
  ]);
  console.log("  Affiliate resources: 10 resources (3 email swipes, 3 social templates, 4 banners)");

  console.log("Seeding win milestones...");
  const milestoneData = [
    { slug: "first-sale", name: "First Sale", description: "Made your first affiliate sale", icon: "💰", category: "revenue", sortOrder: 1, xpReward: 100 },
    { slug: "first-profitable-day", name: "First Profitable Day", description: "First day with positive ROI", icon: "📈", category: "revenue", sortOrder: 2, xpReward: 150 },
    { slug: "first-100-day", name: "First $100 Day", description: "Earned $100+ in a single day", icon: "💵", category: "revenue", sortOrder: 3, xpReward: 200 },
    { slug: "first-500-day", name: "First $500 Day", description: "Earned $500+ in a single day", icon: "🔥", category: "revenue", sortOrder: 4, xpReward: 300 },
    { slug: "first-1k-day", name: "First $1K Day", description: "Earned $1,000+ in a single day", icon: "🚀", category: "revenue", sortOrder: 5, xpReward: 500 },
    { slug: "first-5k-day", name: "First $5K Day", description: "Earned $5,000+ in a single day", icon: "⭐", category: "revenue", sortOrder: 6, xpReward: 750 },
    { slug: "first-10k-day", name: "First $10K Day", description: "Earned $10,000+ in a single day", icon: "👑", category: "revenue", sortOrder: 7, xpReward: 1000 },
    { slug: "first-10k-month", name: "First $10K Month", description: "Earned $10,000+ in a calendar month", icon: "🏆", category: "revenue", sortOrder: 8, xpReward: 1200 },
    { slug: "first-50k-month", name: "First $50K Month", description: "Earned $50,000+ in a calendar month", icon: "💎", category: "revenue", sortOrder: 9, xpReward: 2000 },
    { slug: "first-100k-month", name: "First $100K Month", description: "Earned $100,000+ in a calendar month", icon: "🌟", category: "revenue", sortOrder: 10, xpReward: 5000 },
    { slug: "first-campaign-launched", name: "First Campaign Launched", description: "Launched your first paid campaign", icon: "🎯", category: "campaign", sortOrder: 11, xpReward: 100 },
    { slug: "first-winning-campaign", name: "First Winning Campaign", description: "First campaign with positive ROI after 7+ days", icon: "✅", category: "campaign", sortOrder: 12, xpReward: 250 },
    { slug: "first-scaled-campaign", name: "First Scaled Campaign", description: "First campaign scaled past $100/day profitably", icon: "📊", category: "campaign", sortOrder: 13, xpReward: 400 },
    { slug: "10-campaigns-launched", name: "10 Campaigns Launched", description: "Launched 10 total campaigns", icon: "🔟", category: "campaign", sortOrder: 14, xpReward: 300 },
    { slug: "training-complete", name: "Training Complete", description: "Completed all foundational training modules", icon: "🎓", category: "skill", sortOrder: 15, xpReward: 500 },
    { slug: "advanced-training-complete", name: "Advanced Training Complete", description: "Completed all advanced training", icon: "🧠", category: "skill", sortOrder: 16, xpReward: 750 },
    { slug: "first-advertorial-written", name: "First Advertorial Written", description: "Wrote your first advertorial", icon: "✍️", category: "skill", sortOrder: 17, xpReward: 150 },
    { slug: "first-split-test-run", name: "First Split Test Run", description: "Ran your first headline or creative split test", icon: "🧪", category: "skill", sortOrder: 18, xpReward: 150 },
    { slug: "quit-day-job", name: "Quit My Day Job", description: "Left full-time employment to do affiliate marketing", icon: "🎉", category: "lifestyle", sortOrder: 19, xpReward: 2000 },
    { slug: "first-vacation-from-earnings", name: "First Vacation From Earnings", description: "Took a trip funded entirely by affiliate income", icon: "✈️", category: "lifestyle", sortOrder: 20, xpReward: 1000 },
    { slug: "custom-win", name: "Custom Win", description: "Something awesome that doesn't fit a category", icon: "🏅", category: "custom", sortOrder: 21, xpReward: 50 },
  ];
  const insertedMilestones = await db.insert(winMilestonesTable).values(milestoneData).returning();
  const milestonesBySlug: Record<string, number> = {};
  for (const m of insertedMilestones) {
    milestonesBySlug[m.slug] = m.id;
  }
  console.log(`  Win milestones: ${insertedMilestones.length} milestones seeded`);

  const winsCategory = await db
    .select({ id: communityCategoriesTable.id })
    .from(communityCategoriesTable)
    .where(sql`${communityCategoriesTable.slug} = 'wins'`)
    .limit(1);
  const winsCategoryId = winsCategory[0]?.id;

  const winSeedData = [
    {
      userId: marcus.id,
      milestoneId: milestonesBySlug["first-sale"],
      title: "Got my first affiliate sale!",
      description: "After 2 weeks of testing different approaches from Module 2, I finally got my first sale in the health niche. It was only $45 but it proves the system works!",
      revenueAmount: "45.00",
      winDate: "2026-02-10",
      status: "published",
      proofVerified: true,
      shareToCommunity: true,
      allowTestimonial: true,
      allowPublicName: true,
    },
    {
      userId: marcus.id,
      milestoneId: milestonesBySlug["first-profitable-day"],
      title: "First profitable day - small but real!",
      description: "Small profit but it proves the model works. Spent $50 on ads and made $73.40 in commissions. The Module 4 headline testing framework is a game changer.",
      revenueAmount: "23.40",
      winDate: "2026-02-28",
      status: "published",
      proofVerified: true,
      shareToCommunity: true,
      allowTestimonial: true,
      allowPublicName: true,
    },
    {
      userId: marcus.id,
      milestoneId: milestonesBySlug["first-100-day"],
      title: "Hit my first $100 day!",
      description: "After 3 weeks of testing headlines using the Module 4 framework, I finally cracked the code in the health niche. Started with $50/day budget and scaled to $200/day. The key was the split testing approach from the advanced training.",
      revenueAmount: "147.50",
      winDate: "2026-03-15",
      status: "featured",
      featuredAt: new Date("2026-03-16T10:00:00Z"),
      proofVerified: true,
      shareToCommunity: true,
      allowTestimonial: true,
      allowPublicName: true,
      testimonialRequested: true,
      testimonialText: "BTS completely changed my approach to affiliate marketing. The headline testing framework from Module 4 took me from break-even to my first $100 day in just 3 weeks.",
      testimonialApproved: true,
      testimonialApprovedAt: new Date("2026-03-17T14:00:00Z"),
    },
    {
      userId: jake.id,
      milestoneId: milestonesBySlug["first-1k-day"],
      title: "First $1K day - mind blown! 🚀",
      description: "Never thought I'd see this day. Scaled my winning campaign to $500/day spend and it returned $1,247.50 in commissions. The scaling strategies from Track 4 were exactly what I needed.",
      revenueAmount: "1247.50",
      winDate: "2026-03-10",
      status: "featured",
      featuredAt: new Date("2026-03-11T09:00:00Z"),
      proofVerified: true,
      shareToCommunity: true,
      allowTestimonial: true,
      allowPublicName: true,
      testimonialRequested: true,
      testimonialText: "The BTS scaling strategies are no joke. Went from struggling to break even to my first $1K day in under 4 months. The 1-on-1 coaching sessions were the difference maker.",
      testimonialApproved: true,
      testimonialApprovedAt: new Date("2026-03-12T11:00:00Z"),
    },
    {
      userId: lisa.id,
      milestoneId: milestonesBySlug["first-campaign-launched"],
      title: "Just launched my first campaign!",
      description: "Finally hit publish on my first Facebook Ads campaign promoting health supplements. Budget is $20/day. Nervous but excited! Following the Module 5 step-by-step guide made it feel manageable.",
      winDate: "2026-03-01",
      status: "published",
      shareToCommunity: true,
      allowTestimonial: false,
      allowPublicName: false,
    },
    {
      userId: jake.id,
      milestoneId: milestonesBySlug["first-advertorial-written"],
      title: "Wrote my first advertorial",
      description: "Used the AIDA framework from the Advanced Copywriting module. Took me about 4 hours but I'm pretty happy with how it turned out. Already getting a 2.1% CTR on initial tests.",
      metricLabel: "CTR",
      metricValue: "2.1%",
      winDate: "2026-01-15",
      status: "published",
      proofVerified: false,
      shareToCommunity: true,
      allowTestimonial: false,
      allowPublicName: true,
    },
  ];

  for (const winData of winSeedData) {
    const [win] = await db.insert(winsTable).values(winData).returning();

    if (winData.shareToCommunity && winsCategoryId && winData.status !== "draft") {
      const milestone = insertedMilestones.find(m => m.id === winData.milestoneId);
      const postContent = `🏆 **${milestone?.icon || "🏅"} ${milestone?.name}**\n\n**${winData.title}**\n\n${winData.description}`;

      const [communityPost] = await db
        .insert(communityPostsTable)
        .values({
          authorId: winData.userId,
          categoryId: winsCategoryId,
          content: postContent,
        })
        .returning();

      await db
        .update(winsTable)
        .set({ communityPostId: communityPost.id })
        .where(sql`${winsTable.id} = ${win.id}`);

      await db
        .update(communityCategoriesTable)
        .set({ postsCount: sql`${communityCategoriesTable.postsCount} + 1` })
        .where(sql`${communityCategoriesTable.id} = ${winsCategoryId}`);
    }
  }
  console.log(`  Wins: ${winSeedData.length} sample wins seeded with community posts`);

  const insertedCategories = await db.insert(toolCategoriesTable).values([
    { name: "Content Creation", slug: "content-creation", description: "Tools for creating compelling ad copy, headlines, and content", icon: "PenTool", sortOrder: 1 },
    { name: "Campaign Planning", slug: "campaign-planning", description: "Plan and analyze your advertising campaigns", icon: "Target", sortOrder: 2 },
    { name: "Traffic & Tracking", slug: "traffic-tracking", description: "Build tracking URLs and manage traffic sources", icon: "BarChart3", sortOrder: 3 },
    { name: "Creative Assets", slug: "creative-assets", description: "Design and manage your creative assets", icon: "Image", sortOrder: 4 },
    { name: "Research", slug: "research", description: "Research niches, keywords, and markets", icon: "Search", sortOrder: 5 },
    { name: "Optimization", slug: "optimization", description: "Optimize your campaigns and funnels", icon: "Gauge", sortOrder: 6 },
  ]).returning();

  const catBySlug: Record<string, number> = {};
  for (const c of insertedCategories) {
    catBySlug[c.slug] = c.id;
  }

  const insertedTools = await db.insert(toolsTable).values([
    {
      slug: "headline-generator", name: "Headline Generator",
      shortDescription: "Generate high-converting headlines with AI for any platform or niche.",
      longDescription: "Use AI to generate scroll-stopping headlines for your ads, landing pages, and emails. Choose your style, platform, and tone to get targeted headline suggestions that convert.",
      categoryId: catBySlug["content-creation"], type: "builtin",
      requiredEntitlement: "software:base",
      config: JSON.stringify({ component: "HeadlineGenerator", limits: { base: 5, expanded: 25 } }),
      icon: "Sparkles", status: "active", isFeatured: 1, badge: "NEW",
      totalLaunches: 1247, sortOrder: 1,
    },
    {
      slug: "campaign-calculator", name: "Campaign Calculator",
      shortDescription: "Calculate ROI, breakeven points, and monthly projections for your campaigns.",
      longDescription: "Input your campaign metrics and instantly see your projected ROI, breakeven rates, and monthly projections. Get AI-powered analysis with the expanded tier.",
      categoryId: catBySlug["campaign-planning"], type: "builtin",
      requiredEntitlement: "software:base",
      config: JSON.stringify({ component: "CampaignCalculator", limits: { base: 3, expanded: 15 } }),
      icon: "Calculator", status: "active", isFeatured: 1,
      totalLaunches: 892, sortOrder: 2,
    },
    {
      slug: "tracking-url-builder", name: "Tracking URL Builder",
      shortDescription: "Build tracking URLs with UTM parameters and platform-specific macros.",
      longDescription: "Generate perfectly formatted tracking URLs for any traffic source. Choose from preset traffic source templates that auto-fill UTM parameters and platform macros.",
      categoryId: catBySlug["traffic-tracking"], type: "builtin",
      requiredEntitlement: "software:base",
      config: JSON.stringify({ component: "TrackingUrlBuilder" }),
      icon: "Link", status: "active",
      totalLaunches: 634, sortOrder: 3,
    },
    {
      slug: "advanced-copy-suite", name: "Advanced Copy Suite",
      shortDescription: "Full-featured AI copywriting suite for ads, emails, and landing pages.",
      categoryId: catBySlug["content-creation"], type: "builtin",
      requiredEntitlement: "software:expanded",
      config: JSON.stringify({ component: "AdvancedCopySuite" }),
      icon: "FileText", status: "active", badge: "BETA",
      totalLaunches: 156, sortOrder: 4,
    },
    {
      slug: "keyword-research-hub", name: "Keyword Research Hub",
      shortDescription: "Research profitable keywords and niches with competitive analysis.",
      categoryId: catBySlug["research"], type: "external",
      requiredEntitlement: "software:expanded",
      config: JSON.stringify({ url: "https://tools.bts-example.com/keyword-research", openInNewTab: true }),
      icon: "Search", status: "active",
      totalLaunches: 89, sortOrder: 5,
    },
    {
      slug: "compliance-checker", name: "Compliance Checker",
      shortDescription: "Check your ads and landing pages for compliance issues before publishing.",
      categoryId: catBySlug["optimization"], type: "builtin",
      requiredEntitlement: "software:base",
      config: JSON.stringify({ component: "ComplianceChecker" }),
      icon: "ShieldCheck", status: "coming_soon",
      totalLaunches: 0, sortOrder: 6,
    },
    {
      slug: "niche-scorer", name: "Niche Scorer",
      shortDescription: "Score and compare niches based on profitability, competition, and trends.",
      categoryId: catBySlug["research"], type: "builtin",
      requiredEntitlement: "software:base",
      config: JSON.stringify({ component: "NicheScorer" }),
      icon: "TrendingUp", status: "coming_soon",
      totalLaunches: 0, sortOrder: 7,
    },
    {
      slug: "ad-creative-studio", name: "Ad Creative Studio",
      shortDescription: "Design scroll-stopping ad creatives with templates and AI assistance.",
      categoryId: catBySlug["creative-assets"], type: "builtin",
      requiredEntitlement: "software:expanded",
      config: JSON.stringify({ component: "AdCreativeStudio" }),
      icon: "Palette", status: "coming_soon",
      totalLaunches: 0, sortOrder: 8,
    },
  ]).returning();

  const toolBySlug: Record<string, number> = {};
  for (const t of insertedTools) {
    toolBySlug[t.slug] = t.id;
  }

  await db.insert(toolUserDataTable).values([
    {
      userId: marcus.id, toolId: toolBySlug["headline-generator"],
      dataKey: "favorites",
      dataValue: JSON.stringify({ headlines: ["Stop Scrolling: The $47 System That Changed Everything", "Why 93% of Affiliates Fail (And How to Be in the 7%)"] }),
    },
    {
      userId: marcus.id, toolId: toolBySlug["tracking-url-builder"],
      dataKey: "saved-urls",
      dataValue: JSON.stringify({ urls: [{ name: "FB Campaign 1", url: "https://example.com?utm_source=facebook&utm_medium=cpc&utm_campaign=spring2026" }] }),
    },
  ]);

  await db.insert(toolUsageLogTable).values([
    { userId: marcus.id, toolId: toolBySlug["headline-generator"], action: "open" },
    { userId: marcus.id, toolId: toolBySlug["headline-generator"], action: "generate", metadata: JSON.stringify({ count: 5 }) },
    { userId: marcus.id, toolId: toolBySlug["campaign-calculator"], action: "open" },
    { userId: marcus.id, toolId: toolBySlug["tracking-url-builder"], action: "open" },
  ]);

  try {
    await seedVaultData(marcus.id);
  } catch (e) {
    console.warn("[Seed] Vault seed had issues (non-critical):", (e as Error).message?.substring(0, 100));
  }

  await db.insert(affiliateNetworksTable).values([
    {
      slug: "media-mavens", name: "Media Mavens",
      tagline: "Our own in-house curated network — designed specifically for this system.",
      description: "If you're brand new, start here. Media Mavens is our in-house network, built specifically for the Build Test Scale system, which gives you several real advantages over public marketplaces right from the start. Simple to sign up — no approval required.",
      highlights: ["Higher commissions than comparable products on other networks", "No chargebacks — if a customer returns a product, you keep your commission", "Pre-made advertorials (landing pages) for many products — meaning less work to get started", "Works with all three ad publishers (Caterpillar, Grasshopper, Crane)"],
      publishers: "Caterpillar, Grasshopper, Crane", approvalLabel: "Instant signup",
      recommendedForBeginners: true, accentPreset: "emerald", logoBg: "bg-white",
      accentBorder: "border-emerald-300", accentBadgeBg: "bg-emerald-50",
      accentBadgeText: "text-emerald-800", accentBadgeBorder: "border-emerald-200",
      extraCtaLabel: "View Products", extraCtaHref: "/media-mavens", extraCtaStyle: "emerald",
      logoUrl: "/logos/media-mavens.png", displayOrder: 0, isActive: true,
    },
    {
      slug: "clickbank", name: "ClickBank",
      tagline: "A large public marketplace with thousands of products to promote.",
      description: "The next easiest entry point after Media Mavens. ClickBank is a large public marketplace — simple to sign up, no approval required. You'll create your own landing pages using the product's video as your source material.",
      highlights: ["Instant signup — no approval required", "Thousands of products across many verticals", "Works with Caterpillar and Grasshopper publishers", "Requires building your own jump pages from scratch"],
      publishers: "Caterpillar, Grasshopper", approvalLabel: "Instant signup",
      recommendedForBeginners: false, accentPreset: "amber", logoBg: "bg-white",
      accentBorder: "border-amber-300", accentBadgeBg: "bg-amber-50",
      accentBadgeText: "text-amber-800", accentBadgeBorder: "border-amber-200",
      registerUrl: "https://www.clickbank.com/affiliates/", loginUrl: "https://accounts.clickbank.com/login.htm",
      extraCtaStyle: "default", logoUrl: "/logos/clickbank.jpg", displayOrder: 1, isActive: true,
    },
  ]).onConflictDoNothing({ target: affiliateNetworksTable.slug });

  await seedAssistantCards();

  await seedKnowledgebaseFromFiles();

  await seedInternalSops();

  for (const phase of BLITZ_PHASES) {
    await db.insert(blitzPhasesTable).values({
      slug: phase.key,
      name: phase.label,
      sortOrder: phase.sortOrder,
      color: phase.color,
    }).onConflictDoNothing();
  }

  console.log("\nSeeding complete!");
  console.log("Products created:", Object.keys(productsBySlug).join(", "));
  console.log("Communication templates seeded.");
  console.log("Demo users:");
  console.log("  Marcus Johnson (marcus@example.com / Demo1234) - 6-Month + Backroad [affiliate: marcus01, tier: mid]");
  console.log("  Sarah Chen (sarah@example.com / Demo1234) - Reserve Income (frontend only, no commission access)");
  console.log("  Admin User (admin@bts.com / Demo1234) - Lifetime [affiliate: btsteam, tier: top]");
  console.log("  Jake Rivera (jake@example.com / Demo1234) - 1-Year [affiliate: jaker23, tier: premium]");
  console.log("  Lisa Thompson (lisa@example.com / Demo1234) - 3-Month [affiliate: lisat55, tier: entry]");
  console.log("Chat data: system prompt, 10 knowledgebase docs, 3 demo chat sessions");
  console.log("Software & Tools: 6 categories, 8 tools, sample user data seeded.");
}

if (process.env.NODE_ENV === "production") {
  console.log("Seed script skipped: NODE_ENV is 'production'. Exiting without changes.");
  process.exit(0);
} else {
  seed().catch(console.error).finally(() => process.exit(0));
}
