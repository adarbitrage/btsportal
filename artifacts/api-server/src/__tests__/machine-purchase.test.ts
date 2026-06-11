import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import {
  db,
  usersTable,
  productsTable,
  userProductsTable,
  webhookLogsTable,
} from "@workspace/db";
import { eq, inArray, and } from "drizzle-orm";

const { TEST_SECRET, queueEmailMock, queueGHLSyncMock, ensureAffiliateProfileMock } = vi.hoisted(() => {
  const secret = "test-machine-secret-" + Math.random().toString(36).slice(2);
  process.env.MACHINE_PORTAL_SHARED_SECRET = secret;
  return {
    TEST_SECRET: secret,
    queueEmailMock: vi.fn().mockResolvedValue(undefined),
    queueGHLSyncMock: vi.fn().mockResolvedValue("job_test_id"),
    ensureAffiliateProfileMock: vi.fn().mockResolvedValue(null),
  };
});

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

const TEST_TAG = `machine-test-${randomUUID().slice(0, 8)}`;
const URL = "/api/integrations/machine-purchase";

const seededUserIds: number[] = [];
const seededProductIds: number[] = [];
const seededOtherProductIds: number[] = [];

let app: ReturnType<typeof buildTestApp>;
let yseFrontEndExistingId: number | null = null;
let mentorshipProductId: number;

async function ensureYseFrontEndProduct(): Promise<number> {
  const [existing] = await db
    .select({ id: productsTable.id })
    .from(productsTable)
    .where(eq(productsTable.slug, "yse_front_end"))
    .limit(1);
  if (existing) {
    yseFrontEndExistingId = existing.id;
    return existing.id;
  }
  const [created] = await db
    .insert(productsTable)
    .values({
      slug: "yse_front_end",
      name: "YSE Front End",
      type: "frontend",
      entitlementKeys: ["content:frontend", "support:basic", "chat:basic"],
      priceDisplay: "$67",
      sortOrder: 900,
    })
    .returning({ id: productsTable.id });
  seededProductIds.push(created.id);
  return created.id;
}

beforeAll(async () => {
  app = buildTestApp({ routers: [integrationsRouter] });
  await ensureYseFrontEndProduct();

  const [mentorship] = await db
    .insert(productsTable)
    .values({
      slug: `${TEST_TAG}-mentorship`,
      name: "Test 1-Year Mentorship",
      type: "backend",
      entitlementKeys: ["content:advanced", "support:standard"],
      priceDisplay: "$1997",
      sortOrder: 999,
    })
    .returning({ id: productsTable.id });
  seededOtherProductIds.push(mentorship.id);
  mentorshipProductId = mentorship.id;
});

afterAll(async () => {
  if (seededUserIds.length > 0) {
    await db.delete(userProductsTable).where(inArray(userProductsTable.userId, seededUserIds));
    await db.delete(usersTable).where(inArray(usersTable.id, seededUserIds));
  }
  await db
    .delete(webhookLogsTable)
    .where(eq(webhookLogsTable.eventType, "external.grant_product"));
  if (seededOtherProductIds.length > 0) {
    await db.delete(productsTable).where(inArray(productsTable.id, seededOtherProductIds));
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

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    order_number: `tm_ord_${randomUUID().slice(0, 8)}`,
    email: `${TEST_TAG}-${randomUUID().slice(0, 6)}@machine.test`,
    first_name: "Jane",
    last_name: "Doe",
    phone: "+15551234567",
    funnel_slug: "yse-workshop",
    product_ids: ["wsh_001"],
    total_cents: 2700,
    occurred_at: new Date().toISOString(),
    tm_click_id: "tmc_xyz",
    tap_ref: "affiliatecode123",
    ...overrides,
  };
}

describe("POST /api/integrations/machine-purchase — auth", () => {
  it("returns 401 with INVALID_SECRET when header is missing", async () => {
    const res = await request(app).post(URL).send(validBody());
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: { code: "INVALID_SECRET" } });
  });

  it("returns 401 with INVALID_SECRET when header is wrong", async () => {
    const body = validBody();
    const res = await request(app)
      .post(URL)
      .set("X-Machine-Webhook-Secret", "wrong-secret")
      .send(body);
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: { code: "INVALID_SECRET" } });

    const log = await db
      .select({ id: webhookLogsTable.id })
      .from(webhookLogsTable)
      .where(eq(webhookLogsTable.externalId, `machine_${body.order_number}`));
    expect(log).toHaveLength(0);
  });

  it("returns 401 when a same-length but wrong secret is sent (timing-safe check)", async () => {
    const wrong = "x".repeat(TEST_SECRET.length);
    const res = await request(app)
      .post(URL)
      .set("X-Machine-Webhook-Secret", wrong)
      .send(validBody());
    expect(res.status).toBe(401);
  });
});

describe("POST /api/integrations/machine-purchase — validation", () => {
  function authedPost(body: object) {
    return request(app).post(URL).set("X-Machine-Webhook-Secret", TEST_SECRET).send(body);
  }

  it("returns 400 when order_number is missing", async () => {
    const body = validBody();
    delete (body as Record<string, unknown>).order_number;
    const res = await authedPost(body);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 when email is missing or invalid", async () => {
    const res = await authedPost(validBody({ email: "not-an-email" }));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 when funnel_slug is missing or unknown", async () => {
    const res = await authedPost(validBody({ funnel_slug: "made-up-funnel" }));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 when occurred_at is missing", async () => {
    const body = validBody();
    delete (body as Record<string, unknown>).occurred_at;
    const res = await authedPost(body);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("accepts null for every optional field (phone, names, ids, click ids, total_cents)", async () => {
    const body = validBody({
      email: `${TEST_TAG}-allnulls@machine.test`,
      order_number: `tm_ord_nulls_${randomUUID().slice(0, 6)}`,
      first_name: null,
      last_name: null,
      phone: null,
      product_ids: null,
      total_cents: null,
      tm_click_id: null,
      tap_ref: null,
    });
    const res = await authedPost(body);
    expect([200, 201]).toContain(res.status);
    expect(res.body.error).toBeUndefined();
    if (res.body.userId) seededUserIds.push(res.body.userId);
  });

  it("rejects wrong types on optional fields with VALIDATION_ERROR (null is OK, 123 is not)", async () => {
    const res = await authedPost(
      validBody({
        email: `${TEST_TAG}-badphone@machine.test`,
        order_number: `tm_ord_badphone_${randomUUID().slice(0, 6)}`,
        phone: 5551234567,
      }),
    );
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("accepts all valid funnel_slug values (YSE + 5 brand workshops and ebooks)", async () => {
    const allSlugs = [
      "yse-workshop",
      "yse-ebook",
      "your-second-engine",
      "backroad-system-workshop",
      "backroad-system-ebook",
      "off-market-affiliate-workshop",
      "off-market-affiliate-ebook",
      "reserve-income-workshop",
      "reserve-income-ebook",
      "silent-partner-workshop",
      "silent-partner-ebook",
      "test-like-mad-workshop",
      "test-like-mad-ebook",
    ];
    for (const slug of allSlugs) {
      const tag = slug.slice(0, 12).replace(/-/g, "");
      const res = await authedPost(
        validBody({
          funnel_slug: slug,
          email: `${TEST_TAG}-fn-${tag}@machine.test`,
          order_number: `tm_fn_${tag}_${randomUUID().slice(0, 6)}`,
        }),
      );
      expect([200, 201]).toContain(res.status);
      if (res.body.userId) seededUserIds.push(res.body.userId);
    }
  });
});

describe("POST /api/integrations/machine-purchase — happy paths", () => {
  function authedPost(body: object) {
    return request(app).post(URL).set("X-Machine-Webhook-Secret", TEST_SECRET).send(body);
  }

  it("first-time buyer: 201 created, queues exactly one welcome email + one GHL create_contact", async () => {
    const body = validBody({
      email: `${TEST_TAG}-firsttime@machine.test`,
      order_number: `tm_ord_first_${randomUUID().slice(0, 6)}`,
    });
    const res = await authedPost(body);

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      received: true,
      userCreated: true,
      welcomeEmailQueued: true,
    });
    expect(typeof res.body.userId).toBe("number");
    seededUserIds.push(res.body.userId);

    const welcomeCalls = queueEmailMock.mock.calls.filter(
      (c: unknown[]) => (c[0] as { templateSlug: string }).templateSlug === "welcome",
    );
    expect(welcomeCalls).toHaveLength(1);
    expect(welcomeCalls[0][0]).toMatchObject({ templateSlug: "welcome", to: body.email });

    const createContactCalls = queueGHLSyncMock.mock.calls.filter(
      (c: unknown[]) => (c[0] as { action: string }).action === "create_contact",
    );
    expect(createContactCalls).toHaveLength(1);
  });

  it("existing-member merge: 200 merged, no welcome email, keeps prior entitlements", async () => {
    const email = `${TEST_TAG}-existing@machine.test`;
    const passwordHash = await bcrypt.hash("Existing1!", 4);
    const [user] = await db
      .insert(usersTable)
      .values({
        email,
        name: "Existing Member",
        passwordHash,
        sourceProduct: "1year",
        emailVerified: true,
        onboardingComplete: true,
      })
      .returning({ id: usersTable.id });
    seededUserIds.push(user.id);

    // Pre-existing mentorship grant must not be touched
    await db.insert(userProductsTable).values({
      userId: user.id,
      productId: mentorshipProductId,
      status: "active",
    });

    const res = await authedPost(
      validBody({ email, order_number: `tm_ord_existing_${randomUUID().slice(0, 6)}` }),
    );

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      received: true,
      merged: true,
      userCreated: false,
      welcomeEmailQueued: false,
      userId: user.id,
    });

    // No welcome email queued
    const welcomeCalls = queueEmailMock.mock.calls.filter(
      (c: unknown[]) => (c[0] as { templateSlug: string }).templateSlug === "welcome",
    );
    expect(welcomeCalls).toHaveLength(0);

    // Mentorship grant must still be active (never-downgrade)
    const mentorship = await db
      .select({ id: userProductsTable.id, status: userProductsTable.status })
      .from(userProductsTable)
      .where(
        and(
          eq(userProductsTable.userId, user.id),
          eq(userProductsTable.productId, mentorshipProductId),
        ),
      );
    expect(mentorship).toHaveLength(1);
    expect(mentorship[0].status).toBe("active");

    // yse_front_end grant must now also be attached
    const fe = await db
      .select({ id: userProductsTable.id })
      .from(userProductsTable)
      .where(
        and(
          eq(userProductsTable.userId, user.id),
          eq(userProductsTable.productId, (yseFrontEndExistingId ?? seededProductIds[0])!),
        ),
      );
    expect(fe.length).toBeGreaterThanOrEqual(1);
  });

  it("deduped retry: same order_number returns 200 deduped, no new rows, no new email", async () => {
    const email = `${TEST_TAG}-dedupe@machine.test`;
    const order = `tm_ord_dupe_${randomUUID().slice(0, 6)}`;
    const body = validBody({ email, order_number: order });

    const first = await authedPost(body);
    expect([200, 201]).toContain(first.status);
    seededUserIds.push(first.body.userId);
    const userId = first.body.userId;

    const userProductsBefore = await db
      .select({ id: userProductsTable.id })
      .from(userProductsTable)
      .where(eq(userProductsTable.userId, userId));

    queueEmailMock.mockClear();
    queueGHLSyncMock.mockClear();
    ensureAffiliateProfileMock.mockClear();

    const second = await authedPost(body);
    expect(second.status).toBe(200);
    expect(second.body).toEqual({
      received: true,
      deduped: true,
      userId,
    });

    const userProductsAfter = await db
      .select({ id: userProductsTable.id })
      .from(userProductsTable)
      .where(eq(userProductsTable.userId, userId));
    expect(userProductsAfter).toHaveLength(userProductsBefore.length);

    expect(queueEmailMock).not.toHaveBeenCalled();
    expect(queueGHLSyncMock).not.toHaveBeenCalled();
    expect(ensureAffiliateProfileMock).not.toHaveBeenCalled();
  });

  it("forwards tap_ref into metadata.bts_ref for commission attribution", async () => {
    const email = `${TEST_TAG}-tap@machine.test`;
    const order = `tm_ord_tap_${randomUUID().slice(0, 6)}`;
    const res = await authedPost(
      validBody({ email, order_number: order, tap_ref: "affiliateZZZ" }),
    );
    expect([200, 201]).toContain(res.status);
    if (res.body.userId) seededUserIds.push(res.body.userId);

    const [log] = await db
      .select({ payload: webhookLogsTable.payload })
      .from(webhookLogsTable)
      .where(eq(webhookLogsTable.externalId, `machine_${order}`));
    expect(log).toBeDefined();
    const metadata = (log.payload as { metadata: Record<string, unknown> }).metadata;
    expect(metadata.bts_ref).toBe("affiliateZZZ");
    expect(metadata.funnel_slug).toBe("yse-workshop");
  });
});

// ─── Contract conformance ────────────────────────────────────────────────
// These tests pin the exact wire-contract shapes that The Machine team
// codes against. Edits to the route MUST NOT silently change these shapes
// without coordinating with the Machine team first.
describe("POST /api/integrations/machine-purchase — contract conformance", () => {
  function authedPost(body: object) {
    return request(app).post(URL).set("X-Machine-Webhook-Secret", TEST_SECRET).send(body);
  }

  it("201 first-time create shape: { received, userCreated, welcomeEmailQueued, userId }", async () => {
    const body = validBody({
      email: `${TEST_TAG}-contract-first@machine.test`,
      order_number: `tm_ord_contract_first_${randomUUID().slice(0, 6)}`,
    });
    const res = await authedPost(body);
    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      received: true,
      userCreated: true,
      welcomeEmailQueued: true,
      userId: expect.any(Number),
    });
    seededUserIds.push(res.body.userId);
  });

  it("200 existing-member merge shape: { received, merged, userId, userCreated:false, welcomeEmailQueued:false }", async () => {
    const email = `${TEST_TAG}-contract-merge@machine.test`;
    const passwordHash = await bcrypt.hash("Existing1!", 4);
    const [user] = await db
      .insert(usersTable)
      .values({
        email,
        name: "Existing",
        passwordHash,
        sourceProduct: "1year",
        emailVerified: true,
        onboardingComplete: true,
      })
      .returning({ id: usersTable.id });
    seededUserIds.push(user.id);

    const res = await authedPost(
      validBody({ email, order_number: `tm_ord_contract_merge_${randomUUID().slice(0, 6)}` }),
    );
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      received: true,
      merged: true,
      userId: user.id,
      userCreated: false,
      welcomeEmailQueued: false,
    });
  });

  it("200 duplicate order_number shape: { received, deduped, userId }", async () => {
    const body = validBody({
      email: `${TEST_TAG}-contract-dupe@machine.test`,
      order_number: `tm_ord_contract_dupe_${randomUUID().slice(0, 6)}`,
    });
    const first = await authedPost(body);
    expect([200, 201]).toContain(first.status);
    seededUserIds.push(first.body.userId);

    const second = await authedPost(body);
    expect(second.status).toBe(200);
    expect(second.body).toEqual({
      received: true,
      deduped: true,
      userId: first.body.userId,
    });
  });

  it("401 INVALID_SECRET shape on missing header: { error: { code } }", async () => {
    const res = await request(app).post(URL).send(validBody());
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: { code: "INVALID_SECRET" } });
  });

  it("401 INVALID_SECRET shape on wrong header value", async () => {
    const res = await request(app)
      .post(URL)
      .set("X-Machine-Webhook-Secret", "definitely-not-the-secret")
      .send(validBody());
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: { code: "INVALID_SECRET" } });
  });

  it("400 VALIDATION_ERROR shape on bad body: { error: { code, message, details } }", async () => {
    const body = validBody();
    delete (body as Record<string, unknown>).order_number;
    const res = await authedPost(body);
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      error: {
        code: "VALIDATION_ERROR",
        message: expect.any(String),
        details: expect.any(Object),
      },
    });
  });

  it("400 VALIDATION_ERROR shape when portal_product_keys is the wrong type", async () => {
    // Not an array at all
    const r1 = await authedPost(
      validBody({
        email: `${TEST_TAG}-ppk-bad1@machine.test`,
        order_number: `tm_ord_ppk_bad1_${randomUUID().slice(0, 6)}`,
        portal_product_keys: "yse_front_end",
      }),
    );
    expect(r1.status).toBe(400);
    expect(r1.body).toMatchObject({
      error: {
        code: "VALIDATION_ERROR",
        message: expect.any(String),
        details: { portal_product_keys: expect.any(String) },
      },
    });

    // Array with non-string entries
    const r2 = await authedPost(
      validBody({
        email: `${TEST_TAG}-ppk-bad2@machine.test`,
        order_number: `tm_ord_ppk_bad2_${randomUUID().slice(0, 6)}`,
        portal_product_keys: ["yse_front_end", 42],
      }),
    );
    expect(r2.status).toBe(400);
    expect(r2.body.error.code).toBe("VALIDATION_ERROR");

    // Array with a string that's too long (>20 chars)
    const r3 = await authedPost(
      validBody({
        email: `${TEST_TAG}-ppk-bad3@machine.test`,
        order_number: `tm_ord_ppk_bad3_${randomUUID().slice(0, 6)}`,
        portal_product_keys: ["x".repeat(21)],
      }),
    );
    expect(r3.status).toBe(400);
    expect(r3.body.error.code).toBe("VALIDATION_ERROR");

    // Array with an empty string (<1 char)
    const r4 = await authedPost(
      validBody({
        email: `${TEST_TAG}-ppk-bad4@machine.test`,
        order_number: `tm_ord_ppk_bad4_${randomUUID().slice(0, 6)}`,
        portal_product_keys: [""],
      }),
    );
    expect(r4.status).toBe(400);
    expect(r4.body.error.code).toBe("VALIDATION_ERROR");

    // Array with a string that's not snake_case-ish (uppercase letters)
    const r5 = await authedPost(
      validBody({
        email: `${TEST_TAG}-ppk-bad5@machine.test`,
        order_number: `tm_ord_ppk_bad5_${randomUUID().slice(0, 6)}`,
        portal_product_keys: ["YseFrontEnd"],
      }),
    );
    expect(r5.status).toBe(400);
    expect(r5.body.error.code).toBe("VALIDATION_ERROR");

    // Array with a string containing disallowed characters (spaces, dashes)
    const r6 = await authedPost(
      validBody({
        email: `${TEST_TAG}-ppk-bad6@machine.test`,
        order_number: `tm_ord_ppk_bad6_${randomUUID().slice(0, 6)}`,
        portal_product_keys: ["yse-front-end"],
      }),
    );
    expect(r6.status).toBe(400);
    expect(r6.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("503 SERVICE_UNAVAILABLE shape when shared secret is unset", async () => {
    const saved = process.env.MACHINE_PORTAL_SHARED_SECRET;
    delete process.env.MACHINE_PORTAL_SHARED_SECRET;
    try {
      const res = await request(app)
        .post(URL)
        .set("X-Machine-Webhook-Secret", "anything")
        .send(validBody());
      expect(res.status).toBe(503);
      expect(res.body).toEqual({ error: { code: "SERVICE_UNAVAILABLE" } });
    } finally {
      process.env.MACHINE_PORTAL_SHARED_SECRET = saved;
    }
  });
});

// ─── portal_product_keys capture ─────────────────────────────────────────
// We don't drive entitlements off this field yet (the receiver continues
// to grant only ["yse_front_end"]); we're persisting it so admins can
// reconcile "what The Machine intended to grant" against "what we
// actually granted" before flipping the switch.
describe("POST /api/integrations/machine-purchase — portal_product_keys capture", () => {
  function authedPost(body: object) {
    return request(app).post(URL).set("X-Machine-Webhook-Secret", TEST_SECRET).send(body);
  }

  async function readMetadata(order: string): Promise<Record<string, unknown>> {
    const [log] = await db
      .select({ payload: webhookLogsTable.payload })
      .from(webhookLogsTable)
      .where(eq(webhookLogsTable.externalId, `machine_${order}`));
    expect(log).toBeDefined();
    return (log.payload as { metadata: Record<string, unknown> }).metadata;
  }

  it("persists the received portal_product_keys array verbatim under metadata.portal_product_keys", async () => {
    const email = `${TEST_TAG}-ppk-ok@machine.test`;
    const order = `tm_ord_ppk_ok_${randomUUID().slice(0, 6)}`;
    // Keys must be snake_case-ish and ≤20 chars per the pinned contract;
    // both fit comfortably and represent realistic Machine product keys.
    const keys = ["yse_front_end", "yse_cmo_bump"];
    const res = await authedPost(
      validBody({ email, order_number: order, portal_product_keys: keys }),
    );
    expect([200, 201]).toContain(res.status);
    if (res.body.userId) seededUserIds.push(res.body.userId);

    const metadata = await readMetadata(order);
    expect(metadata.portal_product_keys).toEqual(keys);
  });

  it("accepts an empty array and persists [] under metadata.portal_product_keys", async () => {
    const email = `${TEST_TAG}-ppk-empty@machine.test`;
    const order = `tm_ord_ppk_empty_${randomUUID().slice(0, 6)}`;
    const res = await authedPost(
      validBody({ email, order_number: order, portal_product_keys: [] }),
    );
    expect([200, 201]).toContain(res.status);
    if (res.body.userId) seededUserIds.push(res.body.userId);

    const metadata = await readMetadata(order);
    expect(metadata.portal_product_keys).toEqual([]);
  });

  it("treats missing portal_product_keys as [] for backward compatibility", async () => {
    const email = `${TEST_TAG}-ppk-missing@machine.test`;
    const order = `tm_ord_ppk_missing_${randomUUID().slice(0, 6)}`;
    const body = validBody({ email, order_number: order });
    // Explicitly ensure the field is absent from the payload
    delete (body as Record<string, unknown>).portal_product_keys;
    const res = await authedPost(body);
    expect([200, 201]).toContain(res.status);
    if (res.body.userId) seededUserIds.push(res.body.userId);

    const metadata = await readMetadata(order);
    expect(metadata.portal_product_keys).toEqual([]);
  });

  it("treats null portal_product_keys as [] for backward compatibility", async () => {
    const email = `${TEST_TAG}-ppk-null@machine.test`;
    const order = `tm_ord_ppk_null_${randomUUID().slice(0, 6)}`;
    const res = await authedPost(
      validBody({ email, order_number: order, portal_product_keys: null }),
    );
    expect([200, 201]).toContain(res.status);
    if (res.body.userId) seededUserIds.push(res.body.userId);

    const metadata = await readMetadata(order);
    expect(metadata.portal_product_keys).toEqual([]);
  });
});
