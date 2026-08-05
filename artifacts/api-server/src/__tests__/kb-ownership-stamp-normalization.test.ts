/**
 * Seven-pillars ownership stamp — normalized-title identity (Aug 2026).
 *
 * The boot stamp originally matched docs by EXACT title, which silently missed
 * prod's copy of "The 7 Pillars of a Profitable Digital Business" (no ™). The
 * stamp now matches on normalized identity: lowercase, all non-alphanumeric
 * runs stripped — full-title equality only, no substring matching. These tests
 * lock the TS normalizer to that contract; the SQL side must use the
 * equivalent regexp_replace(lower(title), '[^a-z0-9]+', '', 'g').
 */
import { describe, it, expect } from "vitest";
import {
  SEVEN_PILLARS_TITLES,
  normalizeKbDocTitle,
} from "../lib/bootstrap-critical-prerequisites";

const normalizedSet = new Set(SEVEN_PILLARS_TITLES.map(normalizeKbDocTitle));

describe("seven-pillars stamp normalization", () => {
  it("canonical titles normalize to distinct identities", () => {
    expect(normalizedSet.size).toBe(SEVEN_PILLARS_TITLES.length);
  });

  it("matches the prod title variant without the ™ character", () => {
    expect(
      normalizedSet.has(
        normalizeKbDocTitle("The 7 Pillars of a Profitable Digital Business"),
      ),
    ).toBe(true);
  });

  it("tolerates punctuation, casing, and whitespace drift", () => {
    expect(
      normalizedSet.has(
        normalizeKbDocTitle(
          "  the 7 pillars(tm) of a profitable digital business!  ".replace("(tm)", ""),
        ),
      ),
    ).toBe(true);
    expect(
      normalizedSet.has(
        normalizeKbDocTitle("BTS Blitz Overview — How Build, Test, Scale Maps to the 7 Pillars"),
      ),
    ).toBe(true);
  });

  it("does NOT match partial or unrelated titles (no substring over-match)", () => {
    expect(normalizedSet.has(normalizeKbDocTitle("The 7 Pillars"))).toBe(false);
    expect(
      normalizedSet.has(normalizeKbDocTitle("Configure Caterpillar and Go Live")),
    ).toBe(false);
    expect(
      normalizedSet.has(
        normalizeKbDocTitle(
          "The 7 Pillars of a Profitable Digital Business — Part 2",
        ),
      ),
    ).toBe(false);
  });

  it("SQL and TS normalizers agree on the ™ variant", () => {
    // Mirror of regexp_replace(lower(title), '[^a-z0-9]+', '', 'g')
    const sqlLike = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, "");
    for (const t of SEVEN_PILLARS_TITLES) {
      expect(normalizeKbDocTitle(t)).toBe(sqlLike(t));
    }
  });
});
