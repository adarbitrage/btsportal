import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ReactNode } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import {
  useAffiliateConversions,
  useAffiliatePayouts,
} from "@/hooks/use-affiliate-performance";

// The hooks are thin react-query wrappers around a fetch to
// /api/affiliate/performance. These tests pin two contracts that are easy to
// break and invisible at the type level:
//   1. The query key is page-scoped per dataset, so different pages cache
//      independently (no stale carry-over when paginating).
//   2. A non-2xx response surfaces the server's `error` string as the thrown
//      Error message — that text is what the page shows the member.
const fetchMock = vi.fn();

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function makeWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("useAffiliateConversions", () => {
  it("requests the conversions dataset for the given page and returns the payload", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, { items: [{ id: "c1" }], hasNextPage: true, page: 2 }),
    );

    const { queryClient, wrapper } = makeWrapper();
    const { result } = renderHook(() => useAffiliateConversions(2), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual({
      items: [{ id: "c1" }],
      hasNextPage: true,
      page: 2,
    });

    // The URL carries dataset + page and the request is credentialed.
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("dataset=conversions");
    expect(String(url)).toContain("page=2");
    expect((init as RequestInit).credentials).toBe("include");

    // The cache entry is keyed by dataset + page so paginating doesn't collide.
    const keys = queryClient.getQueryCache().getAll().map((q) => q.queryKey);
    expect(keys).toContainEqual(["affiliate-performance", "conversions", 2, null, null, null]);
  });

  it("propagates the server error message when the request fails", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(503, {
        error: "Performance data is temporarily unavailable: the Tapfiliate integration is not configured.",
      }),
    );

    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useAffiliateConversions(1), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toMatch(/not configured/i);
  });

  it("falls back to a status-based message when the body has no error field", async () => {
    fetchMock.mockResolvedValue(jsonResponse(500, {}));

    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useAffiliateConversions(1), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toMatch(/status 500/i);
  });
});

describe("useAffiliatePayouts", () => {
  it("requests the payouts dataset and keys the cache by page", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, { items: [], hasNextPage: false, page: 1 }),
    );

    const { queryClient, wrapper } = makeWrapper();
    const { result } = renderHook(() => useAffiliatePayouts(1), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const [url] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("dataset=payouts");
    expect(String(url)).toContain("page=1");

    const keys = queryClient.getQueryCache().getAll().map((q) => q.queryKey);
    expect(keys).toContainEqual(["affiliate-performance", "payouts", 1]);
  });
});
