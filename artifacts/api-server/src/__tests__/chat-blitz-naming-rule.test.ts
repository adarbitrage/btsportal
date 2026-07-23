import { describe, it, expect, beforeEach, vi } from "vitest";

import {
  ANTI_HALLUCINATION_SYSTEM_PROMPT,
  ANTI_HALLUCINATION_SENTINEL,
  DIRECT_ANSWER_SENTINEL,
  DEEP_ASSISTANT_SENTINEL,
  NAMING_NAVIGATION_SENTINEL,
  NAMES_FROM_DOCS_SENTINEL,
  ESCALATION_LADDER_SENTINEL,
  NO_KB_SCAFFOLDING_SENTINEL,
  PORTAL_LINK_SENTINEL,
  BLITZ_STEPS_SENTINEL,
  CLARIFIER_SENTINEL,
  ANSWER_DEPTH_SENTINEL,
  SYNTHESIS_CONSISTENCY_SENTINEL,
  FORMATTING_STYLE_SENTINEL,
  CAMPAIGN_SPINE_SENTINEL,
} from "../lib/chat-system-prompt";

// ensureKBGrounding() touches the DB and a handful of seed/scrub modules. Mock
// every sibling dependency it imports (and @workspace/db + drizzle-orm) so the
// test exercises only the active-prompt sentinel-upgrade logic without a real
// DB and without dragging in redis/bullmq (ticketdesk-queue) at import time.
const dbState: {
  activePrompt: { id: number; content: string } | null;
  updatedContent: string | null;
  updateCount: number;
} = { activePrompt: null, updatedContent: null, updateCount: 0 };

vi.mock("@workspace/db", () => ({
  db: {
    execute: async () => ({ rows: [] }),
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => (dbState.activePrompt ? [dbState.activePrompt] : []),
        }),
      }),
    }),
    update: () => ({
      set: (vals: { content: string }) => ({
        where: async () => {
          dbState.updateCount += 1;
          dbState.updatedContent = vals.content;
        },
      }),
    }),
  },
  productsTable: {},
  chatSystemPromptsTable: { id: {}, content: {}, isActive: {} },
}));

vi.mock("drizzle-orm", () => {
  const sql: unknown = Object.assign(
    (..._a: unknown[]) => ({}),
    { raw: (..._a: unknown[]) => ({}) },
  );
  return {
    sql,
    eq: (..._a: unknown[]) => ({}),
  };
});

vi.mock("../lib/rebrand-old-brand-source-content", () => ({
  rebrandOldBrandSourceContent: async () => ({
    transcriptCleaner: { scanned: 0, updated: 0 },
    aiSource: { scanned: 0, updated: 0 },
  }),
}));
vi.mock("../lib/rescrub-knowledgebase-docs", () => ({
  rescrubKnowledgebaseDocs: async () => ({ titleUpdated: 0, contentUpdated: 0, scanned: 0 }),
  findUnscrubbedTitles: async () => [],
}));
vi.mock("../lib/seed-kb", () => ({
  seedKnowledgebaseFromFiles: async () => {},
  seedInternalSops: async () => {},
}));
vi.mock("../lib/seed-kb-member-content", () => ({
  seedMemberBroadContent: async () => {},
}));
vi.mock("../lib/tapfiliate-migration", () => ({ runTapfiliateColumnMigration: async () => {} }));
vi.mock("../lib/seed-yse-products", () => ({ seedYseProducts: async () => {} }));
vi.mock("../lib/seed-machine-brand-products", () => ({ seedMachineBrandProducts: async () => {} }));
vi.mock("../lib/reconcile-entitlement-keys", () => ({ reconcileEntitlementKeys: async () => {} }));
vi.mock("../lib/machine-product-key-mappings", () => ({ seedMachineProductKeyMappings: async () => {} }));
vi.mock("../lib/ensure-founding-superadmins", () => ({ ensureFoundingSuperAdmins: async () => {} }));
vi.mock("../lib/ticketdesk-queue", () => ({ backfillUndeliveredTickets: async () => {} }));
vi.mock("../lib/coaching-call-migrate-oneoffs", () => ({
  migrateOneOffCoachingCallsToTemplates: async () => {},
}));

import { ensureKBGrounding } from "../lib/bootstrap-critical-prerequisites";

const ALL_SENTINELS: Array<[string, string]> = [
  ["ANTI_HALLUCINATION_SENTINEL", ANTI_HALLUCINATION_SENTINEL],
  ["DIRECT_ANSWER_SENTINEL", DIRECT_ANSWER_SENTINEL],
  ["DEEP_ASSISTANT_SENTINEL", DEEP_ASSISTANT_SENTINEL],
  ["NAMING_NAVIGATION_SENTINEL", NAMING_NAVIGATION_SENTINEL],
  ["NAMES_FROM_DOCS_SENTINEL", NAMES_FROM_DOCS_SENTINEL],
  ["ESCALATION_LADDER_SENTINEL", ESCALATION_LADDER_SENTINEL],
  ["NO_KB_SCAFFOLDING_SENTINEL", NO_KB_SCAFFOLDING_SENTINEL],
  ["PORTAL_LINK_SENTINEL", PORTAL_LINK_SENTINEL],
  ["BLITZ_STEPS_SENTINEL", BLITZ_STEPS_SENTINEL],
  ["CLARIFIER_SENTINEL", CLARIFIER_SENTINEL],
  ["ANSWER_DEPTH_SENTINEL", ANSWER_DEPTH_SENTINEL],
  ["SYNTHESIS_CONSISTENCY_SENTINEL", SYNTHESIS_CONSISTENCY_SENTINEL],
  ["FORMATTING_STYLE_SENTINEL", FORMATTING_STYLE_SENTINEL],
  ["CAMPAIGN_SPINE_SENTINEL", CAMPAIGN_SPINE_SENTINEL],
];

beforeEach(() => {
  dbState.activePrompt = null;
  dbState.updatedContent = null;
  dbState.updateCount = 0;
});

describe("Rule 1 — campaign roadmap spine counts as provided context, with ordering precedence", () => {
  it("carries the spine-context language (spine block header referenced, treated as verified)", () => {
    expect(ANTI_HALLUCINATION_SYSTEM_PROMPT).toContain("Rule 1");
    expect(ANTI_HALLUCINATION_SYSTEM_PROMPT).toContain(CAMPAIGN_SPINE_SENTINEL);
    // References the exact header the chat route appends at assembly time.
    expect(ANTI_HALLUCINATION_SYSTEM_PROMPT).toContain(
      "BTS Campaign Roadmap (Authoritative Chronology)",
    );
    expect(ANTI_HALLUCINATION_SYSTEM_PROMPT).toContain("no hedging");
  });

  it("carries the precedence split: roadmap wins on ORDERING, articles win on depth/how-to", () => {
    expect(ANTI_HALLUCINATION_SYSTEM_PROMPT).toContain("ORDERING and sequencing questions");
    expect(ANTI_HALLUCINATION_SYSTEM_PROMPT).toContain(
      "the roadmap block wins over any retrieved Knowledge Base article",
    );
    expect(ANTI_HALLUCINATION_SYSTEM_PROMPT).toContain(
      "the roadmap tells you WHEN, the articles tell you HOW",
    );
  });
});

describe("Rule 6 — naming, legacy terminology and current navigation (merged old Rules 7+11)", () => {
  it("carries the always-'The Blitz' naming language with every banned day-count variant", () => {
    expect(ANTI_HALLUCINATION_SYSTEM_PROMPT).toContain("Rule 6");
    expect(ANTI_HALLUCINATION_SYSTEM_PROMPT).toContain(NAMING_NAVIGATION_SENTINEL);
    expect(ANTI_HALLUCINATION_SYSTEM_PROMPT).toContain("21-day Blitz");
    expect(ANTI_HALLUCINATION_SYSTEM_PROMPT).toContain("14-day Blitz");
    expect(ANTI_HALLUCINATION_SYSTEM_PROMPT).toContain("Fourteen-Day Blitz");
    expect(ANTI_HALLUCINATION_SYSTEM_PROMPT).toContain("21 Days to Scale");
  });

  it("carries the current-navigation sourcing + legacy crosswalk (brand, term, location remaps)", () => {
    expect(ANTI_HALLUCINATION_SYSTEM_PROMPT).toContain("BTS Portal Navigation Map");
    expect(ANTI_HALLUCINATION_SYSTEM_PROMPT).toContain("Cherrington");
    expect(ANTI_HALLUCINATION_SYSTEM_PROMPT).toContain("Media Mavens");
    expect(ANTI_HALLUCINATION_SYSTEM_PROMPT).toContain("Resource Library");
    // In-tool navigation is explicitly excluded from the remap.
    expect(ANTI_HALLUCINATION_SYSTEM_PROMPT).toContain("In-app navigation INSIDE a tool");
  });
});

describe("Rule 7 — names/specifics only from structured docs", () => {
  it("carries the names-only-from-structured-docs language", () => {
    expect(ANTI_HALLUCINATION_SYSTEM_PROMPT).toContain("Rule 7");
    expect(ANTI_HALLUCINATION_SYSTEM_PROMPT).toContain(NAMES_FROM_DOCS_SENTINEL);
    expect(ANTI_HALLUCINATION_SYSTEM_PROMPT).toContain("coach / team-member names");
  });
});

describe("Rule 8 — honest limits + escalation ladder (merged old Rules 3+10+12)", () => {
  it("carries the merged no-answer honesty + depth-ceiling triggers", () => {
    expect(ANTI_HALLUCINATION_SYSTEM_PROMPT).toContain("Rule 8");
    expect(ANTI_HALLUCINATION_SYSTEM_PROMPT).toContain(ESCALATION_LADDER_SENTINEL);
    // References the exact note the chat route injects on a non-confident result.
    expect(ANTI_HALLUCINATION_SYSTEM_PROMPT).toContain("no confident match");
    expect(ANTI_HALLUCINATION_SYSTEM_PROMPT).toContain("Depth ceiling");
  });

  it("carries the three ladder steps, one step per turn", () => {
    expect(ANTI_HALLUCINATION_SYSTEM_PROMPT).toContain("Step 1 — Point to the Blitz guide section");
    expect(ANTI_HALLUCINATION_SYSTEM_PROMPT).toContain("Step 2 — Narrow it down");
    expect(ANTI_HALLUCINATION_SYSTEM_PROMPT).toContain("Step 3 — Escalate to a human");
    expect(ANTI_HALLUCINATION_SYSTEM_PROMPT).toContain("ONE STEP AT A TIME");
    // Pointer sourcing: only from the injected blocks, plain text, hedged.
    expect(ANTI_HALLUCINATION_SYSTEM_PROMPT).toContain("Possibly Relevant Blitz Guide Sections");
    expect(ANTI_HALLUCINATION_SYSTEM_PROMPT).toContain("Blitz Guide Locations");
    expect(ANTI_HALLUCINATION_SYSTEM_PROMPT).toContain("likely covered in");
    // Step 1 is a hard output constraint: check-back question, zero escalation
    // language — the model must not collapse Step 1 and Step 3 into one message.
    expect(ANTI_HALLUCINATION_SYSTEM_PROMPT).toContain("HARD CONSTRAINT for the Step 1 message");
    expect(ANTI_HALLUCINATION_SYSTEM_PROMPT).toContain("ZERO escalation language");
    expect(ANTI_HALLUCINATION_SYSTEM_PROMPT).toContain("END with a check-back question");
  });

  it("carries the Step 3 triage (strategy→Coaching Calls, technical→1-on-1 VA Calls)", () => {
    expect(ANTI_HALLUCINATION_SYSTEM_PROMPT).toContain("live coaching call");
    expect(ANTI_HALLUCINATION_SYSTEM_PROMPT).toContain("[1-on-1 VA Calls](/va-calls)");
    expect(ANTI_HALLUCINATION_SYSTEM_PROMPT).toContain("Never send a technical setup question to Coaching Calls");
    // No leftover technical→Coaching Calls routing anywhere in the prompt.
    expect(ANTI_HALLUCINATION_SYSTEM_PROMPT).not.toMatch(
      /(?:technical|setup problem)[^.\n;→]*\[Coaching Calls\]/i,
    );
  });

  it("keeps explicit precedence: ladder step gating overrides the portal-link rule until Step 3", () => {
    expect(ANTI_HALLUCINATION_SYSTEM_PROMPT).toContain("ladder's step gating overrides Rule 10");
  });
});

describe("Rule 4 — support-ticket routing ban (marker fully removed)", () => {
  it("bans ticket routing and no longer mentions the retired [SUGGEST_TICKET] marker at all", () => {
    expect(ANTI_HALLUCINATION_SYSTEM_PROMPT).toContain("Never route members to support tickets");
    expect(ANTI_HALLUCINATION_SYSTEM_PROMPT).not.toContain("SUGGEST_TICKET");
    // The support email must not appear anywhere in the prompt.
    expect(ANTI_HALLUCINATION_SYSTEM_PROMPT).not.toContain("support@buildtestscale.com");
  });
});

describe("Rules 9-11 — scaffolding, portal links, Blitz steps", () => {
  it("carries the Rule 9 internal-KB-scaffold suppression rule", () => {
    expect(ANTI_HALLUCINATION_SYSTEM_PROMPT).toContain("Rule 9");
    expect(ANTI_HALLUCINATION_SYSTEM_PROMPT).toContain(NO_KB_SCAFFOLDING_SENTINEL);
    expect(ANTI_HALLUCINATION_SYSTEM_PROMPT).toContain("## Related topics");
    expect(ANTI_HALLUCINATION_SYSTEM_PROMPT).toContain("(see <Topic>)");
  });

  it("carries the Rule 10 portal-hyperlink rule with a concrete Markdown-link example", () => {
    expect(ANTI_HALLUCINATION_SYSTEM_PROMPT).toContain("Rule 10");
    expect(ANTI_HALLUCINATION_SYSTEM_PROMPT).toContain(PORTAL_LINK_SENTINEL);
    expect(ANTI_HALLUCINATION_SYSTEM_PROMPT).toContain("[Coaching Calls](/coaching)");
    expect(ANTI_HALLUCINATION_SYSTEM_PROMPT).toContain("BTS Portal Navigation Map");
  });

  it("carries the Rule 11 Blitz procedure-answer rule (numbered steps, textual Blitz refs, no links)", () => {
    expect(ANTI_HALLUCINATION_SYSTEM_PROMPT).toContain("Rule 11");
    expect(ANTI_HALLUCINATION_SYSTEM_PROMPT).toContain(BLITZ_STEPS_SENTINEL);
    expect(ANTI_HALLUCINATION_SYSTEM_PROMPT).toContain("in the Build phase of the Blitz guide");
    expect(ANTI_HALLUCINATION_SYSTEM_PROMPT).toContain('"Lesson 4.5"');
    expect(ANTI_HALLUCINATION_SYSTEM_PROMPT).toContain(
      "Do NOT render Blitz guide references as Markdown links",
    );
  });
});

describe("Rule 12 — clarifier rule (merged old Rules 9+20, plus stage-dependence trigger)", () => {
  it("carries both triggers: ambiguity and stage-dependence", () => {
    expect(ANTI_HALLUCINATION_SYSTEM_PROMPT).toContain("Rule 12");
    expect(ANTI_HALLUCINATION_SYSTEM_PROMPT).toContain(CLARIFIER_SENTINEL);
    expect(ANTI_HALLUCINATION_SYSTEM_PROMPT).toContain("ONE short, targeted clarifying question");
    expect(ANTI_HALLUCINATION_SYSTEM_PROMPT).toContain("Stage-dependence");
    // Guessable intent must still be answered, not stalled on a clarifier.
    expect(ANTI_HALLUCINATION_SYSTEM_PROMPT).toContain("most likely interpretation");
    // Network fork is named explicitly.
    expect(ANTI_HALLUCINATION_SYSTEM_PROMPT).toContain("Media Mavens vs ClickBank");
  });

  it("carries the chaining policy (one turn default, second only on a new fork, never a third)", () => {
    expect(ANTI_HALLUCINATION_SYSTEM_PROMPT).toContain("one clarifying turn by default");
    expect(ANTI_HALLUCINATION_SYSTEM_PROMPT).toContain("Never a third clarifying turn");
    expect(ANTI_HALLUCINATION_SYSTEM_PROMPT).toContain("never re-ask something the member already answered");
  });

  it("carries the depth bypass for walk-me-through-everything requests", () => {
    expect(ANTI_HALLUCINATION_SYSTEM_PROMPT).toContain("skip the clarifier and give the full grounded answer");
  });
});

describe("Rule 13 — answer-depth ladder (merged old Rules 16+19)", () => {
  it("carries the three depth tiers", () => {
    expect(ANTI_HALLUCINATION_SYSTEM_PROMPT).toContain("Rule 13");
    expect(ANTI_HALLUCINATION_SYSTEM_PROMPT).toContain(ANSWER_DEPTH_SENTINEL);
    expect(ANTI_HALLUCINATION_SYSTEM_PROMPT).toContain("Tier 1 — quick fact");
    expect(ANTI_HALLUCINATION_SYSTEM_PROMPT).toContain("Tier 2 — guidance / decision / why");
    expect(ANTI_HALLUCINATION_SYSTEM_PROMPT).toContain("Tier 3 — explicit procedure");
    expect(ANTI_HALLUCINATION_SYSTEM_PROMPT).toContain("Never pad a simple answer");
  });

  it("carries depth scoping (full depth only for the current step) and the stage-checkpoint closer", () => {
    expect(ANTI_HALLUCINATION_SYSTEM_PROMPT).toContain("Depth scoping");
    expect(ANTI_HALLUCINATION_SYSTEM_PROMPT).toContain("one-line forward pointer");
    expect(ANTI_HALLUCINATION_SYSTEM_PROMPT).toContain("Stage-checkpoint closer");
  });
});

describe("Rules 14-15 — synthesis consistency and formatting", () => {
  it("carries the Rule 14 synthesis-consistency rule (overlapping docs answered as one body of truth)", () => {
    expect(ANTI_HALLUCINATION_SYSTEM_PROMPT).toContain("Rule 14");
    expect(ANTI_HALLUCINATION_SYSTEM_PROMPT).toContain(SYNTHESIS_CONSISTENCY_SENTINEL);
    expect(ANTI_HALLUCINATION_SYSTEM_PROMPT).toContain("genuinely conflict");
    expect(ANTI_HALLUCINATION_SYSTEM_PROMPT).toContain("Never invent a reconciliation");
  });

  it("carries the Rule 15 formatting rule (lists over tables, headers, short paragraphs)", () => {
    expect(ANTI_HALLUCINATION_SYSTEM_PROMPT).toContain("Rule 15");
    expect(ANTI_HALLUCINATION_SYSTEM_PROMPT).toContain(FORMATTING_STYLE_SENTINEL);
    expect(ANTI_HALLUCINATION_SYSTEM_PROMPT).toContain("genuinely tabular");
    expect(ANTI_HALLUCINATION_SYSTEM_PROMPT).toContain("Keep paragraphs short");
  });
});

describe("prompt hygiene", () => {
  it("no longer carries member-visible tier placeholders (Task #1922 tier removal)", () => {
    expect(ANTI_HALLUCINATION_SYSTEM_PROMPT).not.toContain("{{chat_tier}}");
    expect(ANTI_HALLUCINATION_SYSTEM_PROMPT).not.toContain("Chat tier:");
  });

  it("has exactly 15 rules and no stale references past Rule 15", () => {
    for (let n = 1; n <= 15; n++) {
      expect(ANTI_HALLUCINATION_SYSTEM_PROMPT, `Rule ${n}`).toContain(`**Rule ${n} — `);
    }
    for (const n of [16, 17, 18, 19, 20]) {
      expect(ANTI_HALLUCINATION_SYSTEM_PROMPT, `Rule ${n}`).not.toContain(`Rule ${n}`);
    }
  });

  it("every sentinel is a substring of the prompt so none can drift away", () => {
    for (const [, sentinel] of ALL_SENTINELS) {
      expect(ANTI_HALLUCINATION_SYSTEM_PROMPT).toContain(sentinel);
    }
  });
});

describe("Task #1408 — deep-assistant persona (voice vs chat surface split)", () => {
  it("frames chat as the deep, comprehensive counterpart to the voice line", () => {
    expect(ANTI_HALLUCINATION_SYSTEM_PROMPT).toContain(DEEP_ASSISTANT_SENTINEL);
    expect(ANTI_HALLUCINATION_SYSTEM_PROMPT).toContain("voice");
    expect(ANTI_HALLUCINATION_SYSTEM_PROMPT).toContain("step-by-step");
  });
});

describe("ensureKBGrounding() active-prompt sentinel upgrade", () => {
  it.each(ALL_SENTINELS)("overwrites an active prompt missing %s", async (_name, sentinel) => {
    const stale = ANTI_HALLUCINATION_SYSTEM_PROMPT.replace(sentinel, "redacted");
    expect(stale).not.toContain(sentinel);
    dbState.activePrompt = { id: 5, content: stale };

    await ensureKBGrounding();

    expect(dbState.updateCount).toBe(1);
    expect(dbState.updatedContent).toBe(ANTI_HALLUCINATION_SYSTEM_PROMPT);
  });

  it("upgrades a pre-refactor prompt (has old sentinels, lacks the new merged-rule sentinels)", async () => {
    // Simulate the pre-refactor prompt: strip every NEW merged-rule sentinel.
    let stale = ANTI_HALLUCINATION_SYSTEM_PROMPT;
    for (const s of [
      NAMING_NAVIGATION_SENTINEL,
      ESCALATION_LADDER_SENTINEL,
      CLARIFIER_SENTINEL,
      ANSWER_DEPTH_SENTINEL,
    ]) {
      stale = stale.replace(s, "redacted");
    }
    expect(stale).toContain(ANTI_HALLUCINATION_SENTINEL);
    dbState.activePrompt = { id: 6, content: stale };

    await ensureKBGrounding();

    expect(dbState.updateCount).toBe(1);
    expect(dbState.updatedContent).toBe(ANTI_HALLUCINATION_SYSTEM_PROMPT);
  });

  it("leaves an already-current prompt untouched", async () => {
    dbState.activePrompt = { id: 4, content: ANTI_HALLUCINATION_SYSTEM_PROMPT };

    await ensureKBGrounding();

    expect(dbState.updateCount).toBe(0);
    expect(dbState.updatedContent).toBeNull();
  });
});
