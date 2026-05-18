import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import { randomBytes, randomUUID } from "crypto";
import { db, usersTable, productsTable, userProductsTable, webhookLogsTable, apiKeysTable } from "@workspace/db";
import { eq, inArray, and } from "drizzle-orm";

const { queueEmailMock, queueGHLSyncMock, ensureAffiliateProfileMock } = vi.hoisted(() => ({
  queueEmailMock: vi.fn().mockResolvedValue(undefined),
  queueGHLSyncMock: vi.fn().mockResolvedValue("job_test_id"),
  ensureAffiliateProfileMock: vi.fn().mockResolvedValue(null),
}));

vi.mock("../lib/communication-service", () => ({
  CommunicationService: {
    queueEmail: queueEmailMock,
    queueSms: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("../lib/ghl-queue", () => ({
  queueGHLSync: queueGHLSyncMock,
  startWorker: vi.fn(),
  shutdown: vi.fn(),
}));

vi.mock("../lib/commissions", () => ({
  ensureAffiliateProfile: ensureAffiliateProfileMock,
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

const TEST_TAG = `yse-grant-test-${randomUUID().slice(0, 8)}`;
const seededUserIds: number[] = [];
const seededProductIds: number[] = [];
const seededWebhookLogIds: number[] = [];
const seededApiKeyIds: number[] = [];

let app: ReturnType<typeof buildTestApp>;
let validApiKey: string;
let limitedApiKey: string;

async function insertTestProduct(slug: string, durationDays?: number) {
  const [p] = await db
    .insert(productsTable)
    .values({
      slug: `${TEST_TAG}-${slug}`,
      name: `Test ${slug}`,
      type: "frontend",
      thrivecartProductId: null,
      entitlementKeys: ["content:frontend"],
      priceDisplay: "$67",
      sortOrder: 999,
      ...(durationDays ? { durationDays } : {}),
    })
    .returning();
  seededProductIds.push(p.id);
  return p;
}

async function createApiKey(permissions: string[]): Promise<{ rawKey: string; keyId: number; adminId: number }> {
  const adminEmail = `${TEST_TAG}-admin-${randomUUID().slice(0, 6)}@example.test`;
  const passwordHash = await bcrypt.hash("irrelevant", 4);
  const [admin] = await db
    .insert(usersTable)
    .values({
      email: adminEmail,
      name: "Test Admin",
      passwordHash,
      role: "admin",
      sourceProduct: "lifetime",
      emailVerified: true,
      onboardingComplete: true,
    })
    .returning({ id: usersTable.id });
  seededUserIds.push(admin.id);

  const randomPart = randomBytes(24).toString("hex");
  const env = "live";
  const rawKey = `bts_${env}_sk_${randomPart}`;
  const prefix = `bts_${env}_sk_${randomPart.substring(0, 8)}`;
  const keyHash = await bcrypt.hash(rawKey, 4);

  const [keyRow] = await db
    .insert(apiKeysTable)
    .values({
      name: `${TEST_TAG}-yse-key`,
      prefix,
      keyHash,
      type: "secret",
      environment: env,
      permissions,
      rateLimitTier: "standard",
      createdById: admin.id,
    })
    .returning({ id: apiKeysTable.id });
  seededApiKeyIds.push(keyRow.id);

  return { rawKey, keyId: keyRow.id, adminId: admin.id };
}

let frontEndProduct: { id: number; slug: string };
let bumpProduct: { id: number; slug: string };
let blitzProduct: { id: number; slug: string };

beforeAll(async () => {
  app = buildTestApp({ routers: [integrationsRouter] });

  frontEndProduct = await insertTestProduct("yse-front-end");
  bumpProduct = await insertTestProduct("yse-bump");
  blitzProduct = await insertTestProduct("yse-blitz", 21);

  const { rawKey: vk } = await createApiKey(["integrations:grant_products"]);
  validApiKey = vk;

  const { rawKey: lk } = await createApiKey(["some:other_scope"]);
  limitedApiKey = lk;
});

afterAll(async () => {
  if (seededApiKeyIds.length > 0) {
    await db.delete(apiKeysTable).where(inArray(apiKeysTable.id, seededApiKeyIds));
  }
  if (seededWebhookLogIds.length > 0) {
    await db.delete(webhookLogsTable).where(inArray(webhookLogsTable.id, seededWebhookLogIds));
  }
  const testEmails = [`${TEST_TAG}@yse.test`];
  const createdUsers = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(inArray(usersTable.id, seededUserIds));
  const extraUserIds = createdUsers.map((u) => u.id);
  const allUserIds = [...new Set([...seededUserIds, ...extraUserIds])];

  if (allUserIds.length > 0) {
    await db.delete(userProductsTable).where(inArray(userProductsTable.userId, allUserIds));
    await db.delete(usersTable).where(inArray(usersTable.id, allUserIds));
  }

  const allTestEmails = [
    `${TEST_TAG}@yse.test`,
    `existing-${TEST_TAG}@yse.test`,
    `already-granted-${TEST_TAG}@yse.test`,
    `duplicate-${TEST_TAG}@yse.test`,
    `multi-${TEST_TAG}@yse.test`,
  ];
  const testUsers = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(inArray(usersTable.email, allTestEmails));
  if (testUsers.length > 0) {
    const ids = testUsers.map((u) => u.id);
    await db.delete(userProductsTable).where(inArray(userProductsTable.userId, ids));
    await db.delete(usersTable).where(inArray(usersTable.id, ids));
  }

  const testWebhookLogs = await db
    .select({ id: webhookLogsTable.id })
    .from(webhookLogsTable)
    .where(eq(webhookLogsTable.eventType, "external.grant_product"));
  if (testWebhookLogs.length > 0) {
    await db
      .delete(webhookLogsTable)
      .where(inArray(webhookLogsTable.id, testWebhookLogs.map((w) => w.id)));
  }

  if (seededProductIds.length > 0) {
    await db.delete(productsTable).where(inArray(productsTable.id, seededProductIds));
  }
});

beforeEach(() => {
  queueEmailMock.mockClear();
  queueGHLSyncMock.mockClear();
  ensureAffiliateProfileMock.mockClear();
});

const BASE_URL = "/api/integrations/grant-product";

function validBody(overrides?: Record<string, unknown>) {
  return {
    externalOrderId: `ord_${randomUUID().slice(0, 8)}`,
    externalSource: "yse",
    customer: {
      email: `${TEST_TAG}@yse.test`,
      firstName: "Jane",
      lastName: "Doe",
    },
    productSlugs: [frontEndProduct.slug],
    purchasedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("POST /api/integrations/grant-product — auth", () => {
  it("returns 401 when no Authorization header is sent", async () => {
    const res = await request(app).post(BASE_URL).send(validBody());
    expect(res.status).toBe(401);
  });

  it("returns 401 when an invalid API key is sent", async () => {
    const res = await request(app)
      .post(BASE_URL)
      .set("Authorization", "Bearer bts_live_sk_notarealkey1234567890")
      .send(validBody());
    expect(res.status).toBe(401);
  });

  it("returns 403 when the API key lacks integrations:grant_products scope", async () => {
    const res = await request(app)
      .post(BASE_URL)
      .set("Authorization", `Bearer ${limitedApiKey}`)
      .send(validBody());
    expect(res.status).toBe(403);
  });
});

describe("POST /api/integrations/grant-product — validation", () => {
  it("returns 400 when email is missing", async () => {
    const body = validBody();
    (body as any).customer = { firstName: "Jane" };
    const res = await request(app)
      .post(BASE_URL)
      .set("Authorization", `Bearer ${validApiKey}`)
      .send(body);
    expect(res.status).toBe(400);
  });

  it("returns 400 when productSlugs is empty", async () => {
    const res = await request(app)
      .post(BASE_URL)
      .set("Authorization", `Bearer ${validApiKey}`)
      .send(validBody({ productSlugs: [] }));
    expect(res.status).toBe(400);
  });
});

describe("POST /api/integrations/grant-product — product lookup", () => {
  it("returns 404 listing unknown slug(s) when a product slug does not exist", async () => {
    const res = await request(app)
      .post(BASE_URL)
      .set("Authorization", `Bearer ${validApiKey}`)
      .send(
        validBody({
          productSlugs: ["no-such-product-slug-xyz"],
          externalOrderId: `ord_unknown_${randomUUID().slice(0, 8)}`,
        })
      );
    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).toMatch(/no-such-product-slug-xyz/);
  });
});

describe("POST /api/integrations/grant-product — happy paths", () => {
  it("(1) new customer: creates user, grants product, queues welcome email, returns 200", async () => {
    const newEmail = `${TEST_TAG}@yse.test`;
    const orderId = `ord_new_${randomUUID().slice(0, 8)}`;

    const res = await request(app)
      .post(BASE_URL)
      .set("Authorization", `Bearer ${validApiKey}`)
      .send(
        validBody({
          customer: { email: newEmail, firstName: "Jane", lastName: "Doe" },
          externalOrderId: orderId,
          productSlugs: [frontEndProduct.slug],
        })
      );

    expect(res.status).toBe(200);
    expect(res.body.userCreated).toBe(true);
    expect(res.body.welcomeEmailQueued).toBe(true);
    expect(res.body.grants).toHaveLength(1);
    expect(res.body.grants[0].productSlug).toBe(frontEndProduct.slug);
    expect(res.body.grants[0].alreadyGranted).toBe(false);
    expect(typeof res.body.userId).toBe("number");

    const [createdUser] = await db
      .select({ id: usersTable.id, email: usersTable.email })
      .from(usersTable)
      .where(eq(usersTable.email, newEmail));
    expect(createdUser).toBeDefined();

    expect(queueEmailMock).toHaveBeenCalledOnce();
    expect(queueEmailMock.mock.calls[0][0]).toMatchObject({
      templateSlug: "welcome",
      to: newEmail,
    });

    expect(queueGHLSyncMock).toHaveBeenCalled();
  });

  it("(2) existing customer: re-uses user, grants product, does NOT queue welcome email", async () => {
    const existingEmail = `existing-${TEST_TAG}@yse.test`;
    const passwordHash = await bcrypt.hash("ExistingPass1!", 4);
    const [existingUser] = await db
      .insert(usersTable)
      .values({
        email: existingEmail,
        name: "Existing User",
        passwordHash,
        sourceProduct: "backroad",
        emailVerified: true,
        onboardingComplete: true,
      })
      .returning({ id: usersTable.id });
    seededUserIds.push(existingUser.id);

    const res = await request(app)
      .post(BASE_URL)
      .set("Authorization", `Bearer ${validApiKey}`)
      .send(
        validBody({
          customer: { email: existingEmail },
          externalOrderId: `ord_existing_${randomUUID().slice(0, 8)}`,
          productSlugs: [frontEndProduct.slug],
        })
      );

    expect(res.status).toBe(200);
    expect(res.body.userCreated).toBe(false);
    expect(res.body.welcomeEmailQueued).toBe(false);
    expect(res.body.userId).toBe(existingUser.id);
    expect(res.body.grants[0].alreadyGranted).toBe(false);

    expect(queueEmailMock).not.toHaveBeenCalled();
  });

  it("(3) already-granted product returns alreadyGranted: true for that slug", async () => {
    const alreadyEmail = `already-granted-${TEST_TAG}@yse.test`;
    const passwordHash = await bcrypt.hash("Pass123!", 4);
    const [user] = await db
      .insert(usersTable)
      .values({
        email: alreadyEmail,
        name: "Already Granted",
        passwordHash,
        sourceProduct: "backroad",
        emailVerified: true,
        onboardingComplete: true,
      })
      .returning({ id: usersTable.id });
    seededUserIds.push(user.id);

    await db.insert(userProductsTable).values({
      userId: user.id,
      productId: frontEndProduct.id,
      status: "active",
    });

    const res = await request(app)
      .post(BASE_URL)
      .set("Authorization", `Bearer ${validApiKey}`)
      .send(
        validBody({
          customer: { email: alreadyEmail },
          externalOrderId: `ord_already_${randomUUID().slice(0, 8)}`,
          productSlugs: [frontEndProduct.slug],
        })
      );

    expect(res.status).toBe(200);
    expect(res.body.grants).toHaveLength(1);
    expect(res.body.grants[0].alreadyGranted).toBe(true);
    expect(res.body.welcomeEmailQueued).toBe(false);
  });

  it("(4) duplicate externalOrderId+externalSource returns cached response without re-running side effects", async () => {
    const dupEmail = `duplicate-${TEST_TAG}@yse.test`;
    const dupOrderId = `ord_dup_${randomUUID().slice(0, 8)}`;

    const first = await request(app)
      .post(BASE_URL)
      .set("Authorization", `Bearer ${validApiKey}`)
      .send(
        validBody({
          customer: { email: dupEmail, firstName: "Dup", lastName: "User" },
          externalOrderId: dupOrderId,
          productSlugs: [frontEndProduct.slug],
        })
      );
    expect(first.status).toBe(200);

    queueEmailMock.mockClear();
    queueGHLSyncMock.mockClear();
    ensureAffiliateProfileMock.mockClear();

    const second = await request(app)
      .post(BASE_URL)
      .set("Authorization", `Bearer ${validApiKey}`)
      .send(
        validBody({
          customer: { email: dupEmail, firstName: "Dup", lastName: "User" },
          externalOrderId: dupOrderId,
          productSlugs: [frontEndProduct.slug],
        })
      );

    expect(second.status).toBe(200);
    expect(second.body).toEqual(first.body);
    expect(queueEmailMock).not.toHaveBeenCalled();
    expect(queueGHLSyncMock).not.toHaveBeenCalled();
    expect(ensureAffiliateProfileMock).not.toHaveBeenCalled();
  });

  it("(9) multi-product call grants all products in one request", async () => {
    const multiEmail = `multi-${TEST_TAG}@yse.test`;
    const res = await request(app)
      .post(BASE_URL)
      .set("Authorization", `Bearer ${validApiKey}`)
      .send(
        validBody({
          customer: { email: multiEmail, firstName: "Multi", lastName: "Buyer" },
          externalOrderId: `ord_multi_${randomUUID().slice(0, 8)}`,
          productSlugs: [frontEndProduct.slug, bumpProduct.slug, blitzProduct.slug],
        })
      );

    expect(res.status).toBe(200);
    expect(res.body.grants).toHaveLength(3);
    expect(res.body.grants.every((g: { alreadyGranted: boolean }) => !g.alreadyGranted)).toBe(true);
    expect(res.body.userCreated).toBe(true);
    expect(res.body.welcomeEmailQueued).toBe(true);

    const granted = await db
      .select({ id: userProductsTable.id })
      .from(userProductsTable)
      .where(eq(userProductsTable.userId, res.body.userId));
    expect(granted.length).toBeGreaterThanOrEqual(3);
  });
});
