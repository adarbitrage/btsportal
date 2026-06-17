import { describe, it, expect, beforeAll } from "vitest";
import { signOAuthState, verifyOAuthState } from "../lib/google-oauth";

// The Google OAuth callback is a PUBLIC route (the SameSite=Strict auth cookie
// is not sent on the cross-site redirect from Google), so the signed `state` is
// the ONLY thing that ties the callback back to the user who initiated it. If
// state verification regressed, an attacker could attach an arbitrary account
// to another user — so lock the round-trip + tamper rejection down here.

describe("google oauth state", () => {
  beforeAll(() => {
    process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-for-oauth-state";
  });

  it("round-trips the user id", () => {
    const token = signOAuthState(4242);
    expect(verifyOAuthState(token)).toBe(4242);
  });

  it("rejects a tampered payload", () => {
    const token = signOAuthState(1);
    const [payload, sig] = token.split(".");
    // Flip the payload but keep the original signature.
    const forged = `${payload}x.${sig}`;
    expect(verifyOAuthState(forged)).toBeNull();
  });

  it("rejects a tampered signature", () => {
    const token = signOAuthState(1);
    const [payload] = token.split(".");
    expect(verifyOAuthState(`${payload}.deadbeef`)).toBeNull();
  });

  it("rejects empty / malformed states", () => {
    expect(verifyOAuthState(undefined)).toBeNull();
    expect(verifyOAuthState("")).toBeNull();
    expect(verifyOAuthState("nodot")).toBeNull();
  });
});
