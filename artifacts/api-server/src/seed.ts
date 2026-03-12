import { db } from "@workspace/db";
import { tiersTable, usersTable, tracksTable, modulesTable, lessonsTable, progressTable, coachesTable, coachingCallsTable, ticketsTable, ticketMessagesTable, announcementsTable } from "@workspace/db";

async function seed() {
  console.log("Seeding database...");

  const [bronze] = await db.insert(tiersTable).values({ name: "Bronze", slug: "bronze", level: 1, priceMonthly: "47.00", maxSupportTickets: 2, callAccessLevel: "weekly_qa" }).returning();
  const [silver] = await db.insert(tiersTable).values({ name: "Silver", slug: "silver", level: 2, priceMonthly: "97.00", maxSupportTickets: 5, callAccessLevel: "strategy" }).returning();
  const [gold] = await db.insert(tiersTable).values({ name: "Gold", slug: "gold", level: 3, priceMonthly: "197.00", maxSupportTickets: 10, callAccessLevel: "mastermind" }).returning();
  const [diamond] = await db.insert(tiersTable).values({ name: "Diamond", slug: "diamond", level: 4, priceMonthly: "497.00", maxSupportTickets: -1, callAccessLevel: "vip_roundtable" }).returning();

  const memberSince = new Date("2026-01-24T00:00:00Z");
  const [user] = await db.insert(usersTable).values({ name: "Marcus Johnson", email: "marcus@example.com", tierId: gold.id, currentStreak: 5, memberSince }).returning();

  const [track1] = await db.insert(tracksTable).values({ title: "Affiliate Marketing Foundations", description: "Master the fundamentals of affiliate marketing from choosing a niche to launching your first campaign.", sortOrder: 1 }).returning();
  const [track2] = await db.insert(tracksTable).values({ title: "Traffic & Audience Building", description: "Learn proven strategies to drive targeted traffic and build an engaged audience.", sortOrder: 2 }).returning();
  const [track3] = await db.insert(tracksTable).values({ title: "Scaling & Optimization", description: "Advanced techniques to scale your campaigns and maximize ROI.", sortOrder: 3 }).returning();

  const [mod1] = await db.insert(modulesTable).values({ trackId: track1.id, title: "Getting Started", description: "Set up your affiliate marketing business the right way.", sortOrder: 1 }).returning();
  const [mod2] = await db.insert(modulesTable).values({ trackId: track1.id, title: "Choosing Your Niche", description: "Find a profitable niche that matches your interests and expertise.", sortOrder: 2 }).returning();
  const [mod3] = await db.insert(modulesTable).values({ trackId: track1.id, title: "Ad Creative Testing", description: "Create compelling ad creatives that convert.", sortOrder: 3 }).returning();
  const [mod4] = await db.insert(modulesTable).values({ trackId: track2.id, title: "Facebook Ads Fundamentals", description: "Learn Facebook ad creation and targeting.", sortOrder: 1 }).returning();
  const [mod5] = await db.insert(modulesTable).values({ trackId: track2.id, title: "SEO for Affiliates", description: "Drive organic traffic to your affiliate content.", sortOrder: 2 }).returning();
  const [mod6] = await db.insert(modulesTable).values({ trackId: track3.id, title: "Scaling Facebook Ads", description: "Scale your winning campaigns profitably.", sortOrder: 1 }).returning();
  const [mod7] = await db.insert(modulesTable).values({ trackId: track3.id, title: "Advanced Analytics", description: "Use data to optimize every aspect of your business.", sortOrder: 2 }).returning();

  const lessonData = [
    { moduleId: mod1.id, title: "Welcome to Build Test Scale", description: "Introduction to the BTS methodology and what you'll learn.", durationMinutes: 15, minimumTier: "bronze", sortOrder: 1 },
    { moduleId: mod1.id, title: "Setting Up Your Tools", description: "Essential tools and accounts you need to get started.", durationMinutes: 20, minimumTier: "bronze", sortOrder: 2 },
    { moduleId: mod1.id, title: "Mindset for Success", description: "Develop the mindset of a successful affiliate marketer.", durationMinutes: 12, minimumTier: "bronze", sortOrder: 3 },
    { moduleId: mod2.id, title: "Niche Research Methods", description: "Proven methods to identify profitable niches.", durationMinutes: 25, minimumTier: "bronze", sortOrder: 1 },
    { moduleId: mod2.id, title: "Competitor Analysis", description: "Analyze your competition and find gaps.", durationMinutes: 20, minimumTier: "bronze", sortOrder: 2 },
    { moduleId: mod2.id, title: "Choosing Your First Offer", description: "How to evaluate and select winning offers.", durationMinutes: 18, minimumTier: "bronze", sortOrder: 3 },
    { moduleId: mod3.id, title: "Writing Headlines That Convert", description: "Master the art of writing attention-grabbing headlines.", durationMinutes: 22, minimumTier: "bronze", sortOrder: 1 },
    { moduleId: mod3.id, title: "Image & Video Creative", description: "Create eye-catching visual content for your ads.", durationMinutes: 30, minimumTier: "silver", sortOrder: 2 },
    { moduleId: mod3.id, title: "A/B Testing Framework", description: "Systematic approach to testing your ad creatives.", durationMinutes: 25, minimumTier: "silver", sortOrder: 3 },
    { moduleId: mod4.id, title: "Facebook Ads Setup", description: "Set up your Business Manager and ad account.", durationMinutes: 20, minimumTier: "bronze", sortOrder: 1 },
    { moduleId: mod4.id, title: "Targeting Strategies", description: "Find and target your ideal audience.", durationMinutes: 25, minimumTier: "bronze", sortOrder: 2 },
    { moduleId: mod4.id, title: "Budget Allocation", description: "Optimize your ad spend for maximum ROI.", durationMinutes: 18, minimumTier: "silver", sortOrder: 3 },
    { moduleId: mod5.id, title: "Keyword Research", description: "Find high-value keywords for your affiliate content.", durationMinutes: 20, minimumTier: "bronze", sortOrder: 1 },
    { moduleId: mod5.id, title: "Content Strategy", description: "Build a content strategy that drives organic traffic.", durationMinutes: 22, minimumTier: "silver", sortOrder: 2 },
    { moduleId: mod5.id, title: "Link Building for Affiliates", description: "Build quality backlinks to boost your rankings.", durationMinutes: 25, minimumTier: "gold", sortOrder: 3 },
    { moduleId: mod6.id, title: "When to Scale", description: "Know the signals that indicate it's time to scale.", durationMinutes: 15, minimumTier: "gold", sortOrder: 1 },
    { moduleId: mod6.id, title: "Horizontal vs Vertical Scaling", description: "Two approaches to scaling your ad campaigns.", durationMinutes: 20, minimumTier: "gold", sortOrder: 2 },
    { moduleId: mod6.id, title: "Scaling to $500/day", description: "Step-by-step guide to hitting $500/day in revenue.", durationMinutes: 30, minimumTier: "gold", sortOrder: 3 },
    { moduleId: mod7.id, title: "Analytics Dashboard Setup", description: "Build a dashboard to track all your key metrics.", durationMinutes: 25, minimumTier: "gold", sortOrder: 1 },
    { moduleId: mod7.id, title: "Advanced Attribution", description: "Multi-touch attribution for better decision making.", durationMinutes: 20, minimumTier: "diamond", sortOrder: 2 },
  ];

  const insertedLessons = await db.insert(lessonsTable).values(lessonData).returning();

  const completedLessonIds = insertedLessons.slice(0, 12).map((l) => l.id);
  for (const lessonId of completedLessonIds) {
    const completedAt = new Date(Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000);
    await db.insert(progressTable).values({ userId: user.id, lessonId, completedAt });
  }

  const [coach1] = await db.insert(coachesTable).values({ name: "Sarah Mitchell", bio: "10+ years in affiliate marketing. Specialist in Facebook Ads and creative testing.", specialties: "Facebook Ads Expert", callTypes: ["weekly_qa", "vip_roundtable"] }).returning();
  const [coach2] = await db.insert(coachesTable).values({ name: "David Chen", bio: "Scaled multiple affiliate businesses to 7 figures. Expert in campaign scaling and optimization.", specialties: "Scaling Strategist", callTypes: ["strategy", "weekly_qa"] }).returning();
  const [coach3] = await db.insert(coachesTable).values({ name: "Amara Williams", bio: "SEO and content marketing specialist. Helps affiliates build sustainable organic traffic.", specialties: "SEO & Content", callTypes: ["weekly_qa", "mastermind"] }).returning();

  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(14, 0, 0, 0);

  const nextWeek = new Date(now);
  nextWeek.setDate(nextWeek.getDate() + 6);
  nextWeek.setHours(11, 0, 0, 0);

  const nextWeek2 = new Date(now);
  nextWeek2.setDate(nextWeek2.getDate() + 8);
  nextWeek2.setHours(15, 0, 0, 0);

  const nextWeek3 = new Date(now);
  nextWeek3.setDate(nextWeek3.getDate() + 13);
  nextWeek3.setHours(14, 0, 0, 0);

  const lastWeek = new Date(now);
  lastWeek.setDate(lastWeek.getDate() - 7);
  lastWeek.setHours(14, 0, 0, 0);

  await db.insert(coachingCallsTable).values([
    { title: "Open Q&A: Ask Anything", description: "Bring your questions! Open to all members.", callType: "weekly_qa", coachId: coach1.id, scheduledAt: tomorrow, durationMinutes: 60, minimumTier: "bronze", registeredCount: 42 },
    { title: "Scaling Facebook Ads to $500/day", description: "Deep dive into scaling strategies for profitable campaigns.", callType: "strategy", coachId: coach2.id, scheduledAt: nextWeek, durationMinutes: 90, minimumTier: "silver", registeredCount: 18 },
    { title: "SEO Mastermind", description: "Advanced SEO strategies for affiliate marketers.", callType: "mastermind", coachId: coach3.id, scheduledAt: nextWeek2, durationMinutes: 60, minimumTier: "gold", registeredCount: 8 },
    { title: "VIP Roundtable: Q1 Strategy", description: "Exclusive strategy session for Diamond members.", callType: "vip_roundtable", coachId: coach1.id, scheduledAt: nextWeek3, durationMinutes: 90, minimumTier: "diamond", registeredCount: 5 },
    { title: "Weekly Q&A Recap", description: "Last week's Q&A recording.", callType: "weekly_qa", coachId: coach1.id, scheduledAt: lastWeek, durationMinutes: 60, minimumTier: "bronze", registeredCount: 35, recordingUrl: "https://example.com/recording/1" },
  ]);

  const [ticket1] = await db.insert(ticketsTable).values({ ticketNumber: "BTS-100234", userId: user.id, category: "billing", priority: "normal", status: "awaiting_response", subject: "Question about tier upgrade pricing" }).returning();
  await db.insert(ticketMessagesTable).values([
    { ticketId: ticket1.id, senderType: "member", body: "I'd like to know if there's a discount when upgrading from Gold to Diamond tier mid-cycle. Do I get prorated billing?" },
    { ticketId: ticket1.id, senderType: "admin", body: "Great question, Marcus! Yes, when upgrading tiers, you'll receive prorated billing. The remaining days on your current Gold plan will be credited toward the Diamond plan price. Would you like me to process the upgrade for you?" },
  ]);

  const [ticket2] = await db.insert(ticketsTable).values({ ticketNumber: "BTS-100189", userId: user.id, category: "technical", priority: "high", status: "resolved", subject: "Video not loading in Module 3", resolvedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000) }).returning();
  await db.insert(ticketMessagesTable).values([
    { ticketId: ticket2.id, senderType: "member", body: "The video in Lesson 3.1 (Writing Headlines That Convert) won't load. I've tried Chrome and Firefox." },
    { ticketId: ticket2.id, senderType: "admin", body: "Thanks for reporting this! We've fixed the video encoding issue. Please try again and let us know if it works." },
    { ticketId: ticket2.id, senderType: "member", body: "It's working now, thank you!" },
  ]);

  await db.insert(announcementsTable).values([
    { title: "New Module: Advanced Analytics", body: "We've just released Module 7: Advanced Analytics in the Scaling & Optimization track. Dive into dashboard setup and multi-touch attribution!", type: "new_content" },
    { title: "Live Event: Summer Scaling Summit", body: "Join us for our annual Summer Scaling Summit on July 15-17. Early bird pricing available for Gold and Diamond members.", type: "event" },
    { title: "Community Milestone: 10,000 Members!", body: "We've hit 10,000 members in the BTS community! Thank you for being part of our journey.", type: "milestone" },
    { title: "Platform Update: New Video Player", body: "We've upgraded our video player with faster loading times, adjustable playback speed, and better mobile support.", type: "general" },
  ]);

  console.log("Seeding complete!");
}

seed().catch(console.error).finally(() => process.exit(0));
