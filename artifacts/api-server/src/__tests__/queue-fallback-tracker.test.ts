import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  recordQueueFallback,
  getQueueFallbackStats,
  __resetQueueFallbackTrackerForTests,
} from "../lib/queue-fallback-tracker";

describe("queue-fallback-tracker", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    __resetQueueFallbackTrackerForTests();
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    logSpy.mockRestore();
    vi.useRealTimers();
  });

  it("records each fallback event with a structured log line", () => {
    recordQueueFallback("email", { recipient: "alice@example.com", reason: "queue_unavailable" });

    expect(logSpy).toHaveBeenCalled();
    const line = logSpy.mock.calls[0][0] as string;
    expect(line).toContain("[Comms][Fallback]");
    expect(line).toContain("channel=email");
    expect(line).toContain("recipient=alice@example.com");
    expect(line).toContain("reason=queue_unavailable");
  });

  it("counts fallbacks per channel and exposes them via getQueueFallbackStats", () => {
    recordQueueFallback("email");
    recordQueueFallback("email");
    recordQueueFallback("sms");

    const stats = getQueueFallbackStats();
    expect(stats.email.recentCount).toBe(2);
    expect(stats.email.hourCount).toBe(2);
    expect(stats.email.dayCount).toBe(2);
    expect(stats.sms.recentCount).toBe(1);
    expect(stats.alerting).toBe(true);
    expect(stats.email.lastAt).not.toBeNull();
    expect(stats.sms.lastAt).not.toBeNull();
  });

  it("emits an [ALERT] warning the first time a channel falls back", () => {
    recordQueueFallback("email");

    const alertCall = warnSpy.mock.calls.find((c) =>
      typeof c[0] === "string" && c[0].includes("[Comms][ALERT]"),
    );
    expect(alertCall).toBeDefined();
    expect(alertCall![0]).toContain("email");
  });

  it("throttles repeated alert warnings within the throttle window", () => {
    // 5 fallbacks in quick succession should produce exactly one ALERT.
    for (let i = 0; i < 5; i++) recordQueueFallback("email");

    const alertCalls = warnSpy.mock.calls.filter((c) =>
      typeof c[0] === "string" && c[0].includes("[Comms][ALERT]"),
    );
    expect(alertCalls).toHaveLength(1);
  });

  it("re-alerts after the throttle window passes", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));

    recordQueueFallback("email");

    // Advance past both the recent window and the alert throttle (>5m).
    vi.setSystemTime(new Date("2026-01-01T00:06:00Z"));
    recordQueueFallback("email");

    const alertCalls = warnSpy.mock.calls.filter((c) =>
      typeof c[0] === "string" && c[0].includes("[Comms][ALERT]"),
    );
    expect(alertCalls).toHaveLength(2);
  });

  it("only reports alerting=true while events are inside the recent window", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));

    recordQueueFallback("email");
    expect(getQueueFallbackStats().alerting).toBe(true);

    // Move 10 minutes ahead — the event should fall out of the recent window.
    vi.setSystemTime(new Date("2026-01-01T00:10:00Z"));
    const stats = getQueueFallbackStats();
    expect(stats.alerting).toBe(false);
    expect(stats.email.recentCount).toBe(0);
    // But it should still appear in the 1h and 24h counts.
    expect(stats.email.hourCount).toBe(1);
    expect(stats.email.dayCount).toBe(1);
  });

  it("prunes events older than 24 hours", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));

    recordQueueFallback("email");

    vi.setSystemTime(new Date("2026-01-02T01:00:00Z"));
    const stats = getQueueFallbackStats();
    expect(stats.email.dayCount).toBe(0);
    expect(stats.email.recentCount).toBe(0);
  });

  it("tracks email and sms channels independently", () => {
    recordQueueFallback("email");
    recordQueueFallback("email");

    const stats = getQueueFallbackStats();
    expect(stats.email.recentCount).toBe(2);
    expect(stats.sms.recentCount).toBe(0);
    expect(stats.sms.lastAt).toBeNull();
  });
});
