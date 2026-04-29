import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { randomUUID } from "crypto";
import { db, emailTemplatesTable, emailTemplateVersionsTable } from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";

vi.mock("../lib/redis", () => ({
  getRedis: () => null,
  getRedisConnection: vi.fn(),
  createRedisConnection: vi.fn(),
  isRedisConnected: async () => false,
}));

import {
  ensureRequiredEmailTemplates,
  templateContentHash,
  type StarterEmailTemplate,
} from "../lib/seed-templates";

const TEST_TAG = `seed-test-${randomUUID().slice(0, 8)}`;

// Distinct slugs so this spec never collides with the production starter set.
const SLUG_INSERT = `${TEST_TAG}-insert`;
const SLUG_REFRESH = `${TEST_TAG}-refresh`;
const SLUG_BACKFILL = `${TEST_TAG}-backfill-current`;
const SLUG_BACKFILL_PRIOR = `${TEST_TAG}-backfill-prior`;
const SLUG_CUSTOMIZED = `${TEST_TAG}-customized`;

const ALL_SLUGS = [SLUG_INSERT, SLUG_REFRESH, SLUG_BACKFILL, SLUG_BACKFILL_PRIOR, SLUG_CUSTOMIZED];

function makeStarter(slug: string, suffix: string): StarterEmailTemplate {
  return {
    slug,
    name: `Test ${slug}`,
    subject: `Test subject ${suffix}`,
    htmlBody: `<p>Hello ${suffix}</p>`,
    textBody: `Hello ${suffix}`,
    category: "transactional",
    fromName: null,
    variables: [],
    active: true,
  } as StarterEmailTemplate;
}

const CURRENT_STARTERS: StarterEmailTemplate[] = [
  makeStarter(SLUG_INSERT, "v2-insert"),
  makeStarter(SLUG_REFRESH, "v2-refresh"),
  makeStarter(SLUG_BACKFILL, "v2-backfill"),
  makeStarter(SLUG_BACKFILL_PRIOR, "v2-backfill-prior"),
  makeStarter(SLUG_CUSTOMIZED, "v2-customized"),
];

const PRIOR_STARTERS: Record<string, StarterEmailTemplate[]> = {
  [SLUG_BACKFILL_PRIOR]: [makeStarter(SLUG_BACKFILL_PRIOR, "v1-backfill-prior")],
};

function starterFor(slug: string): StarterEmailTemplate {
  const t = CURRENT_STARTERS.find(x => x.slug === slug);
  if (!t) throw new Error(`No starter for ${slug}`);
  return t;
}

beforeAll(async () => {
  await db.delete(emailTemplatesTable).where(inArray(emailTemplatesTable.slug, ALL_SLUGS));
});

afterAll(async () => {
  // Clean rows + cascade-delete their version snapshots.
  const rows = await db
    .select({ id: emailTemplatesTable.id })
    .from(emailTemplatesTable)
    .where(inArray(emailTemplatesTable.slug, ALL_SLUGS));
  if (rows.length > 0) {
    const ids = rows.map(r => r.id);
    await db.delete(emailTemplateVersionsTable).where(inArray(emailTemplateVersionsTable.templateId, ids));
    await db.delete(emailTemplatesTable).where(inArray(emailTemplatesTable.id, ids));
  }
});

beforeEach(async () => {
  // Wipe between cases so each one starts from a known state.
  const rows = await db
    .select({ id: emailTemplatesTable.id })
    .from(emailTemplatesTable)
    .where(inArray(emailTemplatesTable.slug, ALL_SLUGS));
  if (rows.length > 0) {
    const ids = rows.map(r => r.id);
    await db.delete(emailTemplateVersionsTable).where(inArray(emailTemplateVersionsTable.templateId, ids));
    await db.delete(emailTemplatesTable).where(inArray(emailTemplatesTable.id, ids));
  }
});

describe("ensureRequiredEmailTemplates", () => {
  it("inserts missing templates with starter_hash populated", async () => {
    const result = await ensureRequiredEmailTemplates({
      templates: [starterFor(SLUG_INSERT)],
      requiredSlugs: [SLUG_INSERT],
      priorRevisions: PRIOR_STARTERS,
    });

    expect(result.inserted).toEqual([SLUG_INSERT]);
    const [row] = await db.select().from(emailTemplatesTable).where(eq(emailTemplatesTable.slug, SLUG_INSERT));
    expect(row).toBeDefined();
    expect(row.starterHash).toBe(templateContentHash(starterFor(SLUG_INSERT)));
    expect(row.subject).toBe(starterFor(SLUG_INSERT).subject);
  });

  it("refreshes rows whose starter_hash points at older starter copy", async () => {
    const oldStarter = makeStarter(SLUG_REFRESH, "v1-refresh");
    await db.insert(emailTemplatesTable).values({
      ...oldStarter,
      starterHash: templateContentHash(oldStarter),
    });

    const result = await ensureRequiredEmailTemplates({
      templates: [starterFor(SLUG_REFRESH)],
      requiredSlugs: [SLUG_REFRESH],
      priorRevisions: PRIOR_STARTERS,
    });

    expect(result.refreshed).toEqual([SLUG_REFRESH]);
    const [row] = await db.select().from(emailTemplatesTable).where(eq(emailTemplatesTable.slug, SLUG_REFRESH));
    expect(row.subject).toBe(starterFor(SLUG_REFRESH).subject);
    expect(row.starterHash).toBe(templateContentHash(starterFor(SLUG_REFRESH)));

    // A snapshot of the old copy should have been written for rollback.
    const versions = await db
      .select()
      .from(emailTemplateVersionsTable)
      .where(eq(emailTemplateVersionsTable.templateId, row.id));
    expect(versions).toHaveLength(1);
    expect(versions[0].subject).toBe(oldStarter.subject);
  });

  it("backfills NULL starter_hash + stamps when row content already matches current starter", async () => {
    // Legacy row: content matches the *current* starter exactly, but no
    // starter_hash was ever recorded.
    const current = starterFor(SLUG_BACKFILL);
    await db.insert(emailTemplatesTable).values({ ...current, starterHash: null });

    const result = await ensureRequiredEmailTemplates({
      templates: [current],
      requiredSlugs: [SLUG_BACKFILL],
      priorRevisions: PRIOR_STARTERS,
    });

    expect(result.backfilled).toEqual([SLUG_BACKFILL]);
    const [row] = await db.select().from(emailTemplatesTable).where(eq(emailTemplatesTable.slug, SLUG_BACKFILL));
    expect(row.starterHash).toBe(templateContentHash(current));

    // No version snapshot needed because content didn't change.
    const versions = await db
      .select()
      .from(emailTemplateVersionsTable)
      .where(eq(emailTemplateVersionsTable.templateId, row.id));
    expect(versions).toHaveLength(0);
  });

  it("refreshes NULL starter_hash rows whose content matches a prior starter fingerprint", async () => {
    // Legacy row carrying *older* starter copy (the one captured in
    // priorRevisions). Should be detected as untouched and refreshed.
    const prior = PRIOR_STARTERS[SLUG_BACKFILL_PRIOR][0];
    await db.insert(emailTemplatesTable).values({ ...prior, starterHash: null });

    const result = await ensureRequiredEmailTemplates({
      templates: [starterFor(SLUG_BACKFILL_PRIOR)],
      requiredSlugs: [SLUG_BACKFILL_PRIOR],
      priorRevisions: PRIOR_STARTERS,
    });

    expect(result.refreshed).toEqual([SLUG_BACKFILL_PRIOR]);
    const [row] = await db.select().from(emailTemplatesTable).where(eq(emailTemplatesTable.slug, SLUG_BACKFILL_PRIOR));
    expect(row.subject).toBe(starterFor(SLUG_BACKFILL_PRIOR).subject);
    expect(row.starterHash).toBe(templateContentHash(starterFor(SLUG_BACKFILL_PRIOR)));

    // Snapshot of the prior starter copy should be retained.
    const versions = await db
      .select()
      .from(emailTemplateVersionsTable)
      .where(eq(emailTemplateVersionsTable.templateId, row.id));
    expect(versions).toHaveLength(1);
    expect(versions[0].subject).toBe(prior.subject);
  });

  it("never overwrites admin-customized rows (NULL hash + unrecognized content)", async () => {
    await db.insert(emailTemplatesTable).values({
      slug: SLUG_CUSTOMIZED,
      name: "Admin-edited name",
      subject: "Admin-edited subject",
      htmlBody: "<p>admin html</p>",
      textBody: "admin text",
      category: "transactional",
      starterHash: null,
    });

    const result = await ensureRequiredEmailTemplates({
      templates: [starterFor(SLUG_CUSTOMIZED)],
      requiredSlugs: [SLUG_CUSTOMIZED],
      priorRevisions: PRIOR_STARTERS,
    });

    expect(result.skippedCustomized).toEqual([SLUG_CUSTOMIZED]);
    expect(result.refreshed).not.toContain(SLUG_CUSTOMIZED);

    const [row] = await db.select().from(emailTemplatesTable).where(eq(emailTemplatesTable.slug, SLUG_CUSTOMIZED));
    expect(row.subject).toBe("Admin-edited subject");
    expect(row.htmlBody).toBe("<p>admin html</p>");
    expect(row.starterHash).toBeNull();
  });

  it("is idempotent when all rows already match the current starter copy", async () => {
    const current = starterFor(SLUG_INSERT);
    await db.insert(emailTemplatesTable).values({
      ...current,
      starterHash: templateContentHash(current),
    });

    const result = await ensureRequiredEmailTemplates({
      templates: [current],
      requiredSlugs: [SLUG_INSERT],
      priorRevisions: PRIOR_STARTERS,
    });

    expect(result.inserted).toEqual([]);
    expect(result.refreshed).toEqual([]);
    expect(result.backfilled).toEqual([]);
    expect(result.skippedCustomized).toEqual([]);
  });
});
