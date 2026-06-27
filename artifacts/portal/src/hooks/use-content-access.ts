import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { authFetch } from "@/lib/auth";

interface ContentAccessResponse {
  accessiblePageKeys: string[];
}

export const CONTENT_ACCESS_QUERY_KEY = ["content-access", "me"] as const;

/**
 * Fetches the list of content page keys this member can access.
 *
 * Mirrors the brand hook's fetch/cache pattern (React Query, 5-min stale).
 * When the map has no rows for a given page, the API returns that page as
 * accessible — so an empty map leaves all pages open (launch no-op).
 *
 * Error semantics: fail-open. If the API call fails (transient network error,
 * server restart, etc.) `isError` is true and the caller should treat the
 * page as accessible so members are never locked out by infrastructure issues.
 * Use `isLoading` to suppress the render until the first result is known.
 *
 * Returns a Set for O(1) has() checks at render time.
 */
export function useContentAccess() {
  const { user } = useAuth();

  const { data, isLoading, isError } = useQuery({
    queryKey: CONTENT_ACCESS_QUERY_KEY,
    queryFn: async (): Promise<ContentAccessResponse> => {
      const res = await authFetch("/api/content-access/me");
      if (!res.ok) throw new Error("Failed to fetch content access");
      return res.json();
    },
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
  });

  return {
    accessiblePageKeys: new Set<string>(data?.accessiblePageKeys ?? []),
    isLoading,
    /**
     * True when the API call failed. Callers should treat the page as
     * accessible (fail-open) when this is true to avoid locking members out
     * due to transient infrastructure issues.
     */
    isError,
  };
}
