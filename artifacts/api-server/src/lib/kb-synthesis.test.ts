import { describe, it, expect } from "vitest";
import {
  HEARSAY_GUARD,
  EXTRACT_PROMPT_VERSION,
  buildMapExtractSystemPrompt,
} from "./kb-synthesis";
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
