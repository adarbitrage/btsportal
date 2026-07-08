import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { db } from "@workspace/db";
import { kbNavGapFlagsTable, aiLiveDocumentsTable } from "@workspace/db/schema";
import { eq, and, like } from "drizzle-orm";
import {
  recordNavGapsForNode,
  resolveNavGapsForPublishedDoc,
  dismissNavGapFlag,
  listNavGapFlags,
  mergeNavGapFlags,
  navDocCrossLinksMarkdown,
} from "../lib/kb-nav-gaps";

// Action-verb-gated text that reliably trips the Flexy detector.
const FLEXY_TEXT =
  "Next you go into Flexy and click the campaigns tab, then set up your first campaign and fill in the budget.";

const TEST_TITLE_PREFIX = "NAVGAP-TEST-";

async function cleanup() {
  await db.delete(kbNavGapFlagsTable).where(eq(kbNavGapFlagsTable.app, "flexy"));
  await db.delete(aiLiveDocumentsTable).where(like(aiLiveDocumentsTable.title, `${TEST_TITLE_PREFIX}%`));
}

describe("kb-nav-gaps lifecycle", () => {
  beforeEach(cleanup);
  afterAll(cleanup);

  it("upserts one row per (app, area) and dedupes topic nodes across runs", async () => {
    await recordNavGapsForNode("node-a", [FLEXY_TEXT]);
    await recordNavGapsForNode("node-b", [FLEXY_TEXT]);
    await recordNavGapsForNode("node-a", [FLEXY_TEXT]); // repeat run — no dup node

    const rows = await db.select().from(kbNavGapFlagsTable).where(eq(kbNavGapFlagsTable.app, "flexy"));
    expect(rows.length).toBe(1);
    expect(rows[0].status).toBe("open");
    expect(rows[0].topicCount).toBe(2);
    expect(new Set(rows[0].topicNodes as string[])).toEqual(new Set(["node-a", "node-b"]));
  });

  it("dismissal is sticky — later runs never re-open or touch the row", async () => {
    await recordNavGapsForNode("node-a", [FLEXY_TEXT]);
    const [flag] = await db.select().from(kbNavGapFlagsTable).where(eq(kbNavGapFlagsTable.app, "flexy"));
    await dismissNavGapFlag(flag.id, 1);

    await recordNavGapsForNode("node-z", [FLEXY_TEXT]);

    const [after] = await db.select().from(kbNavGapFlagsTable).where(eq(kbNavGapFlagsTable.id, flag.id));
    expect(after.status).toBe("dismissed");
    expect(after.topicNodes as string[]).not.toContain("node-z");
  });

  it("publishing a covering nav doc auto-resolves the open flag and suppresses new ones", async () => {
    await recordNavGapsForNode("node-a", [FLEXY_TEXT]);
    const [flag] = await db.select().from(kbNavGapFlagsTable).where(eq(kbNavGapFlagsTable.app, "flexy"));
    expect(flag.status).toBe("open");

    const [liveDoc] = await db
      .insert(aiLiveDocumentsTable)
      .values({
        title: `${TEST_TITLE_PREFIX}Flexy walkthrough`,
        content: "Step 1…",
        category: "Navigation",
        docClass: "navigation",
        navApp: "flexy",
        navArea: "general",
        lastVerified: new Date(),
      })
      .returning();

    const resolved = await resolveNavGapsForPublishedDoc({ id: liveDoc.id, navApp: "flexy", navArea: "general" });
    expect(resolved).toBe(1);

    const [after] = await db.select().from(kbNavGapFlagsTable).where(eq(kbNavGapFlagsTable.id, flag.id));
    expect(after.status).toBe("resolved");
    expect(after.resolvedByDocId).toBe(liveDoc.id);

    // With a live general-area doc, new detections are suppressed entirely.
    await recordNavGapsForNode("node-new", [FLEXY_TEXT]);
    const [still] = await db.select().from(kbNavGapFlagsTable).where(eq(kbNavGapFlagsTable.id, flag.id));
    expect(still.status).toBe("resolved");
    expect(still.topicNodes as string[]).not.toContain("node-new");
  });

  it("merges duplicate areas within an app", async () => {
    await db.insert(kbNavGapFlagsTable).values([
      { app: "flexy", area: "campaign setup", status: "open", tier: 1, topicNodes: ["n1", "n2"], topicCount: 2 },
      { app: "flexy", area: "campaign set-up", status: "open", tier: 1, topicNodes: ["n2", "n3"], topicCount: 2 },
    ]);
    const rows = await db.select().from(kbNavGapFlagsTable).where(eq(kbNavGapFlagsTable.app, "flexy"));
    const source = rows.find((r) => r.area === "campaign set-up")!;
    const target = rows.find((r) => r.area === "campaign setup")!;

    const merged = await mergeNavGapFlags(source.id, target.id);
    expect(merged?.topicCount).toBe(3);

    const after = await db.select().from(kbNavGapFlagsTable).where(eq(kbNavGapFlagsTable.app, "flexy"));
    expect(after.length).toBe(1);
  });

  it("navDocCrossLinksMarkdown links referenced apps to published nav docs, empty otherwise", async () => {
    // No published nav doc yet → no cross-link section.
    expect(await navDocCrossLinksMarkdown([FLEXY_TEXT])).toBe("");
    // Text without app references → empty even with docs published.
    const [liveDoc] = await db
      .insert(aiLiveDocumentsTable)
      .values({
        title: `${TEST_TITLE_PREFIX}How to set up a campaign in Flexy`,
        content: "Step 1…",
        category: "Navigation",
        docClass: "navigation",
        navApp: "flexy",
        navArea: "campaign setup",
        lastVerified: new Date(),
      })
      .returning();
    expect(await navDocCrossLinksMarkdown(["Just a chat about mindset and consistency."])).toBe("");

    const md = await navDocCrossLinksMarkdown([FLEXY_TEXT]);
    expect(md).toContain("## Step-by-step navigation guides");
    expect(md).toContain(liveDoc.title);
  });

  it("listNavGapFlags hides closed rows by default", async () => {
    await db.insert(kbNavGapFlagsTable).values([
      { app: "flexy", area: "a1", status: "open", tier: 1, topicNodes: [], topicCount: 0 },
      { app: "flexy", area: "a2", status: "dismissed", tier: 1, topicNodes: [], topicCount: 0 },
    ]);
    const open = await listNavGapFlags({ app: "flexy" });
    expect(open.map((f) => f.area)).toEqual(["a1"]);
    const all = await listNavGapFlags({ app: "flexy", includeClosed: true });
    expect(all.length).toBe(2);
  });
});
