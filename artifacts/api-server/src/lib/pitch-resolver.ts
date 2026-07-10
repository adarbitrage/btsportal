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
 * Whether a member is already a VIP Arbitrage member (the managed media
 * buying program), which should suppress the VIP Arbitrage pitch from their
 * stack.
 *
 * STUBBED per Task #1824: mirrors `isMachineMember` exactly — always
 * returns `false` until the not-yet-landed Machine daily cross-system sync
 * (hashed-email join, never-block, daily cadence) lands. That sync is
 * required to populate BOTH `machine_member` AND `vip_arbitrage_member` on
 * the schema — the latter sourced from the Machine-side VIP Arbitrage
 * member list. The signature (async, keyed by userId) is intentionally
 * already shaped for a DB-backed implementation so the swap is a drop-in
 * change with no other caller needing to change.
 *
 * TODO(vip-arbitrage-member-flag): once `vip_arbitrage_member` (or
 * equivalent) exists on the schema — landing with the future Machine
 * cross-system sync task — replace this body with a real read.
 */
export async function isVipArbitrageMember(_userId: number): Promise<boolean> {
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
 * Ordered pitch-block stack for a given rank + Machine/VIP-Arbitrage-member
 * flags, per the exact Task #1824 matrix:
 *   rank 0 (free/frontend-only)    -> LaunchPad, Machine, VIPArb
 *   rank 1 (LaunchPad)             -> Mentorship, Machine, VIPArb
 *   ranks 2-5 (3month..lifetime)   -> Machine, VIPArb
 *   rank 6+ (BTS VIP)              -> Machine, VIPArb
 * VIP Arbitrage is a separate, cross-system product (like Machine) — the
 * BTS VIP product no longer suppresses or triggers anything in this slot,
 * so it's universal across every rank, including 6+. `machineMember = true`
 * removes MACHINE_PITCH and `vipArbitrageMember = true` removes
 * VIP_ARBITRAGE_PITCH, each closing the gap independently (never leaving an
 * empty slot in the middle) — a member with both flags therefore resolves
 * to whatever pitch(es) remain, or an empty stack if neither remains.
 */
export function pitchStackForRank(
  rank: number,
  machineMember: boolean,
  vipArbitrageMember: boolean,
): PitchBlockKey[] {
  let stack: PitchBlockKey[];
  if (rank <= 0) {
    stack = ["LAUNCHPAD_PITCH", "MACHINE_PITCH", "VIP_ARBITRAGE_PITCH"];
  } else if (rank === 1) {
    stack = ["MENTORSHIP_PITCH", "MACHINE_PITCH", "VIP_ARBITRAGE_PITCH"];
  } else {
    stack = ["MACHINE_PITCH", "VIP_ARBITRAGE_PITCH"];
  }
  return stack.filter((key) => {
    if (key === "MACHINE_PITCH" && machineMember) return false;
    if (key === "VIP_ARBITRAGE_PITCH" && vipArbitrageMember) return false;
    return true;
  });
}

/** Resolve the ordered pitch stack for a member (fresh rank + stub flags). */
export async function resolvePitchStack(userId: number): Promise<PitchBlockKey[]> {
  const [rank, machineMember, vipArbitrageMember] = await Promise.all([
    resolveMemberRank(userId),
    isMachineMember(userId),
    isVipArbitrageMember(userId),
  ]);
  return pitchStackForRank(rank, machineMember, vipArbitrageMember);
}

/**
 * Task #1824 compliance gate: whether a resolved pitch block is actually
 * allowed to render. Every block except VIP_ARBITRAGE_PITCH is always
 * renderable — VIP Arbitrage is a Reg D 506(c) securities offering, so its
 * copy is securities marketing that must never reach a member's inbox
 * before securities counsel has explicitly signed off. Fails closed: a
 * missing `reviewed` field, a stored value that isn't the literal boolean
 * `true`, or a content-load fallback (DB read failure -> shipped default,
 * which is always `reviewed: false`) all resolve to "not renderable".
 */
export function isPitchBlockReviewed(key: PitchBlockKey, content: PitchContentForGate): boolean {
  if (key !== "VIP_ARBITRAGE_PITCH") return true;
  return content.reviewed === true;
}

interface PitchContentForGate {
  reviewed?: boolean;
}

/**
 * THE single seam every send path — the resolver's own
 * `renderPitchStackHtml` as well as the `blast-all-emails*` scripts that
 * render a pitch stack outside the normal per-member resolver flow — must
 * go through to render a pitch block's HTML. Wraps `renderPitchBlock` with
 * the `isPitchBlockReviewed` gate so no caller can bypass compliance review
 * by calling `renderPitchBlock` directly for a gated block.
 */
export function renderGatedPitchBlock(
  key: PitchBlockKey,
  content: (Parameters<typeof renderPitchBlock>[0] & PitchContentForGate) | null | undefined,
  emphasis?: Parameters<typeof renderPitchBlock>[1],
): string {
  if (!content || !isPitchBlockReviewed(key, content)) return "";
  return renderPitchBlock(content, emphasis);
}

/**
 * Render the full `{{pitch_block_html}}` slot contents for a member: every
 * block in the resolved stack rendered via `renderPitchBlock` (Task #1714)
 * with a descending visual weight — the first block is the `primary` offer
 * (larger heading, full button), the second renders `secondary` (smaller
 * type, compact outline button), and the third onward render `tertiary`
 * (one fine-print line with a text-link CTA). The wrapper table owns the
 * SINGLE subtle divider separating the whole stack from the email body —
 * individual blocks carry no divider — plus tight inter-block spacing, so
 * the stack reads as "one offer + smaller mentions" rather than an ad wall.
 *
 * Returns `""` when the stack is empty so the layout's
 * empty-renders-nothing contract holds (e.g. a VIP + Machine member, or a
 * lookup failure — see the try/catch in `communication-service.ts`, which
 * treats a resolver error the same as an empty stack rather than blocking
 * the send).
 */
export async function renderPitchStackHtml(userId: number): Promise<string> {
  const stack = await resolvePitchStack(userId);
  if (stack.length === 0) return "";
  const contentByKey = await getAllPitchContent();
  const rows = stack
    .map((key, index) => {
      const emphasis = index === 0 ? "primary" : index === 1 ? "secondary" : "tertiary";
      const block = renderGatedPitchBlock(key, contentByKey[key], emphasis);
      if (!block) return "";
      const topPadding = index === 0 ? "20px" : "14px";
      return `<tr><td style="padding:${topPadding} 0 0;">${block}</td></tr>`;
    })
    .filter((row) => row !== "");
  if (rows.length === 0) return "";
  return `
<table width="100%" cellpadding="0" cellspacing="0" style="margin:28px 0 0;border-top:1px solid #e5e7eb;">
${rows.join("\n")}
</table>`;
}
