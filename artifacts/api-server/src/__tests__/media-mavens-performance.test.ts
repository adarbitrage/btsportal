import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import { db, usersTable } from "@workspace/db";
import { inArray } from "drizzle-orm";

// The route resolves the caller's Tapfiliate affiliate id and then fans out to
// the Tapfiliate REST API. Both are external concerns we don't want to hit in a
// unit/integration test, so we mock them. Crucially, we preserve the REAL error
// classes from `../lib/tapfiliate` — the route's `instanceof` checks are what
// drive the 503/502 branches, so a fake class would silently fall through to the
// generic 500 and the test would assert against the wrong contract.
const getAffiliateConversions = vi.fn();
const getAffiliatePayouts = vi.fn();

vi.mock("../lib/tapfiliate", async (importActual) => {
  const actual = await importActual<typeof import("../lib/tapfiliate")>();
  return {
    ...actual,
    getAffiliateConversions: (...args: unknown[]) => getAffiliateConversions(...args),
    getAffiliatePayouts: (...args: unknown[]) => getAffiliatePayouts(...args),
  };
});

const resolveAffiliateId = vi.fn();
vi.mock("../lib/tapfiliate-affiliate", () => ({
  resolveAffiliateId: (...args: unknown[]) => resolveAffiliateId(...args),
}));

import { buildTestAppWithRouters } from "./test-app";
import mediaMavensPerformanceRouter from "../routes/media-mavens-performance";
import { TapfiliateConfigError, TapfiliateApiError } from "../lib/tapfiliate";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const TEST_TAG = `mm-performance-${randomUUID().slice(0, 8)}`;
const seededUserIds: number[] = [];

let app: ReturnType<typeof buildTestAppWithRouters>;
let memberCookie: string;

async function seedUser(): Promise<number> {
  const passwordHash = await bcrypt.hash("irrelevant", 4);
  const [row] = await db
    .insert(usersTable)
    .values({
      email: `${TEST_TAG}-${randomUUID().slice(0, 6)}@example.test`,
      name: "Media Maven",
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

beforeAll(async () => {
  app = buildTestAppWithRouters([mediaMavensPerformanceRouter]);

  const memberId = await seedUser();
  const token = jwt.sign({ userId: memberId, email: "member@example.test" }, JWT_SECRET, {
    expiresIn: "1h",
  });
  memberCookie = `access_token=${token}`;

  // The route only needs *some* resolved affiliate id; the value is opaque to
  // the assertions below.
  resolveAffiliateId.mockResolvedValue("aff_123");
});

afterAll(async () => {
  if (seededUserIds.length > 0) {
    await db.delete(usersTable).where(inArray(usersTable.id, seededUserIds));
  }
});

beforeEach(() => {
  getAffiliateConversions.mockReset();
  getAffiliatePayouts.mockReset();
});

describe("GET /affiliate/performance — auth & validation", () => {
  it("rejects unauthenticated callers with 401", async () => {
    const res = await request(app).get("/api/affiliate/performance?dataset=conversions");
    expect(res.status).toBe(401);
    // External data must never be fetched for an anonymous caller.
    expect(getAffiliateConversions).not.toHaveBeenCalled();
    expect(getAffiliatePayouts).not.toHaveBeenCalled();
  });

  it("returns 400 when dataset is missing or invalid", async () => {
    const res = await request(app)
      .get("/api/affiliate/performance?dataset=bananas")
      .set("Cookie", memberCookie);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/dataset must be/i);
  });
});

describe("GET /affiliate/performance — Tapfiliate error handling", () => {
  it("maps TapfiliateConfigError to a 503 with a user-facing message", async () => {
    getAffiliateConversions.mockRejectedValue(new TapfiliateConfigError());

    const res = await request(app)
      .get("/api/affiliate/performance?dataset=conversions")
      .set("Cookie", memberCookie);

    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/not configured/i);
  });

  it("maps TapfiliateApiError to a 502 with a user-facing message", async () => {
    getAffiliatePayouts.mockRejectedValue(new TapfiliateApiError(500, "upstream boom"));

    const res = await request(app)
      .get("/api/affiliate/performance?dataset=payouts")
      .set("Cookie", memberCookie);

    expect(res.status).toBe(502);
    expect(res.body.error).toMatch(/returned an error/i);
  });

  it("maps an unexpected error to a generic 500", async () => {
    getAffiliateConversions.mockRejectedValue(new Error("kaboom"));

    const res = await request(app)
      .get("/api/affiliate/performance?dataset=conversions")
      .set("Cookie", memberCookie);

    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/failed to fetch/i);
  });
});

describe("GET /affiliate/performance — paginated response shape", () => {
  it("returns the conversions page and echoes the resolved page number", async () => {
    getAffiliateConversions.mockResolvedValue({
      items: [
        {
          id: "c1",
          created_at: "2026-06-01T00:00:00Z",
          amount: "100.00",
          commission: { amount: "20.00" },
          status: "approved",
          program: { id: "p1", title: "Heat Haven" },
        },
      ],
      hasNextPage: true,
    });

    const res = await request(app)
      .get("/api/affiliate/performance?dataset=conversions&page=3")
      .set("Cookie", memberCookie);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      items: [
        {
          id: "c1",
          created_at: "2026-06-01T00:00:00Z",
          amount: "100.00",
          commission: { amount: "20.00" },
          status: "approved",
          program: { id: "p1", title: "Heat Haven" },
        },
      ],
      hasNextPage: true,
      page: 3,
    });
    // The resolved affiliate id and requested page are forwarded to the lib.
    expect(getAffiliateConversions).toHaveBeenCalledWith("aff_123", 3);
  });

  it("returns the payouts page", async () => {
    getAffiliatePayouts.mockResolvedValue({
      items: [
        {
          id: "po1",
          created_at: "2026-06-02T00:00:00Z",
          amount: "50.00",
          payment_method: "paypal",
          status: "paid",
        },
      ],
      hasNextPage: false,
    });

    const res = await request(app)
      .get("/api/affiliate/performance?dataset=payouts&page=1")
      .set("Cookie", memberCookie);

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.hasNextPage).toBe(false);
    expect(res.body.page).toBe(1);
    expect(getAffiliatePayouts).toHaveBeenCalledWith("aff_123", 1);
  });

  it("clamps a missing or invalid page to 1", async () => {
    getAffiliateConversions.mockResolvedValue({ items: [], hasNextPage: false });

    const res = await request(app)
      .get("/api/affiliate/performance?dataset=conversions&page=notanumber")
      .set("Cookie", memberCookie);

    expect(res.status).toBe(200);
    expect(res.body.page).toBe(1);
    expect(getAffiliateConversions).toHaveBeenCalledWith("aff_123", 1);
  });
});
