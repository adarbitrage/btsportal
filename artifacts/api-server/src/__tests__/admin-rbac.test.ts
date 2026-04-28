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
import adminBulkRouter from "../routes/admin-bulk";
import adminToolsRouter from "../routes/admin-tools";
import adminModulesRouter from "../routes/admin-modules";
import adminLessonsRouter from "../routes/admin-lessons";
import adminResourcesRouter from "../routes/admin-resources";
import adminWebhooksRouter from "../routes/admin-webhooks";
import adminOutgoingWebhooksRouter from "../routes/admin-outgoing-webhooks";
import adminExpirationRouter from "../routes/admin-expiration";

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
    adminBulkRouter,
    adminToolsRouter,
    adminModulesRouter,
    adminLessonsRouter,
    adminResourcesRouter,
    adminWebhooksRouter,
    adminOutgoingWebhooksRouter,
    adminExpirationRouter,
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
    // ----- Per-router coverage for admin-bulk / admin-modules / admin-lessons
    // / admin-resources / admin-tools / admin-webhooks /
    // admin-outgoing-webhooks. Each handler below is an independent endpoint
    // gated by the same permission key as one of the existing cases above —
    // these extra cases exist so that if a handler in one of those routers
    // gets its permission swapped (e.g. content:manage -> content:view), the
    // suite catches the drift instead of trusting that the representative
    // case in the original router is enough.
    {
      resource: "bulk_export",
      permission: "content:view",
      buildPath: () => "/api/admin/content/export",
    },
    {
      // Non-existent track id -> handler returns 200 with an empty array.
      resource: "modules_view",
      permission: "content:view",
      buildPath: () => "/api/admin/tracks/9999999/modules",
    },
    {
      // Non-existent module id -> handler returns 200 with an empty array.
      resource: "lessons_view",
      permission: "content:view",
      buildPath: () => "/api/admin/modules/9999999/lessons",
    },
    {
      // Non-existent lesson id -> handler returns 200 with an empty array.
      resource: "resources_view",
      permission: "content:view",
      buildPath: () => "/api/admin/lessons/9999999/resources",
    },
    {
      resource: "tool_categories_view",
      permission: "apps:manage",
      buildPath: () => "/api/admin/tool-categories",
    },
    {
      resource: "webhook_logs",
      permission: "system:view",
      buildPath: () => "/api/admin/webhook-logs",
    },
    {
      resource: "outgoing_webhooks_view",
      permission: "settings:view",
      buildPath: () => "/api/admin/outgoing-webhooks",
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

// ---------------------------------------------------------------------------
// Per-resource RBAC matrix for WRITE-style ("manage") permissions.
//
// One representative write endpoint per manage-style permission. We send a
// request with an intentionally invalid (empty) body or a non-existent ID so
// that a permitted role's handler short-circuits at validation/lookup with a
// 400 or 404 — never actually mutating data. The thing we're asserting is
// strictly the gate: permitted roles get past `requirePermission` (i.e. NOT
// 401/403), denied roles get a 403 from the middleware before the handler
// ever runs.
//
// Allow/deny is sourced from the **portal** matrix (the public contract),
// matching the view-style suite above so drift on either side is caught.
// ---------------------------------------------------------------------------

type HttpMethod = "post" | "put" | "patch" | "delete";

interface RbacWriteCase {
  resource: string;
  permission: string;
  method: HttpMethod;
  buildPath: () => string;
  body?: unknown;
}

function rbacWriteCases(): RbacWriteCase[] {
  return [
    {
      resource: "tickets_manage",
      permission: "tickets:manage",
      method: "post",
      // Empty body -> handler returns 400 ("Title and body are required").
      buildPath: () => "/api/admin/canned-responses",
      body: {},
    },
    {
      resource: "content_manage",
      permission: "content:manage",
      method: "post",
      // Empty body -> 400 ("title and description are required").
      buildPath: () => "/api/admin/tracks",
      body: {},
    },
    {
      resource: "community_moderate",
      permission: "community:moderate",
      method: "post",
      // Empty body -> 400 ("Name and slug are required").
      buildPath: () => "/api/admin/community/categories",
      body: {},
    },
    {
      resource: "coaching_manage",
      permission: "coaching:manage",
      method: "post",
      // Empty body -> 400 ("coachId, dayOfWeek, startTime, endTime ...").
      buildPath: () => "/api/admin/coaching/availability",
      body: {},
    },
    {
      resource: "commissions_manage",
      permission: "commissions:manage",
      method: "post",
      // Empty body -> 400 ("tier, productId, and ratePercent are required").
      buildPath: () => "/api/admin/commissions/rates",
      body: {},
    },
    {
      resource: "chat_manage",
      permission: "chat:manage",
      method: "post",
      // Empty body -> 400 ("Name and content are required").
      buildPath: () => "/api/admin/chat/system-prompts",
      body: {},
    },
    {
      resource: "communications_manage",
      permission: "communications:manage",
      method: "post",
      // Empty body -> 400 ("slug, name, subject, htmlBody, and textBody ...").
      buildPath: () => "/api/admin/communications/email-templates",
      body: {},
    },
    {
      resource: "vault_manage",
      permission: "vault:manage",
      method: "post",
      // Empty body -> 400 ("name and slug are required").
      buildPath: () => "/api/admin/vault/collections",
      body: {},
    },
    {
      resource: "wins_manage",
      permission: "wins:manage",
      method: "patch",
      // Non-existent win id -> 404 ("Win not found"). Selected over POST so
      // we don't depend on having a real win row to operate on.
      buildPath: () => "/api/admin/wins/9999999/feature",
    },
    {
      resource: "ghl_manage",
      permission: "ghl:manage",
      method: "post",
      // retryJob() returns false for unknown ids (and gracefully on Redis
      // failure), so the handler responds 404 ("Job not found ...").
      buildPath: () => "/api/admin/ghl/retry/non-existent-job-id-rbac-test",
    },
    {
      resource: "api_keys_manage",
      permission: "api_keys:manage",
      method: "post",
      // Empty body -> 400 ("Name is required").
      buildPath: () => "/api/admin/api-keys",
      body: {},
    },
    {
      resource: "settings_manage",
      permission: "settings:manage",
      method: "put",
      // Empty body -> 400 ("Value is required") — never writes a row.
      buildPath: () => "/api/admin/settings/rbac-test-key-do-not-use",
      body: {},
    },
    {
      resource: "members_edit",
      permission: "members:edit",
      method: "post",
      // Empty body -> 400 ("Note content is required") — never inserts a note.
      buildPath: () => `/api/admin/members/${adminsByRole.super_admin.id}/notes`,
      body: {},
    },
    {
      resource: "members_impersonate",
      permission: "members:impersonate",
      method: "post",
      // Non-existent member id -> 404 ("Member not found"). No token issued.
      buildPath: () => "/api/admin/impersonate/9999999",
    },
    // ----- Per-router coverage for admin-bulk / admin-modules / admin-lessons
    // / admin-resources / admin-tools / admin-outgoing-webhooks /
    // admin-webhooks / admin-expiration. Same rationale as the view-side
    // additions: each handler is independently gated and a permission swap on
    // any one of them must be caught by the suite. All of these (except
    // run-expiration-check) short-circuit at validation with 400, so the
    // permitted role's request never mutates data.
    {
      resource: "bulk_publish",
      permission: "content:manage",
      method: "post",
      // Empty body -> 400 ("lessonIds must be a non-empty array").
      buildPath: () => "/api/admin/lessons/bulk-publish",
      body: {},
    },
    {
      resource: "modules_create",
      permission: "content:manage",
      method: "post",
      // Empty body -> 400 ("trackId, title, and description are required").
      buildPath: () => "/api/admin/modules",
      body: {},
    },
    {
      resource: "lessons_create",
      permission: "content:manage",
      method: "post",
      // Empty body -> 400 ("moduleId, title, and description are required").
      buildPath: () => "/api/admin/lessons",
      body: {},
    },
    {
      resource: "resources_create",
      permission: "content:manage",
      method: "post",
      // Empty body -> 400 ("fileName, fileUrl, and fileType are required")
      // before the lesson lookup, so a bogus lessonId is fine.
      buildPath: () => "/api/admin/lessons/9999999/resources",
      body: {},
    },
    {
      resource: "tool_categories_create",
      permission: "apps:manage",
      method: "post",
      // Empty body -> 400 ("name and slug are required").
      buildPath: () => "/api/admin/tool-categories",
      body: {},
    },
    {
      resource: "outgoing_webhooks_create",
      permission: "settings:manage",
      method: "post",
      // Empty body -> 400 ("name is required").
      buildPath: () => "/api/admin/outgoing-webhooks",
      body: {},
    },
    {
      resource: "product_mappings_update",
      permission: "settings:manage",
      method: "put",
      // Empty body -> 400 ("thrivecartProductId is required") before the
      // lookup, so a non-existent product id never gets touched.
      buildPath: () => "/api/admin/product-mappings/9999999",
      body: {},
    },
    {
      // run-expiration-check has no validation early-out, so a permitted role
      // (only super_admin holds settings:manage) will execute the handler.
      // In the test database no user_products are owned by the seeded
      // RBAC test users, so the body of the handler is effectively a no-op:
      // the bulk UPDATEs match nothing tied to seeded users, and the GHL/
      // email queues degrade gracefully when their backends are unavailable.
      // What we're asserting is purely the permission gate.
      resource: "expiration_run",
      permission: "settings:manage",
      method: "post",
      buildPath: () => "/api/admin/run-expiration-check",
    },
  ];
}

function dispatch(method: HttpMethod, path: string) {
  const agent = request(app);
  switch (method) {
    case "post":
      return agent.post(path);
    case "put":
      return agent.put(path);
    case "patch":
      return agent.patch(path);
    case "delete":
      return agent.delete(path);
  }
}

describe("Admin RBAC: per-role write-endpoint access", () => {
  it("requires authentication for every gated admin write endpoint (no cookie -> 401)", async () => {
    for (const { resource, method, buildPath, body } of rbacWriteCases()) {
      const path = buildPath();
      let req = dispatch(method, path);
      if (body !== undefined) req = req.send(body);
      const res = await req;
      expect(
        res.status,
        `Resource ${resource} (${method.toUpperCase()} ${path}) should require auth`,
      ).toBe(401);
    }
  });

  it("rejects non-admin (member) users with 403 on every gated admin write endpoint", async () => {
    const memberEmail = `${TEST_TAG}-write-member@example.test`;
    const passwordHash = await bcrypt.hash("irrelevant-test-password", 4);
    const [member] = await db
      .insert(usersTable)
      .values({
        email: memberEmail,
        name: "Test Member Writer",
        passwordHash,
        role: "member",
        sourceProduct: "lifetime",
        emailVerified: true,
        onboardingComplete: true,
      })
      .returning({ id: usersTable.id });
    seededUserIds.push(member.id);
    const cookie = signCookie(member.id, memberEmail);

    for (const { resource, method, buildPath, body } of rbacWriteCases()) {
      const path = buildPath();
      let req = dispatch(method, path).set("Cookie", cookie);
      if (body !== undefined) req = req.send(body);
      const res = await req;
      expect(
        res.status,
        `Resource ${resource} (${method.toUpperCase()} ${path}) should reject member with 403`,
      ).toBe(403);
    }
  });

  for (const role of ADMIN_ROLES) {
    describe(`role: ${role}`, () => {
      for (const testCase of rbacWriteCases()) {
        // Source of truth: portal matrix (what the user-facing UI promises).
        const allowedRoles = PORTAL_PERMISSION_MATRIX[testCase.permission] ?? [];
        const isAllowed = allowedRoles.includes(role);
        const label = `${testCase.resource} (${testCase.permission}) -> ${
          isAllowed ? "allowed (past gate)" : "forbidden (403)"
        }`;

        it(label, async () => {
          const admin = adminsByRole[role];
          const path = testCase.buildPath();
          let req = dispatch(testCase.method, path).set("Cookie", admin.cookie);
          if (testCase.body !== undefined) req = req.send(testCase.body);
          const res = await req;

          if (isAllowed) {
            // The gate must NOT block the request. Handlers are intentionally
            // fed empty/invalid bodies (or non-existent IDs) so they
            // short-circuit at validation/lookup with 400 or 404 — anything
            // other than 401/403 proves the permission gate let the role
            // through.
            expect(
              [401, 403].includes(res.status),
              `Role ${role} should be permitted past gate on ${testCase.resource} ` +
                `(${testCase.method.toUpperCase()} ${path}). Got ${res.status}: ` +
                `${JSON.stringify(res.body)}`,
            ).toBe(false);
          } else {
            expect(
              res.status,
              `Role ${role} should be denied on ${testCase.resource} ` +
                `(${testCase.method.toUpperCase()} ${path}). Got ${res.status}: ` +
                `${JSON.stringify(res.body)}`,
            ).toBe(403);
          }
        });
      }
    });
  }
});
