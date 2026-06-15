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
  toolsTable,
  toolCategoriesTable,
  toolUsageLogTable,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

// Runtime regression guard for the dashboard's "Software & Tools" widget.
// The `/dashboard` handler returns a `recentTools` list (a member's recently
// used tools, padded with featured ones) gated behind the software:* family
// of entitlements. The generated client type was updated to match, but
// nothing pinned the wire shape — a future change to the handler, the tools
// schema, or the OpenAPI spec could silently drop the field or change an
// item's shape and break the widget. This test asserts the contract.

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

const RECENT_TOOL_KEYS = ["id", "slug", "name", "shortDescription", "icon", "isFeatured"];

function expectRecentToolShape(tool: any): void {
  expect(tool).toBeTypeOf("object");
  expect(tool).not.toBeNull();
  expect(typeof tool.id).toBe("number");
  expect(typeof tool.slug).toBe("string");
  expect(typeof tool.name).toBe("string");
  expect(typeof tool.shortDescription).toBe("string");
  expect(tool.icon === null || typeof tool.icon === "string").toBe(true);
  expect(typeof tool.isFeatured).toBe("boolean");
  // No leaking of internal-only columns into the wire shape.
  for (const key of Object.keys(tool)) {
    expect(RECENT_TOOL_KEYS).toContain(key);
  }
}

describe("GET /dashboard recentTools", () => {
  const PREFIX = `__dash_tools_test__${randomUUID().slice(0, 8)}`;
  let app: ReturnType<typeof buildTestAppWithRouters>;

  let softwareUserId: number;
  let softwareCookie: string;
  let plainUserId: number;
  let plainCookie: string;

  let categoryId: number;
  let productId: number;
  const userProductIds: number[] = [];
  const createdToolIds: number[] = [];

  beforeAll(async () => {
    app = buildTestAppWithRouters([dashboardRouter]);

    const softwareUser = await insertUser("with-software");
    softwareUserId = softwareUser.id;
    softwareCookie = signCookie(softwareUser.id, softwareUser.email);

    const plainUser = await insertUser("no-software");
    plainUserId = plainUser.id;
    plainCookie = signCookie(plainUser.id, plainUser.email);

    // A product whose entitlement_keys grant software:base.
    const [product] = await db
      .insert(productsTable)
      .values({
        slug: `${PREFIX}-product`,
        name: "Dash Tools Software Product",
        type: "frontend",
        entitlementKeys: ["software:base"],
      })
      .returning({ id: productsTable.id });
    productId = product.id;

    // Only the software user owns it (active, no expiry).
    const [up] = await db
      .insert(userProductsTable)
      .values({
        userId: softwareUserId,
        productId,
        status: "active",
        expiresAt: null,
      })
      .returning({ id: userProductsTable.id });
    userProductIds.push(up.id);

    // A category for the tools (category_id is NOT NULL).
    const [category] = await db
      .insert(toolCategoriesTable)
      .values({
        name: `${PREFIX}-category`,
        slug: `${PREFIX}-category`,
      })
      .returning({ id: toolCategoriesTable.id });
    categoryId = category.id;

    // A "recently used" tool (icon set) plus a featured tool (icon null) so
    // the response exercises both the usage-log branch and the featured
    // padding branch, and both the string-icon and null-icon cases.
    const [usedTool] = await db
      .insert(toolsTable)
      .values({
        slug: `${PREFIX}-used`,
        name: "Dash Used Tool",
        shortDescription: "Recently used tool",
        categoryId,
        requiredEntitlement: "software:base",
        icon: "wrench",
        status: "active",
        isFeatured: 0,
      })
      .returning({ id: toolsTable.id });
    createdToolIds.push(usedTool.id);

    const [featuredTool] = await db
      .insert(toolsTable)
      .values({
        slug: `${PREFIX}-featured`,
        name: "Dash Featured Tool",
        shortDescription: "Featured tool",
        categoryId,
        requiredEntitlement: "software:base",
        icon: null,
        status: "active",
        isFeatured: 1,
      })
      .returning({ id: toolsTable.id });
    createdToolIds.push(featuredTool.id);

    // Log usage so the recently-used branch returns the used tool.
    await db.insert(toolUsageLogTable).values({
      userId: softwareUserId,
      toolId: usedTool.id,
      action: "launch",
    });
  });

  afterAll(async () => {
    await db.delete(toolUsageLogTable).where(eq(toolUsageLogTable.userId, softwareUserId));
    if (createdToolIds.length > 0) {
      await db.delete(toolsTable).where(inArray(toolsTable.id, createdToolIds));
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
    await db.delete(usersTable).where(inArray(usersTable.id, [softwareUserId, plainUserId]));
  });

  it("returns a populated recentTools array of the expected shape for a software member", async () => {
    const res = await request(app)
      .get("/api/dashboard")
      .set("Cookie", softwareCookie);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.recentTools)).toBe(true);
    expect(res.body.recentTools.length).toBeGreaterThan(0);

    for (const tool of res.body.recentTools) {
      expectRecentToolShape(tool);
    }

    // The just-used tool must surface, with its boolean isFeatured normalized
    // from the integer column.
    const used = res.body.recentTools.find((t: any) => t.slug === `${PREFIX}-used`);
    expect(used).toBeDefined();
    expect(used.isFeatured).toBe(false);
    expect(used.icon).toBe("wrench");

    // A null-icon featured tool round-trips its null icon as a boolean-true flag.
    const featured = res.body.recentTools.find((t: any) => t.slug === `${PREFIX}-featured`);
    expect(featured).toBeDefined();
    expect(featured.isFeatured).toBe(true);
    expect(featured.icon).toBeNull();
  });

  it("returns recentTools as an empty array for a member without software entitlement", async () => {
    const res = await request(app)
      .get("/api/dashboard")
      .set("Cookie", plainCookie);

    expect(res.status).toBe(200);
    // The field is always present (the generated type marks it optional, but
    // the handler always emits it) and is an array — empty when locked out.
    expect(Array.isArray(res.body.recentTools)).toBe(true);
    expect(res.body.recentTools).toHaveLength(0);
  });
});
