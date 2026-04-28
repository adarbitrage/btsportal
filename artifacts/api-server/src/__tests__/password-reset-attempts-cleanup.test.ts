import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { createHash, randomUUID } from "crypto";
import { db, passwordResetAttemptsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { runPasswordResetAttemptsCleanup } from "../lib/password-reset-attempts-cleanup";

const TAG = `pr-cleanup-${randomUUID().slice(0, 8)}`;
const emailHash = createHash("sha256").update(`${TAG}@example.test`).digest("hex");
const ipHash = createHash("sha256").update(`ip-${TAG}`).digest("hex");

async function deleteTestRows() {
  await db
    .delete(passwordResetAttemptsTable)
    .where(eq(passwordResetAttemptsTable.identifierHash, emailHash));
  await db
    .delete(passwordResetAttemptsTable)
    .where(eq(passwordResetAttemptsTable.identifierHash, ipHash));
}

afterAll(async () => {
  await deleteTestRows();
});

beforeEach(async () => {
  await deleteTestRows();
});

describe("runPasswordResetAttemptsCleanup", () => {
  it("deletes rows older than 7 days and keeps recent rows", async () => {
    await db.insert(passwordResetAttemptsTable).values([
      { identifierType: "email", identifierHash: emailHash },
      { identifierType: "ip", identifierHash: ipHash },
    ]);

    await db.execute(
      sql`UPDATE password_reset_attempts SET created_at = NOW() - INTERVAL '8 days' WHERE identifier_hash IN (${emailHash}, ${ipHash})`,
    );

    await db.insert(passwordResetAttemptsTable).values([
      { identifierType: "email", identifierHash: emailHash },
      { identifierType: "ip", identifierHash: ipHash },
    ]);

    await runPasswordResetAttemptsCleanup();

    const remainingEmail = await db
      .select({ id: passwordResetAttemptsTable.id })
      .from(passwordResetAttemptsTable)
      .where(eq(passwordResetAttemptsTable.identifierHash, emailHash));
    const remainingIp = await db
      .select({ id: passwordResetAttemptsTable.id })
      .from(passwordResetAttemptsTable)
      .where(eq(passwordResetAttemptsTable.identifierHash, ipHash));

    expect(remainingEmail).toHaveLength(1);
    expect(remainingIp).toHaveLength(1);
  });

  it("does nothing when there are no old rows", async () => {
    await db.insert(passwordResetAttemptsTable).values([
      { identifierType: "email", identifierHash: emailHash },
      { identifierType: "ip", identifierHash: ipHash },
    ]);

    await runPasswordResetAttemptsCleanup();

    const remainingEmail = await db
      .select({ id: passwordResetAttemptsTable.id })
      .from(passwordResetAttemptsTable)
      .where(eq(passwordResetAttemptsTable.identifierHash, emailHash));
    const remainingIp = await db
      .select({ id: passwordResetAttemptsTable.id })
      .from(passwordResetAttemptsTable)
      .where(eq(passwordResetAttemptsTable.identifierHash, ipHash));

    expect(remainingEmail).toHaveLength(1);
    expect(remainingIp).toHaveLength(1);
  });
});
