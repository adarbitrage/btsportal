import { describe, it, expect } from "vitest";
import { scrubPrivateContent, PRIVACY_RULES } from "../lib/content-privacy-filter";

/**
 * Direct unit tests for the privacy scrubber's own rule table
 * (`PRIVACY_RULES` in lib/content-privacy-filter.ts).
 *
 * Every knowledge-base write path (admin create/edit, staging push-to-live,
 * bulk seed import) is separately pinned to confirm it CALLS scrubPrivateContent.
 * Those tests don't, however, prove the scrubber itself removes every forbidden
 * name and every spelling variant. This file does: it calls scrubPrivateContent()
 * directly with each full name + each known spelling variant, and asserts the
 * surname is gone while the first name (where applicable) survives — plus the
 * orphaned-surname rules and the agency-name rules.
 *
 * If a future edit breaks one variant, reorders the rules so a bare surname
 * matches before its full-name rule, or drops a rule, one of these fails.
 */

describe("content privacy filter — coach full names -> first name only", () => {
  // Each entry: every full-name spelling variant the rule must collapse to the
  // coach's first name. Variants reflect the character classes in the actual
  // regexes (e.g. Bob[iy]lev, Wiss?baum, Shep[ah]rd).
  const fullNameCases: Array<{
    first: string;
    surname: string;
    variants: string[];
  }> = [
    { first: "Sasha", surname: "Bobylev", variants: ["Bobylev", "Bobilev"] },
    { first: "Bruce", surname: "Clark", variants: ["Clark"] },
    { first: "Michael", surname: "Wissbaum", variants: ["Wissbaum", "Wisbaum"] },
    { first: "Todd", surname: "Rupp", variants: ["Rupp"] },
    { first: "Robin", surname: "Shepard", variants: ["Shepard", "Shephrd"] },
  ];

  for (const { first, surname, variants } of fullNameCases) {
    for (const variant of variants) {
      it(`replaces "${first} ${variant}" with just "${first}"`, () => {
        const out = scrubPrivateContent(`Join ${first} ${variant} on the call`);
        expect(out).toBe(`Join ${first} on the call`);
        // First name survives, surname (any casing) is gone.
        expect(out).toContain(first);
        expect(out.toLowerCase()).not.toContain(variant.toLowerCase());
      });

      it(`handles "${first} ${variant}" case-insensitively`, () => {
        const out = scrubPrivateContent(
          `talked to ${first.toLowerCase()} ${variant.toUpperCase()} today`,
        );
        expect(out.toLowerCase()).not.toContain(variant.toLowerCase());
        expect(out.toLowerCase()).toContain(first.toLowerCase());
      });
    }
    void surname;
  }

  it("tolerates extra whitespace between first and last name", () => {
    expect(scrubPrivateContent("Sasha   Bobylev hosts")).toBe("Sasha hosts");
    expect(scrubPrivateContent("Michael\tWisbaum hosts")).toBe("Michael hosts");
  });
});

describe("content privacy filter — orphaned coach surnames", () => {
  // Surnames left over from chunk splits, with no first name attached.
  // Most are removed entirely; "Clark" is special-cased to "Bruce".
  const removedOrphans: Array<{ variant: string }> = [
    { variant: "Bobylev" },
    { variant: "Bobilev" },
    { variant: "Wissbaum" },
    { variant: "Wisbaum" },
    { variant: "Rupp" },
    { variant: "Shepard" },
    { variant: "Shephrd" },
  ];

  for (const { variant } of removedOrphans) {
    it(`strips a bare "${variant}"`, () => {
      const out = scrubPrivateContent(`${variant} ran the session`).trim();
      expect(out).toBe("ran the session");
      expect(out.toLowerCase()).not.toContain(variant.toLowerCase());
    });
  }

  it('rewrites a bare "Clark" to "Bruce"', () => {
    expect(scrubPrivateContent("Clark ran the session")).toBe(
      "Bruce ran the session",
    );
  });

  it("never leaks any coach surname in a mixed paragraph", () => {
    const surnames = [
      "Bobylev",
      "Bobilev",
      "Wissbaum",
      "Wisbaum",
      "Rupp",
      "Shepard",
      "Shephrd",
    ];
    const out = scrubPrivateContent(
      "Coaches: Sasha Bobylev, Michael Wisbaum, Todd Rupp, Robin Shepard and Bruce Clark.",
    );
    for (const surname of surnames) {
      expect(out.toLowerCase()).not.toContain(surname.toLowerCase());
    }
    for (const first of ["Sasha", "Michael", "Todd", "Robin", "Bruce"]) {
      expect(out).toContain(first);
    }
  });
});

describe("content privacy filter — agency (Cherrington/Charrington) rules", () => {
  // Both spellings of the agency name must scrub identically.
  const cases: Array<{ input: string; expected: string }> = [
    // Adam <agency> -> the instructor
    { input: "Adam Cherrington teaches the method", expected: "the instructor teaches the method" },
    { input: "Adam Charrington teaches the method", expected: "the instructor teaches the method" },
    // <agency> Media Support -> the support team
    { input: "email Cherrington Media Support now", expected: "email the support team now" },
    { input: "email Charrington Media Support now", expected: "email the support team now" },
    // <agency>media (single token) -> oursupport
    { input: "reach cherringtonmedia for help", expected: "reach oursupport for help" },
    { input: "reach charringtonmedia for help", expected: "reach oursupport for help" },
    // <agency> Media -> the agency
    { input: "the Cherrington Media team", expected: "the agency team" },
    { input: "the Cherringtong Media team", expected: "the agency team" },
    // <agency> Mentees -> the mentees
    { input: "join Cherrington Mentees today", expected: "join the mentees today" },
    // <agency> Support -> support
    { input: "ask Cherrington Support please", expected: "ask support please" },
    // bare <agency> -> the agency (with/without trailing g)
    { input: "the Cherrington program", expected: "the agency program" },
    { input: "the Charrington program", expected: "the agency program" },
    { input: "the Cherringtong program", expected: "the agency program" },
  ];

  for (const { input, expected } of cases) {
    it(`scrubs: "${input}"`, () => {
      expect(scrubPrivateContent(input)).toBe(expected);
    });
  }

  it("never leaks the agency surname in any spelling", () => {
    const out = scrubPrivateContent(
      "Adam Cherrington and the Charrington Media team plus Cherrington Support.",
    );
    expect(out.toLowerCase()).not.toContain("cherrington");
    expect(out.toLowerCase()).not.toContain("charrington");
  });

  it('collapses the "the the <noun>" artifact left by chained rules', () => {
    // "the <agency> Media" -> "the the agency" -> cleanup -> "the agency"
    expect(scrubPrivateContent("the Cherrington Media")).toBe("the agency");
    expect(scrubPrivateContent("the Cherrington")).toBe("the agency");
  });
});

describe("content privacy filter — scrubber invariants", () => {
  it("returns empty string for nullish input", () => {
    expect(scrubPrivateContent(null)).toBe("");
    expect(scrubPrivateContent(undefined)).toBe("");
    expect(scrubPrivateContent("")).toBe("");
  });

  it("leaves clean content (first names + vocabulary) untouched", () => {
    const clean = "Sasha, Bruce, Michael, Todd and Robin host the live calls.";
    expect(scrubPrivateContent(clean)).toBe(clean);
  });

  it("every PRIVACY_RULE uses a global regex so all occurrences are replaced", () => {
    for (const rule of PRIVACY_RULES) {
      expect(
        rule.pattern.flags.includes("g"),
        `Rule ${rule.pattern} must be global so repeated matches are all scrubbed`,
      ).toBe(true);
    }
  });
});
