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
} from "@workspace/db";
import { sql } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { seedCommunicationTemplates } from "./lib/seed-templates";

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

  const sixMonthsFromNow = new Date();
  sixMonthsFromNow.setDate(sixMonthsFromNow.getDate() + 120);
  await db.insert(userProductsTable).values([
    { userId: marcus.id, productId: productsBySlug["backroad"], status: "active" },
    { userId: marcus.id, productId: productsBySlug["6month"], status: "active", expiresAt: sixMonthsFromNow },
    { userId: sarah.id, productId: productsBySlug["reserve_income"], status: "active" },
    { userId: admin.id, productId: productsBySlug["lifetime"], status: "active" },
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

  await db.insert(legalDocumentsTable).values([
    {
      type: "membership_agreement",
      version: 1,
      title: "Membership Agreement",
      content: `# Build Test Scale Membership Agreement\n\n**Effective Date:** Upon execution by Member\n\nThis Membership Agreement ("Agreement") is entered into between Build Test Scale, LLC ("Company," "we," "us," or "our") and the individual or entity identified during registration ("Member," "you," or "your").\n\n## 1. Membership & Access\n\nBy purchasing a Build Test Scale product or service, you are granted access to the specific digital training content, tools, community features, and coaching services associated with your purchased tier. Access is non-transferable and limited to the registered Member.\n\n## 2. Payment & Billing\n\n- All purchases are processed through ThriveCart or an authorized payment processor.\n- Recurring memberships (3-Month, 6-Month, 1-Year Mentorship) will auto-renew unless canceled before the renewal date.\n- Lifetime Memberships are one-time purchases and do not renew.\n\n## 3. Refund Policy\n\n- Front-end products carry a 30-day money-back guarantee from the date of purchase.\n- Mentorship programs are non-refundable after the 72-hour cooling-off period.\n- Lifetime Memberships are non-refundable.\n\n## 4. Code of Conduct\n\nMembers agree to treat all community members, coaches, and staff with respect, not share login credentials or distribute proprietary content, not engage in spam, harassment, or illegal activities, and provide truthful information during registration.\n\n## 5. Intellectual Property\n\nAll training materials, videos, documents, templates, and tools provided through Build Test Scale are the intellectual property of Build Test Scale, LLC. Unauthorized reproduction, distribution, or resale is strictly prohibited.\n\n## 6. Limitation of Liability\n\nBuild Test Scale provides educational content and tools for informational purposes only. We do not guarantee specific income results.\n\n## 7. Termination\n\nWe reserve the right to terminate or suspend your membership for violation of this Agreement.\n\n## 8. Modifications\n\nWe reserve the right to modify this Agreement at any time.\n\n## 9. Governing Law\n\nThis Agreement is governed by the laws of the State of Delaware.\n\n## 10. Contact\n\nFor questions regarding this Agreement, contact us at support@buildtestscale.com.\n\nBy proceeding, you acknowledge that you have read, understand, and agree to the terms of this Membership Agreement.`,
    },
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

  await seedCommunicationTemplates();

  console.log("Seeding complete!");
  console.log("Products created:", Object.keys(productsBySlug).join(", "));
  console.log("Demo users:");
  console.log("  Marcus Johnson (marcus@example.com / Demo1234) - 6-Month + Backroad");
  console.log("  Sarah Chen (sarah@example.com / Demo1234) - Reserve Income (frontend only)");
  console.log("  Admin User (admin@bts.com / Demo1234) - Lifetime");
  console.log("Chat data: system prompt, 10 knowledgebase docs, 3 demo chat sessions");
}

seed().catch(console.error).finally(() => process.exit(0));
