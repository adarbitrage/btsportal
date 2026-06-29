import { describe, it, expect } from "vitest";

import { buildVoiceSystemPrompt } from "../lib/retell-agent-setup";

// The voice agent's behaviour rules live in buildVoiceSystemPrompt(). There is
// no DB-row sentinel for voice (unlike chat): enforcement is the exact-match
// self-heal in setupRetellAgentKb / probeRetellAgentHealth, which re-patches the
// live Retell LLM whenever general_prompt !== buildVoiceSystemPrompt(). So as
// long as these rules stay in the builder, boot re-applies them and they can't
// drift. These assertions lock the rules into the builder.
describe("voice system prompt — Task #1407 behaviour rules", () => {
  const prompt = buildVoiceSystemPrompt();

  it("requires a knowledge-base lookup before answering and forbids guessing", () => {
    expect(prompt).toContain("INFORMATION RULE — MANDATORY");
    expect(prompt).toContain("search_knowledge_base");
    expect(prompt).toContain("Do NOT invent, guess, or extrapolate");
  });

  it("carries the names-only-from-structured-docs rule", () => {
    expect(prompt).toContain("NAMES AND SPECIFICS — MANDATORY");
    expect(prompt).toContain("ONLY when the search_knowledge_base lookup actually returned it");
    expect(prompt).toContain("coach and team-member names");
  });

  it("carries the clarify-first rule", () => {
    expect(prompt).toContain("CLARIFY FIRST — MANDATORY");
    expect(prompt).toContain("ONE short clarifying question");
  });

  it("carries the depth-ceiling handoffs (concept→coaching, troubleshooting→support)", () => {
    expect(prompt).toContain("DEPTH CEILINGS — MANDATORY");
    expect(prompt).toContain("live coaching call");
    expect(prompt).toContain("escalate_to_support");
  });

  it("carries the graceful no-answer fallback wired to the no-info lookup result", () => {
    expect(prompt).toContain("NO VERIFIED ANSWER — MANDATORY");
    expect(prompt).toContain("don't have a verified answer");
    // The escalation rule must recognise the exact no-info sentinel the voice
    // search returns on a non-confident result.
    expect(prompt).toContain("No relevant information found.");
  });

  it("carries the current-navigation + legacy-terminology crosswalk", () => {
    expect(prompt).toContain("CURRENT NAVIGATION AND LEGACY TERMINOLOGY — MANDATORY");
    expect(prompt).toContain("Cherrington");
    expect(prompt).toContain("Media Mavens");
    expect(prompt).toContain("Resource Library");
  });

  it("keeps the always-The-Blitz naming and the spelled-out refund guarantee", () => {
    expect(prompt).toContain("NAMING — MANDATORY");
    expect(prompt).toContain('The flagship program is called "The Blitz"');
    expect(prompt).toContain("ninety-day refund guarantee");
  });
});
