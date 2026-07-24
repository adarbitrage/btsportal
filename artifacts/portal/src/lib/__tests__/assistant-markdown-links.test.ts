import { describe, it, expect } from "vitest";
import { normalizeAssistantLinks } from "../assistant-markdown-links";

describe("normalizeAssistantLinks", () => {
  it("collapses `Label ([/path](/path))` into `[Label](/path)` (observed failure)", () => {
    expect(
      normalizeAssistantLinks("Head over to The Blitz ([/blitz](/blitz)) to continue."),
    ).toBe("Head over to [The Blitz](/blitz) to continue.");
  });

  it("enforces the canonical label even when the author's casing differs", () => {
    expect(
      normalizeAssistantLinks("check the blitz ([/blitz](/blitz)) today"),
    ).toBe("check [The Blitz](/blitz) today");
  });

  it("converts `Label (/path)` plain text into a proper link", () => {
    expect(
      normalizeAssistantLinks("See The Blitz (/blitz) for the full program."),
    ).toBe("See [The Blitz](/blitz) for the full program.");
  });

  it("replaces self-link text with the canonical label", () => {
    expect(normalizeAssistantLinks("Go to [/blitz](/blitz) now.")).toBe(
      "Go to [The Blitz](/blitz) now.",
    );
  });

  it("leaves a bare parenthesized path after a non-label word untouched", () => {
    const text = "Your training hub (/blitz) has it.";
    expect(normalizeAssistantLinks(text)).toBe(text);
  });

  it("leaves correctly formatted links untouched", () => {
    const good = "Start with [The Blitz](/blitz) and [7 Pillars](/core-training/7-pillars).";
    expect(normalizeAssistantLinks(good)).toBe(good);
  });

  it("handles multi-segment nav paths", () => {
    expect(
      normalizeAssistantLinks("7 Pillars ([/core-training/7-pillars](/core-training/7-pillars))"),
    ).toBe("[7 Pillars](/core-training/7-pillars)");
  });

  it("does not touch paths that are not in the navigation map", () => {
    const unknown = "See the docs ([/not-a-real-page](/not-a-real-page)).";
    expect(normalizeAssistantLinks(unknown)).toBe(unknown);
  });

  it("does not mangle external URLs or plain prose", () => {
    const text = "Visit [Google](https://google.com) or read about blitz tactics.";
    expect(normalizeAssistantLinks(text)).toBe(text);
  });

  it("leaves inline code untouched", () => {
    const text = "Write it as `The Blitz (/blitz)` in markdown.";
    expect(normalizeAssistantLinks(text)).toBe(text);
  });

  it("leaves fenced code blocks untouched but normalizes surrounding text", () => {
    const input = "The Blitz (/blitz) example:\n```\nThe Blitz ([/blitz](/blitz))\n```\ndone";
    expect(normalizeAssistantLinks(input)).toBe(
      "[The Blitz](/blitz) example:\n```\nThe Blitz ([/blitz](/blitz))\n```\ndone",
    );
  });

  it("handles an unterminated streaming code fence without corruption", () => {
    const input = "Look at The Blitz (/blitz)\n```\npartial [/blitz](/blitz)";
    expect(normalizeAssistantLinks(input)).toBe(
      "Look at [The Blitz](/blitz)\n```\npartial [/blitz](/blitz)",
    );
  });

  it("returns falsy/plain input unchanged", () => {
    expect(normalizeAssistantLinks("")).toBe("");
    expect(normalizeAssistantLinks("no links here")).toBe("no links here");
  });
});
