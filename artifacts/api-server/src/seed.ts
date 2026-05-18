import { db } from "@workspace/db";
import {
  productsTable, entitlementsTable, userProductsTable,
  usersTable, tracksTable, modulesTable, lessonsTable, progressTable,
  coachesTable, coachingCallsTable, ticketsTable, ticketMessagesTable, announcementsTable,
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
  coachAvailabilityTable, coachAvailabilityOverridesTable, coachingSessionsTable, coachingRatingsTable,
} from "@workspace/db";
import { sql } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { seedCommunicationTemplates } from "./lib/seed-templates";
import { seedVaultData } from "./lib/seed-vault";

async function seed() {
  console.log("Seeding database...");

  await db.execute(sql`DO $$ BEGIN
    EXECUTE (
      SELECT string_agg('TRUNCATE TABLE ' || quote_ident(tablename) || ' RESTART IDENTITY CASCADE', '; ')
      FROM pg_tables
      WHERE schemaname = 'public'
    );
  END $$`);

  const entitlementData = [
    { key: "content:frontend", description: "Foundational video + text training modules", category: "content" },
    { key: "content:advanced", description: "Advanced pre-recorded training modules", category: "content" },
    { key: "software:base", description: "Base software/tool access", category: "software" },
    { key: "software:expanded", description: "Expanded software/tool suite", category: "software" },
    { key: "coaching:group", description: "Live group coaching calls", category: "coaching" },
    { key: "coaching:mastermind", description: "Advanced mastermind sessions", category: "coaching" },
    { key: "coaching:one_on_one:monthly", description: "Monthly 1-on-1 coaching", category: "coaching" },
    { key: "coaching:one_on_one:weekly", description: "Weekly 1-on-1 coaching", category: "coaching" },
    { key: "community:access", description: "Mentorship community access", category: "community" },
    { key: "commissions:entry", description: "Entry-level affiliate commissions", category: "commissions" },
    { key: "commissions:mid", description: "Mid-tier affiliate commissions", category: "commissions" },
    { key: "commissions:premium", description: "Premium affiliate commissions", category: "commissions" },
    { key: "commissions:top", description: "Top-tier affiliate commissions", category: "commissions" },
    { key: "support:basic", description: "3 tickets/month, standard SLA", category: "support" },
    { key: "support:standard", description: "5 tickets/month", category: "support" },
    { key: "support:enhanced", description: "10 tickets/month", category: "support" },
    { key: "support:unlimited", description: "Unlimited tickets", category: "support" },
    { key: "support:vip", description: "Unlimited + priority SLA", category: "support" },
    { key: "chat:basic", description: "AI chat with basic access", category: "chat" },
    { key: "chat:full", description: "AI chat with full access", category: "chat" },
    { key: "chat:custom", description: "AI chat with custom prompts", category: "chat" },
    { key: "access:lifetime", description: "No expiration on access", category: "access" },
  ];
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
      entitlementKeys: ["content:frontend", "support:basic", "chat:basic"],
      priceDisplay: "$47–$97", sortOrder: 1,
    },
    {
      slug: "backroad", name: "The Backroad System", type: "frontend",
      thrivecartProductId: "thrivecart_backroad",
      entitlementKeys: ["content:frontend", "support:basic", "chat:basic"],
      priceDisplay: "$47–$97", sortOrder: 2,
    },
    {
      slug: "offmarket", name: "The Off-Market Affiliate System", type: "frontend",
      thrivecartProductId: "thrivecart_offmarket",
      entitlementKeys: ["content:frontend", "support:basic", "chat:basic"],
      priceDisplay: "$47–$97", sortOrder: 3,
    },
    {
      slug: "launchpad", name: "BTS LaunchPad", type: "backend",
      thrivecartProductId: "thrivecart_launchpad",
      entitlementKeys: ["content:frontend", "content:advanced", "software:base", "support:standard", "chat:full"],
      priceDisplay: "TBD", sortOrder: 4,
      checkoutUrl: "https://bts.thrivecart.com/bts-launchpad/",
    },
    {
      slug: "3month", name: "BTS 3-Month Mentorship", type: "backend",
      thrivecartProductId: "thrivecart_3month",
      entitlementKeys: ["content:frontend", "content:advanced", "software:base", "coaching:group", "community:access", "commissions:entry", "support:enhanced", "chat:full"],
      durationDays: 90, priceDisplay: "TBD", sortOrder: 5,
      checkoutUrl: "https://bts.thrivecart.com/bts-3-month-mentorship/",
    },
    {
      slug: "6month", name: "BTS 6-Month Mentorship", type: "backend",
      thrivecartProductId: "thrivecart_6month",
      entitlementKeys: ["content:frontend", "content:advanced", "software:base", "software:expanded", "coaching:group", "coaching:mastermind", "community:access", "commissions:mid", "support:unlimited", "chat:full"],
      durationDays: 180, priceDisplay: "TBD", sortOrder: 6,
      checkoutUrl: "https://bts.thrivecart.com/bts-6-month-mentorship/",
    },
    {
      slug: "1year", name: "BTS 1-Year Mentorship", type: "backend",
      thrivecartProductId: "thrivecart_1year",
      entitlementKeys: ["content:frontend", "content:advanced", "software:base", "software:expanded", "coaching:group", "coaching:mastermind", "coaching:one_on_one:monthly", "community:access", "commissions:premium", "support:unlimited", "chat:full"],
      durationDays: 365, priceDisplay: "TBD", sortOrder: 7,
      checkoutUrl: "https://bts.thrivecart.com/bts-1-year-mentorship/",
    },
    {
      slug: "lifetime", name: "BTS Lifetime Mentorship", type: "backend",
      thrivecartProductId: "thrivecart_lifetime",
      entitlementKeys: ["content:frontend", "content:advanced", "software:base", "software:expanded", "coaching:group", "coaching:mastermind", "coaching:one_on_one:weekly", "community:access", "commissions:top", "support:vip", "chat:custom", "access:lifetime"],
      priceDisplay: "TBD", sortOrder: 8,
      checkoutUrl: "https://bts.thrivecart.com/bts-lifetime-mentorship/",
    },
    // YSE (Your Second Engine) products — purchased via yoursecondengine.com
    // and granted to BTS via the /api/integrations/grant-product endpoint.
    // thrivecartProductId is null because these products are sold by YSE's
    // NMI-backed checkout, not ThriveCart.
    {
      slug: "yse_front_end", name: "YSE Front End", type: "frontend",
      entitlementKeys: ["content:frontend", "support:basic", "chat:basic"],
      priceDisplay: "$67", sortOrder: 9,
    },
    {
      slug: "yse_affiliate_cmo_bump", name: "YSE Affiliate CMO Bump", type: "frontend",
      entitlementKeys: ["content:frontend", "support:basic", "chat:basic"],
      priceDisplay: "$47", sortOrder: 10,
    },
    {
      slug: "yse_21_day_blitz", name: "YSE 21-Day Blitz", type: "backend",
      entitlementKeys: ["content:frontend", "content:advanced", "software:base", "support:standard", "chat:full"],
      priceDisplay: "$297", sortOrder: 11,
    },
    {
      slug: "yse_swipe_resource_bank", name: "YSE Swipe Resource Bank", type: "frontend",
      entitlementKeys: ["content:frontend", "support:basic", "chat:basic"],
      priceDisplay: "$97", sortOrder: 12,
    },
    {
      slug: "yse_profit_maximizer_pass", name: "YSE Profit Maximizer Pass", type: "frontend",
      entitlementKeys: ["content:frontend", "content:advanced", "support:standard", "chat:full"],
      priceDisplay: "$97", sortOrder: 13,
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
      entitlementKeys: ["content:frontend", "support:basic", "chat:basic"],
      priceDisplay: "$67",
      sortOrder: 9,
    },
    {
      slug: "yse_affiliate_cmo_bump",
      name: "YSE Affiliate CMO Bump ($47)",
      type: "frontend",
      thrivecartProductId: null,
      entitlementKeys: ["content:frontend", "support:basic", "chat:basic"],
      priceDisplay: "$47",
      sortOrder: 10,
    },
    {
      slug: "yse_21_day_blitz",
      name: "YSE 21-Day Blitz ($297)",
      type: "backend",
      thrivecartProductId: null,
      entitlementKeys: ["content:frontend", "content:advanced", "software:base", "support:standard", "chat:full"],
      durationDays: 21,
      priceDisplay: "$297",
      sortOrder: 11,
    },
    {
      slug: "yse_swipe_resource_bank",
      name: "YSE Swipe Resource Bank ($97)",
      type: "frontend",
      thrivecartProductId: null,
      entitlementKeys: ["content:frontend", "support:basic", "chat:basic"],
      priceDisplay: "$97",
      sortOrder: 12,
    },
    {
      slug: "yse_profit_maximizer_pass",
      name: "YSE Profit Maximizer Pass ($97)",
      type: "frontend",
      thrivecartProductId: null,
      entitlementKeys: ["content:frontend", "content:advanced", "support:standard", "chat:full"],
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

  const [coach1] = await db.insert(coachesTable).values({
    name: "Sarah Mitchell",
    bio: "10+ years in affiliate marketing. Specialist in Facebook Ads and creative testing. Has helped 200+ students scale to $10k/month.",
    specialties: "Facebook Ads Expert",
    callTypes: ["weekly_qa", "vip_roundtable"],
    timezone: "America/New_York",
    maxDailySessions: 4,
    oneOnOneEnabled: true,
    meetLink: "https://meet.google.com/abc-defg-hij",
    averageRating: "4.80",
    totalRatings: 4,
  }).returning();

  const [coach2] = await db.insert(coachesTable).values({
    name: "David Chen",
    bio: "Scaled multiple affiliate businesses to 7 figures. Expert in campaign scaling and data-driven optimization.",
    specialties: "Scaling Strategist",
    callTypes: ["strategy", "weekly_qa"],
    timezone: "America/Los_Angeles",
    maxDailySessions: 3,
    oneOnOneEnabled: true,
    meetLink: "https://meet.google.com/klm-nopq-rst",
    averageRating: "4.67",
    totalRatings: 3,
  }).returning();

  const [coach3] = await db.insert(coachesTable).values({
    name: "Amara Williams",
    bio: "SEO and content marketing specialist for affiliates.",
    specialties: "SEO & Content",
    callTypes: ["weekly_qa", "mastermind"],
    timezone: "America/Chicago",
  }).returning();

  await db.insert(coachAvailabilityTable).values([
    { coachId: coach1.id, dayOfWeek: 1, startTime: "09:00", endTime: "12:00", timezone: "America/New_York" },
    { coachId: coach1.id, dayOfWeek: 1, startTime: "14:00", endTime: "17:00", timezone: "America/New_York" },
    { coachId: coach1.id, dayOfWeek: 3, startTime: "09:00", endTime: "12:00", timezone: "America/New_York" },
    { coachId: coach1.id, dayOfWeek: 3, startTime: "14:00", endTime: "17:00", timezone: "America/New_York" },
    { coachId: coach1.id, dayOfWeek: 5, startTime: "10:00", endTime: "14:00", timezone: "America/New_York" },
    { coachId: coach2.id, dayOfWeek: 2, startTime: "08:00", endTime: "12:00", timezone: "America/Los_Angeles" },
    { coachId: coach2.id, dayOfWeek: 2, startTime: "13:00", endTime: "16:00", timezone: "America/Los_Angeles" },
    { coachId: coach2.id, dayOfWeek: 4, startTime: "09:00", endTime: "13:00", timezone: "America/Los_Angeles" },
    { coachId: coach2.id, dayOfWeek: 4, startTime: "14:00", endTime: "17:00", timezone: "America/Los_Angeles" },
  ]);

  const nextMonday = new Date();
  nextMonday.setDate(nextMonday.getDate() + ((1 + 7 - nextMonday.getDay()) % 7 || 7));
  const nextMondayStr = nextMonday.toISOString().split("T")[0];

  const overrideDate = new Date(nextMonday);
  overrideDate.setDate(overrideDate.getDate() + 14);
  const overrideDateStr = overrideDate.toISOString().split("T")[0];

  await db.insert(coachAvailabilityOverridesTable).values([
    { coachId: coach1.id, overrideDate: nextMondayStr, overrideType: "blocked", reason: "Personal day off" },
    { coachId: coach2.id, overrideDate: overrideDateStr, overrideType: "extra", startTime: "10:00", endTime: "12:00", reason: "Shortened schedule - dentist appointment" },
  ]);

  const now = new Date();
  const tomorrow = new Date(now); tomorrow.setDate(tomorrow.getDate() + 1); tomorrow.setHours(14, 0, 0, 0);
  const nextWeek = new Date(now); nextWeek.setDate(nextWeek.getDate() + 6); nextWeek.setHours(11, 0, 0, 0);
  const nextWeek2 = new Date(now); nextWeek2.setDate(nextWeek2.getDate() + 8); nextWeek2.setHours(15, 0, 0, 0);
  const nextWeek3 = new Date(now); nextWeek3.setDate(nextWeek3.getDate() + 13); nextWeek3.setHours(14, 0, 0, 0);
  const lastWeek = new Date(now); lastWeek.setDate(lastWeek.getDate() - 7); lastWeek.setHours(14, 0, 0, 0);

  await db.insert(coachingCallsTable).values([
    { title: "Open Q&A: Ask Anything", description: "Bring your questions! Open to all mentorship members.", callType: "weekly_qa", coachId: coach1.id, scheduledAt: tomorrow, durationMinutes: 60, requiredEntitlement: "coaching:group", registeredCount: 42 },
    { title: "Scaling Facebook Ads to $500/day", description: "Deep dive into scaling strategies.", callType: "strategy", coachId: coach2.id, scheduledAt: nextWeek, durationMinutes: 90, requiredEntitlement: "coaching:group", registeredCount: 18 },
    { title: "Advanced Mastermind: Q1 Tactics", description: "Advanced SEO and scaling strategies.", callType: "mastermind", coachId: coach3.id, scheduledAt: nextWeek2, durationMinutes: 60, requiredEntitlement: "coaching:mastermind", registeredCount: 8 },
    { title: "VIP Roundtable: Q1 Strategy", description: "Exclusive strategy session for Lifetime members.", callType: "vip_roundtable", coachId: coach1.id, scheduledAt: nextWeek3, durationMinutes: 90, requiredEntitlement: "coaching:mastermind", registeredCount: 5 },
    { title: "Weekly Q&A Recap", description: "Last week's Q&A recording.", callType: "weekly_qa", coachId: coach1.id, scheduledAt: lastWeek, durationMinutes: 60, requiredEntitlement: "coaching:group", registeredCount: 35, recordingUrl: "https://example.com/recording/1" },
  ]);

  const twoMonthsAgo = new Date(now); twoMonthsAgo.setMonth(twoMonthsAgo.getMonth() - 2); twoMonthsAgo.setHours(10, 0, 0, 0);
  const sixWeeksAgo = new Date(now); sixWeeksAgo.setDate(sixWeeksAgo.getDate() - 42); sixWeeksAgo.setHours(14, 0, 0, 0);
  const oneMonthAgo = new Date(now); oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1); oneMonthAgo.setHours(11, 0, 0, 0);
  const twoWeeksAgo = new Date(now); twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14); twoWeeksAgo.setHours(15, 0, 0, 0);
  const upcomingSession = new Date(now); upcomingSession.setDate(upcomingSession.getDate() + 5); upcomingSession.setHours(10, 0, 0, 0);

  const [session1] = await db.insert(coachingSessionsTable).values({
    coachId: coach1.id, memberId: admin.id, scheduledAt: twoMonthsAgo, durationMinutes: 60,
    status: "completed", meetLink: "https://meet.google.com/abc-defg-hij",
    memberNotes: "Discussed Facebook Ads strategy for Q1. Sarah recommended focusing on lookalike audiences and testing 3 ad creatives per campaign.",
    actionItems: [
      { id: "ai-1", text: "Set up 3 lookalike audiences based on top 10% customers", completed: true, completedAt: new Date(twoMonthsAgo.getTime() + 3 * 24 * 60 * 60 * 1000).toISOString() },
      { id: "ai-2", text: "Create 3 ad creative variations for each campaign", completed: true, completedAt: new Date(twoMonthsAgo.getTime() + 5 * 24 * 60 * 60 * 1000).toISOString() },
      { id: "ai-3", text: "Review campaign performance after 7 days and report back", completed: false },
    ],
  }).returning();

  const [session2] = await db.insert(coachingSessionsTable).values({
    coachId: coach2.id, memberId: admin.id, scheduledAt: sixWeeksAgo, durationMinutes: 60,
    status: "completed", meetLink: "https://meet.google.com/klm-nopq-rst",
    memberNotes: "Went over scaling framework. David suggested starting with $50/day budget increase every 3 days if ROAS stays above 2x.",
    actionItems: [
      { id: "ai-4", text: "Implement gradual budget scaling on top 3 campaigns", completed: true, completedAt: new Date(sixWeeksAgo.getTime() + 2 * 24 * 60 * 60 * 1000).toISOString() },
      { id: "ai-5", text: "Set up automated rules for budget pausing at negative ROAS", completed: false },
    ],
  }).returning();

  const [session3] = await db.insert(coachingSessionsTable).values({
    coachId: coach1.id, memberId: admin.id, scheduledAt: oneMonthAgo, durationMinutes: 60,
    status: "cancelled", meetLink: "https://meet.google.com/abc-defg-hij",
    cancelledAt: new Date(oneMonthAgo.getTime() - 48 * 60 * 60 * 1000),
    cancelledBy: "member", cancellationReason: "Schedule conflict with client meeting",
    creditReturned: true,
  }).returning();

  const [session4] = await db.insert(coachingSessionsTable).values({
    coachId: coach2.id, memberId: admin.id, scheduledAt: twoWeeksAgo, durationMinutes: 60,
    status: "no_show", meetLink: "https://meet.google.com/klm-nopq-rst",
  }).returning();

  const [session5] = await db.insert(coachingSessionsTable).values({
    coachId: coach1.id, memberId: admin.id, scheduledAt: upcomingSession, durationMinutes: 60,
    status: "scheduled", meetLink: "https://meet.google.com/abc-defg-hij",
  }).returning();

  const [session6] = await db.insert(coachingSessionsTable).values({
    coachId: coach1.id, memberId: marcus.id, scheduledAt: new Date(twoMonthsAgo.getTime() + 7 * 24 * 60 * 60 * 1000), durationMinutes: 60,
    status: "completed", meetLink: "https://meet.google.com/abc-defg-hij",
    memberNotes: "Great session on niche selection and initial campaign setup.",
    actionItems: [
      { id: "ai-6", text: "Research 5 potential niches using the framework discussed", completed: true, completedAt: new Date(twoMonthsAgo.getTime() + 10 * 24 * 60 * 60 * 1000).toISOString() },
    ],
  }).returning();

  const [session7] = await db.insert(coachingSessionsTable).values({
    coachId: coach2.id, memberId: marcus.id, scheduledAt: new Date(sixWeeksAgo.getTime() + 7 * 24 * 60 * 60 * 1000), durationMinutes: 60,
    status: "completed", meetLink: "https://meet.google.com/klm-nopq-rst",
    memberNotes: "Covered data analysis and tracking setup. David helped set up proper conversion tracking.",
  }).returning();

  await db.insert(coachingRatingsTable).values([
    { sessionId: session1.id, coachId: coach1.id, memberId: admin.id, rating: 5, comment: "Sarah was incredibly helpful. She gave me a clear action plan that I could implement right away." },
    { sessionId: session6.id, coachId: coach1.id, memberId: marcus.id, rating: 5, comment: "Excellent guidance on niche selection. Very practical advice." },
    { sessionId: session2.id, coachId: coach2.id, memberId: admin.id, rating: 4, comment: "Good scaling strategies but would have liked more time to discuss automation." },
    { sessionId: session7.id, coachId: coach2.id, memberId: marcus.id, rating: 5, comment: "David is amazing at tracking and analytics. Super detailed session." },
  ]);

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
      content: `# Build Test Scale Terms of Service\n\n**Last Updated:** January 2026\n\nWelcome to Build Test Scale. These Terms of Service ("Terms") govern your access to and use of the Build Test Scale member portal, training content, tools, coaching services, and community features.\n\n## 1. Acceptance of Terms\n\nBy creating an account, accessing the Platform, or using any Build Test Scale services, you agree to be bound by these Terms.\n\n## 2. Eligibility\n\nYou must be at least 18 years of age and have the legal capacity to enter into binding agreements.\n\n## 3. Account Security\n\nYou are responsible for maintaining the confidentiality of your login credentials and must notify us immediately of any unauthorized access.\n\n## 4. Acceptable Use\n\nYou agree not to copy, modify, or distribute any Platform content without written permission, use automated tools, interfere with the Platform, impersonate another person, or use the Platform for any unlawful purpose.\n\n## 5. Content & Training\n\nTraining content is provided "as is" for educational purposes. You are solely responsible for how you apply the information.\n\n## 6. Community Guidelines\n\nBe respectful, do not post spam, do not share confidential coaching details publicly, and report violations to our support team.\n\n## 7. Privacy\n\nYour use of the Platform is also governed by our Privacy Policy.\n\n## 8. Disclaimer of Warranties\n\nTHE PLATFORM IS PROVIDED "AS IS" AND "AS AVAILABLE" WITHOUT WARRANTIES OF ANY KIND.\n\n## 9. Limitation of Liability\n\nIN NO EVENT SHALL BUILD TEST SCALE BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES.\n\n## 10. Governing Law\n\nThese Terms are governed by the laws of the State of Delaware.\n\n## 11. Contact\n\nFor questions, contact us at support@buildtestscale.com.\n\nBy proceeding, you acknowledge that you have read, understand, and agree to these Terms of Service.`,
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
    content: `You are the BTS (Build Test Scale) AI Chat Assistant — a knowledgeable, encouraging mentor for affiliate marketing members.

## Your Role
- Help members with affiliate marketing strategy, campaign optimization, and platform navigation
- Answer questions about BTS training content, tools, and best practices
- Provide actionable, step-by-step guidance tailored to the member's level
- Be encouraging but honest — celebrate wins and give constructive feedback

## Member Context
- Member name: {{member_name}}
- Chat tier: {{chat_tier}}
- Daily message limit: {{daily_limit}}

## Guidelines
1. Always be professional, friendly, and supportive
2. Give specific, actionable advice rather than vague suggestions
3. Reference BTS training modules and resources when relevant
4. If a question is about billing, account issues, or technical problems you cannot solve, suggest creating a support ticket by saying [SUGGEST_TICKET]
5. Never provide financial guarantees or income claims
6. Stay focused on affiliate marketing and BTS platform topics
7. If you don't know something, say so honestly rather than guessing

## Response Style
- Use clear formatting with headers, bullet points, and numbered lists
- Keep responses focused and concise
- Include examples when helpful
- End with a follow-up question or next step when appropriate`,
    isActive: true,
  });

  await db.insert(knowledgebaseDocsTable).values([
    {
      title: "Getting Started with BTS",
      category: "faq",
      content: "Welcome to Build Test Scale! BTS is a comprehensive affiliate marketing training platform. To get started: 1) Complete your onboarding checklist, 2) Watch the Welcome video in Track 1, 3) Choose your niche using our research methods, 4) Set up your accounts following the Foundation module. Your dashboard shows your progress, upcoming coaching calls, and quick links to continue learning.",
    },
    {
      title: "How to Choose a Profitable Niche",
      category: "platform_guide",
      content: "Choosing a niche is one of the most important decisions in affiliate marketing. Key criteria: 1) Passion or interest in the topic, 2) Market demand (use Google Trends, keyword research), 3) Monetization potential (check affiliate programs in the space), 4) Competition level (aim for niches with competition but not oversaturated). Popular niches for beginners include health & wellness, personal finance, and technology. The BTS Niche Research Methods lesson in Module 2 covers this in detail.",
    },
    {
      title: "Understanding Affiliate Commissions",
      category: "faq",
      content: "Affiliate commissions vary by program and product type. Common commission structures: 1) Pay-per-sale (CPS): earn a percentage of each sale, typically 5-50%, 2) Pay-per-lead (CPL): earn for each qualified lead, usually $1-$50, 3) Pay-per-click (CPC): earn per click, usually $0.01-$0.50. Recurring commissions are available for subscription products. BTS members can earn commissions through the BTS affiliate program at entry, mid, premium, or top tier based on their membership level.",
    },
    {
      title: "Campaign Tracking Setup Guide",
      category: "platform_guide",
      content: "Proper tracking is essential for profitable campaigns. Steps to set up tracking: 1) Choose a tracking platform (recommended: Voluum, RedTrack, or free alternatives), 2) Set up your tracking domain, 3) Create tracking links for each traffic source, 4) Set up postback URLs with your affiliate networks, 5) Test your tracking flow end-to-end before spending on ads. The Basic Tracking Setup lesson in Module 3 walks through this process step by step.",
    },
    {
      title: "Facebook Ads Best Practices for Affiliates",
      category: "marketing",
      content: "Facebook Ads can be highly profitable for affiliate marketing when done right. Best practices: 1) Start with a small daily budget ($20-50), 2) Use broad targeting initially and let Facebook's algorithm optimize, 3) Create multiple ad variations for testing, 4) Use advertorial/bridge pages instead of direct linking, 5) Monitor metrics: CTR > 1%, CPC reasonable for your niche, positive ROAS within 3-5 days. Common mistakes: scaling too fast, not testing creatives, ignoring compliance rules. See the Scaling Facebook Ads module for advanced strategies.",
    },
    {
      title: "Compliance and FTC Guidelines",
      category: "compliance",
      content: "Compliance is critical in affiliate marketing. Key FTC guidelines: 1) Always disclose your affiliate relationship clearly, 2) Don't make false or misleading claims, 3) Only promote products you genuinely believe in, 4) Include proper disclaimers on landing pages, 5) Follow platform-specific rules (Facebook, Google, etc.). Consequences of non-compliance include account bans, legal action, and loss of affiliate partnerships. The Compliance Basics lesson covers everything you need to know.",
    },
    {
      title: "Scaling Your Campaigns Profitably",
      category: "advanced_strategy",
      content: "Scaling is about increasing your ad spend while maintaining profitability. Two approaches: 1) Vertical scaling: increase budget on winning campaigns gradually (20-30% per day), 2) Horizontal scaling: duplicate winning campaigns to new audiences, placements, or platforms. Key metrics to watch: ROAS (should stay above your break-even), frequency (keep below 3-4), CPM trends. When to scale: 3+ consecutive profitable days, stable CPA, proven creative. See the Scaling module in Track 4 for detailed strategies.",
    },
    {
      title: "Common Troubleshooting Issues",
      category: "troubleshooting",
      content: "Common issues and solutions: 1) Videos not loading: clear browser cache, try a different browser, check internet connection. 2) Progress not saving: ensure you click the 'Mark Complete' button, refresh the page. 3) Can't access a module: check that your membership tier includes the required entitlement. 4) Coaching call link not working: links become active 5 minutes before the scheduled time. 5) Account locked: after 5 failed login attempts, wait 15 minutes or reset your password. For other issues, create a support ticket.",
    },
    {
      title: "BTS Membership Tiers Explained",
      category: "faq",
      content: "BTS offers several membership tiers: 1) Frontend Products (Reserve Income, Backroad, Off-Market): foundational training and basic support. 2) LaunchPad: advanced content + software tools. 3) 3-Month Mentorship: adds group coaching and community access. 4) 6-Month Mentorship: adds mastermind sessions and expanded tools. 5) 1-Year Mentorship: includes monthly 1-on-1 coaching. 6) Lifetime Mentorship: full access forever with weekly 1-on-1 coaching and VIP support. Each tier builds on the previous, unlocking more resources and support.",
    },
    {
      title: "Writing High-Converting Ad Copy",
      category: "marketing",
      content: "Great ad copy follows proven frameworks: 1) AIDA: Attention, Interest, Desire, Action. 2) PAS: Problem, Agitate, Solution. 3) Hook-Story-Offer: grab attention, tell a relatable story, present your offer. Tips for affiliate ad copy: use emotional triggers, focus on benefits not features, include social proof when possible, create urgency without being pushy, test multiple angles. The Advanced Copywriting module covers headline formulas, emotional triggers, and data-driven optimization.",
    },
  ]);

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
      const postContent = `🏆 **${milestone?.icon || "🏅"} ${milestone?.name}**\n\n**${winData.title}**\n\n${winData.description}${winData.revenueAmount ? `\n\nRevenue: $${Number(winData.revenueAmount).toLocaleString()}` : ""}`;

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

seed().catch(console.error).finally(() => process.exit(0));
