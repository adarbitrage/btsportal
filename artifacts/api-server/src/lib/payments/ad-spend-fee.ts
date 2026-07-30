/**
 * Ad-spend credit card fee math (server-authoritative).
 *
 * Card deposits carry a 3% transaction fee: the card is charged
 * deposit + fee, while the ad-spend ledger is credited the deposit only.
 * The portal mirrors this math for display purposes in
 * artifacts/portal/src/lib/ad-spend-fee.ts — keep the two in lockstep.
 */

export const AD_SPEND_CARD_FEE_RATE = 0.03;

/** Fee in whole cents, rounded half-up deterministically. */
export function cardFeeCents(depositCents: number): number {
  return Math.round(depositCents * AD_SPEND_CARD_FEE_RATE);
}

/** Total charged to the card: deposit + 3% fee. */
export function chargedTotalCents(depositCents: number): number {
  return depositCents + cardFeeCents(depositCents);
}
