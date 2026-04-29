import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { db, emailTemplatesTable, emailTemplateVersionsTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

vi.mock("../lib/redis", () => ({
  getRedis: () => null,
  getRedisConnection: vi.fn(),
  createRedisConnection: vi.fn(),
  isRedisConnected: async () => false,
}));

import {
  ensureRequiredEmailTemplates,
  templateContentHash,
  priorStarterRevisions,
  getStarterEmailTemplate,
} from "../lib/seed-templates";

const SLUG = "email_change_cancelled_by_admin";

async function wipeSlug(): Promise<void> {
  const rows = await db
    .select({ id: emailTemplatesTable.id })
    .from(emailTemplatesTable)
    .where(eq(emailTemplatesTable.slug, SLUG));
  if (rows.length > 0) {
    const ids = rows.map(r => r.id);
    await db
      .delete(emailTemplateVersionsTable)
      .where(inArray(emailTemplateVersionsTable.templateId, ids));
    await db.delete(emailTemplatesTable).where(inArray(emailTemplatesTable.id, ids));
  }
}

beforeEach(async () => {
  await wipeSlug();
});

afterAll(async () => {
  await wipeSlug();
});

describe("email_change_cancelled_by_admin rollout to existing tenants", () => {
  it("records the pre-deep-link copy as a recognized prior starter revision", () => {
    const priors = priorStarterRevisions[SLUG];
    expect(priors).toBeDefined();
    expect(priors.length).toBeGreaterThanOrEqual(1);

    // Sanity-check the recorded prior really is the pre-deep-link copy:
    // it should still link members at /settings and must not yet reference
    // the {{restart_url}} variable.
    const pre = priors[0];
    expect(pre.htmlBody).toContain("{{portal_url}}/settings");
    expect(pre.htmlBody).not.toContain("{{restart_url}}");
    expect(pre.textBody).not.toContain("{{restart_url}}");
  });

  it("ships the new starter copy with the Start a new email change CTA", () => {
    const starter = getStarterEmailTemplate(SLUG);
    expect(starter).not.toBeNull();
    expect(starter!.variables).toContain("restart_url");
    expect(starter!.htmlBody).toContain("{{restart_url}}");
    expect(starter!.htmlBody).toContain("Start a new email change");
    expect(starter!.textBody).toContain("{{restart_url}}");
  });

  it("refreshes a legacy tenant row whose starter_hash matches the pre-deep-link copy", async () => {
    const pre = priorStarterRevisions[SLUG][0];
    const starter = getStarterEmailTemplate(SLUG)!;

    // Legacy state: row was seeded back when the pre-deep-link copy was
    // current, so `starter_hash` was stamped to the prior fingerprint.
    await db.insert(emailTemplatesTable).values({
      slug: SLUG,
      name: pre.name,
      subject: pre.subject,
      htmlBody: pre.htmlBody,
      textBody: pre.textBody,
      category: "transactional",
      variables: ["member_name", "member_email", "cancelled_pending_email", "portal_url", "support_email", "current_year"],
      starterHash: templateContentHash(pre),
    });

    const result = await ensureRequiredEmailTemplates();
    expect(result.refreshed).toContain(SLUG);

    const [row] = await db
      .select()
      .from(emailTemplatesTable)
      .where(eq(emailTemplatesTable.slug, SLUG));
    expect(row.htmlBody).toContain("{{restart_url}}");
    expect(row.htmlBody).toContain("Start a new email change");
    expect(row.htmlBody).not.toContain("Go to Account Settings");
    expect(row.textBody).toContain("{{restart_url}}");
    expect(row.variables).toContain("restart_url");
    expect(row.starterHash).toBe(templateContentHash(starter));

    // The pre-deep-link copy should be retained as a version snapshot for
    // rollback or audit.
    const versions = await db
      .select()
      .from(emailTemplateVersionsTable)
      .where(eq(emailTemplateVersionsTable.templateId, row.id));
    expect(versions).toHaveLength(1);
    expect(versions[0].subject).toBe(pre.subject);
    expect(versions[0].htmlBody).toContain("{{portal_url}}/settings");
    expect(versions[0].savedBy).toBeNull();
  });

  it("refreshes a legacy tenant row with NULL starter_hash whose content matches the pre-deep-link copy", async () => {
    const pre = priorStarterRevisions[SLUG][0];
    const starter = getStarterEmailTemplate(SLUG)!;

    // Pre-`starter_hash`-column row: content matches the prior starter
    // exactly but no fingerprint was ever recorded.
    await db.insert(emailTemplatesTable).values({
      slug: SLUG,
      name: pre.name,
      subject: pre.subject,
      htmlBody: pre.htmlBody,
      textBody: pre.textBody,
      category: "transactional",
      variables: ["member_name", "member_email", "cancelled_pending_email", "portal_url", "support_email", "current_year"],
      starterHash: null,
    });

    const result = await ensureRequiredEmailTemplates();
    expect(result.refreshed).toContain(SLUG);

    const [row] = await db
      .select()
      .from(emailTemplatesTable)
      .where(eq(emailTemplatesTable.slug, SLUG));
    expect(row.htmlBody).toContain("{{restart_url}}");
    expect(row.htmlBody).toContain("Start a new email change");
    expect(row.starterHash).toBe(templateContentHash(starter));

    const versions = await db
      .select()
      .from(emailTemplateVersionsTable)
      .where(eq(emailTemplateVersionsTable.templateId, row.id));
    expect(versions).toHaveLength(1);
    expect(versions[0].htmlBody).toContain("{{portal_url}}/settings");
  });

  it("never overwrites a tenant who customized the cancellation copy via the admin UI", async () => {
    // Admin-customized state: `starter_hash` is NULL (cleared by the admin
    // PUT route) and the content is unrecognizable as any starter version.
    const customSubject = "Heads-up: support cancelled your pending email change";
    const customHtml = "<p>Custom tenant body — please contact support@example.com.</p>";
    const customText = "Custom tenant body — please contact support@example.com.";
    await db.insert(emailTemplatesTable).values({
      slug: SLUG,
      name: "Custom cancellation notice",
      subject: customSubject,
      htmlBody: customHtml,
      textBody: customText,
      category: "transactional",
      variables: ["member_name"],
      starterHash: null,
    });

    const result = await ensureRequiredEmailTemplates();
    expect(result.skippedCustomized).toContain(SLUG);
    expect(result.refreshed).not.toContain(SLUG);

    const [row] = await db
      .select()
      .from(emailTemplatesTable)
      .where(eq(emailTemplatesTable.slug, SLUG));
    expect(row.subject).toBe(customSubject);
    expect(row.htmlBody).toBe(customHtml);
    expect(row.textBody).toBe(customText);
    expect(row.starterHash).toBeNull();

    const versions = await db
      .select()
      .from(emailTemplateVersionsTable)
      .where(eq(emailTemplateVersionsTable.templateId, row.id));
    expect(versions).toHaveLength(0);
  });

  it("is a no-op for a tenant already on the new deep-link copy", async () => {
    const starter = getStarterEmailTemplate(SLUG)!;
    await db.insert(emailTemplatesTable).values({
      ...starter,
      starterHash: templateContentHash(starter),
    });

    const result = await ensureRequiredEmailTemplates();
    expect(result.refreshed).not.toContain(SLUG);
    expect(result.backfilled).not.toContain(SLUG);
    expect(result.inserted).not.toContain(SLUG);
    expect(result.skippedCustomized).not.toContain(SLUG);

    const [row] = await db
      .select()
      .from(emailTemplatesTable)
      .where(eq(emailTemplatesTable.slug, SLUG));
    expect(row.starterHash).toBe(templateContentHash(starter));
    expect(row.htmlBody).toContain("Start a new email change");
  });
});
