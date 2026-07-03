/**
 * Content Access Registry
 *
 * Single source of truth for:
 *   - The 12 mappable product slugs (front-ends + mentorship ladder)
 *   - The mentorship ladder order
 *   - The gateable page registry (13 pages)
 *
 * This package is side-effect-free (no DB, no network) so it is safe to
 * import in both api-server (Node) and portal (browser/Vite).
 */

// ── Mappable product slugs ────────────────────────────────────────────────────

export interface MappableProduct {
  slug: string;
  group: "frontend" | "mentorship";
  /** Ladder position (mentorship only; undefined for frontend products). */
  ladderOrder?: number;
}

/**
 * The 12 product slugs that admins can use to gate content pages.
 * These are the join key into `products.slug` / `user_products`.
 *
 * Order within each group matches the display order in the admin matrix.
 *
 * `vip` (Task #1660) sits at the top of the mentorship ladder (ladderOrder 6,
 * above lifetime) purely so copy-upward propagation treats it as the
 * highest rung. It carries no content/coaching entitlement keys of its own
 * (`vip:status` only) — matrix checkboxes are the ONLY way any page would
 * ever be gated VIP-specific, and every vip box starts unchecked.
 */
export const MAPPABLE_PRODUCTS: readonly MappableProduct[] = [
  { slug: "yse_front_end",    group: "frontend" },
  { slug: "backroad",         group: "frontend" },
  { slug: "offmarket",        group: "frontend" },
  { slug: "reserve_income",   group: "frontend" },
  { slug: "silent_partner",   group: "frontend" },
  { slug: "test_like_mad",    group: "frontend" },
  { slug: "launchpad",        group: "mentorship", ladderOrder: 1 },
  { slug: "3month",           group: "mentorship", ladderOrder: 2 },
  { slug: "6month",           group: "mentorship", ladderOrder: 3 },
  { slug: "1year",            group: "mentorship", ladderOrder: 4 },
  { slug: "lifetime",         group: "mentorship", ladderOrder: 5 },
  { slug: "vip",              group: "mentorship", ladderOrder: 6 },
] as const;

/** All 12 mappable product slugs as a plain array (for validation). */
export const MAPPABLE_PRODUCT_SLUGS: readonly string[] = MAPPABLE_PRODUCTS.map(
  (p) => p.slug,
);

/** Mentorship ladder from lowest to highest tier (in order). */
export const MENTORSHIP_LADDER_ORDER: readonly string[] = MAPPABLE_PRODUCTS
  .filter((p) => p.group === "mentorship")
  .sort((a, b) => (a.ladderOrder ?? 0) - (b.ladderOrder ?? 0))
  .map((p) => p.slug);

// ── Gateable page registry ────────────────────────────────────────────────────

export interface GateablePage {
  /** Stable key used in the DB and by route guards. Must never change. */
  pageKey: string;
  /** Portal route path (may include param segments like `:id`). */
  routePath: string;
  /** Human-readable label shown in the admin matrix. */
  label: string;
}

/**
 * All 13 gateable pages.
 *
 * Rules:
 *   - `pageKey` values are the stable DB keys referenced by route guards and
 *     sidebar items. Do not change them once deployed.
 *   - No row in `content_access_map` for a given pageKey → page is OPEN.
 *   - Add new pages here to make them administrable; existing behaviour is
 *     unchanged (they start open until an admin checks boxes).
 */
export const GATEABLE_PAGES: readonly GateablePage[] = [
  {
    pageKey: "core-training",
    routePath: "/core-training",
    label: "Core Training (hub)",
  },
  {
    pageKey: "seven-pillars",
    routePath: "/core-training/7-pillars",
    label: "Seven Pillars",
  },
  {
    pageKey: "pillars-to-blitz",
    routePath: "/core-training/pillars-to-blitz",
    label: "Pillars to Blitz",
  },
  {
    pageKey: "quick-start",
    routePath: "/core-training/quick-start",
    label: "Quick Start Guide",
  },
  {
    pageKey: "direct-edge",
    routePath: "/core-training/direct-edge",
    label: "Direct Edge",
  },
  {
    pageKey: "training",
    routePath: "/training",
    label: "Track list",
  },
  {
    pageKey: "training-lesson",
    routePath: "/training/lessons/:id",
    label: "Lesson view (page-level)",
  },
  {
    pageKey: "training-module",
    routePath: "/training/modules/:id",
    label: "Module view (page-level)",
  },
  {
    pageKey: "blitz",
    routePath: "/blitz",
    label: "The Blitz™",
  },
  {
    pageKey: "tips-and-tricks",
    routePath: "/tips-and-tricks",
    label: "Tips & Tricks",
  },
  {
    pageKey: "resource-library",
    routePath: "/resource-library",
    label: "Resource Library",
  },
  {
    pageKey: "knowledge-base",
    routePath: "/knowledge-base",
    label: "Knowledge Base",
  },
  {
    pageKey: "affiliate-networks",
    routePath: "/affiliate-networks",
    label: "Affiliate Networks",
  },
] as const;

/** All page keys as a plain array (for validation). */
export const GATEABLE_PAGE_KEYS: readonly string[] = GATEABLE_PAGES.map(
  (p) => p.pageKey,
);
