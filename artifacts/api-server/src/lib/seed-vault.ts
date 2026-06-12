import { db, vaultCollectionsTable, vaultResourcesTable, vaultResourceRelationsTable, vaultFavoritesTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

export async function seedVaultData(marcusId: number) {
  const collections = await db.insert(vaultCollectionsTable).values([
    { name: "Templates", slug: "templates", description: "Ready-to-use templates for ads, landing pages, and campaigns.", icon: "file-text", requiredEntitlement: "content:frontend", sortOrder: 1 },
    { name: "Ad Templates", slug: "ad-templates", description: "Copy-paste ad templates for Facebook, native, and Google.", icon: "megaphone", parentId: null, requiredEntitlement: "content:frontend", sortOrder: 2 },
    { name: "Landing Page Templates", slug: "landing-page-templates", description: "High-converting landing page and bridge page templates.", icon: "layout", parentId: null, requiredEntitlement: "content:frontend", sortOrder: 3 },
    { name: "Swipe Files", slug: "swipe-files", description: "Proven copy, headlines, and creative examples to model.", icon: "copy", requiredEntitlement: "content:frontend", sortOrder: 4 },
    { name: "Headline Swipes", slug: "headline-swipes", description: "Winning headline formulas and examples.", icon: "type", parentId: null, requiredEntitlement: "content:frontend", sortOrder: 5 },
    { name: "Email Swipes", slug: "email-swipes", description: "Email sequence templates and follow-up swipes.", icon: "mail", parentId: null, requiredEntitlement: "content:frontend", sortOrder: 6 },
    { name: "Case Studies", slug: "case-studies", description: "Real-world affiliate marketing success stories and breakdowns.", icon: "bar-chart", requiredEntitlement: "content:advanced", sortOrder: 7 },
    { name: "SOPs", slug: "sops", description: "Standard Operating Procedures for repeatable processes.", icon: "clipboard-list", requiredEntitlement: "content:advanced", sortOrder: 8 },
    { name: "Campaign SOPs", slug: "campaign-sops", description: "Step-by-step SOPs for launching and managing campaigns.", icon: "rocket", parentId: null, requiredEntitlement: "content:advanced", sortOrder: 9 },
    { name: "Cheat Sheets", slug: "cheat-sheets", description: "Quick-reference guides and checklists.", icon: "list-checks", requiredEntitlement: "content:frontend", sortOrder: 10 },
    { name: "Video Tutorials", slug: "video-tutorials", description: "Walkthrough videos and screen recordings.", icon: "video", requiredEntitlement: "content:frontend", sortOrder: 11 },
    { name: "Tools & Calculators", slug: "tools-calculators", description: "Spreadsheets, calculators, and planning tools.", icon: "calculator", requiredEntitlement: "content:frontend", sortOrder: 12 },
    { name: "Image Packs", slug: "image-packs", description: "Royalty-free images and creative assets for campaigns.", icon: "image", requiredEntitlement: "content:advanced", sortOrder: 13 },
    { name: "Guides", slug: "guides", description: "In-depth written guides and playbooks.", icon: "book-open", requiredEntitlement: "content:frontend", sortOrder: 14 },
    { name: "External Links", slug: "external-links", description: "Curated links to recommended tools, platforms, and resources.", icon: "external-link", requiredEntitlement: "content:frontend", sortOrder: 15 },
  ]).returning();

  const collectionsBySlug: Record<string, number> = {};
  for (const c of collections) {
    collectionsBySlug[c.slug] = c.id;
  }

  await db.update(vaultCollectionsTable).set({ parentId: collectionsBySlug["templates"] }).where(
    inArray(vaultCollectionsTable.id, [collectionsBySlug["ad-templates"], collectionsBySlug["landing-page-templates"]])
  );
  await db.update(vaultCollectionsTable).set({ parentId: collectionsBySlug["swipe-files"] }).where(
    inArray(vaultCollectionsTable.id, [collectionsBySlug["headline-swipes"], collectionsBySlug["email-swipes"]])
  );
  await db.update(vaultCollectionsTable).set({ parentId: collectionsBySlug["sops"] }).where(
    eq(vaultCollectionsTable.id, collectionsBySlug["campaign-sops"])
  );

  const resources = await db.insert(vaultResourcesTable).values([
    {
      collectionId: collectionsBySlug["ad-templates"],
      title: "Facebook Ad Copy Template Pack",
      slug: "facebook-ad-copy-template-pack",
      description: "10 proven Facebook ad copy templates for affiliate offers. Includes headline formulas, body copy frameworks, and CTA variations.",
      type: "file",
      fileUrl: "/vault/facebook-ad-templates.pdf",
      fileSize: 245000,
      fileType: "application/pdf",
      tags: ["facebook", "ads", "copy", "template"],
      isFeatured: true,
      requiredEntitlement: "content:frontend",
      sortOrder: 1,
    },
    {
      collectionId: collectionsBySlug["ad-templates"],
      title: "Native Ad Creative Brief Template",
      slug: "native-ad-creative-brief",
      description: "Template for briefing designers on native ad creatives. Includes specs for Taboola, Outbrain, and MGID.",
      type: "file",
      fileUrl: "/vault/native-ad-brief.docx",
      fileSize: 128000,
      fileType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      tags: ["native", "ads", "brief", "template"],
      requiredEntitlement: "content:frontend",
      sortOrder: 2,
    },
    {
      collectionId: collectionsBySlug["landing-page-templates"],
      title: "Bridge Page HTML Template",
      slug: "bridge-page-html-template",
      description: "Clean, high-converting bridge page template. Mobile-responsive with pre-built sections for testimonials, benefits, and CTA.",
      type: "file",
      fileUrl: "/vault/bridge-page-template.zip",
      fileSize: 512000,
      fileType: "application/zip",
      tags: ["landing-page", "bridge", "html", "template"],
      isFeatured: true,
      requiredEntitlement: "content:frontend",
      sortOrder: 1,
    },
    {
      collectionId: collectionsBySlug["headline-swipes"],
      title: "101 Headline Formulas That Convert",
      slug: "101-headline-formulas",
      description: "A comprehensive collection of proven headline formulas organized by emotion, curiosity, and urgency. Each formula includes real examples.",
      type: "file",
      fileUrl: "/vault/101-headlines.pdf",
      fileSize: 890000,
      fileType: "application/pdf",
      tags: ["headlines", "copy", "formulas", "swipe"],
      isFeatured: true,
      requiredEntitlement: "content:frontend",
      sortOrder: 1,
    },
    {
      collectionId: collectionsBySlug["email-swipes"],
      title: "7-Day Email Follow-Up Sequence",
      slug: "7-day-email-followup",
      description: "Complete 7-email follow-up sequence for affiliate offers. Includes subject lines, body copy, and timing recommendations.",
      type: "file",
      fileUrl: "/vault/email-followup-sequence.pdf",
      fileSize: 156000,
      fileType: "application/pdf",
      tags: ["email", "sequence", "followup", "swipe"],
      requiredEntitlement: "content:frontend",
      sortOrder: 1,
    },
    {
      collectionId: collectionsBySlug["case-studies"],
      title: "From $0 to $10K/Month: Health Niche Case Study",
      slug: "health-niche-case-study",
      description: "Detailed breakdown of how one BTS member scaled a health niche campaign from zero to $10K/month in 90 days. Includes traffic sources, ad creatives, and landing page analysis.",
      type: "article",
      markdownContent: `# From $0 to $10K/Month: Health Niche Case Study

## Overview
This case study follows BTS member Alex R. as he launched and scaled a health supplement affiliate campaign using Facebook Ads and native advertising.

## The Setup
- **Niche:** Men's health supplements
- **Traffic Source:** Facebook Ads (primary), Taboola (secondary)
- **Budget:** Started with $50/day, scaled to $500/day
- **Offer:** CPA offer paying $45 per sale

## Month 1: Testing Phase
Alex started by testing 5 different angles with small budgets. He used the BTS Ad Template Pack to create his initial ad variations.

### Key Metrics
| Metric | Value |
|--------|-------|
| Ad Spend | $1,500 |
| Revenue | $900 |
| ROAS | 0.6x |
| Clicks | 3,200 |
| Conversions | 20 |

## Month 2: Optimization
After identifying two winning angles, Alex doubled down on optimization. He used the Bridge Page Template and A/B tested headlines.

### Key Metrics
| Metric | Value |
|--------|-------|
| Ad Spend | $3,000 |
| Revenue | $4,500 |
| ROAS | 1.5x |
| Conversions | 100 |

## Month 3: Scaling
With proven creatives and landing pages, Alex began scaling aggressively. He added Taboola as a secondary traffic source.

### Key Metrics
| Metric | Value |
|--------|-------|
| Ad Spend | $8,000 |
| Revenue | $13,500 |
| ROAS | 1.69x |
| Conversions | 300 |

## Key Takeaways
1. **Start small and test multiple angles** — Alex tested 5 angles before finding winners
2. **Use proven templates** — The BTS templates saved weeks of testing
3. **Scale gradually** — Increase budget by 20-30% every 3-4 days
4. **Diversify traffic sources** — Adding Taboola reduced Facebook dependency

## Resources Used
- Facebook Ad Copy Template Pack
- Bridge Page HTML Template
- Campaign Launch SOP`,
      tags: ["case-study", "health", "facebook", "scaling"],
      isFeatured: true,
      requiredEntitlement: "content:advanced",
      sortOrder: 1,
    },
    {
      collectionId: collectionsBySlug["case-studies"],
      title: "Scaling to $500/Day with Native Ads",
      slug: "native-ads-scaling-case-study",
      description: "How a BTS mentorship member used Taboola and Outbrain to scale a finance niche campaign to $500/day profit.",
      type: "article",
      markdownContent: `# Scaling to $500/Day with Native Ads

## Overview
This case study documents how BTS member Sarah K. used native advertising platforms to build a profitable finance niche affiliate business.

## Strategy
Sarah focused exclusively on native ads (Taboola and Outbrain) to promote a personal finance offer. She used advertorial-style landing pages that provided genuine value before presenting the offer.

## Results
After 4 months of testing and optimization:
- **Daily Revenue:** $1,200/day average
- **Daily Profit:** $500/day average
- **ROAS:** 1.71x
- **Total Profit (Month 4):** $15,000

## Key Lessons
1. Native ads require longer, more educational content
2. Advertorial pages outperform direct landing pages 3:1
3. Targeting by device (mobile vs desktop) dramatically improved ROI
4. Weekend traffic converts differently — adjust bids accordingly`,
      tags: ["case-study", "native-ads", "finance", "scaling"],
      requiredEntitlement: "content:advanced",
      sortOrder: 2,
    },
    {
      collectionId: collectionsBySlug["campaign-sops"],
      title: "Campaign Launch Checklist SOP",
      slug: "campaign-launch-sop",
      description: "Step-by-step SOP for launching a new affiliate campaign. Covers research, setup, creative production, tracking, and initial optimization.",
      type: "article",
      markdownContent: `# Campaign Launch Checklist SOP

## Pre-Launch (Days 1-3)

### Research
- [ ] Identify 3-5 potential offers in your niche
- [ ] Check offer payout, EPC, and conversion rates
- [ ] Research competitor ads using SpyFu or AdBeat
- [ ] Identify target audience demographics

### Setup
- [ ] Create tracking links in your tracker
- [ ] Set up conversion postbacks with the affiliate network
- [ ] Create a dedicated landing page
- [ ] Set up split testing (minimum 2 variations)

## Creative Production (Days 3-5)
- [ ] Write 3-5 ad copy variations using BTS templates
- [ ] Design 3-5 image/video creatives
- [ ] Create advertorial content (if using native ads)
- [ ] Proofread all copy for compliance

## Launch (Day 5-6)
- [ ] Set initial daily budget ($20-50/day)
- [ ] Launch with broad targeting first
- [ ] Verify tracking is firing correctly
- [ ] Monitor for the first 24 hours

## Initial Optimization (Days 7-14)
- [ ] Review performance data after 48 hours
- [ ] Kill underperforming ads (CTR < 1%)
- [ ] Duplicate winning ads with small variations
- [ ] Begin narrowing targeting based on data`,
      tags: ["sop", "campaign", "launch", "checklist"],
      requiredEntitlement: "content:advanced",
      sortOrder: 1,
    },
    {
      collectionId: collectionsBySlug["campaign-sops"],
      title: "Daily Campaign Management SOP",
      slug: "daily-campaign-management-sop",
      description: "Daily routine for managing active campaigns. Includes performance check workflows, budget adjustment rules, and escalation criteria.",
      type: "article",
      markdownContent: `# Daily Campaign Management SOP

## Morning Routine (15-20 minutes)

### Step 1: Performance Overview
Review yesterday's performance across all campaigns:
- Total spend vs. revenue
- ROAS by campaign
- Top performing ad sets

### Step 2: Budget Adjustments
Apply the 20/20 rule:
- If ROAS > 1.5x for 3+ days: Increase budget by 20%
- If ROAS < 0.8x for 2+ days: Decrease budget by 20%
- If ROAS < 0.5x for 1 day: Pause the campaign

### Step 3: Creative Refresh
- Check ad frequency (pause if > 3.0)
- Review creative fatigue indicators
- Schedule new creative tests weekly

## Evening Check (5-10 minutes)
- Review day's spend pacing
- Check for any disapproved ads
- Note any anomalies for morning review`,
      tags: ["sop", "daily", "management", "campaign"],
      requiredEntitlement: "content:advanced",
      sortOrder: 2,
    },
    {
      collectionId: collectionsBySlug["cheat-sheets"],
      title: "Facebook Ads Targeting Cheat Sheet",
      slug: "facebook-targeting-cheat-sheet",
      description: "Quick reference for Facebook audience targeting options, interest stacking strategies, and lookalike audience best practices.",
      type: "file",
      fileUrl: "/vault/fb-targeting-cheatsheet.pdf",
      fileSize: 340000,
      fileType: "application/pdf",
      tags: ["facebook", "targeting", "cheat-sheet", "ads"],
      isFeatured: true,
      requiredEntitlement: "content:frontend",
      sortOrder: 1,
    },
    {
      collectionId: collectionsBySlug["cheat-sheets"],
      title: "Copywriting Power Words List",
      slug: "copywriting-power-words",
      description: "500+ power words organized by emotion category. Use these to supercharge your headlines, ads, and email subject lines.",
      type: "file",
      fileUrl: "/vault/power-words.pdf",
      fileSize: 210000,
      fileType: "application/pdf",
      tags: ["copywriting", "words", "cheat-sheet"],
      requiredEntitlement: "content:frontend",
      sortOrder: 2,
    },
    {
      collectionId: collectionsBySlug["video-tutorials"],
      title: "Setting Up Facebook Pixel Correctly",
      slug: "facebook-pixel-setup",
      description: "Step-by-step video walkthrough of setting up Facebook Pixel for affiliate tracking. Covers standard events, custom conversions, and testing.",
      type: "video",
      videoUrl: "https://www.youtube.com/embed/dQw4w9WgXcQ",
      tags: ["video", "facebook", "pixel", "tracking"],
      requiredEntitlement: "content:frontend",
      sortOrder: 1,
    },
    {
      collectionId: collectionsBySlug["video-tutorials"],
      title: "Spy Tool Walkthrough: Finding Winning Ads",
      slug: "spy-tool-walkthrough",
      description: "How to use spy tools to research competitor ads, identify trending angles, and model successful campaigns.",
      type: "video",
      videoUrl: "https://www.youtube.com/embed/dQw4w9WgXcQ",
      tags: ["video", "spy-tools", "research", "ads"],
      requiredEntitlement: "content:frontend",
      sortOrder: 2,
    },
    {
      collectionId: collectionsBySlug["tools-calculators"],
      title: "Campaign ROI Calculator",
      slug: "campaign-roi-calculator",
      description: "Excel spreadsheet to calculate campaign ROI, break-even CPA, and projected profitability at different scale levels.",
      type: "file",
      fileUrl: "/vault/roi-calculator.xlsx",
      fileSize: 78000,
      fileType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      tags: ["calculator", "roi", "spreadsheet", "tool"],
      requiredEntitlement: "content:frontend",
      sortOrder: 1,
    },
    {
      collectionId: collectionsBySlug["tools-calculators"],
      title: "Ad Spend Budget Planner",
      slug: "ad-spend-budget-planner",
      description: "Plan your monthly ad spend across campaigns. Includes budget allocation formulas and scaling projections.",
      type: "file",
      fileUrl: "/vault/budget-planner.xlsx",
      fileSize: 92000,
      fileType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      tags: ["budget", "planner", "spreadsheet", "tool"],
      requiredEntitlement: "content:frontend",
      sortOrder: 2,
    },
    {
      collectionId: collectionsBySlug["image-packs"],
      title: "Health Niche Stock Image Pack",
      slug: "health-niche-image-pack",
      description: "50 royalty-free stock images optimized for health and wellness affiliate campaigns. Includes lifestyle, product, and before/after style images.",
      type: "file",
      fileUrl: "/vault/health-images.zip",
      fileSize: 25000000,
      fileType: "application/zip",
      tags: ["images", "stock", "health", "creative"],
      requiredEntitlement: "content:advanced",
      sortOrder: 1,
    },
    {
      collectionId: collectionsBySlug["guides"],
      title: "Complete Guide to Affiliate Compliance",
      slug: "affiliate-compliance-guide",
      description: "Everything you need to know about FTC compliance, disclosure requirements, and platform-specific ad policies for affiliates.",
      type: "article",
      markdownContent: `# Complete Guide to Affiliate Compliance

## Why Compliance Matters
Non-compliance can result in account bans, legal action, and loss of affiliate partnerships. This guide covers everything you need to stay compliant.

## FTC Disclosure Requirements
The FTC requires that affiliate marketers clearly disclose their relationship with advertisers.

### Where to Place Disclosures
- **On landing pages:** Above the fold, before any affiliate links
- **In social media posts:** At the beginning of the post
- **In emails:** In the header or first paragraph
- **In videos:** Both verbally and in the description

### Example Disclosure Language
> "This page contains affiliate links. If you purchase through these links, I may earn a commission at no extra cost to you."

## Platform-Specific Policies

### Facebook
- No misleading claims about results
- No before/after images that are deceptive
- Landing pages must match ad content
- Health claims require substantiation

### Google
- Must comply with destination requirements
- No bridge pages that add no value
- Clear advertiser identity required

### Native Ads (Taboola/Outbrain)
- Advertorial content must be labeled
- No fake news-style headlines
- Images must be relevant to content

## Best Practices
1. Always disclose affiliate relationships
2. Never make income guarantees
3. Only promote products you believe in
4. Keep records of all ad creatives and landing pages
5. Stay updated on platform policy changes`,
      tags: ["compliance", "ftc", "guide", "legal"],
      requiredEntitlement: "content:frontend",
      sortOrder: 1,
    },
    {
      collectionId: collectionsBySlug["guides"],
      title: "Traffic Source Selection Guide",
      slug: "traffic-source-selection-guide",
      description: "How to choose the right traffic source for your niche and budget. Covers Facebook, Google, Native, TikTok, and more.",
      type: "article",
      markdownContent: `# Traffic Source Selection Guide

## Overview
Choosing the right traffic source is one of the most important decisions in affiliate marketing. This guide helps you match your niche and budget to the best traffic platform.

## Traffic Source Comparison

| Source | Min Budget | Learning Curve | Best For |
|--------|-----------|---------------|----------|
| Facebook | $50/day | Medium | E-com, Health, Finance |
| Google | $30/day | High | Intent-based offers |
| Taboola | $100/day | Medium | Advertorial content |
| TikTok | $50/day | Low | Youth demographics |
| SEO | $0 (time) | High | Long-term play |

## Decision Framework
1. **Budget under $50/day:** Start with Facebook or TikTok
2. **Budget $50-200/day:** Facebook + one native platform
3. **Budget $200+/day:** Multi-platform approach

## Getting Started
Pick ONE traffic source and master it before diversifying. Most BTS members find success starting with Facebook Ads.`,
      tags: ["traffic", "guide", "selection", "platforms"],
      requiredEntitlement: "content:frontend",
      sortOrder: 2,
    },
    {
      collectionId: collectionsBySlug["external-links"],
      title: "Recommended Tracking Platforms",
      slug: "recommended-tracking-platforms",
      description: "Our curated list of the best affiliate tracking platforms with pros, cons, and pricing for each.",
      type: "link",
      externalUrl: "https://example.com/tracking-platforms",
      tags: ["tools", "tracking", "recommendations"],
      requiredEntitlement: "content:frontend",
      sortOrder: 1,
    },
    {
      collectionId: collectionsBySlug["external-links"],
      title: "Free Stock Image Resources",
      slug: "free-stock-image-resources",
      description: "Top 10 free stock image sites for affiliate marketers. High-quality, royalty-free images for ads and landing pages.",
      type: "link",
      externalUrl: "https://example.com/free-stock-images",
      tags: ["images", "free", "resources", "tools"],
      requiredEntitlement: "content:frontend",
      sortOrder: 2,
    },
    {
      collectionId: collectionsBySlug["cheat-sheets"],
      title: "UTM Parameter Quick Reference",
      slug: "utm-parameter-reference",
      description: "Quick reference card for UTM parameter naming conventions and tracking best practices.",
      type: "file",
      fileUrl: "/vault/utm-reference.pdf",
      fileSize: 95000,
      fileType: "application/pdf",
      tags: ["tracking", "utm", "cheat-sheet", "reference"],
      requiredEntitlement: "content:frontend",
      sortOrder: 3,
    },
    {
      collectionId: collectionsBySlug["ad-templates"],
      title: "Google Ads Copy Template Pack",
      slug: "google-ads-template-pack",
      description: "15 Google Ads copy templates for search and display campaigns. Includes responsive search ad variations.",
      type: "file",
      fileUrl: "/vault/google-ads-templates.pdf",
      fileSize: 198000,
      fileType: "application/pdf",
      tags: ["google", "ads", "copy", "template"],
      requiredEntitlement: "content:frontend",
      sortOrder: 3,
    },
    {
      collectionId: collectionsBySlug["email-swipes"],
      title: "Welcome Sequence Template (5 Emails)",
      slug: "welcome-sequence-template",
      description: "Complete 5-email welcome sequence for new subscribers. Builds trust and primes for affiliate offers.",
      type: "file",
      fileUrl: "/vault/welcome-sequence.pdf",
      fileSize: 134000,
      fileType: "application/pdf",
      tags: ["email", "welcome", "sequence", "swipe"],
      requiredEntitlement: "content:frontend",
      sortOrder: 2,
    },
    {
      collectionId: collectionsBySlug["video-tutorials"],
      title: "Building Your First Funnel",
      slug: "building-first-funnel",
      description: "Complete walkthrough of building an affiliate marketing funnel from scratch using free tools.",
      type: "video",
      videoUrl: "https://www.youtube.com/embed/dQw4w9WgXcQ",
      tags: ["video", "funnel", "tutorial", "beginner"],
      requiredEntitlement: "content:frontend",
      sortOrder: 3,
    },
    {
      collectionId: collectionsBySlug["tools-calculators"],
      title: "Split Test Significance Calculator",
      slug: "split-test-calculator",
      description: "Calculate statistical significance of your A/B test results. Know when you have a real winner.",
      type: "file",
      fileUrl: "/vault/split-test-calculator.xlsx",
      fileSize: 65000,
      fileType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      tags: ["calculator", "split-test", "ab-test", "tool"],
      requiredEntitlement: "content:frontend",
      sortOrder: 3,
    },
  ] as any).returning();

  const resourcesBySlug: Record<string, number> = {};
  for (const r of resources) {
    resourcesBySlug[(r as any).slug] = r.id;
  }

  await db.insert(vaultResourceRelationsTable).values([
    { resourceId: resourcesBySlug["facebook-ad-copy-template-pack"], relatedResourceId: resourcesBySlug["native-ad-creative-brief"] },
    { resourceId: resourcesBySlug["facebook-ad-copy-template-pack"], relatedResourceId: resourcesBySlug["facebook-targeting-cheat-sheet"] },
    { resourceId: resourcesBySlug["health-niche-case-study"], relatedResourceId: resourcesBySlug["campaign-launch-sop"] },
    { resourceId: resourcesBySlug["health-niche-case-study"], relatedResourceId: resourcesBySlug["facebook-ad-copy-template-pack"] },
    { resourceId: resourcesBySlug["bridge-page-html-template"], relatedResourceId: resourcesBySlug["101-headline-formulas"] },
    { resourceId: resourcesBySlug["campaign-launch-sop"], relatedResourceId: resourcesBySlug["daily-campaign-management-sop"] },
  ]);

  await db.insert(vaultFavoritesTable).values([
    { userId: marcusId, resourceId: resourcesBySlug["facebook-ad-copy-template-pack"] },
    { userId: marcusId, resourceId: resourcesBySlug["101-headline-formulas"] },
    { userId: marcusId, resourceId: resourcesBySlug["campaign-launch-sop"] },
  ]);

  console.log(`  Vault collections: ${collections.length} collections`);
  console.log(`  Vault resources: ${resources.length} resources`);
}
