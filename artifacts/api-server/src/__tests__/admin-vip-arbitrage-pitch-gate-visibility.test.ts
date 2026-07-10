import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import { db, usersTable, systemSettingsTable, auditLogTable } from "@workspace/db";
import { inArray, eq, and } from "drizzle-orm";

vi.mock("../lib/redis", () => ({
  getRedis: () => null,
  getRedisConnection: vi.fn(),
  createRedisConnection: vi.fn(),
  isRedisConnected: vi.fn(async () => false),
}));

import { buildTestAppWithRouters } from "./test-app";
import adminPanelRouter from "../routes/admin-panel";
import { __invalidatePitchContentCacheForTests } from "../lib/pitch-content-settings";

// Task #1853: compliance visibility for the VIP Arbitrage pitch gate.
// 1. `/admin/system/health` carries a `vipArbitragePitch` block so an admin
//    can see live-vs-suppressed without opening the Pitch Content editor.
// 2. Flipping `reviewed` via PUT /admin/pitch-content/VIP_ARBITRAGE_PITCH
//    writes a dedicated `vip_arbitrage_pitch_review_gate` audit entry with
//    who/when/direction; a save that does NOT flip the gate writes none.

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const TEST_TAG = `vip-gate-${randomUUID().slice(0, 8)}`;
const SETTING_KEY = "pitch.vip_arbitrage";
const GATE_ACTION = "vip_arbitrage_pitch_review_gate";

let app: ReturnType<typeof buildTestAppWithRouters>;
let adminCookie = "";
let adminEmail = "";
const seededIds: number[] = [];

const BASE_CONTENT = {
  heading: "Test VIP Arbitrage heading",
  line: "Test VIP Arbitrage line",
  buttonLabel: "Learn More",
  buttonUrl: "https://example.test/vip-arbitrage",
};

async function resetVipRow(): Promise<void> {
  await db.delete(systemSettingsTable).where(eq(systemSettingsTable.key, SETTING_KEY));
  __invalidatePitchContentCacheForTests();
}

async function gateAuditEntries() {
  return db
    .select()
    .from(auditLogTable)
    .where(and(eq(auditLogTable.actionType, GATE_ACTION), eq(auditLogTable.actorEmail, adminEmail)));
}

beforeAll(async () => {
  app = buildTestAppWithRouters([adminPanelRouter]);
  adminEmail = `${TEST_TAG}@example.test`;
  const passwordHash = await bcrypt.hash("irrelevant-test-password", 4);
  const [row] = await db
    .insert(usersTable)
    .values({
      email: adminEmail,
      name: "Test super admin",
      passwordHash,
      role: "super_admin",
      sourceProduct: "lifetime",
      emailVerified: true,
      onboardingComplete: true,
    })
    .returning({ id: usersTable.id });
  seededIds.push(row.id);
  const token = jwt.sign({ userId: row.id, email: adminEmail }, JWT_SECRET, { expiresIn: "1h" });
  adminCookie = `access_token=${token}`;
  await resetVipRow();
});

afterAll(async () => {
  await resetVipRow();
  await db.delete(auditLogTable).where(eq(auditLogTable.actorEmail, adminEmail));
  if (seededIds.length > 0) {
    await db.delete(usersTable).where(inArray(usersTable.id, seededIds));
  }
});

describe("VIP Arbitrage pitch gate visibility (Task #1853)", () => {
  it("system health reports the gate as suppressed by default (no saved row)", async () => {
    await resetVipRow();
    const res = await request(app)
      .get("/api/admin/system/health")
      .set("Cookie", adminCookie);
    expect(res.status).toBe(200);
    expect(res.body?.services?.vipArbitragePitch).toEqual({
      reviewed: false,
      status: "suppressed",
    });
  });

  it("saving content WITHOUT flipping the gate writes no gate audit entry", async () => {
    await resetVipRow();
    const before = (await gateAuditEntries()).length;
    const res = await request(app)
      .put("/api/admin/pitch-content/VIP_ARBITRAGE_PITCH")
      .set("Cookie", adminCookie)
      .send({ ...BASE_CONTENT, reviewed: false });
    expect(res.status).toBe(200);
    const after = await gateAuditEntries();
    expect(after.length).toBe(before);
  });

  it("flipping reviewed to true writes an APPROVED audit entry and health flips to live", async () => {
    const before = (await gateAuditEntries()).length;
    const res = await request(app)
      .put("/api/admin/pitch-content/VIP_ARBITRAGE_PITCH")
      .set("Cookie", adminCookie)
      .send({ ...BASE_CONTENT, reviewed: true });
    expect(res.status).toBe(200);
    expect(res.body?.VIP_ARBITRAGE_PITCH?.reviewed).toBe(true);

    const entries = await gateAuditEntries();
    expect(entries.length).toBe(before + 1);
    const latest = entries[entries.length - 1];
    expect(latest.description).toContain("LIVE");
    expect(latest.actorEmail).toBe(adminEmail);
    expect(latest.entityType).toBe("VIP_ARBITRAGE_PITCH");
    expect((latest.changeDiff as Record<string, unknown>)?.reviewed).toBe(true);
    expect((latest.changeDiff as Record<string, unknown>)?.previousReviewed).toBe(false);

    const health = await request(app)
      .get("/api/admin/system/health")
      .set("Cookie", adminCookie);
    expect(health.status).toBe(200);
    expect(health.body?.services?.vipArbitragePitch).toEqual({
      reviewed: true,
      status: "live",
    });
  });

  it("re-saving with reviewed still true writes no additional gate entry", async () => {
    const before = (await gateAuditEntries()).length;
    const res = await request(app)
      .put("/api/admin/pitch-content/VIP_ARBITRAGE_PITCH")
      .set("Cookie", adminCookie)
      .send({ ...BASE_CONTENT, heading: "Edited heading, gate unchanged", reviewed: true });
    expect(res.status).toBe(200);
    const after = await gateAuditEntries();
    expect(after.length).toBe(before);
  });

  it("flipping reviewed back to false writes a SUPPRESSED audit entry and health flips back", async () => {
    const before = (await gateAuditEntries()).length;
    const res = await request(app)
      .put("/api/admin/pitch-content/VIP_ARBITRAGE_PITCH")
      .set("Cookie", adminCookie)
      .send({ ...BASE_CONTENT, reviewed: false });
    expect(res.status).toBe(200);

    const entries = await gateAuditEntries();
    expect(entries.length).toBe(before + 1);
    const latest = entries[entries.length - 1];
    expect(latest.description).toContain("SUPPRESSED");
    expect((latest.changeDiff as Record<string, unknown>)?.reviewed).toBe(false);
    expect((latest.changeDiff as Record<string, unknown>)?.previousReviewed).toBe(true);

    const health = await request(app)
      .get("/api/admin/system/health")
      .set("Cookie", adminCookie);
    expect(health.status).toBe(200);
    expect(health.body?.services?.vipArbitragePitch).toEqual({
      reviewed: false,
      status: "suppressed",
    });
  });

  it("omitting reviewed entirely on a save while the gate is open closes it with an audit entry (fail-closed)", async () => {
    // Open the gate first.
    await request(app)
      .put("/api/admin/pitch-content/VIP_ARBITRAGE_PITCH")
      .set("Cookie", adminCookie)
      .send({ ...BASE_CONTENT, reviewed: true });
    const before = (await gateAuditEntries()).length;

    // A save with no `reviewed` field stores no reviewed:true — the strict
    // parse treats that as suppressed, so the flip must be audited too.
    const res = await request(app)
      .put("/api/admin/pitch-content/VIP_ARBITRAGE_PITCH")
      .set("Cookie", adminCookie)
      .send({ ...BASE_CONTENT });
    expect(res.status).toBe(200);
    expect(res.body?.VIP_ARBITRAGE_PITCH?.reviewed ?? false).toBe(false);

    const entries = await gateAuditEntries();
    expect(entries.length).toBe(before + 1);
    expect(entries[entries.length - 1].description).toContain("SUPPRESSED");
  });
});
