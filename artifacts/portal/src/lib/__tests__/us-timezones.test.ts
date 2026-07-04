import { describe, it, expect } from "vitest";
import {
  US_TIMEZONES,
  OTHER_TIMEZONE_VALUE,
  mapToUsTimezone,
  isUsTimezone,
  getUsTimezoneLabel,
} from "@/lib/us-timezones";

describe("US_TIMEZONES", () => {
  it("has exactly the seven canonical US options", () => {
    expect(US_TIMEZONES.map((tz) => tz.value)).toEqual([
      "America/New_York",
      "America/Chicago",
      "America/Denver",
      "America/Phoenix",
      "America/Los_Angeles",
      "America/Anchorage",
      "Pacific/Honolulu",
    ]);
  });

  it("uses friendly labels", () => {
    expect(getUsTimezoneLabel("America/New_York")).toBe("Eastern Time (ET)");
    expect(getUsTimezoneLabel("America/Chicago")).toBe("Central Time (CT)");
    expect(getUsTimezoneLabel("America/Denver")).toBe("Mountain Time (MT)");
    expect(getUsTimezoneLabel("America/Phoenix")).toBe("Arizona (no DST)");
    expect(getUsTimezoneLabel("America/Los_Angeles")).toBe("Pacific Time (PT)");
    expect(getUsTimezoneLabel("America/Anchorage")).toBe("Alaska (AKT)");
    expect(getUsTimezoneLabel("Pacific/Honolulu")).toBe("Hawaii (HT)");
  });
});

describe("mapToUsTimezone", () => {
  it("returns the same value for an exact canonical match", () => {
    expect(mapToUsTimezone("America/Chicago")).toBe("America/Chicago");
  });

  it("maps a non-canonical US zone to the nearest canonical option", () => {
    expect(mapToUsTimezone("America/Detroit")).toBe("America/New_York");
    expect(mapToUsTimezone("America/Indiana/Indianapolis")).toBe("America/New_York");
    expect(mapToUsTimezone("America/Boise")).toBe("America/Denver");
    expect(mapToUsTimezone("America/Menominee")).toBe("America/Chicago");
    expect(mapToUsTimezone("America/Juneau")).toBe("America/Anchorage");
  });

  it("returns null for a non-US zone", () => {
    expect(mapToUsTimezone("Asia/Tokyo")).toBeNull();
    expect(mapToUsTimezone("Europe/London")).toBeNull();
  });

  it("returns null for empty/undefined input", () => {
    expect(mapToUsTimezone(undefined)).toBeNull();
    expect(mapToUsTimezone(null)).toBeNull();
    expect(mapToUsTimezone("")).toBeNull();
  });
});

describe("isUsTimezone", () => {
  it("is true for canonical and aliased US zones", () => {
    expect(isUsTimezone("America/Chicago")).toBe(true);
    expect(isUsTimezone("America/Detroit")).toBe(true);
  });

  it("is false for non-US zones", () => {
    expect(isUsTimezone("Asia/Tokyo")).toBe(false);
  });
});

describe("OTHER_TIMEZONE_VALUE", () => {
  it("is not a real IANA timezone (never collides with a stored value)", () => {
    expect(Intl.supportedValuesOf("timeZone")).not.toContain(OTHER_TIMEZONE_VALUE);
  });
});
