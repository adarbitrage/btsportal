import { describe, it, expect } from "vitest";
import {
  scopeHasCalendarAccess,
  CALENDAR_FREEBUSY_SCOPE,
} from "../lib/google-oauth";

// The calendar free/busy scope was added additively to the per-coach Google
// OAuth. Connections made before that change lack the scope, so conflict
// detection silently returns nothing. We detect that "Drive-only" state from
// the stored scope string and prompt the coach to reconnect — so lock the
// detection down here: a regression that mis-classifies a stale grant as
// up-to-date would re-bury the reconnect prompt.

describe("scopeHasCalendarAccess", () => {
  it("returns false for an empty / null scope", () => {
    expect(scopeHasCalendarAccess(null)).toBe(false);
    expect(scopeHasCalendarAccess(undefined)).toBe(false);
    expect(scopeHasCalendarAccess("")).toBe(false);
  });

  it("returns false for a Drive-only (pre-calendar-scope) grant", () => {
    const scope =
      "https://www.googleapis.com/auth/drive.readonly openid email";
    expect(scopeHasCalendarAccess(scope)).toBe(false);
  });

  it("returns true when the calendar free/busy scope is present", () => {
    const scope = `https://www.googleapis.com/auth/drive.readonly ${CALENDAR_FREEBUSY_SCOPE} openid email`;
    expect(scopeHasCalendarAccess(scope)).toBe(true);
  });

  it("does not match on a substring of a different scope", () => {
    // A scope that merely contains the string as a prefix of a longer path must
    // not be treated as the calendar scope.
    const scope = `${CALENDAR_FREEBUSY_SCOPE}.readonly`;
    expect(scopeHasCalendarAccess(scope)).toBe(false);
  });
});
