import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  vi,
} from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import { randomBytes, randomUUID } from "crypto";
import {
  db,
  usersTable,
  productsTable,
  userProductsTable,
  webhookLogsTable,
  apiKeysTable,
} from "@workspace/db";
import { eq, inArray, and, isNotNull } from "drizzle-orm";

vi.mock("../lib/communication-service", () => ({
  CommunicationService: {
    queueEmail: vi.fn().mockResolvedValue(undefined),
    queueSms: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("../lib/ghl-queue", () => ({
  queueGHLSync: vi.fn().mockResolvedValue("job_id"),
  startWorker: vi.fn(),
  shutdown: vi.fn(),
}));

vi.mock("../lib/commissions", () => ({
  ensureAffiliateProfile: vi.fn().mockResolvedValue(null),
  resolveUserCommissionTier: vi.fn().mockResolvedValue(null),
}));

vi.mock("../lib/redis", () => ({
  getRedis: () => null,
  isRedisConnected: async () => false,
}));

vi.mock("../lib/webhook-events", () => ({
  emitWebhookEvent: vi.fn().mockResolvedValue(undefined),
  WEBHOOK_EVENT_TYPES: [],
}));

import { buildTestApp } from "./test-app";
import integrationsRouter from "../routes/integrations";

const TEST_TAG = `revoke-test-${randomUUID().slice(0, 8)}`;
const SOURCE = `revoketest_${randomUUID().slice(0, 6)}`;
const seededUserIds: number[] = [];
const seededProductIds: number[] = [];
const seededApiKeyIds: number[] = [];

let app: ReturnType<typeof buildTestApp>;
let validApiKey: string;
let limitedApiKey: string;
let productId: number;
let userId: number;

const URL = "/api/integrations/revoke-product";

async function createApiKey(permissions: string[]): Promise<string> {
  const adminEmail = `${TEST_TAG}-${randomUUID().slice(0, 6)}@example.test`;
  const passwordHash = await bcrypt.hash("irrelevant", 4);
  const [admin] = await db
    .insert(usersTable)
    .values({
      email: adminEmail,
      name: "Admin",
      passwordHash,
      role: "admin",
      sourceProduct: "lifetime",
      emailVerified: true,
    })
    .returning({ id: usersTable.id });
  seededUserIds.push(admin.id);

  const randomPart = randomBytes(24).toString("hex");
  const rawKey = `bts_live_sk_${randomPart}`;
  const prefix = `bts_live_sk_${randomPart.substring(0, 8)}`;
  const keyHash = await bcrypt.hash(rawKey, 4);

  const [key] = await db
    .insert(apiKeysTable)
    .values({
      name: `${TEST_TAG}-key`,
      prefix,
      keyHash,
      type: "secret",
      environment: "live",
      permissions,
      rateLimitTier: "standard",
      createdById: admin.id,
    })
    .returning({ id: apiKeysTable.id });
  seededApiKeyIds.push(key.id);

  return rawKey;
}

beforeAll(async () => {
  app = buildTestApp({ routers: [integrationsRouter] });

  const [product] = await db
    .insert(productsTable)
    .values({
      slug: `${TEST_TAG}-product`,
      name: `Test Product ${TEST_TAG}`,
      type: "frontend",
      entitlementKeys: ["content:frontend"],
      priceDisplay: "$67",
      sortOrder: 999,
    })
    .returning();
  productId = product.id;
  seededProductIds.push(product.id);

  const [user] = await db
    .insert(usersTable)
    .values({
      email: `${TEST_TAG}-member@example.test`,
      name: "Test Member",
      passwordHash: await bcrypt.hash("irrelevant", 4),
      sourceProduct: "yse",
    })
    .returning({ id: usersTable.id });
  userId = user.id;
  seededUserIds.push(user.id);

  validApiKey = await createApiKey(["integrations:grant_products"]);
  limitedApiKey = await createApiKey(["some:other_scope"]);
});

afterAll(async () => {
  if (seededApiKeyIds.length > 0) {
    await db
      .delete(apiKeysTable)
      .where(inArray(apiKeysTable.id, seededApiKeyIds));
  }
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
  await db
    .delete(webhookLogsTable)
    .where(eq(webhookLogsTable.eventType, "external.revoke_product"));
});

async function seedGrant(externalOrderId: string) {
  const [row] = await db
    .insert(userProductsTable)
    .values({
      userId,
      productId,
      status: "active",
      externalOrderId,
      externalSource: SOURCE,
    })
    .returning({ id: userProductsTable.id });

  const externalId = `${SOURCE}_${externalOrderId}`;
  await db
    .insert(webhookLogsTable)
    .values({
      externalId,
      eventType: "external.grant_product",
      status: "processed",
      payload: { externalOrderId, externalSource: SOURCE } as Record<
        string,
        unknown
      >,
      result: { userId, grants: [{ userProductId: row.id }] } as Record<
        string,
        unknown
      >,
      attempts: 1,
      processedAt: new Date(),
      lastAttemptAt: new Date(),
    })
    .onConflictDoNothing();

  return { userProductId: row.id, externalId };
}

describe("POST /api/integrations/revoke-product — auth", () => {
  it("returns 401 without API key", async () => {
    const res = await request(app)
      .post(URL)
      .send({ externalOrderId: "x", externalSource: SOURCE });
    expect(res.status).toBe(401);
  });

  it("returns 403 when key lacks required scope", async () => {
    const res = await request(app)
      .post(URL)
      .set("Authorization", `Bearer ${limitedApiKey}`)
      .send({ externalOrderId: "x", externalSource: SOURCE });
    expect(res.status).toBe(403);
  });
});

describe("POST /api/integrations/revoke-product — validation", () => {
  it("returns 400 when externalOrderId is missing", async () => {
    const res = await request(app)
      .post(URL)
      .set("Authorization", `Bearer ${validApiKey}`)
      .send({ externalSource: SOURCE });
    expect(res.status).toBe(400);
  });

  it("returns 400 when externalSource is missing", async () => {
    const res = await request(app)
      .post(URL)
      .set("Authorization", `Bearer ${validApiKey}`)
      .send({ externalOrderId: "abc" });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/integrations/revoke-product — happy paths", () => {
  it("soft-cancels matching user_product, preserves audit trail, updates webhook_log", async () => {
    const orderId = `ord_${randomUUID().slice(0, 8)}`;
    const { userProductId, externalId } = await seedGrant(orderId);

    const res = await request(app)
      .post(URL)
      .set("Authorization", `Bearer ${validApiKey}`)
      .send({
        externalOrderId: orderId,
        externalSource: SOURCE,
        reason: "chargeback",
      });

    expect(res.status).toBe(200);
    expect(res.body.revokedCount).toBe(1);
    expect(res.body.alreadyCancelledCount).toBe(0);
    expect(res.body.revoked).toHaveLength(1);
    expect(res.body.revoked[0].userProductId).toBe(userProductId);

    const [row] = await db
      .select()
      .from(userProductsTable)
      .where(eq(userProductsTable.id, userProductId));
    expect(row.cancelledAt).not.toBeNull();
    expect(row.status).toBe("cancelled");
    // Audit trail preserved
    expect(row.externalOrderId).toBe(orderId);
    expect(row.externalSource).toBe(SOURCE);

    const [log] = await db
      .select()
      .from(webhookLogsTable)
      .where(eq(webhookLogsTable.externalId, externalId));
    expect(log.status).toBe("revoked");
    const result = log.result as Record<string, unknown>;
    expect(result.revocation).toMatchObject({
      reason: "chargeback",
      revokedUserProductIds: [userProductId],
      alreadyCancelledCount: 0,
    });
    // Original grant result also preserved
    expect(result.userId).toBe(userId);
  });

  it("is idempotent — second call reports alreadyCancelledCount", async () => {
    const orderId = `ord_${randomUUID().slice(0, 8)}`;
    await seedGrant(orderId);

    const first = await request(app)
      .post(URL)
      .set("Authorization", `Bearer ${validApiKey}`)
      .send({ externalOrderId: orderId, externalSource: SOURCE });
    expect(first.status).toBe(200);
    expect(first.body.revokedCount).toBe(1);

    const second = await request(app)
      .post(URL)
      .set("Authorization", `Bearer ${validApiKey}`)
      .send({ externalOrderId: orderId, externalSource: SOURCE });
    expect(second.status).toBe(200);
    expect(second.body.revokedCount).toBe(0);
    expect(second.body.alreadyCancelledCount).toBe(1);
  });

  it("returns revokedCount=0 when no matching rows exist (no prior grant)", async () => {
    const orderId = `ord_nomatch_${randomUUID().slice(0, 8)}`;
    const res = await request(app)
      .post(URL)
      .set("Authorization", `Bearer ${validApiKey}`)
      .send({ externalOrderId: orderId, externalSource: SOURCE });

    expect(res.status).toBe(200);
    expect(res.body.revokedCount).toBe(0);
    expect(res.body.alreadyCancelledCount).toBe(0);

    // A webhook_log row is still created for the audit trail
    const externalId = `${SOURCE}_${orderId}`;
    const [log] = await db
      .select()
      .from(webhookLogsTable)
      .where(eq(webhookLogsTable.externalId, externalId));
    expect(log).toBeDefined();
    expect(log.status).toBe("revoked");
    expect(log.eventType).toBe("external.revoke_product");
  });

  it("revokes all matching rows (e.g. multi-product order)", async () => {
    const orderId = `ord_multi_${randomUUID().slice(0, 8)}`;

    // Create a second product so we can have two rows under the same order
    const [product2] = await db
      .insert(productsTable)
      .values({
        slug: `${TEST_TAG}-product2-${randomUUID().slice(0, 6)}`,
        name: "Second Product",
        type: "frontend",
        entitlementKeys: ["content:frontend"],
        priceDisplay: "$47",
        sortOrder: 998,
      })
      .returning();
    seededProductIds.push(product2.id);

    await db.insert(userProductsTable).values([
      {
        userId,
        productId,
        status: "active",
        externalOrderId: orderId,
        externalSource: SOURCE,
      },
      {
        userId,
        productId: product2.id,
        status: "active",
        externalOrderId: orderId,
        externalSource: SOURCE,
      },
    ]);

    const res = await request(app)
      .post(URL)
      .set("Authorization", `Bearer ${validApiKey}`)
      .send({ externalOrderId: orderId, externalSource: SOURCE });

    expect(res.status).toBe(200);
    expect(res.body.revokedCount).toBe(2);

    const cancelled = await db
      .select({ id: userProductsTable.id })
      .from(userProductsTable)
      .where(
        and(
          eq(userProductsTable.externalOrderId, orderId),
          eq(userProductsTable.externalSource, SOURCE),
          isNotNull(userProductsTable.cancelledAt),
        ),
      );
    expect(cancelled).toHaveLength(2);
  });
});
