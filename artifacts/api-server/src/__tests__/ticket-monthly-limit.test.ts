import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import {
  db,
  usersTable,
  productsTable,
  userProductsTable,
  ticketsTable,
  ticketMessagesTable,
  ticketSlaTable,
} from "@workspace/db";
import { eq, inArray, sql } from "drizzle-orm";

vi.mock("../lib/ghl-queue", () => ({
  queueGHLSync: vi.fn(async () => "job_test_id"),
}));

vi.mock("../lib/webhook-events", () => ({
  emitWebhookEvent: vi.fn(async () => undefined),
}));

import { buildTestAppWithRouters } from "./test-app";
import ticketsRouter from "../routes/tickets";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const TEST_TAG = `ticket-cap-${randomUUID().slice(0, 8)}`;

let app: ReturnType<typeof buildTestAppWithRouters>;

interface TierFixture {
  userId: number;
  email: string;
  cookie: string;
}

const fixtures: Record<string, TierFixture> = {};
const seededUserIds: number[] = [];
const seededProductIds: number[] = [];

function signCookie(userId: number, email: string): string {
  const token = jwt.sign({ userId, email }, JWT_SECRET, { expiresIn: "1h" });
  return `access_token=${token}`;
}

async function makeUserOnTier(
  tier: "basic" | "standard" | "enhanced" | "unlimited",
  supportEntitlement: string,
): Promise<TierFixture> {
  const passwordHash = await bcrypt.hash("irrelevant", 4);
  const [user] = await db
    .insert(usersTable)
    .values({
      email: `${TEST_TAG}-${tier}@example.test`,
      name: `Tier ${tier} member`,
      passwordHash,
      role: "member",
      sourceProduct: "lifetime",
      emailVerified: true,
      onboardingComplete: true,
    })
    .returning({ id: usersTable.id, email: usersTable.email });
  seededUserIds.push(user.id);

  const [product] = await db
    .insert(productsTable)
    .values({
      slug: `${TEST_TAG}-product-${tier}`,
      name: `${tier} test product`,
      type: "backend",
      // Real JSONB array (not a JSON-encoded string scalar) so this test is
      // independent of the products.entitlement_keys storage-shape bug
      // tracked separately.
      entitlementKeys: [supportEntitlement] as unknown as string[],
      sortOrder: 99,
    })
    .returning({ id: productsTable.id });
  seededProductIds.push(product.id);

  await db.insert(userProductsTable).values({
    userId: user.id,
    productId: product.id,
    status: "active",
  });

  return { userId: user.id, email: user.email, cookie: signCookie(user.id, user.email) };
}

async function postTicket(cookie: string, suffix: string) {
  return request(app)
    .post("/api/tickets")
    .set("Cookie", cookie)
    .send({
      category: "technical",
      subject: `Test subject ${suffix}`,
      description: `Test description for ${suffix} that is long enough to pass validation`,
    });
}

async function deleteTicketsForUser(userId: number): Promise<void> {
  const ids = await db
    .select({ id: ticketsTable.id })
    .from(ticketsTable)
    .where(eq(ticketsTable.userId, userId));
  if (ids.length === 0) return;
  const ticketIds = ids.map((r) => r.id);
  await db.delete(ticketSlaTable).where(inArray(ticketSlaTable.ticketId, ticketIds));
  await db.delete(ticketMessagesTable).where(inArray(ticketMessagesTable.ticketId, ticketIds));
  await db.delete(ticketsTable).where(inArray(ticketsTable.id, ticketIds));
}

beforeAll(async () => {
  app = buildTestAppWithRouters([ticketsRouter]);

  fixtures.basic = await makeUserOnTier("basic", "support:basic");
  fixtures.standard = await makeUserOnTier("standard", "support:standard");
  fixtures.enhanced = await makeUserOnTier("enhanced", "support:enhanced");
  fixtures.unlimited = await makeUserOnTier("unlimited", "support:unlimited");
});

afterAll(async () => {
  for (const f of Object.values(fixtures)) {
    await deleteTicketsForUser(f.userId);
  }
  if (seededUserIds.length > 0) {
    await db.delete(userProductsTable).where(inArray(userProductsTable.userId, seededUserIds));
    await db.delete(usersTable).where(inArray(usersTable.id, seededUserIds));
  }
  if (seededProductIds.length > 0) {
    await db.delete(productsTable).where(inArray(productsTable.id, seededProductIds));
  }
});

describe("POST /api/tickets — monthly support ticket cap", () => {
  it("support:basic caps at 3 tickets per month and rejects the 4th with TICKET_LIMIT_REACHED", async () => {
    const f = fixtures.basic;
    await deleteTicketsForUser(f.userId);

    for (let i = 1; i <= 3; i++) {
      const res = await postTicket(f.cookie, `basic-${i}`);
      expect(res.status, `ticket ${i} should succeed`).toBe(201);
    }

    const overflow = await postTicket(f.cookie, "basic-overflow");
    expect(overflow.status).toBe(429);
    expect(overflow.body.error.code).toBe("TICKET_LIMIT_REACHED");
    expect(overflow.body.error.message).toContain("monthly limit of 3");
    expect(overflow.body.error.details).toMatchObject({ limit: 3, usedThisMonth: 3 });
  });

  it("support:standard caps at 5 tickets per month and rejects the 6th", async () => {
    const f = fixtures.standard;
    await deleteTicketsForUser(f.userId);

    for (let i = 1; i <= 5; i++) {
      const res = await postTicket(f.cookie, `standard-${i}`);
      expect(res.status, `ticket ${i} should succeed`).toBe(201);
    }

    const overflow = await postTicket(f.cookie, "standard-overflow");
    expect(overflow.status).toBe(429);
    expect(overflow.body.error.code).toBe("TICKET_LIMIT_REACHED");
    expect(overflow.body.error.details).toMatchObject({ limit: 5, usedThisMonth: 5 });
  });

  it("support:enhanced caps at 10 tickets per month and rejects the 11th", async () => {
    const f = fixtures.enhanced;
    await deleteTicketsForUser(f.userId);

    for (let i = 1; i <= 10; i++) {
      const res = await postTicket(f.cookie, `enhanced-${i}`);
      expect(res.status, `ticket ${i} should succeed`).toBe(201);
    }

    const overflow = await postTicket(f.cookie, "enhanced-overflow");
    expect(overflow.status).toBe(429);
    expect(overflow.body.error.code).toBe("TICKET_LIMIT_REACHED");
    expect(overflow.body.error.details).toMatchObject({ limit: 10, usedThisMonth: 10 });
  });

  it("support:unlimited never throttles, even past every other tier's cap", async () => {
    const f = fixtures.unlimited;
    await deleteTicketsForUser(f.userId);

    for (let i = 1; i <= 12; i++) {
      const res = await postTicket(f.cookie, `unlimited-${i}`);
      expect(res.status, `ticket ${i} should succeed`).toBe(201);
    }
  });

  it("serializes concurrent submissions so the cap can't be bypassed at the boundary", async () => {
    // basic = 3/month. Pre-load 2 tickets, then fire 3 parallel POSTs. Only
    // ONE should be accepted (taking the count from 2 to 3); the other two
    // must come back as 429 TICKET_LIMIT_REACHED. Without the per-user
    // advisory lock around count + insert, all three would race past the
    // count check and be inserted, busting the cap.
    const f = fixtures.basic;
    await deleteTicketsForUser(f.userId);

    for (let i = 1; i <= 2; i++) {
      const seed = await postTicket(f.cookie, `concurrency-seed-${i}`);
      expect(seed.status).toBe(201);
    }

    const results = await Promise.all([
      postTicket(f.cookie, "concurrent-a"),
      postTicket(f.cookie, "concurrent-b"),
      postTicket(f.cookie, "concurrent-c"),
    ]);

    const successes = results.filter((r) => r.status === 201);
    const rateLimited = results.filter((r) => r.status === 429);
    expect(successes).toHaveLength(1);
    expect(rateLimited).toHaveLength(2);
    for (const r of rateLimited) {
      expect(r.body.error.code).toBe("TICKET_LIMIT_REACHED");
    }

    const finalCount = await db
      .select({ value: sql<number>`count(*)::int` })
      .from(ticketsTable)
      .where(eq(ticketsTable.userId, f.userId));
    expect(finalCount[0].value).toBe(3);
  });

  it("only counts tickets created in the current calendar month (UTC)", async () => {
    // basic = 3/month. Backdate 5 tickets to last month, then confirm the
    // member can still open 3 fresh tickets this month.
    const f = fixtures.basic;
    await deleteTicketsForUser(f.userId);

    const now = new Date();
    // First day of *previous* month at noon UTC, far enough from any
    // boundary that DST or rounding can't move it back into "this month".
    const lastMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1, 12));

    for (let i = 1; i <= 5; i++) {
      await db.insert(ticketsTable).values({
        ticketNumber: `BTS-${TEST_TAG}-prev-${i}`,
        userId: f.userId,
        category: "technical",
        priority: "normal",
        status: "open",
        subject: `Prev month ticket ${i}`,
        createdAt: lastMonth,
        updatedAt: lastMonth,
      });
    }

    for (let i = 1; i <= 3; i++) {
      const res = await postTicket(f.cookie, `boundary-${i}`);
      expect(res.status, `boundary ticket ${i} should succeed`).toBe(201);
    }

    const overflow = await postTicket(f.cookie, "boundary-overflow");
    expect(overflow.status).toBe(429);
    expect(overflow.body.error.code).toBe("TICKET_LIMIT_REACHED");
    expect(overflow.body.error.details).toMatchObject({ limit: 3, usedThisMonth: 3 });
  });
});
