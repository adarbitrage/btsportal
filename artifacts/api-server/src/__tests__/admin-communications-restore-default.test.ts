import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import {
  db,
  usersTable,
  emailTemplatesTable,
  emailTemplateVersionsTable,
  auditLogTable,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

vi.mock("../lib/redis", () => ({
  getRedis: () => null,
  getRedisConnection: vi.fn(),
  createRedisConnection: vi.fn(),
  isRedisConnected: async () => false,
}));

// The restore-default endpoint only works for slugs with starter copy on
// file. We must NEVER mutate a real starter-slug row in the shared dev DB
// (a crashed run would leave a member-facing template clobbered — and with
// starter_hash NULL the boot starter refresh skips it forever). Instead,
// register a throwaway test slug with fake starter copy via this hoisted
// fixture so the suite exercises the endpoint against its own row.
const restoreDefaultFixture = vi.hoisted(() => {
  const slug = `restore-default-test-starter-${Math.random().toString(36).slice(2, 10)}`;
  return {
    slug,
    starter: {
      slug,
      name: "Restore Default Suite Starter",
      subject: "Starter subject",
      htmlBody: "<p>Starter body</p>",
      textBody: "Starter body",
      category: "transactional",
      variables: [] as string[],
    },
  };
});

vi.mock("../lib/seed-templates", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/seed-templates")>();
  return {
    ...actual,
    getStarterEmailTemplate: (slug: string) =>
      slug === restoreDefaultFixture.slug
        ? restoreDefaultFixture.starter
        : actual.getStarterEmailTemplate(slug),
    listStarterEmailTemplateSlugs: () => [
      ...actual.listStarterEmailTemplateSlugs(),
      restoreDefaultFixture.slug,
    ],
  };
});

import { buildTestAppWithRouters } from "./test-app";
import adminCommunicationsRouter from "../routes/admin-communications";
import { templateContentHash } from "../lib/seed-templates";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const TEST_TAG = `restore-default-${randomUUID().slice(0, 8)}`;
const STARTER_TEST_SLUG = restoreDefaultFixture.slug;
const NON_STARTER_SLUG = `${TEST_TAG}-no-starter`;

const seededUserIds: number[] = [];
const seededTemplateIds: number[] = [];
let app: ReturnType<typeof buildTestAppWithRouters>;
let adminCookie: string;
let memberCookie: string;
let starterRowId = 0;

const FAKE_STARTER = restoreDefaultFixture.starter;

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

  // Seed the throwaway "starter" row, pre-diverged from starter copy — this
  // suite never touches real starter-slug rows like signup_attempted.
  const [starterRow] = await db
    .insert(emailTemplatesTable)
    .values({
      slug: STARTER_TEST_SLUG,
      name: FAKE_STARTER.name,
      subject: "ADMIN OVERRIDE SUBJECT",
      htmlBody: "<p>ADMIN OVERRIDE BODY</p>",
      textBody: "ADMIN OVERRIDE BODY",
      category: "transactional",
      variables: [],
      starterHash: null,
    })
    .returning();
  seededTemplateIds.push(starterRow.id);
  starterRowId = starterRow.id;

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
  if (seededTemplateIds.length > 0) {
    await db
      .delete(emailTemplateVersionsTable)
      .where(inArray(emailTemplateVersionsTable.templateId, seededTemplateIds));
    await db
      .delete(emailTemplatesTable)
      .where(inArray(emailTemplatesTable.id, seededTemplateIds));
  }

  if (seededUserIds.length > 0) {
    // The restore-default route writes audit rows for the admin actor; clean
    // them up so the user delete doesn't hit the audit_log FK.
    await db.delete(auditLogTable).where(inArray(auditLogTable.actorId, seededUserIds));
    await db.delete(usersTable).where(inArray(usersTable.id, seededUserIds));
  }
});

describe("POST /admin/communications/email-templates/:id/restore-default", () => {
  it("rewrites the row to the starter copy, snapshots the prior version, and stamps starter_hash", async () => {
    const res = await request(app)
      .post(`/api/admin/communications/email-templates/${starterRowId}/restore-default`)
      .set("Cookie", adminCookie);

    expect(res.status).toBe(200);
    expect(res.body.editedFromDefault).toBe(false);
    expect(res.body.hasStarterDefault).toBe(true);

    const [row] = await db
      .select()
      .from(emailTemplatesTable)
      .where(eq(emailTemplatesTable.id, starterRowId));
    expect(row.subject).toBe(FAKE_STARTER.subject);
    expect(row.htmlBody).toBe(FAKE_STARTER.htmlBody);
    expect(row.textBody).toBe(FAKE_STARTER.textBody);
    expect(row.starterHash).toBe(templateContentHash(FAKE_STARTER));

    // Prior (overridden) copy should be retained as a version snapshot for rollback.
    const versions = await db
      .select()
      .from(emailTemplateVersionsTable)
      .where(eq(emailTemplateVersionsTable.templateId, starterRowId));
    const overrideSnapshot = versions.find(v => v.subject === "ADMIN OVERRIDE SUBJECT");
    expect(overrideSnapshot).toBeDefined();
  });

  it("returns 400 when the slug has no starter copy on file", async () => {
    const nonStarterId = seededTemplateIds[1];
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
    const res = await request(app)
      .post(`/api/admin/communications/email-templates/${starterRowId}/restore-default`)
      .set("Cookie", memberCookie);

    expect(res.status).toBe(403);
  });
});
