import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import { db, usersTable, emailTemplatesTable, emailTemplateVersionsTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

vi.mock("../lib/redis", () => ({
  getRedis: () => null,
  getRedisConnection: vi.fn(),
  createRedisConnection: vi.fn(),
  isRedisConnected: async () => false,
}));

import { buildTestAppWithRouters } from "./test-app";
import adminCommunicationsRouter from "../routes/admin-communications";
import {
  getStarterEmailTemplate,
  templateContentHash,
} from "../lib/seed-templates";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const TEST_TAG = `restore-default-${randomUUID().slice(0, 8)}`;
// `signup_attempted` is the canonical motivating example from Task #208.
const STARTER_SLUG = "signup_attempted";
const NON_STARTER_SLUG = `${TEST_TAG}-no-starter`;

const seededUserIds: number[] = [];
const seededTemplateIds: number[] = [];
let app: ReturnType<typeof buildTestAppWithRouters>;
let adminCookie: string;
let memberCookie: string;
let savedSignupAttemptedRow: typeof emailTemplatesTable.$inferSelect | undefined;

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

  // Capture the live signup_attempted row so we can restore it after the test.
  const [existing] = await db
    .select()
    .from(emailTemplatesTable)
    .where(eq(emailTemplatesTable.slug, STARTER_SLUG));
  savedSignupAttemptedRow = existing;

  if (!existing) {
    // The test suite expects this row to exist (seeded at db init). If it
    // doesn't, the rest of the suite would already be in a bad state — fail
    // loudly here so the cause is obvious.
    throw new Error(`Test setup precondition: ${STARTER_SLUG} template must exist in DB`);
  }

  // Seed a non-starter template so the 400 case has something to target.
  const [nonStarter] = await db
    .insert(emailTemplatesTable)
    .values({
      slug: NON_STARTER_SLUG,
      name: "Custom Test Template",
      subject: "Custom subject",
      htmlBody: "<p>custom</p>",
      textBody: "custom",
      category: "transactional",
      starterHash: null,
    })
    .returning();
  seededTemplateIds.push(nonStarter.id);
});

afterAll(async () => {
  // Restore the original signup_attempted row + clear any version snapshots
  // we added during the test.
  if (savedSignupAttemptedRow) {
    await db
      .delete(emailTemplateVersionsTable)
      .where(eq(emailTemplateVersionsTable.templateId, savedSignupAttemptedRow.id));
    await db
      .update(emailTemplatesTable)
      .set({
        name: savedSignupAttemptedRow.name,
        subject: savedSignupAttemptedRow.subject,
        htmlBody: savedSignupAttemptedRow.htmlBody,
        textBody: savedSignupAttemptedRow.textBody,
        category: savedSignupAttemptedRow.category,
        fromName: savedSignupAttemptedRow.fromName,
        variables: savedSignupAttemptedRow.variables,
        active: savedSignupAttemptedRow.active,
        starterHash: savedSignupAttemptedRow.starterHash,
      })
      .where(eq(emailTemplatesTable.id, savedSignupAttemptedRow.id));
  }

  if (seededTemplateIds.length > 0) {
    await db
      .delete(emailTemplateVersionsTable)
      .where(inArray(emailTemplateVersionsTable.templateId, seededTemplateIds));
    await db
      .delete(emailTemplatesTable)
      .where(inArray(emailTemplatesTable.id, seededTemplateIds));
  }

  if (seededUserIds.length > 0) {
    await db.delete(usersTable).where(inArray(usersTable.id, seededUserIds));
  }
});

describe("POST /admin/communications/email-templates/:id/restore-default", () => {
  it("rewrites the row to the starter copy, snapshots the prior version, and stamps starter_hash", async () => {
    const id = savedSignupAttemptedRow!.id;

    // Simulate an admin edit: clear starter_hash and rewrite content.
    await db
      .update(emailTemplatesTable)
      .set({
        subject: "ADMIN OVERRIDE SUBJECT",
        htmlBody: "<p>ADMIN OVERRIDE BODY</p>",
        textBody: "ADMIN OVERRIDE BODY",
        starterHash: null,
      })
      .where(eq(emailTemplatesTable.id, id));

    const res = await request(app)
      .post(`/api/admin/communications/email-templates/${id}/restore-default`)
      .set("Cookie", adminCookie);

    expect(res.status).toBe(200);
    expect(res.body.editedFromDefault).toBe(false);
    expect(res.body.hasStarterDefault).toBe(true);

    const starter = getStarterEmailTemplate(STARTER_SLUG)!;
    const [row] = await db.select().from(emailTemplatesTable).where(eq(emailTemplatesTable.id, id));
    expect(row.subject).toBe(starter.subject);
    expect(row.htmlBody).toBe(starter.htmlBody);
    expect(row.textBody).toBe(starter.textBody);
    expect(row.starterHash).toBe(templateContentHash(starter));

    // Prior (overridden) copy should be retained as a version snapshot for rollback.
    const versions = await db
      .select()
      .from(emailTemplateVersionsTable)
      .where(eq(emailTemplateVersionsTable.templateId, id));
    const overrideSnapshot = versions.find(v => v.subject === "ADMIN OVERRIDE SUBJECT");
    expect(overrideSnapshot).toBeDefined();
  });

  it("returns 400 when the slug has no starter copy on file", async () => {
    const nonStarterId = seededTemplateIds[0];
    const res = await request(app)
      .post(`/api/admin/communications/email-templates/${nonStarterId}/restore-default`)
      .set("Cookie", adminCookie);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/no starter copy/i);

    // Row should be untouched.
    const [row] = await db.select().from(emailTemplatesTable).where(eq(emailTemplatesTable.id, nonStarterId));
    expect(row.subject).toBe("Custom subject");
  });

  it("returns 404 when the template id does not exist", async () => {
    const res = await request(app)
      .post(`/api/admin/communications/email-templates/9999999/restore-default`)
      .set("Cookie", adminCookie);

    expect(res.status).toBe(404);
  });

  it("rejects non-admin callers with 403", async () => {
    const id = savedSignupAttemptedRow!.id;
    const res = await request(app)
      .post(`/api/admin/communications/email-templates/${id}/restore-default`)
      .set("Cookie", memberCookie);

    expect(res.status).toBe(403);
  });
});
