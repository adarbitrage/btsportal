import type { ComponentType } from "react";
import { hasPermission, isAdminRole, type Permission } from "@workspace/auth";

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
  showUnreadBadge?: boolean;
  hiddenForRoles?: string[];
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
  return getProductDisplayName(params.highestProductSlug);
}

export function shouldShowUpgradeCard(isAdminUser: boolean): boolean {
  return !isAdminUser;
}
