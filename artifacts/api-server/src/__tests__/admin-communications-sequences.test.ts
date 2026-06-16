import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import {
  db,
  usersTable,
  sequencesTable,
  sequenceStepsTable,
} from "@workspace/db";
import { eq, inArray, like } from "drizzle-orm";

vi.mock("../lib/redis", () => ({
  getRedis: () => null,
  getRedisConnection: vi.fn(),
  createRedisConnection: vi.fn(),
  isRedisConnected: async () => false,
}));

import { buildTestAppWithRouters } from "./test-app";
import adminCommunicationsRouter from "../routes/admin-communications";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const TEST_TAG = `seq-${randomUUID().slice(0, 8)}`;
// Human-readable sequence name; the create endpoint derives a unique slug
// from it. We assert the derived slug below.
const SEQUENCE_NAME = `${TEST_TAG} Welcome Series`;
const EXPECTED_SLUG_PREFIX = `${TEST_TAG.toLowerCase()}-welcome-series`;

const seededUserIds: number[] = [];
const createdSequenceIds: number[] = [];
let app: ReturnType<typeof buildTestAppWithRouters>;
let adminCookie: string;
let memberCookie: string;

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
      sourceProduct: "lifetime",
      emailVerified: true,
      onboardingComplete: true,
    })
    .returning({ id: usersTable.id });
  seededUserIds.push(row.id);
  return { id: row.id, email };
}

beforeAll(async () => {
  app = buildTestAppWithRouters([adminCommunicationsRouter]);

  const admin = await insertUser("super_admin", "admin");
  const member = await insertUser("member", "non-admin");
  adminCookie = signCookie(admin.id, admin.email);
  memberCookie = signCookie(member.id, member.email);
});

afterAll(async () => {
  // Steps cascade on sequence delete, but clean both explicitly in case a
  // partial run left a sequence without its steps deleted.
  if (createdSequenceIds.length > 0) {
    await db.delete(sequenceStepsTable).where(inArray(sequenceStepsTable.sequenceId, createdSequenceIds));
    await db.delete(sequencesTable).where(inArray(sequencesTable.id, createdSequenceIds));
  }
  // Belt-and-braces: remove any sequence whose slug carries our test tag, so a
  // crashed earlier run doesn't leak rows.
  await db.delete(sequencesTable).where(like(sequencesTable.slug, `${TEST_TAG.toLowerCase()}%`));

  if (seededUserIds.length > 0) {
    await db.delete(usersTable).where(inArray(usersTable.id, seededUserIds));
  }
});

describe("Admin communications sequences", () => {
  it("creates a sequence with an auto-generated unique slug and derived status", async () => {
    const res = await request(app)
      .post("/api/admin/communications/sequences")
      .set("Cookie", adminCookie)
      .send({ name: SEQUENCE_NAME, description: "A test welcome series", triggerEvent: "signup" });

    expect(res.status).toBe(201);
    expect(res.body.id).toBeTypeOf("number");
    expect(res.body.name).toBe(SEQUENCE_NAME);
    // Slug is derived from the name, lower-cased and dash-separated.
    expect(res.body.slug).toBe(EXPECTED_SLUG_PREFIX);
    // New sequences default to active -> status alias "active".
    expect(res.body.status).toBe("active");

    createdSequenceIds.push(res.body.id);

    // Persisted row carries the same slug and active=true.
    const [row] = await db.select().from(sequencesTable).where(eq(sequencesTable.id, res.body.id));
    expect(row.slug).toBe(EXPECTED_SLUG_PREFIX);
    expect(row.active).toBe(true);
  });

  it("disambiguates a duplicate name into a unique slug", async () => {
    const res = await request(app)
      .post("/api/admin/communications/sequences")
      .set("Cookie", adminCookie)
      .send({ name: SEQUENCE_NAME });

    expect(res.status).toBe(201);
    // Second sequence with the same name gets a "-2" suffix.
    expect(res.body.slug).toBe(`${EXPECTED_SLUG_PREFIX}-2`);

    createdSequenceIds.push(res.body.id);
  });

  it("adds a step that persists templateRef + stepOrder and exposes templateSlug/sortOrder aliases", async () => {
    const sequenceId = createdSequenceIds[0];

    const firstStep = await request(app)
      .post(`/api/admin/communications/sequences/${sequenceId}/steps`)
      .set("Cookie", adminCookie)
      .send({ channel: "email", templateSlug: "welcome_email", subject: "Welcome!", delayMinutes: 0 });

    expect(firstStep.status).toBe(201);
    // UI-facing aliases mirror the underlying columns.
    expect(firstStep.body.templateSlug).toBe("welcome_email");
    expect(firstStep.body.sortOrder).toBe(0);

    // The persisted column is templateRef, sourced from templateSlug.
    const [persisted] = await db
      .select()
      .from(sequenceStepsTable)
      .where(eq(sequenceStepsTable.id, firstStep.body.id));
    expect(persisted.templateRef).toBe("welcome_email");
    expect(persisted.stepOrder).toBe(0);

    // A second step with no explicit order auto-increments stepOrder.
    const secondStep = await request(app)
      .post(`/api/admin/communications/sequences/${sequenceId}/steps`)
      .set("Cookie", adminCookie)
      .send({ channel: "sms", templateSlug: "welcome_sms" });

    expect(secondStep.status).toBe(201);
    expect(secondStep.body.sortOrder).toBe(1);
  });

  it("lists sequences with derived status and step counts", async () => {
    const res = await request(app)
      .get("/api/admin/communications/sequences")
      .set("Cookie", adminCookie);

    expect(res.status).toBe(200);
    const ours = res.body.find((s: any) => s.id === createdSequenceIds[0]);
    expect(ours).toBeDefined();
    expect(ours.status).toBe("active");
    expect(ours.stepCount).toBe(2);
    expect(ours.activeEnrollments).toBe(0);
  });

  it("returns a single sequence with steps carrying templateSlug aliases", async () => {
    const sequenceId = createdSequenceIds[0];
    const res = await request(app)
      .get(`/api/admin/communications/sequences/${sequenceId}`)
      .set("Cookie", adminCookie);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("active");
    expect(res.body.steps).toHaveLength(2);
    // Steps come back ordered by stepOrder with the templateSlug alias.
    expect(res.body.steps[0].templateSlug).toBe("welcome_email");
    expect(res.body.steps[0].sortOrder).toBe(0);
    expect(res.body.steps[1].templateSlug).toBe("welcome_sms");
    expect(res.body.steps[1].sortOrder).toBe(1);
  });

  it("reorders steps via the reorder endpoint", async () => {
    const sequenceId = createdSequenceIds[0];
    const detail = await request(app)
      .get(`/api/admin/communications/sequences/${sequenceId}`)
      .set("Cookie", adminCookie);
    const [stepA, stepB] = detail.body.steps;

    // Swap their order.
    const res = await request(app)
      .patch(`/api/admin/communications/sequences/${sequenceId}/steps/reorder`)
      .set("Cookie", adminCookie)
      .send({ orders: [{ id: stepA.id, sortOrder: 1 }, { id: stepB.id, sortOrder: 0 }] });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const after = await request(app)
      .get(`/api/admin/communications/sequences/${sequenceId}`)
      .set("Cookie", adminCookie);
    // welcome_sms (formerly order 1) now sorts first.
    expect(after.body.steps[0].templateSlug).toBe("welcome_sms");
    expect(after.body.steps[1].templateSlug).toBe("welcome_email");
  });

  it("pauses then resumes a sequence, toggling active and the status alias", async () => {
    const sequenceId = createdSequenceIds[0];

    const paused = await request(app)
      .patch(`/api/admin/communications/sequences/${sequenceId}/pause`)
      .set("Cookie", adminCookie);
    expect(paused.status).toBe(200);
    expect(paused.body.status).toBe("paused");

    const [pausedRow] = await db.select().from(sequencesTable).where(eq(sequencesTable.id, sequenceId));
    expect(pausedRow.active).toBe(false);

    const resumed = await request(app)
      .patch(`/api/admin/communications/sequences/${sequenceId}/resume`)
      .set("Cookie", adminCookie);
    expect(resumed.status).toBe(200);
    expect(resumed.body.status).toBe("active");

    const [resumedRow] = await db.select().from(sequencesTable).where(eq(sequencesTable.id, sequenceId));
    expect(resumedRow.active).toBe(true);
  });

  it("rejects non-admin callers with 403", async () => {
    const res = await request(app)
      .post("/api/admin/communications/sequences")
      .set("Cookie", memberCookie)
      .send({ name: `${TEST_TAG} unauthorized` });

    expect(res.status).toBe(403);
  });
});
