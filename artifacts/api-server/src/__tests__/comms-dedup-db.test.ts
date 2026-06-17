import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

// Path-level scheduled-comms tests mock the Postgres-backed dedup helper with an
// in-memory Set. That keeps those tests fast and Redis-free, but it means the
// REAL safety net — the `comms_send_log` table, its UNIQUE constraint on
// send_key, and the INSERT ... ON CONFLICT DO NOTHING in checkAndRecordSend —
// has no direct coverage. If that contract ever silently broke (constraint
// dropped, conflict target changed), every scheduled email path could start
// double-sending and no test would catch it. This suite exercises the helper
// against the actual table.
import { checkAndRecordSend, wasSent } from "../lib/comms-dedup";

// Namespace every key to this run so we never collide with real rows or with a
// concurrently-running copy of the suite, and so cleanup is precise.
const TAG = `dedup-test-${randomUUID().slice(0, 8)}`;

afterAll(async () => {
  // Remove only the rows this test seeded.
  await db.execute(
    sql`DELETE FROM comms_send_log WHERE send_key LIKE ${`${TAG}-%`}`,
  );
});

describe("checkAndRecordSend — real comms_send_log dedup", () => {
  it("records the first call for a key and reports a second call as already-sent", async () => {
    const key = `${TAG}-first-then-dup`;

    // First call: nothing recorded yet -> records the row, returns "new".
    expect(await wasSent(key)).toBe(false);
    expect(await checkAndRecordSend(key, "email")).toBe(true);

    // The row is now persisted in the real table.
    expect(await wasSent(key)).toBe(true);

    // Second call with the SAME key: ON CONFLICT DO NOTHING -> "already sent".
    expect(await checkAndRecordSend(key, "email")).toBe(false);

    // Exactly one row exists for this key — the conflict did not insert a dup.
    const rows = await db.execute(
      sql`SELECT count(*)::int AS n FROM comms_send_log WHERE send_key = ${key}`,
    );
    expect((rows as any).rows?.[0]?.n).toBe(1);
  });

  it("treats different keys independently", async () => {
    const keyA = `${TAG}-independent-a`;
    const keyB = `${TAG}-independent-b`;

    expect(await checkAndRecordSend(keyA, "email")).toBe(true);
    // A distinct key is unaffected by keyA already being recorded.
    expect(await checkAndRecordSend(keyB, "email")).toBe(true);

    // And each still dedups on its own.
    expect(await checkAndRecordSend(keyA, "email")).toBe(false);
    expect(await checkAndRecordSend(keyB, "email")).toBe(false);
  });

  it("dedups on send_key regardless of channel (key is the conflict target)", async () => {
    // The UNIQUE constraint is on send_key alone, so the same key on a second
    // channel is still treated as already-sent. Scheduled-comms therefore bakes
    // the channel into the send_key when it wants per-channel dedup.
    const key = `${TAG}-channel-shared`;

    expect(await checkAndRecordSend(key, "email")).toBe(true);
    expect(await checkAndRecordSend(key, "sms")).toBe(false);

    const rows = await db.execute(
      sql`SELECT count(*)::int AS n FROM comms_send_log WHERE send_key = ${key}`,
    );
    expect((rows as any).rows?.[0]?.n).toBe(1);
  });

  it("records distinct per-channel keys independently when the channel is part of the key", async () => {
    // Mirrors how callers achieve per-channel dedup: embed the channel in the
    // key (e.g. `${base}_email` vs `${base}_sms`). Both are then independent.
    const base = `${TAG}-perchannel`;
    const emailKey = `${base}_email`;
    const smsKey = `${base}_sms`;

    expect(await checkAndRecordSend(emailKey, "email")).toBe(true);
    expect(await checkAndRecordSend(smsKey, "sms")).toBe(true);

    // Each is independently deduped.
    expect(await checkAndRecordSend(emailKey, "email")).toBe(false);
    expect(await checkAndRecordSend(smsKey, "sms")).toBe(false);
  });
});
