import { describe, it, expect } from "vitest";
import {
  getMemberTimezone,
  formatMemberTime,
  formatMemberDate,
  formatMemberDateTime,
  formatMemberFullDateTime,
} from "@/lib/member-timezone";

// Task #1625: shared member-timezone formatter must show DST-correct zone
// abbreviations (CST in January, CDT in July for America/Chicago) derived
// live from Intl at render time — never a hardcoded string — and must fall
// back to the browser's local timezone when the member has none set.

describe("getMemberTimezone", () => {
  it("returns the member's stored timezone when present", () => {
    expect(getMemberTimezone("America/New_York")).toBe("America/New_York");
  });

  it("falls back to the browser's local timezone when undefined", () => {
    const expected = Intl.DateTimeFormat().resolvedOptions().timeZone;
    expect(getMemberTimezone(undefined)).toBe(expected);
  });

  it("falls back to the browser's local timezone when null", () => {
    const expected = Intl.DateTimeFormat().resolvedOptions().timeZone;
    expect(getMemberTimezone(null)).toBe(expected);
  });

  it("falls back to the browser's local timezone when an empty/whitespace string", () => {
    const expected = Intl.DateTimeFormat().resolvedOptions().timeZone;
    expect(getMemberTimezone("   ")).toBe(expected);
  });
});

describe("formatMemberTime — DST-correct zone abbreviation (America/Chicago)", () => {
  it("renders CST for a January date (standard time)", () => {
    const jan = new Date("2026-01-15T15:00:00.000Z"); // 9:00 AM CST
    const result = formatMemberTime(jan, "America/Chicago");
    expect(result).toContain("9:00");
    expect(result).toContain("CST");
    expect(result).not.toContain("CDT");
  });

  it("renders CDT for a July date (daylight time)", () => {
    const jul = new Date("2026-07-15T14:00:00.000Z"); // 9:00 AM CDT
    const result = formatMemberTime(jul, "America/Chicago");
    expect(result).toContain("9:00");
    expect(result).toContain("CDT");
    expect(result).not.toContain("CST");
  });

  it("accepts an ISO string as well as a Date", () => {
    const result = formatMemberTime("2026-07-15T14:00:00.000Z", "America/Chicago");
    expect(result).toContain("CDT");
  });
});

describe("formatMemberDate", () => {
  it("formats a date without a time component", () => {
    const result = formatMemberDate("2026-07-03T14:00:00.000Z", "America/Chicago");
    expect(result).toBe("Jul 3, 2026");
  });
});

describe("formatMemberDateTime", () => {
  it("combines a short date with the DST-correct time", () => {
    const janResult = formatMemberDateTime("2026-01-15T15:00:00.000Z", "America/Chicago");
    expect(janResult).toContain("Jan 15");
    expect(janResult).toContain("CST");

    const julResult = formatMemberDateTime("2026-07-15T14:00:00.000Z", "America/Chicago");
    expect(julResult).toContain("Jul 15");
    expect(julResult).toContain("CDT");
  });
});

describe("formatMemberFullDateTime", () => {
  it("renders the full weekday/month/day/year plus DST-correct time", () => {
    const result = formatMemberFullDateTime("2026-07-15T14:00:00.000Z", "America/Chicago");
    expect(result).toContain("Wednesday");
    expect(result).toContain("July 15, 2026");
    expect(result).toContain("9:00");
    expect(result).toContain("CDT");
  });

  it("renders CST for a January full date", () => {
    const result = formatMemberFullDateTime("2026-01-15T15:00:00.000Z", "America/Chicago");
    expect(result).toContain("January 15, 2026");
    expect(result).toContain("CST");
  });
});

describe("formatMemberTime across a non-US timezone (sanity, no DST assumptions)", () => {
  it("formats correctly for a fixed-offset zone with no DST", () => {
    const result = formatMemberTime("2026-07-15T14:00:00.000Z", "Asia/Tokyo");
    // Tokyo has no DST and is UTC+9, so 14:00 UTC = 23:00 JST.
    expect(result).toContain("11:00");
    expect(result).toContain("PM");
  });
});
