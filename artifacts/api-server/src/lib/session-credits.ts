import { db, coachingCreditLedgerTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

// A member's session-credit balance is the running SUM(delta) of the
// append-only ledger. Accepts an optional transaction-scoped db so balance
// reads happen inside the same advisory-locked transaction as a booking.
export async function getCreditBalance(
  memberId: number,
  database: Pick<typeof db, "select"> | NodePgDatabase = db,
): Promise<number> {
  const [row] = await database
    .select({ balance: sql<number>`COALESCE(SUM(${coachingCreditLedgerTable.delta}), 0)` })
    .from(coachingCreditLedgerTable)
    .where(eq(coachingCreditLedgerTable.memberId, memberId));
  return Number(row?.balance ?? 0);
}
