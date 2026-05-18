import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import { db, usersTable, upgradePromptEventsTable } from "@workspace/db";
import { inArray } from "drizzle-orm";

import { buildTestAppWithRouters } from "./test-app";
import analyticsRouter from "../routes/analytics";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const TEST_TAG = `upgrade-prompt-analytics-${randomUUID().slice(0, 8)}`;
const seededUserIds: number[] = [];

let app: ReturnType<typeof buildTestAppWithRouters>;
let adminCookie: string;
let memberCookie: string;
let adminUserId: number;

async function seedUser(role: "super_admin" | "member"): Promise<{ id: number; cookie: string }> {
  const email = `${TEST_TAG}-${role}-${randomUUID().slice(0, 6)}@example.test`;
  const passwordHash = await bcrypt.hash("irrelevant", 4);
  const [row] = await db
    .insert(usersTable)
    .values({
      email,
      name: "Upgrade prompt analytics test",
      passwordHash,
      role,
      sourceProduct: "free",
      emailVerified: true,
      onboardingComplete: true,
    })
    .returning({ id: usersTable.id });
  seededUserIds.push(row.id);
  const token = jwt.sign({ userId: row.id, email }, JWT_SECRET, { expiresIn: "1h" });
  return { id: row.id, cookie: `access_token=${token}` };
}

async function insertEvent(opts: {
  userId: number;
  eventType: "impression" | "cta_click";
  variant: "dashboard" | "sidebar";
  sourceTier: string;
  lockedFeatureKeys: string[];
  daysAgo?: number;
}) {
  const createdAt = new Date(Date.now() - (opts.daysAgo ?? 1) * 24 * 60 * 60 * 1000);
  await db.insert(upgradePromptEventsTable).values({
    userId: opts.userId,
    eventType: opts.eventType,
    variant: opts.variant,
    sourceTier: opts.sourceTier,
    lockedFeatureKeys: opts.lockedFeatureKeys,
    createdAt,
  });
}

beforeAll(async () => {
  app = buildTestAppWithRouters([analyticsRouter]);
  const admin = await seedUser("super_admin");
  adminUserId = admin.id;
  adminCookie = admin.cookie;
  const member = await seedUser("member");
  memberCookie = member.cookie;

  await insertEvent({
    userId: adminUserId,
    eventType: "impression",
    variant: "dashboard",
    sourceTier: "free",
    lockedFeatureKeys: ["software", "coaching-group"],
    daysAgo: 1,
  });
  await insertEvent({
    userId: adminUserId,
    eventType: "impression",
    variant: "dashboard",
    sourceTier: "free",
    lockedFeatureKeys: ["software", "coaching-group"],
    daysAgo: 1,
  });
  await insertEvent({
    userId: adminUserId,
    eventType: "cta_click",
    variant: "dashboard",
    sourceTier: "free",
    lockedFeatureKeys: ["software", "coaching-group"],
    daysAgo: 1,
  });
  await insertEvent({
    userId: adminUserId,
    eventType: "impression",
    variant: "sidebar",
    sourceTier: "starter",
    lockedFeatureKeys: ["coaching-1on1"],
    daysAgo: 2,
  });
  await insertEvent({
    userId: adminUserId,
    eventType: "cta_click",
    variant: "sidebar",
    sourceTier: "starter",
    lockedFeatureKeys: ["coaching-1on1"],
    daysAgo: 2,
  });
  await insertEvent({
    userId: adminUserId,
    eventType: "cta_click",
    variant: "sidebar",
    sourceTier: "starter",
    lockedFeatureKeys: ["coaching-1on1"],
    daysAgo: 2,
  });
  // Outside default range — should be excluded
  await insertEvent({
    userId: adminUserId,
    eventType: "impression",
    variant: "dashboard",
    sourceTier: "free",
    lockedFeatureKeys: ["software"],
    daysAgo: 90,
  });
});

afterAll(async () => {
  if (seededUserIds.length > 0) {
    await db.delete(upgradePromptEventsTable).where(inArray(upgradePromptEventsTable.userId, seededUserIds));
    await db.delete(usersTable).where(inArray(usersTable.id, seededUserIds));
  }
});

describe("GET /api/admin/analytics/upgrade-prompts", () => {
  it("rejects unauthenticated requests", async () => {
    const res = await request(app).get("/api/admin/analytics/upgrade-prompts");
    expect(res.status).toBe(401);
  });

  it("rejects non-admin members", async () => {
    const res = await request(app)
      .get("/api/admin/analytics/upgrade-prompts")
      .set("Cookie", memberCookie);
    expect(res.status).toBe(403);
  });

  it("returns aggregated CTR by variant, tier, and feature combinations", async () => {
    const res = await request(app)
      .get("/api/admin/analytics/upgrade-prompts")
      .set("Cookie", adminCookie);
    expect(res.status).toBe(200);

    const body = res.body as {
      range: { from: string; to: string };
      totals: { impressions: number; clicks: number; ctr: number };
      byVariant: { variant: string; impressions: number; clicks: number; ctr: number }[];
      byTier: { sourceTier: string; impressions: number; clicks: number; ctr: number }[];
      daily: { day: string; impressions: number; clicks: number; ctr: number }[];
      topFeatureCombos: { keys: string[]; impressions: number; clicks: number; ctr: number }[];
    };

    expect(Array.isArray(body.daily)).toBe(true);
    expect(body.daily.length).toBeGreaterThanOrEqual(2);
    // Days are returned in ascending order
    const days = body.daily.map((d) => d.day);
    expect([...days].sort()).toEqual(days);
    // Each row should be a YYYY-MM-DD date string
    for (const row of body.daily) {
      expect(row.day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(row.ctr).toBe(
        row.impressions > 0 ? Math.round((row.clicks / row.impressions) * 1000) / 10 : 0,
      );
    }
    const totalImpressionsFromDaily = body.daily.reduce((sum, r) => sum + r.impressions, 0);
    const totalClicksFromDaily = body.daily.reduce((sum, r) => sum + r.clicks, 0);
    expect(totalImpressionsFromDaily).toBe(body.totals.impressions);
    expect(totalClicksFromDaily).toBe(body.totals.clicks);

    expect(body.range.from).toBeTruthy();
    expect(body.range.to).toBeTruthy();

    const dashboard = body.byVariant.find((v) => v.variant === "dashboard");
    const sidebar = body.byVariant.find((v) => v.variant === "sidebar");
    expect(dashboard).toBeDefined();
    expect(sidebar).toBeDefined();
    expect(dashboard!.impressions).toBeGreaterThanOrEqual(2);
    expect(dashboard!.clicks).toBeGreaterThanOrEqual(1);
    expect(sidebar!.impressions).toBeGreaterThanOrEqual(1);
    expect(sidebar!.clicks).toBeGreaterThanOrEqual(2);

    // CTR rounding: dashboard 1/2 = 50%, sidebar 2/1 = 200%
    expect(dashboard!.ctr).toBeCloseTo(50, 1);

    const free = body.byTier.find((t) => t.sourceTier === "free");
    const starter = body.byTier.find((t) => t.sourceTier === "starter");
    expect(free).toBeDefined();
    expect(starter).toBeDefined();

    const combo = body.topFeatureCombos.find(
      (c) => c.keys.length === 2 && c.keys.includes("software") && c.keys.includes("coaching-group"),
    );
    expect(combo).toBeDefined();
    expect(combo!.impressions).toBeGreaterThanOrEqual(2);
    expect(combo!.clicks).toBeGreaterThanOrEqual(1);

    const singleCombo = body.topFeatureCombos.find(
      (c) => c.keys.length === 1 && c.keys[0] === "coaching-1on1",
    );
    expect(singleCombo).toBeDefined();
    expect(singleCombo!.clicks).toBeGreaterThanOrEqual(2);
  });

  it("respects the from/to date range filter", async () => {
    const from = new Date(Date.now() - 1.5 * 24 * 60 * 60 * 1000).toISOString();
    const to = new Date().toISOString();
    const res = await request(app)
      .get(`/api/admin/analytics/upgrade-prompts?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`)
      .set("Cookie", adminCookie);
    expect(res.status).toBe(200);

    const body = res.body as {
      byVariant: { variant: string; impressions: number; clicks: number }[];
    };

    const sidebar = body.byVariant.find((v) => v.variant === "sidebar");
    // sidebar events were 2 days ago — outside this 1.5-day window
    expect(sidebar).toBeUndefined();

    const dashboard = body.byVariant.find((v) => v.variant === "dashboard");
    expect(dashboard).toBeDefined();
  });

  it("rejects invalid date ranges", async () => {
    const res = await request(app)
      .get("/api/admin/analytics/upgrade-prompts?from=not-a-date")
      .set("Cookie", adminCookie);
    expect(res.status).toBe(400);
  });

  it("filters totals, daily, byVariant, and byTier by variant", async () => {
    const res = await request(app)
      .get("/api/admin/analytics/upgrade-prompts?variant=sidebar")
      .set("Cookie", adminCookie);
    expect(res.status).toBe(200);

    const body = res.body as {
      totals: { impressions: number; clicks: number };
      byVariant: { variant: string }[];
      byTier: { sourceTier: string; impressions: number; clicks: number }[];
      daily: { impressions: number; clicks: number }[];
    };

    // Only sidebar should appear
    expect(body.byVariant.every((v) => v.variant === "sidebar")).toBe(true);
    // Sidebar events were all on "starter"
    expect(body.byTier.every((t) => t.sourceTier === "starter")).toBe(true);

    const dailyImpressions = body.daily.reduce((s, r) => s + r.impressions, 0);
    const dailyClicks = body.daily.reduce((s, r) => s + r.clicks, 0);
    expect(dailyImpressions).toBe(body.totals.impressions);
    expect(dailyClicks).toBe(body.totals.clicks);
    // Sidebar seed events: 1 impression, 2 clicks
    expect(body.totals.impressions).toBe(1);
    expect(body.totals.clicks).toBe(2);
  });

  it("filters by source tier", async () => {
    const res = await request(app)
      .get("/api/admin/analytics/upgrade-prompts?sourceTier=free")
      .set("Cookie", adminCookie);
    expect(res.status).toBe(200);

    const body = res.body as {
      totals: { impressions: number; clicks: number };
      byTier: { sourceTier: string }[];
      byVariant: { variant: string }[];
    };
    expect(body.byTier.every((t) => t.sourceTier === "free")).toBe(true);
    // Free-tier events were all on dashboard
    expect(body.byVariant.every((v) => v.variant === "dashboard")).toBe(true);
    expect(body.totals.impressions).toBe(2);
    expect(body.totals.clicks).toBe(1);
  });

  it("filters by variant and source tier together", async () => {
    const res = await request(app)
      .get("/api/admin/analytics/upgrade-prompts?variant=dashboard&sourceTier=starter")
      .set("Cookie", adminCookie);
    expect(res.status).toBe(200);

    const body = res.body as {
      totals: { impressions: number; clicks: number };
      daily: unknown[];
    };
    // No events match dashboard+starter in the seed data
    expect(body.totals.impressions).toBe(0);
    expect(body.totals.clicks).toBe(0);
    expect(body.daily.length).toBe(0);
  });

  it("rejects an unknown variant filter", async () => {
    const res = await request(app)
      .get("/api/admin/analytics/upgrade-prompts?variant=popup")
      .set("Cookie", adminCookie);
    expect(res.status).toBe(400);
  });

  it("rejects ranges where from is after to", async () => {
    const from = new Date().toISOString();
    const to = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const res = await request(app)
      .get(`/api/admin/analytics/upgrade-prompts?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`)
      .set("Cookie", adminCookie);
    expect(res.status).toBe(400);
  });
});
