export type AdminRole = "super_admin" | "admin" | "support_agent" | "content_manager";

export const ADMIN_ROLES: AdminRole[] = [
  "super_admin",
  "admin",
  "support_agent",
  "content_manager",
];

export const PERMISSION_MATRIX: Record<string, AdminRole[]> = {
  "dashboard:view": ["super_admin", "admin", "support_agent", "content_manager"],
  "members:view": ["super_admin", "admin", "support_agent"],
  "members:edit": ["super_admin", "admin"],
  "members:impersonate": ["super_admin"],
  "tickets:view": ["super_admin", "admin", "support_agent"],
  "tickets:manage": ["super_admin", "admin", "support_agent"],
  "content:view": ["super_admin", "admin", "content_manager"],
  "content:manage": ["super_admin", "admin", "content_manager"],
  "community:view": ["super_admin", "admin", "content_manager"],
  "community:moderate": ["super_admin", "admin", "content_manager"],
  "coaching:view": ["super_admin", "admin"],
  "coaching:manage": ["super_admin", "admin"],
  "commissions:view": ["super_admin", "admin"],
  "commissions:manage": ["super_admin", "admin"],
  "chat:view": ["super_admin", "admin"],
  "chat:manage": ["super_admin", "admin"],
  "communications:view": ["super_admin", "admin"],
  "communications:manage": ["super_admin", "admin"],
  "audit:view": ["super_admin", "admin"],
  "settings:view": ["super_admin", "admin"],
  "settings:manage": ["super_admin"],
  "system:view": ["super_admin", "admin"],
  "export:data": ["super_admin", "admin"],
  "ghl:view": ["super_admin", "admin"],
  "ghl:manage": ["super_admin", "admin"],
  "wins:view": ["super_admin", "admin", "content_manager"],
  "wins:manage": ["super_admin", "admin", "content_manager"],
  "vault:view": ["super_admin", "admin", "content_manager"],
  "vault:manage": ["super_admin", "admin", "content_manager"],
  "api_keys:view": ["super_admin", "admin"],
  "api_keys:manage": ["super_admin"],
  "notifications:view": ["super_admin", "admin", "support_agent", "content_manager"],
  "apps:manage": ["super_admin", "admin"],
};

export function isAdminRole(role: string | undefined | null): role is AdminRole {
  return !!role && ADMIN_ROLES.includes(role as AdminRole);
}

export function hasPermission(
  role: string | undefined | null,
  permission: string,
): boolean {
  if (!isAdminRole(role)) return false;
  const allowedRoles = PERMISSION_MATRIX[permission];
  if (!allowedRoles) return false;
  return allowedRoles.includes(role);
}
