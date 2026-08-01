import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import { db, usersTable, memberAppInstancesTable } from "@workspace/db";
import { inArray } from "drizzle-orm";

import appsRouter from "../routes/apps";
import { buildTestAppWithRouters } from "./test-app";

const SECRET = "test-domain-check-secret";
const TEST_TAG = `domain-check-${randomUUID().slice(0, 8)}`;

const seededUserIds: number[] = [];
const seededInstanceIds: number[] = [];

let app: ReturnType<typeof buildTestAppWithRouters>;

async function seedUser(suffix: string): Promise<number> {
  const passwordHash = await bcrypt.hash("irrelevant-test-password", 4);
  const [row] = await db
    .insert(usersTable)
    .values({
      email: `${TEST_TAG}-${suffix}@example.test`,
      name: `Test ${suffix}`,
      passwordHash,
      role: "member",
      sourceProduct: "lifetime",
      emailVerified: true,
      onboardingComplete: true,
    })
    .returning({ id: usersTable.id });
  seededUserIds.push(row.id);
  return row.id;
}

async function seedInstance(userId: number, appName: string, status: string, domain: string): Promise<void> {
  const [row] = await db
    .insert(memberAppInstancesTable)
    .values({ userId, appName, status, domain })
    .returning({ id: memberAppInstancesTable.id });
  seededInstanceIds.push(row.id);
}

function domainFor(suffix: string): string {
  return `${TEST_TAG}-${suffix}.diytrax.example.test`;
}

beforeAll(async () => {
  app = buildTestAppWithRouters([appsRouter]);
});

afterAll(async () => {
  if (seededInstanceIds.length > 0) {
    await db.delete(memberAppInstancesTable).where(inArray(memberAppInstancesTable.id, seededInstanceIds));
  }
  if (seededUserIds.length > 0) {
    await db.delete(usersTable).where(inArray(usersTable.id, seededUserIds));
  }
});

beforeEach(() => {
  process.env.APP_DOMAIN_CHECK_SECRET = SECRET;
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  delete process.env.APP_DOMAIN_CHECK_SECRET;
  vi.restoreAllMocks();
});

describe("GET /api/apps/domain-check", () => {
  it("rejects a request with a missing bearer secret", async () => {
    const res = await request(app)
      .get("/api/apps/domain-check")
      .query({ domain: domainFor("no-auth") });
    expect(res.status).toBe(401);
  });

  it("rejects a request with the wrong bearer secret", async () => {
    const res = await request(app)
      .get("/api/apps/domain-check")
      .set("Authorization", "Bearer not-the-secret")
      .query({ domain: domainFor("wrong-auth") });
    expect(res.status).toBe(401);
  });

  it("fails closed when the shared secret is not configured", async () => {
    delete process.env.APP_DOMAIN_CHECK_SECRET;
    // Even an empty bearer must not match an unset (empty) configured secret.
    const empty = await request(app)
      .get("/api/apps/domain-check")
      .set("Authorization", "Bearer ")
      .query({ domain: domainFor("unset") });
    expect(empty.status).toBe(401);

    const noHeader = await request(app)
      .get("/api/apps/domain-check")
      .query({ domain: domainFor("unset") });
    expect(noHeader.status).toBe(401);
  });

  it("returns 400 for a missing or invalid domain once authenticated", async () => {
    const missing = await request(app)
      .get("/api/apps/domain-check")
      .set("Authorization", `Bearer ${SECRET}`)
      .query({});
    expect(missing.status).toBe(400);

    const blank = await request(app)
      .get("/api/apps/domain-check")
      .set("Authorization", `Bearer ${SECRET}`)
      .query({ domain: "   " });
    expect(blank.status).toBe(400);

    // A repeated ?domain=a&domain=b parses to an array, not a string → 400.
    const notAString = await request(app)
      .get("/api/apps/domain-check")
      .set("Authorization", `Bearer ${SECRET}`)
      .query("domain=a.example.test&domain=b.example.test");
    expect(notAString.status).toBe(400);
  });

  it("returns true for a known installed member instance domain", async () => {
    const userId = await seedUser("known");
    const domain = domainFor("known");
    await seedInstance(userId, "diytrax", "installed", domain);

    const res = await request(app)
      .get("/api/apps/domain-check")
      .set("Authorization", `Bearer ${SECRET}`)
      .query({ domain });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ belongs_to_member: true });
  });

  it("returns false for an unknown domain", async () => {
    const res = await request(app)
      .get("/api/apps/domain-check")
      .set("Authorization", `Bearer ${SECRET}`)
      .query({ domain: domainFor("unknown-never-seeded") });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ belongs_to_member: false });
  });

  it("does not treat inactive-status instances as belonging to a member", async () => {
    const userId = await seedUser("inactive");
    const failedDomain = domainFor("failed");
    const uninstallingDomain = domainFor("uninstalling");
    await seedInstance(userId, "pixelpress", "install_failed", failedDomain);
    await seedInstance(userId, "gifster", "uninstalling", uninstallingDomain);

    for (const domain of [failedDomain, uninstallingDomain]) {
      const res = await request(app)
        .get("/api/apps/domain-check")
        .set("Authorization", `Bearer ${SECRET}`)
        .query({ domain });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ belongs_to_member: false });
    }
  });

  it("treats an installing instance as belonging to a member", async () => {
    const userId = await seedUser("installing");
    const domain = domainFor("installing");
    await seedInstance(userId, "metricmover", "installing", domain);

    const res = await request(app)
      .get("/api/apps/domain-check")
      .set("Authorization", `Bearer ${SECRET}`)
      .query({ domain });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ belongs_to_member: true });
  });
});
