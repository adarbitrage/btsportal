import { useQuery } from "@tanstack/react-query";
import { useGetCurrentMember } from "@workspace/api-client-react";
import { isFrontendWelcomeMember } from "@/pages/Landing";
import { authFetch, useAuth } from "@/lib/auth";

/**
 * Visibility logic for the front-end members' "book your call" bottom bar.
 *
 * The bar shows portal-wide ONLY when every one of these holds:
 *   - the signed-in user is a plain member (admins / coaches / staff never
 *     see it — their role is not "member"),
 *   - the member matches the Frontend Welcome audience predicate (active
 *     front-end/funnel grant, no active mentorship tier — the EXACT logic
 *     the root landing gate uses, imported from Landing.tsx),
 *   - the member has NO active upcoming FE-intensive booking, per the same
 *     /fe-intensive/status endpoint + ["fe-intensive-status"] query key the
 *     Welcome page's booking surface uses (so booking/canceling invalidates
 *     one shared cache entry and the bar reacts immediately).
 *
 * Fail closed: while anything is loading, or on any error, the bar is hidden.
 */

interface FeStatusResponse {
  configured: boolean;
  booking: { id: number } | null;
}

interface StatusQueryLike {
  isSuccess: boolean;
  isError: boolean;
  data?: FeStatusResponse;
}

export interface FeCallBarInputs {
  role: string | undefined;
  products:
    | readonly { productSlug: string; status: string; expiresAt?: string | Date | null }[]
    | undefined;
  status: StatusQueryLike;
}

/** Pure predicate — unit-tested in use-fe-call-bar.test.ts. Fail-closed. */
export function shouldShowFeCallBar({ role, products, status }: FeCallBarInputs): boolean {
  if (role !== "member") return false;
  if (!isFrontendWelcomeMember(products)) return false;
  if (status.isError || !status.isSuccess || !status.data) return false;
  return status.data.booking == null;
}

async function fetchFeStatus(): Promise<FeStatusResponse> {
  const res = await authFetch("/fe-intensive/status");
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return (await res.json()) as FeStatusResponse;
}

/**
 * Sidebar "Book your first coaching call" link state for the front-end-only
 * audience. Pure — unit-tested alongside shouldShowFeCallBar.
 *
 *   - "hidden": not a plain member, or not the Frontend Welcome audience.
 *   - "booked": audience member with an active upcoming FE-intensive booking
 *     (status endpoint succeeded and reported one) — render the confirmed
 *     state instead of the urgent CTA.
 *   - "cta": audience member without a known booking (including while the
 *     status query is loading or errored — the link's destination is always
 *     valid, so the nav entry fails open to the CTA, unlike the bottom bar).
 */
export type AdvisorCallNavState = "hidden" | "cta" | "booked";

export function getAdvisorCallNavState({
  role,
  products,
  status,
}: FeCallBarInputs): AdvisorCallNavState {
  if (role !== "member") return "hidden";
  if (!isFrontendWelcomeMember(products)) return "hidden";
  if (status.isSuccess && status.data && status.data.booking != null) {
    return "booked";
  }
  return "cta";
}

export function useAdvisorCallNav(): AdvisorCallNavState {
  const { user } = useAuth();
  const { data: member } = useGetCurrentMember();

  const isAudience =
    user?.role === "member" && isFrontendWelcomeMember(member?.products);

  // Shares the ["fe-intensive-status"] cache entry with the booking surface
  // and the bottom bar, so booking/canceling updates all three at once.
  const statusQuery = useQuery({
    queryKey: ["fe-intensive-status"],
    queryFn: fetchFeStatus,
    enabled: isAudience,
  });

  return getAdvisorCallNavState({
    role: user?.role,
    products: member?.products,
    status: statusQuery,
  });
}

export function useFeCallBar(): boolean {
  const { user } = useAuth();
  const { data: member } = useGetCurrentMember();

  const isAudience =
    user?.role === "member" && isFrontendWelcomeMember(member?.products);

  // Only FE-audience members ever hit the status endpoint from here; everyone
  // else keeps the query disabled (disabled ⇒ not success ⇒ bar hidden).
  const statusQuery = useQuery({
    queryKey: ["fe-intensive-status"],
    queryFn: fetchFeStatus,
    enabled: isAudience,
  });

  return shouldShowFeCallBar({
    role: user?.role,
    products: member?.products,
    status: statusQuery,
  });
}
