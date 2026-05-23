import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import { db, usersTable, affiliateNetworksTable } from "@workspace/db";
import { inArray } from "drizzle-orm";

import { buildTestAppWithRouters } from "./test-app";
import adminAffiliateNetworksRouter from "../routes/admin-affiliate-networks";
import { seedAffiliateNetworks } from "../lib/seed-affiliate-networks";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const TEST_TAG = `aff-net-${randomUUID().slice(0, 8)}`;
const SEEDED_SLUGS = ["media-mavens", "clickbank", "affiliati", "maxweb"];
const seededUserIds: number[] = [];
const createdNetworkSlugs: string[] = [];

let app: ReturnType<typeof buildTestAppWithRouters>;
let adminCookie: string;
let memberCookie: string;

async function seedUser(opts: { email: string; name: string; role?: string }): Promise<number> {
  const passwordHash = await bcrypt.hash("irrelevant", 4);
  const [row] = await db
    .insert(usersTable)
    .values({
      email: opts.email,
      name: opts.name,
      passwordHash,
      role: opts.role ?? "member",
      sourceProduct: "lifetime",
      emailVerified: true,
      onboardingComplete: true,
    })
    .returning({ id: usersTable.id });
  seededUserIds.push(row.id);
  return row.id;
}

beforeAll(async () => {
  app = buildTestAppWithRouters([adminAffiliateNetworksRouter]);

  await seedAffiliateNetworks();

  const adminEmail = `${TEST_TAG}-admin@example.test`;
  const adminId = await seedUser({ email: adminEmail, name: "Admin", role: "admin" });
  const adminToken = jwt.sign({ userId: adminId, email: adminEmail }, JWT_SECRET, { expiresIn: "1h" });
  adminCookie = `access_token=${adminToken}`;

  const memberEmail = `${TEST_TAG}-member@example.test`;
  const memberId = await seedUser({ email: memberEmail, name: "Member", role: "member" });
  const memberToken = jwt.sign({ userId: memberId, email: memberEmail }, JWT_SECRET, { expiresIn: "1h" });
  memberCookie = `access_token=${memberToken}`;
});

afterAll(async () => {
  if (createdNetworkSlugs.length > 0) {
    await db.delete(affiliateNetworksTable).where(inArray(affiliateNetworksTable.slug, createdNetworkSlugs));
  }
  if (seededUserIds.length > 0) {
    await db.delete(usersTable).where(inArray(usersTable.id, seededUserIds));
  }
});

describe("GET /affiliate-networks — public list", () => {
  it("returns the four seeded networks in display order", async () => {
    const res = await request(app).get("/api/affiliate-networks");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);

    const seededReturned = (res.body as Array<{ slug: string; displayOrder: number; isActive: boolean }>)
      .filter((n) => SEEDED_SLUGS.includes(n.slug));

    expect(seededReturned).toHaveLength(4);
    expect(seededReturned.every((n) => n.isActive)).toBe(true);

    const seededOrder = seededReturned.map((n) => n.slug);
    expect(seededOrder).toEqual(["media-mavens", "clickbank", "affiliati", "maxweb"]);

    const orders = seededReturned.map((n) => n.displayOrder);
    for (let i = 1; i < orders.length; i++) {
      expect(orders[i]).toBeGreaterThanOrEqual(orders[i - 1]);
    }
  });
});

describe("Admin affiliate networks endpoints — auth protection", () => {
  it("POST /admin/affiliate-networks returns 401 without auth", async () => {
    const res = await request(app)
      .post("/api/admin/affiliate-networks")
      .send({ slug: "should-not-create", name: "Nope" });
    expect(res.status).toBe(401);
  });

  it("POST /admin/affiliate-networks returns 403 for a non-admin member", async () => {
    const res = await request(app)
      .post("/api/admin/affiliate-networks")
      .set("Cookie", memberCookie)
      .send({ slug: "should-not-create", name: "Nope" });
    expect(res.status).toBe(403);
  });

  it("PUT /admin/affiliate-networks/:id returns 401 without auth", async () => {
    const res = await request(app)
      .put("/api/admin/affiliate-networks/1")
      .send({ name: "Renamed" });
    expect(res.status).toBe(401);
  });

  it("PUT /admin/affiliate-networks/:id returns 403 for a non-admin member", async () => {
    const res = await request(app)
      .put("/api/admin/affiliate-networks/1")
      .set("Cookie", memberCookie)
      .send({ name: "Renamed" });
    expect(res.status).toBe(403);
  });

  it("DELETE /admin/affiliate-networks/:id returns 401 without auth", async () => {
    const res = await request(app).delete("/api/admin/affiliate-networks/1");
    expect(res.status).toBe(401);
  });

  it("DELETE /admin/affiliate-networks/:id returns 403 for a non-admin member", async () => {
    const res = await request(app)
      .delete("/api/admin/affiliate-networks/1")
      .set("Cookie", memberCookie);
    expect(res.status).toBe(403);
  });

  it("GET /admin/affiliate-networks returns 401 without auth and 403 for a member", async () => {
    const unauth = await request(app).get("/api/admin/affiliate-networks");
    expect(unauth.status).toBe(401);

    const forbidden = await request(app)
      .get("/api/admin/affiliate-networks")
      .set("Cookie", memberCookie);
    expect(forbidden.status).toBe(403);
  });

  it("allows an admin to perform full CRUD", async () => {
    const slug = `${TEST_TAG}-crud`;
    createdNetworkSlugs.push(slug);

    const created = await request(app)
      .post("/api/admin/affiliate-networks")
      .set("Cookie", adminCookie)
      .send({ slug, name: "CRUD Net", displayOrder: 99, isActive: false });
    expect(created.status).toBe(201);
    expect(created.body.slug).toBe(slug);
    const id = created.body.id as number;

    const updated = await request(app)
      .put(`/api/admin/affiliate-networks/${id}`)
      .set("Cookie", adminCookie)
      .send({ name: "CRUD Net Renamed" });
    expect(updated.status).toBe(200);
    expect(updated.body.name).toBe("CRUD Net Renamed");

    const deleted = await request(app)
      .delete(`/api/admin/affiliate-networks/${id}`)
      .set("Cookie", adminCookie);
    expect(deleted.status).toBe(200);
    expect(deleted.body.success).toBe(true);
  });
});
