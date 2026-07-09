import { describe, it, expect } from "vitest";
import {
  HEARSAY_GUARD,
  EXTRACT_PROMPT_VERSION,
  buildMapExtractSystemPrompt,
  buildConsolidateSystemPrompt,
  AUTHORITY_RANK,
  AUTHORITY_PRECEDENCE_RULES,
  SITUATIONAL_NUMBER_RULES,
  NO_MEMBER_NAMES_RULE,
  SOURCE_CONFLICT_MARKER,
  FLAG_PRESERVATION_GUARD,
  mergeScreeningFlags,
  screeningFlagsLabel,
} from "./kb-synthesis";
import {
  SITUATIONAL_NUMBER_MARKER,
  CONTEXT_BOUND_MARKER,
  SEGMENT_ANOMALY_MARKER,
  EMPTY_SCREENING_FLAGS,
} from "./kb-value-screener";
import { fingerprintContent } from "./kb-source-windows";
import { ALL_NODES } from "./kb-taxonomy";

/**
 * Prompt-contract tests for the synthesis hearsay guard (member-reported
 * policy/billing/refund/guarantee claims must never be extracted as facts) and
 * the prompt-versioned extract-cache invalidation.
 */

describe("HEARSAY_GUARD (extraction prompt contract)", () => {
  it("excludes member-reported policy/billing/refund/guarantee claims as hearsay", () => {
    expect(HEARSAY_GUARD).toMatch(/HEARSAY/);
    expect(HEARSAY_GUARD).toMatch(/billing/i);
    expect(HEARSAY_GUARD).toMatch(/refunds?/i);
    expect(HEARSAY_GUARD).toMatch(/guarantees?/i);
    expect(HEARSAY_GUARD).toMatch(/NEVER extract/);
    // Only coach-stated guidance counts — even undisputed member claims are out.
    expect(HEARSAY_GUARD).toMatch(/COACH themselves states/);
    expect(HEARSAY_GUARD).toMatch(/even when the coach does not dispute/i);
    // General teaching extraction is explicitly unchanged.
    expect(HEARSAY_GUARD).toMatch(/changes nothing about extracting general teaching/i);
  });

  it("is embedded in the map-phase extraction system prompt for every node", () => {
    const billing = ALL_NODES.find((n) => n.slug === "billing-and-refunds");
    expect(billing).toBeDefined();
    const prompt = buildMapExtractSystemPrompt(billing!);
    expect(prompt).toContain(HEARSAY_GUARD);
    expect(prompt).toContain(billing!.label);
  });
});

describe("EXTRACT_PROMPT_VERSION (cache invalidation on prompt change)", () => {
  it("is a non-empty version marker", () => {
    expect(typeof EXTRACT_PROMPT_VERSION).toBe("string");
    expect(EXTRACT_PROMPT_VERSION.length).toBeGreaterThan(0);
  });

  it("changes the extract-cache fingerprint vs the old content-only scheme", () => {
    const content = "Coach: keep test budgets small and disciplined.";
    const oldFingerprint = fingerprintContent(content);
    const newFingerprint = fingerprintContent(`${EXTRACT_PROMPT_VERSION}\n${content}`);
    // Extracts cached under the old (content-only) fingerprint no longer match,
    // so a re-run re-extracts them under the new hearsay-guarded prompt.
    expect(newFingerprint).not.toBe(oldFingerprint);
  });

  it("still varies with content (screening overrules keep busting the cache)", () => {
    const a = fingerprintContent(`${EXTRACT_PROMPT_VERSION}\nkept segments v1`);
    const b = fingerprintContent(`${EXTRACT_PROMPT_VERSION}\nkept segments v2`);
    expect(a).not.toBe(b);
  });
});

describe("AUTHORITY_RANK (curriculum owns the foundations)", () => {
  it("ranks curriculum above strategic_coach, above va, above internal", () => {
    expect(AUTHORITY_RANK.curriculum).toBeGreaterThan(AUTHORITY_RANK.strategic_coach);
    expect(AUTHORITY_RANK.strategic_coach).toBeGreaterThan(AUTHORITY_RANK.va);
    expect(AUTHORITY_RANK.va).toBeGreaterThan(AUTHORITY_RANK.internal);
  });
});

describe("consolidation prompt contract (authority, conflicts, flags, names)", () => {
  const node = ALL_NODES.find((n) => n.root === "concepts") ?? ALL_NODES[0];
  const prompt = buildConsolidateSystemPrompt(node!, "depth guidance here");

  it("embeds the authority-precedence rules: curriculum wins covered foundations, coaching supplements, VA never drives strategy", () => {
    expect(prompt).toContain(AUTHORITY_PRECEDENCE_RULES);
    expect(AUTHORITY_PRECEDENCE_RULES).toMatch(/curriculum'?s guidance WINS/);
    expect(AUTHORITY_PRECEDENCE_RULES).toMatch(/SUPPLEMENTS/);
    expect(AUTHORITY_PRECEDENCE_RULES).toMatch(/why, the when, the what-ifs/);
    expect(AUTHORITY_PRECEDENCE_RULES).toMatch(/NEVER drive strategy claims/);
    expect(AUTHORITY_PRECEDENCE_RULES).toMatch(/co-equal/);
  });

  it("requires real conflicts to be flagged for the reviewer with the exact visible marker, never silently resolved", () => {
    expect(AUTHORITY_PRECEDENCE_RULES).toContain(SOURCE_CONFLICT_MARKER);
    expect(AUTHORITY_PRECEDENCE_RULES).toMatch(/do NOT silently resolve/);
    expect(SOURCE_CONFLICT_MARKER).toMatch(/^> /); // a visible blockquote line
    expect(SOURCE_CONFLICT_MARKER).toMatch(/reviewer/i);
  });

  it("embeds the situational-number rules: context-bound illustrations only, never universal targets", () => {
    expect(prompt).toContain(SITUATIONAL_NUMBER_RULES);
    expect(SITUATIONAL_NUMBER_RULES).toMatch(/ONLY as context-bound illustrations WITH their context/);
    expect(SITUATIONAL_NUMBER_RULES).toMatch(/NEVER as universal targets/);
    expect(SITUATIONAL_NUMBER_RULES).toMatch(/\[SITUATIONAL\]/);
    expect(SITUATIONAL_NUMBER_RULES).toMatch(/\[CONTEXT-BOUND\]/);
  });

  it("prohibits member names alongside the existing no-coach-surnames rule, and keeps the hearsay guard", () => {
    expect(prompt).toContain(NO_MEMBER_NAMES_RULE);
    expect(NO_MEMBER_NAMES_RULE).toMatch(/never include member names/);
    expect(prompt).toMatch(/no coach surnames/);
    expect(prompt).toContain(HEARSAY_GUARD);
  });

  it("pairs coaching insight around the curriculum foundation it supplements", () => {
    expect(prompt).toMatch(/CURRICULUM PAIRING/);
    expect(prompt).toMatch(/curriculum position first/);
    expect(prompt).toMatch(/never as a competing alternative/);
  });
});

describe("screener-flag threading (extract phase → consolidation)", () => {
  it("the map extraction prompt instructs flag preservation onto bullets", () => {
    const node = ALL_NODES[0];
    const prompt = buildMapExtractSystemPrompt(node!);
    expect(prompt).toContain(FLAG_PRESERVATION_GUARD);
    expect(FLAG_PRESERVATION_GUARD).toMatch(/\[SITUATIONAL\], \[CONTEXT-BOUND\] or \[ANOMALY\]/);
    expect(FLAG_PRESERVATION_GUARD).toMatch(/NEVER restate such numbers as general targets/);
  });

  it("the flag-preservation guard names the screener's inline markers", () => {
    expect(FLAG_PRESERVATION_GUARD).toContain("[SITUATIONAL NUMBER");
    expect(FLAG_PRESERVATION_GUARD).toContain("[CONTEXT-BOUND WALKTHROUGH");
    expect(FLAG_PRESERVATION_GUARD).toContain("[SEGMENT ANOMALY");
    expect(SITUATIONAL_NUMBER_MARKER).toMatch(/^\[SITUATIONAL NUMBER/);
    expect(CONTEXT_BOUND_MARKER).toMatch(/^\[CONTEXT-BOUND WALKTHROUGH/);
    expect(SEGMENT_ANOMALY_MARKER).toMatch(/^\[SEGMENT ANOMALY/);
  });

  it("mergeScreeningFlags unions flags so they survive hierarchical-reduce batching", () => {
    const merged = mergeScreeningFlags([
      { situationalNumbers: true, contextBound: false, segmentAnomaly: false },
      { situationalNumbers: false, contextBound: true, segmentAnomaly: false },
      { ...EMPTY_SCREENING_FLAGS },
    ]);
    expect(merged).toEqual({ situationalNumbers: true, contextBound: true, segmentAnomaly: false });
    expect(mergeScreeningFlags([{ ...EMPTY_SCREENING_FLAGS }])).toEqual(EMPTY_SCREENING_FLAGS);
  });

  it("screeningFlagsLabel renders the flags into the consolidation source header (empty when clean)", () => {
    expect(screeningFlagsLabel({ ...EMPTY_SCREENING_FLAGS })).toBe("");
    expect(
      screeningFlagsLabel({ situationalNumbers: true, contextBound: true, segmentAnomaly: true }),
    ).toBe(", flags=situational-numbers+context-bound-walkthrough+segment-anomaly");
    expect(screeningFlagsLabel({ situationalNumbers: true, contextBound: false, segmentAnomaly: false })).toBe(
      ", flags=situational-numbers",
    );
  });

  it("bumped EXTRACT_PROMPT_VERSION so pre-flag cached extracts regenerate", () => {
    expect(EXTRACT_PROMPT_VERSION).not.toBe("v2-hearsay-guard");
    expect(
      fingerprintContent(`${EXTRACT_PROMPT_VERSION}\ncontent`),
    ).not.toBe(fingerprintContent("v2-hearsay-guard\ncontent"));
  });
});

// ── Synthesis hardening: retry + empty-content detection ─────────────────────
import { vi, beforeEach, afterEach } from "vitest";
import { callLLM, callLLMWithRetry, isRateLimitError } from "./kb-synthesis";

describe("synthesis LLM hardening", () => {
  const env = { ...process.env };
  beforeEach(() => {
    process.env.AI_INTEGRATIONS_OPENAI_BASE_URL = "http://ai.test";
    process.env.AI_INTEGRATIONS_OPENAI_API_KEY = "test-key";
  });
  afterEach(() => {
    process.env = { ...env };
    vi.restoreAllMocks();
  });

  it("isRateLimitError detects 429s in error messages", () => {
    expect(isRateLimitError("AI synthesis call failed: 429")).toBe(true);
    expect(isRateLimitError("AI synthesis call failed: 500")).toBe(false);
    expect(isRateLimitError("timeout")).toBe(false);
  });

  it("callLLM throws on 200-with-empty-content (reasoning-token starvation), never returns ''", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ finish_reason: "length", message: { content: "" } }] }),
    }));
    await expect(callLLM("s", "u", 100)).rejects.toThrow(/empty content.*finish_reason=length/);
  });

  it("callLLMWithRetry retries transient failures and returns the eventual success", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ choices: [{ message: { content: "recovered" } }] }),
      });
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(callLLMWithRetry("test", "s", "u", 100)).resolves.toBe("recovered");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  }, 20000);

  it("escalates token budget on finish_reason=length starvation and tallies it per run", async () => {
    const { LLM_ESCALATION_MAX_TOKENS, getLengthStarvedCallCount, resetLengthStarvedCallCount } =
      await import("./kb-synthesis");
    resetLengthStarvedCallCount();
    const starvedResp = {
      ok: true,
      json: async () => ({ choices: [{ finish_reason: "length", message: { content: "" } }] }),
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(starvedResp)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ choices: [{ message: { content: "escalated-ok" } }] }),
      });
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(callLLMWithRetry("test", "s", "u", 4000, false, true)).resolves.toBe("escalated-ok");
    // Second attempt must carry the DOUBLED budget (4000 → 8000).
    const secondBody = JSON.parse(fetchMock.mock.calls[1][1].body as string);
    expect(secondBody.max_completion_tokens).toBe(8000);
    expect(getLengthStarvedCallCount()).toBe(1);
    resetLengthStarvedCallCount();
    expect(getLengthStarvedCallCount()).toBe(0);
  }, 20000);

  it("escalation is capped at the ceiling and non-synthesis callers never feed the tally", async () => {
    const { LLM_ESCALATION_MAX_TOKENS, getLengthStarvedCallCount, resetLengthStarvedCallCount } =
      await import("./kb-synthesis");
    resetLengthStarvedCallCount();
    const starvedResp = () => ({
      ok: true,
      json: async () => ({ choices: [{ finish_reason: "length", message: { content: "" } }] }),
    });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(starvedResp())
      .mockResolvedValueOnce(starvedResp())
      .mockResolvedValueOnce(starvedResp());
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "error").mockImplementation(() => {});
    // Start just under the cap: doubling must clamp AT the cap, never beyond.
    await expect(
      callLLMWithRetry("triage doc 1", "s", "u", LLM_ESCALATION_MAX_TOKENS - 1000),
    ).rejects.toThrow(/empty content/);
    const bodies = fetchMock.mock.calls.map((c) => JSON.parse(c[1].body as string).max_completion_tokens);
    expect(bodies).toEqual([
      LLM_ESCALATION_MAX_TOKENS - 1000,
      LLM_ESCALATION_MAX_TOKENS,
      LLM_ESCALATION_MAX_TOKENS,
    ]);
    // Default countStarvation=false (triage/refine) must NOT inflate the
    // synthesis run tally.
    expect(getLengthStarvedCallCount()).toBe(0);
  }, 20000);

  it("callLLMWithRetry throws loudly after exhausting attempts (no silent fallback)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(callLLMWithRetry("test", "s", "u", 100)).rejects.toThrow("AI synthesis call failed: 500");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  }, 20000);
});
