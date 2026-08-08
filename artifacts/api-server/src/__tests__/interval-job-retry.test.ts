/**
 * Unit tests for the shared long-interval job retry helper (task #2118).
 *
 * Covers the two behaviors extracted from the Machine mismatch digest:
 *   1. `describeJobError` unwraps a Drizzle-style cause chain into the
 *      underlying Postgres error code + message.
 *   2. `createRetryableIntervalJob` retries a failed run on a short bounded
 *      backoff instead of waiting the full interval, gives up after the
 *      bounded retry count, and clears pending retries on success/stop.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  describeJobError,
  createRetryableIntervalJob,
} from "../lib/interval-job-retry";

describe("describeJobError", () => {
  it("unwraps the cause chain to the Postgres code + message", () => {
    const pgErr = Object.assign(new Error("Authentication timed out"), {
      code: "08P01",
    });
    const drizzleErr = new Error("Failed query: select ...", { cause: pgErr });
    const detail = describeJobError(drizzleErr);
    expect(detail.dbErrorCode).toBe("08P01");
    expect(detail.dbErrorMessage).toBe("Authentication timed out");
    expect(detail.reason).toContain("[08P01] Authentication timed out");
  });

  it("handles plain errors without a cause", () => {
    const detail = describeJobError(new Error("plain failure"));
    expect(detail.dbErrorCode).toBeNull();
    expect(detail.dbErrorMessage).toBeNull();
    expect(detail.reason).toBe("plain failure");
  });
});

describe("createRetryableIntervalJob", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function makeJob(runAttempt: (t: string, a: number) => Promise<boolean | void>) {
    return createRetryableIntervalJob({
      label: "TestJob",
      getIntervalMs: () => 60 * 60 * 1000,
      getRetryBackoffMs: () => 1000,
      getMaxRetries: () => 2,
      runAttempt: runAttempt as any,
    });
  }

  it("schedules a bounded backoff retry after a thrown failure, then succeeds", async () => {
    let calls: Array<[string, number]> = [];
    let failuresLeft = 1;
    const job = makeJob(async (trigger, attempt) => {
      calls.push([trigger, attempt]);
      if (failuresLeft-- > 0) throw new Error("boom");
    });

    await job.runAttemptWithRetry("scheduled", 0);
    expect(job.getRetryState().hasTimer).toBe(true);
    expect(job.getRetryState().nextRetryAt).not.toBeNull();

    await vi.advanceTimersByTimeAsync(1000);
    expect(calls).toEqual([
      ["scheduled", 0],
      ["retry", 1],
    ]);
    // Retry succeeded → pending retry cleared.
    expect(job.getRetryState().hasTimer).toBe(false);
    job.stop();
  });

  it("gives up after max retries", async () => {
    let attempts = 0;
    const job = makeJob(async () => {
      attempts++;
      return false; // handled failure signal
    });

    await job.runAttemptWithRetry("scheduled", 0);
    await vi.advanceTimersByTimeAsync(1000); // retry 1 → fails
    await vi.advanceTimersByTimeAsync(1000); // retry 2 → fails, at max
    expect(attempts).toBe(3);
    expect(job.getRetryState().hasTimer).toBe(false); // gave up, no more retries
    job.stop();
  });

  it("stop() cancels a pending retry", async () => {
    const job = makeJob(async () => {
      throw new Error("boom");
    });
    await job.runAttemptWithRetry("scheduled", 0);
    expect(job.getRetryState().hasTimer).toBe(true);
    job.stop();
    expect(job.getRetryState().hasTimer).toBe(false);
  });
});
