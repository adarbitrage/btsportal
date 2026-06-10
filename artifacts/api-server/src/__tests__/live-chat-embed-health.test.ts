import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import { db, usersTable } from "@workspace/db";
import { inArray } from "drizzle-orm";

import {
  DEFAULT_TICKETDESK_URL,
  DEFAULT_TICKETDESK_WIDGET_SCRIPT_URL,
} from "@workspace/support-config";

import adminPanelRouter from "../routes/admin-panel";
import {
  evaluateLiveChatEmbedProbe,
  getLiveChatEmbedProbeUrl,
  __resetLiveChatEmbedProbeForTests,
  __setLiveChatEmbedProbeFetchForTests,
  __setLiveChatEmbedProbeDeliveriesForTests,
} from "../lib/live-chat-embed-probe";
import { buildTestAppWithRouters } from "./test-app";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const TEST_TAG = `live-chat-embed-health-${randomUUID().slice(0, 8)}`;

const seededUserIds: number[] = [];
let app: ReturnType<typeof buildTestAppWithRouters>;
let adminCookie = "";
let memberCookie = "";

function signCookie(userId: number, email: string): string {
  const token = jwt.sign({ userId, email }, JWT_SECRET, { expiresIn: "1h" });
  return `access_token=${token}`;
}

async function seedUser(
  role: "super_admin" | "member",
): Promise<{ id: number; email: string; cookie: string }> {
  const email = `${TEST_TAG}-${role}@example.test`;
  const passwordHash = await bcrypt.hash("irrelevant-test-password", 4);
  const [row] = await db
    .insert(usersTable)
    .values({
      email,
      name: `Test ${role}`,
      passwordHash,
      role,
      sourceProduct: "lifetime",
      emailVerified: true,
      onboardingComplete: true,
    })
    .returning({ id: usersTable.id });
  seededUserIds.push(row.id);
  return { id: row.id, email, cookie: signCookie(row.id, email) };
}

/** A fetch stub returning the given status once per call. */
function fetchReturning(status: number): typeof fetch {
  return (async () =>
    new Response("ok", {
      status,
      headers: new Headers({}),
    })) as unknown as typeof fetch;
}

/** Replace every delivery channel with a no-op so driving the state machine
 * to "blocked" in tests never tries to actually page on-call. */
function silenceDeliveries(): void {
  const noop = vi.fn(async (p: { kind: "fire" | "clear" }) => ({
    channel: "pagerduty" as const,
    ok: true,
    kind: p.kind,
  }));
  __setLiveChatEmbedProbeDeliveriesForTests({
    pagerduty: noop as never,
    email: noop as never,
    slack: noop as never,
  });
}

beforeAll(async () => {
  app = buildTestAppWithRouters([adminPanelRouter]);
  const admin = await seedUser("super_admin");
  const member = await seedUser("member");
  adminCookie = admin.cookie;
  memberCookie = member.cookie;
});

afterAll(async () => {
  __resetLiveChatEmbedProbeForTests();
  if (seededUserIds.length > 0) {
    await db.delete(usersTable).where(inArray(usersTable.id, seededUserIds));
  }
});

beforeEach(() => {
  // The probe keeps its rolling state in module-level memory; reset between
  // tests so an earlier blocked streak doesn't bleed into a later assertion.
  __resetLiveChatEmbedProbeForTests();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("GET /api/admin/system/health — liveChatEmbed surfacing", () => {
  it("includes a services.liveChatEmbed block with the expected fields", async () => {
    // Drive one clean probe so the snapshot has concrete (non-null) status.
    __setLiveChatEmbedProbeFetchForTests(fetchReturning(200));
    silenceDeliveries();
    await evaluateLiveChatEmbedProbe();

    const res = await request(app)
      .get("/api/admin/system/health")
      .set("Cookie", adminCookie);

    expect(res.status).toBe(200);
    const lce = res.body.services?.liveChatEmbed;
    expect(lce).toBeDefined();

    // Every field the System Health card relies on must be present.
    expect(typeof lce.url).toBe("string");
    expect(lce.status).toBe("ok");
    expect(lce.alerting).toBe(false);
    expect(typeof lce.threshold).toBe("number");
    expect(lce.consecutiveBlocked).toBe(0);
    expect(lce.consecutiveUnreachable).toBe(0);
    expect(Array.isArray(lce.reasons)).toBe(true);
    expect("lastCheckedAt" in lce).toBe(true);
    expect("lastOkAt" in lce).toBe(true);
    expect("lastBlockedAt" in lce).toBe(true);
    expect("lastUnreachableAt" in lce).toBe(true);
    expect("lastError" in lce).toBe(true);
    // A probe just ran cleanly, so these timestamps should be populated.
    expect(typeof lce.lastCheckedAt).toBe("string");
    expect(typeof lce.lastOkAt).toBe("string");
  });

  it("flips overallStatus to degraded and reports blocked/alerting once the widget script is unavailable past threshold", async () => {
    // 404 → "blocked" (script definitively not loadable).
    __setLiveChatEmbedProbeFetchForTests(fetchReturning(404));
    silenceDeliveries();

    // Threshold defaults to 3 — drive three consecutive blocked probes so the
    // state machine flips to alerting.
    await evaluateLiveChatEmbedProbe();
    await evaluateLiveChatEmbedProbe();
    await evaluateLiveChatEmbedProbe();

    const res = await request(app)
      .get("/api/admin/system/health")
      .set("Cookie", adminCookie);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("degraded");

    const lce = res.body.services.liveChatEmbed;
    expect(lce.status).toBe("blocked");
    expect(lce.alerting).toBe(true);
    expect(lce.consecutiveBlocked).toBe(3);
    expect(lce.consecutiveBlocked).toBeGreaterThanOrEqual(lce.threshold);
    expect(lce.reasons).toContain("http_404");
    expect(typeof lce.lastBlockedAt).toBe("string");
  });

  it("treats a 5xx server error as unreachable (inconclusive), not blocked", async () => {
    __setLiveChatEmbedProbeFetchForTests(fetchReturning(503));
    silenceDeliveries();

    await evaluateLiveChatEmbedProbe();

    const res = await request(app)
      .get("/api/admin/system/health")
      .set("Cookie", adminCookie);

    expect(res.status).toBe(200);
    const lce = res.body.services.liveChatEmbed;
    expect(lce.status).toBe("unreachable");
    expect(lce.consecutiveBlocked).toBe(0);
    expect(lce.alerting).toBe(false);
  });

  it("rejects callers without system:view permission", async () => {
    const res = await request(app)
      .get("/api/admin/system/health")
      .set("Cookie", memberCookie);
    expect(res.status).toBe(403);
  });
});

describe("GET /api/admin/system/live-chat-support", () => {
  it("returns the resolved probe URL, source, and shared default for admins", async () => {
    const prev = process.env.LIVE_CHAT_EMBED_PROBE_URL;
    delete process.env.LIVE_CHAT_EMBED_PROBE_URL;
    try {
      const res = await request(app)
        .get("/api/admin/system/live-chat-support")
        .set("Cookie", adminCookie);

      expect(res.status).toBe(200);
      // probeUrl now defaults to the widget script URL (not the root URL).
      expect(res.body.probeUrl).toBe(DEFAULT_TICKETDESK_WIDGET_SCRIPT_URL);
      expect(res.body.probeUrlSource).toBe("default");
      // defaultUrl reflects the widget script default, keeping it in lockstep.
      expect(res.body.defaultUrl).toBe(DEFAULT_TICKETDESK_WIDGET_SCRIPT_URL);
    } finally {
      if (prev === undefined) delete process.env.LIVE_CHAT_EMBED_PROBE_URL;
      else process.env.LIVE_CHAT_EMBED_PROBE_URL = prev;
    }
  });

  it("reports an env override when LIVE_CHAT_EMBED_PROBE_URL is set", async () => {
    const prev = process.env.LIVE_CHAT_EMBED_PROBE_URL;
    process.env.LIVE_CHAT_EMBED_PROBE_URL = "https://support.example.test/";
    try {
      const res = await request(app)
        .get("/api/admin/system/live-chat-support")
        .set("Cookie", adminCookie);

      expect(res.status).toBe(200);
      expect(res.body.probeUrl).toBe("https://support.example.test/");
      expect(res.body.probeUrlSource).toBe("env");
      expect(res.body.defaultUrl).toBe(DEFAULT_TICKETDESK_WIDGET_SCRIPT_URL);
    } finally {
      if (prev === undefined) delete process.env.LIVE_CHAT_EMBED_PROBE_URL;
      else process.env.LIVE_CHAT_EMBED_PROBE_URL = prev;
    }
  });

  it("rejects callers without settings:view permission", async () => {
    const res = await request(app)
      .get("/api/admin/system/live-chat-support")
      .set("Cookie", memberCookie);
    expect(res.status).toBe(403);
  });
});

describe("Live Chat widget URL lockstep", () => {
  it("backend probe default resolves from the shared support-config widget script URL", () => {
    // With no LIVE_CHAT_EMBED_PROBE_URL override, the probe must fall back to
    // the exact same widget script URL the portal embed (LiveChatLauncher.tsx)
    // uses. If these ever diverge, System Health would probe a different URL
    // than the one members actually load — masking a real widget outage.
    const prev = process.env.LIVE_CHAT_EMBED_PROBE_URL;
    delete process.env.LIVE_CHAT_EMBED_PROBE_URL;
    try {
      expect(getLiveChatEmbedProbeUrl()).toBe(DEFAULT_TICKETDESK_WIDGET_SCRIPT_URL);
    } finally {
      if (prev === undefined) delete process.env.LIVE_CHAT_EMBED_PROBE_URL;
      else process.env.LIVE_CHAT_EMBED_PROBE_URL = prev;
    }
  });
});

// Keep DEFAULT_TICKETDESK_URL imported to ensure the root URL constant is still
// accessible for any callers that reference it (e.g. the live-chat-support
// endpoint's defaultUrl field, which previously pointed at the root URL).
void DEFAULT_TICKETDESK_URL;
