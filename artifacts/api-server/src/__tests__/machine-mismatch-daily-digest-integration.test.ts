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
  webhookLogsTable,
  auditLogTable,
} from "@workspace/db";
import { and, eq, gte, inArray } from "drizzle-orm";

vi.mock("../lib/redis", () => ({
  getRedis: () => null,
  isRedisConnected: async () => false,
}));

import { buildTestAppWithRouters } from "./test-app";
import adminPanelRouter from "../routes/admin-panel";
import {
  runMachineMismatchDigest,
  __setMachineMismatchDigestSenderForTests,
  __resetMachineMismatchDigestStateForTests,
  MACHINE_MISMATCH_DIGEST_ACTION_TYPE,
  MACHINE_MISMATCH_DIGEST_ENTITY_TYPE,
  MACHINE_MISMATCH_DIGEST_ENTITY_ID,
} from "../lib/machine-mismatch-daily-digest";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const TEST_TAG = `digest-int-${randomUUID().slice(0, 8)}`;

let app: ReturnType<typeof buildTestAppWithRouters>;
let adminCookie: string;

const seededUserIds: number[] = [];
const seededProductIds: number[] = [];
const seededWebhookIds: number[] = [];

// Recent (in-window) Machine orders the digest must see.
const UNDER_GRANT_ORDER_ID = `${TEST_TAG}_under_${randomUUID().slice(0, 6)}`;
const OVER_GRANT_ORDER_ID = `${TEST_TAG}_over_${randomUUID().slice(0, 6)}`;
const EXACT_ORDER_ID = `${TEST_TAG}_exact_${randomUUID().slice(0, 6)}`;
// A mismatch whose purchase fell outside the digest's trailing window — the
// admin page (which has no time filter) still shows it, but the digest must
// not include it, which is exactly the window behaviour we want to pin.
const OLD_ORDER_ID = `${TEST_TAG}_old_${randomUUID().slice(0, 6)}`;

// 48h ago — outside the default 24h digest window.
const OUT_OF_WINDOW_AT = new Date(Date.now() - 48 * 60 * 60 * 1000);

let runStartedAt: Date;

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
      name: `User ${suffix}`,
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

  const underBuyerId = await insertUser("member", "under");
  const overBuyerId = await insertUser("member", "over");
  const exactBuyerId = await insertUser("member", "exact");
  const oldBuyerId = await insertUser("member", "old");

  const [productA] = await db
    .insert(productsTable)
    .values({
      slug: `${TEST_TAG}-prod-a`,
      name: `${TEST_TAG} product A`,
      type: "backend",
      sortOrder: 98,
    })
    .returning({ id: productsTable.id });
  seededProductIds.push(productA.id);

  const [productB] = await db
    .insert(productsTable)
    .values({
      slug: `${TEST_TAG}-prod-b`,
      name: `${TEST_TAG} product B`,
      type: "backend",
      sortOrder: 99,
    })
    .returning({ id: productsTable.id });
  seededProductIds.push(productB.id);

  // Under-grant: granted [A] but Machine claimed [A, B] → mismatch.
  await db.insert(userProductsTable).values({
    userId: underBuyerId,
    productId: productA.id,
    status: "active",
    externalSource: "machine",
    externalOrderId: UNDER_GRANT_ORDER_ID,
  });

  // Over-grant: granted [A, B] but Machine claimed only [A] → mismatch.
  await db.insert(userProductsTable).values([
    {
      userId: overBuyerId,
      productId: productA.id,
      status: "active",
      externalSource: "machine",
      externalOrderId: OVER_GRANT_ORDER_ID,
    },
    {
      userId: overBuyerId,
      productId: productB.id,
      status: "active",
      externalSource: "machine",
      externalOrderId: OVER_GRANT_ORDER_ID,
    },
  ]);

  // Exact match: granted [A, B] and Machine claimed exactly [A, B] → no flag.
  await db.insert(userProductsTable).values([
    {
      userId: exactBuyerId,
      productId: productA.id,
      status: "active",
      externalSource: "machine",
      externalOrderId: EXACT_ORDER_ID,
    },
    {
      userId: exactBuyerId,
      productId: productB.id,
      status: "active",
      externalSource: "machine",
      externalOrderId: EXACT_ORDER_ID,
    },
  ]);

  // Old mismatch (out of window): granted [A] but Machine claimed [A, B].
  await db.insert(userProductsTable).values({
    userId: oldBuyerId,
    productId: productA.id,
    status: "active",
    externalSource: "machine",
    externalOrderId: OLD_ORDER_ID,
    purchasedAt: OUT_OF_WINDOW_AT,
  });

  await db.insert(webhookLogsTable).values([
    {
      externalId: `machine_${UNDER_GRANT_ORDER_ID}`,
      eventType: "external.grant_product",
      status: "processed",
      payload: {
        externalSource: "machine",
        externalOrderId: UNDER_GRANT_ORDER_ID,
        metadata: {
          portal_product_keys: [`${TEST_TAG}-prod-a`, `${TEST_TAG}-prod-b`],
        },
      } as Record<string, unknown>,
    },
    {
      externalId: `machine_${OVER_GRANT_ORDER_ID}`,
      eventType: "external.grant_product",
      status: "processed",
      payload: {
        externalSource: "machine",
        externalOrderId: OVER_GRANT_ORDER_ID,
        metadata: {
          portal_product_keys: [`${TEST_TAG}-prod-a`],
        },
      } as Record<string, unknown>,
    },
    {
      externalId: `machine_${EXACT_ORDER_ID}`,
      eventType: "external.grant_product",
      status: "processed",
      payload: {
        externalSource: "machine",
        externalOrderId: EXACT_ORDER_ID,
        metadata: {
          portal_product_keys: [`${TEST_TAG}-prod-a`, `${TEST_TAG}-prod-b`],
        },
      } as Record<string, unknown>,
    },
    {
      externalId: `machine_${OLD_ORDER_ID}`,
      eventType: "external.grant_product",
      status: "processed",
      payload: {
        externalSource: "machine",
        externalOrderId: OLD_ORDER_ID,
        metadata: {
          portal_product_keys: [`${TEST_TAG}-prod-a`, `${TEST_TAG}-prod-b`],
        },
      } as Record<string, unknown>,
    },
  ]);
  const logs = await db
    .select({ id: webhookLogsTable.id })
    .from(webhookLogsTable)
    .where(
      inArray(webhookLogsTable.externalId, [
        `machine_${UNDER_GRANT_ORDER_ID}`,
        `machine_${OVER_GRANT_ORDER_ID}`,
        `machine_${EXACT_ORDER_ID}`,
        `machine_${OLD_ORDER_ID}`,
      ]),
    );
  for (const row of logs) seededWebhookIds.push(row.id);
});

afterAll(async () => {
  __setMachineMismatchDigestSenderForTests(null);
  __resetMachineMismatchDigestStateForTests();
  delete process.env.OPS_ALERT_EMAIL;

  // The digest writes audit rows with no actor; delete by action type within
  // the window this test ran so we don't leak rows into other suites.
  if (runStartedAt) {
    await db
      .delete(auditLogTable)
      .where(
        and(
          eq(auditLogTable.actionType, MACHINE_MISMATCH_DIGEST_ACTION_TYPE),
          gte(auditLogTable.createdAt, runStartedAt),
        ),
      );
  }
  if (seededWebhookIds.length > 0) {
    await db
      .delete(webhookLogsTable)
      .where(inArray(webhookLogsTable.id, seededWebhookIds));
  }
  if (seededUserIds.length > 0) {
    await db
      .delete(auditLogTable)
      .where(inArray(auditLogTable.actorId, seededUserIds));
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

describe("runMachineMismatchDigest — integration against the real schema", () => {
  it("flags the same in-window Machine orders the admin page shows, emails ops, and writes a machine_mismatch_digest audit row", async () => {
    process.env.OPS_ALERT_EMAIL = `${TEST_TAG}-ops@example.test`;
    __resetMachineMismatchDigestStateForTests();

    const sent: Array<{
      to: string;
      subject: string;
      text: string;
      html: string;
    }> = [];
    __setMachineMismatchDigestSenderForTests(async (msg) => {
      sent.push({
        to: msg.to,
        subject: msg.subject,
        text: msg.text,
        html: msg.html,
      });
    });

    runStartedAt = new Date();
    const result = await runMachineMismatchDigest();

    // The digest ran an end-to-end query against the real DB and emailed ops.
    expect(result.outcome).toBe("sent");
    expect(result.recipient).toBe(`${TEST_TAG}-ops@example.test`);
    expect(sent.length).toBe(1);
    expect(sent[0].to).toBe(`${TEST_TAG}-ops@example.test`);

    // Restrict the digest's flagged set to the orders this test seeded so we
    // aren't fooled by unrelated rows left in the shared DB.
    const flaggedTagged = result.flagged
      .map((o) => o.externalOrderId)
      .filter((id) => id.startsWith(TEST_TAG))
      .sort();
    expect(flaggedTagged).toEqual(
      [UNDER_GRANT_ORDER_ID, OVER_GRANT_ORDER_ID].sort(),
    );

    // The email body lists each flagged order so ops can drill in.
    for (const id of [UNDER_GRANT_ORDER_ID, OVER_GRANT_ORDER_ID]) {
      expect(sent[0].text).toContain(id);
      expect(sent[0].html).toContain(id);
    }
    expect(sent[0].text).toContain(
      "/admin/integrations/yse?source=machine",
    );

    // What the admin page shows for the same window: pull the Machine orders
    // from the real endpoint, keep only the ones we seeded that fall inside
    // the digest's trailing 24h window, and assert the mismatch set the admin
    // UI would render is exactly the set the digest emailed.
    const adminRes = await request(app)
      .get("/api/admin/integrations/yse/orders")
      .query({ source: "machine", limit: 100 })
      .set("Cookie", adminCookie);
    expect(adminRes.status).toBe(200);

    type Order = {
      externalOrderId: string;
      mismatch: boolean;
      grantedAt: string | null;
    };
    const windowStart = Date.now() - result.windowMs;
    const adminInWindowMismatches = (adminRes.body.orders as Order[])
      .filter((o) => o.externalOrderId.startsWith(TEST_TAG))
      .filter(
        (o) =>
          o.grantedAt !== null &&
          new Date(o.grantedAt).getTime() >= windowStart,
      )
      .filter((o) => o.mismatch)
      .map((o) => o.externalOrderId)
      .sort();
    expect(adminInWindowMismatches).toEqual(flaggedTagged);

    // The admin page (no time filter) still surfaces the old mismatch, but the
    // digest's window must have excluded it.
    const adminAllTagged = (adminRes.body.orders as Order[])
      .filter((o) => o.externalOrderId.startsWith(TEST_TAG) && o.mismatch)
      .map((o) => o.externalOrderId);
    expect(adminAllTagged).toContain(OLD_ORDER_ID);
    expect(flaggedTagged).not.toContain(OLD_ORDER_ID);
    // The exact-match order is never flagged by either consumer.
    expect(flaggedTagged).not.toContain(EXACT_ORDER_ID);
    expect(adminAllTagged).not.toContain(EXACT_ORDER_ID);

    // A real audit row was written for this run.
    const auditRows = await db
      .select({
        actionType: auditLogTable.actionType,
        entityType: auditLogTable.entityType,
        entityId: auditLogTable.entityId,
        metadata: auditLogTable.metadata,
      })
      .from(auditLogTable)
      .where(
        and(
          eq(auditLogTable.actionType, MACHINE_MISMATCH_DIGEST_ACTION_TYPE),
          gte(auditLogTable.createdAt, runStartedAt),
        ),
      );
    expect(auditRows.length).toBe(1);
    expect(auditRows[0].actionType).toBe(MACHINE_MISMATCH_DIGEST_ACTION_TYPE);
    expect(auditRows[0].entityType).toBe(MACHINE_MISMATCH_DIGEST_ENTITY_TYPE);
    expect(auditRows[0].entityId).toBe(MACHINE_MISMATCH_DIGEST_ENTITY_ID);
    const meta = auditRows[0].metadata as Record<string, unknown>;
    expect(meta.outcome).toBe("sent");
    expect(meta.flaggedCount).toBe(result.flagged.length);
    expect(meta.recipient).toBe(`${TEST_TAG}-ops@example.test`);
  });
});
