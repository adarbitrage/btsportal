import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import { db, usersTable } from "@workspace/db";
import { inArray } from "drizzle-orm";

import adminPanelRouter from "../routes/admin-panel";
import {
  evaluateTicketDeskDeliveryProbe,
  __resetTicketDeskDeliveryProbeForTests,
  __setTicketDeskDeliveryProbeFetchForTests,
  __setTicketDeskDeliveryProbeDeliveriesForTests,
} from "../lib/ticketdesk-delivery-probe";
import { buildTestAppWithRouters } from "./test-app";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const TEST_TAG = `ticketdesk-delivery-gate-health-${randomUUID().slice(0, 8)}`;

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

/** A fetch stub returning the given status + body once per call. */
function fetchReturning(status: number, body = "ok"): typeof fetch {
  return (async () =>
    new Response(body, { status })) as unknown as typeof fetch;
}

/** Replace every delivery channel with a no-op so driving the state machine
 * to "blocked" in tests never tries to actually page on-call. */
function silenceDeliveries(): void {
  const noop = vi.fn(async (p: { kind: "fire" | "clear" }) => ({
    channel: "pagerduty" as const,
    ok: true,
    kind: p.kind,
  }));
  __setTicketDeskDeliveryProbeDeliveriesForTests({
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
  __resetTicketDeskDeliveryProbeForTests();
  if (seededUserIds.length > 0) {
    await db.delete(usersTable).where(inArray(usersTable.id, seededUserIds));
  }
});

beforeEach(() => {
  __resetTicketDeskDeliveryProbeForTests();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("GET /api/admin/system/health — ticketDeskDeliveryGate surfacing", () => {
  it("includes a services.ticketDeskDeliveryGate block with the expected fields", async () => {
    __setTicketDeskDeliveryProbeFetchForTests(fetchReturning(201));
    silenceDeliveries();
    await evaluateTicketDeskDeliveryProbe();

    const res = await request(app)
      .get("/api/admin/system/health")
      .set("Cookie", adminCookie);

    expect(res.status).toBe(200);
    const dg = res.body.services?.ticketDeskDeliveryGate;
    expect(dg).toBeDefined();

    // Distinct from the stuck-backlog ticketDeskDelivery block.
    expect(res.body.services?.ticketDeskDelivery).toBeDefined();
    expect(dg).not.toBe(res.body.services?.ticketDeskDelivery);

    expect(typeof dg.origin).toBe("string");
    expect(dg.status).toBe("ok");
    expect(dg.alerting).toBe(false);
    expect(typeof dg.threshold).toBe("number");
    expect(dg.consecutiveBlocked).toBe(0);
    expect(dg.consecutiveUnreachable).toBe(0);
    expect(Array.isArray(dg.reasons)).toBe(true);
    expect("lastCheckedAt" in dg).toBe(true);
    expect("lastOkAt" in dg).toBe(true);
    expect("lastBlockedAt" in dg).toBe(true);
    expect("lastUnreachableAt" in dg).toBe(true);
    expect("lastError" in dg).toBe(true);
    expect(typeof dg.lastCheckedAt).toBe("string");
    expect(typeof dg.lastOkAt).toBe("string");
  });

  it("flips overallStatus to degraded and reports blocked/alerting once the origin gate rejects past threshold", async () => {
    __setTicketDeskDeliveryProbeFetchForTests(
      fetchReturning(403, "Origin not allowed"),
    );
    silenceDeliveries();

    await evaluateTicketDeskDeliveryProbe();
    await evaluateTicketDeskDeliveryProbe();
    await evaluateTicketDeskDeliveryProbe();

    const res = await request(app)
      .get("/api/admin/system/health")
      .set("Cookie", adminCookie);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("degraded");

    const dg = res.body.services.ticketDeskDeliveryGate;
    expect(dg.status).toBe("blocked");
    expect(dg.alerting).toBe(true);
    expect(dg.consecutiveBlocked).toBe(3);
    expect(dg.consecutiveBlocked).toBeGreaterThanOrEqual(dg.threshold);
    expect(dg.reasons.join(" ")).toMatch(/origin not allowed/i);
    expect(typeof dg.lastBlockedAt).toBe("string");
  });

  it("treats a 5xx server error as unreachable (inconclusive), not blocked", async () => {
    __setTicketDeskDeliveryProbeFetchForTests(fetchReturning(503));
    silenceDeliveries();

    await evaluateTicketDeskDeliveryProbe();

    const res = await request(app)
      .get("/api/admin/system/health")
      .set("Cookie", adminCookie);

    expect(res.status).toBe(200);
    const dg = res.body.services.ticketDeskDeliveryGate;
    expect(dg.status).toBe("unreachable");
    expect(dg.consecutiveBlocked).toBe(0);
    expect(dg.alerting).toBe(false);
  });

  it("rejects callers without system:view permission", async () => {
    const res = await request(app)
      .get("/api/admin/system/health")
      .set("Cookie", memberCookie);
    expect(res.status).toBe(403);
  });
});
