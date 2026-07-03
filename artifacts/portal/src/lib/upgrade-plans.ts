export const FEATURE_TO_PLAN_SLUG: Record<string, string> = {
  software: "launchpad",
  "coaching-group": "3month",
  community: "3month",
  commissions: "3month",
  "coaching-1on1": "1year",
};

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
  // level-badge/label purposes. Keep in sync with the server copy at
  // artifacts/api-server/src/lib/product-rank.ts.
  vip: 6,
};
