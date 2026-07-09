import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { randomUUID } from "crypto";
import {
  db,
  auditLogTable,
  usersTable,
  emailTemplatesTable,
  emailTemplateVersionsTable,
  smsTemplatesTable,
} from "@workspace/db";
import { and, eq, inArray, gte } from "drizzle-orm";

vi.mock("../lib/redis", () => ({
  getRedis: () => null,
  getRedisConnection: vi.fn(),
  createRedisConnection: vi.fn(),
  isRedisConnected: async () => false,
}));

// The restore-default endpoint only works for slugs with starter copy on
// file. We must NEVER mutate a real starter-slug row in the shared dev DB
// (a crashed run would leave a member-facing template clobbered — and with
// starter_hash NULL the boot refresh skips it forever). Instead, register a
// throwaway test slug with fake starter copy via this hoisted fixture.
const restoreDefaultFixture = vi.hoisted(() => ({
  slug: "",
  starter: null as {
    slug: string;
    name: string;
    subject: string;
    htmlBody: string;
    textBody: string;
    category: string;
    variables: string[];
  } | null,
}));

vi.mock("../lib/seed-templates", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/seed-templates")>();
  return {
    ...actual,
    getStarterEmailTemplate: (slug: string) =>
      slug === restoreDefaultFixture.slug && restoreDefaultFixture.starter
        ? restoreDefaultFixture.starter
        : actual.getStarterEmailTemplate(slug),
    listStarterEmailTemplateSlugs: () =>
      restoreDefaultFixture.slug
        ? [...actual.listStarterEmailTemplateSlugs(), restoreDefaultFixture.slug]
        : actual.listStarterEmailTemplateSlugs(),
  };
});

import adminCommunicationsRouter from "../routes/admin-communications";
import { buildTestAppWithRouters } from "./test-app";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const TEST_TAG = `tpl-audit-writes-${randomUUID().slice(0, 8)}`;

const seededUserIds: number[] = [];
const seededEmailTemplateIds: number[] = [];
const seededSmsTemplateIds: number[] = [];
let suiteStartTime: Date;

let app: ReturnType<typeof buildTestAppWithRouters>;
let adminCookie = "";
let adminId = 0;
let adminEmail = "";

function signCookie(userId: number, email: string): string {
  const token = jwt.sign({ userId, email }, JWT_SECRET, { expiresIn: "1h" });
  return `access_token=${token}`;
}

beforeAll(async () => {
  suiteStartTime = new Date();
  app = buildTestAppWithRouters([adminCommunicationsRouter]);

  adminEmail = `${TEST_TAG}-admin@example.test`;
  const passwordHash = await bcrypt.hash("irrelevant-test-password", 4);
  const [admin] = await db
    .insert(usersTable)
    .values({
      email: adminEmail,
      name: "Template Audit Writes Admin",
      passwordHash,
      role: "super_admin",
      sourceProduct: "lifetime",
      emailVerified: true,
      onboardingComplete: true,
    })
    .returning({ id: usersTable.id });
  seededUserIds.push(admin.id);
  adminId = admin.id;
  adminCookie = signCookie(admin.id, adminEmail);
});

afterAll(async () => {
  // Clean audit rows this suite produced (everything is keyed off the
  // admin actorId so we don't risk touching unrelated rows).
  await db
    .delete(auditLogTable)
    .where(
      and(
        eq(auditLogTable.actorId, adminId),
        gte(auditLogTable.createdAt, suiteStartTime),
      ),
    );

  if (seededEmailTemplateIds.length > 0) {
    await db
      .delete(emailTemplateVersionsTable)
      .where(inArray(emailTemplateVersionsTable.templateId, seededEmailTemplateIds));
    await db
      .delete(emailTemplatesTable)
      .where(inArray(emailTemplatesTable.id, seededEmailTemplateIds));
  }

  if (seededSmsTemplateIds.length > 0) {
    await db
      .delete(smsTemplatesTable)
      .where(inArray(smsTemplatesTable.id, seededSmsTemplateIds));
  }

  if (seededUserIds.length > 0) {
    await db.delete(usersTable).where(inArray(usersTable.id, seededUserIds));
  }
});

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

/**
 * Most recent audit row matching the predicate (action + entity + entityId),
 * scoped to this suite's admin so cross-suite noise can't satisfy a match.
 */
async function findAuditRow(args: {
  actionType: string;
  entityType: string;
  entityId: string;
}) {
  const rows = await db
    .select()
    .from(auditLogTable)
    .where(
      and(
        eq(auditLogTable.actorId, adminId),
        eq(auditLogTable.actionType, args.actionType),
        eq(auditLogTable.entityType, args.entityType),
        eq(auditLogTable.entityId, args.entityId),
      ),
    );
  return rows[rows.length - 1];
}

describe("admin-communications template mutation handlers write audit rows", () => {
  describe("email-template endpoints", () => {
    it("POST creates an email template and writes a template_create audit row", async () => {
      const slug = `${TEST_TAG}-email-create`;
      const res = await request(app)
        .post("/api/admin/communications/email-templates")
        .set("Cookie", adminCookie)
        .send({
          slug,
          name: "Create Test",
          subject: "Welcome",
          htmlBody: "<p>hi</p>",
          textBody: "hi",
          category: "transactional",
          variables: ["member_name"],
        });
      expect(res.status).toBe(201);
      seededEmailTemplateIds.push(res.body.id);

      const audit = await findAuditRow({
        actionType: "template_create",
        entityType: "email_template",
        entityId: String(res.body.id),
      });
      expect(audit).toBeDefined();
      expect(audit.metadata).toMatchObject({
        templateSlug: slug,
        templateName: "Create Test",
        channel: "email",
      });
      // Create audit has only an `after` snapshot (no changedFields diff).
      const diff = audit.changeDiff as { after?: Record<string, unknown> };
      expect(diff.after).toMatchObject({
        slug,
        name: "Create Test",
        subject: "Welcome",
      });
    });

    it("PUT updates an email template and writes a template_update audit row, summarizing long htmlBody", async () => {
      const slug = `${TEST_TAG}-email-update`;
      const [seed] = await db
        .insert(emailTemplatesTable)
        .values({
          slug,
          name: "Update Test",
          subject: "Old subject",
          htmlBody: "<p>short before</p>",
          textBody: "short before",
          category: "transactional",
          variables: [],
          starterHash: null,
        })
        .returning();
      seededEmailTemplateIds.push(seed.id);

      // Build an htmlBody that comfortably exceeds the summarization threshold
      // (256 chars) so the audit diff stores `{ length, sha256 }`, not the raw HTML.
      const longHtml = `<p>${"x".repeat(400)}</p>`;
      const newSubject = "Brand new subject";

      const res = await request(app)
        .put(`/api/admin/communications/email-templates/${seed.id}`)
        .set("Cookie", adminCookie)
        .send({
          subject: newSubject,
          htmlBody: longHtml,
        });
      expect(res.status).toBe(200);

      const audit = await findAuditRow({
        actionType: "template_update",
        entityType: "email_template",
        entityId: String(seed.id),
      });
      expect(audit).toBeDefined();
      expect(audit.metadata).toMatchObject({
        templateSlug: slug,
        channel: "email",
      });

      const diff = audit.changeDiff as {
        before: Record<string, unknown>;
        after: Record<string, unknown>;
        changedFields: string[];
      };
      expect(diff.changedFields.sort()).toEqual(["htmlBody", "subject"]);

      // Subject is short — stays inline.
      expect(diff.before.subject).toBe("Old subject");
      expect(diff.after.subject).toBe(newSubject);

      // htmlBody exceeds threshold — must be summarised as `{ length, sha256 }`
      // and the sha256 must be a 12-char hex prefix of the actual content hash.
      const afterHtml = diff.after.htmlBody as { length: number; sha256: string };
      expect(afterHtml).toEqual({
        length: longHtml.length,
        sha256: crypto.createHash("sha256").update(longHtml).digest("hex").slice(0, 12),
      });
      expect(afterHtml.sha256).toMatch(/^[0-9a-f]{12}$/);
      // The full body must NOT appear in the diff (the whole point of
      // summarization is keeping the audit row compact).
      expect(JSON.stringify(audit.changeDiff)).not.toContain("xxxxxxxxxx");
    });

    it("POST .../restore/:versionId writes a template_update audit row with source=restore_version", async () => {
      const slug = `${TEST_TAG}-email-restore-version`;
      const [seed] = await db
        .insert(emailTemplatesTable)
        .values({
          slug,
          name: "Version Restore Test",
          subject: "Subject v2",
          htmlBody: "<p>body v2</p>",
          textBody: "body v2",
          category: "transactional",
          variables: [],
          starterHash: null,
        })
        .returning();
      seededEmailTemplateIds.push(seed.id);

      // Hand-craft a version snapshot to restore back to.
      const [version] = await db
        .insert(emailTemplateVersionsTable)
        .values({
          templateId: seed.id,
          version: 1,
          slug,
          name: "Version Restore Test",
          subject: "Subject v1",
          htmlBody: "<p>body v1</p>",
          textBody: "body v1",
          category: "transactional",
          fromName: null,
          variables: [],
          savedBy: adminId,
        })
        .returning();

      const res = await request(app)
        .post(`/api/admin/communications/email-templates/${seed.id}/restore/${version.id}`)
        .set("Cookie", adminCookie);
      expect(res.status).toBe(200);

      const audit = await findAuditRow({
        actionType: "template_update",
        entityType: "email_template",
        entityId: String(seed.id),
      });
      expect(audit).toBeDefined();
      expect(audit.metadata).toMatchObject({
        templateSlug: slug,
        channel: "email",
      });
      const diff = audit.changeDiff as {
        changedFields: string[];
        source?: string;
        restoredVersion?: number;
      };
      expect(diff.source).toBe("restore_version");
      expect(diff.restoredVersion).toBe(1);
      expect(diff.changedFields).toContain("subject");
    });

    it("POST .../restore-default writes a template_update audit row with source=restore_default", async () => {
      // Use a THROWAWAY template row with a unique test slug — never mutate a
      // real starter-slug row in place (a crashed run would leave the shared
      // dev DB clobbered). The starter lookup for this slug is provided by
      // the hoisted seed-templates mock above.
      const slug = `${TEST_TAG}-email-restore-default`;
      restoreDefaultFixture.slug = slug;
      restoreDefaultFixture.starter = {
        slug,
        name: "Restore Default Test",
        subject: "Starter subject",
        htmlBody: "<p>Starter body</p>",
        textBody: "Starter body",
        category: "transactional",
        variables: [],
      };

      // Seed the row diverged from starter copy so the diff is non-empty and
      // the audit row actually gets written.
      const [seed] = await db
        .insert(emailTemplatesTable)
        .values({
          slug,
          name: "Restore Default Test",
          subject: "ADMIN OVERRIDE for audit-writes test",
          htmlBody: "<p>ADMIN OVERRIDE for audit-writes test</p>",
          textBody: "ADMIN OVERRIDE for audit-writes test",
          category: "transactional",
          variables: [],
          starterHash: null,
        })
        .returning();
      seededEmailTemplateIds.push(seed.id);

      const res = await request(app)
        .post(`/api/admin/communications/email-templates/${seed.id}/restore-default`)
        .set("Cookie", adminCookie);
      expect(res.status).toBe(200);
      expect(res.body.subject).toBe("Starter subject");

      const audit = await findAuditRow({
        actionType: "template_update",
        entityType: "email_template",
        entityId: String(seed.id),
      });
      expect(audit).toBeDefined();
      expect(audit.metadata).toMatchObject({
        templateSlug: slug,
        channel: "email",
      });
      const diff = audit.changeDiff as { source?: string; changedFields: string[] };
      expect(diff.source).toBe("restore_default");
      expect(diff.changedFields).toContain("subject");
    });

    it("DELETE removes the template and writes a template_delete audit row summarizing long bodies", async () => {
      const slug = `${TEST_TAG}-email-delete`;
      const longHtml = `<p>${"y".repeat(400)}</p>`;
      const [seed] = await db
        .insert(emailTemplatesTable)
        .values({
          slug,
          name: "Delete Test",
          subject: "Delete subject",
          htmlBody: longHtml,
          textBody: "short text body",
          category: "transactional",
          variables: [],
          starterHash: null,
        })
        .returning();
      // Do NOT push to seededEmailTemplateIds: the row is being deleted by
      // the route. The associated audit row is still cleaned up in afterAll.

      const res = await request(app)
        .delete(`/api/admin/communications/email-templates/${seed.id}`)
        .set("Cookie", adminCookie);
      expect(res.status).toBe(200);

      const audit = await findAuditRow({
        actionType: "template_delete",
        entityType: "email_template",
        entityId: String(seed.id),
      });
      expect(audit).toBeDefined();
      expect(audit.metadata).toMatchObject({
        templateSlug: slug,
        templateName: "Delete Test",
        channel: "email",
      });
      const diff = audit.changeDiff as { before: Record<string, unknown> };
      expect(diff.before.slug).toBe(slug);
      // Long htmlBody is summarised even on delete snapshots.
      expect(diff.before.htmlBody).toEqual({
        length: longHtml.length,
        sha256: crypto.createHash("sha256").update(longHtml).digest("hex").slice(0, 12),
      });
      // Short textBody stays inline.
      expect(diff.before.textBody).toBe("short text body");
    });
  });

  describe("sms-template endpoints", () => {
    it("POST creates an SMS template and writes a template_create audit row", async () => {
      const slug = `${TEST_TAG}-sms-create`;
      const res = await request(app)
        .post("/api/admin/communications/sms-templates")
        .set("Cookie", adminCookie)
        .send({
          slug,
          name: "SMS Create Test",
          body: "Hi {{member_name}}",
          variables: ["member_name"],
        });
      expect(res.status).toBe(201);
      seededSmsTemplateIds.push(res.body.id);

      const audit = await findAuditRow({
        actionType: "template_create",
        entityType: "sms_template",
        entityId: String(res.body.id),
      });
      expect(audit).toBeDefined();
      expect(audit.metadata).toMatchObject({
        templateSlug: slug,
        templateName: "SMS Create Test",
        channel: "sms",
      });
      const diff = audit.changeDiff as { after: Record<string, unknown> };
      expect(diff.after).toMatchObject({
        slug,
        name: "SMS Create Test",
        body: "Hi {{member_name}}",
      });
    });

    it("PUT updates an SMS template and writes a template_update audit row, summarizing long body", async () => {
      const slug = `${TEST_TAG}-sms-update`;
      const [seed] = await db
        .insert(smsTemplatesTable)
        .values({
          slug,
          name: "SMS Update Test",
          body: "short before",
          variables: [],
        })
        .returning();
      seededSmsTemplateIds.push(seed.id);

      const longBody = "z".repeat(400);
      const res = await request(app)
        .put(`/api/admin/communications/sms-templates/${seed.id}`)
        .set("Cookie", adminCookie)
        .send({ name: "SMS Update Test (renamed)", body: longBody });
      expect(res.status).toBe(200);

      const audit = await findAuditRow({
        actionType: "template_update",
        entityType: "sms_template",
        entityId: String(seed.id),
      });
      expect(audit).toBeDefined();
      expect(audit.metadata).toMatchObject({
        templateSlug: slug,
        channel: "sms",
      });
      const diff = audit.changeDiff as {
        before: Record<string, unknown>;
        after: Record<string, unknown>;
        changedFields: string[];
      };
      expect(diff.changedFields.sort()).toEqual(["body", "name"]);
      // Short name stays inline.
      expect(diff.before.name).toBe("SMS Update Test");
      expect(diff.after.name).toBe("SMS Update Test (renamed)");
      // Long body is summarised.
      expect(diff.before.body).toBe("short before");
      expect(diff.after.body).toEqual({
        length: longBody.length,
        sha256: crypto.createHash("sha256").update(longBody).digest("hex").slice(0, 12),
      });
    });

    it("DELETE removes the SMS template and writes a template_delete audit row", async () => {
      const slug = `${TEST_TAG}-sms-delete`;
      const longBody = "q".repeat(400);
      const [seed] = await db
        .insert(smsTemplatesTable)
        .values({
          slug,
          name: "SMS Delete Test",
          body: longBody,
          variables: [],
        })
        .returning();

      const res = await request(app)
        .delete(`/api/admin/communications/sms-templates/${seed.id}`)
        .set("Cookie", adminCookie);
      expect(res.status).toBe(200);

      const audit = await findAuditRow({
        actionType: "template_delete",
        entityType: "sms_template",
        entityId: String(seed.id),
      });
      expect(audit).toBeDefined();
      expect(audit.metadata).toMatchObject({
        templateSlug: slug,
        templateName: "SMS Delete Test",
        channel: "sms",
      });
      const diff = audit.changeDiff as { before: Record<string, unknown> };
      expect(diff.before.slug).toBe(slug);
      // Long body summarised on delete.
      expect(diff.before.body).toEqual({
        length: longBody.length,
        sha256: crypto.createHash("sha256").update(longBody).digest("hex").slice(0, 12),
      });
    });
  });
});
