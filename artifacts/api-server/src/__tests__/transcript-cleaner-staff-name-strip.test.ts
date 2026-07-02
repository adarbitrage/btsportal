import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Task #1607 — the Transcript Cleaner must reduce coach & VA references to FIRST
 * name only, while leaving the member's own real name intact.
 *
 * Two mechanisms cooperate (see transcript-cleaner.ts + content-privacy-filter.ts):
 *   1. The roster-driven `STAFF_FIRST_NAME_GUIDANCE` embedded in the clean +
 *      refine system prompts — the PRIMARY mechanism, and the ONLY one for VAs
 *      (whose surnames are not stored anywhere, so the deterministic scrub can't
 *      key on them).
 *   2. The deterministic `scrubPrivateContent` backstop applied to the cleaned
 *      body — catches any KNOWN coach surname the model left in.
 *
 * The LLM is mocked so the pipeline is deterministic: the mock stands in for the
 * model, letting us assert (a) the prompt carries the roster guidance, and (b)
 * the scrub backstop strips a coach surname even when the model echoes it back.
 */

const createMock = vi.hoisted(() => vi.fn());

vi.mock("@workspace/integrations-anthropic-ai", () => ({
  getAnthropicClient: () => ({ messages: { create: createMock } }),
}));

import {
  cleanTranscript,
  refineTranscript,
  STAFF_FIRST_NAME_GUIDANCE,
} from "../lib/transcript-cleaner";
import { COACHING_ROSTER, VA_ROSTER } from "../lib/coaching-roster";
import { buildStaffFirstNameGuidance } from "../lib/content-privacy-filter";

function cleanerResponse(cleanedTranscript: string, extra: Record<string, unknown> = {}) {
  return {
    stop_reason: "end_turn",
    content: [
      {
        type: "text",
        text: JSON.stringify({
          cleanedTranscript,
          authority: { label: "Coach", confidence: "high", evidence: "test", detectedName: "Bruce" },
          primarySubject: "Donald Hayes",
          detectedDate: null,
          flags: [],
          ...extra,
        }),
      },
    ],
  };
}

const ALL_STAFF_FIRST_NAMES = [...COACHING_ROSTER, ...VA_ROSTER].map((s) => s.name);

beforeEach(() => {
  createMock.mockReset();
});

describe("buildStaffFirstNameGuidance (roster-driven, VA-inclusive)", () => {
  it("lists every supplied staff first name and forbids stripping member surnames", () => {
    const guidance = buildStaffFirstNameGuidance(["Sasha", "Neil", "Mikha"]);
    expect(guidance).toContain("Sasha");
    expect(guidance).toContain("Neil");
    expect(guidance).toContain("Mikha");
    expect(guidance.toLowerCase()).toContain("first name");
    expect(guidance).toMatch(/MEMBER/);
  });

  it("trims and drops blank names, and omits the roster clause when none are given", () => {
    expect(buildStaffFirstNameGuidance(["  Bruce  ", "", "  "])).toContain("Bruce");
    expect(buildStaffFirstNameGuidance([])).not.toContain("roster (first names)");
  });

  it("the wired guidance covers the WHOLE live coach + VA roster", () => {
    for (const name of ALL_STAFF_FIRST_NAMES) {
      expect(STAFF_FIRST_NAME_GUIDANCE).toContain(name);
    }
    // Explicitly assert the VAs are covered — they have no deterministic rule.
    for (const va of VA_ROSTER) expect(STAFF_FIRST_NAME_GUIDANCE).toContain(va.name);
  });
});

describe("cleanTranscript — staff surnames stripped, member name preserved", () => {
  it("embeds the roster-driven first-name-only guidance (incl. VAs) in the clean prompt", async () => {
    createMock.mockResolvedValue(cleanerResponse("VA: Hi.\nMember: Hello, I'm Donald Hayes."));

    await cleanTranscript({
      rawText: "Neil Smith: Hi.\nDonald Hayes: Hello.",
      transcriptType: "one_on_one_va",
      providedAuthorityRole: "va",
      providedAuthorityName: "Neil",
      providedSubject: "Donald Hayes",
    });

    expect(createMock).toHaveBeenCalled();
    const { system, messages } = createMock.mock.calls[0][0];
    // The guidance rides in BOTH the system prompt and the per-call user message.
    expect(system).toContain(STAFF_FIRST_NAME_GUIDANCE);
    expect(messages[0].content).toContain(STAFF_FIRST_NAME_GUIDANCE);
    for (const va of VA_ROSTER) expect(system).toContain(va.name);
  });

  it("strips a KNOWN coach surname via the deterministic backstop even when the model echoes it, and keeps the member's full name", async () => {
    // The model does nothing useful — it echoes the surname straight back. The
    // scrub backstop must still reduce "Bruce Clark" -> "Bruce".
    createMock.mockResolvedValue(
      cleanerResponse("Coach: Welcome. This is Bruce Clark.\nMember: Hi, I'm Donald Hayes."),
    );

    const res = await cleanTranscript({
      rawText: "Bruce Clark: Welcome.\nDonald Hayes: Hi.",
      transcriptType: "private_coaching",
      providedAuthorityRole: "strategic_coach",
      providedAuthorityName: "Bruce",
      providedSubject: "Donald Hayes",
    });

    expect(res.cleanedContent).not.toMatch(/Clark/i);
    expect(res.cleanedContent).toContain("Bruce");
    // The member is the subject of a 1-on-1 — their real full name survives.
    expect(res.cleanedContent).toContain("Donald Hayes");
  });

  it("keeps a first-name-only VA reference intact once the model has applied the guidance", async () => {
    createMock.mockResolvedValue(
      cleanerResponse("VA: Great progress.\nMember: Thanks, from Donald Hayes."),
    );

    const res = await cleanTranscript({
      rawText: "Neil Johnson: Great progress.\nDonald Hayes: Thanks.",
      transcriptType: "one_on_one_va",
      providedAuthorityRole: "va",
      providedAuthorityName: "Neil",
      providedSubject: "Donald Hayes",
    });

    expect(res.cleanedContent).toContain("VA:");
    expect(res.cleanedContent).toContain("Donald Hayes");
    // No surname reintroduced by the pipeline.
    expect(res.cleanedContent).not.toMatch(/Johnson/i);
  });
});

describe("refineTranscript — scrub backstop + guidance on the refine path", () => {
  it("re-scrubs a coach surname reintroduced by a full-rewrite refine", async () => {
    // Force the full-rewrite fallback (non-array edits), and have the rewrite
    // reintroduce the surname; the shared scrub must still catch it.
    createMock.mockResolvedValueOnce(cleanerResponse("ignored", { edits: "not-an-array" }));
    createMock.mockResolvedValueOnce(
      cleanerResponse("Coach: Recap with Bruce Clark.\nMember: Got it, Donald Hayes here.", {
        message: "Rewrote the recap.",
      }),
    );

    const res = await refineTranscript({
      currentCleaned: "Coach: Recap.\nMember: Got it.",
      instruction: "Rewrite the recap line.",
      transcriptType: "private_coaching",
    });

    expect(res.cleanedContent).not.toMatch(/Clark/i);
    expect(res.cleanedContent).toContain("Bruce");
    expect(res.cleanedContent).toContain("Donald Hayes");
  });

  it("embeds the roster guidance in the refine (patch) prompt", async () => {
    createMock.mockResolvedValue(cleanerResponse("", { edits: [], message: "No change." }));

    await refineTranscript({
      currentCleaned: "Coach: Hi.\nMember: Hello.",
      instruction: "Tidy up.",
      transcriptType: "private_coaching",
    });

    const { system } = createMock.mock.calls[0][0];
    expect(system).toContain(STAFF_FIRST_NAME_GUIDANCE);
  });
});
