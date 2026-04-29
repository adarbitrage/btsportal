import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import { db, usersTable, systemSettingsTable, auditLogTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

vi.mock("../lib/redis", () => ({
  getRedis: () => null,
  isRedisConnected: async () => false,
}));

import { buildTestAppWithRouters } from "./test-app";
import adminPanelRouter from "../routes/admin-panel";
import {
  getOnCallDestinations,
  getOnCallDestinationsStatus,
  setOnCallDestination,
  getOnCallSettingKeys,
} from "../lib/oncall-settings";
import {
  __resetQueueFallbackAlerterForTests,
  __setQueueFallbackAlerterDeliveriesForTests,
  __setOnCallProbesForTests,
  type AlertPayload,
  type DeliveryResult,
  type ProbeResult,
} from "../lib/queue-fallback-alerter";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const TEST_TAG = `oncall-${randomUUID().slice(0, 8)}`;

const seededUserIds: number[] = [];
let app: ReturnType<typeof buildTestAppWithRouters>;
let adminCookie: string;
let memberCookie: string;
let adminId: number;

function signCookie(userId: number, email: string): string {
  const token = jwt.sign({ userId, email }, JWT_SECRET, { expiresIn: "1h" });
  return `access_token=${token}`;
}

async function insertUser(role: string, suffix: string): Promise<{ id: number; email: string }> {
  const email = `${TEST_TAG}-${suffix}@example.test`;
  const passwordHash = await bcrypt.hash("irrelevant-test-password", 4);
  const [row] = await db
    .insert(usersTable)
    .values({
      email,
      name: `Test ${suffix}`,
      passwordHash,
      role,
      sourceProduct: "lifetime",
      emailVerified: true,
      onboardingComplete: true,
    })
    .returning({ id: usersTable.id });
  seededUserIds.push(row.id);
  return { id: row.id, email };
}

async function clearOnCallRows() {
  await db.delete(systemSettingsTable).where(inArray(systemSettingsTable.key, getOnCallSettingKeys()));
}

beforeAll(async () => {
  app = buildTestAppWithRouters([adminPanelRouter]);
  const admin = await insertUser("super_admin", "admin");
  const member = await insertUser("member", "non-admin");
  adminId = admin.id;
  adminCookie = signCookie(admin.id, admin.email);
  memberCookie = signCookie(member.id, member.email);
});

afterAll(async () => {
  await clearOnCallRows();
  if (seededUserIds.length > 0) {
    await db.delete(auditLogTable).where(inArray(auditLogTable.actorId, seededUserIds));
    await db.delete(usersTable).where(inArray(usersTable.id, seededUserIds));
  }
});

beforeEach(async () => {
  await clearOnCallRows();
  __resetQueueFallbackAlerterForTests();
  // Default: stub all probes to a deterministic "ok" so the existing
  // happy-path tests don't actually hit the network when they save a
  // destination. Tests that care about probe outcomes override these
  // explicitly via __setOnCallProbesForTests.
  __setOnCallProbesForTests({
    pagerduty: async (): Promise<ProbeResult> => ({ ok: true }),
    email: async (): Promise<ProbeResult> => ({ ok: true }),
    slack: async (): Promise<ProbeResult> => ({ ok: true }),
  });
  // Strip env vars so tests start from a clean "nothing configured" state.
  delete process.env.PAGERDUTY_INTEGRATION_KEY;
  delete process.env.OPS_ALERT_EMAIL;
  delete process.env.OPS_ALERT_SLACK_WEBHOOK_URL;
});

afterEach(() => {
  __setQueueFallbackAlerterDeliveriesForTests(null);
  __setOnCallProbesForTests(null);
});

describe("oncall-settings library", () => {
  it("falls back to env vars when nothing is saved in DB", async () => {
    process.env.PAGERDUTY_INTEGRATION_KEY = "env-pd-key";
    process.env.OPS_ALERT_EMAIL = "env-ops@example.test";
    process.env.OPS_ALERT_SLACK_WEBHOOK_URL = "https://hooks.slack.test/env";

    const dest = await getOnCallDestinations();
    expect(dest.pagerdutyIntegrationKey).toBe("env-pd-key");
    expect(dest.opsAlertEmail).toBe("env-ops@example.test");
    expect(dest.opsAlertSlackWebhookUrl).toBe("https://hooks.slack.test/env");

    const status = await getOnCallDestinationsStatus();
    expect(status.pagerdutyConfigured).toBe(true);
    expect(status.pagerdutySource).toBe("env");
    expect(status.opsAlertEmail).toBe("env-ops@example.test");
    expect(status.opsAlertEmailSource).toBe("env");
    expect(status.slackConfigured).toBe(true);
    expect(status.slackSource).toBe("env");
  });

  it("DB values take precedence over env, and secrets round-trip through encryption", async () => {
    process.env.PAGERDUTY_INTEGRATION_KEY = "env-pd-key";

    await setOnCallDestination("pagerdutyIntegrationKey", "db-pd-key", "tester");
    await setOnCallDestination("opsAlertEmail", "db-ops@example.test", "tester");
    await setOnCallDestination("opsAlertSlackWebhookUrl", "https://hooks.slack.test/db", "tester");

    const dest = await getOnCallDestinations();
    expect(dest.pagerdutyIntegrationKey).toBe("db-pd-key");
    expect(dest.opsAlertEmail).toBe("db-ops@example.test");
    expect(dest.opsAlertSlackWebhookUrl).toBe("https://hooks.slack.test/db");

    // Confirm that the PagerDuty key is stored as ciphertext, not as the
    // plaintext value, so a future db dump or Settings UI bug can't leak it.
    const [row] = await db
      .select({ value: systemSettingsTable.value })
      .from(systemSettingsTable)
      .where(eq(systemSettingsTable.key, "oncall.pagerduty_integration_key"));
    expect(row).toBeTruthy();
    const stored = row.value as { encrypted: boolean; data: string };
    expect(stored.encrypted).toBe(true);
    expect(stored.data).not.toBe("db-pd-key");
    expect(stored.data.startsWith("v1:")).toBe(true);

    // Email is non-secret and stored in plaintext.
    const [emailRow] = await db
      .select({ value: systemSettingsTable.value })
      .from(systemSettingsTable)
      .where(eq(systemSettingsTable.key, "oncall.ops_alert_email"));
    const storedEmail = emailRow.value as { encrypted: boolean; data: string };
    expect(storedEmail.encrypted).toBe(false);
    expect(storedEmail.data).toBe("db-ops@example.test");
  });

  it("setting a value to null clears the row so env can take over again", async () => {
    process.env.PAGERDUTY_INTEGRATION_KEY = "env-pd-key";
    await setOnCallDestination("pagerdutyIntegrationKey", "db-pd-key", "tester");
    let dest = await getOnCallDestinations();
    expect(dest.pagerdutyIntegrationKey).toBe("db-pd-key");

    await setOnCallDestination("pagerdutyIntegrationKey", null, "tester");
    dest = await getOnCallDestinations();
    // The DB row exists but now stores `data: null`, so the resolved value is
    // null and we explicitly *don't* fall through to the env var — admins
    // clearing the destination wins over a stale env config.
    expect(dest.pagerdutyIntegrationKey).toBe(null);

    const status = await getOnCallDestinationsStatus();
    expect(status.pagerdutyConfigured).toBe(false);
    expect(status.pagerdutySource).toBe(null);
  });
});

describe("/admin/oncall-destinations endpoints", () => {
  it("GET requires an admin role", async () => {
    const res = await request(app)
      .get("/api/admin/oncall-destinations")
      .set("Cookie", memberCookie);
    expect(res.status).toBe(403);
  });

  it("PUT requires settings:manage", async () => {
    const res = await request(app)
      .put("/api/admin/oncall-destinations")
      .set("Cookie", memberCookie)
      .send({ pagerdutyIntegrationKey: "new-key" });
    expect(res.status).toBe(403);
  });

  it("GET returns masked status for secrets and the email value as-is", async () => {
    await setOnCallDestination("pagerdutyIntegrationKey", "secret-pd", "seed");
    await setOnCallDestination("opsAlertEmail", "ops@example.test", "seed");

    const res = await request(app)
      .get("/api/admin/oncall-destinations")
      .set("Cookie", adminCookie);
    expect(res.status).toBe(200);
    expect(res.body.pagerdutyConfigured).toBe(true);
    expect(res.body.opsAlertEmail).toBe("ops@example.test");
    expect(res.body.slackConfigured).toBe(false);
    // Make sure the response does not include any field that exposes the
    // raw PagerDuty key — we only ever surface a "configured" boolean and
    // the source label.
    expect(JSON.stringify(res.body)).not.toContain("secret-pd");
  });

  it("PUT updates a single field, encrypts secrets, and writes a non-leaky audit row", async () => {
    const res = await request(app)
      .put("/api/admin/oncall-destinations")
      .set("Cookie", adminCookie)
      .send({ pagerdutyIntegrationKey: "fresh-pd-key" });
    expect(res.status).toBe(200);
    expect(res.body.pagerdutyConfigured).toBe(true);
    expect(res.body.pagerdutySource).toBe("db");

    const dest = await getOnCallDestinations();
    expect(dest.pagerdutyIntegrationKey).toBe("fresh-pd-key");

    // Audit log must record who/what changed but not the new value itself.
    const audit = await db
      .select()
      .from(auditLogTable)
      .where(eq(auditLogTable.actorId, adminId));
    const oncallEntries = audit.filter((a) => a.entityType === "oncall_destinations");
    // Two rows now: the change-list update_setting row and the
    // probe_oncall_destination row recording reachability outcomes.
    const updateEntry = oncallEntries.find((a) => a.actionType === "update_setting");
    expect(updateEntry).toBeTruthy();
    expect(JSON.stringify(updateEntry)).not.toContain("fresh-pd-key");
    expect(updateEntry!.changeDiff).toEqual({ changedFields: ["pagerdutyIntegrationKey"] });
  });

  it("PUT can clear a destination by passing null", async () => {
    await setOnCallDestination("pagerdutyIntegrationKey", "to-clear", "seed");
    const res = await request(app)
      .put("/api/admin/oncall-destinations")
      .set("Cookie", adminCookie)
      .send({ pagerdutyIntegrationKey: null });
    expect(res.status).toBe(200);
    expect(res.body.pagerdutyConfigured).toBe(false);
  });

  it("PUT rejects an invalid email address", async () => {
    const res = await request(app)
      .put("/api/admin/oncall-destinations")
      .set("Cookie", adminCookie)
      .send({ opsAlertEmail: "not-an-email" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/email/);
  });

  it("PUT requires at least one field", async () => {
    const res = await request(app)
      .put("/api/admin/oncall-destinations")
      .set("Cookie", adminCookie)
      .send({});
    expect(res.status).toBe(400);
  });

  it("rejects non-string values to keep secrets type-safe", async () => {
    const res = await request(app)
      .put("/api/admin/oncall-destinations")
      .set("Cookie", adminCookie)
      .send({ pagerdutyIntegrationKey: 12345 });
    expect(res.status).toBe(400);
  });

  it("blocks writes to oncall.* via the generic /admin/settings/:key endpoint", async () => {
    // The generic endpoint records oldValue+newValue in audit, which would
    // leak a PagerDuty key. Forcing the dedicated endpoint is the only way
    // to keep secrets off the audit trail.
    const res = await request(app)
      .put("/api/admin/settings/oncall.pagerduty_integration_key")
      .set("Cookie", adminCookie)
      .send({ value: "leaky" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/oncall-destinations/);
  });

  it("hides oncall.* rows from the generic /admin/settings list", async () => {
    await setOnCallDestination("pagerdutyIntegrationKey", "should-not-leak", "seed");
    const res = await request(app)
      .get("/api/admin/settings")
      .set("Cookie", adminCookie);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    for (const row of res.body) {
      expect(row.key.startsWith("oncall.")).toBe(false);
    }
    expect(JSON.stringify(res.body)).not.toContain("should-not-leak");
  });
});

describe("POST /admin/oncall-destinations/test", () => {
  it("requires settings:manage", async () => {
    const res = await request(app)
      .post("/api/admin/oncall-destinations/test")
      .set("Cookie", memberCookie);
    expect(res.status).toBe(403);
  });

  it("dispatches a synthetic fire+clear pair to every channel via the alerter", async () => {
    const calls: AlertPayload[] = [];
    const stub = (channel: "pagerduty" | "email" | "slack") =>
      async (p: AlertPayload): Promise<DeliveryResult> => {
        calls.push(p);
        return { channel, ok: true };
      };
    __setQueueFallbackAlerterDeliveriesForTests({
      pagerduty: stub("pagerduty"),
      email: stub("email"),
      slack: stub("slack"),
    });

    const res = await request(app)
      .post("/api/admin/oncall-destinations/test")
      .set("Cookie", adminCookie);
    expect(res.status).toBe(200);
    // Three channels collapsed from six calls (fire+clear per channel).
    expect(res.body.results).toHaveLength(3);
    for (const r of res.body.results) {
      expect(r.ok).toBe(true);
    }

    // Every delivery saw isTest=true so PagerDuty would use the test dedup
    // key and Slack/email would prefix their text with [TEST].
    expect(calls).toHaveLength(6);
    for (const c of calls) expect(c.isTest).toBe(true);
    const fires = calls.filter((c) => c.kind === "fire");
    const clears = calls.filter((c) => c.kind === "clear");
    expect(fires).toHaveLength(3);
    expect(clears).toHaveLength(3);
  });

  it("collapses per-channel results: a single failed half marks the channel failed", async () => {
    let pdCalls = 0;
    __setQueueFallbackAlerterDeliveriesForTests({
      pagerduty: async (): Promise<DeliveryResult> => {
        pdCalls += 1;
        // First call (fire) succeeds; second (clear) fails.
        if (pdCalls === 1) return { channel: "pagerduty", ok: true };
        return { channel: "pagerduty", ok: false, reason: "http_503" };
      },
      email: async () => ({ channel: "email", ok: true }),
      slack: async () => ({ channel: "slack", ok: true }),
    });

    const res = await request(app)
      .post("/api/admin/oncall-destinations/test")
      .set("Cookie", adminCookie);
    expect(res.status).toBe(200);
    const pd = res.body.results.find((r: any) => r.channel === "pagerduty");
    expect(pd.ok).toBe(false);
    expect(pd.reason).toBe("http_503");
    const email = res.body.results.find((r: any) => r.channel === "email");
    expect(email.ok).toBe(true);
  });

  it("logs an audit entry for the test alert", async () => {
    __setQueueFallbackAlerterDeliveriesForTests({
      pagerduty: async () => ({ channel: "pagerduty", ok: true, skipped: true, reason: "not_configured" }),
      email: async () => ({ channel: "email", ok: true, skipped: true, reason: "not_configured" }),
      slack: async () => ({ channel: "slack", ok: true, skipped: true, reason: "not_configured" }),
    });
    const res = await request(app)
      .post("/api/admin/oncall-destinations/test")
      .set("Cookie", adminCookie);
    expect(res.status).toBe(200);

    const audit = await db
      .select()
      .from(auditLogTable)
      .where(eq(auditLogTable.actorId, adminId));
    const testEntries = audit.filter((a) => a.actionType === "send_test_alert");
    expect(testEntries.length).toBeGreaterThan(0);
  });
});

describe("PUT /admin/oncall-destinations probe-on-save", () => {
  it("calls the matching probe with the freshly saved value and returns the result", async () => {
    const seen: { field: string; value: string }[] = [];
    __setOnCallProbesForTests({
      pagerduty: async (key) => {
        seen.push({ field: "pagerduty", value: key });
        return { ok: true };
      },
      email: async (to) => {
        seen.push({ field: "email", value: to });
        return { ok: true };
      },
      slack: async (url) => {
        seen.push({ field: "slack", value: url });
        return { ok: true };
      },
    });

    const res = await request(app)
      .put("/api/admin/oncall-destinations")
      .set("Cookie", adminCookie)
      .send({
        pagerdutyIntegrationKey: "fresh-pd",
        opsAlertEmail: "ops@example.test",
        opsAlertSlackWebhookUrl: "https://hooks.slack.test/fresh",
      });

    expect(res.status).toBe(200);
    expect(res.body.probes).toEqual({
      pagerdutyIntegrationKey: { ok: true },
      opsAlertEmail: { ok: true },
      opsAlertSlackWebhookUrl: { ok: true },
    });
    // Each probe was invoked exactly once with the value the admin saved
    // (so we know we're probing the user-supplied value, not a stale read
    // from storage that could differ by trimming or encoding).
    expect(seen).toHaveLength(3);
    expect(seen.find((s) => s.field === "pagerduty")?.value).toBe("fresh-pd");
    expect(seen.find((s) => s.field === "email")?.value).toBe("ops@example.test");
    expect(seen.find((s) => s.field === "slack")?.value).toBe(
      "https://hooks.slack.test/fresh",
    );
  });

  it("only probes the fields included in the update", async () => {
    let pdCalls = 0;
    let emailCalls = 0;
    let slackCalls = 0;
    __setOnCallProbesForTests({
      pagerduty: async () => {
        pdCalls += 1;
        return { ok: true };
      },
      email: async () => {
        emailCalls += 1;
        return { ok: true };
      },
      slack: async () => {
        slackCalls += 1;
        return { ok: true };
      },
    });

    const res = await request(app)
      .put("/api/admin/oncall-destinations")
      .set("Cookie", adminCookie)
      .send({ pagerdutyIntegrationKey: "only-pd" });

    expect(res.status).toBe(200);
    expect(pdCalls).toBe(1);
    expect(emailCalls).toBe(0);
    expect(slackCalls).toBe(0);
    expect(res.body.probes).toEqual({
      pagerdutyIntegrationKey: { ok: true },
    });
  });

  it("does not probe when the field is being cleared (null)", async () => {
    await setOnCallDestination("pagerdutyIntegrationKey", "to-clear", "seed");
    let pdCalls = 0;
    __setOnCallProbesForTests({
      pagerduty: async () => {
        pdCalls += 1;
        return { ok: true };
      },
      email: async () => ({ ok: true }),
      slack: async () => ({ ok: true }),
    });

    const res = await request(app)
      .put("/api/admin/oncall-destinations")
      .set("Cookie", adminCookie)
      .send({ pagerdutyIntegrationKey: null });

    expect(res.status).toBe(200);
    expect(pdCalls).toBe(0);
    // Empty `probes` rather than missing — the UI keys off the field name
    // and "no probe ran" should leave the row's probe badge unchanged.
    expect(res.body.probes).toEqual({});
  });

  it("a probe failure does not prevent the value from being saved", async () => {
    __setOnCallProbesForTests({
      pagerduty: async () => ({ ok: false, reason: "http_403" }),
      email: async () => ({ ok: true }),
      slack: async () => ({ ok: true }),
    });

    const res = await request(app)
      .put("/api/admin/oncall-destinations")
      .set("Cookie", adminCookie)
      .send({ pagerdutyIntegrationKey: "bad-but-stored" });

    expect(res.status).toBe(200);
    expect(res.body.pagerdutyConfigured).toBe(true);
    expect(res.body.probes.pagerdutyIntegrationKey).toEqual({
      ok: false,
      reason: "http_403",
    });

    // The value is durable even though the probe said it isn't reachable.
    const dest = await getOnCallDestinations();
    expect(dest.pagerdutyIntegrationKey).toBe("bad-but-stored");
  });

  it("probe exceptions degrade to a {ok:false, reason} response, not a 500", async () => {
    __setOnCallProbesForTests({
      pagerduty: async () => {
        throw new Error("ECONNREFUSED");
      },
      email: async () => ({ ok: true }),
      slack: async () => ({ ok: true }),
    });

    const res = await request(app)
      .put("/api/admin/oncall-destinations")
      .set("Cookie", adminCookie)
      .send({ pagerdutyIntegrationKey: "anything" });

    expect(res.status).toBe(200);
    expect(res.body.probes.pagerdutyIntegrationKey.ok).toBe(false);
    expect(res.body.probes.pagerdutyIntegrationKey.reason).toContain("ECONNREFUSED");
  });

  it("a probe that reports skipped is surfaced as such (not as a failure)", async () => {
    __setOnCallProbesForTests({
      pagerduty: async () => ({ ok: true }),
      email: async () => ({ ok: true, skipped: true, reason: "sendgrid_not_configured" }),
      slack: async () => ({ ok: true }),
    });

    const res = await request(app)
      .put("/api/admin/oncall-destinations")
      .set("Cookie", adminCookie)
      .send({ opsAlertEmail: "ops@example.test" });

    expect(res.status).toBe(200);
    expect(res.body.probes.opsAlertEmail).toEqual({
      ok: true,
      skipped: true,
      reason: "sendgrid_not_configured",
    });
  });

  it("records a probe_oncall_destination audit row alongside the update_setting row", async () => {
    __setOnCallProbesForTests({
      pagerduty: async () => ({ ok: false, reason: "http_403" }),
      email: async () => ({ ok: true }),
      slack: async () => ({ ok: true }),
    });

    await request(app)
      .put("/api/admin/oncall-destinations")
      .set("Cookie", adminCookie)
      .send({ pagerdutyIntegrationKey: "audit-me" });

    const audit = await db
      .select()
      .from(auditLogTable)
      .where(eq(auditLogTable.actorId, adminId));
    const probeEntries = audit.filter((a) => a.actionType === "probe_oncall_destination");
    expect(probeEntries.length).toBeGreaterThan(0);
    const entry = probeEntries[probeEntries.length - 1];
    // Outcome and reason recorded so admins can later answer "did the
    // save show a red cross at the time?" without re-probing.
    expect(entry.changeDiff).toEqual({
      probes: [
        { field: "pagerdutyIntegrationKey", ok: false, skipped: false, reason: "http_403" },
      ],
    });
    // The value itself is never written to the audit row.
    expect(JSON.stringify(entry)).not.toContain("audit-me");
  });

  it("probes the freshly saved value even when the DB row already had a different value", async () => {
    await setOnCallDestination("pagerdutyIntegrationKey", "old-value", "seed");
    let probedValue: string | null = null;
    __setOnCallProbesForTests({
      pagerduty: async (key) => {
        probedValue = key;
        return { ok: true };
      },
      email: async () => ({ ok: true }),
      slack: async () => ({ ok: true }),
    });

    const res = await request(app)
      .put("/api/admin/oncall-destinations")
      .set("Cookie", adminCookie)
      .send({ pagerdutyIntegrationKey: "new-value" });

    expect(res.status).toBe(200);
    expect(probedValue).toBe("new-value");
  });

  it("does not run any probes when the input is invalid (e.g. malformed email)", async () => {
    let probesRan = 0;
    __setOnCallProbesForTests({
      pagerduty: async () => {
        probesRan += 1;
        return { ok: true };
      },
      email: async () => {
        probesRan += 1;
        return { ok: true };
      },
      slack: async () => {
        probesRan += 1;
        return { ok: true };
      },
    });

    const res = await request(app)
      .put("/api/admin/oncall-destinations")
      .set("Cookie", adminCookie)
      .send({ opsAlertEmail: "not-an-email" });

    expect(res.status).toBe(400);
    expect(probesRan).toBe(0);
  });
});
