import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Guards the client side of the community feed pagination contract: the server
// reads a `cursor` query param and returns `{ posts, nextCursor }`. The feed
// once broke because the client sent `page` and read a `pagination` object.
// We only control the global `fetch`, so we capture the request URL it is
// called with and feed back a hand-crafted response body.
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

function requestedUrl(): URL {
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const firstArg = fetchMock.mock.calls[0][0];
  return new URL(String(firstArg), "http://localhost");
}

import { fetchPosts } from "@/lib/community-api";

describe("fetchPosts pagination contract", () => {
  it("sends the cursor as the `cursor` query param (not `page`)", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { posts: [], nextCursor: null }));

    await fetchPosts({ cursor: "CURSOR_TOKEN", limit: 10 });

    const url = requestedUrl();
    expect(url.searchParams.get("cursor")).toBe("CURSOR_TOKEN");
    expect(url.searchParams.get("limit")).toBe("10");
    // The old, broken client paged with `page`; that param must never appear.
    expect(url.searchParams.has("page")).toBe(false);
  });

  it("omits the cursor param entirely on the first page", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { posts: [], nextCursor: "next-1" }));

    await fetchPosts({ limit: 10 });

    const url = requestedUrl();
    expect(url.searchParams.has("cursor")).toBe(false);
  });

  it("reads `nextCursor` from the response", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        posts: [{ id: 1 }, { id: 2 }],
        nextCursor: "next-cursor-abc",
      }),
    );

    const result = await fetchPosts({ limit: 10 });

    expect(result.nextCursor).toBe("next-cursor-abc");
    expect(result.posts.map((p) => p.id)).toEqual([1, 2]);
  });

  it("normalizes a missing nextCursor to null (no `pagination` object)", async () => {
    // The old server shape returned a `pagination` object and no top-level
    // `nextCursor`. Under that shape the client must surface a null cursor so
    // infinite-query stops, rather than silently looping or paging by page.
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        posts: [{ id: 1 }],
        pagination: { page: 1, totalPages: 3 },
      }),
    );

    const result = await fetchPosts({ limit: 10 });

    expect(result.nextCursor).toBeNull();
  });
});
