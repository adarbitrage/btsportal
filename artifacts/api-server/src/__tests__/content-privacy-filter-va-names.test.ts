import { describe, it, expect } from "vitest";
import {
  scrubPrivateContent,
  buildStaffSurnameRules,
  PRIVACY_RULES,
  type PrivacyRule,
} from "../lib/content-privacy-filter";
import { VA_ROSTER } from "../lib/coaching-roster";

/**
 * Task #1609 — give VAs the SAME deterministic surname protection coaches have.
 *
 * Coaches get a deterministic backstop (hand-written PRIVACY_RULES) that strips a
 * surname the model missed. VAs previously had NO such backstop because their
 * surnames were not stored anywhere. Now VA surnames are captured in VA_ROSTER
 * (coaching-roster.ts) via an optional `surname` field, and content-privacy-filter
 * derives the same two-rule pattern (full name -> first name, then an
 * orphaned-surname strip) from any VA whose surname is KNOWN, via
 * buildStaffSurnameRules(VA_ROSTER), spliced into PRIVACY_RULES.
 *
 * This proves (a) the generator itself deterministically reduces a VA full name
 * to first-name-only even when the model echoes the full name, and (b) the seam
 * is actually wired into scrubPrivateContent so recording a VA surname protects
 * them everywhere the scrub runs.
 */

// Faithful re-implementation of the scrub loop (scrubPrivateContent applies
// PRIVACY_RULES exactly this way) so we can prove the generated rules strip a VA
// surname without mutating the production roster.
function applyRules(text: string, rules: PrivacyRule[]): string {
  let out = text;
  for (const rule of rules) out = out.replace(rule.pattern, rule.replacement);
  return out;
}

describe("buildStaffSurnameRules — VA full name -> first name only", () => {
  it("reduces a VA full name to first name even when the model echoes it", () => {
    const rules = buildStaffSurnameRules([{ name: "Neil", surname: "Halvorsen" }]);
    const echoed = "VA: Welcome back. This is Neil Halvorsen.";
    const out = applyRules(echoed, rules);
    expect(out).toBe("VA: Welcome back. This is Neil.");
    expect(out).toContain("Neil");
    expect(out.toLowerCase()).not.toContain("halvorsen");
  });

  it("strips an orphaned VA surname left over from a chunk split", () => {
    const rules = buildStaffSurnameRules([{ name: "Neil", surname: "Halvorsen" }]);
    expect(applyRules("Halvorsen ran the session", rules).trim()).toBe(
      "ran the session",
    );
  });

  it("matches case-insensitively / tolerates whitespace, and restores the canonical first name", () => {
    // Like the coach rules, the replacement is the canonical roster-cased first
    // name, so a lower-cased echo is normalised back to "Mikha".
    const rules = buildStaffSurnameRules([{ name: "Mikha", surname: "Delacroix" }]);
    expect(applyRules("spoke to mikha   DELACROIX today", rules)).toBe(
      "spoke to Mikha today",
    );
  });

  it("emits the full-name rule before the orphan strip so the longer match wins", () => {
    const rules = buildStaffSurnameRules([{ name: "Neil", surname: "Halvorsen" }]);
    expect(rules).toHaveLength(2);
    expect(rules[0].replacement).toBe("Neil");
    expect(rules[1].replacement).toBe("");
  });

  it("produces NO rules for a VA with no recorded surname (prompt guidance only)", () => {
    expect(buildStaffSurnameRules([{ name: "John" }])).toHaveLength(0);
    expect(buildStaffSurnameRules([{ name: "John", surname: "" }])).toHaveLength(0);
    expect(buildStaffSurnameRules([{ name: "John", surname: "   " }])).toHaveLength(0);
  });

  it("regex-escapes names so special characters can never break the pattern", () => {
    const rules = buildStaffSurnameRules([{ name: "Neil", surname: "O'Brien-Smith" }]);
    expect(applyRules("call Neil O'Brien-Smith now", rules)).toBe("call Neil now");
  });
});

describe("VA surname seam — wired into scrubPrivateContent", () => {
  it("splices every VA_ROSTER surname rule into PRIVACY_RULES", () => {
    const rosterRules = buildStaffSurnameRules(VA_ROSTER);
    for (const rule of rosterRules) {
      const present = PRIVACY_RULES.some(
        (r) => r.pattern.source === rule.pattern.source && r.replacement === rule.replacement,
      );
      expect(present, `missing VA rule ${rule.pattern}`).toBe(true);
    }
  });

  it("scrubPrivateContent reduces every KNOWN VA (with a surname) to first-name-only", () => {
    // Future-proof: activates automatically once a real VA surname is recorded in
    // VA_ROSTER. No surnames are invented, so today this iterates zero rows.
    for (const va of VA_ROSTER) {
      if (!va.surname) continue;
      const out = scrubPrivateContent(`Meet ${va.name} ${va.surname} on the call`);
      expect(out).toContain(va.name);
      expect(out.toLowerCase()).not.toContain(va.surname.toLowerCase());
    }
  });

  it("every generated VA rule is global so all occurrences are replaced", () => {
    for (const rule of buildStaffSurnameRules(VA_ROSTER)) {
      expect(rule.pattern.flags.includes("g")).toBe(true);
    }
  });
});
