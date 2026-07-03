import { z } from "zod/v4";

// Phase 0 live-DB enumeration (June 2026) + voice:access (seed.ts canonical) +
// coaching:one_on_one:* (live DB) + new brand/offer keys added by this task.
// This is the ONLY place valid entitlement keys are defined.
// Consumers: import { ENTITLEMENT_KEYS, entitlementKeySchema } from "@workspace/db"
export const ENTITLEMENT_KEYS = [
  // ── content ──────────────────────────────────────────────────────────────
  "content:frontend",
  "content:advanced",
  // brand front-end content keys (new)
  "content:yse",
  "content:backroad",
  "content:offmarket",
  "content:reserve_income",
  "content:silent_partner",
  "content:test_like_mad",
  // ── offer ─────────────────────────────────────────────────────────────────
  "offer:cmo_bump",
  "offer:21_day_blitz",
  "offer:swipe_bank",
  "offer:profit_maximizer",
  // ── software ──────────────────────────────────────────────────────────────
  "software:base",
  "software:expanded",
  // ── coaching ──────────────────────────────────────────────────────────────
  "coaching:group",
  "coaching:mastermind",
  "coaching:one_on_one:monthly",
  "coaching:one_on_one:weekly",
  // ── community ─────────────────────────────────────────────────────────────
  "community:access",
  // ── commissions ───────────────────────────────────────────────────────────
  "commissions:entry",
  "commissions:mid",
  "commissions:premium",
  "commissions:top",
  // ── support ───────────────────────────────────────────────────────────────
  "support:basic",
  "support:standard",
  "support:enhanced",
  "support:unlimited",
  "support:vip",
  // ── chat ──────────────────────────────────────────────────────────────────
  "chat:basic",
  "chat:full",
  "chat:custom",
  // ── access ────────────────────────────────────────────────────────────────
  "access:lifetime",
  // ── voice ─────────────────────────────────────────────────────────────────
  "voice:access",
  // ── vip (Task #1660) ─────────────────────────────────────────────────────
  // Pure status marker — VIP carries no content/coaching entitlements of its
  // own. It is always sold composed with a `1year` mentorship grant (which
  // supplies the actual coaching entitlements); `vip:status` alone confers
  // no member-facing access beyond whatever the content-access matrix
  // explicitly gates behind it (nothing, by default).
  "vip:status",
] as const;

export type EntitlementKey = (typeof ENTITLEMENT_KEYS)[number];

export const entitlementKeySchema = z.enum(ENTITLEMENT_KEYS);
