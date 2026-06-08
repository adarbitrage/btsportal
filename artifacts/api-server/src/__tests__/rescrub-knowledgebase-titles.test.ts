import { describe, it, expect, afterEach } from "vitest";
import { randomUUID } from "crypto";
import { db, knowledgebaseDocsTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

import {
  rescrubKnowledgebaseDocs,
  findUnscrubbedTitles,
} from "../scripts/rescrub-knowledgebase-docs";

/**
 * Pin the automatic title-scrub in the post-merge re-scrub script.
 *
 * Titles carry a UNIQUE constraint, so a coach surname in a title used to be
 * detected by the leak guard but fixed by hand (scrubbing two titles could
 * collide them). The re-scrub script now cleans titles too, de-duplicating
 * with a numeric suffix on collision so the UNIQUE constraint is never
 * violated. These tests prove:
 *   - a surname in a title is removed automatically,
 *   - a collision produced by scrubbing is resolved (no constraint error),
 *   - re-running is idempotent (zero further writes).
 */

const TAG = `rescrub-title-${randomUUID().slice(0, 8)}`;
const createdIds: number[] = [];

afterEach(async () => {
  if (createdIds.length > 0) {
    await db
      .delete(knowledgebaseDocsTable)
      .where(inArray(knowledgebaseDocsTable.id, createdIds));
    createdIds.length = 0;
  }
});

async function seed(title: string, content = "Clean body."): Promise<number> {
  const [row] = await db
    .insert(knowledgebaseDocsTable)
    .values({ title, category: "faq", content })
    .returning({ id: knowledgebaseDocsTable.id });
  createdIds.push(row.id);
  return row.id;
}

async function titleOf(id: number): Promise<string> {
  const [row] = await db
    .select({ title: knowledgebaseDocsTable.title })
    .from(knowledgebaseDocsTable)
    .where(eq(knowledgebaseDocsTable.id, id));
  return row.title;
}

describe("rescrub knowledgebase_docs titles", () => {
  it("scrubs a coach surname out of a title automatically", async () => {
    const id = await seed(`${TAG} Bruce Clark playbook`);

    await rescrubKnowledgebaseDocs();

    const title = await titleOf(id);
    expect(title).toContain("Bruce");
    expect(title).not.toContain("Clark");
  });

  it("de-duplicates with a suffix when a scrubbed title collides", async () => {
    // Both rows scrub to "<TAG> Bruce guide" -> would violate UNIQUE.
    const a = await seed(`${TAG} Bruce Clark guide`);
    const b = await seed(`${TAG} Bruce guide`); // already the scrubbed form

    await rescrubKnowledgebaseDocs();

    const titleA = await titleOf(a);
    const titleB = await titleOf(b);

    // The pre-scrubbed row keeps its title; the colliding one is suffixed.
    expect(titleB).toBe(`${TAG} Bruce guide`);
    expect(titleA).toBe(`${TAG} Bruce guide (2)`);
    expect(titleA).not.toContain("Clark");
    // Distinct titles => UNIQUE constraint held.
    expect(titleA).not.toBe(titleB);
  });

  it("is idempotent: a second run makes zero further writes", async () => {
    await seed(`${TAG} Bruce Clark idempotent`);
    await seed(`${TAG} Todd Rupp notes`, "Reach Todd Rupp for help.");

    const first = await rescrubKnowledgebaseDocs();
    expect(first.contentUpdated + first.titleUpdated).toBeGreaterThan(0);

    const second = await rescrubKnowledgebaseDocs();
    expect(second.contentUpdated).toBe(0);
    expect(second.titleUpdated).toBe(0);
  });

  it("is a no-op when nothing needs cleaning", async () => {
    await seed(`${TAG} totally clean entry`, "Nothing forbidden here.");

    const result = await rescrubKnowledgebaseDocs();
    expect(result.contentUpdated).toBe(0);
    expect(result.titleUpdated).toBe(0);
  });

  it("findUnscrubbedTitles confirms titles are clean after a re-scrub", async () => {
    const dirty = await seed(`${TAG} Bruce Clark verify`);

    // Before the re-scrub the dirty title is reported as a leak.
    const before = await findUnscrubbedTitles();
    expect(before.some((l) => l.id === dirty)).toBe(true);

    await rescrubKnowledgebaseDocs();

    // After the re-scrub the one-time check reports zero leaks for our rows.
    const after = await findUnscrubbedTitles();
    expect(after.some((l) => createdIds.includes(l.id))).toBe(false);
  });
});
