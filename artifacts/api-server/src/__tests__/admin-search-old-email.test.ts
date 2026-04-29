import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import { db, usersTable, emailChangeHistoryTable } from "@workspace/db";
import { inArray } from "drizzle-orm";

import { buildTestAppWithRouters } from "./test-app";
import adminPanelRouter from "../routes/admin-panel";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const TEST_TAG = `search-old-email-${randomUUID().slice(0, 8)}`;
const seededUserIds: number[] = [];

let app: ReturnType<typeof buildTestAppWithRouters>;
let adminCookie: string;

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

describe("GET /admin/search — search by previous email", () => {
  it("returns a member when the query matches a previous email and flags the match", async () => {
    const currentEmail = `${TEST_TAG}-now@example.test`;
    const oldEmail = `${TEST_TAG}-was-${randomUUID().slice(0, 6)}@old.example.test`;
    const userId = await seedUser({ email: currentEmail, name: "Renamed Member" });
    await db.insert(emailChangeHistoryTable).values({
      userId,
      oldEmail,
      newEmail: currentEmail,
    });

    const res = await request(app)
      .get(`/api/admin/search?q=${encodeURIComponent(oldEmail)}`)
      .set("Cookie", adminCookie);

    expect(res.status).toBe(200);
    const member = res.body.members.find((m: any) => m.id === userId);
    expect(member).toBeDefined();
    expect(member.email).toBe(currentEmail);
    expect(member.matchedPreviousEmail).toBe(oldEmail);
  });

  it("does not duplicate a member when the query matches both current and old email", async () => {
    const sharedToken = `${TEST_TAG}-shared-${randomUUID().slice(0, 6)}`;
    const currentEmail = `${sharedToken}-current@example.test`;
    const oldEmail = `${sharedToken}-old@example.test`;
    const userId = await seedUser({ email: currentEmail, name: "Dup Match" });
    await db.insert(emailChangeHistoryTable).values({
      userId,
      oldEmail,
      newEmail: currentEmail,
    });

    const res = await request(app)
      .get(`/api/admin/search?q=${encodeURIComponent(sharedToken)}`)
      .set("Cookie", adminCookie);

    expect(res.status).toBe(200);
    const matches = res.body.members.filter((m: any) => m.id === userId);
    expect(matches).toHaveLength(1);
    // The direct (current) email match wins, so no `matchedPreviousEmail` flag.
    expect(matches[0].matchedPreviousEmail).toBeUndefined();
  });

  it("collapses multiple history rows for the same member into a single result", async () => {
    const currentEmail = `${TEST_TAG}-twice@example.test`;
    const oldEmailA = `${TEST_TAG}-history-a-${randomUUID().slice(0, 6)}@old.example.test`;
    const oldEmailB = `${TEST_TAG}-history-b-${randomUUID().slice(0, 6)}@old.example.test`;
    const userId = await seedUser({ email: currentEmail, name: "Twice Renamed" });
    await db.insert(emailChangeHistoryTable).values([
      { userId, oldEmail: oldEmailA, newEmail: oldEmailB },
      { userId, oldEmail: oldEmailB, newEmail: currentEmail },
    ]);

    const res = await request(app)
      .get(`/api/admin/search?q=${encodeURIComponent("history-")}`)
      .set("Cookie", adminCookie);

    expect(res.status).toBe(200);
    const matches = res.body.members.filter((m: any) => m.id === userId);
    expect(matches).toHaveLength(1);
    expect(matches[0].matchedPreviousEmail).toBeDefined();
  });

  it("still returns current-email matches as before (no flag)", async () => {
    const currentEmail = `${TEST_TAG}-direct-${randomUUID().slice(0, 6)}@example.test`;
    const userId = await seedUser({ email: currentEmail, name: "Direct Match" });

    const res = await request(app)
      .get(`/api/admin/search?q=${encodeURIComponent(currentEmail)}`)
      .set("Cookie", adminCookie);

    expect(res.status).toBe(200);
    const member = res.body.members.find((m: any) => m.id === userId);
    expect(member).toBeDefined();
    expect(member.matchedPreviousEmail).toBeUndefined();
  });
});
