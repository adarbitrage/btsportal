import type { ComponentType } from "react";
import { hasPermission, isAdminRole, isCoachRole, type Permission } from "@workspace/auth";
import { MAPPABLE_PRODUCTS } from "@workspace/content-access-registry";

export type NavIcon = ComponentType<{ className?: string }>;

export interface NavLeaf {
  kind: "leaf";
  href: string;
  label: string;
  icon: NavIcon;
  requiredEntitlement?: string;
  requiredPermission?: Permission;
  showNotificationBadge?: boolean;
  showModerationBadge?: boolean;
  hiddenForRoles?: string[];
  /**
   * When set, this nav item is hidden for members who lack access to the
   * given content page key (admin/coach bypass applies).
   * Must match a key from the shared GATEABLE_PAGES registry.
   */
  contentPageKey?: string;
  /**
   * When set, this nav item is only shown to members holding an ACTIVE grant
   * of at least one of the listed product slugs ("Your Purchases" ownership
   * gating). Admin/coach bypass applies, like the other member-only filters.
   * Keep the slug lists code-owned (see PURCHASE_OWNER_SLUGS) so labels and
   * ownership rules stay consistent.
   */
  ownedProductSlugs?: readonly string[];
}

export interface NavFolder {
  kind: "folder";
  storageKey: string;
  label: string;
  icon: NavIcon;
  defaultOpen?: boolean;
  children: NavNode[];
}

export type NavNode = NavLeaf | NavFolder;

export function hasEntitlementCheck(
  requiredEntitlement: string | undefined,
  entitlements: Set<string>,
): boolean {
  if (!requiredEntitlement) return true;
  if (requiredEntitlement.endsWith(":*")) {
    const prefix = requiredEntitlement.replace(":*", ":");
    return Array.from(entitlements).some((e: string) => e.startsWith(prefix));
  }
  return entitlements.has(requiredEntitlement);
}

export function leafVisibleToRole(
  leaf: NavLeaf,
  role: string | undefined,
): boolean {
  if (!leaf.requiredPermission) return true;
  if (!isAdminRole(role)) return false;
  return hasPermission(role, leaf.requiredPermission);
}

export function filterNavByRole(
  nodes: NavNode[],
  role: string | undefined,
): NavNode[] {
  const result: NavNode[] = [];
  for (const node of nodes) {
    if (node.kind === "leaf") {
      if (leafVisibleToRole(node, role)) result.push(node);
      continue;
    }
    const filteredChildren = filterNavByRole(node.children, role);
    if (filteredChildren.length === 0) continue;
    result.push({ ...node, children: filteredChildren });
  }
  return result;
}

export function filterNavByEntitlements(
  nodes: NavNode[],
  entitlements: Set<string>,
  bypassEntitlements = false,
): NavNode[] {
  const result: NavNode[] = [];
  for (const node of nodes) {
    if (node.kind === "leaf") {
      if (
        bypassEntitlements ||
        hasEntitlementCheck(node.requiredEntitlement, entitlements)
      )
        result.push(node);
      continue;
    }
    const filteredChildren = filterNavByEntitlements(
      node.children,
      entitlements,
      bypassEntitlements,
    );
    if (filteredChildren.length === 0) continue;
    result.push({ ...node, children: filteredChildren });
  }
  return result;
}

/**
 * Drops nav items whose `contentPageKey` is not in `accessiblePageKeys`.
 * Admin and coach users bypass this filter entirely.
 * Items without a `contentPageKey` are always shown.
 */
// ── "Your Purchases" ownership gating ────────────────────────────────────────

const MENTORSHIP_SLUGS: readonly string[] = MAPPABLE_PRODUCTS.filter(
  (p) => p.group === "mentorship",
).map((p) => p.slug);

const FRONTEND_SLUGS: readonly string[] = MAPPABLE_PRODUCTS.filter(
  (p) => p.group === "frontend",
).map((p) => p.slug);

/**
 * Code-owned ownership map for the "Your Purchases" sidebar folder: which
 * product grants entitle a member to see each purchases entry. Mentorship
 * tiers include the core front-end training, so every mentorship slug counts
 * as an owner of both entries (preserving today's visibility for tier
 * members); labels stay fixed here, never free-text from the API.
 */
export const PURCHASE_OWNER_SLUGS = {
  /** "Your Second Engine" — the front-end offer's Seven Pillars training. */
  yourSecondEngine: [...FRONTEND_SLUGS, ...MENTORSHIP_SLUGS] as readonly string[],
  /** "The Blitz™" — the 21-Day Blitz funnel offer / mentorship curriculum. */
  blitz: ["yse_21_day_blitz", ...MENTORSHIP_SLUGS] as readonly string[],
} as const;

export interface OwnedProductLike {
  productSlug: string;
  status: string;
  expiresAt?: string | Date | null;
}

/** Slugs of the member's ACTIVE, unexpired product grants. */
export function getActiveOwnedProductSlugs(
  products: readonly OwnedProductLike[] | undefined,
  now: number = Date.now(),
): Set<string> {
  const out = new Set<string>();
  for (const p of products ?? []) {
    if (p.status !== "active") continue;
    if (p.expiresAt && new Date(p.expiresAt).getTime() <= now) continue;
    out.add(p.productSlug);
  }
  return out;
}

/**
 * Drops leaves whose `ownedProductSlugs` has no overlap with the member's
 * active grants. Admin/coach users bypass (same as the other filters).
 * Leaves without `ownedProductSlugs` are always shown; empty folders vanish.
 */
export function filterNavByOwnedProducts(
  nodes: NavNode[],
  ownedSlugs: Set<string>,
  bypass = false,
): NavNode[] {
  const result: NavNode[] = [];
  for (const node of nodes) {
    if (node.kind === "leaf") {
      if (
        bypass ||
        !node.ownedProductSlugs ||
        node.ownedProductSlugs.some((slug) => ownedSlugs.has(slug))
      ) {
        result.push(node);
      }
      continue;
    }
    const filteredChildren = filterNavByOwnedProducts(
      node.children,
      ownedSlugs,
      bypass,
    );
    if (filteredChildren.length === 0) continue;
    result.push({ ...node, children: filteredChildren });
  }
  return result;
}

export function filterNavByContentAccess(
  nodes: NavNode[],
  accessiblePageKeys: Set<string>,
  bypass = false,
): NavNode[] {
  const result: NavNode[] = [];
  for (const node of nodes) {
    if (node.kind === "leaf") {
      if (
        bypass ||
        !node.contentPageKey ||
        accessiblePageKeys.has(node.contentPageKey)
      ) {
        result.push(node);
      }
      continue;
    }
    const filteredChildren = filterNavByContentAccess(
      node.children,
      accessiblePageKeys,
      bypass,
    );
    if (filteredChildren.length === 0) continue;
    result.push({ ...node, children: filteredChildren });
  }
  return result;
}

export function filterNavByHiddenRoles(
  nodes: NavNode[],
  userRole: string | undefined,
): NavNode[] {
  const role = userRole ?? "";
  const result: NavNode[] = [];
  for (const node of nodes) {
    if (node.kind === "leaf") {
      if (node.hiddenForRoles && node.hiddenForRoles.includes(role)) continue;
      result.push(node);
      continue;
    }
    const filteredChildren = filterNavByHiddenRoles(node.children, userRole);
    if (filteredChildren.length === 0) continue;
    result.push({ ...node, children: filteredChildren });
  }
  return result;
}

/** storageKey of the "Your Purchases" folder — preserved (not flattened) in front-end-only nav mode. */
export const PURCHASES_FOLDER_STORAGE_KEY = "your-purchases";

/**
 * Front-end-only (funnel buyer) nav mode: reduce the ALREADY-FILTERED member
 * nav to just Welcome, the content-access-gated leaves the member actually
 * passed (i.e. survived filterNavByContentAccess), and Account. The
 * "Your Purchases" folder is PRESERVED as a folder (dropdown) containing its
 * surviving, ownership-filtered children; every other folder is flattened
 * away entirely — no empty shells. Leaves that are neither Welcome/Account
 * nor content-page-gated (AI Assistant, entitlement pitches, etc.) are
 * dropped for this audience.
 *
 * Call this AFTER the standard filter pipeline; it never applies to admins,
 * coaches, or mentorship-tier members (the caller gates on the shared
 * front-end-audience predicate from Landing.tsx).
 */
export function buildFrontendOnlyNav(nodes: NavNode[]): NavNode[] {
  const keepLeaf = (leaf: NavLeaf): boolean =>
    leaf.href === "/" ||
    leaf.href === "/account" ||
    leaf.contentPageKey !== undefined;

  const out: NavNode[] = [];
  const walk = (list: NavNode[]) => {
    for (const node of list) {
      if (node.kind === "folder") {
        if (node.storageKey === PURCHASES_FOLDER_STORAGE_KEY) {
          const children = node.children.filter(
            (c): c is NavLeaf => c.kind === "leaf" && keepLeaf(c),
          );
          if (children.length > 0) out.push({ ...node, children });
          continue;
        }
        walk(node.children);
        continue;
      }
      if (keepLeaf(node)) out.push(node);
    }
  };
  walk(nodes);
  return out;
}

export interface ResolvedAdminRole {
  userRole: string;
  isAdminUser: boolean;
}

export function resolveAdminRole(
  roleFromAuth: string | undefined | null,
  roleFromMember: string | undefined | null,
): ResolvedAdminRole {
  const auth = roleFromAuth ?? "";
  const member = roleFromMember ?? "";
  const authIsAdmin = isAdminRole(auth);
  const memberIsAdmin = isAdminRole(member);
  const userRole = authIsAdmin
    ? auth
    : memberIsAdmin
      ? member
      : auth || member;
  return { userRole, isAdminUser: authIsAdmin || memberIsAdmin };
}

export function leafMatchesLocation(leaf: NavLeaf, location: string): boolean {
  return (
    location === leaf.href ||
    (leaf.href !== "/" && location.startsWith(leaf.href))
  );
}

export function nodeContainsLocation(
  node: NavNode,
  location: string,
): boolean {
  if (node.kind === "leaf") return leafMatchesLocation(node, location);
  return node.children.some((child) => nodeContainsLocation(child, location));
}

/**
 * Segment-boundary prefix match: the location is the href, or a sub-path of it
 * (so "/admin/members" matches "/admin/members/123" but NOT "/administrators").
 */
function hrefBoundaryMatch(href: string, location: string): boolean {
  return location === href || (href !== "/" && location.startsWith(href + "/"));
}

function collectLeafHrefs(nodes: NavNode[]): string[] {
  const out: string[] = [];
  for (const node of nodes) {
    if (node.kind === "leaf") out.push(node.href);
    else out.push(...collectLeafHrefs(node.children));
  }
  return out;
}

/**
 * Pick the single nav leaf to highlight for the current location. A leaf
 * qualifies when the location equals or is a sub-path of its href; when several
 * qualify (e.g. sibling routes "/coaching" and "/coaching/book-session", where
 * one href is a prefix of the other), the MOST SPECIFIC (longest) href wins so
 * only one row lights up.
 */
export function findActiveHref(
  nodes: NavNode[],
  location: string,
): string | null {
  let best: string | null = null;
  for (const href of collectLeafHrefs(nodes)) {
    if (!hrefBoundaryMatch(href, location)) continue;
    if (best === null || href.length > best.length) best = href;
  }
  return best;
}

/** True when the node is, or contains, the leaf whose href is the active one. */
export function nodeContainsActiveHref(
  node: NavNode,
  activeHref: string | null,
): boolean {
  if (activeHref === null) return false;
  if (node.kind === "leaf") return node.href === activeHref;
  return node.children.some((child) => nodeContainsActiveHref(child, activeHref));
}

export const PRODUCT_DISPLAY_NAMES: Record<string, string> = {
  frontend: "Front-End Member",
  launchpad: "LaunchPad Member",
  "3month": "3-Month Mentorship",
  "6month": "6-Month Mentorship",
  "1year": "1-Year Mentorship",
  lifetime: "Lifetime Member",
  free: "Free Member",
};

export function getProductDisplayName(slug: string | undefined | null): string {
  const resolved = slug ?? "free";
  return PRODUCT_DISPLAY_NAMES[resolved] ?? resolved;
}

export function isLifetimeSlug(slug: string | undefined | null): boolean {
  return (slug ?? "free") === "lifetime";
}

export function getStaffLabel(userRole: string | undefined | null): string {
  return userRole === "super_admin" ? "Super Admin" : "Admin";
}

export function getSidebarTierLabel(params: {
  isAdminUser: boolean;
  userRole: string | undefined | null;
  highestProductSlug: string | undefined | null;
}): string {
  if (params.isAdminUser) return getStaffLabel(params.userRole);
  if (isCoachRole(params.userRole)) return "Coach";
  return getProductDisplayName(params.highestProductSlug);
}
