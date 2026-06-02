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
  systemSettingsTable,
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
  __setMachineMismatchDigestQueryErrorForTests,
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

  // Deterministic baseline for the recipient-resolution branches: clear any
  // DB-backed ops email so getOnCallDestinations falls back to env. Without
  // this, a leaked oncall.ops_alert_email row in the shared test DB would win
  // over env and silently stop the skipped_no_recipient case from exercising
  // its intended branch.
  await db
    .delete(systemSettingsTable)
    .where(eq(systemSettingsTable.key, "oncall.ops_alert_email"));

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
  __setMachineMismatchDigestQueryErrorForTests(null);
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

  it("suppresses the email but still records outcome=skipped_no_recipient when no ops recipient is configured", async () => {
    // No DB row and no env var → getOnCallDestinations resolves opsAlertEmail to
    // null, so the digest must skip the send while still writing its audit trail.
    delete process.env.OPS_ALERT_EMAIL;
    __resetMachineMismatchDigestStateForTests();

    const sent: Array<{ to: string }> = [];
    // A sender is wired up on purpose: the no-recipient branch returns before any
    // send, so this stub must never be invoked.
    __setMachineMismatchDigestSenderForTests(async (msg) => {
      sent.push({ to: msg.to });
    });

    const startedAt = new Date();
    const result = await runMachineMismatchDigest();

    expect(result.outcome).toBe("skipped_no_recipient");
    expect(result.recipient).toBeNull();
    expect(sent.length).toBe(0);

    // The same in-window mismatches were still detected — only the delivery was
    // suppressed because there was nobody to send to.
    const flaggedTagged = result.flagged
      .map((o) => o.externalOrderId)
      .filter((id) => id.startsWith(TEST_TAG))
      .sort();
    expect(flaggedTagged).toEqual(
      [UNDER_GRANT_ORDER_ID, OVER_GRANT_ORDER_ID].sort(),
    );

    // A real audit row records the skip so admins can see the job fired.
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
          gte(auditLogTable.createdAt, startedAt),
        ),
      );
    expect(auditRows.length).toBe(1);
    expect(auditRows[0].entityType).toBe(MACHINE_MISMATCH_DIGEST_ENTITY_TYPE);
    expect(auditRows[0].entityId).toBe(MACHINE_MISMATCH_DIGEST_ENTITY_ID);
    const meta = auditRows[0].metadata as Record<string, unknown>;
    expect(meta.outcome).toBe("skipped_no_recipient");
    expect(meta.recipient).toBeNull();
    expect(meta.flaggedCount).toBe(result.flagged.length);
  });

  it("records outcome=skipped_sendgrid_not_configured when a recipient is set but SendGrid is not configured", async () => {
    process.env.OPS_ALERT_EMAIL = `${TEST_TAG}-ops@example.test`;
    // Drop the real sender override so the digest falls through to the SendGrid
    // check, and ensure no API key (and no env sender override) is present.
    __setMachineMismatchDigestSenderForTests(null);
    __resetMachineMismatchDigestStateForTests();

    const originalSendgridKey = process.env.SENDGRID_API_KEY;
    delete process.env.SENDGRID_API_KEY;

    const startedAt = new Date();
    let result: Awaited<ReturnType<typeof runMachineMismatchDigest>>;
    try {
      result = await runMachineMismatchDigest();
    } finally {
      if (originalSendgridKey !== undefined) {
        process.env.SENDGRID_API_KEY = originalSendgridKey;
      }
    }

    expect(result.outcome).toBe("skipped_sendgrid_not_configured");
    // The recipient was resolved (so this is distinct from the no-recipient
    // skip) — the digest just had no transport to deliver through.
    expect(result.recipient).toBe(`${TEST_TAG}-ops@example.test`);

    const flaggedTagged = result.flagged
      .map((o) => o.externalOrderId)
      .filter((id) => id.startsWith(TEST_TAG))
      .sort();
    expect(flaggedTagged).toEqual(
      [UNDER_GRANT_ORDER_ID, OVER_GRANT_ORDER_ID].sort(),
    );

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
          gte(auditLogTable.createdAt, startedAt),
        ),
      );
    expect(auditRows.length).toBe(1);
    expect(auditRows[0].entityType).toBe(MACHINE_MISMATCH_DIGEST_ENTITY_TYPE);
    expect(auditRows[0].entityId).toBe(MACHINE_MISMATCH_DIGEST_ENTITY_ID);
    const meta = auditRows[0].metadata as Record<string, unknown>;
    expect(meta.outcome).toBe("skipped_sendgrid_not_configured");
    expect(meta.recipient).toBe(`${TEST_TAG}-ops@example.test`);
    expect(meta.flaggedCount).toBe(result.flagged.length);
  });

  it("records outcome=failed with a reason and flaggedCount=0 when the flagged-orders query itself throws", async () => {
    // The other failure path (a forced *send* error) is covered above. This
    // pins the second entry point: findFlaggedOrders throwing *before* any
    // email is attempted must still write a real machine_mismatch_digest audit
    // row recording the failure, so a regression that drops the audit row when
    // the query (not the send) breaks is caught at the real-schema level.
    process.env.OPS_ALERT_EMAIL = `${TEST_TAG}-ops@example.test`;
    __resetMachineMismatchDigestStateForTests();

    // A sender is wired up on purpose: the query throws first, so this stub
    // must never be invoked.
    const sent: Array<{ to: string }> = [];
    __setMachineMismatchDigestSenderForTests(async (msg) => {
      sent.push({ to: msg.to });
    });

    const startedAt = new Date();
    let result: Awaited<ReturnType<typeof runMachineMismatchDigest>>;
    __setMachineMismatchDigestQueryErrorForTests(
      new Error("simulated flagged-orders query outage"),
    );
    try {
      result = await runMachineMismatchDigest();
    } finally {
      __setMachineMismatchDigestQueryErrorForTests(null);
    }

    expect(result.outcome).toBe("failed");
    expect(result.reason).toContain("simulated flagged-orders query outage");
    // The query never returned, so nothing was flagged and nothing was sent.
    expect(result.flagged.length).toBe(0);
    expect(sent.length).toBe(0);

    // A real audit row records the failure with a non-null reason and zero
    // flagged count.
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
          gte(auditLogTable.createdAt, startedAt),
        ),
      );
    expect(auditRows.length).toBe(1);
    expect(auditRows[0].entityType).toBe(MACHINE_MISMATCH_DIGEST_ENTITY_TYPE);
    expect(auditRows[0].entityId).toBe(MACHINE_MISMATCH_DIGEST_ENTITY_ID);
    const meta = auditRows[0].metadata as Record<string, unknown>;
    expect(meta.outcome).toBe("failed");
    expect(meta.reason).toContain("simulated flagged-orders query outage");
    expect(meta.flaggedCount).toBe(0);
  });
});
