import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Regression coverage for the community token-refresh fix. Community writes
// (comments, posts, reactions) route through the shared `customFetch`, so an
// expired 15-minute access token surfaces as a 401 that customFetch recovers
// from by refreshing once (single-flight) and replaying the request. If anyone
// reverts `communityFetch` back to a raw `fetch`, that recovery disappears and
// members hit spurious "Something went wrong" errors mid-session. These tests
// pin the 401 -> refresh -> retry behaviour for a community write path.
const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function isRefreshUrl(url: unknown): boolean {
  return String(url).includes("/api/auth/refresh");
}

function refreshCallCount(): number {
  return fetchMock.mock.calls.filter(([url]) => isRefreshUrl(url)).length;
}

import { createComment, CommunityApiError } from "@/lib/community-api";

describe("community write transparent token refresh", () => {
  it("refreshes once and replays the write when the access token has expired", async () => {
    let refreshed = false;
    fetchMock.mockImplementation(async (url: unknown) => {
      if (isRefreshUrl(url)) {
        refreshed = true;
        return jsonResponse(200, { ok: true });
      }
      // First comment POST 401s (expired token); after the refresh the
      // replayed request succeeds with the created comment.
      return refreshed
        ? jsonResponse(200, {
            id: 42,
            postId: 1,
            content: "hello",
            createdAt: "2026-06-12T00:00:00Z",
            updatedAt: "2026-06-12T00:00:00Z",
          })
        : jsonResponse(401, { error: "Unauthorized" });
    });

    const comment = await createComment({ postId: 1, body: "hello" });

    expect(comment.id).toBe(42);
    expect(comment.body).toBe("hello");
    // exactly one refresh round-trip
    expect(refreshCallCount()).toBe(1);
    // original 401 + refresh + replayed write
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("throws CommunityApiError with status 401 when the refresh also fails", async () => {
    fetchMock.mockImplementation(async (url: unknown) => {
      if (isRefreshUrl(url)) {
        return jsonResponse(401, { error: "Invalid or expired refresh token" });
      }
      return jsonResponse(401, { error: "Unauthorized" });
    });

    const err = await createComment({ postId: 1, body: "hello" }).catch(
      (e: Error) => e,
    );

    expect(err).toBeInstanceOf(CommunityApiError);
    expect((err as CommunityApiError).status).toBe(401);
    // refresh was attempted exactly once before giving up
    expect(refreshCallCount()).toBe(1);
  });
});
