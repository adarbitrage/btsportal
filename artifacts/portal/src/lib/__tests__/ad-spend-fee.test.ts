import { describe, it, expect } from "vitest";
import {
  AD_SPEND_CARD_FEE_RATE,
  cardFeeCents,
  chargedTotalCents,
  formatCentsExact,
  feeBreakdownText,
} from "../ad-spend-fee";

describe("portal ad-spend fee display helpers", () => {
  it("mirrors the server 3% fee math", () => {
    expect(AD_SPEND_CARD_FEE_RATE).toBe(0.03);
    expect(cardFeeCents(250_000)).toBe(7_500);
    expect(chargedTotalCents(250_000)).toBe(257_500);
    expect(cardFeeCents(100_000)).toBe(3_000);
    expect(chargedTotalCents(1_000_000)).toBe(1_030_000);
    // fractional-cent rounding matches server Math.round
    expect(cardFeeCents(250_100)).toBe(7_503);
  });

  it("formats currency with cents", () => {
    expect(formatCentsExact(257_500)).toBe("$2,575.00");
    expect(formatCentsExact(7_503)).toBe("$75.03");
  });

  it("builds the member-facing breakdown copy", () => {
    expect(feeBreakdownText(250_000)).toBe(
      "Deposit $2,500.00 + $75.00 card fee (3%) = $2,575.00 charged to your card.",
    );
    expect(feeBreakdownText(100_000)).toBe(
      "Deposit $1,000.00 + $30.00 card fee (3%) = $1,030.00 charged to your card.",
    );
  });
});
