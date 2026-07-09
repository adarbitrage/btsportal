/**
 * Stale-navigation sweep + expanded crosswalk (Task #1808):
 *  - new crosswalk entries ("BTS Software", "Compliance Form") are caught by
 *    the deterministic screen,
 *  - the atomic-definition ("What is X?") prompt carries the navigation
 *    grounding section,
 *  - the sweep's LLM-audit pieces are idempotent and its prompt excludes
 *    in-tool and external-site navigation,
 *  - the DB sweep itself is idempotent (mocked LLM, fixture draft).
 */

import { describe, it, expect, afterAll } from "vitest";
import { db } from "@workspace/db";
import { kbStagingDocsTable } from "@workspace/db/schema";
import { eq, inArray } from "drizzle-orm";
import {
  NAV_CONFLICT_MARKER,
  screenDraftForLegacyNavigation,
  applyNavigationScreen,
} from "../lib/kb-nav-grounding";
import {
  buildNavAuditSystemPrompt,
  stripNavConflictCallouts,
  parseNavAuditFindings,
  applyNavAuditFindings,
  auditDraftNavigation,
  sweepStaleNavigation,
  type NavAuditFinding,
} from "../lib/kb-nav-sweep";
import { buildAtomicDefinitionSystemPrompt } from "../lib/kb-synthesis";
import { LEGACY_CROSSWALK } from "../lib/kb-legacy-crosswalk";

describe("expanded crosswalk entries", () => {
  it("BTS Software maps (confirmed) to Apps (/apps)", () => {
    const entry = LEGACY_CROSSWALK.find((e) => e.legacy.includes("BTS Software"));
    expect(entry?.kind).toBe("location");
    expect(entry?.confidence).toBe("confirmed");
    expect(entry?.current).toContain("/apps");
  });

  it("Compliance Form maps (confirmed) to Compliance Review (/compliance)", () => {
    const entry = LEGACY_CROSSWALK.find((e) => e.legacy.includes("Compliance Form"));
    expect(entry?.kind).toBe("location");
    expect(entry?.confidence).toBe("confirmed");
    expect(entry?.current).toContain("/compliance");
  });

  it("the deterministic screen catches 'Resources > BTS Software' (staging doc #1333 phrasing)", () => {
    const draft = "You can find MetricMover under Resources > BTS Software in the portal.";
    const phrases = screenDraftForLegacyNavigation(draft).map((m) => m.phrase.toLowerCase());
    expect(phrases).toContain("bts software");
    const out = applyNavigationScreen(draft);
    expect(out).toContain(NAV_CONFLICT_MARKER);
    expect(out).toContain("/apps");
  });

  it("the deterministic screen catches 'Resources > Compliance Form' (staging doc #1332 phrasing)", () => {
    const out = applyNavigationScreen("Submit them to Resources > Compliance Form before running ads.");
    expect(out).toContain(NAV_CONFLICT_MARKER);
    expect(out).toContain("/compliance");
  });
});

describe("atomic-definition prompt navigation grounding", () => {
  const prompt = buildAtomicDefinitionSystemPrompt();

  it("contains the navigation grounding section and rules", () => {
    expect(prompt).toContain("NAVIGATION GROUNDING");
    expect(prompt).toContain("NAVIGATION RULES");
    expect(prompt).toContain("never repeat an old location name as if it still exists");
  });

  it("carries the current map (Apps page) and the confirmed BTS Software rewrite", () => {
    expect(prompt).toContain("/apps");
    expect(prompt).toContain("BTS Software");
  });
});

describe("LLM navigation audit (pure pieces)", () => {
  it("audit prompt carries the current map and the in-tool/external exclusions", () => {
    const sys = buildNavAuditSystemPrompt();
    expect(sys).toContain("/blitz");
    expect(sys).toContain("DIYTrax > Offer Pages");
    expect(sys).toContain("Flexy > Media Storage");
    expect(sys).toContain("ClickBank");
    expect(sys).toContain("Media Mavens");
    expect(sys).toContain("never flag");
  });

  it("existing callouts are stripped before auditing (LLM never sees them)", async () => {
    const body = `Some content.\n\n${NAV_CONFLICT_MARKER} draft still references the legacy portal location "BTS Software" — fix it.`;
    expect(stripNavConflictCallouts(body)).not.toContain("NAVIGATION CONFLICT");
    let seenUser = "";
    await auditDraftNavigation(body, async (_s, u) => {
      seenUser = u;
      return '{"findings":[]}';
    });
    expect(seenUser).not.toContain("NAVIGATION CONFLICT");
  });

  it("parses findings and drops malformed entries", () => {
    const raw = JSON.stringify({
      findings: [
        { claim: "Resources > Old Page", issue: "No such section; use Apps (/apps)." },
        { claim: "", issue: "empty" },
        { bogus: true },
      ],
    });
    expect(parseNavAuditFindings(raw)).toEqual([
      { claim: "Resources > Old Page", issue: "No such section; use Apps (/apps)." },
    ]);
  });

  it("appends a reviewer callout per distinct claim and is idempotent", () => {
    const findings: NavAuditFinding[] = [
      { claim: "Members Area > Downloads", issue: "That section no longer exists; use Resource Library (/resource-library)." },
      { claim: "Members Area > Downloads", issue: "duplicate" },
    ];
    const once = applyNavAuditFindings("Go to Members Area > Downloads.", findings);
    const markers = once.split("\n").filter((l) => l.includes(NAV_CONFLICT_MARKER));
    expect(markers).toHaveLength(1);
    expect(once).toContain('navigation claim "Members Area > Downloads"');
    // Re-applying the same findings never re-flags.
    expect(applyNavAuditFindings(once, findings)).toBe(once);
  });
});

describe("sweepStaleNavigation (DB, mocked LLM)", () => {
  const fixtureTitle = `[test-1808] What is MetricMover? ${Date.now()}`;
  const fixtureIds: number[] = [];

  afterAll(async () => {
    if (fixtureIds.length > 0) {
      await db.delete(kbStagingDocsTable).where(inArray(kbStagingDocsTable.id, fixtureIds));
    }
  });

  it("flags stale navigation once, appends only callouts, and is idempotent on re-run", async () => {
    const originalBody =
      "MetricMover is a split-testing app. Find it under Resources > BTS Software. " +
      "Inside DIYTrax > Offer Pages you configure offers; payouts show in your ClickBank dashboard.";
    const [row] = await db
      .insert(kbStagingDocsTable)
      .values({
        title: fixtureTitle,
        content: originalBody,
        category: "concepts",
        docType: "truth_draft",
        originType: "ai_synthesized",
        status: "needs_review",
      })
      .returning({ id: kbStagingDocsTable.id });
    fixtureIds.push(row.id);

    // Mock LLM: flags one genuinely-stale claim; per the prompt contract it
    // ignores DIYTrax-internal and ClickBank navigation.
    const llmCalls: string[] = [];
    const mockLlm = async (_system: string, user: string) => {
      llmCalls.push(user);
      if (user.includes("old members hub")) {
        return JSON.stringify({
          findings: [{ claim: "old members hub", issue: "No such area; the home dashboard is Welcome (/)." }],
        });
      }
      return JSON.stringify({ findings: [] });
    };

    const first = await sweepStaleNavigation(mockLlm, () => {}, fixtureIds);
    expect(first.docsScanned).toBeGreaterThanOrEqual(1);
    expect(first.llmErrors).toBe(0);
    expect(first.deterministicPhrases.map((p) => p.toLowerCase())).toContain("bts software");

    const [after1] = await db
      .select({ content: kbStagingDocsTable.content })
      .from(kbStagingDocsTable)
      .where(eq(kbStagingDocsTable.id, row.id));
    // Original prose untouched; callout appended (reviewer gate absolute).
    expect(after1.content.startsWith(originalBody)).toBe(true);
    expect(after1.content).toContain(NAV_CONFLICT_MARKER);
    expect(after1.content).toContain('"BTS Software"');
    // In-tool/external navigation not flagged deterministically.
    expect(after1.content).not.toContain('"DIYTrax');
    expect(after1.content).not.toContain('"ClickBank"');

    // Re-run: nothing new for the fixture — its content must be unchanged.
    await sweepStaleNavigation(mockLlm, () => {}, fixtureIds);
    const [after2] = await db
      .select({ content: kbStagingDocsTable.content })
      .from(kbStagingDocsTable)
      .where(eq(kbStagingDocsTable.id, row.id));
    expect(after2.content).toBe(after1.content);
  }, 60000);

  it("LLM findings append callouts and never re-flag on a second pass", async () => {
    const body = "Head to the old members hub to see your dashboard.";
    const [row] = await db
      .insert(kbStagingDocsTable)
      .values({
        title: `${fixtureTitle} llm`,
        content: body,
        category: "concepts",
        docType: "truth_draft",
        originType: "ai_synthesized",
        status: "needs_review",
      })
      .returning({ id: kbStagingDocsTable.id });
    fixtureIds.push(row.id);

    const mockLlm = async (_system: string, user: string) =>
      user.includes("old members hub")
        ? JSON.stringify({ findings: [{ claim: "old members hub", issue: "No such area; the home dashboard is Welcome (/)." }] })
        : JSON.stringify({ findings: [] });

    await sweepStaleNavigation(mockLlm, () => {}, fixtureIds);
    const [after1] = await db
      .select({ content: kbStagingDocsTable.content })
      .from(kbStagingDocsTable)
      .where(eq(kbStagingDocsTable.id, row.id));
    expect(after1.content).toContain('navigation claim "old members hub"');

    await sweepStaleNavigation(mockLlm, () => {}, fixtureIds);
    const [after2] = await db
      .select({ content: kbStagingDocsTable.content })
      .from(kbStagingDocsTable)
      .where(eq(kbStagingDocsTable.id, row.id));
    expect(after2.content).toBe(after1.content);
  }, 60000);
});
