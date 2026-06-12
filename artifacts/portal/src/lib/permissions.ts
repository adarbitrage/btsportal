export {
  ADMIN_ROLES,
  PERMISSION_MATRIX,
  getPermissionsForRole,
  hasPermission,
  isAdminRole,
} from "@workspace/auth";
export type { AdminRole, Permission } from "@workspace/auth";

import type { AdminRole } from "@workspace/auth";

// Role values selectable in the admin Member Detail role-assignment
// dropdown. Includes the non-admin "member" sentinel so we can render
// it with the same friendly label + impact-summary treatment as the
// admin roles.
export type AssignableRole = AdminRole | "member";

// Human-readable labels and a short impact summary for each role.
// Used by the role-assignment dropdown and its confirmation dialog so
// super-admins can see what they're about to grant (or revoke) before
// any request goes out.
export const ROLE_INFO: Record<AssignableRole, { label: string; impact: string }> = {
  member: {
    label: "Member (no admin access)",
    impact:
      "Removes all admin powers. They will sign in as a regular member only.",
  },
  super_admin: {
    label: "Super Admin (full access)",
    impact:
      "Grants every admin permission, including assigning roles, managing settings and API keys, and impersonating members.",
  },
  admin: {
    label: "Admin",
    impact:
      "Grants admin access across members, content, tickets, audit log, and settings, including impersonating members to view the portal as them — but not role assignment or API key management.",
  },
  support_agent: {
    label: "Support Agent",
    impact:
      "View and manage tickets, view members (including PII) for support work. No content, settings, or audit-log access.",
  },
  content_manager: {
    label: "Content Manager",
    impact:
      "Publish and moderate content, community posts, wins, and the vault. No member, ticket, or settings access.",
  },
  compliance_reviewer: {
    label: "Compliance Reviewer (audit-only)",
    impact:
      "Read-only access to the audit log with member PII redacted. No member-edit, ticket, or content powers.",
  },
};

export function getRoleLabel(role: string): string {
  return (ROLE_INFO as Record<string, { label: string }>)[role]?.label ?? role;
}
