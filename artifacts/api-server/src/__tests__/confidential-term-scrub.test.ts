import { describe, it, expect } from "vitest";
import {
  scrubConfidentialTerm,
  containsConfidentialTerm,
} from "../lib/confidential-term-repair";

/**
 * Pin the deterministic rewording that purges the confidential traffic-source
 * name behind the "Caterpillar" codename from KB/Blitz content.
 *
 * The name itself must never appear in source (repo-wide case-insensitive
 * grep must return zero), so every fixture assembles it from parts at runtime.
 */

// The confidential name, assembled so it never appears literally in source.
const NAME = ["News", "Break"].join("");

describe("scrubConfidentialTerm", () => {
  it("rewrites `Caterpillar (<name>)` to `Caterpillar`", () => {
    const input = `## Asset Requirements for Caterpillar (${NAME}) Native Ads`;
    expect(scrubConfidentialTerm(input)).toBe(
      "## Asset Requirements for Caterpillar Native Ads",
    );
  });

  it("removes the parenthesised `internal codename for <name>` phrase", () => {
    const input = `Caterpillar: Native ad publisher (internal codename for ${NAME}). Best for long-form native ads.`;
    expect(scrubConfidentialTerm(input)).toBe(
      "Caterpillar: Native ad publisher. Best for long-form native ads.",
    );
  });

  it("rewrites `Caterpillar/<name>\u2011style` keeping the original dash", () => {
    const input = `- Native path (e.g., Caterpillar/${NAME}\u2011style)`;
    expect(scrubConfidentialTerm(input)).toBe(
      "- Native path (e.g., Caterpillar\u2011style)",
    );
  });

  it("rewrites `Caterpillar/<name> native ads` to `Caterpillar native ads`", () => {
    const input = `- Headlines character limit: 90 characters (for Caterpillar/${NAME} native ads).`;
    expect(scrubConfidentialTerm(input)).toBe(
      "- Headlines character limit: 90 characters (for Caterpillar native ads).",
    );
  });

  it("rewrites `<name> native ads (Caterpillar)` without doubling the codename", () => {
    const input = `- Placement/traffic source: ${NAME} native ads (Caterpillar)`;
    expect(scrubConfidentialTerm(input)).toBe(
      "- Placement/traffic source: Caterpillar native ads",
    );
  });

  it("rewrites standalone `<name> native ads` to `Caterpillar native ads`", () => {
    const input = `Placement-specific guidance for ${NAME} native ads including image size.`;
    expect(scrubConfidentialTerm(input)).toBe(
      "Placement-specific guidance for Caterpillar native ads including image size.",
    );
  });

  it("falls back to the codename for any remaining standalone mention", () => {
    const input = `We also tried ${NAME} last quarter.`;
    expect(scrubConfidentialTerm(input)).toBe("We also tried Caterpillar last quarter.");
  });

  it("is case-insensitive and tolerates a space inside the name", () => {
    const spaced = ["news", "break"].join(" ");
    expect(scrubConfidentialTerm(`Caterpillar (${NAME.toUpperCase()}) ads`)).toBe(
      "Caterpillar ads",
    );
    expect(scrubConfidentialTerm(`Runs on ${spaced} native ads.`)).toBe(
      "Runs on Caterpillar native ads.",
    );
  });

  it("never leaves a mention behind, and is idempotent", () => {
    const inputs = [
      `Caterpillar (${NAME}) plus Caterpillar/${NAME} and plain ${NAME}.`,
      `Publisher (internal codename for ${NAME}). ${NAME} native ads (Caterpillar).`,
    ];
    for (const input of inputs) {
      const once = scrubConfidentialTerm(input);
      expect(containsConfidentialTerm(once)).toBe(false);
      expect(scrubConfidentialTerm(once)).toBe(once);
    }
  });

  it("leaves clean text untouched", () => {
    const clean =
      "Caterpillar: Native ad publisher. Grasshopper and Crane are display publishers.";
    expect(scrubConfidentialTerm(clean)).toBe(clean);
    expect(containsConfidentialTerm(clean)).toBe(false);
  });
});
