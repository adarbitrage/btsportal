import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import { db, usersTable, emailChangeAttemptsTable } from "@workspace/db";
import { and, eq, sql, isNotNull, isNull } from "drizzle-orm";
import {
  runEmailChangeAttemptsCleanup,
  getEmailChangeAttemptsCleanupStatus,
  __resetEmailChangeAttemptsCleanupStatusForTests,
} from "../lib/email-change-attempts-cleanup";

const TAG = `ec-cleanup-${randomUUID().slice(0, 8)}`;
let userId: number;

beforeAll(async () => {
  const email = `${TAG}@example.test`;
  const passwordHash = await bcrypt.hash("pw", 4);
  const [row] = await db
    .insert(usersTable)
    .values({ name: "Cleanup Tester", email, passwordHash, role: "member" })
    .returning({ id: usersTable.id });
  userId = row.id;
});

afterAll(async () => {
  await db
    .delete(emailChangeAttemptsTable)
    .where(eq(emailChangeAttemptsTable.userId, userId));
  await db.delete(usersTable).where(eq(usersTable.id, userId));
});

beforeEach(async () => {
  await db
    .delete(emailChangeAttemptsTable)
    .where(eq(emailChangeAttemptsTable.userId, userId));
});

describe("runEmailChangeAttemptsCleanup", () => {
  it("deletes legacy rate-limit-only rows (no new_email) older than 7 days and keeps recent ones", async () => {
    // Two old rate-limit-only rows that should be removed.
    await db.insert(emailChangeAttemptsTable).values([
      { userId },
      { userId },
    ]);

    await db.execute(
      sql`UPDATE email_change_attempts SET created_at = NOW() - INTERVAL '8 days' WHERE user_id = ${userId} AND new_email IS NULL`,
    );

    // Two recent rate-limit-only rows that should stay.
    await db.insert(emailChangeAttemptsTable).values([
      { userId },
      { userId },
    ]);

    await runEmailChangeAttemptsCleanup();

    const remaining = await db
      .select({ id: emailChangeAttemptsTable.id })
      .from(emailChangeAttemptsTable)
      .where(eq(emailChangeAttemptsTable.userId, userId));

    expect(remaining).toHaveLength(2);
  });

  it("keeps audit rows (with new_email) for up to 90 days", async () => {
    // An audit row aged 30 days — well past the legacy 7-day cutoff but
    // within the 90-day audit retention window. Must survive cleanup.
    await db.insert(emailChangeAttemptsTable).values({
      userId,
      newEmail: "support-call@example.test",
    });
    await db.execute(
      sql`UPDATE email_change_attempts SET created_at = NOW() - INTERVAL '30 days' WHERE user_id = ${userId} AND new_email = 'support-call@example.test'`,
    );

    // A legacy rate-limit-only row aged 30 days — should be deleted.
    await db.insert(emailChangeAttemptsTable).values({ userId });
    await db.execute(
      sql`UPDATE email_change_attempts SET created_at = NOW() - INTERVAL '30 days' WHERE user_id = ${userId} AND new_email IS NULL`,
    );

    await runEmailChangeAttemptsCleanup();

    const auditRows = await db
      .select({ id: emailChangeAttemptsTable.id })
      .from(emailChangeAttemptsTable)
      .where(
        and(
          eq(emailChangeAttemptsTable.userId, userId),
          isNotNull(emailChangeAttemptsTable.newEmail),
        ),
      );
    const legacyRows = await db
      .select({ id: emailChangeAttemptsTable.id })
      .from(emailChangeAttemptsTable)
      .where(
        and(
          eq(emailChangeAttemptsTable.userId, userId),
          isNull(emailChangeAttemptsTable.newEmail),
        ),
      );

    expect(auditRows).toHaveLength(1);
    expect(legacyRows).toHaveLength(0);
  });

  it("deletes audit rows (with new_email) older than 90 days", async () => {
    await db.insert(emailChangeAttemptsTable).values({
      userId,
      newEmail: "ancient@example.test",
    });
    await db.execute(
      sql`UPDATE email_change_attempts SET created_at = NOW() - INTERVAL '91 days' WHERE user_id = ${userId} AND new_email = 'ancient@example.test'`,
    );

    // A recent audit row that must stay.
    await db.insert(emailChangeAttemptsTable).values({
      userId,
      newEmail: "fresh@example.test",
    });

    await runEmailChangeAttemptsCleanup();

    const remaining = await db
      .select({
        id: emailChangeAttemptsTable.id,
        newEmail: emailChangeAttemptsTable.newEmail,
      })
      .from(emailChangeAttemptsTable)
      .where(eq(emailChangeAttemptsTable.userId, userId));

    expect(remaining).toHaveLength(1);
    expect(remaining[0].newEmail).toBe("fresh@example.test");
  });

  it("does nothing when there are no old rows", async () => {
    await db.insert(emailChangeAttemptsTable).values([{ userId }, { userId }]);

    await runEmailChangeAttemptsCleanup();

    const remaining = await db
      .select({ id: emailChangeAttemptsTable.id })
      .from(emailChangeAttemptsTable)
      .where(eq(emailChangeAttemptsTable.userId, userId));

    expect(remaining).toHaveLength(2);
  });

  it("keeps admin-cancelled rows past the 90-day audit window (longer retention)", async () => {
    // Admin-cancelled row aged 120 days — well past the 90-day audit cutoff,
    // but admin-cancelled rows get the longer 365-day retention so support
    // can still see who cancelled what when working old tickets.
    await db.insert(emailChangeAttemptsTable).values({
      userId,
      newEmail: "admin-killed@example.test",
      cancelledAt: new Date(),
      cancelledByAdminId: userId,
    });
    await db.execute(
      sql`UPDATE email_change_attempts SET created_at = NOW() - INTERVAL '120 days' WHERE user_id = ${userId} AND new_email = 'admin-killed@example.test'`,
    );

    // A non-cancelled audit row of the same age — should be deleted under
    // the 90-day rule. Confirms the cancelled-vs-not split is real.
    await db.insert(emailChangeAttemptsTable).values({
      userId,
      newEmail: "abandoned@example.test",
    });
    await db.execute(
      sql`UPDATE email_change_attempts SET created_at = NOW() - INTERVAL '120 days' WHERE user_id = ${userId} AND new_email = 'abandoned@example.test'`,
    );

    await runEmailChangeAttemptsCleanup();

    const remaining = await db
      .select({
        id: emailChangeAttemptsTable.id,
        newEmail: emailChangeAttemptsTable.newEmail,
      })
      .from(emailChangeAttemptsTable)
      .where(eq(emailChangeAttemptsTable.userId, userId));

    expect(remaining).toHaveLength(1);
    expect(remaining[0].newEmail).toBe("admin-killed@example.test");
  });

  it("still treats a row as admin-cancelled even if the admin user was later deleted (cancelledByAdminId nulled out)", async () => {
    // Simulate a row whose original cancelling admin has since been removed:
    // the FK is `onDelete: set null`, so cancelledByAdminId is NULL but
    // cancelledAt is still populated. This row must keep the longer 365-day
    // retention, not silently fall back to the 90-day audit window.
    await db.insert(emailChangeAttemptsTable).values({
      userId,
      newEmail: "orphaned-cancel@example.test",
      cancelledAt: new Date(),
      cancelledByAdminId: null,
    });
    await db.execute(
      sql`UPDATE email_change_attempts SET created_at = NOW() - INTERVAL '120 days' WHERE user_id = ${userId} AND new_email = 'orphaned-cancel@example.test'`,
    );

    await runEmailChangeAttemptsCleanup();

    const remaining = await db
      .select({
        id: emailChangeAttemptsTable.id,
        newEmail: emailChangeAttemptsTable.newEmail,
      })
      .from(emailChangeAttemptsTable)
      .where(eq(emailChangeAttemptsTable.userId, userId));

    expect(remaining).toHaveLength(1);
    expect(remaining[0].newEmail).toBe("orphaned-cancel@example.test");
  });

  it("deletes admin-cancelled rows once they pass the 365-day retention window", async () => {
    // Admin-cancelled row aged 366 days — past the longer admin-cancelled
    // retention cap, so it should finally be deleted.
    await db.insert(emailChangeAttemptsTable).values({
      userId,
      newEmail: "ancient-admin-kill@example.test",
      cancelledAt: new Date(),
      cancelledByAdminId: userId,
    });
    await db.execute(
      sql`UPDATE email_change_attempts SET created_at = NOW() - INTERVAL '366 days' WHERE user_id = ${userId} AND new_email = 'ancient-admin-kill@example.test'`,
    );

    // A recent admin-cancelled row that must stay.
    await db.insert(emailChangeAttemptsTable).values({
      userId,
      newEmail: "fresh-admin-kill@example.test",
      cancelledAt: new Date(),
      cancelledByAdminId: userId,
    });

    await runEmailChangeAttemptsCleanup();

    const remaining = await db
      .select({
        id: emailChangeAttemptsTable.id,
        newEmail: emailChangeAttemptsTable.newEmail,
      })
      .from(emailChangeAttemptsTable)
      .where(eq(emailChangeAttemptsTable.userId, userId));

    expect(remaining).toHaveLength(1);
    expect(remaining[0].newEmail).toBe("fresh-admin-kill@example.test");
  });
});

describe("getEmailChangeAttemptsCleanupStatus", () => {
  beforeEach(() => {
    __resetEmailChangeAttemptsCleanupStatusForTests();
  });

  afterEach(() => {
    __resetEmailChangeAttemptsCleanupStatusForTests();
  });

  it("returns null lastRanAt and lastDeletedCount before the first run", () => {
    const status = getEmailChangeAttemptsCleanupStatus();
    expect(status.lastRanAt).toBeNull();
    expect(status.lastDeletedCount).toBeNull();
    expect(status.lastError).toBeNull();
    expect(status.intervalMs).toBeGreaterThan(0);
    // Baseline was just reset to "now", so we are within the grace window.
    expect(status.stale).toBe(false);
  });

  it("populates lastRanAt and lastDeletedCount after a successful run", async () => {
    const before = Date.now();
    await runEmailChangeAttemptsCleanup();
    const after = Date.now();

    const status = getEmailChangeAttemptsCleanupStatus();
    expect(status.lastRanAt).not.toBeNull();
    const ranAt = new Date(status.lastRanAt as string).getTime();
    expect(ranAt).toBeGreaterThanOrEqual(before);
    expect(ranAt).toBeLessThanOrEqual(after);
    expect(typeof status.lastDeletedCount).toBe("number");
    expect(status.lastError).toBeNull();
    expect(status.stale).toBe(false);
  });

  it("flips stale=true after 2× the run interval with no run", () => {
    const baseline = getEmailChangeAttemptsCleanupStatus();
    expect(baseline.lastRanAt).toBeNull();
    expect(baseline.stale).toBe(false);

    const realNow = Date.now;
    Date.now = () => realNow() + 3 * baseline.intervalMs;
    try {
      const stale = getEmailChangeAttemptsCleanupStatus();
      expect(stale.lastRanAt).toBeNull();
      expect(stale.stale).toBe(true);
    } finally {
      Date.now = realNow;
    }
  });

  it("flips stale=true when the last run is older than 2× the interval", async () => {
    await runEmailChangeAttemptsCleanup();
    const fresh = getEmailChangeAttemptsCleanupStatus();
    expect(fresh.stale).toBe(false);
    expect(fresh.lastRanAt).not.toBeNull();

    const realNow = Date.now;
    Date.now = () => realNow() + 3 * fresh.intervalMs;
    try {
      const stale = getEmailChangeAttemptsCleanupStatus();
      expect(stale.stale).toBe(true);
    } finally {
      Date.now = realNow;
    }
  });

  it("records a heartbeat and lastError when the sweep throws", async () => {
    const dbModule = await import("@workspace/db");
    const failureMessage = "synthetic-email-change-cleanup-failure";
    const spy = vi.spyOn(dbModule.db, "delete").mockImplementation(() => {
      throw new Error(failureMessage);
    });

    const before = Date.now();
    try {
      await expect(runEmailChangeAttemptsCleanup()).rejects.toThrow(failureMessage);
    } finally {
      spy.mockRestore();
    }
    const after = Date.now();

    const status = getEmailChangeAttemptsCleanupStatus();
    expect(status.lastRanAt).not.toBeNull();
    const ranAt = new Date(status.lastRanAt as string).getTime();
    expect(ranAt).toBeGreaterThanOrEqual(before);
    expect(ranAt).toBeLessThanOrEqual(after);
    expect(status.lastError?.message).toBe(failureMessage);
    // No deletions actually completed, so the per-run counter is 0.
    expect(status.lastDeletedCount).toBe(0);
  });

  it("clears lastError on the next successful run", async () => {
    const dbModule = await import("@workspace/db");
    const spy = vi.spyOn(dbModule.db, "delete").mockImplementation(() => {
      throw new Error("transient");
    });
    try {
      await expect(runEmailChangeAttemptsCleanup()).rejects.toThrow("transient");
    } finally {
      spy.mockRestore();
    }
    expect(getEmailChangeAttemptsCleanupStatus().lastError?.message).toBe("transient");

    await runEmailChangeAttemptsCleanup();
    expect(getEmailChangeAttemptsCleanupStatus().lastError).toBeNull();
  });
});
