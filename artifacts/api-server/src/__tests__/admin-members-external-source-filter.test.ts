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
} from "@workspace/db";
import { inArray } from "drizzle-orm";

vi.mock("../lib/redis", () => ({
  getRedis: () => null,
  isRedisConnected: async () => false,
}));

import { buildTestAppWithRouters } from "./test-app";
import adminPanelRouter from "../routes/admin-panel";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const TEST_TAG = `admin-members-src-${randomUUID().slice(0, 8)}`;

let app: ReturnType<typeof buildTestAppWithRouters>;
let adminCookie: string;
const seededUserIds: number[] = [];
const seededProductIds: number[] = [];

let yseUserId: number;
let directUserId: number;
const YSE_ORDER_ID = `${TEST_TAG}-ORDER-ABC`;

function signCookie(userId: number, email: string): string {
  const token = jwt.sign({ userId, email }, JWT_SECRET, { expiresIn: "1h" });
  return `access_token=${token}`;
}

async function insertUser(role: string, suffix: string): Promise<number> {
  const passwordHash = await bcrypt.hash("irrelevant", 4);
  const [row] = await db
    .insert(usersTable)
    .values({
      email: `${TEST_TAG}-${suffix}@example.test`,
      name: `Member ${suffix}`,
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

beforeAll(async () => {
  app = buildTestAppWithRouters([adminPanelRouter]);

  const adminId = await insertUser("super_admin", "admin");
  adminCookie = signCookie(adminId, `${TEST_TAG}-admin@example.test`);

  yseUserId = await insertUser("member", "yse");
  directUserId = await insertUser("member", "direct");

  const [product] = await db
    .insert(productsTable)
    .values({
      slug: `${TEST_TAG}-product`,
      name: `${TEST_TAG} product`,
      type: "backend",
      sortOrder: 99,
    })
    .returning({ id: productsTable.id });
  seededProductIds.push(product.id);

  // YSE-sourced grant for the YSE member.
  await db.insert(userProductsTable).values({
    userId: yseUserId,
    productId: product.id,
    status: "active",
    externalSource: "yse",
    externalOrderId: YSE_ORDER_ID,
  });
  // Direct member also owns a product but with no externalSource — i.e.
  // not provisioned through an integration.
  await db.insert(userProductsTable).values({
    userId: directUserId,
    productId: product.id,
    status: "active",
  });
});

afterAll(async () => {
  if (seededUserIds.length > 0) {
    await db
      .delete(userProductsTable)
      .where(inArray(userProductsTable.userId, seededUserIds));
    await db.delete(usersTable).where(inArray(usersTable.id, seededUserIds));
  }
  if (seededProductIds.length > 0) {
    await db
      .delete(productsTable)
      .where(inArray(productsTable.id, seededProductIds));
  }
});

describe("GET /api/admin/members — externalSource / externalOrderId filters", () => {
  it("returns only members with a YSE-sourced grant when externalSource=yse", async () => {
    const res = await request(app)
      .get("/api/admin/members")
      .query({ limit: 100, externalSource: "yse" })
      .set("Cookie", adminCookie);
    expect(res.status).toBe(200);
    const ids = res.body.members.map((m: { id: number }) => m.id);
    expect(ids).toContain(yseUserId);
    expect(ids).not.toContain(directUserId);
  });

  it("excludes integration-sourced members when externalSource=direct", async () => {
    const res = await request(app)
      .get("/api/admin/members")
      .query({ limit: 100, externalSource: "direct" })
      .set("Cookie", adminCookie);
    expect(res.status).toBe(200);
    const ids = res.body.members.map((m: { id: number }) => m.id);
    expect(ids).toContain(directUserId);
    expect(ids).not.toContain(yseUserId);
  });

  it("finds the member tied to a specific external order id", async () => {
    const res = await request(app)
      .get("/api/admin/members")
      .query({ limit: 100, externalOrderId: YSE_ORDER_ID })
      .set("Cookie", adminCookie);
    expect(res.status).toBe(200);
    const ids = res.body.members.map((m: { id: number }) => m.id);
    expect(ids).toEqual([yseUserId]);
  });

  it("lists distinct external sources from user_products", async () => {
    const res = await request(app)
      .get("/api/admin/members/external-sources")
      .set("Cookie", adminCookie);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.sources)).toBe(true);
    expect(res.body.sources).toContain("yse");
  });
});
