import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import bcrypt from "bcryptjs";
import { db, usersTable } from "@workspace/db";
import { inArray } from "drizzle-orm";
import {
  getUserEntitlements,
  hasMemberAccessBypass,
} from "../lib/entitlements";
import { isPartnerRole, hasPermission } from "@workspace/auth";
import { requirePartnerOrPartnersView } from "../middleware/rbac";

// Accountability-partner staff role: mirrors the coach role pattern end to
// end, EXCEPT partners must never receive the coach-style member-content
// bypass. These tests lock in the hard rule from the task: "Partner role
// grants NO member entitlements — content access stays 100% product-derived."

const TEST_TAG = `partner-role-test-${randomUUID().slice(0, 8)}`;
const seededUserIds: number[] = [];

async function seedUser(role: string): Promise<number> {
  const email = `${TEST_TAG}-${role}-${randomUUID().slice(0, 8)}@example.test`;
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
  return row.id;
}

afterAll(async () => {
  if (seededUserIds.length > 0) {
    await db.delete(usersTable).where(inArray(usersTable.id, seededUserIds));
  }
});

describe("isPartnerRole", () => {
  it("recognizes only the partner role", () => {
    expect(isPartnerRole("partner")).toBe(true);
    expect(isPartnerRole("coach")).toBe(false);
    expect(isPartnerRole("admin")).toBe(false);
    expect(isPartnerRole(undefined)).toBe(false);
  });
});

describe("partners:view / partners:manage permission matrix", () => {
  it("grants partners:view to super_admin, admin, support_agent only", () => {
    expect(hasPermission("super_admin", "partners:view")).toBe(true);
    expect(hasPermission("admin", "partners:view")).toBe(true);
    expect(hasPermission("support_agent", "partners:view")).toBe(true);
    expect(hasPermission("content_manager", "partners:view")).toBe(false);
    expect(hasPermission("compliance_reviewer", "partners:view")).toBe(false);
  });

  it("grants partners:manage to super_admin and admin only", () => {
    expect(hasPermission("super_admin", "partners:manage")).toBe(true);
    expect(hasPermission("admin", "partners:manage")).toBe(true);
    expect(hasPermission("support_agent", "partners:manage")).toBe(false);
  });
});

describe("Partner role never gets member-entitlement bypass", () => {
  it("hasMemberAccessBypass is false for a partner user with no products", async () => {
    const userId = await seedUser("partner");
    expect(await hasMemberAccessBypass(userId)).toBe(false);
  });

  it("getUserEntitlements returns an empty set for a partner with no product grants", async () => {
    const userId = await seedUser("partner");
    const entitlements = await getUserEntitlements(userId);
    expect(entitlements.size).toBe(0);
  });

  it("hasMemberAccessBypass stays true for coach (contrast case, unchanged behavior)", async () => {
    const userId = await seedUser("coach");
    expect(await hasMemberAccessBypass(userId)).toBe(true);
  });
});

describe("requirePartnerOrPartnersView middleware", () => {
  function buildReqRes(overrides: Record<string, unknown> = {}) {
    const req: any = { isApiKeyAuth: false, userId: undefined, requestId: "test-request-id", ...overrides };
    let statusCode: number | undefined;
    let body: unknown;
    const res: any = {
      req,
      status(code: number) {
        statusCode = code;
        return this;
      },
      json(payload: unknown) {
        body = payload;
        return this;
      },
    };
    return { req, res, getStatus: () => statusCode, getBody: () => body };
  }

  it("returns 401 when there is no authenticated user", async () => {
    const { req, res, getStatus } = buildReqRes();
    const next = () => { throw new Error("next() should not be called"); };
    await requirePartnerOrPartnersView()(req, res, next as any);
    expect(getStatus()).toBe(401);
  });

  it("calls next() for a partner-role user", async () => {
    const userId = await seedUser("partner");
    const { req, res } = buildReqRes({ userId });
    let nextCalled = false;
    await requirePartnerOrPartnersView()(req, res, () => { nextCalled = true; });
    expect(nextCalled).toBe(true);
  });

  it("calls next() for an admin with partners:view", async () => {
    const userId = await seedUser("admin");
    const { req, res } = buildReqRes({ userId });
    let nextCalled = false;
    await requirePartnerOrPartnersView()(req, res, () => { nextCalled = true; });
    expect(nextCalled).toBe(true);
    expect(req.adminRole).toBe("admin");
  });

  it("returns 403 for a plain member", async () => {
    const userId = await seedUser("member");
    const { req, res, getStatus } = buildReqRes({ userId });
    const next = () => { throw new Error("next() should not be called"); };
    await requirePartnerOrPartnersView()(req, res, next as any);
    expect(getStatus()).toBe(403);
  });

  it("returns 403 for an admin role lacking partners:view (content_manager)", async () => {
    const userId = await seedUser("content_manager");
    const { req, res, getStatus } = buildReqRes({ userId });
    const next = () => { throw new Error("next() should not be called"); };
    await requirePartnerOrPartnersView()(req, res, next as any);
    expect(getStatus()).toBe(403);
  });
});
