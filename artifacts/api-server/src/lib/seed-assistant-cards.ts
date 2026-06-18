/**
 * Idempotent seed for the AI Assistant card library.
 *
 * Derives starter groups and cards from live data rather than hard-coded lists:
 *
 *  - Portal Navigation, Getting Started, Training: structural groups whose cards
 *    map directly to the MEMBER_NAV sections defined in Sidebar.tsx. These nav
 *    sections are stable contracts (route paths, entitlement keys) so they live
 *    as a typed constant here, co-located and commented with the nav source.
 *
 *  - Apps & Tools: one card per active tool found in toolsTable, derived at
 *    runtime. Adding a new tool to the system automatically produces a seed card
 *    for it on the next re-deploy, with the correct entitlement key pulled from
 *    the tool row. This satisfies the "Tools & Apps section is the source of
 *    truth" requirement — the seed does not hand-list app names.
 *
 *  - Knowledge Base Topics: one card per distinct KB category found in
 *    knowledgebaseDocsTable. The set of categories grows as the team publishes
 *    more KB docs, and the seed picks them up dynamically.
 *
 * Idempotency:
 *  - Groups: upsert by name (check-before-insert).
 *  - Cards: upsert by (groupId, title) (check-before-insert).
 *  - No questions are inserted — admins generate those via the Task 5 tool.
 *  - Seeded cards start with isActive = true; the member endpoint hides cards
 *    with zero active questions so no content appears until questions are added.
 */

import {
  db,
  assistantCardGroupsTable,
  assistantCardsTable,
  toolsTable,
  knowledgebaseDocsTable,
  productsTable,
} from "@workspace/db";
import { eq, and, ne, sql } from "drizzle-orm";

// ── Types ─────────────────────────────────────────────────────────────────────

interface StaticCardSpec {
  title: string;
  description: string;
  icon: string;
  entitlementKey: string | null;
  upgradeProductSlug: string | null;
  sortOrder: number;
}

interface StaticGroupSpec {
  name: string;
  description: string;
  icon: string;
  sortOrder: number;
  cards: StaticCardSpec[];
}

// ── Static structural groups ──────────────────────────────────────────────────
// These mirror the MEMBER_NAV folders in:
//   artifacts/portal/src/components/layout/Sidebar.tsx
//
// Entitlement keys and upgrade product slugs reference only the 22 keys
// registered in seed.ts. "null" = visible to all members.
//
// Upgrade product slugs:
//   reserve_income  → content:frontend access
//   launchpad       → software:base access
//   3month          → coaching:group, community:access, commissions:entry
//   1year           → commissions:premium
//   lifetime        → commissions:top
//   6month          → software:expanded, commissions:mid

const STATIC_GROUPS: StaticGroupSpec[] = [
  {
    // Mirrors the top-level MEMBER_NAV items (Dashboard, Training, Tools & Apps,
    // Resources, Coaching, Community, Earn, Account).
    name: "Portal Navigation",
    description: "Get answers about the major sections of the BTS Member Portal.",
    icon: "LayoutDashboard",
    sortOrder: 0,
    cards: [
      {
        title: "Dashboard",
        description: "How to use your member dashboard and understand your progress metrics.",
        icon: "LayoutDashboard",
        entitlementKey: null,
        upgradeProductSlug: null,
        sortOrder: 0,
      },
      {
        title: "Community",
        description: "Navigating the BTS community, creating posts, and connecting with members.",
        icon: "Users",
        // Nav leaf: requiredEntitlement: "community:access"
        entitlementKey: "community:access",
        upgradeProductSlug: "3month",
        sortOrder: 1,
      },
      {
        title: "Coaching Calls",
        description: "How to join live group coaching calls and access recordings.",
        icon: "Video",
        // Nav leaf: requiredEntitlement: "coaching:group"
        entitlementKey: "coaching:group",
        upgradeProductSlug: "3month",
        sortOrder: 2,
      },
      {
        title: "Private Coaching",
        description: "Booking and managing your personal coaching sessions.",
        icon: "UserCheck",
        // Nav leaf: /coaching/book-session (credit-based session packs, open to all)
        entitlementKey: null,
        upgradeProductSlug: null,
        sortOrder: 3,
      },
      {
        title: "Support & Tickets",
        description: "How to open a support ticket and what to expect from the support team.",
        icon: "LifeBuoy",
        entitlementKey: null,
        upgradeProductSlug: null,
        sortOrder: 4,
      },
      {
        title: "Earn — Promote BTS",
        description: "How affiliate commissions work and how to promote BTS as an affiliate.",
        icon: "DollarSign",
        // Nav leaf: requiredEntitlement: "commissions:*" (entry is the lowest tier)
        entitlementKey: "commissions:entry",
        upgradeProductSlug: "3month",
        sortOrder: 5,
      },
    ],
  },
  {
    // Mirrors the onboarding flow and account setup pages.
    name: "Getting Started",
    description: "Orientation, onboarding steps, and first actions for new members.",
    icon: "Zap",
    sortOrder: 1,
    cards: [
      {
        title: "Onboarding Overview",
        description: "What to expect from the onboarding flow and how to complete each step.",
        icon: "CheckSquare",
        entitlementKey: null,
        upgradeProductSlug: null,
        sortOrder: 0,
      },
      {
        // Nav leaf: /core-training/quick-start, requiredEntitlement: content:frontend
        title: "Quick Start Guide",
        description: "The fastest path from sign-up to your first affiliate campaign.",
        icon: "Zap",
        entitlementKey: "content:frontend",
        upgradeProductSlug: "reserve_income",
        sortOrder: 1,
      },
      {
        // Nav leaf: /account (no entitlement)
        title: "Account & Profile Setup",
        description: "Updating your profile, changing your password, and managing your account.",
        icon: "UserCircle",
        entitlementKey: null,
        upgradeProductSlug: null,
        sortOrder: 2,
      },
      {
        // Nav leaf: /account/products (no entitlement)
        title: "My Products",
        description: "Understanding which products and entitlements are active on your account.",
        icon: "Package",
        entitlementKey: null,
        upgradeProductSlug: null,
        sortOrder: 3,
      },
    ],
  },
  {
    // Mirrors the Training nav folder children:
    //   7 Pillars (/core-training/7-pillars), The Blitz (/blitz), Tips & Tricks (/tips-and-tricks)
    // plus advanced training content (content:advanced entitlement).
    name: "Training",
    description: "Questions about BTS training content, lessons, and learning paths.",
    icon: "GraduationCap",
    sortOrder: 2,
    cards: [
      {
        // Nav leaf: /core-training/7-pillars (no explicit entitlement, content:frontend implied)
        title: "7 Pillars",
        description: "Overview of the 7 Pillars framework and how to work through each module.",
        icon: "Layers",
        entitlementKey: "content:frontend",
        upgradeProductSlug: "reserve_income",
        sortOrder: 0,
      },
      {
        // Nav leaf: /blitz (no explicit entitlement, content:frontend implied)
        title: "The Blitz™",
        description: "How the Blitz works, what's in it, and how to get the most from it.",
        icon: "Zap",
        entitlementKey: "content:frontend",
        upgradeProductSlug: "reserve_income",
        sortOrder: 1,
      },
      {
        // Nav leaf: /tips-and-tricks (no explicit entitlement)
        title: "Tips & Tricks",
        description: "Finding and using the community-sourced tips and tricks library.",
        icon: "Lightbulb",
        entitlementKey: "content:frontend",
        upgradeProductSlug: "reserve_income",
        sortOrder: 2,
      },
      {
        // Advanced training modules (content:advanced entitlement)
        title: "Advanced Training",
        description: "Accessing advanced modules, campaign optimization, and scaling content.",
        icon: "TrendingUp",
        entitlementKey: "content:advanced",
        upgradeProductSlug: "launchpad",
        sortOrder: 3,
      },
      {
        // Nav leaf: /resource-library (content:frontend implied)
        title: "Resource Library",
        description: "Finding templates, swipe files, case studies, and downloadable assets.",
        icon: "Library",
        entitlementKey: "content:frontend",
        upgradeProductSlug: "reserve_income",
        sortOrder: 4,
      },
    ],
  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

async function getProductId(slug: string): Promise<number | null> {
  const rows = await db
    .select({ id: productsTable.id })
    .from(productsTable)
    .where(eq(productsTable.slug, slug))
    .limit(1);
  return rows[0]?.id ?? null;
}

async function upsertGroup(
  name: string,
  description: string,
  icon: string,
  sortOrder: number,
): Promise<number> {
  const existing = await db
    .select({ id: assistantCardGroupsTable.id })
    .from(assistantCardGroupsTable)
    .where(eq(assistantCardGroupsTable.name, name))
    .limit(1);

  if (existing.length > 0) {
    return existing[0].id;
  }

  const [inserted] = await db
    .insert(assistantCardGroupsTable)
    .values({ name, description, icon, sortOrder, isActive: true })
    .returning({ id: assistantCardGroupsTable.id });

  return inserted.id;
}

async function upsertCard(
  groupId: number,
  title: string,
  description: string,
  icon: string | null,
  entitlementKey: string | null,
  upgradeProductId: number | null,
  sortOrder: number,
): Promise<void> {
  const existing = await db
    .select({ id: assistantCardsTable.id })
    .from(assistantCardsTable)
    .where(
      and(
        eq(assistantCardsTable.groupId, groupId),
        eq(assistantCardsTable.title, title),
      ),
    )
    .limit(1);

  if (existing.length > 0) {
    return;
  }

  await db.insert(assistantCardsTable).values({
    groupId,
    title,
    description,
    icon,
    entitlementKey,
    upgradeProductId,
    sortOrder,
    isActive: true,
  });
}

// ── Seed function ─────────────────────────────────────────────────────────────

export async function seedAssistantCards(): Promise<void> {
  console.log("[seed-assistant-cards] Seeding assistant card library…");

  const productCache: Record<string, number | null> = {};

  async function resolveProduct(slug: string | null): Promise<number | null> {
    if (!slug) return null;
    if (slug in productCache) return productCache[slug];
    const id = await getProductId(slug);
    productCache[slug] = id;
    return id;
  }

  // 1. Static structural groups (Portal Navigation, Getting Started, Training)
  for (const group of STATIC_GROUPS) {
    const groupId = await upsertGroup(
      group.name,
      group.description,
      group.icon,
      group.sortOrder,
    );

    for (const card of group.cards) {
      const upgradeProductId = await resolveProduct(card.upgradeProductSlug);
      await upsertCard(
        groupId,
        card.title,
        card.description,
        card.icon,
        card.entitlementKey,
        upgradeProductId,
        card.sortOrder,
      );
    }
  }

  // 2. Apps & Tools — one card per active tool found in toolsTable.
  //    This is the "live" derivation: do not add app names here; they come from
  //    the database. Skips tools with status = 'coming_soon' since there is
  //    nothing for the admin to generate questions about yet.
  //    Entitlement keys are taken directly from each tool row and the correct
  //    upgrade product is resolved from the entitlement key.
  const ENTITLEMENT_TO_UPGRADE: Record<string, string> = {
    "software:base": "launchpad",
    "software:expanded": "6month",
  };

  const activeTools = await db
    .select({
      slug: toolsTable.slug,
      name: toolsTable.name,
      shortDescription: toolsTable.shortDescription,
      icon: toolsTable.icon,
      requiredEntitlement: toolsTable.requiredEntitlement,
      sortOrder: toolsTable.sortOrder,
    })
    .from(toolsTable)
    .where(ne(toolsTable.status, "coming_soon"))
    .orderBy(toolsTable.sortOrder);

  if (activeTools.length > 0) {
    const appsGroupId = await upsertGroup(
      "Apps & Tools",
      "Help with the software, tools, and apps included in your membership.",
      "Settings",
      3,
    );

    for (const tool of activeTools) {
      const upgradeSlug = ENTITLEMENT_TO_UPGRADE[tool.requiredEntitlement] ?? null;
      const upgradeProductId = await resolveProduct(upgradeSlug);
      await upsertCard(
        appsGroupId,
        tool.name,
        tool.shortDescription,
        tool.icon,
        tool.requiredEntitlement,
        upgradeProductId,
        tool.sortOrder,
      );
    }

    console.log(`[seed-assistant-cards]   Apps & Tools: ${activeTools.length} tool cards derived from toolsTable.`);
  }

  // 3. Knowledge Base Topics — one card per distinct KB category found in
  //    knowledgebaseDocsTable. As the team publishes new KB categories the seed
  //    will pick them up on re-deploy.
  const KB_CATEGORY_META: Record<string, { label: string; description: string; icon: string }> = {
    faq:               { label: "FAQ",               description: "Answers to frequently asked questions about BTS and affiliate marketing.",          icon: "HelpCircle"    },
    platform_guide:    { label: "Platform Guide",    description: "Step-by-step guides for using the BTS Member Portal and its features.",            icon: "BookOpen"      },
    marketing:         { label: "Marketing",         description: "Strategies and tactics for affiliate marketing campaigns and ad creatives.",        icon: "Megaphone"     },
    compliance:        { label: "Compliance",        description: "Compliance rules, ad policies, and how to stay within publisher guidelines.",      icon: "ShieldCheck"   },
    advanced_strategy: { label: "Advanced Strategy", description: "Advanced techniques for scaling campaigns and maximizing revenue.",                 icon: "TrendingUp"    },
    troubleshooting:   { label: "Troubleshooting",   description: "Solutions for common issues, errors, and technical problems.",                     icon: "Wrench"        },
  };

  const kbCategoryRows = await db
    .selectDistinct({ category: knowledgebaseDocsTable.category })
    .from(knowledgebaseDocsTable)
    .orderBy(knowledgebaseDocsTable.category);

  if (kbCategoryRows.length > 0) {
    const kbGroupId = await upsertGroup(
      "Knowledge Base Topics",
      "Browse curated questions by topic from the BTS knowledge base.",
      "Database",
      4,
    );

    for (let i = 0; i < kbCategoryRows.length; i++) {
      const cat = kbCategoryRows[i].category;
      const meta = KB_CATEGORY_META[cat] ?? {
        label: cat.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
        description: `Questions and answers sourced from the "${cat}" knowledge base category.`,
        icon: "Database",
      };

      await upsertCard(
        kbGroupId,
        meta.label,
        meta.description,
        meta.icon,
        null,
        null,
        i,
      );
    }

    console.log(`[seed-assistant-cards]   Knowledge Base Topics: ${kbCategoryRows.length} category cards derived from knowledgebaseDocsTable.`);
  }

  const totalStaticCards = STATIC_GROUPS.reduce((sum, g) => sum + g.cards.length, 0);
  console.log(
    `[seed-assistant-cards] Done. ${STATIC_GROUPS.length} static groups (${totalStaticCards} cards), ` +
    `${activeTools?.length ?? 0} tool cards, ` +
    `${kbCategoryRows?.length ?? 0} KB topic cards. ` +
    `Existing rows were skipped (idempotent).`,
  );
}
