/**
 * Ad-spend credit card fee math — DISPLAY-ONLY mirror of the
 * server-authoritative helper in
 * artifacts/api-server/src/lib/payments/ad-spend-fee.ts.
 * Keep the two in lockstep. The server recomputes and enforces the fee;
 * the client only ever sends the entered deposit amount.
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

/** "$2,575.00"-style formatting for fee breakdowns. */
export function formatCentsExact(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

/**
 * Member-facing breakdown line, e.g.
 * "Deposit $2,500.00 + $75.00 card fee (3%) = $2,575.00 charged to your card."
 */
export function feeBreakdownText(depositCents: number): string {
  const fee = cardFeeCents(depositCents);
  return `Deposit ${formatCentsExact(depositCents)} + ${formatCentsExact(fee)} card fee (3%) = ${formatCentsExact(depositCents + fee)} charged to your card.`;
}
