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
import {
  setPortalUrl,
  __invalidatePortalUrlCacheForTests,
} from "../lib/portal-url-settings";

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

describe("runMachineMismatchDigest — email subject, summary table & admin link", () => {
  // The flagged order all of these tests feed through the digest. Granted
  // slugs deliberately disagree with portal_product_keys so computeOrderMismatch
  // flags it; the buyer/slug strings are asserted against the rendered body.
  const FLAGGED_ROW = {
    externalOrderId: `${TEST_TAG}-order-content`,
    userEmail: "content-buyer@example.test",
    grantedSlugs: ["lifetime-access"],
    portalProductKeys: ["a-different-key"],
    mostRecentPurchasedAt: new Date(),
  };

  /**
   * Run the digest end-to-end against the live DB, hijacking only the
   * flagged-orders lookup so it yields FLAGGED_ROW. Returns the single email
   * the test sender stub captured.
   */
  async function runAndCaptureEmail(): Promise<{
    to: string;
    subject: string;
    text: string;
    html: string;
  }> {
    const sent: Array<{ to: string; subject: string; text: string; html: string }> = [];
    __setMachineMismatchDigestSenderForTests(async (msg) => {
      sent.push({ to: msg.to, subject: msg.subject, text: msg.text, html: msg.html });
    });

    const spy = vi.spyOn(db, "select").mockImplementationOnce(
      () =>
        selectChainResolving([FLAGGED_ROW]) as unknown as ReturnType<
          typeof db.select
        >,
    );

    let runResult;
    try {
      runResult = await runMachineMismatchDigest();
    } finally {
      spy.mockRestore();
    }

    expect(runResult.outcome).toBe("sent");
    expect(runResult.flagged.length).toBe(1);
    expect(sent).toHaveLength(1);
    return sent[0];
  }

  afterEach(async () => {
    // Drop any portal-url row we seeded so later suites start clean.
    await setPortalUrl(null, null);
    __invalidatePortalUrlCacheForTests();
  });

  it("renders the subject, per-order summary, and an admin link built from the configured portal URL", async () => {
    const recipient = `${TEST_TAG}-ops@example.test`;
    process.env.OPS_ALERT_EMAIL = recipient;

    const portalUrl = "https://portal.integration.test";
    await setPortalUrl(portalUrl, null);
    __invalidatePortalUrlCacheForTests();

    const email = await runAndCaptureEmail();

    // Email is addressed to the configured ops distribution list.
    expect(email.to).toBe(recipient);

    // Subject names the flagged count (singular for one order) and the reason.
    expect(email.subject).toContain("1 Machine order");
    expect(email.subject).not.toContain("1 Machine orders");
    expect(email.subject).toContain("flagged as key mismatch");

    // Per-order summary fields appear in both the text and HTML bodies.
    for (const body of [email.text, email.html]) {
      expect(body).toContain(FLAGGED_ROW.externalOrderId);
      expect(body).toContain(FLAGGED_ROW.userEmail);
      expect(body).toContain("lifetime-access");
      expect(body).toContain("a-different-key");
    }

    // The admin deep link is the configured portal URL + the integrations path.
    const expectedUrl = `${portalUrl}/admin/integrations/yse?source=machine`;
    expect(email.text).toContain(expectedUrl);
    expect(email.html).toContain(`href="${expectedUrl}"`);
  });

  it("trims a trailing slash on the configured portal URL when building the link", async () => {
    process.env.OPS_ALERT_EMAIL = `${TEST_TAG}-ops@example.test`;

    // setPortalUrl normalizes the stored value, but assert the rendered link
    // is single-slash regardless of how the admin entered it.
    await setPortalUrl("https://portal.integration.test/", null);
    __invalidatePortalUrlCacheForTests();

    const email = await runAndCaptureEmail();

    const expectedUrl = "https://portal.integration.test/admin/integrations/yse?source=machine";
    expect(email.text).toContain(expectedUrl);
    expect(email.html).toContain(`href="${expectedUrl}"`);
    expect(email.text).not.toContain(
      "https://portal.integration.test//admin/integrations/yse",
    );
  });

  it("falls back to the bare admin path when no portal URL is configured", async () => {
    process.env.OPS_ALERT_EMAIL = `${TEST_TAG}-ops@example.test`;

    // No DB-backed override.
    await setPortalUrl(null, null);

    // In non-production the resolver hands back a localhost dev default, so to
    // exercise the genuine "nothing configured" branch (link falls back to the
    // bare path) we force production semantics with no env override for the
    // duration of this run, then restore.
    const originalNodeEnv = process.env.NODE_ENV;
    const originalPortalUrl = process.env.PORTAL_URL;
    process.env.NODE_ENV = "production";
    delete process.env.PORTAL_URL;
    __invalidatePortalUrlCacheForTests();

    let email;
    try {
      email = await runAndCaptureEmail();
    } finally {
      if (originalNodeEnv === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = originalNodeEnv;
      }
      if (originalPortalUrl === undefined) {
        delete process.env.PORTAL_URL;
      } else {
        process.env.PORTAL_URL = originalPortalUrl;
      }
      __invalidatePortalUrlCacheForTests();
    }

    const barePath = "/admin/integrations/yse?source=machine";
    expect(email.text).toContain(barePath);
    expect(email.html).toContain(`href="${barePath}"`);
    // No host was prepended — the path is not preceded by an http(s) origin.
    expect(email.text).not.toMatch(
      /https?:\/\/[^\s)]*\/admin\/integrations\/yse/,
    );
    expect(email.html).not.toContain(
      'href="http',
    );
  });
});
