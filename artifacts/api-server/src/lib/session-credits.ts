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

function hashCode(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash = hash & hash;
  }
  return hash;
}

// Stable Postgres advisory-lock key for serializing a single member's credit
// mutations (booking / cancel / reschedule / admin lifecycle). Every code path
// that spends or refunds a member's credits MUST take this same lock so they
// can't interleave and double-spend or double-refund.
export function memberCreditLockKey(memberId: number): number {
  return Math.abs(hashCode(`member-credit:${memberId}`));
}

// Stable Postgres advisory-lock key for serializing booking writes against a
// single coach, so two members can't both pass the "is this slot free?" check
// and double-book the same coach at the same time. A separate namespace from
// the member-credit lock so the two never collide. Booking takes this lock
// FIRST, then the member-credit lock, to keep a consistent acquisition order.
export function coachBookingLockKey(coachId: number): number {
  return Math.abs(hashCode(`coach-booking:${coachId}`));
}
