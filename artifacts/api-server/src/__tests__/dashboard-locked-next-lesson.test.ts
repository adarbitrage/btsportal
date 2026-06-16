import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import {
  db,
  usersTable,
  productsTable,
  userProductsTable,
  tracksTable,
  modulesTable,
  lessonsTable,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

// Access-control regression guard for the dashboard's "next lesson" suggestion.
// The `/dashboard` handler picks the member's next lesson by walking the
// not-yet-completed lessons in order and returning the FIRST one whose
// `requiredEntitlement` the member actually owns (the `nextAccessible` find in
// routes/dashboard.ts). This is a real paywall boundary: if a future change
// drops the entitlement filter, the suggestion would surface a lesson the
// member never paid for. These tests pin the behavior for an entitled member
// (the locked lesson sorts FIRST yet must be skipped) and for a member with no
// entitlements at all (no lesson is accessible, so there is no suggestion).

vi.mock("../lib/redis", () => ({
  getRedis: () => null,
  isRedisConnected: async () => false,
  getRedisConnection: vi.fn(),
  createRedisConnection: vi.fn(),
}));

import { buildTestAppWithRouters } from "./test-app";
import dashboardRouter from "../routes/dashboard";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";

function signCookie(userId: number, email: string): string {
  const token = jwt.sign({ userId, email }, JWT_SECRET, { expiresIn: "1h" });
  return `access_token=${token}`;
}

async function insertUser(suffix: string): Promise<{ id: number; email: string }> {
  const email = `dash-lesson-${suffix}-${randomUUID().slice(0, 8)}@example.test`;
  const passwordHash = await bcrypt.hash("irrelevant-test-password", 4);
  const [row] = await db
    .insert(usersTable)
    .values({
      email,
      name: `Dash Lesson ${suffix}`,
      passwordHash,
      role: "member",
      emailVerified: true,
      onboardingComplete: true,
    })
    .returning({ id: usersTable.id });
  return { id: row.id, email };
}

describe("GET /dashboard next lesson entitlement filtering", () => {
  const PREFIX = `__dash_lesson_test__${randomUUID().slice(0, 8)}`;
  // Two distinct, test-only entitlement keys. The entitled member owns only
  // OWNED_ENT; nobody owns LOCKED_ENT. Using unique keys keeps the entitled
  // member from accidentally matching any seeded dev-DB lesson.
  const OWNED_ENT = `${PREFIX}:owned`;
  const LOCKED_ENT = `${PREFIX}:locked`;

  let app: ReturnType<typeof buildTestAppWithRouters>;

  let entitledUserId: number;
  let entitledCookie: string;
  let noAccessUserId: number;
  let noAccessCookie: string;

  let productId: number;
  const userProductIds: number[] = [];
  let trackId: number;
  let moduleId: number;
  let lockedLessonId: number;
  let accessibleLessonId: number;

  beforeAll(async () => {
    app = buildTestAppWithRouters([dashboardRouter]);

    const entitledUser = await insertUser("entitled");
    entitledUserId = entitledUser.id;
    entitledCookie = signCookie(entitledUser.id, entitledUser.email);

    // A member who owns no products at all → empty entitlement set.
    const noAccessUser = await insertUser("noaccess");
    noAccessUserId = noAccessUser.id;
    noAccessCookie = signCookie(noAccessUser.id, noAccessUser.email);

    // A product whose entitlement_keys grant only OWNED_ENT.
    const [product] = await db
      .insert(productsTable)
      .values({
        slug: `${PREFIX}-product`,
        name: "Dash Lesson Product",
        type: "frontend",
        entitlementKeys: [OWNED_ENT],
      })
      .returning({ id: productsTable.id });
    productId = product.id;

    // Only the entitled member owns it (active, no expiry).
    const [up] = await db
      .insert(userProductsTable)
      .values({
        userId: entitledUserId,
        productId,
        status: "active",
        expiresAt: null,
      })
      .returning({ id: userProductsTable.id });
    userProductIds.push(up.id);

    const [track] = await db
      .insert(tracksTable)
      .values({
        title: `${PREFIX}-track`,
        description: "Test track",
        requiredEntitlement: OWNED_ENT,
        status: "published",
      })
      .returning({ id: tracksTable.id });
    trackId = track.id;

    const [mod] = await db
      .insert(modulesTable)
      .values({
        trackId,
        title: `${PREFIX}-module`,
        description: "Test module",
        sortOrder: 0,
      })
      .returning({ id: modulesTable.id });
    moduleId = mod.id;

    // The locked lesson sorts FIRST (sortOrder 0) within the module, so a
    // broken filter that ignored entitlements would return it before the
    // accessible one. It must never be suggested.
    const [lockedLesson] = await db
      .insert(lessonsTable)
      .values({
        moduleId,
        title: `${PREFIX}-locked-lesson`,
        description: "Locked lesson the member never paid for",
        requiredEntitlement: LOCKED_ENT,
        sortOrder: 0,
        status: "published",
      })
      .returning({ id: lessonsTable.id });
    lockedLessonId = lockedLesson.id;

    const [accessibleLesson] = await db
      .insert(lessonsTable)
      .values({
        moduleId,
        title: `${PREFIX}-accessible-lesson`,
        description: "Lesson the member is entitled to",
        requiredEntitlement: OWNED_ENT,
        sortOrder: 1,
        status: "published",
      })
      .returning({ id: lessonsTable.id });
    accessibleLessonId = accessibleLesson.id;
  });

  afterAll(async () => {
    const lessonIds = [lockedLessonId, accessibleLessonId].filter(Boolean);
    if (lessonIds.length > 0) {
      await db.delete(lessonsTable).where(inArray(lessonsTable.id, lessonIds));
    }
    if (moduleId) {
      await db.delete(modulesTable).where(eq(modulesTable.id, moduleId));
    }
    if (trackId) {
      await db.delete(tracksTable).where(eq(tracksTable.id, trackId));
    }
    if (userProductIds.length > 0) {
      await db.delete(userProductsTable).where(inArray(userProductsTable.id, userProductIds));
    }
    if (productId) {
      await db.delete(productsTable).where(eq(productsTable.id, productId));
    }
    await db.delete(usersTable).where(inArray(usersTable.id, [entitledUserId, noAccessUserId]));
  });

  it("never suggests a lesson the member is not entitled to", async () => {
    const res = await request(app)
      .get("/api/dashboard")
      .set("Cookie", entitledCookie);

    expect(res.status).toBe(200);
    expect(res.body.nextLesson).toBeDefined();
    expect(res.body.nextLesson).not.toBeNull();
    // The suggestion must be the accessible lesson, never the locked one that
    // sorts ahead of it.
    expect(res.body.nextLesson.lessonId).toBe(accessibleLessonId);
    expect(res.body.nextLesson.lessonId).not.toBe(lockedLessonId);
  });

  it("returns no next lesson when the member is entitled to none", async () => {
    const res = await request(app)
      .get("/api/dashboard")
      .set("Cookie", noAccessCookie);

    expect(res.status).toBe(200);
    // A member with no entitlements can access no lessons, so there is nothing
    // to suggest. `nextLesson` is omitted from the JSON (serialized undefined).
    expect(res.body.nextLesson).toBeUndefined();
  });
});
