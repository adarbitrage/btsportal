import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { db, resourceHubItemsTable } from "@workspace/db";
import { inArray } from "drizzle-orm";
import { ensureResourceHubCuration, GROUP_REPARENT, CURATION_SPEC } from "../lib/resource-hub-setup";

// Task #2039: the Campaign Toolkit / Tracking & Templates group cards. This
// suite locks in the one-time re-parenting rules of the curation boot hook:
//   - environments seeded BEFORE the groups existed have the six items at the
//     section root; when the boot hook creates a group row, it pulls that
//     group's still-ungrouped children under it;
//   - the move is gated on the group's creation, so once the group exists the
//     block is a permanent no-op — admin edits (including deliberately
//     un-grouping an item, or custom parenting) are never clobbered;
//   - fresh-env seed definitions already carry the group parentage.

const GROUP_SLUGS = GROUP_REPARENT.map((g) => g.groupSlug);
const CHILD_SLUGS = GROUP_REPARENT.flatMap((g) => [...g.childSlugs]);
const ALL_SLUGS = [...GROUP_SLUGS, ...CHILD_SLUGS];

async function wipe() {
  await db.delete(resourceHubItemsTable).where(inArray(resourceHubItemsTable.slug, ALL_SLUGS));
}

async function rowsBySlug() {
  const rows = await db
    .select()
    .from(resourceHubItemsTable)
    .where(inArray(resourceHubItemsTable.slug, ALL_SLUGS));
  return new Map(rows.map((r) => [r.slug, r]));
}

/** Insert the six legacy root-level items the way pre-#2039 envs held them. */
async function seedLegacyChildren() {
  await db.insert(resourceHubItemsTable).values([
    { slug: "wd-campaign-checklist", section: "working_documents", kind: "file", displayTitle: "Campaign Checklist (admin-renamed)", sortOrder: 1 },
    { slug: "wd-power-word-dictionary", section: "working_documents", kind: "file", displayTitle: "Power Word Dictionary", sortOrder: 2 },
    { slug: "wd-context-word-dictionary", section: "working_documents", kind: "file", displayTitle: "Context Word Dictionary", sortOrder: 3 },
    { slug: "wd-one-sentence-persuasion", section: "working_documents", kind: "file", displayTitle: "The One-Sentence Persuasion Course", sortOrder: 4 },
    { slug: "ta-pnl-tracker", section: "templates_assets", kind: "external", externalUrl: "https://example.com/pnl", displayTitle: "P&L Tracker", sortOrder: 1 },
    { slug: "ta-dedicated-email-template", section: "templates_assets", kind: "external", externalUrl: "https://example.com/email", displayTitle: "Dedicated Email Template", sortOrder: 2 },
  ]);
}

describe("Resource Hub group re-parenting (Task #2039)", () => {
  beforeEach(wipe);
  afterAll(async () => {
    // Restore the shared dev DB to the seeded end-state.
    await wipe();
    await ensureResourceHubCuration();
  });

  it("spec: the six items are declared as children of the two new groups", () => {
    const bySlug = new Map(CURATION_SPEC.map((i) => [i.slug, i]));
    const toolkit = bySlug.get("wd-campaign-toolkit");
    const tracking = bySlug.get("ta-tracking-templates");
    expect(toolkit?.kind).toBe("group");
    expect(toolkit?.displayTitle).toBe("Campaign Toolkit");
    expect(tracking?.kind).toBe("group");
    expect(tracking?.displayTitle).toBe("Tracking & Templates");
    // The blurb must explicitly mention the P&L tracker (spec requirement).
    expect(tracking?.blurb.toLowerCase()).toContain("p&l tracker");
    for (const { groupSlug, childSlugs } of GROUP_REPARENT) {
      for (const child of childSlugs) {
        expect(bySlug.get(child)?.parentSlug).toBe(groupSlug);
      }
    }
  });

  it("creates the groups and re-parents pre-existing root-level items (admin titles preserved)", async () => {
    await seedLegacyChildren();

    await ensureResourceHubCuration();

    const bySlug = await rowsBySlug();
    const toolkit = bySlug.get("wd-campaign-toolkit")!;
    const tracking = bySlug.get("ta-tracking-templates")!;
    expect(toolkit.kind).toBe("group");
    expect(tracking.kind).toBe("group");

    for (const child of GROUP_REPARENT[0].childSlugs) {
      expect(bySlug.get(child)?.parentId).toBe(toolkit.id);
    }
    for (const child of GROUP_REPARENT[1].childSlugs) {
      expect(bySlug.get(child)?.parentId).toBe(tracking.id);
    }
    // Existing rows are never overwritten — the admin-edited title survives.
    expect(bySlug.get("wd-campaign-checklist")?.displayTitle).toBe("Campaign Checklist (admin-renamed)");
    expect(bySlug.get("ta-pnl-tracker")?.externalUrl).toBe("https://example.com/pnl");
  });

  it("is a permanent no-op once the groups exist — an admin un-grouping sticks", async () => {
    await seedLegacyChildren();
    await ensureResourceHubCuration();

    // Admin deliberately pulls one item back to the section root.
    await db
      .update(resourceHubItemsTable)
      .set({ parentId: null })
      .where(inArray(resourceHubItemsTable.slug, ["wd-power-word-dictionary"]));

    await ensureResourceHubCuration();

    const bySlug = await rowsBySlug();
    expect(bySlug.get("wd-power-word-dictionary")?.parentId).toBeNull();
  });

  it("never touches a child an admin already parented elsewhere", async () => {
    // Simulate a pre-#2039 env where an admin already grouped the P&L tracker
    // under a custom group of their own.
    const [customGroup] = await db
      .insert(resourceHubItemsTable)
      .values({ slug: "wd-campaign-toolkit-custom-test", section: "templates_assets", kind: "group", displayTitle: "Admin Custom Group", sortOrder: 9 })
      .returning();
    try {
      await seedLegacyChildren();
      await db
        .update(resourceHubItemsTable)
        .set({ parentId: customGroup.id })
        .where(inArray(resourceHubItemsTable.slug, ["ta-pnl-tracker"]));

      await ensureResourceHubCuration();

      const bySlug = await rowsBySlug();
      expect(bySlug.get("ta-pnl-tracker")?.parentId).toBe(customGroup.id);
      // Its sibling (still root-level) did get pulled under the new group.
      expect(bySlug.get("ta-dedicated-email-template")?.parentId).toBe(
        bySlug.get("ta-tracking-templates")?.id,
      );
    } finally {
      await db
        .delete(resourceHubItemsTable)
        .where(inArray(resourceHubItemsTable.slug, ["wd-campaign-toolkit-custom-test"]));
    }
  });
});
