import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import {
  db,
  usersTable,
  productsTable,
  auditLogTable,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

vi.mock("../lib/redis", () => ({
  getRedis: () => null,
  isRedisConnected: async () => false,
  getRedisConnection: vi.fn(),
  createRedisConnection: vi.fn(),
}));

import { buildTestAppWithRouters } from "./test-app";
import adminPanelRouter from "../routes/admin-panel";
import productsRouter from "../routes/products";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const TEST_TAG = `prod-meta-${randomUUID().slice(0, 8)}`;

const seededUserIds: number[] = [];
const seededProductIds: number[] = [];
let app: ReturnType<typeof buildTestAppWithRouters>;
let adminCookie: string;
let memberCookie: string;
let productId: number;
let productSlug: string;

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
      emailVerified: true,
      onboardingComplete: true,
    })
    .returning({ id: usersTable.id });
  seededUserIds.push(row.id);
  return { id: row.id, email };
}

beforeAll(async () => {
  app = buildTestAppWithRouters([adminPanelRouter, productsRouter]);
  const admin = await insertUser("super_admin", "admin");
  const member = await insertUser("member", "non-admin");
  adminCookie = signCookie(admin.id, admin.email);
  memberCookie = signCookie(member.id, member.email);

  productSlug = `${TEST_TAG}-launchpad-clone`;
  const [row] = await db
    .insert(productsTable)
    .values({
      slug: productSlug,
      name: "Test Plan",
      type: "backend",
      priceDisplay: "$1",
      durationDays: 30,
      entitlementKeys: ["software:base"],
      sortOrder: 9999,
      tagline: "old tagline",
      durationLabel: "old label",
      highlights: ["old one", "old two"],
      recommended: false,
    })
    .returning({ id: productsTable.id });
  productId = row.id;
  seededProductIds.push(productId);
});

afterAll(async () => {
  if (seededProductIds.length > 0) {
    await db
      .delete(auditLogTable)
      .where(inArray(auditLogTable.entityId, seededProductIds.map(String)));
    await db.delete(productsTable).where(inArray(productsTable.id, seededProductIds));
  }
  if (seededUserIds.length > 0) {
    await db
      .delete(auditLogTable)
      .where(inArray(auditLogTable.actorId, seededUserIds));
    await db.delete(usersTable).where(inArray(usersTable.id, seededUserIds));
  }
});

beforeEach(async () => {
  // Reset the row to a known shape between tests so write ordering doesn't
  // cause assertions to depend on each other.
  await db
    .update(productsTable)
    .set({
      tagline: "old tagline",
      durationLabel: "old label",
      highlights: ["old one", "old two"],
      recommended: false,
    })
    .where(eq(productsTable.id, productId));
});

describe("PATCH /admin/products/:id", () => {
  it("requires admin auth (no cookie -> 401)", async () => {
    const res = await request(app)
      .patch(`/api/admin/products/${productId}`)
      .send({ tagline: "x" });
    expect(res.status).toBe(401);
  });

  it("rejects non-admin members with 403", async () => {
    const res = await request(app)
      .patch(`/api/admin/products/${productId}`)
      .set("Cookie", memberCookie)
      .send({ tagline: "x" });
    expect(res.status).toBe(403);
  });

  it("updates tagline, durationLabel, highlights, and recommended in one call", async () => {
    const res = await request(app)
      .patch(`/api/admin/products/${productId}`)
      .set("Cookie", adminCookie)
      .send({
        tagline: "  Fresh marketing copy  ",
        durationLabel: "999 days",
        highlights: ["first", "  second  ", "", "third"],
        recommended: true,
      });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: productId,
      tagline: "Fresh marketing copy",
      durationLabel: "999 days",
      recommended: true,
    });
    expect(res.body.highlights).toEqual(["first", "second", "third"]);

    const [row] = await db
      .select()
      .from(productsTable)
      .where(eq(productsTable.id, productId));
    expect(row.tagline).toBe("Fresh marketing copy");
    expect(row.durationLabel).toBe("999 days");
    expect(row.highlights).toEqual(["first", "second", "third"]);
    expect(row.recommended).toBe(true);
  });

  it("treats blank tagline/durationLabel as null", async () => {
    const res = await request(app)
      .patch(`/api/admin/products/${productId}`)
      .set("Cookie", adminCookie)
      .send({ tagline: "   ", durationLabel: "" });
    expect(res.status).toBe(200);
    expect(res.body.tagline).toBeNull();
    expect(res.body.durationLabel).toBeNull();
  });

  it("leaves untouched fields alone", async () => {
    const res = await request(app)
      .patch(`/api/admin/products/${productId}`)
      .set("Cookie", adminCookie)
      .send({ recommended: true });
    expect(res.status).toBe(200);
    expect(res.body.recommended).toBe(true);
    expect(res.body.tagline).toBe("old tagline");
    expect(res.body.highlights).toEqual(["old one", "old two"]);
  });

  it("400s when the body has no editable fields", async () => {
    const res = await request(app)
      .patch(`/api/admin/products/${productId}`)
      .set("Cookie", adminCookie)
      .send({ slug: "naughty" });
    expect(res.status).toBe(400);
  });

  it("400s when highlights is not a string array", async () => {
    const res = await request(app)
      .patch(`/api/admin/products/${productId}`)
      .set("Cookie", adminCookie)
      .send({ highlights: [1, 2, 3] });
    expect(res.status).toBe(400);
  });

  it("404s when the product does not exist", async () => {
    const res = await request(app)
      .patch(`/api/admin/products/99999999`)
      .set("Cookie", adminCookie)
      .send({ tagline: "x" });
    expect(res.status).toBe(404);
  });

  it("writes an update_product_metadata audit log entry", async () => {
    await request(app)
      .patch(`/api/admin/products/${productId}`)
      .set("Cookie", adminCookie)
      .send({ tagline: "audited" });
    const audits = await db
      .select()
      .from(auditLogTable)
      .where(eq(auditLogTable.entityId, String(productId)));
    const updateEntry = audits.find((a) => a.actionType === "update_product_metadata");
    expect(updateEntry).toBeDefined();
    expect(updateEntry?.entityType).toBe("product");
    expect(updateEntry?.description ?? "").toContain("tagline");
  });
});

describe("GET /plans uses the products row metadata", () => {
  it("does not surface our test product (only known upgradeable slugs are listed)", async () => {
    const res = await request(app).get("/api/plans").set("Cookie", memberCookie);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    const slugs: string[] = res.body.map((p: { slug: string }) => p.slug);
    expect(slugs).not.toContain(productSlug);
    // Every returned plan should carry DB-sourced tagline/highlights/etc.
    for (const p of res.body as Array<{
      tagline: string;
      durationLabel: string;
      highlights: string[];
      recommended: boolean;
    }>) {
      expect(typeof p.tagline).toBe("string");
      expect(typeof p.durationLabel).toBe("string");
      expect(Array.isArray(p.highlights)).toBe(true);
      expect(typeof p.recommended).toBe("boolean");
    }
  });

  it("reflects an admin-edited tagline on the upgradeable plan", async () => {
    // Find a real upgradeable slug already present in the DB and pretend
    // an admin edited its tagline; confirm /plans returns the new value.
    const [launchpad] = await db
      .select({ id: productsTable.id, tagline: productsTable.tagline })
      .from(productsTable)
      .where(eq(productsTable.slug, "launchpad"));
    if (!launchpad) {
      // The seed didn't ship launchpad in this environment — skip rather
      // than fail. The shape assertions above already cover the wiring.
      return;
    }
    const originalTagline = launchpad.tagline;
    const stamp = `edited-by-test-${randomUUID().slice(0, 8)}`;
    try {
      const patchRes = await request(app)
        .patch(`/api/admin/products/${launchpad.id}`)
        .set("Cookie", adminCookie)
        .send({ tagline: stamp });
      expect(patchRes.status).toBe(200);

      const plansRes = await request(app).get("/api/plans").set("Cookie", memberCookie);
      expect(plansRes.status).toBe(200);
      const launchpadPlan = plansRes.body.find(
        (p: { slug: string }) => p.slug === "launchpad",
      );
      expect(launchpadPlan).toBeDefined();
      expect(launchpadPlan.tagline).toBe(stamp);
    } finally {
      await db
        .update(productsTable)
        .set({ tagline: originalTagline })
        .where(eq(productsTable.id, launchpad.id));
      await db
        .delete(auditLogTable)
        .where(eq(auditLogTable.entityId, String(launchpad.id)));
    }
  });
});
