// Canonical ordering of BTS product tiers. Higher rank = higher tier.
// The "free"/frontend rank-0 buckets exist so members who only own a
// frontend offer (Reserve Income, Backroad, Off-Market) still get a
// well-defined slot below LaunchPad when we compare ranks for upgrades.
//
// The portal duplicates this map at `artifacts/portal/src/lib/upgrade-plans.ts`
// for client-side button-disabling. Keep both in sync — the server-side copy
// here is authoritative for the upgrade-rank check on POST /members/me/checkout
// so a tampered client can't slip a downgrade past us.
export const PRODUCT_RANK: Record<string, number> = {
  free: 0,
  frontend: 0,
  reserve_income: 0,
  backroad: 0,
  offmarket: 0,
  launchpad: 1,
  "3month": 2,
  "6month": 3,
  "1year": 4,
  lifetime: 5,
  // VIP (Task #1660): pure status product, ranked ABOVE lifetime purely for
  // level-badge/label purposes. It carries no coaching entitlements of its
  // own — see PARTNER_INELIGIBLE_SLUGS in partner-assignment.ts, which
  // deliberately excludes "vip" from every rank-based partner-eligibility
  // check so holding VIP alone never substitutes for the 1year mentorship
  // grant it's always sold alongside.
  vip: 6,
};
