import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import { db, usersTable } from "@workspace/db";
import { inArray } from "drizzle-orm";

import {
  PERMISSION_MATRIX as API_PERMISSION_MATRIX,
  type AdminRole,
} from "../middleware/rbac";
// Cross-artifact import: portal's PERMISSION_MATRIX is the contract the
// member-portal UI promises. We import it directly (it is a plain TS module
// with no React/Vite imports) so this test fails the moment the API gates
// drift away from what the portal exposes — which is the entire reason this
// test exists. The portal lives outside this package's rootDir so TS would
// reject the import; @ts-ignore is intentional and scoped to the import.
// @ts-ignore -- intentional cross-artifact import; resolved by vitest at runtime.
import { PERMISSION_MATRIX as PORTAL_PERMISSION_MATRIX } from "../../../portal/src/lib/permissions";
import { buildTestAppWithRouters } from "./test-app";

import adminPanelRouter from "../routes/admin-panel";
import adminTicketsRouter from "../routes/admin-tickets";
import adminTracksRouter from "../routes/admin-tracks";
import adminCommunityRouter from "../routes/admin-community";
import adminCoachingRouter from "../routes/admin-coaching";
import adminCommissionsRouter from "../routes/admin-commissions";
import adminChatRouter from "../routes/admin-chat";
import adminCommunicationsRouter from "../routes/admin-communications";
import adminGhlRouter from "../routes/admin-ghl";
import adminWinsRouter from "../routes/admin-wins";
import adminVaultRouter from "../routes/admin-vault";
import adminApiKeysRouter from "../routes/admin-api-keys";
import adminAppsRouter from "../routes/admin-apps";
import adminRevenueRouter from "../routes/admin-revenue";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";

const ADMIN_ROLES: AdminRole[] = [
  "super_admin",
  "admin",
  "support_agent",
  "content_manager",
];

interface SeededAdmin {
  id: number;
  email: string;
  role: AdminRole;
  cookie: string;
}

const TEST_TAG = `rbac-test-${randomUUID().slice(0, 8)}`;
const seededUserIds: number[] = [];
const adminsByRole: Record<AdminRole, SeededAdmin> = {} as Record<
  AdminRole,
  SeededAdmin
>;

let app: ReturnType<typeof buildTestAppWithRouters>;

function signCookie(userId: number, email: string): string {
  const token = jwt.sign({ userId, email }, JWT_SECRET, { expiresIn: "1h" });
  return `access_token=${token}`;
}

async function seedAdmin(role: AdminRole): Promise<SeededAdmin> {
  const email = `${TEST_TAG}-${role}@example.test`;
  const passwordHash = await bcrypt.hash("irrelevant-test-password", 4);
  const [row] = await db
    .insert(usersTable)
    .values({
      email,
      name: `Test ${role}`,
      passwordHash,
      role,
      sourceProduct: "lifetime",
      emailVerified: true,
      onboardingComplete: true,
    })
    .returning({ id: usersTable.id });
  seededUserIds.push(row.id);
  return { id: row.id, email, role, cookie: signCookie(row.id, email) };
}

beforeAll(async () => {
  app = buildTestAppWithRouters([
    adminPanelRouter,
    adminTicketsRouter,
    adminTracksRouter,
    adminCommunityRouter,
    adminCoachingRouter,
    adminCommissionsRouter,
    adminChatRouter,
    adminCommunicationsRouter,
    adminGhlRouter,
    adminWinsRouter,
    adminVaultRouter,
    adminApiKeysRouter,
    adminAppsRouter,
    adminRevenueRouter,
  ]);

  for (const role of ADMIN_ROLES) {
    adminsByRole[role] = await seedAdmin(role);
  }
});

afterAll(async () => {
  if (seededUserIds.length > 0) {
    await db.delete(usersTable).where(inArray(usersTable.id, seededUserIds));
  }
});

// ---------------------------------------------------------------------------
// Parity: the portal PERMISSION_MATRIX is the contract this test enforces.
// The API matrix MUST mirror it. If a future edit moves either side out of
// sync, the parity tests below fail before any per-endpoint test even runs.
// ---------------------------------------------------------------------------

function sortRoles(roles: AdminRole[] | undefined): AdminRole[] {
  return [...(roles ?? [])].sort();
}

describe("Admin RBAC: portal <-> API permission matrix parity", () => {
  it("API and portal matrices expose the same set of permission keys", () => {
    const apiKeys = Object.keys(API_PERMISSION_MATRIX).sort();
    const portalKeys = Object.keys(PORTAL_PERMISSION_MATRIX).sort();
    expect(apiKeys).toEqual(portalKeys);
  });

  for (const permission of Object.keys(PORTAL_PERMISSION_MATRIX).sort()) {
    it(`grants the same roles for ${permission} on both sides`, () => {
      expect(sortRoles(API_PERMISSION_MATRIX[permission])).toEqual(
        sortRoles(PORTAL_PERMISSION_MATRIX[permission]),
      );
    });
  }
});

// ---------------------------------------------------------------------------
// Per-resource RBAC matrix.
//
// One representative GET per resource. The expected allow/deny for each role
// is sourced from the **portal** matrix (the public contract), NOT from the
// API matrix — that way drift introduced on either side is caught here. Only
// "view"-style endpoints are used so the assertions don't depend on
// data-mutation side effects. Each handler reads the database (and
// gracefully degrades when external services like Redis are unavailable),
// so a permitted role always sees 2xx and never 403.
// ---------------------------------------------------------------------------

interface RbacCase {
  resource: string;
  permission: string;
  buildPath: () => string;
}

function rbacCases(): RbacCase[] {
  return [
    {
      resource: "dashboard",
      permission: "dashboard:view",
      buildPath: () => "/api/admin/dashboard/kpis",
    },
    {
      resource: "members",
      permission: "members:view",
      buildPath: () => "/api/admin/products",
    },
    {
      resource: "tickets",
      permission: "tickets:view",
      buildPath: () => "/api/admin/canned-responses",
    },
    {
      resource: "content",
      permission: "content:view",
      buildPath: () => "/api/admin/tracks",
    },
    {
      resource: "community",
      permission: "community:view",
      buildPath: () => "/api/admin/community/categories",
    },
    {
      resource: "coaching",
      permission: "coaching:view",
      buildPath: () => "/api/admin/coaching/coaches",
    },
    {
      resource: "commissions",
      permission: "commissions:view",
      buildPath: () => "/api/admin/commissions/rates",
    },
    {
      resource: "chat",
      permission: "chat:view",
      buildPath: () => "/api/admin/chat/system-prompts",
    },
    {
      resource: "communications",
      permission: "communications:view",
      buildPath: () => "/api/admin/communications/email-templates",
    },
    {
      resource: "audit",
      permission: "audit:view",
      buildPath: () => "/api/admin/audit-log",
    },
    {
      resource: "settings",
      permission: "settings:view",
      buildPath: () => "/api/admin/settings",
    },
    {
      resource: "system",
      permission: "system:view",
      buildPath: () => "/api/admin/system/health",
    },
    {
      resource: "ghl",
      permission: "ghl:view",
      buildPath: () => "/api/admin/ghl/status",
    },
    {
      resource: "wins",
      permission: "wins:view",
      buildPath: () => "/api/admin/wins",
    },
    {
      resource: "vault",
      permission: "vault:view",
      buildPath: () => "/api/admin/vault/collections",
    },
    {
      resource: "api_keys",
      permission: "api_keys:view",
      buildPath: () => "/api/admin/api-keys",
    },
    {
      resource: "notifications",
      permission: "notifications:view",
      buildPath: () => "/api/admin/notifications",
    },
    {
      resource: "apps_manage",
      permission: "apps:manage",
      buildPath: () => "/api/admin/apps-manager",
    },
    {
      resource: "apps_support",
      permission: "apps:support",
      // Looking up an existing seeded admin is enough — the route returns 200
      // with status="not_installed" when the user has no Flexy install.
      buildPath: () => `/api/admin/apps/flexy/lookup/${adminsByRole.super_admin.id}`,
    },
    {
      resource: "revenue",
      permission: "revenue:view",
      buildPath: () => "/api/admin/revenue/overview",
    },
  ];
}

describe("Admin RBAC: per-role endpoint access", () => {
  it("requires authentication for every gated admin endpoint (no cookie -> 401)", async () => {
    for (const { resource, buildPath } of rbacCases()) {
      const res = await request(app).get(buildPath());
      expect(
        res.status,
        `Resource ${resource} (${buildPath()}) should require auth`,
      ).toBe(401);
    }
  });

  it("rejects non-admin (member) users with 403 on every gated admin endpoint", async () => {
    const memberEmail = `${TEST_TAG}-member@example.test`;
    const passwordHash = await bcrypt.hash("irrelevant-test-password", 4);
    const [member] = await db
      .insert(usersTable)
      .values({
        email: memberEmail,
        name: "Test Member",
        passwordHash,
        role: "member",
        sourceProduct: "lifetime",
        emailVerified: true,
        onboardingComplete: true,
      })
      .returning({ id: usersTable.id });
    seededUserIds.push(member.id);
    const cookie = signCookie(member.id, memberEmail);

    for (const { resource, buildPath } of rbacCases()) {
      const res = await request(app).get(buildPath()).set("Cookie", cookie);
      expect(
        res.status,
        `Resource ${resource} (${buildPath()}) should reject member with 403`,
      ).toBe(403);
    }
  });

  for (const role of ADMIN_ROLES) {
    describe(`role: ${role}`, () => {
      for (const testCase of rbacCases()) {
        // Source of truth: portal matrix (what the user-facing UI promises).
        const allowedRoles = PORTAL_PERMISSION_MATRIX[testCase.permission] ?? [];
        const isAllowed = allowedRoles.includes(role);
        const label = `${testCase.resource} (${testCase.permission}) -> ${
          isAllowed ? "allowed (2xx)" : "forbidden (403)"
        }`;

        it(label, async () => {
          const admin = adminsByRole[role];
          const res = await request(app)
            .get(testCase.buildPath())
            .set("Cookie", admin.cookie);

          if (isAllowed) {
            // Permission middleware must let the request through. Each handler
            // is a simple read that returns 2xx on success; a 403 here would
            // mean the role was wrongly locked out of a permitted resource.
            expect(
              res.status,
              `Role ${role} should be permitted on ${testCase.resource} ` +
                `(${testCase.buildPath()}). Got ${res.status}: ${JSON.stringify(
                  res.body,
                )}`,
            ).toBeGreaterThanOrEqual(200);
            expect(res.status).toBeLessThan(300);
          } else {
            expect(
              res.status,
              `Role ${role} should be denied on ${testCase.resource} ` +
                `(${testCase.buildPath()}). Got ${res.status}: ${JSON.stringify(
                  res.body,
                )}`,
            ).toBe(403);
          }
        });
      }
    });
  }
});
