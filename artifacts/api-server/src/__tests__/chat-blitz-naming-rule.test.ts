import { describe, it, expect, beforeEach, vi } from "vitest";

import {
  ANTI_HALLUCINATION_SYSTEM_PROMPT,
  ANTI_HALLUCINATION_SENTINEL,
  DIRECT_ANSWER_SENTINEL,
  BLITZ_NAMING_SENTINEL,
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

beforeEach(() => {
  dbState.activePrompt = null;
  dbState.updatedContent = null;
  dbState.updateCount = 0;
});

describe("Rule 7 — always 'The Blitz' naming rule", () => {
  it("ANTI_HALLUCINATION_SYSTEM_PROMPT carries the Rule 7 naming language", () => {
    expect(ANTI_HALLUCINATION_SYSTEM_PROMPT).toContain('Rule 7');
    expect(ANTI_HALLUCINATION_SYSTEM_PROMPT).toContain('Program naming: always "The Blitz"');
    // Every banned day-count variant must be named so the model knows to avoid it.
    expect(ANTI_HALLUCINATION_SYSTEM_PROMPT).toContain('21-day Blitz');
    expect(ANTI_HALLUCINATION_SYSTEM_PROMPT).toContain('14-day Blitz');
    expect(ANTI_HALLUCINATION_SYSTEM_PROMPT).toContain('Fourteen-Day Blitz');
    expect(ANTI_HALLUCINATION_SYSTEM_PROMPT).toContain('21 Days to Scale');
  });

  it("BLITZ_NAMING_SENTINEL is a substring of the prompt so it can't drift away", () => {
    expect(ANTI_HALLUCINATION_SYSTEM_PROMPT).toContain(BLITZ_NAMING_SENTINEL);
  });
});

describe("ensureKBGrounding() active-prompt sentinel upgrade", () => {
  it("overwrites an active prompt missing BLITZ_NAMING_SENTINEL", async () => {
    // Has the older sentinels but predates Rule 7's naming sentinel.
    const stale = ANTI_HALLUCINATION_SYSTEM_PROMPT.replace(BLITZ_NAMING_SENTINEL, "redacted");
    expect(stale).toContain(ANTI_HALLUCINATION_SENTINEL);
    expect(stale).toContain(DIRECT_ANSWER_SENTINEL);
    expect(stale).not.toContain(BLITZ_NAMING_SENTINEL);
    dbState.activePrompt = { id: 1, content: stale };

    await ensureKBGrounding();

    expect(dbState.updateCount).toBe(1);
    expect(dbState.updatedContent).toBe(ANTI_HALLUCINATION_SYSTEM_PROMPT);
  });

  it("overwrites an active prompt missing ANTI_HALLUCINATION_SENTINEL", async () => {
    const stale = ANTI_HALLUCINATION_SYSTEM_PROMPT.replace(ANTI_HALLUCINATION_SENTINEL, "redacted");
    expect(stale).not.toContain(ANTI_HALLUCINATION_SENTINEL);
    dbState.activePrompt = { id: 2, content: stale };

    await ensureKBGrounding();

    expect(dbState.updateCount).toBe(1);
    expect(dbState.updatedContent).toBe(ANTI_HALLUCINATION_SYSTEM_PROMPT);
  });

  it("overwrites an active prompt missing DIRECT_ANSWER_SENTINEL", async () => {
    const stale = ANTI_HALLUCINATION_SYSTEM_PROMPT.replace(DIRECT_ANSWER_SENTINEL, "redacted");
    expect(stale).not.toContain(DIRECT_ANSWER_SENTINEL);
    dbState.activePrompt = { id: 3, content: stale };

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
