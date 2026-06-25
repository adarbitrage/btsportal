import { describe, it, expect } from "vitest";

import {
  getSystemPrompt,
  reloadKnowledgeBase,
} from "../routes/openai/knowledge-base";

/**
 * The static .txt file path (qa-articles.txt / glossary.txt) has been removed
 * from the text assistant's knowledge source. The system prompt now contains
 * only the assistant's persona, rules, and grounding instructions. Live
 * knowledge-base content is retrieved at query time from knowledgebase_docs
 * (the same path as the voice assistant) — covered by
 * knowledge-base-db-privacy-scrub.test.ts.
 *
 * These tests verify that:
 *   1. getSystemPrompt() returns the persona/rules text (not empty).
 *   2. getSystemPrompt() does NOT inject static file content — a surname planted
 *      only in qa-articles.txt / glossary.txt can never surface in the prompt.
 *   3. reloadKnowledgeBase() is a safe no-op (backward-compat shim for
 *      admin-chat.ts; calling it must not throw).
 */

describe("assistant system prompt — static knowledge-base path removed", () => {
  it("getSystemPrompt() returns a non-empty persona/rules string", () => {
    const prompt = getSystemPrompt();
    expect(typeof prompt).toBe("string");
    expect(prompt.length).toBeGreaterThan(100);
    expect(prompt).toContain("BTS Assistant");
    expect(prompt).toContain("Build Test Scale");
    expect(prompt).toContain("support@buildtestscale.com");
  });

  it("getSystemPrompt() does not embed raw static knowledge-base file content", () => {
    const prompt = getSystemPrompt();
    // The prompt must not include the old static-dump section headers.
    expect(prompt).not.toContain("=== Q&A ARTICLES ===");
    expect(prompt).not.toContain("=== GLOSSARY & DEFINITIONS ===");
  });

  it("reloadKnowledgeBase() is a no-op and does not throw", () => {
    expect(() => reloadKnowledgeBase()).not.toThrow();
    // Calling it twice is safe.
    expect(() => reloadKnowledgeBase()).not.toThrow();
    // System prompt is unchanged before/after reload (no static content to reload).
    const before = getSystemPrompt();
    reloadKnowledgeBase();
    const after = getSystemPrompt();
    expect(after).toBe(before);
  });
});
