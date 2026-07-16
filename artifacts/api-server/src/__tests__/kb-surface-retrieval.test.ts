import { describe, it, expect } from "vitest";
import {
  isNavigationQuery,
  isFollowUp,
  isBareAffirmation,
  extractAssistantOffer,
  buildHistoryAwareQuery,
  type RetrievalTurn,
} from "../lib/kb-retrieval";
import { detectQueryTags, TAG_TRIGGERS, ALL_TAGS } from "../lib/kb-taxonomy";
import {
  getEffectiveTags,
  getEffectiveTagSet,
  getEffectiveTagTriggers,
} from "../lib/kb-tool-tags";

describe("detectQueryTags", () => {
  it("maps a tool name onto its controlled tag", () => {
    expect(detectQueryTags("how do I set up Flexy?")).toContain("flexy");
    expect(detectQueryTags("what is DIY Trax")).toContain("diytrax");
    expect(detectQueryTags("Media Mavens account")).toContain("media-mavens");
  });

  it("maps concept phrasings onto concept tags", () => {
    expect(detectQueryTags("help me write a headline")).toContain("headline");
    expect(detectQueryTags("my landing pages have low conversion")).toEqual(
      expect.arrayContaining(["landing-page", "conversion"]),
    );
  });

  it("matches on word boundaries, not substrings", () => {
    // "latest" contains "test" but must not trip the `testing` tag.
    expect(detectQueryTags("what is the latest update")).not.toContain("testing");
    // "creative" stem only — "create" must not match.
    expect(detectQueryTags("how do I create a campaign")).not.toContain("creative");
  });

  it("returns an empty array when nothing matches", () => {
    expect(detectQueryTags("when is the next coaching call")).toEqual([]);
    expect(detectQueryTags("")).toEqual([]);
    expect(detectQueryTags("   ")).toEqual([]);
  });

  it("returns tags in registry order and de-duplicated", () => {
    const tags = detectQueryTags("angle and hook and angle again");
    expect(tags).toEqual([...new Set(tags)]);
    expect(tags).toContain("angle");
    expect(tags).toContain("hook");
  });

  it("only ever uses keys that are members of ALL_TAGS", () => {
    for (const key of Object.keys(TAG_TRIGGERS)) {
      expect(ALL_TAGS).toContain(key);
    }
  });
});

describe("effective vocabulary (DB tool tags + code concept/troubleshooting)", () => {
  it("every trigger key is a member of the enabled effective tag set", () => {
    const tagSet = getEffectiveTagSet();
    for (const key of Object.keys(getEffectiveTagTriggers())) {
      expect(tagSet.has(key)).toBe(true);
    }
  });

  it("merges the code concept + troubleshooting baseline with the seeded tools", () => {
    const tags = getEffectiveTags();
    // Code baseline is always present.
    expect(tags).toEqual(expect.arrayContaining(["troubleshooting", "headline", "conversion"]));
    // Seeded external AI tools are present pre-DB via the shipped baseline.
    expect(tags).toEqual(expect.arrayContaining(["midjourney", "chatgpt", "claude"]));
    // Seeded existing code tool tags are present.
    expect(tags).toEqual(expect.arrayContaining(["flexy", "media-mavens", "clickbank"]));
  });
});

describe("isNavigationQuery", () => {
  const navQueries = [
    "where do I find the coaching calendar",
    "where is the resource library",
    "where's my billing page",
    "how do I find my invoices",
    "how do I get to the community feed",
    "which page has the refund policy",
    "how to navigate to the Blitz guide",
  ];
  for (const q of navQueries) {
    it(`flags "${q}" as navigation`, () => {
      expect(isNavigationQuery(q)).toBe(true);
    });
  }

  const nonNav = [
    "what is the refund policy",
    "how do I get a refund",
    "explain the Blitz program",
    "when is the next coaching call",
  ];
  for (const q of nonNav) {
    it(`does not flag "${q}"`, () => {
      expect(isNavigationQuery(q)).toBe(false);
    });
  }
});

describe("isFollowUp", () => {
  it("treats very short queries as follow-ups", () => {
    expect(isFollowUp("is it free?")).toBe(true);
    expect(isFollowUp("why?")).toBe(true);
    expect(isFollowUp("how much")).toBe(true);
  });

  it("treats follow-up connectives as follow-ups", () => {
    expect(isFollowUp("and what about the annual plan pricing")).toBe(true);
    expect(isFollowUp("what about refunds for that one specifically")).toBe(true);
  });

  it("treats anaphoric short queries as follow-ups", () => {
    expect(isFollowUp("how do I cancel it")).toBe(true);
    expect(isFollowUp("can they be changed later")).toBe(true);
  });

  it("does not treat standalone questions as follow-ups", () => {
    expect(isFollowUp("how do I get a refund on my membership plan")).toBe(false);
    expect(isFollowUp("explain the entire Blitz onboarding curriculum step by step")).toBe(false);
  });

  it("returns false for empty input", () => {
    expect(isFollowUp("")).toBe(false);
    expect(isFollowUp("   ")).toBe(false);
  });
});

describe("buildHistoryAwareQuery", () => {
  const history: RetrievalTurn[] = [
    { role: "user", content: "tell me about Flexy" },
    { role: "assistant", content: "Flexy is a landing page builder." },
  ];

  it("prepends the last user turn for a follow-up", () => {
    expect(buildHistoryAwareQuery("is it free?", history)).toBe("tell me about Flexy is it free?");
  });

  it("leaves a standalone question untouched", () => {
    const q = "how do I get a refund on my membership";
    expect(buildHistoryAwareQuery(q, history)).toBe(q);
  });

  it("leaves a follow-up untouched when there is no history", () => {
    expect(buildHistoryAwareQuery("is it free?", [])).toBe("is it free?");
  });

  it("ignores assistant-only history (no prior user turn)", () => {
    const onlyAssistant: RetrievalTurn[] = [{ role: "assistant", content: "Hi there" }];
    expect(buildHistoryAwareQuery("why?", onlyAssistant)).toBe("why?");
  });

  it("resolves a bare affirmation against the assistant's trailing offer (Flexy regression)", () => {
    const flexyHistory: RetrievalTurn[] = [
      { role: "user", content: "what is flexy?" },
      { role: "assistant", content: "Flexy is the landing page builder." },
      { role: "user", content: "cloning a template" },
      {
        role: "assistant",
        content:
          "Here's how to clone a template in Flexy:\n\n1. Go to **Sites**.\n2. Pick your folder.\n\nWant me to walk you through the domain and subdomain setup next?",
      },
    ];
    expect(buildHistoryAwareQuery("yes", flexyHistory)).toBe("the domain and subdomain setup");
  });

  it("falls back to the prior user question when the assistant did not end on an offer", () => {
    const noOffer: RetrievalTurn[] = [
      { role: "user", content: "cloning a template" },
      { role: "assistant", content: "Here are the steps. That completes the clone." },
    ];
    expect(buildHistoryAwareQuery("yes", noOffer)).toBe("cloning a template yes");
  });

  it("non-affirmation follow-ups still resolve against the prior user question", () => {
    const h: RetrievalTurn[] = [
      { role: "user", content: "tell me about Flexy" },
      { role: "assistant", content: "It builds pages. Want a walkthrough of domain setup?" },
    ];
    expect(buildHistoryAwareQuery("is it free?", h)).toBe("tell me about Flexy is it free?");
  });
});

describe("isBareAffirmation", () => {
  it("matches contentless confirmations", () => {
    for (const s of ["yes", "Yes!", "yeah", "sure", "ok", "okay", "yes please", "go ahead", "sounds good", "please do", "do it", "sure, thanks"]) {
      expect(isBareAffirmation(s), s).toBe(true);
    }
  });

  it("rejects replies that carry their own content", () => {
    for (const s of ["yes but what about pricing", "no", "yes to the domain part only", "how much is it"]) {
      expect(isBareAffirmation(s), s).toBe(false);
    }
  });
});

describe("extractAssistantOffer", () => {
  it("returns the trailing question of a markdown message", () => {
    expect(
      extractAssistantOffer("Steps:\n1. **Clone** it.\n2. Done.\n\nWant me to walk you through [domain setup](/kb/domains)?"),
    ).toBe("domain setup");
  });

  it("tolerates trailing whitespace after the closing question mark", () => {
    expect(extractAssistantOffer("All set. Want me to cover DNS records?  ")).toBe("DNS records");
  });

  it("returns null when the message does not end on a question", () => {
    expect(extractAssistantOffer("Is that clear? Here are the steps. All done.")).toBeNull();
    expect(extractAssistantOffer("Just a statement.")).toBeNull();
  });
});
