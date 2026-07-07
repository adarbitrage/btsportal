import { describe, it, expect, afterAll } from "vitest";
import {
  db,
  aiSourceDocumentsTable,
  kbCallScreeningsTable,
  kbScreenedExchangesTable,
} from "@workspace/db";
import { inArray } from "drizzle-orm";
import {
  resolveSourceContentForSynthesis,
  getScreenerState,
} from "../lib/kb-value-screener";

const RAW = "Coach: full raw transcript with chatter and teaching mixed together.";

const createdSourceIds: number[] = [];

async function makeSource(title: string): Promise<number> {
  const [row] = await db
    .insert(aiSourceDocumentsTable)
    .values({
      title: `[test-1733] ${title}`,
      content: RAW,
      sourceType: "group_coaching",
      authorityRole: "strategic_coach",
    })
    .returning({ id: aiSourceDocumentsTable.id });
  createdSourceIds.push(row!.id);
  return row!.id;
}

async function makeScreening(sourceDocId: number): Promise<number> {
  const [row] = await db
    .insert(kbCallScreeningsTable)
    .values({
      sourceDocId,
      contentFingerprint: "fp-test",
      normalizedHash: `nh-test-${sourceDocId}`,
      dedupStatus: "unique",
      exchangeCount: 0,
    })
    .returning({ id: kbCallScreeningsTable.id });
  return row!.id;
}

afterAll(async () => {
  if (createdSourceIds.length > 0) {
    // Screenings + exchanges cascade-delete with their source.
    await db.delete(aiSourceDocumentsTable).where(inArray(aiSourceDocumentsTable.id, createdSourceIds));
  }
});

describe("resolveSourceContentForSynthesis (the screened-content seam)", () => {
  it("returns raw content when no screening exists", async () => {
    const id = await makeSource("unscreened");
    const r = await resolveSourceContentForSynthesis(id, RAW);
    expect(r.screened).toBe(false);
    expect(r.content).toBe(RAW);
  });

  it("returns raw content for a zero-kept (all-error) screening", async () => {
    const id = await makeSource("all-error");
    const screeningId = await makeScreening(id);
    await db.insert(kbScreenedExchangesTable).values([
      { screeningId, sourceDocId: id, orderIndex: 0, passage: "segment one", disposition: "error" },
      { screeningId, sourceDocId: id, orderIndex: 1, passage: "segment two", disposition: "drop" },
    ]);
    const r = await resolveSourceContentForSynthesis(id, RAW);
    expect(r.screened).toBe(false);
    expect(r.content).toBe(RAW);
  });

  it("returns raw content when kept segments have empty passage text", async () => {
    const id = await makeSource("empty-passage");
    const screeningId = await makeScreening(id);
    await db.insert(kbScreenedExchangesTable).values([
      { screeningId, sourceDocId: id, orderIndex: 0, passage: "", disposition: "keep" },
      { screeningId, sourceDocId: id, orderIndex: 1, passage: "   ", disposition: "keep" },
    ]);
    const r = await resolveSourceContentForSynthesis(id, RAW);
    expect(r.screened).toBe(false);
    expect(r.content).toBe(RAW);
  });

  it("returns the kept-segments representation for a valid screening (excludes drop/flag/error)", async () => {
    const id = await makeSource("valid");
    const screeningId = await makeScreening(id);
    await db.insert(kbScreenedExchangesTable).values([
      { screeningId, sourceDocId: id, orderIndex: 0, passage: "Kept teaching A.", disposition: "keep" },
      { screeningId, sourceDocId: id, orderIndex: 1, passage: "Dropped chatter.", disposition: "drop" },
      { screeningId, sourceDocId: id, orderIndex: 2, passage: "Flagged bit.", disposition: "flag" },
      { screeningId, sourceDocId: id, orderIndex: 3, passage: "Errored bit.", disposition: "error" },
      {
        screeningId,
        sourceDocId: id,
        orderIndex: 4,
        passage: "Kept teaching B.",
        anchorQuestion: "How do I scale?",
        disposition: "keep",
      },
    ]);
    const r = await resolveSourceContentForSynthesis(id, RAW);
    expect(r.screened).toBe(true);
    expect(r.content).toContain("Kept teaching A.");
    expect(r.content).toContain("[Anchor question] How do I scale?");
    expect(r.content).toContain("Kept teaching B.");
    expect(r.content).not.toContain("Dropped chatter.");
    expect(r.content).not.toContain("Flagged bit.");
    expect(r.content).not.toContain("Errored bit.");
    expect(r.content).not.toBe(RAW);
  });

  it("honors an admin overrule (drop -> keep wins; keep -> drop excluded)", async () => {
    const id = await makeSource("overrides");
    const screeningId = await makeScreening(id);
    await db.insert(kbScreenedExchangesTable).values([
      {
        screeningId,
        sourceDocId: id,
        orderIndex: 0,
        passage: "AI dropped, admin kept.",
        disposition: "drop",
        overrideDisposition: "keep",
      },
      {
        screeningId,
        sourceDocId: id,
        orderIndex: 1,
        passage: "AI kept, admin dropped.",
        disposition: "keep",
        overrideDisposition: "drop",
      },
    ]);
    const r = await resolveSourceContentForSynthesis(id, RAW);
    expect(r.screened).toBe(true);
    expect(r.content).toContain("AI dropped, admin kept.");
    expect(r.content).not.toContain("AI kept, admin dropped.");
  });
});

describe("screener progress state", () => {
  it("exposes currentSourceId (null when idle)", () => {
    const state = getScreenerState();
    expect(state).toHaveProperty("currentSourceId");
    if (!state.running) expect(state.currentSourceId).toBeNull();
  });
});
