import { useGetCurrentMember } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { resolveAdminRole } from "@/components/layout/sidebar-nav";

/**
 * Whether the signed-in account is an admin, using the exact same role
 * resolution as AdminRoute and the admin sidebar. Returns false while auth
 * or member data is still loading (callers gating admin-only UI should
 * fail-closed to the member view).
 */
export function useIsAdmin(): boolean {
  const { user, loading } = useAuth();
  const { data: member, isLoading: memberLoading } = useGetCurrentMember();
  if (loading || memberLoading || !user) return false;
  const memberRole = (member as { role?: string } | undefined)?.role;
  return resolveAdminRole(user.role, memberRole).isAdminUser;
}
