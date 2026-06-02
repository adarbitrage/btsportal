import { describe, expect, it } from "vitest";
import {
  STALE_WINDOW_MULTIPLIER,
  isPodStale,
  staleThresholdMsForWindow,
} from "./index";

const WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const STALE_MS = WINDOW_MS * 2; // 2x the window
const NOW = Date.parse("2026-06-02T12:00:00.000Z");

function isoAgo(ms: number): string {
  return new Date(NOW - ms).toISOString();
}

describe("staleness rule (shared by System Health card and on-call alerter)", () => {
  // This is the contract both `isPodStale` (SystemHealth.tsx) and
  // `isPodSilent` (failure-alerter.ts) consume. Changing either of these
  // assertions means the page and the page-on-call would disagree — which is
  // exactly the drift this test exists to catch.
  it("pins the 2x rolling-window factor", () => {
    expect(STALE_WINDOW_MULTIPLIER).toBe(2);
    expect(staleThresholdMsForWindow(WINDOW_MS)).toBe(WINDOW_MS * 2);
  });

  it("treats a non-positive or non-finite window as never-stale (0 threshold)", () => {
    expect(staleThresholdMsForWindow(0)).toBe(0);
    expect(staleThresholdMsForWindow(-1)).toBe(0);
    expect(staleThresholdMsForWindow(Number.NaN)).toBe(0);
    expect(staleThresholdMsForWindow(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it("gates on totalCount === 0 (a pod with in-window failures is never stale)", () => {
    // Even if its lastAt is ancient, a pod that reported failures in-window
    // is NOT stale: its presence in the breakdown is the point.
    expect(
      isPodStale({ totalCount: 1, lastAt: isoAgo(STALE_MS * 10) }, NOW, STALE_MS),
    ).toBe(false);
  });

  it("flags a silent pod once its last report is older than 2x the window", () => {
    expect(
      isPodStale({ totalCount: 0, lastAt: isoAgo(STALE_MS + 1) }, NOW, STALE_MS),
    ).toBe(true);
  });

  it("does not flag a pod reporting within the threshold", () => {
    expect(
      isPodStale({ totalCount: 0, lastAt: isoAgo(STALE_MS - 1) }, NOW, STALE_MS),
    ).toBe(false);
  });

  it("uses a strict greater-than: exactly at the threshold is not stale", () => {
    expect(
      isPodStale({ totalCount: 0, lastAt: isoAgo(STALE_MS) }, NOW, STALE_MS),
    ).toBe(false);
  });

  it("returns false for a pod that never reported (lastAt === null)", () => {
    expect(isPodStale({ totalCount: 0, lastAt: null }, NOW, STALE_MS)).toBe(false);
  });

  it("returns false for an unparseable lastAt", () => {
    expect(
      isPodStale({ totalCount: 0, lastAt: "not-a-date" }, NOW, STALE_MS),
    ).toBe(false);
  });

  it("returns false when the threshold is 0 or now is non-finite", () => {
    expect(isPodStale({ totalCount: 0, lastAt: isoAgo(STALE_MS + 1) }, NOW, 0)).toBe(
      false,
    );
    expect(
      isPodStale(
        { totalCount: 0, lastAt: isoAgo(STALE_MS + 1) },
        Number.NaN,
        STALE_MS,
      ),
    ).toBe(false);
  });
});
