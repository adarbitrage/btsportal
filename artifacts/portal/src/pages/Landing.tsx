import { useGetCurrentMember } from "@workspace/api-client-react";
import { MAPPABLE_PRODUCTS } from "@workspace/content-access-registry";
import Home from "@/pages/Home";
import FrontendWelcome from "@/pages/FrontendWelcome";
import FullPageLoader from "@/components/FullPageLoader";

/**
 * Root landing gate ("/") — decides which landing surface renders, computed
 * from the member's LIVE product grants (never from cached/derived fields):
 *
 *   - front-end or funnel product AND no mentorship tier → FrontendWelcome
 *     (post-purchase Welcome page, gated body via /curriculum/frontend-welcome)
 *   - any mentorship tier (incl. VIP badge holders) → existing Home,
 *     byte-for-byte today's behavior
 *   - no products at all → existing Home (today's behavior unchanged)
 *
 * Upgrading FE → tier naturally flips a member out of the Welcome branch on
 * the next render of "/" because the decision re-reads live grants. The
 * onboarding variant resolver / step arrays / upgrade re-entry hook are
 * deliberately untouched — ProtectedRoute has already routed incomplete
 * tier onboarding before this component renders.
 */

const TIER_SLUGS = new Set(
  MAPPABLE_PRODUCTS.filter((p) => p.group === "mentorship").map((p) => p.slug),
);
const FRONTEND_OR_FUNNEL_SLUGS = new Set(
  MAPPABLE_PRODUCTS.filter(
    (p) => p.group === "frontend" || p.group === "funnel",
  ).map((p) => p.slug),
);

interface MemberProductLike {
  productSlug: string;
  status: string;
  expiresAt?: string | Date | null;
}

export function isFrontendWelcomeMember(
  products: readonly MemberProductLike[] | undefined,
): boolean {
  if (!products || products.length === 0) return false;
  const now = Date.now();
  const active = products.filter(
    (p) =>
      p.status === "active" &&
      (!p.expiresAt || new Date(p.expiresAt).getTime() > now),
  );
  const hasTier = active.some((p) => TIER_SLUGS.has(p.productSlug));
  if (hasTier) return false;
  return active.some((p) => FRONTEND_OR_FUNNEL_SLUGS.has(p.productSlug));
}

export default function Landing() {
  const { data: member, isLoading } = useGetCurrentMember();

  // While the member payload loads, render the shared full-page loading
  // treatment (same as the route guards) so first paint is never a blank
  // screen and neither landing surface flashes before the grant check
  // resolves. On error / missing data we fail to today's behavior (Home) —
  // never to the new page.
  if (isLoading) return <FullPageLoader />;

  if (isFrontendWelcomeMember(member?.products)) {
    return <FrontendWelcome />;
  }
  return <Home />;
}
