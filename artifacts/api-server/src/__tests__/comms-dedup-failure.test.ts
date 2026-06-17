import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// This suite covers the FAILURE path of the dedup safety net, which is the
// scenario that previously failed silently. When `comms_send_log` is broken or
// unreachable, every db.execute call throws. The dedup helper used to swallow
// that and return `false`, which the scheduler reads as "already sent" — so a
// database problem would quietly suppress EVERY scheduled email with no error
// and no trace. The fix makes a real failure:
//   1. observable — it is logged loudly instead of swallowed, and
//   2. distinguishable — it returns the dedicated "error" outcome rather than
//      the "duplicate" outcome the scheduler uses to skip already-sent mail.

const dbExecuteMock = vi.fn();

vi.mock("@workspace/db", () => ({
  db: {
    execute: (...args: any[]) => dbExecuteMock(...args),
  },
}));

import { checkAndRecordSend, wasSent } from "../lib/comms-dedup";

let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  dbExecuteMock.mockReset();
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  errorSpy.mockRestore();
});

describe("checkAndRecordSend — dedup-store failure", () => {
  it('returns the distinct "error" outcome (not "duplicate") when the store throws', async () => {
    dbExecuteMock.mockRejectedValue(new Error("relation \"comms_send_log\" does not exist"));

    const outcome = await checkAndRecordSend("any-key", "email");

    // Crucially NOT "duplicate" — the scheduler treats "duplicate" as
    // already-sent and skips silently. "error" lets it skip LOUDLY instead.
    expect(outcome).toBe("error");
    expect(outcome).not.toBe("duplicate");
  });

  it("logs the failure loudly instead of swallowing it", async () => {
    dbExecuteMock.mockRejectedValue(new Error("connection refused"));

    await checkAndRecordSend("loud-key", "email");

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const [message] = errorSpy.mock.calls[0];
    expect(String(message)).toContain("comms-dedup");
    expect(String(message)).toContain("loud-key");
  });

  it('a recovered store reports "recorded"/"duplicate" again (failure is not cached)', async () => {
    // First call fails (table broken) ...
    dbExecuteMock.mockRejectedValueOnce(new Error("boom"));
    expect(await checkAndRecordSend("recovery-key", "email")).toBe("error");

    // ... then the store recovers. ensureTable must NOT have cached the failure,
    // so the very next call succeeds. (CREATE TABLE + INSERT each resolve.)
    dbExecuteMock.mockResolvedValueOnce({ rows: [] }); // ensureTable CREATE TABLE
    dbExecuteMock.mockResolvedValueOnce({ rows: [{ id: 1 }] }); // INSERT ... RETURNING
    expect(await checkAndRecordSend("recovery-key", "email")).toBe("recorded");
  });

  it("wasSent reports false and logs on a store failure", async () => {
    dbExecuteMock.mockRejectedValue(new Error("store down"));

    expect(await wasSent("missing-key")).toBe(false);
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });
});
