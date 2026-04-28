export type AdminRole =
  | "super_admin"
  | "admin"
  | "support_agent"
  | "content_manager";

export const ADMIN_ROLES: readonly AdminRole[] = [
  "super_admin",
  "admin",
  "support_agent",
  "content_manager",
] as const;

export const PERMISSION_MATRIX = {
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
  "revenue:view": ["super_admin", "admin"],
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
  "apps:support": ["super_admin", "admin", "support_agent"],
} as const satisfies Record<string, readonly AdminRole[]>;

export type Permission = keyof typeof PERMISSION_MATRIX;

export function isAdminRole(
  role: string | undefined | null,
): role is AdminRole {
  return !!role && (ADMIN_ROLES as readonly string[]).includes(role);
}

export function hasPermission(
  role: string | undefined | null,
  permission: Permission,
): boolean {
  if (!isAdminRole(role)) return false;
  const allowedRoles = PERMISSION_MATRIX[permission];
  if (!allowedRoles) return false;
  return (allowedRoles as readonly AdminRole[]).includes(role);
}

export function getPermissionsForRole(role: AdminRole): Permission[] {
  return (Object.entries(PERMISSION_MATRIX) as Array<
    [Permission, readonly AdminRole[]]
  >)
    .filter(([, roles]) => roles.includes(role))
    .map(([permission]) => permission);
}
