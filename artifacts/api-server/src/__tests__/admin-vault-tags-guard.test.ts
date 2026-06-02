import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import { db, usersTable, vaultResourcesTable } from "@workspace/db";
import { eq, inArray, like } from "drizzle-orm";

vi.mock("../lib/redis", () => ({
  getRedis: () => null,
  isRedisConnected: async () => false,
  getRedisConnection: vi.fn(),
  createRedisConnection: vi.fn(),
}));

import { buildTestAppWithRouters } from "./test-app";
import adminVaultRouter from "../routes/admin-vault";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const TEST_TAG = `vault-tags-guard-${randomUUID().slice(0, 8)}`;

const seededUserIds: number[] = [];
let app: ReturnType<typeof buildTestAppWithRouters>;
let adminCookie: string;

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
  app = buildTestAppWithRouters([adminVaultRouter]);
  const admin = await insertUser("super_admin", "admin");
  adminCookie = signCookie(admin.id, admin.email);
});

afterAll(async () => {
  await db.delete(vaultResourcesTable).where(like(vaultResourcesTable.title, `${TEST_TAG}%`));
  if (seededUserIds.length > 0) {
    await db.delete(usersTable).where(inArray(usersTable.id, seededUserIds));
  }
});

describe("vault_resources.tags write guard (admin-vault)", () => {
  it("POST rejects a non-array tags value with 400 (no row written)", async () => {
    const title = `${TEST_TAG}-post-string`;
    const res = await request(app)
      .post("/api/admin/vault/resources")
      .set("Cookie", adminCookie)
      .send({ title, tags: "facebook" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/tags must be an array/i);

    const rows = await db
      .select({ id: vaultResourcesTable.id })
      .from(vaultResourcesTable)
      .where(eq(vaultResourcesTable.title, title));
    expect(rows.length).toBe(0);
  });

  it("POST rejects an array containing a non-string element", async () => {
    const title = `${TEST_TAG}-post-mixed`;
    const res = await request(app)
      .post("/api/admin/vault/resources")
      .set("Cookie", adminCookie)
      .send({ title, tags: ["ok", 42] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/tags must be an array/i);
  });

  it("POST stores a real array of strings", async () => {
    const title = `${TEST_TAG}-post-ok`;
    const res = await request(app)
      .post("/api/admin/vault/resources")
      .set("Cookie", adminCookie)
      .send({ title, tags: ["facebook", "ads"] });
    expect(res.status).toBe(201);
    expect(res.body.tags).toEqual(["facebook", "ads"]);
  });

  it("POST defaults missing tags to an empty array", async () => {
    const title = `${TEST_TAG}-post-default`;
    const res = await request(app)
      .post("/api/admin/vault/resources")
      .set("Cookie", adminCookie)
      .send({ title });
    expect(res.status).toBe(201);
    expect(res.body.tags).toEqual([]);
  });

  it("PATCH rejects turning tags into a non-array value, leaving the row untouched", async () => {
    const title = `${TEST_TAG}-patch`;
    const created = await request(app)
      .post("/api/admin/vault/resources")
      .set("Cookie", adminCookie)
      .send({ title, tags: ["original"] });
    expect(created.status).toBe(201);
    const id = created.body.id as number;

    const res = await request(app)
      .patch(`/api/admin/vault/resources/${id}`)
      .set("Cookie", adminCookie)
      .send({ tags: "not-an-array" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/tags must be an array/i);

    const [row] = await db
      .select({ tags: vaultResourcesTable.tags })
      .from(vaultResourcesTable)
      .where(eq(vaultResourcesTable.id, id));
    expect(row?.tags).toEqual(["original"]);
  });

  it("PATCH updates tags to a new array of strings", async () => {
    const title = `${TEST_TAG}-patch-ok`;
    const created = await request(app)
      .post("/api/admin/vault/resources")
      .set("Cookie", adminCookie)
      .send({ title, tags: ["a"] });
    const id = created.body.id as number;

    const res = await request(app)
      .patch(`/api/admin/vault/resources/${id}`)
      .set("Cookie", adminCookie)
      .send({ tags: ["b", "c"] });
    expect(res.status).toBe(200);
    expect(res.body.tags).toEqual(["b", "c"]);
  });
});
