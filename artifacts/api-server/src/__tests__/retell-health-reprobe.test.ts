/**
 * Tests for retell-health-reprobe.ts
 *
 * Guards the passive background re-probe that keeps the cached Voice Assistant
 * health verdict fresh:
 * - runRetellHealthReprobe() writes a fresh result into the module-level cache.
 * - When RETELL_API_KEY / RETELL_AGENT_ID are absent the probe short-circuits to
 *   a "not_configured" verdict WITHOUT instantiating/hitting the Retell SDK.
 * - RETELL_HEALTH_REPROBE_INTERVAL_SECONDS overrides the default interval used by
 *   startRetellHealthReprobeJob().
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const originalEnv = { ...process.env };

beforeEach(() => {
  process.env = { ...originalEnv };
  vi.resetModules();
});

afterEach(() => {
  process.env = { ...originalEnv };
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("runRetellHealthReprobe", () => {
  it("writes a fresh result into the cache (setCachedRetellSetupResult)", async () => {
    // Voice intentionally off → probe short-circuits, no Retell SDK needed.
    process.env.RETELL_API_KEY = "";
    process.env.RETELL_AGENT_ID = "";

    const { getCachedRetellSetupResult, setCachedRetellSetupResult } = await import(
      "../lib/retell-agent-setup"
    );

    // Seed a stale sentinel so we can prove the re-probe replaced it.
    const stale = { skipped: true, reason: "stale-sentinel", ranAt: "2000-01-01T00:00:00.000Z" };
    setCachedRetellSetupResult(stale);
    expect(getCachedRetellSetupResult()).toEqual(stale);

    const { runRetellHealthReprobe } = await import("../lib/retell-health-reprobe");
    await runRetellHealthReprobe();

    const cached = getCachedRetellSetupResult();
    expect(cached).not.toBeNull();
    expect(cached).not.toEqual(stale);
    expect(cached!.reason).not.toBe("stale-sentinel");
    // A fresh result always carries a timestamp newer than the stale sentinel.
    expect(cached!.ranAt).toBeTruthy();
    expect(cached!.ranAt).not.toBe(stale.ranAt);
  });

  it("short-circuits to a 'not_configured' verdict without hitting the Retell API when keys are absent", async () => {
    delete process.env.RETELL_API_KEY;
    delete process.env.RETELL_AGENT_ID;

    // Spy on the Retell SDK constructor; it must never be invoked.
    const retellCtor = vi.fn(() => ({}));
    vi.doMock("retell-sdk", () => ({
      default: retellCtor,
    }));

    const { getCachedRetellSetupResult, interpretRetellSetupHealth } = await import(
      "../lib/retell-agent-setup"
    );
    const { runRetellHealthReprobe } = await import("../lib/retell-health-reprobe");

    await runRetellHealthReprobe();

    expect(retellCtor).not.toHaveBeenCalled();

    const verdict = interpretRetellSetupHealth(getCachedRetellSetupResult());
    expect(verdict.status).toBe("not_configured");
    expect(verdict.needsAttention).toBe(false);
    expect(verdict.healthy).toBe(false);
  });
});

describe("startRetellHealthReprobeJob — interval configuration", () => {
  it("uses the default 10-minute interval when RETELL_HEALTH_REPROBE_INTERVAL_SECONDS is unset", async () => {
    delete process.env.RETELL_HEALTH_REPROBE_INTERVAL_SECONDS;

    const setIntervalSpy = vi
      .spyOn(globalThis, "setInterval")
      .mockReturnValue({ unref: vi.fn() } as unknown as ReturnType<typeof setInterval>);

    const { startRetellHealthReprobeJob, stopRetellHealthReprobeJob } = await import(
      "../lib/retell-health-reprobe"
    );

    startRetellHealthReprobeJob();
    try {
      expect(setIntervalSpy).toHaveBeenCalledOnce();
      expect(setIntervalSpy.mock.calls[0][1]).toBe(10 * 60 * 1000);
    } finally {
      stopRetellHealthReprobeJob();
    }
  });

  it("overrides the interval from RETELL_HEALTH_REPROBE_INTERVAL_SECONDS", async () => {
    process.env.RETELL_HEALTH_REPROBE_INTERVAL_SECONDS = "42";

    const setIntervalSpy = vi
      .spyOn(globalThis, "setInterval")
      .mockReturnValue({ unref: vi.fn() } as unknown as ReturnType<typeof setInterval>);

    const { startRetellHealthReprobeJob, stopRetellHealthReprobeJob } = await import(
      "../lib/retell-health-reprobe"
    );

    startRetellHealthReprobeJob();
    try {
      expect(setIntervalSpy).toHaveBeenCalledOnce();
      expect(setIntervalSpy.mock.calls[0][1]).toBe(42 * 1000);
    } finally {
      stopRetellHealthReprobeJob();
    }
  });

  it("falls back to the default interval when the override is non-numeric or non-positive", async () => {
    process.env.RETELL_HEALTH_REPROBE_INTERVAL_SECONDS = "not-a-number";

    const setIntervalSpy = vi
      .spyOn(globalThis, "setInterval")
      .mockReturnValue({ unref: vi.fn() } as unknown as ReturnType<typeof setInterval>);

    const { startRetellHealthReprobeJob, stopRetellHealthReprobeJob } = await import(
      "../lib/retell-health-reprobe"
    );

    startRetellHealthReprobeJob();
    try {
      expect(setIntervalSpy.mock.calls[0][1]).toBe(10 * 60 * 1000);
    } finally {
      stopRetellHealthReprobeJob();
    }
  });
});
