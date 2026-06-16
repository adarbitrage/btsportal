import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import { db, usersTable } from "@workspace/db";
import { inArray } from "drizzle-orm";

import adminPanelRouter from "../routes/admin-panel";
import {
  evaluateTicketDeskDeliveryAlert,
  __resetTicketDeskDeliveryAlerterForTests,
  __setTicketDeskDeliveryStatsReaderForTests,
  __setTicketDeskDeliveryAlerterDeliveriesForTests,
} from "../lib/ticketdesk-delivery-alerter";
import type { StuckTicketDeliveryStats } from "../lib/ticketdesk-queue";
import { buildTestAppWithRouters } from "./test-app";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const TEST_TAG = `ticketdesk-delivery-health-${randomUUID().slice(0, 8)}`;

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

/** A stats reader stub returning a fixed stuck-ticket snapshot. */
function statsReturning(count: number): StuckTicketDeliveryStats {
  return {
    count,
    byStatus: {
      pending: count > 0 ? 1 : 0,
      failed: count > 0 ? count - 1 : 0,
    },
    oldestCreatedAt: count > 0 ? new Date(0).toISOString() : null,
    lastError: count > 0 ? "http_403: Origin not allowed" : null,
    stuckMinutes: 30,
  };
}

/** Replace every delivery channel with a no-op so driving the alerter to
 * "alerting" in tests never tries to actually page on-call. */
function silenceDeliveries(): void {
  const noop = vi.fn(async (p: { kind: "fire" | "clear" }) => ({
    channel: "pagerduty" as const,
    ok: true,
    kind: p.kind,
  }));
  __setTicketDeskDeliveryAlerterDeliveriesForTests({
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
  __resetTicketDeskDeliveryAlerterForTests();
  if (seededUserIds.length > 0) {
    await db.delete(usersTable).where(inArray(usersTable.id, seededUserIds));
  }
});

beforeEach(() => {
  __resetTicketDeskDeliveryAlerterForTests();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("GET /api/admin/system/health — ticketDeskDelivery (stuck backlog) surfacing", () => {
  it("includes a services.ticketDeskDelivery block that is not alerting when the backlog is empty", async () => {
    __setTicketDeskDeliveryStatsReaderForTests(async () => statsReturning(0));
    silenceDeliveries();
    await evaluateTicketDeskDeliveryAlert();

    const res = await request(app)
      .get("/api/admin/system/health")
      .set("Cookie", adminCookie);

    expect(res.status).toBe(200);
    const td = res.body.services?.ticketDeskDelivery;
    expect(td).toBeDefined();
    expect(td.alerter).toBeDefined();
    expect(td.alerter.alerting).toBe(false);
    expect(td.stuck).toBeDefined();

    // Distinct from the origin-gate probe block.
    expect(res.body.services?.ticketDeskDeliveryGate).toBeDefined();
    expect(td).not.toBe(res.body.services?.ticketDeskDeliveryGate);
  });

  it("flips overallStatus to degraded and reports alerting once the stuck backlog crosses the threshold", async () => {
    // Default backlog threshold is 5; a count well above it guarantees a fire.
    __setTicketDeskDeliveryStatsReaderForTests(async () => statsReturning(7));
    silenceDeliveries();
    await evaluateTicketDeskDeliveryAlert();

    const res = await request(app)
      .get("/api/admin/system/health")
      .set("Cookie", adminCookie);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("degraded");

    const td = res.body.services.ticketDeskDelivery;
    expect(td.alerter.alerting).toBe(true);
    expect(td.alerter.lastSeenCount).toBe(7);
  });

  it("rejects callers without system:view permission", async () => {
    const res = await request(app)
      .get("/api/admin/system/health")
      .set("Cookie", memberCookie);
    expect(res.status).toBe(403);
  });
});
