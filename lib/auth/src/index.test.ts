import { describe, expect, it } from "vitest";
import {
  ADMIN_ROLES,
  COACH_ROLE,
  PERMISSION_MATRIX,
  getPermissionsForRole,
  hasPermission,
  isAdminRole,
  isCoachRole,
  type AdminRole,
  type Permission,
} from "./index.js";

const EXPECTED_PERMISSIONS_BY_ROLE: Record<AdminRole, Permission[]> = {
  super_admin: [
    "dashboard:view",
    "members:view",
    "members:edit",
    "members:impersonate",
    "members:assign_role",
    "members:pii",
    "tickets:view",
    "tickets:manage",
    "content:view",
    "content:manage",
    "community:view",
    "community:moderate",
    "coaching:view",
    "coaching:manage",
    "commissions:view",
    "commissions:manage",
    "chat:view",
    "chat:manage",
    "communications:view",
    "communications:manage",
    "audit:view",
    "settings:view",
    "settings:manage",
    "system:view",
    "revenue:view",
    "export:data",
    "ghl:view",
    "ghl:manage",
    "wins:view",
    "wins:manage",
    "vault:view",
    "vault:manage",
    "api_keys:view",
    "api_keys:manage",
    "notifications:view",
    "apps:manage",
    "apps:support",
  ],
  admin: [
    "dashboard:view",
    "members:view",
    "members:edit",
    "members:pii",
    "tickets:view",
    "tickets:manage",
    "content:view",
    "content:manage",
    "community:view",
    "community:moderate",
    "coaching:view",
    "coaching:manage",
    "commissions:view",
    "commissions:manage",
    "chat:view",
    "chat:manage",
    "communications:view",
    "communications:manage",
    "audit:view",
    "settings:view",
    "system:view",
    "revenue:view",
    "export:data",
    "ghl:view",
    "ghl:manage",
    "wins:view",
    "wins:manage",
    "vault:view",
    "vault:manage",
    "api_keys:view",
    "notifications:view",
    "apps:manage",
    "apps:support",
  ],
  support_agent: [
    "dashboard:view",
    "members:view",
    "members:pii",
    "tickets:view",
    "tickets:manage",
    "notifications:view",
    "apps:support",
  ],
  content_manager: [
    "dashboard:view",
    "content:view",
    "content:manage",
    "community:view",
    "community:moderate",
    "wins:view",
    "wins:manage",
    "vault:view",
    "vault:manage",
    "notifications:view",
  ],
  // Read-only audit reviewer. The whole point of this role is the
  // combination it does NOT hold: audit:view WITHOUT members:pii.
  // Adding it here is what wires the per-role exhaustive checks below
  // (every permission outside this list must return false for the role)
  // — so if anyone ever ticks members:pii or members:view onto
  // compliance_reviewer in the matrix, this test fails immediately.
  compliance_reviewer: [
    "dashboard:view",
    "audit:view",
    "notifications:view",
  ],
};

describe("ADMIN_ROLES", () => {
  it("contains exactly the five known admin roles", () => {
    expect([...ADMIN_ROLES]).toEqual([
      "super_admin",
      "admin",
      "support_agent",
      "content_manager",
      "compliance_reviewer",
    ]);
  });
});

describe("isAdminRole", () => {
  it.each(ADMIN_ROLES)("returns true for known admin role %s", (role) => {
    expect(isAdminRole(role)).toBe(true);
  });

  it.each([
    "member",
    "user",
    "guest",
    "SUPER_ADMIN",
    "Admin",
    "",
    " ",
    "supportagent",
  ])("returns false for non-admin value %p", (value) => {
    expect(isAdminRole(value)).toBe(false);
  });

  it("returns false for null and undefined", () => {
    expect(isAdminRole(null)).toBe(false);
    expect(isAdminRole(undefined)).toBe(false);
  });
});

describe("coach role", () => {
  it("exposes the coach role as the literal 'coach'", () => {
    expect(COACH_ROLE).toBe("coach");
  });

  it("isCoachRole returns true only for the coach role", () => {
    expect(isCoachRole("coach")).toBe(true);
    expect(isCoachRole(COACH_ROLE)).toBe(true);
  });

  it("isCoachRole returns false for members, admins, and junk", () => {
    expect(isCoachRole("member")).toBe(false);
    expect(isCoachRole("free_member")).toBe(false);
    expect(isCoachRole("super_admin")).toBe(false);
    expect(isCoachRole("Coach")).toBe(false);
    expect(isCoachRole("")).toBe(false);
    expect(isCoachRole(null)).toBe(false);
    expect(isCoachRole(undefined)).toBe(false);
  });

  it("coach is NOT an admin role and holds no admin permissions", () => {
    expect(isAdminRole(COACH_ROLE)).toBe(false);
    expect(hasPermission(COACH_ROLE, "community:moderate")).toBe(false);
    expect(hasPermission(COACH_ROLE, "members:view")).toBe(false);
    expect(hasPermission(COACH_ROLE, "dashboard:view")).toBe(false);
  });
});

describe("hasPermission", () => {
  it("returns false for non-admin roles regardless of permission", () => {
    expect(hasPermission("member", "dashboard:view")).toBe(false);
    expect(hasPermission(null, "dashboard:view")).toBe(false);
    expect(hasPermission(undefined, "settings:manage")).toBe(false);
    expect(hasPermission("", "members:view")).toBe(false);
  });

  it("returns true when the role appears in the permission's allowlist", () => {
    expect(hasPermission("super_admin", "settings:manage")).toBe(true);
    expect(hasPermission("admin", "members:edit")).toBe(true);
    expect(hasPermission("support_agent", "tickets:manage")).toBe(true);
    expect(hasPermission("content_manager", "content:manage")).toBe(true);
  });

  it("returns false when the role is not in the permission's allowlist", () => {
    expect(hasPermission("admin", "settings:manage")).toBe(false);
    expect(hasPermission("admin", "members:impersonate")).toBe(false);
    expect(hasPermission("admin", "api_keys:manage")).toBe(false);
    expect(hasPermission("support_agent", "members:edit")).toBe(false);
    expect(hasPermission("support_agent", "content:manage")).toBe(false);
    expect(hasPermission("content_manager", "members:view")).toBe(false);
    expect(hasPermission("content_manager", "tickets:manage")).toBe(false);
  });

  it("only super_admin has settings:manage", () => {
    expect(hasPermission("super_admin", "settings:manage")).toBe(true);
    expect(hasPermission("admin", "settings:manage")).toBe(false);
    expect(hasPermission("support_agent", "settings:manage")).toBe(false);
    expect(hasPermission("content_manager", "settings:manage")).toBe(false);
  });

  it("only super_admin has members:impersonate", () => {
    expect(hasPermission("super_admin", "members:impersonate")).toBe(true);
    expect(hasPermission("admin", "members:impersonate")).toBe(false);
    expect(hasPermission("support_agent", "members:impersonate")).toBe(false);
    expect(hasPermission("content_manager", "members:impersonate")).toBe(false);
  });

  it("only super_admin has api_keys:manage", () => {
    expect(hasPermission("super_admin", "api_keys:manage")).toBe(true);
    expect(hasPermission("admin", "api_keys:manage")).toBe(false);
    expect(hasPermission("support_agent", "api_keys:manage")).toBe(false);
    expect(hasPermission("content_manager", "api_keys:manage")).toBe(false);
    expect(hasPermission("compliance_reviewer", "api_keys:manage")).toBe(false);
  });

  it("only super_admin has members:assign_role", () => {
    expect(hasPermission("super_admin", "members:assign_role")).toBe(true);
    expect(hasPermission("admin", "members:assign_role")).toBe(false);
    expect(hasPermission("support_agent", "members:assign_role")).toBe(false);
    expect(hasPermission("content_manager", "members:assign_role")).toBe(false);
    expect(hasPermission("compliance_reviewer", "members:assign_role")).toBe(false);
  });

  it("dashboard:view and notifications:view are available to every admin role", () => {
    for (const role of ADMIN_ROLES) {
      expect(hasPermission(role, "dashboard:view")).toBe(true);
      expect(hasPermission(role, "notifications:view")).toBe(true);
    }
  });

  it("compliance_reviewer can view audit log but cannot see member PII", () => {
    expect(hasPermission("compliance_reviewer", "audit:view")).toBe(true);
    expect(hasPermission("compliance_reviewer", "members:pii")).toBe(false);
    expect(hasPermission("compliance_reviewer", "members:view")).toBe(false);
    expect(hasPermission("compliance_reviewer", "members:edit")).toBe(false);
    expect(hasPermission("compliance_reviewer", "members:impersonate")).toBe(false);
    expect(hasPermission("compliance_reviewer", "tickets:view")).toBe(false);
    expect(hasPermission("compliance_reviewer", "settings:view")).toBe(false);
    expect(hasPermission("compliance_reviewer", "settings:manage")).toBe(false);
    expect(hasPermission("compliance_reviewer", "export:data")).toBe(false);
    expect(hasPermission("compliance_reviewer", "system:view")).toBe(false);
  });
});

describe("getPermissionsForRole", () => {
  it.each(ADMIN_ROLES)(
    "returns the exact expected permission set for %s",
    (role) => {
      const expected = EXPECTED_PERMISSIONS_BY_ROLE[role];
      const actual = getPermissionsForRole(role);
      expect([...actual].sort()).toEqual([...expected].sort());
    },
  );

  it("returned permissions are consistent with hasPermission", () => {
    for (const role of ADMIN_ROLES) {
      const perms = getPermissionsForRole(role);
      for (const perm of perms) {
        expect(hasPermission(role, perm)).toBe(true);
      }
      const allPerms = Object.keys(PERMISSION_MATRIX) as Permission[];
      const missing = allPerms.filter((p) => !perms.includes(p));
      for (const perm of missing) {
        expect(hasPermission(role, perm)).toBe(false);
      }
    }
  });

  it("super_admin has every permission in the matrix", () => {
    const superPerms = getPermissionsForRole("super_admin");
    const allPerms = Object.keys(PERMISSION_MATRIX) as Permission[];
    expect([...superPerms].sort()).toEqual([...allPerms].sort());
  });
});

describe("PERMISSION_MATRIX snapshot", () => {
  it("matches the locked-in role-to-permission mapping", () => {
    expect(PERMISSION_MATRIX).toMatchInlineSnapshot(`
      {
        "api_keys:manage": [
          "super_admin",
        ],
        "api_keys:view": [
          "super_admin",
          "admin",
        ],
        "apps:manage": [
          "super_admin",
          "admin",
        ],
        "apps:support": [
          "super_admin",
          "admin",
          "support_agent",
        ],
        "audit:view": [
          "super_admin",
          "admin",
          "compliance_reviewer",
        ],
        "chat:manage": [
          "super_admin",
          "admin",
        ],
        "chat:view": [
          "super_admin",
          "admin",
        ],
        "coaching:manage": [
          "super_admin",
          "admin",
        ],
        "coaching:view": [
          "super_admin",
          "admin",
        ],
        "commissions:manage": [
          "super_admin",
          "admin",
        ],
        "commissions:view": [
          "super_admin",
          "admin",
        ],
        "communications:manage": [
          "super_admin",
          "admin",
        ],
        "communications:view": [
          "super_admin",
          "admin",
        ],
        "community:moderate": [
          "super_admin",
          "admin",
          "content_manager",
        ],
        "community:view": [
          "super_admin",
          "admin",
          "content_manager",
        ],
        "content:manage": [
          "super_admin",
          "admin",
          "content_manager",
        ],
        "content:view": [
          "super_admin",
          "admin",
          "content_manager",
        ],
        "dashboard:view": [
          "super_admin",
          "admin",
          "support_agent",
          "content_manager",
          "compliance_reviewer",
        ],
        "export:data": [
          "super_admin",
          "admin",
        ],
        "ghl:manage": [
          "super_admin",
          "admin",
        ],
        "ghl:view": [
          "super_admin",
          "admin",
        ],
        "members:assign_role": [
          "super_admin",
        ],
        "members:edit": [
          "super_admin",
          "admin",
        ],
        "members:impersonate": [
          "super_admin",
        ],
        "members:pii": [
          "super_admin",
          "admin",
          "support_agent",
        ],
        "members:view": [
          "super_admin",
          "admin",
          "support_agent",
        ],
        "notifications:view": [
          "super_admin",
          "admin",
          "support_agent",
          "content_manager",
          "compliance_reviewer",
        ],
        "revenue:view": [
          "super_admin",
          "admin",
        ],
        "settings:manage": [
          "super_admin",
        ],
        "settings:view": [
          "super_admin",
          "admin",
        ],
        "system:view": [
          "super_admin",
          "admin",
        ],
        "tickets:manage": [
          "super_admin",
          "admin",
          "support_agent",
        ],
        "tickets:view": [
          "super_admin",
          "admin",
          "support_agent",
        ],
        "vault:manage": [
          "super_admin",
          "admin",
          "content_manager",
        ],
        "vault:view": [
          "super_admin",
          "admin",
          "content_manager",
        ],
        "wins:manage": [
          "super_admin",
          "admin",
          "content_manager",
        ],
        "wins:view": [
          "super_admin",
          "admin",
          "content_manager",
        ],
      }
    `);
  });
});
