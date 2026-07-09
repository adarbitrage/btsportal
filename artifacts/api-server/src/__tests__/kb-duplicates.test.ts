import { describe, it, expect } from "vitest";
import {
  normalizeConceptTitle,
  conceptKeys,
  contentSimilarity,
  clusterDuplicates,
  findLiveSimilar,
} from "../lib/kb-duplicates";

describe("normalizeConceptTitle", () => {
  it("strips the 'What is …?' wrapper, punctuation and case", () => {
    expect(normalizeConceptTitle("What is LP Event CPC?")).toBe("lp event cpc");
    expect(normalizeConceptTitle("What's an Ad Angle?")).toBe("ad angle");
    expect(normalizeConceptTitle("What are Landing Pages?")).toBe("landing pages");
  });

  it("folds dashes into token boundaries and drops stopwords", () => {
    expect(normalizeConceptTitle("Landing-Page Event CPC")).toBe("landing page event cpc");
    expect(normalizeConceptTitle("The Anatomy of a Funnel")).toBe("anatomy funnel");
  });
});

describe("conceptKeys", () => {
  it("includes the parenthetical as its own key", () => {
    const keys = conceptKeys("Landing-Page Event CPC (LP Event CPC)");
    expect(keys.has("landing page event cpc")).toBe(true);
    expect(keys.has("lp event cpc")).toBe(true);
  });

  it("generates acronym-collapse variants for expansions without parentheticals", () => {
    // "landing page" run collapses to "lp" — matches the literal acronym title.
    const keys = conceptKeys("Landing-Page Event CPC");
    expect(keys.has("lp event cpc")).toBe(true);
  });

  it("never collapses a whole short title into a bare initialism", () => {
    // "ad angle" must NOT produce the collision-prone key "aa".
    expect(conceptKeys("Ad Angle").has("aa")).toBe(false);
  });
});

describe("clusterDuplicates", () => {
  const doc = (id: number, title: string, content = `Unique body for ${id} ${title} `.repeat(10)) => ({ id, title, content });

  it("clusters the LP Event CPC title-variant family", () => {
    const clusters = clusterDuplicates([
      doc(1, "What is LP Event CPC?"),
      doc(2, "LP Event CPC"),
      doc(3, "Landing-Page Event CPC (LP Event CPC)"),
      doc(4, "What is Landing-Page Event CPC?"),
      doc(5, "lp event cpc?"),
      doc(9, "Completely Different Concept About Shipping Rates and Customs Fees"),
    ]);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].docIds).toEqual([1, 2, 3, 4, 5]);
  });

  it("transitively clusters via a parenthetical bridge (Angle family)", () => {
    const clusters = clusterDuplicates([
      doc(10, "What is Angle?"),
      doc(11, "What is Ad angle?"),
      doc(12, "What is Angle (ad angle)?"),
      doc(13, "What is BTS Concierge?"),
      doc(14, "BTS Concierge"),
    ]);
    const sorted = clusters.map((c) => c.docIds).sort((a, b) => a[0] - b[0]);
    expect(sorted).toEqual([
      [10, 11, 12],
      [13, 14],
    ]);
  });

  it("clusters different titles when content is nearly identical", () => {
    const body =
      "The Blitz method walks you through launching your first affiliate campaign step by step, starting with picking an offer from an approved network, building a landing page in Flexy, and setting a daily test budget before scaling what converts profitably over time.";
    const clusters = clusterDuplicates([
      { id: 21, title: "Launching Your First Campaign", content: body },
      { id: 22, title: "Campaign Launch Basics", content: body + " Remember to track results daily." },
      { id: 23, title: "Choosing a Coaching Plan", content: "Coaching plans include group calls, private sessions and VA support options for members at every tier of the program depending on their goals and budget over months." },
    ]);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].docIds).toEqual([21, 22]);
  });

  it("returns no clusters when everything is distinct", () => {
    expect(
      clusterDuplicates([
        doc(31, "DIYTrax Overview"),
        doc(32, "How Affiliate Arbitrage Works"),
        doc(33, "Choosing Your Affiliate Network"),
      ]),
    ).toHaveLength(0);
  });
});

describe("contentSimilarity", () => {
  it("is 1 for identical text and ~0 for unrelated text", () => {
    const a = "one two three four five six seven eight nine ten";
    expect(contentSimilarity(a, a)).toBe(1);
    expect(contentSimilarity(a, "alpha beta gamma delta epsilon zeta eta theta iota kappa")).toBe(0);
  });
});

describe("findLiveSimilar", () => {
  const live = [
    { id: 100, title: "LP Event CPC", content: "Definition of LP event CPC ".repeat(20) },
    { id: 101, title: "DIYTrax Overview", content: "DIYTrax is the tracking platform ".repeat(20) },
  ];

  it("matches a draft to a live doc by normalized title", () => {
    const m = findLiveSimilar({ title: "What is Landing-Page Event CPC (LP Event CPC)?", content: "totally different body" }, live);
    expect(m).toMatchObject({ liveDocId: 100, reason: "title" });
  });

  it("matches by content similarity when titles differ", () => {
    const m = findLiveSimilar({ title: "Tracker Platform Guide", content: "DIYTrax is the tracking platform ".repeat(20) }, live);
    expect(m).toMatchObject({ liveDocId: 101, reason: "content" });
  });

  it("excludes the draft's own update target", () => {
    const m = findLiveSimilar(
      { title: "What is LP Event CPC?", content: "x", targetLiveDocId: 100 },
      live,
    );
    expect(m).toBeNull();
  });

  it("returns null when nothing is similar", () => {
    expect(findLiveSimilar({ title: "Brand New Topic", content: "fresh content nobody wrote about" }, live)).toBeNull();
  });
});
