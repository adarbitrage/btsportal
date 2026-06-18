import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// This suite exercises the 2×-interval staleness arithmetic in
// `getCoachingCallTemplateTopUpStatus` directly. The heavy deps (`@workspace/db`
// and the admin route the job reuses for generation) are mocked so the status
// math can be tested without a database — `getStatus` and the reset hook are
// pure in-memory.
vi.mock("@workspace/db", () => ({
  db: {},
  coachingCallTemplatesTable: {},
}));
vi.mock("../routes/admin-coaching-calls", () => ({
  generateForTemplate: vi.fn(),
}));

import {
  getCoachingCallTemplateTopUpHealth,
  __resetCoachingCallTemplateTopUpStateForTests,
} from "../lib/coaching-call-template-topup";

const BASE = new Date("2026-06-18T00:00:00.000Z").getTime();

describe("getCoachingCallTemplateTopUpStatus staleness", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(BASE);
    // Baseline is captured at reset time (= BASE here).
    __resetCoachingCallTemplateTopUpStateForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("is fresh immediately after start, with no run recorded yet", () => {
    const s = getCoachingCallTemplateTopUpHealth();
    expect(s.stale).toBe(false);
    expect(s.lastRanAt).toBeNull();
    expect(s.lastSuccessfulRunAt).toBeNull();
  });

  it("stays fresh up to exactly 2× the interval after start", () => {
    const { intervalMs } = getCoachingCallTemplateTopUpHealth();
    // Exactly at the 2× boundary — `stale` uses a strict `>`, so still fresh.
    vi.setSystemTime(BASE + 2 * intervalMs);
    expect(getCoachingCallTemplateTopUpHealth().stale).toBe(false);
  });

  it("goes stale once more than 2× the interval elapses without a successful run", () => {
    const { intervalMs } = getCoachingCallTemplateTopUpHealth();
    vi.setSystemTime(BASE + 2 * intervalMs + 1000);
    expect(getCoachingCallTemplateTopUpHealth().stale).toBe(true);
  });
});
