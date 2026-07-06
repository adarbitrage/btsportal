/**
 * Email pitch resolver (Task #1715): fills the `{{pitch_block_html}}` slot
 * the branded email layout (Task #1714, `seed-templates.ts`'s `wrapHtml`)
 * always emits. For every lifecycle send that layout wraps, resolves a
 * per-member, tier-based stack of upgrade pitches and renders them via
 * `renderPitchBlock`. Wired into `communication-service.ts`'s `queueEmail`/
 * `sendEmailNow` — see the call sites there for the injection seam.
 */

import { db, productsTable, userProductsTable } from "@workspace/db";
import { and, eq, gte, isNull, or } from "drizzle-orm";
import { PRODUCT_RANK } from "./product-rank";
import { renderPitchBlock } from "./seed-templates";
import { getAllPitchContent, type PitchBlockKey } from "./pitch-content-settings";

export type { PitchBlockKey };

/**
 * Whether a member is a "Machine member" (already owns/uses Machine), which
 * should suppress the Machine pitch from their stack.
 *
 * STUBBED per Task #1715: the `machine_member` column doesn't exist yet —
 * it lands with a separate, not-yet-landed Machine-sync task. This always
 * returns `false` until that column exists.
 *
 * TODO(machine-member-flag): once `machine_member` (or equivalent) exists on
 * the schema, replace this body with a real read. The signature (async,
 * keyed by userId) is intentionally already shaped for a DB-backed
 * implementation so the swap is a drop-in change with no other caller
 * needing to change.
 */
export async function isMachineMember(_userId: number): Promise<boolean> {
  return false;
}

/**
 * Highest product rank across the member's currently-active, non-expired
 * product grants — the same max-active-rank approach as the onboarding
 * variant resolver (`onboarding-variant.ts`). Unlike that resolver, this
 * deliberately does NOT exclude VIP via `PARTNER_INELIGIBLE_SLUGS`: for
 * pitch-stack purposes a VIP holder legitimately sits at rank 6, the top of
 * the ladder (see the Task #1715 notes in `product-rank.ts`). A member with
 * no active products resolves to rank 0, the same bucket as a free/frontend-
 * only member.
 *
 * Queried fresh from the DB on every call — no caching — because tier
 * resolution must reflect a mid-day upgrade on the member's very next send,
 * not after a cache TTL expires. (Pitch *copy* may use the short-TTL cache
 * pattern; tier resolution may not — see pitch-content-settings.ts for the
 * copy cache.)
 */
export async function resolveMemberRank(userId: number): Promise<number> {
  const now = new Date();
  const rows = await db
    .select({ slug: productsTable.slug })
    .from(userProductsTable)
    .innerJoin(productsTable, eq(userProductsTable.productId, productsTable.id))
    .where(
      and(
        eq(userProductsTable.userId, userId),
        eq(userProductsTable.status, "active"),
        or(isNull(userProductsTable.expiresAt), gte(userProductsTable.expiresAt, now)),
      ),
    );
  return rows.reduce((max, row) => Math.max(max, PRODUCT_RANK[row.slug] ?? 0), 0);
}

/**
 * Ordered pitch-block stack for a given rank + Machine-member flag, per the
 * exact Task #1715 matrix:
 *   rank 0 (free/frontend-only)    -> LaunchPad, Machine, VIP
 *   rank 1 (LaunchPad)             -> Mentorship, Machine, VIP
 *   ranks 2-5 (3month..lifetime)   -> Machine, VIP
 *   rank 6+ (VIP)                  -> Machine
 * `machineMember = true` removes MACHINE_PITCH from the stack wherever it
 * appears, closing the gap (never leaving an empty slot in the middle) — a
 * VIP + Machine member therefore resolves to an empty stack.
 */
export function pitchStackForRank(rank: number, machineMember: boolean): PitchBlockKey[] {
  let stack: PitchBlockKey[];
  if (rank <= 0) {
    stack = ["LAUNCHPAD_PITCH", "MACHINE_PITCH", "VIP_PITCH"];
  } else if (rank === 1) {
    stack = ["MENTORSHIP_PITCH", "MACHINE_PITCH", "VIP_PITCH"];
  } else if (rank >= 2 && rank <= 5) {
    stack = ["MACHINE_PITCH", "VIP_PITCH"];
  } else {
    stack = ["MACHINE_PITCH"];
  }
  return machineMember ? stack.filter((key) => key !== "MACHINE_PITCH") : stack;
}

/** Resolve the ordered pitch stack for a member (fresh rank + stub flag). */
export async function resolvePitchStack(userId: number): Promise<PitchBlockKey[]> {
  const [rank, machineMember] = await Promise.all([
    resolveMemberRank(userId),
    isMachineMember(userId),
  ]);
  return pitchStackForRank(rank, machineMember);
}

/**
 * Render the full `{{pitch_block_html}}` slot contents for a member: every
 * block in the resolved stack rendered via `renderPitchBlock` (Task #1714)
 * and concatenated in order. Returns `""` when the stack is empty so the
 * layout's empty-renders-nothing contract holds (e.g. a VIP + Machine
 * member, or a lookup failure — see the try/catch in
 * `communication-service.ts`, which treats a resolver error the same as an
 * empty stack rather than blocking the send).
 */
export async function renderPitchStackHtml(userId: number): Promise<string> {
  const stack = await resolvePitchStack(userId);
  if (stack.length === 0) return "";
  const contentByKey = await getAllPitchContent();
  return stack.map((key) => renderPitchBlock(contentByKey[key])).join("");
}
