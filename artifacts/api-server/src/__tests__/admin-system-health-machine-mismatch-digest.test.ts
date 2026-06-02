import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import { db, usersTable } from "@workspace/db";
import { inArray } from "drizzle-orm";

vi.mock("../lib/redis", () => ({
  getRedis: () => null,
  getRedisConnection: vi.fn(),
  createRedisConnection: vi.fn(),
  isRedisConnected: vi.fn(async () => false),
}));

import { buildTestAppWithRouters } from "./test-app";
import adminPanelRouter from "../routes/admin-panel";
import {
  runMachineMismatchDigest,
  __setMachineMismatchDigestSenderForTests,
  __resetMachineMismatchDigestStateForTests,
} from "../lib/machine-mismatch-daily-digest";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const TEST_TAG = `health-digest-${randomUUID().slice(0, 8)}`;

let app: ReturnType<typeof buildTestAppWithRouters>;
let adminCookie = "";
const seededIds: number[] = [];
const originalOpsAlertEmail = process.env.OPS_ALERT_EMAIL;

/**
 * Build a drizzle-style query chain stub that resolves to the supplied rows,
 * matching the call shape `findFlaggedOrders` uses
 * (select → from → innerJoin → leftJoin → leftJoin → where → groupBy →
 * orderBy). Only the digest's flagged-orders query is hijacked (via
 * `mockImplementationOnce`); every other `db.select` call — including the
 * real System Health endpoint queries — falls through to the live database.
 */
function selectChainResolving<T>(rows: T[]) {
  const chain = {
    from: () => chain,
    innerJoin: () => chain,
    leftJoin: () => chain,
    where: () => chain,
    groupBy: () => chain,
    orderBy: async () => rows,
  };
  return chain;
}

beforeAll(async () => {
  app = buildTestAppWithRouters([adminPanelRouter]);
  const email = `${TEST_TAG}@example.test`;
  const passwordHash = await bcrypt.hash("irrelevant-test-password", 4);
  const [row] = await db
    .insert(usersTable)
    .values({
      email,
      name: "Test super admin",
      passwordHash,
      role: "super_admin",
      sourceProduct: "lifetime",
      emailVerified: true,
      onboardingComplete: true,
    })
    .returning({ id: usersTable.id });
  seededIds.push(row.id);
  const token = jwt.sign({ userId: row.id, email }, JWT_SECRET, { expiresIn: "1h" });
  adminCookie = `access_token=${token}`;
});

afterAll(async () => {
  if (seededIds.length > 0) {
    await db.delete(usersTable).where(inArray(usersTable.id, seededIds));
  }
  if (originalOpsAlertEmail === undefined) {
    delete process.env.OPS_ALERT_EMAIL;
  } else {
    process.env.OPS_ALERT_EMAIL = originalOpsAlertEmail;
  }
});

beforeEach(() => {
  __resetMachineMismatchDigestStateForTests();
  __setMachineMismatchDigestSenderForTests(null);
});

afterEach(() => {
  __resetMachineMismatchDigestStateForTests();
  __setMachineMismatchDigestSenderForTests(null);
  vi.restoreAllMocks();
  if (originalOpsAlertEmail === undefined) {
    delete process.env.OPS_ALERT_EMAIL;
  } else {
    process.env.OPS_ALERT_EMAIL = originalOpsAlertEmail;
  }
});

describe("GET /api/admin/system/health — machine mismatch digest field", () => {
  it("returns the pending placeholder shape on a cold start", async () => {
    const res = await request(app)
      .get("/api/admin/system/health")
      .set("Cookie", adminCookie);

    expect(res.status).toBe(200);
    const digest = res.body?.services?.machineMismatchDigest;
    expect(digest).toBeTruthy();
    // Cadence is always populated so the card can flag a stale heartbeat.
    expect(typeof digest.intervalMs).toBe("number");
    expect(digest.intervalMs).toBeGreaterThan(0);
    // No run has happened yet ⇒ every last-run field is null (the "Pending"
    // placeholder the card renders before the job first fires).
    expect(digest.lastRanAt).toBeNull();
    expect(digest.lastOutcome).toBeNull();
    expect(digest.lastFlaggedCount).toBeNull();
    expect(digest.lastRecipient).toBeNull();
    expect(digest.lastReason).toBeNull();
  });

  it("flips to outcome=sent with the flagged count and recipient after a real run", async () => {
    const recipient = `${TEST_TAG}-ops@example.test`;
    process.env.OPS_ALERT_EMAIL = recipient;

    const sent: Array<{ to: string }> = [];
    __setMachineMismatchDigestSenderForTests(async (msg) => {
      sent.push({ to: msg.to });
    });

    // Hijack only the flagged-orders lookup so the digest sees a single,
    // unambiguous mismatch (granted slugs ≠ portal_product_keys). Every other
    // db.select — on-call recipient lookup, portal URL, and the System Health
    // endpoint below — runs against the live database.
    const spy = vi.spyOn(db, "select").mockImplementationOnce(
      () =>
        selectChainResolving([
          {
            externalOrderId: `${TEST_TAG}-order`,
            userEmail: "buyer@example.test",
            grantedSlugs: ["lifetime-access"],
            portalProductKeys: ["a-different-key"],
            mostRecentPurchasedAt: new Date(),
          },
        ]) as unknown as ReturnType<typeof db.select>,
    );

    const runResult = await runMachineMismatchDigest();
    spy.mockRestore();

    // Sanity-check the run itself before asserting the endpoint mirrors it.
    expect(runResult.outcome).toBe("sent");
    expect(runResult.flagged.length).toBe(1);
    expect(runResult.recipient).toBe(recipient);
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe(recipient);

    const res = await request(app)
      .get("/api/admin/system/health")
      .set("Cookie", adminCookie);

    expect(res.status).toBe(200);
    const digest = res.body?.services?.machineMismatchDigest;
    expect(digest).toBeTruthy();
    expect(digest.lastOutcome).toBe("sent");
    expect(digest.lastFlaggedCount).toBe(1);
    expect(digest.lastRecipient).toBe(recipient);
    expect(digest.lastReason).toBeNull();
    expect(typeof digest.lastRanAt).toBe("string");
    expect(Number.isFinite(new Date(digest.lastRanAt).getTime())).toBe(true);
  });

  it("flips to outcome=failed (with a reason) when the run throws", async () => {
    const failureMessage = "synthetic-digest-query-failure";
    const spy = vi.spyOn(db, "select").mockImplementationOnce(() => {
      throw new Error(failureMessage);
    });

    const runResult = await runMachineMismatchDigest();
    spy.mockRestore();

    expect(runResult.outcome).toBe("failed");
    expect(runResult.reason).toContain(failureMessage);

    const res = await request(app)
      .get("/api/admin/system/health")
      .set("Cookie", adminCookie);

    expect(res.status).toBe(200);
    const digest = res.body?.services?.machineMismatchDigest;
    expect(digest).toBeTruthy();
    expect(digest.lastOutcome).toBe("failed");
    expect(digest.lastReason).toContain(failureMessage);
    expect(digest.lastFlaggedCount).toBe(0);
    expect(typeof digest.lastRanAt).toBe("string");
  });
});
