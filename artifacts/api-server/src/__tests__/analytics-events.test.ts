import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import { db, usersTable, upgradePromptEventsTable } from "@workspace/db";
import { eq, inArray, desc } from "drizzle-orm";

import { buildTestAppWithRouters } from "./test-app";
import analyticsRouter from "../routes/analytics";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const TEST_TAG = `analytics-events-${randomUUID().slice(0, 8)}`;
const seededUserIds: number[] = [];

let app: ReturnType<typeof buildTestAppWithRouters>;

async function seedMember(): Promise<{ id: number; cookie: string }> {
  const email = `${TEST_TAG}-${randomUUID().slice(0, 6)}@example.test`;
  const passwordHash = await bcrypt.hash("irrelevant", 4);
  const [row] = await db
    .insert(usersTable)
    .values({
      email,
      name: "Analytics Test",
      passwordHash,
      role: "member",
      sourceProduct: "free",
      emailVerified: true,
      onboardingComplete: true,
    })
    .returning({ id: usersTable.id });
  seededUserIds.push(row.id);
  const token = jwt.sign({ userId: row.id, email }, JWT_SECRET, { expiresIn: "1h" });
  return { id: row.id, cookie: `access_token=${token}` };
}

beforeAll(() => {
  app = buildTestAppWithRouters([analyticsRouter]);
});

afterAll(async () => {
  if (seededUserIds.length > 0) {
    await db.delete(upgradePromptEventsTable).where(inArray(upgradePromptEventsTable.userId, seededUserIds));
    await db.delete(usersTable).where(inArray(usersTable.id, seededUserIds));
  }
});

describe("POST /api/analytics/events — upgrade prompt tracking", () => {
  it("requires authentication", async () => {
    const res = await request(app)
      .post("/api/analytics/events")
      .send({
        eventType: "impression",
        variant: "dashboard",
        sourceTier: "free",
        lockedFeatureKeys: ["software"],
      });
    expect(res.status).toBe(401);
  });

  it("records an impression event with variant, tier, and feature keys", async () => {
    const { id, cookie } = await seedMember();

    const res = await request(app)
      .post("/api/analytics/events")
      .set("Cookie", cookie)
      .send({
        eventType: "impression",
        variant: "dashboard",
        sourceTier: "free",
        lockedFeatureKeys: ["software", "coaching-group", "community"],
      });

    expect(res.status).toBe(204);

    const rows = await db
      .select()
      .from(upgradePromptEventsTable)
      .where(eq(upgradePromptEventsTable.userId, id))
      .orderBy(desc(upgradePromptEventsTable.createdAt));
    expect(rows).toHaveLength(1);
    expect(rows[0].eventType).toBe("impression");
    expect(rows[0].variant).toBe("dashboard");
    expect(rows[0].sourceTier).toBe("free");
    expect(rows[0].lockedFeatureKeys).toEqual(["software", "coaching-group", "community"]);
  });

  it("records a cta_click event for the sidebar variant", async () => {
    const { id, cookie } = await seedMember();

    const res = await request(app)
      .post("/api/analytics/events")
      .set("Cookie", cookie)
      .send({
        eventType: "cta_click",
        variant: "sidebar",
        sourceTier: "starter",
        lockedFeatureKeys: ["coaching-1on1"],
      });

    expect(res.status).toBe(204);

    const [row] = await db
      .select()
      .from(upgradePromptEventsTable)
      .where(eq(upgradePromptEventsTable.userId, id));
    expect(row.eventType).toBe("cta_click");
    expect(row.variant).toBe("sidebar");
    expect(row.sourceTier).toBe("starter");
    expect(row.lockedFeatureKeys).toEqual(["coaching-1on1"]);
  });

  it("rejects unknown event types", async () => {
    const { cookie } = await seedMember();
    const res = await request(app)
      .post("/api/analytics/events")
      .set("Cookie", cookie)
      .send({
        eventType: "bogus",
        variant: "dashboard",
        sourceTier: "free",
        lockedFeatureKeys: [],
      });
    expect(res.status).toBe(400);
  });

  it("rejects unknown variants", async () => {
    const { cookie } = await seedMember();
    const res = await request(app)
      .post("/api/analytics/events")
      .set("Cookie", cookie)
      .send({
        eventType: "impression",
        variant: "popup",
        sourceTier: "free",
        lockedFeatureKeys: [],
      });
    expect(res.status).toBe(400);
  });

  it("rejects malformed lockedFeatureKeys payloads", async () => {
    const { cookie } = await seedMember();
    const res = await request(app)
      .post("/api/analytics/events")
      .set("Cookie", cookie)
      .send({
        eventType: "impression",
        variant: "dashboard",
        sourceTier: "free",
        lockedFeatureKeys: [123, "ok"],
      });
    expect(res.status).toBe(400);
  });

  it("rejects an empty sourceTier", async () => {
    const { cookie } = await seedMember();
    const res = await request(app)
      .post("/api/analytics/events")
      .set("Cookie", cookie)
      .send({
        eventType: "impression",
        variant: "dashboard",
        sourceTier: "",
        lockedFeatureKeys: [],
      });
    expect(res.status).toBe(400);
  });
});
