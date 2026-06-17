import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import {
  db,
  usersTable,
  productsTable,
  userProductsTable,
  toolCategoriesTable,
  toolsTable,
  toolUsageLogTable,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

// Access-control regression guard for the dashboard's tool shortcuts.
// The `/dashboard` handler only builds `recentTools` (recently-used plus
// featured tool shortcuts) for members who hold `software:base` or
// `software:expanded` (see the entitlement guard around `recentTools` in
// routes/dashboard.ts). This is a real paywall boundary: if a future change
// drops the guard, tool shortcuts would surface to members who never bought a
// software product. These tests pin the behavior for both a member lacking any
// `software:*` entitlement (recentTools must stay empty) and a member who owns
// a product granting `software:base` (recentTools must be populated).

vi.mock("../lib/redis", () => ({
  getRedis: () => null,
  isRedisConnected: async () => false,
  getRedisConnection: vi.fn(),
  createRedisConnection: vi.fn(),
}));

import { buildTestAppWithRouters } from "./test-app";
import dashboardRouter from "../routes/dashboard";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";

function signCookie(userId: number, email: string): string {
  const token = jwt.sign({ userId, email }, JWT_SECRET, { expiresIn: "1h" });
  return `access_token=${token}`;
}

async function insertUser(suffix: string): Promise<{ id: number; email: string }> {
  const email = `dash-tools-${suffix}-${randomUUID().slice(0, 8)}@example.test`;
  const passwordHash = await bcrypt.hash("irrelevant-test-password", 4);
  const [row] = await db
    .insert(usersTable)
    .values({
      email,
      name: `Dash Tools ${suffix}`,
      passwordHash,
      role: "member",
      emailVerified: true,
      onboardingComplete: true,
    })
    .returning({ id: usersTable.id });
  return { id: row.id, email };
}

describe("GET /dashboard tool shortcut entitlement gating", () => {
  const PREFIX = `__dash_tools_test__${randomUUID().slice(0, 8)}`;
  // The dashboard gates `recentTools` on `software:base`/`software:expanded`,
  // so the entitling product must grant exactly `software:base`.
  const SOFTWARE_ENT = "software:base";

  let app: ReturnType<typeof buildTestAppWithRouters>;

  let entitledUserId: number;
  let entitledCookie: string;
  let noAccessUserId: number;
  let noAccessCookie: string;

  let productId: number;
  const userProductIds: number[] = [];
  let categoryId: number;
  let toolId: number;
  // A tool that requires a HIGHER tier (`software:expanded`) than the entitled
  // member owns (`software:base`). It is also featured + recently used, so it
  // would surface in `recentTools` if the handler did not re-check each tool's
  // own `requiredEntitlement`.
  let higherTierToolId: number;
  const toolIds: number[] = [];
  const usageLogIds: number[] = [];

  beforeAll(async () => {
    app = buildTestAppWithRouters([dashboardRouter]);

    const entitledUser = await insertUser("entitled");
    entitledUserId = entitledUser.id;
    entitledCookie = signCookie(entitledUser.id, entitledUser.email);

    // A member who owns no products at all → empty entitlement set, so no
    // `software:*` entitlement.
    const noAccessUser = await insertUser("noaccess");
    noAccessUserId = noAccessUser.id;
    noAccessCookie = signCookie(noAccessUser.id, noAccessUser.email);

    // A product whose entitlement_keys grant `software:base`.
    const [product] = await db
      .insert(productsTable)
      .values({
        slug: `${PREFIX}-product`,
        name: "Dash Tools Software Product",
        type: "frontend",
        entitlementKeys: [SOFTWARE_ENT],
      })
      .returning({ id: productsTable.id });
    productId = product.id;

    // Only the entitled member owns it (active, no expiry).
    const [up] = await db
      .insert(userProductsTable)
      .values({
        userId: entitledUserId,
        productId,
        status: "active",
        expiresAt: null,
      })
      .returning({ id: userProductsTable.id });
    userProductIds.push(up.id);

    const [category] = await db
      .insert(toolCategoriesTable)
      .values({
        name: `${PREFIX}-category`,
        slug: `${PREFIX}-category`,
        description: "Test tool category",
      })
      .returning({ id: toolCategoriesTable.id });
    categoryId = category.id;

    const [tool] = await db
      .insert(toolsTable)
      .values({
        slug: `${PREFIX}-tool`,
        name: `${PREFIX}-tool`,
        shortDescription: "Test tool shortcut",
        categoryId,
        requiredEntitlement: SOFTWARE_ENT,
        status: "active",
        isFeatured: 1,
      })
      .returning({ id: toolsTable.id });
    toolId = tool.id;
    toolIds.push(toolId);

    // A second tool that requires a HIGHER tier than the entitled member owns.
    // The member holds `software:base` but this tool demands
    // `software:expanded`, so it must NOT surface in `recentTools` even though
    // it is active, featured, and recently used by the member.
    const [higherTierTool] = await db
      .insert(toolsTable)
      .values({
        slug: `${PREFIX}-tool-expanded`,
        name: `${PREFIX}-tool-expanded`,
        shortDescription: "Higher-tier test tool shortcut",
        categoryId,
        requiredEntitlement: "software:expanded",
        status: "active",
        isFeatured: 1,
      })
      .returning({ id: toolsTable.id });
    higherTierToolId = higherTierTool.id;
    toolIds.push(higherTierToolId);

    // Seed recent usage records for the entitled member so these exact tools are
    // guaranteed to be candidates for `recentTools` regardless of any other
    // tools the shared dev DB might have seeded.
    const usageRows = await db
      .insert(toolUsageLogTable)
      .values([
        { userId: entitledUserId, toolId, action: "launch" },
        { userId: entitledUserId, toolId: higherTierToolId, action: "launch" },
      ])
      .returning({ id: toolUsageLogTable.id });
    usageLogIds.push(...usageRows.map((u) => u.id));
  });

  afterAll(async () => {
    if (usageLogIds.length > 0) {
      await db.delete(toolUsageLogTable).where(inArray(toolUsageLogTable.id, usageLogIds));
    }
    if (toolIds.length > 0) {
      await db.delete(toolsTable).where(inArray(toolsTable.id, toolIds));
    }
    if (categoryId) {
      await db.delete(toolCategoriesTable).where(eq(toolCategoriesTable.id, categoryId));
    }
    if (userProductIds.length > 0) {
      await db.delete(userProductsTable).where(inArray(userProductsTable.id, userProductIds));
    }
    if (productId) {
      await db.delete(productsTable).where(eq(productsTable.id, productId));
    }
    await db.delete(usersTable).where(inArray(usersTable.id, [entitledUserId, noAccessUserId]));
  });

  it("returns no tool shortcuts for a member lacking any software entitlement", async () => {
    const res = await request(app)
      .get("/api/dashboard")
      .set("Cookie", noAccessCookie);

    expect(res.status).toBe(200);
    // Without `software:base`/`software:expanded` the handler skips the whole
    // tool-shortcut block, leaving `recentTools` an empty array.
    expect(Array.isArray(res.body.recentTools)).toBe(true);
    expect(res.body.recentTools).toHaveLength(0);
  });

  it("populates tool shortcuts for a member who owns a software product", async () => {
    const res = await request(app)
      .get("/api/dashboard")
      .set("Cookie", entitledCookie);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.recentTools)).toBe(true);
    expect(res.body.recentTools.length).toBeGreaterThan(0);
    // The member's recently-used tool must be among the shortcuts.
    const tool = res.body.recentTools.find((t: any) => t.id === toolId);
    expect(tool).toBeDefined();
    expect(tool.slug).toBe(`${PREFIX}-tool`);
  });

  it("omits a recently-used tool that requires a higher tier than the member owns", async () => {
    const res = await request(app)
      .get("/api/dashboard")
      .set("Cookie", entitledCookie);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.recentTools)).toBe(true);
    // The member owns only `software:base`. Even though the higher-tier tool is
    // active, featured, and recently used by this member, the handler must
    // re-check each tool's own `requiredEntitlement` and exclude it.
    const higherTier = res.body.recentTools.find((t: any) => t.id === higherTierToolId);
    expect(higherTier).toBeUndefined();
    // The base-tier tool is still shown, proving the filter is per-tool and not
    // an all-or-nothing block.
    const baseTier = res.body.recentTools.find((t: any) => t.id === toolId);
    expect(baseTier).toBeDefined();
  });
});
