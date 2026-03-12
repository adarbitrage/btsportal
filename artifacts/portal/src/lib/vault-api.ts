import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

async function vaultFetch(path: string, options?: RequestInit) {
  const res = await fetch(`${BASE}api${path}`, {
    ...options,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Request failed: ${res.status}`);
  }
  return res.json();
}

export function useVaultCollections() {
  return useQuery({
    queryKey: ["vault", "collections"],
    queryFn: () => vaultFetch("/vault/collections"),
  });
}

export function useVaultCollectionDetail(slug: string) {
  return useQuery({
    queryKey: ["vault", "collection", slug],
    queryFn: () => vaultFetch(`/vault/collections/${slug}`),
    enabled: !!slug,
  });
}

export function useVaultResources(params: Record<string, string> = {}) {
  const queryString = new URLSearchParams(params).toString();
  const hasParams = Object.keys(params).length > 0;
  return useQuery({
    queryKey: ["vault", "resources", params],
    queryFn: () => vaultFetch(`/vault/resources?${queryString}`),
    enabled: hasParams,
  });
}

export function useVaultFeaturedResources() {
  return useQuery({
    queryKey: ["vault", "resources", "featured"],
    queryFn: () => vaultFetch("/vault/resources/featured"),
  });
}

export function useVaultRecentResources() {
  return useQuery({
    queryKey: ["vault", "resources", "recent"],
    queryFn: () => vaultFetch("/vault/resources/recent"),
  });
}

export function useVaultResourceDetail(id: number | string) {
  return useQuery({
    queryKey: ["vault", "resource", id],
    queryFn: () => vaultFetch(`/vault/resources/${id}`),
    enabled: !!id,
  });
}

export function useVaultFavorites() {
  return useQuery({
    queryKey: ["vault", "favorites"],
    queryFn: () => vaultFetch("/vault/favorites"),
  });
}

export function useVaultStats() {
  return useQuery({
    queryKey: ["vault", "stats"],
    queryFn: () => vaultFetch("/vault/stats"),
  });
}

export function useVaultSearchSuggestions(query: string) {
  return useQuery({
    queryKey: ["vault", "search-suggestions", query],
    queryFn: () => vaultFetch(`/vault/search-suggestions?q=${encodeURIComponent(query)}`),
    enabled: query.length >= 2,
  });
}

export function useToggleFavorite() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (resourceId: number) =>
      vaultFetch(`/vault/resources/${resourceId}/favorite`, { method: "POST" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["vault"] });
    },
  });
}

export function useDownloadResource() {
  return useMutation({
    mutationFn: (resourceId: number) =>
      vaultFetch(`/vault/resources/${resourceId}/download`, { method: "POST" }),
  });
}
