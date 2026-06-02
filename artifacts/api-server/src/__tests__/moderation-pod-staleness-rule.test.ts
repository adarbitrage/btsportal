import { describe, expect, it } from "vitest";
import {
  STALE_WINDOW_MULTIPLIER,
  isPodStale,
  staleThresholdMsForWindow,
} from "@workspace/moderation-shared";

/**
 * Drift guard for the "pod is stale / silent" rule.
 *
 * The rule (zero in-window failures AND last report older than 2x the rolling
 * window) is consumed in two places that must never disagree:
 *   - the System Health card (`isPodStale` in `SystemHealth.tsx`), and
 *   - the on-call alerter (`isPodSilent` -> `evaluateModerationPodSilentAlert`
 *     in `failure-alerter.ts`).
 *
 * Both import the single source of truth in `@workspace/moderation-shared`, so
 * the formula physically cannot drift between them. This test runs in the
 * api-server validation suite and pins that shared contract — the 2x factor
 * and the `totalCount === 0` gate — so weakening either one fails CI.
 */
const WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const STALE_MS = WINDOW_MS * 2; // 2x the window
const NOW = Date.parse("2026-06-02T12:00:00.000Z");

function isoAgo(ms: number): string {
  return new Date(NOW - ms).toISOString();
}

describe("moderation pod staleness rule (shared by dashboard + on-call alerter)", () => {
  it("pins the 2x rolling-window factor", () => {
    expect(STALE_WINDOW_MULTIPLIER).toBe(2);
    expect(staleThresholdMsForWindow(WINDOW_MS)).toBe(WINDOW_MS * 2);
  });

  it("gates on totalCount === 0 — a pod with in-window failures is never stale", () => {
    expect(
      isPodStale({ totalCount: 1, lastAt: isoAgo(STALE_MS * 10) }, NOW, STALE_MS),
    ).toBe(false);
  });

  it("flags a silent pod once its last report is older than 2x the window", () => {
    expect(
      isPodStale({ totalCount: 0, lastAt: isoAgo(STALE_MS + 1) }, NOW, STALE_MS),
    ).toBe(true);
  });

  it("does not flag a pod still reporting within the threshold", () => {
    expect(
      isPodStale({ totalCount: 0, lastAt: isoAgo(STALE_MS - 1) }, NOW, STALE_MS),
    ).toBe(false);
  });

  it("uses strict greater-than: exactly at the threshold is not stale", () => {
    expect(
      isPodStale({ totalCount: 0, lastAt: isoAgo(STALE_MS) }, NOW, STALE_MS),
    ).toBe(false);
  });

  it("returns false for a never-reported pod (lastAt === null)", () => {
    expect(isPodStale({ totalCount: 0, lastAt: null }, NOW, STALE_MS)).toBe(false);
  });
});
