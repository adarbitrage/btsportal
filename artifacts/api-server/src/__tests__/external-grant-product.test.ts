import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  vi,
} from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import {
  db,
  usersTable,
  productsTable,
  userProductsTable,
  webhookLogsTable,
  apiKeysTable,
  onboardingEffectsTable,
  partnerAssignmentsTable,
  sequenceEnrollmentsTable,
} from "@workspace/db";
import { eq, inArray, and } from "drizzle-orm";

const { queueEmailMock, queueSmsMock } = vi.hoisted(() => ({
  queueEmailMock: vi.fn(async () => ({ result: "queued" as const })),
  queueSmsMock: vi.fn(async () => ({ result: "queued" as const })),
}));

const { queueGHLSyncMock } = vi.hoisted(() => ({
  queueGHLSyncMock: vi.fn<(params: unknown) => Promise<string>>(
    async () => "ghl_job_id",
  ),
}));

vi.mock("../lib/communication-service", () => ({
  CommunicationService: {
    queueEmail: queueEmailMock,
    queueSms: queueSmsMock,
  },
}));

vi.mock("../lib/ghl-queue", () => ({
  queueGHLSync: queueGHLSyncMock,
  startWorker: vi.fn(),
  shutdown: vi.fn(),
}));

vi.mock("../lib/redis", () => ({
  getRedis: () => null,
  getRedisConnection: vi.fn(),
  createRedisConnection: vi.fn(),
  isRedisConnected: vi.fn(async () => false),
}));

import { buildTestApp } from "./test-app";
import integrationsRouter from "../routes/integrations";

const TEST_TAG = `ext-grant-test-${randomUUID().slice(0, 8)}`;

const seededUserIds: number[] = [];
const seededProductIds: number[] = [];
const seededApiKeyIds: number[] = [];
const seededWebhookLogIds: number[] = [];

let app: ReturnType<typeof buildTestApp>;

let validApiKey: string;
let limitedApiKey: string;

let yseProduct1Id: number;
let yseProduct2Id: number;
let yseProduct3Id: number;

const yseSlug1 = `${TEST_TAG}_product_a`;
const yseSlug2 = `${TEST_TAG}_product_b`;
const yseSlug3 = `${TEST_TAG}_product_c`;

function makeRawKey(env = "live", type = "sk"): string {
  const random = randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");
  return `bts_${env}_${type}_${random}`;
}

function keyPrefix(rawKey: string): string {
  const parts = rawKey.split("_");
  return parts.slice(0, 3).join("_") + "_" + parts[3].substring(0, 8);
}

beforeAll(async () => {
  app = buildTestApp({ routers: [integrationsRouter] });

  const [adminUser] = await db
    .insert(usersTable)
    .values({
      name: "Test Admin",
      email: `${TEST_TAG}-admin@example.test`,
      passwordHash: await bcrypt.hash("AdminPass1!", 4),
      role: "admin",
      sourceProduct: "lifetime",
      emailVerified: true,
    })
    .returning();
  seededUserIds.push(adminUser.id);

  const insertedProducts = await db
    .insert(productsTable)
    .values([
      {
        slug: yseSlug1,
        name: `${TEST_TAG} YSE Front End`,
        type: "frontend",
        entitlementKeys: ["content:frontend", "support:basic"],
        priceDisplay: "$67",
        sortOrder: 900,
      },
      {
        slug: yseSlug2,
        name: `${TEST_TAG} YSE Bump`,
        type: "frontend",
        entitlementKeys: ["content:frontend", "support:basic"],
        priceDisplay: "$47",
        sortOrder: 901,
      },
      {
        slug: yseSlug3,
        name: `${TEST_TAG} YSE Blitz`,
        type: "backend",
        entitlementKeys: ["content:frontend", "content:advanced"],
        priceDisplay: "$297",
        sortOrder: 902,
      },
    ])
    .returning();

  for (const p of insertedProducts) {
    seededProductIds.push(p.id);
  }
  yseProduct1Id = insertedProducts[0].id;
  yseProduct2Id = insertedProducts[1].id;
  yseProduct3Id = insertedProducts[2].id;

  const rawValid = makeRawKey();
  validApiKey = rawValid;
  const [validKey] = await db
    .insert(apiKeysTable)
    .values({
      name: `${TEST_TAG} Valid Key`,
      prefix: keyPrefix(rawValid),
      keyHash: await bcrypt.hash(rawValid, 4),
      type: "secret",
      environment: "live",
      permissions: ["integrations:grant_products"],
      rateLimitTier: "standard",
      createdById: adminUser.id,
    })
    .returning();
  seededApiKeyIds.push(validKey.id);

  const rawLimited = makeRawKey();
  limitedApiKey = rawLimited;
  const [limitedKey] = await db
    .insert(apiKeysTable)
    .values({
      name: `${TEST_TAG} Limited Key`,
      prefix: keyPrefix(rawLimited),
      keyHash: await bcrypt.hash(rawLimited, 4),
      type: "secret",
      environment: "live",
      permissions: [],
      rateLimitTier: "standard",
      createdById: adminUser.id,
    })
    .returning();
  seededApiKeyIds.push(limitedKey.id);
});

afterAll(async () => {
  if (seededWebhookLogIds.length > 0) {
    await db
      .delete(webhookLogsTable)
      .where(inArray(webhookLogsTable.id, seededWebhookLogIds));
  }

  await db
    .delete(userProductsTable)
    .where(inArray(userProductsTable.productId, seededProductIds));

  const testUserRows = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(inArray(usersTable.id, seededUserIds));

  const testEmailUsers = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(
      inArray(
        usersTable.email,
        [
          `${TEST_TAG}-new@example.test`,
          `${TEST_TAG}-existing@example.test`,
          `${TEST_TAG}-multi@example.test`,
          `${TEST_TAG}-already@example.test`,
          `${TEST_TAG}-idem@example.test`,
        ],
      ),
    );

  const allIds = [
    ...seededUserIds,
    ...testUserRows.map((r) => r.id),
    ...testEmailUsers.map((r) => r.id),
  ];
  const uniqueIds = [...new Set(allIds)];

  if (seededApiKeyIds.length > 0) {
    await db
      .delete(apiKeysTable)
      .where(inArray(apiKeysTable.id, seededApiKeyIds));
  }

  if (uniqueIds.length > 0) {
    // insertUserProductGrant fires the onboarding-upgrade + partner-assignment
    // hooks (Task #1642/#1658) for every grant this file exercises, so their
    // FK-referencing rows must be cleared before the user rows themselves.
    await db.delete(onboardingEffectsTable).where(inArray(onboardingEffectsTable.userId, uniqueIds));
    await db.delete(partnerAssignmentsTable).where(inArray(partnerAssignmentsTable.memberId, uniqueIds));
    await db.delete(sequenceEnrollmentsTable).where(inArray(sequenceEnrollmentsTable.userId, uniqueIds));
    await db.delete(usersTable).where(inArray(usersTable.id, uniqueIds));
  }

  if (seededProductIds.length > 0) {
    await db
      .delete(productsTable)
      .where(inArray(productsTable.id, seededProductIds));
  }

  await db.delete(webhookLogsTable).where(
    inArray(webhookLogsTable.eventType, [
      `yse.grant_product`,
      `testint.grant_product`,
    ]),
  );
});

beforeEach(() => {
  queueEmailMock.mockClear();
  queueSmsMock.mockClear();
  queueGHLSyncMock.mockClear();
});

function basePayload(overrides: Record<string, unknown> = {}) {
  return {
    externalOrderId: `order_${randomUUID().slice(0, 8)}`,
    externalSource: "yse",
    customer: {
      email: `${TEST_TAG}-new@example.test`,
      firstName: "New",
      lastName: "Customer",
    },
    productSlugs: [yseSlug1],
    purchasedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("POST /api/integrations/grant-product", () => {
  describe("(1) new customer happy path", () => {
    it("creates user, grants product, queues welcome email, returns 200 with full response", async () => {
      const orderId = `order_${randomUUID().slice(0, 8)}`;
      const email = `${TEST_TAG}-new@example.test`;

      const res = await request(app)
        .post("/api/integrations/grant-product")
        .set("Authorization", `Bearer ${validApiKey}`)
        .send({
          externalOrderId: orderId,
          externalSource: "yse",
          customer: { email, firstName: "New", lastName: "User" },
          productSlugs: [yseSlug1],
          purchasedAt: new Date().toISOString(),
        });

      expect(res.status).toBe(200);
      expect(res.body.userCreated).toBe(true);
      expect(typeof res.body.userId).toBe("number");
      expect(res.body.welcomeEmailQueued).toBe(true);
      expect(res.body.grants).toHaveLength(1);
      expect(res.body.grants[0].productSlug).toBe(yseSlug1);
      expect(res.body.grants[0].productId).toBe(yseProduct1Id);
      expect(res.body.grants[0].alreadyGranted).toBe(false);
      expect(typeof res.body.grants[0].userProductId).toBe("number");

      const [user] = await db
        .select()
        .from(usersTable)
        .where(eq(usersTable.email, email))
        .limit(1);
      expect(user).toBeDefined();
      // sourceProduct is now derived from the granted frontend product slug,
      // not hardcoded to "yse". yseSlug1 has type="frontend" so it becomes
      // the brand slug for this new user.
      expect(user.sourceProduct).toBe(yseSlug1);
      seededUserIds.push(user.id);

      expect(queueEmailMock).toHaveBeenCalledWith(
        expect.objectContaining({ templateSlug: "welcome", to: email }),
      );
    });
  });

  describe("(2) existing customer", () => {
    it("reuses existing user, grants product, does NOT queue welcome email", async () => {
      const email = `${TEST_TAG}-existing@example.test`;
      const passwordHash = await bcrypt.hash("Existing1!", 4);
      const [existingUser] = await db
        .insert(usersTable)
        .values({
          name: "Existing User",
          email,
          passwordHash,
          sourceProduct: "backroad",
          emailVerified: true,
        })
        .returning();
      seededUserIds.push(existingUser.id);

      const orderId = `order_${randomUUID().slice(0, 8)}`;
      const res = await request(app)
        .post("/api/integrations/grant-product")
        .set("Authorization", `Bearer ${validApiKey}`)
        .send({
          externalOrderId: orderId,
          externalSource: "yse",
          customer: { email, firstName: "Existing", lastName: "User" },
          productSlugs: [yseSlug1],
          purchasedAt: new Date().toISOString(),
        });

      expect(res.status).toBe(200);
      expect(res.body.userCreated).toBe(false);
      expect(res.body.userId).toBe(existingUser.id);
      expect(res.body.welcomeEmailQueued).toBe(false);
      expect(res.body.grants[0].alreadyGranted).toBe(false);

      expect(queueEmailMock).not.toHaveBeenCalledWith(
        expect.objectContaining({ templateSlug: "welcome" }),
      );
    });
  });

  describe("(3) already-granted product", () => {
    it("returns alreadyGranted: true for a product the user already has active", async () => {
      const email = `${TEST_TAG}-already@example.test`;
      const passwordHash = await bcrypt.hash("Already1!", 4);
      const [existingUser] = await db
        .insert(usersTable)
        .values({
          name: "Already Granted User",
          email,
          passwordHash,
          sourceProduct: "yse",
          emailVerified: true,
        })
        .returning();
      seededUserIds.push(existingUser.id);

      const [existingGrant] = await db
        .insert(userProductsTable)
        .values({
          userId: existingUser.id,
          productId: yseProduct1Id,
          status: "active",
          externalSource: "yse",
          externalOrderId: `prev_order_${randomUUID().slice(0, 8)}`,
        })
        .returning();

      const res = await request(app)
        .post("/api/integrations/grant-product")
        .set("Authorization", `Bearer ${validApiKey}`)
        .send({
          externalOrderId: `order_${randomUUID().slice(0, 8)}`,
          externalSource: "yse",
          customer: { email },
          productSlugs: [yseSlug1],
          purchasedAt: new Date().toISOString(),
        });

      expect(res.status).toBe(200);
      expect(res.body.grants[0].alreadyGranted).toBe(true);
      expect(res.body.grants[0].userProductId).toBe(existingGrant.id);
    });
  });

  describe("(4) idempotency — duplicate externalOrderId+externalSource", () => {
    it("returns cached response and does NOT trigger double side effects", async () => {
      const orderId = `order_idem_${randomUUID().slice(0, 8)}`;
      const email = `${TEST_TAG}-idem@example.test`;

      const firstRes = await request(app)
        .post("/api/integrations/grant-product")
        .set("Authorization", `Bearer ${validApiKey}`)
        .send({
          externalOrderId: orderId,
          externalSource: "testint",
          customer: { email, firstName: "Idem", lastName: "User" },
          productSlugs: [yseSlug2],
          purchasedAt: new Date().toISOString(),
        });

      expect(firstRes.status).toBe(200);
      const firstBody = firstRes.body;

      const firstUser = await db
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(eq(usersTable.email, email))
        .limit(1);
      if (firstUser[0]) seededUserIds.push(firstUser[0].id);

      queueEmailMock.mockClear();
      queueGHLSyncMock.mockClear();

      const secondRes = await request(app)
        .post("/api/integrations/grant-product")
        .set("Authorization", `Bearer ${validApiKey}`)
        .send({
          externalOrderId: orderId,
          externalSource: "testint",
          customer: { email, firstName: "Idem", lastName: "User" },
          productSlugs: [yseSlug2],
          purchasedAt: new Date().toISOString(),
        });

      expect(secondRes.status).toBe(200);
      expect(secondRes.body).toEqual(firstBody);

      expect(queueEmailMock).not.toHaveBeenCalled();
      expect(queueGHLSyncMock).not.toHaveBeenCalled();
    });
  });

  describe("(4b) concurrent duplicate requests — race-condition idempotency", () => {
    it("fires two identical requests simultaneously and grants products exactly once", async () => {
      const orderId = `order_race_${randomUUID().slice(0, 8)}`;
      const email = `${TEST_TAG}-race@example.test`;

      const sendRequest = () =>
        request(app)
          .post("/api/integrations/grant-product")
          .set("Authorization", `Bearer ${validApiKey}`)
          .send({
            externalOrderId: orderId,
            externalSource: "testint",
            customer: { email, firstName: "Race", lastName: "Condition" },
            productSlugs: [yseSlug1],
            purchasedAt: new Date().toISOString(),
          });

      const [res1, res2] = await Promise.all([sendRequest(), sendRequest()]);

      // Both must succeed
      expect(res1.status).toBe(200);
      expect(res2.status).toBe(200);

      // Both must return the same shape
      expect(res1.body.grants).toHaveLength(1);
      expect(res2.body.grants).toHaveLength(1);

      // Exactly one user account for this email
      const users = await db
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(eq(usersTable.email, email));
      expect(users).toHaveLength(1);
      seededUserIds.push(users[0].id);

      // Exactly one active user_product row — no double-grant
      const grants = await db
        .select({ id: userProductsTable.id })
        .from(userProductsTable)
        .where(
          and(
            eq(userProductsTable.userId, users[0].id),
            eq(userProductsTable.externalOrderId, orderId),
          ),
        );
      expect(grants).toHaveLength(1);

      // Exactly one webhook_log row for this external id
      const logs = await db
        .select({ id: webhookLogsTable.id, status: webhookLogsTable.status })
        .from(webhookLogsTable)
        .where(eq(webhookLogsTable.externalId, `testint_${orderId}`));
      expect(logs).toHaveLength(1);
      expect(logs[0].status).toBe("processed");
    });
  });

  describe("(5) missing API key", () => {
    it("returns 401 when no Authorization header is provided", async () => {
      const res = await request(app)
        .post("/api/integrations/grant-product")
        .send(basePayload());

      expect(res.status).toBe(401);
    });
  });

  describe("(6) API key without integrations:grant_products scope", () => {
    it("returns 403 when key lacks the required scope", async () => {
      const res = await request(app)
        .post("/api/integrations/grant-product")
        .set("Authorization", `Bearer ${limitedApiKey}`)
        .send(basePayload());

      expect(res.status).toBe(403);
    });
  });

  describe("(7) malformed payload — missing email", () => {
    it("returns 400 when customer.email is absent", async () => {
      const res = await request(app)
        .post("/api/integrations/grant-product")
        .set("Authorization", `Bearer ${validApiKey}`)
        .send({
          externalOrderId: `order_${randomUUID().slice(0, 8)}`,
          externalSource: "yse",
          customer: { firstName: "No", lastName: "Email" },
          productSlugs: [yseSlug1],
          purchasedAt: new Date().toISOString(),
        });

      expect(res.status).toBe(400);
    });
  });

  describe("(8) unknown product slug", () => {
    it("returns 404 listing the unknown slug(s)", async () => {
      const res = await request(app)
        .post("/api/integrations/grant-product")
        .set("Authorization", `Bearer ${validApiKey}`)
        .send({
          externalOrderId: `order_${randomUUID().slice(0, 8)}`,
          externalSource: "yse",
          customer: { email: `${TEST_TAG}-unknown@example.test` },
          productSlugs: ["definitely_does_not_exist_slug_xyz"],
          purchasedAt: new Date().toISOString(),
        });

      expect(res.status).toBe(404);
      expect(res.body.error.details.unknownSlugs).toContain(
        "definitely_does_not_exist_slug_xyz",
      );
    });
  });

  describe("(9) multi-product call", () => {
    it("grants all 3 products in one transaction with correct response shape", async () => {
      const email = `${TEST_TAG}-multi@example.test`;
      const orderId = `order_multi_${randomUUID().slice(0, 8)}`;

      const res = await request(app)
        .post("/api/integrations/grant-product")
        .set("Authorization", `Bearer ${validApiKey}`)
        .send({
          externalOrderId: orderId,
          externalSource: "yse",
          customer: { email, firstName: "Multi", lastName: "Product" },
          productSlugs: [yseSlug1, yseSlug2, yseSlug3],
          purchasedAt: new Date().toISOString(),
          metadata: { funnelSlug: "yse_main_funnel" },
        });

      expect(res.status).toBe(200);
      expect(res.body.userCreated).toBe(true);
      expect(res.body.welcomeEmailQueued).toBe(true);
      expect(res.body.grants).toHaveLength(3);

      const slugsGranted = res.body.grants.map(
        (g: { productSlug: string }) => g.productSlug,
      );
      expect(slugsGranted).toContain(yseSlug1);
      expect(slugsGranted).toContain(yseSlug2);
      expect(slugsGranted).toContain(yseSlug3);

      for (const grant of res.body.grants) {
        expect(grant.alreadyGranted).toBe(false);
        expect(typeof grant.userProductId).toBe("number");
      }

      const multiUser = await db
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(eq(usersTable.email, email))
        .limit(1);
      if (multiUser[0]) seededUserIds.push(multiUser[0].id);

      const grantedRows = await db
        .select()
        .from(userProductsTable)
        .where(
          and(
            eq(userProductsTable.userId, multiUser[0]!.id),
            eq(userProductsTable.externalOrderId, orderId),
          ),
        );
      expect(grantedRows).toHaveLength(3);
      expect(grantedRows[0].externalSource).toBe("yse");
      expect(grantedRows[0].externalOrderId).toBe(orderId);
    });
  });
});
