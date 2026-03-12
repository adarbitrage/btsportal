import { db } from "@workspace/db";
import {
  productsTable, entitlementsTable, userProductsTable,
  usersTable, tracksTable, modulesTable, lessonsTable, progressTable,
  coachesTable, coachingCallsTable, ticketsTable, ticketMessagesTable, announcementsTable
} from "@workspace/db";
import { sql } from "drizzle-orm";

async function seed() {
  console.log("Seeding database...");

  await db.execute(sql`TRUNCATE TABLE ticket_messages, tickets, progress, announcements, coaching_calls, coaches, lessons, modules, tracks, user_products, entitlements, products, users RESTART IDENTITY CASCADE`);

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
    {
      slug: "reserve_income", name: "The Reserve Income System", type: "frontend",
      thrivecartProductId: "thrivecart_reserve_income",
      entitlementKeys: JSON.stringify(["content:frontend", "support:basic", "chat:basic"]),
      priceDisplay: "$47–$97", sortOrder: 1,
    },
    {
      slug: "backroad", name: "The Backroad System", type: "frontend",
      thrivecartProductId: "thrivecart_backroad",
      entitlementKeys: JSON.stringify(["content:frontend", "support:basic", "chat:basic"]),
      priceDisplay: "$47–$97", sortOrder: 2,
    },
    {
      slug: "offmarket", name: "The Off-Market Affiliate System", type: "frontend",
      thrivecartProductId: "thrivecart_offmarket",
      entitlementKeys: JSON.stringify(["content:frontend", "support:basic", "chat:basic"]),
      priceDisplay: "$47–$97", sortOrder: 3,
    },
    {
      slug: "launchpad", name: "BTS LaunchPad", type: "backend",
      thrivecartProductId: "thrivecart_launchpad",
      entitlementKeys: JSON.stringify(["content:frontend", "content:advanced", "software:base", "support:standard", "chat:full"]),
      priceDisplay: "TBD", sortOrder: 4,
    },
    {
      slug: "3month", name: "BTS 3-Month Mentorship", type: "backend",
      thrivecartProductId: "thrivecart_3month",
      entitlementKeys: JSON.stringify(["content:frontend", "content:advanced", "software:base", "coaching:group", "community:access", "commissions:entry", "support:enhanced", "chat:full"]),
      durationDays: 90, priceDisplay: "TBD", sortOrder: 5,
    },
    {
      slug: "6month", name: "BTS 6-Month Mentorship", type: "backend",
      thrivecartProductId: "thrivecart_6month",
      entitlementKeys: JSON.stringify(["content:frontend", "content:advanced", "software:base", "software:expanded", "coaching:group", "coaching:mastermind", "community:access", "commissions:mid", "support:unlimited", "chat:full"]),
      durationDays: 180, priceDisplay: "TBD", sortOrder: 6,
    },
    {
      slug: "1year", name: "BTS 1-Year Mentorship", type: "backend",
      thrivecartProductId: "thrivecart_1year",
      entitlementKeys: JSON.stringify(["content:frontend", "content:advanced", "software:base", "software:expanded", "coaching:group", "coaching:mastermind", "coaching:one_on_one:monthly", "community:access", "commissions:premium", "support:unlimited", "chat:full"]),
      durationDays: 365, priceDisplay: "TBD", sortOrder: 7,
    },
    {
      slug: "lifetime", name: "BTS Lifetime Mentorship", type: "backend",
      thrivecartProductId: "thrivecart_lifetime",
      entitlementKeys: JSON.stringify(["content:frontend", "content:advanced", "software:base", "software:expanded", "coaching:group", "coaching:mastermind", "coaching:one_on_one:weekly", "community:access", "commissions:top", "support:vip", "chat:custom", "access:lifetime"]),
      priceDisplay: "TBD", sortOrder: 8,
    },
  ];
  const insertedProducts = await db.insert(productsTable).values(productData).returning();
  const productsBySlug: Record<string, number> = {};
  for (const p of insertedProducts) {
    productsBySlug[p.slug] = p.id;
  }

  const memberSince = new Date("2026-01-24T00:00:00Z");
  const [user] = await db.insert(usersTable).values({
    name: "Marcus Johnson", email: "marcus@example.com",
    sourceProduct: "backroad", onboardingComplete: true,
    currentStreak: 5, memberSince,
  }).returning();

  const sixMonthsFromNow = new Date();
  sixMonthsFromNow.setDate(sixMonthsFromNow.getDate() + 120);
  await db.insert(userProductsTable).values([
    { userId: user.id, productId: productsBySlug["backroad"], status: "active" },
    { userId: user.id, productId: productsBySlug["6month"], status: "active", expiresAt: sixMonthsFromNow },
  ]);

  const [track1] = await db.insert(tracksTable).values({ title: "Affiliate Marketing Foundations", description: "Master the fundamentals of affiliate marketing from choosing a niche to launching your first campaign.", requiredEntitlement: "content:frontend", sortOrder: 1 }).returning();
  const [track2] = await db.insert(tracksTable).values({ title: "Traffic & Audience Building", description: "Learn proven strategies to drive targeted traffic and build an engaged audience.", requiredEntitlement: "content:frontend", sortOrder: 2 }).returning();
  const [track3] = await db.insert(tracksTable).values({ title: "Advanced Strategies", description: "Advanced pre-recorded training on campaign optimization, scaling, and analytics.", requiredEntitlement: "content:advanced", sortOrder: 3 }).returning();
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
    await db.insert(progressTable).values({ userId: user.id, lessonId, completedAt });
  }

  const [coach1] = await db.insert(coachesTable).values({ name: "Sarah Mitchell", bio: "10+ years in affiliate marketing. Specialist in Facebook Ads and creative testing.", specialties: "Facebook Ads Expert", callTypes: ["weekly_qa", "vip_roundtable"] }).returning();
  const [coach2] = await db.insert(coachesTable).values({ name: "David Chen", bio: "Scaled multiple affiliate businesses to 7 figures. Expert in campaign scaling.", specialties: "Scaling Strategist", callTypes: ["strategy", "weekly_qa"] }).returning();
  const [coach3] = await db.insert(coachesTable).values({ name: "Amara Williams", bio: "SEO and content marketing specialist for affiliates.", specialties: "SEO & Content", callTypes: ["weekly_qa", "mastermind"] }).returning();

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

  const [ticket1] = await db.insert(ticketsTable).values({ ticketNumber: "BTS-100234", userId: user.id, category: "billing", priority: "normal", status: "awaiting_response", subject: "Question about tier upgrade pricing" }).returning();
  await db.insert(ticketMessagesTable).values([
    { ticketId: ticket1.id, senderType: "member", body: "I'd like to know if there's a discount when upgrading from 6-Month to 1-Year Mentorship mid-cycle. Do I get prorated billing?" },
    { ticketId: ticket1.id, senderType: "admin", body: "Great question, Marcus! Yes, when upgrading tiers, you'll receive prorated billing. Would you like me to process the upgrade for you?" },
  ]);

  const [ticket2] = await db.insert(ticketsTable).values({ ticketNumber: "BTS-100189", userId: user.id, category: "technical", priority: "high", status: "resolved", subject: "Video not loading in Module 3", resolvedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000) }).returning();
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

  console.log("Seeding complete!");
  console.log("Products created:", Object.keys(productsBySlug).join(", "));
  console.log("Demo user: Marcus Johnson (6-Month Mentorship + Backroad System)");
}

seed().catch(console.error).finally(() => process.exit(0));
