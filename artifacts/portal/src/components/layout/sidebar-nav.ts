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
): NavNode[] {
  const result: NavNode[] = [];
  for (const node of nodes) {
    if (node.kind === "leaf") {
      if (hasEntitlementCheck(node.requiredEntitlement, entitlements))
        result.push(node);
      continue;
    }
    const filteredChildren = filterNavByEntitlements(
      node.children,
      entitlements,
    );
    if (filteredChildren.length === 0) continue;
    result.push({ ...node, children: filteredChildren });
  }
  return result;
}
