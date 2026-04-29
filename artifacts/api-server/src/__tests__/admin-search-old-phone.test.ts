import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import { db, usersTable, phoneChangeHistoryTable } from "@workspace/db";
import { inArray } from "drizzle-orm";

import { buildTestAppWithRouters } from "./test-app";
import adminPanelRouter from "../routes/admin-panel";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const TEST_TAG = `search-old-phone-${randomUUID().slice(0, 8)}`;
const seededUserIds: number[] = [];

let app: ReturnType<typeof buildTestAppWithRouters>;
let adminCookie: string;

async function seedUser(opts: { email: string; name: string; role?: string; phone?: string | null }): Promise<number> {
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
      phone: opts.phone ?? null,
    })
    .returning({ id: usersTable.id });
  seededUserIds.push(row.id);
  return row.id;
}

beforeAll(async () => {
  app = buildTestAppWithRouters([adminPanelRouter]);

  const adminEmail = `${TEST_TAG}-admin@example.test`;
  const adminId = await seedUser({ email: adminEmail, name: "Admin", role: "admin" });
  const token = jwt.sign({ userId: adminId, email: adminEmail }, JWT_SECRET, { expiresIn: "1h" });
  adminCookie = `access_token=${token}`;
});

afterAll(async () => {
  if (seededUserIds.length > 0) {
    await db.delete(usersTable).where(inArray(usersTable.id, seededUserIds));
  }
});

describe("GET /admin/search — search by previous phone", () => {
  it("returns a member when the query matches a previous phone and flags the match", async () => {
    const tag = `${TEST_TAG}-${randomUUID().slice(0, 6)}`;
    const currentPhone = `+1555000${tag.slice(-4)}`;
    const oldPhone = `+1555111${tag.slice(-4)}`;
    const userId = await seedUser({
      email: `${tag}-now@example.test`,
      name: "Renumbered Member",
      phone: currentPhone,
    });
    await db.insert(phoneChangeHistoryTable).values({
      userId,
      oldPhone,
      newPhone: currentPhone,
    });

    const res = await request(app)
      .get(`/api/admin/search?q=${encodeURIComponent(oldPhone)}`)
      .set("Cookie", adminCookie);

    expect(res.status).toBe(200);
    const member = res.body.members.find((m: any) => m.id === userId);
    expect(member).toBeDefined();
    expect(member.matchedPreviousPhone).toBe(oldPhone);
  });

  it("does not duplicate a member when the query matches both current and old phone", async () => {
    const sharedFragment = `9876${randomUUID().slice(0, 4).replace(/[a-f-]/gi, "0")}`;
    const currentPhone = `+1555${sharedFragment}AA`;
    const oldPhone = `+1555${sharedFragment}BB`;
    const userId = await seedUser({
      email: `${TEST_TAG}-dup-${randomUUID().slice(0, 6)}@example.test`,
      name: "Dup Match",
      phone: currentPhone,
    });
    await db.insert(phoneChangeHistoryTable).values({
      userId,
      oldPhone,
      newPhone: currentPhone,
    });

    const res = await request(app)
      .get(`/api/admin/search?q=${encodeURIComponent(sharedFragment)}`)
      .set("Cookie", adminCookie);

    expect(res.status).toBe(200);
    const matches = res.body.members.filter((m: any) => m.id === userId);
    expect(matches).toHaveLength(1);
    // The direct (current phone) match wins, so no `matchedPreviousPhone` flag.
    expect(matches[0].matchedPreviousPhone).toBeUndefined();
  });

  it("collapses multiple history rows for the same member into a single result", async () => {
    const tag = `historyphone-${randomUUID().slice(0, 6)}`;
    const currentPhone = `+1555000${tag.slice(-4)}`;
    const oldPhoneA = `+1555${tag.slice(-4)}AA`;
    const oldPhoneB = `+1555${tag.slice(-4)}BB`;
    const userId = await seedUser({
      email: `${TEST_TAG}-twice-${randomUUID().slice(0, 6)}@example.test`,
      name: "Twice Renumbered",
      phone: currentPhone,
    });
    await db.insert(phoneChangeHistoryTable).values([
      { userId, oldPhone: oldPhoneA, newPhone: oldPhoneB },
      { userId, oldPhone: oldPhoneB, newPhone: currentPhone },
    ]);

    const res = await request(app)
      .get(`/api/admin/search?q=${encodeURIComponent(tag.slice(-4))}`)
      .set("Cookie", adminCookie);

    expect(res.status).toBe(200);
    const matches = res.body.members.filter((m: any) => m.id === userId);
    expect(matches).toHaveLength(1);
  });

  it("still returns current-phone matches as before (no flag)", async () => {
    const currentPhone = `+15551234${randomUUID().slice(0, 4).replace(/[a-f-]/gi, "0")}`;
    const userId = await seedUser({
      email: `${TEST_TAG}-direct-${randomUUID().slice(0, 6)}@example.test`,
      name: "Direct Phone Match",
      phone: currentPhone,
    });

    const res = await request(app)
      .get(`/api/admin/search?q=${encodeURIComponent(currentPhone)}`)
      .set("Cookie", adminCookie);

    expect(res.status).toBe(200);
    const member = res.body.members.find((m: any) => m.id === userId);
    expect(member).toBeDefined();
    expect(member.matchedPreviousPhone).toBeUndefined();
  });
});
