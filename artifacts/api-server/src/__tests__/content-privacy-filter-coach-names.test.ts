import { describe, it, expect } from "vitest";
import { scrubPrivateContent, PRIVACY_RULES } from "../lib/content-privacy-filter";
import { COACHING_ROSTER } from "../lib/coaching-roster";

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

describe("content privacy filter — old-brand rebrand (founder -> Adam, company/program -> BTS)", () => {
  // Founder's personal name (both spellings) -> first name only.
  const founderCases: Array<{ input: string; expected: string }> = [
    { input: "Adam Cherrington teaches the method", expected: "Adam teaches the method" },
    { input: "Adam Charrington teaches the method", expected: "Adam teaches the method" },
  ];

  for (const { input, expected } of founderCases) {
    it(`reduces founder to first name: "${input}"`, () => {
      expect(scrubPrivateContent(input)).toBe(expected);
    });
  }

  // Company / program references (both spellings + garbled/phonetic variants)
  // -> BTS.
  const companyCases: Array<{ input: string; expected: string }> = [
    // The Cherrington Experience -> BTS
    { input: "join The Cherrington Experience now", expected: "join BTS now" },
    { input: "join the Charrington Experience now", expected: "join BTS now" },
    // <brand> Media Support -> BTS Support
    { input: "email Cherrington Media Support now", expected: "email BTS Support now" },
    { input: "email Charrington Media Support now", expected: "email BTS Support now" },
    // <brand>media (single token) -> BTS
    { input: "reach cherringtonmedia for help", expected: "reach BTS for help" },
    { input: "reach charringtonmedia for help", expected: "reach BTS for help" },
    // <brand> Media -> BTS
    { input: "the Cherrington Media team", expected: "the BTS team" },
    { input: "the Cherringtong Media team", expected: "the BTS team" },
    // <brand> Mentees -> BTS members
    { input: "join Cherrington Mentees today", expected: "join BTS members today" },
    // <brand> Support -> BTS Support
    { input: "ask Cherrington Support please", expected: "ask BTS Support please" },
    // Garbled/phonetic program-name variant -> BTS
    { input: "learn the Cherring method today", expected: "learn the BTS today" },
    { input: "learn the Charring method today", expected: "learn the BTS today" },
    // Old program acronym -> BTS
    { input: "welcome to TCE everyone", expected: "welcome to BTS everyone" },
    // bare <brand> -> BTS (with/without trailing g)
    { input: "the Cherrington program", expected: "the BTS program" },
    { input: "the Charrington program", expected: "the BTS program" },
    { input: "the Cherringtong program", expected: "the BTS program" },
  ];

  for (const { input, expected } of companyCases) {
    it(`rebrands to BTS: "${input}"`, () => {
      expect(scrubPrivateContent(input)).toBe(expected);
    });
  }

  it("never leaks the old brand surname in any spelling", () => {
    const out = scrubPrivateContent(
      "Adam Cherrington and the Charrington Media team plus Cherrington Support.",
    );
    expect(out.toLowerCase()).not.toContain("cherrington");
    expect(out.toLowerCase()).not.toContain("charrington");
  });

  it("rebrands a mixed paragraph without leaving any old-brand token", () => {
    const out = scrubPrivateContent(
      "Adam Cherrington founded The Cherrington Experience, also called TCE and the Cherring method.",
    );
    expect(out.toLowerCase()).not.toContain("cherrington");
    expect(out.toLowerCase()).not.toContain("charrington");
    expect(out.toLowerCase()).not.toContain("cherring");
    expect(out).not.toMatch(/\bTCE\b/);
    expect(out).toContain("Adam");
    expect(out).toContain("BTS");
  });
});

/**
 * ROSTER <-> SCRUB GUARD.
 *
 * The live coaching roster (COACHING_ROSTER in lib/coaching-roster.ts) and the
 * deterministic scrub rules (PRIVACY_RULES) are maintained in two different
 * files. If a coach is added to the roster but no matching scrub rule is added,
 * their surname could silently leak into mined AI content. This block ties the
 * two together: for EVERY roster coach that declares a known surname, the
 * scrubber must reduce "First Surname" to just "First".
 *
 * Design decision (documented on RosterCoach.knownSurnames in coaching-roster.ts):
 * we do NOT auto-derive scrub rules from the roster because (1) the pure
 * content-privacy-filter module has no DB dependency and importing the DB-backed
 * roster would couple it to the data layer, and (2) surnames appear with spelling
 * variants in source content that need regex flexibility a plain string cannot
 * express. Instead the roster carries a declarative `knownSurnames` list and this
 * guard forces a scrub rule to exist for each — so adding a coach with a known
 * surname without a scrub rule fails CI. (Surnames the org does not know stay
 * omitted; nothing can scrub an unknown name, and the LLM prompt guidance in
 * buildStaffFirstNameGuidance is the roster-driven backstop for those.)
 */
describe("content privacy filter — every rostered coach surname is scrubbed", () => {
  const coachesWithSurnames = COACHING_ROSTER.filter(
    (c) => (c.knownSurnames?.length ?? 0) > 0,
  );

  it("has at least one rostered coach with a known surname to guard", () => {
    // Sanity: if this ever hits zero the guard below would silently pass with no
    // assertions, defeating its purpose.
    expect(coachesWithSurnames.length).toBeGreaterThan(0);
  });

  for (const coach of coachesWithSurnames) {
    for (const surname of coach.knownSurnames!) {
      it(`scrubs rostered coach "${coach.name} ${surname}" to just "${coach.name}"`, () => {
        const out = scrubPrivateContent(`Join ${coach.name} ${surname} on the call`);
        expect(out).toBe(`Join ${coach.name} on the call`);
        expect(out).toContain(coach.name);
        expect(out.toLowerCase()).not.toContain(surname.toLowerCase());
      });

      it(`strips the orphaned rostered surname "${surname}"`, () => {
        // A chunk split can leave a bare surname with no first name attached.
        const out = scrubPrivateContent(`${surname} ran the session`);
        expect(out.toLowerCase()).not.toContain(surname.toLowerCase());
      });
    }
  }
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
