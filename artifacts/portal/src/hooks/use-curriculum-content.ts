import { useQuery } from "@tanstack/react-query";
import { useCallback } from "react";
import { useLocation } from "wouter";
import { authFetch } from "@/lib/auth";
import { useBrand } from "@/hooks/use-brand";

/**
 * Fetches gated front-end curriculum content (7 Pillars, Quick-Start,
 * Pillars-to-Blitz, Tips & Tricks) from the server so no course copy ships
 * in the JS bundle — mirroring the Blitz guide pattern (gated endpoint +
 * loading state + session caching).
 *
 * Brand substitution: server prose carries {{brand.*}} tokens; they are
 * replaced with the member's brand strings here, so white-label brands render
 * exactly as the previous inline JSX did.
 */

function substituteBrand(value: unknown, brand: Record<string, string>): unknown {
  if (typeof value === "string") {
    return value
      .replaceAll("{{brand.full}}", brand.full)
      .replaceAll("{{brand.short}}", brand.short)
      .replaceAll("{{brand.possessive}}", brand.possessive)
      .replaceAll("{{brand.shortPossessive}}", brand.shortPossessive);
  }
  if (Array.isArray(value)) return value.map((v) => substituteBrand(v, brand));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = substituteBrand(v, brand);
    }
    return out;
  }
  return value;
}

export function useCurriculumContent<T>(pageKey: string): {
  content: T | undefined;
  isLoading: boolean;
  isError: boolean;
} {
  const brand = useBrand();
  const { data, isLoading, isError } = useQuery({
    queryKey: ["curriculum-content", pageKey],
    staleTime: Infinity,
    queryFn: async () => {
      // No sessionStorage caching on purpose: persisted copies could be
      // replayed by a different (non-owner) account on the same browser.
      // The in-memory query cache (staleTime: Infinity) already avoids
      // refetches within a session, and every page view revalidates
      // ownership against the gated endpoint.
      const res = await authFetch(`/curriculum/${pageKey}`);
      if (!res.ok) throw new Error(`Failed to load curriculum content (${res.status})`);
      const json = (await res.json()) as { content: unknown };
      return json.content;
    },
  });

  return {
    content: data === undefined ? undefined : (substituteBrand(data, brand as unknown as Record<string, string>) as T),
    isLoading,
    isError,
  };
}

/**
 * Click handler for content rendered via dangerouslySetInnerHTML: internal
 * links authored as <a data-spa href="/..."> navigate through wouter instead
 * of a full page reload (SPA-nav requirement).
 */
export function useSpaHtmlClick(): (e: React.MouseEvent<HTMLElement>) => void {
  const [, navigate] = useLocation();
  return useCallback(
    (e: React.MouseEvent<HTMLElement>) => {
      const anchor = (e.target as HTMLElement).closest("a[data-spa]");
      if (!anchor) return;
      const href = anchor.getAttribute("href");
      if (href && href.startsWith("/")) {
        e.preventDefault();
        navigate(href);
      }
    },
    [navigate],
  );
}

/** Shared loading skeleton for curriculum pages. */
export const CURRICULUM_SKELETON_ROWS = [1, 2, 3];
