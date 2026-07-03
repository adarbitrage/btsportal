export type AdminRole =
  | "super_admin"
  | "admin"
  | "support_agent"
  | "content_manager"
  // Read-only role for security/compliance staff who must investigate admin
  // actions WITHOUT seeing member PII. Holds `audit:view` (so they can read
  // the audit log) but explicitly NOT `members:pii` — every PII-bearing
  // audit row is rebuilt with "redacted" placeholders by the audit-log
  // endpoint before it leaves the server. The existing redaction plumbing
  // (lib/audit-log.ts#redactAuditRowPii, gated on `members:pii` in
  // routes/admin-panel.ts) is the single source of truth — adding this
  // role finally exercises that path in production, since every other
  // role that can see audit rows today also has `members:pii`.
  | "compliance_reviewer";

export const ADMIN_ROLES: readonly AdminRole[] = [
  "super_admin",
  "admin",
  "support_agent",
  "content_manager",
  "compliance_reviewer",
] as const;

export const PERMISSION_MATRIX = {
  "dashboard:view": ["super_admin", "admin", "support_agent", "content_manager", "compliance_reviewer"],
  "members:view": ["super_admin", "admin", "support_agent"],
  "members:edit": ["super_admin", "admin"],
  "members:impersonate": ["super_admin", "admin"],
  // Assigning admin roles to a user is itself a super-power — anyone holding
  // it can grant themselves any other admin role. Restricted to super_admin
  // only, mirroring settings:manage / api_keys:manage.
  "members:assign_role": ["super_admin"],
  // Permission to see member PII (emails, phone numbers, etc.) when surfaced
  // outside the dedicated member views — e.g. in queue-fallback audit-log
  // rows. Granted to the same roles that already see PII via members:view
  // and to super_admin. Roles that lack this permission see "redacted"
  // values while still being able to count/filter the events.
  // NOTE: compliance_reviewer is intentionally absent — that's the whole
  // point of the role.
  "members:pii": ["super_admin", "admin", "support_agent"],
  // Hard-deletion of test/probe member accounts. Deliberately its own
  // permission (not folded into members:edit) and restricted to
  // super_admin only — this is destructive and irreversible, unlike every
  // other members:* action.
  "members:delete": ["super_admin"],
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
  "audit:view": ["super_admin", "admin", "compliance_reviewer"],
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
  "notifications:view": ["super_admin", "admin", "support_agent", "content_manager", "compliance_reviewer"],
  "apps:manage": ["super_admin", "admin"],
  "apps:support": ["super_admin", "admin", "support_agent"],
  // Accountability-partner staff surfaces (mirrors coaching:view/manage).
  // partners:view lets support staff look at partner surfaces without being
  // able to administer the partner program; partners:manage is reserved for
  // full admins.
  "partners:view": ["super_admin", "admin", "support_agent"],
  "partners:manage": ["super_admin", "admin"],
} as const satisfies Record<string, readonly AdminRole[]>;

export type Permission = keyof typeof PERMISSION_MATRIX;

export function isAdminRole(
  role: string | undefined | null,
): role is AdminRole {
  return !!role && (ADMIN_ROLES as readonly string[]).includes(role);
}

// The `coach` role is NOT an admin role — coaches get the full member
// experience (granted by role at the consumer layers, NOT by injecting
// entitlements), plus a coach panel. Single-sourced here so every layer
// (sidebar, route guards, server guards) agrees on what "coach" means.
export const COACH_ROLE = "coach";

export function isCoachRole(role: string | undefined | null): boolean {
  return role === COACH_ROLE;
}

// The `partner` role is NOT an admin role — mirrors the coach role pattern
// exactly. Partners get their OWN /partner/* staff surfaces and NOTHING
// else: no admin panel, no coach surfaces, and critically NO member
// entitlements (unlike coach, which bypasses member content gates by role).
// Partner access stays 100% product-derived at the member-entitlement layer;
// this role only unlocks the dedicated partner staff area.
export const PARTNER_ROLE = "partner";

export function isPartnerRole(role: string | undefined | null): boolean {
  return role === PARTNER_ROLE;
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
