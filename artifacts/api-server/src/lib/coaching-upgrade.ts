// Maps a coaching call's required entitlement to the lowest-priced plan that
// grants it, so locked call cards can deep-link members to the right upgrade.
// `coaching:group` is first granted by the 3-month mentorship and
// `coaching:mastermind` by the 6-month mentorship (see seed.ts product
// entitlementKeys). Anything unmapped falls back to the generic /plans page.
//
// Single-sourced here so the dashboard (`/dashboard`) and the full schedule
// (`/coaching-calls`) routes cannot drift apart.
export const CALL_ENTITLEMENT_TO_PLAN: Record<string, string> = {
  "coaching:group": "3month",
  "coaching:mastermind": "6month",
};

// Returns the upgrade deep-link for a locked call, or null when the member can
// already access it (nothing to upgrade to).
export function getCallUpgradeUrl(
  requiredEntitlement: string,
  isAccessible: boolean,
): string | null {
  if (isAccessible) return null;
  const planSlug = CALL_ENTITLEMENT_TO_PLAN[requiredEntitlement];
  return planSlug ? `/plans?highlight=${planSlug}` : "/plans";
}
