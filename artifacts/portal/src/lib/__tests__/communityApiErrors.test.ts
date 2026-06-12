import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// `communityFetch` is internal, so we exercise it through the public
// `fetchCategories` wrapper. The only collaborator we control is the global
// `fetch`, which we resolve with a hand-crafted non-OK Response so we can
// assert how the client turns the body into the thrown error message.
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

import { fetchCategories, CommunityApiError } from "@/lib/community-api";

describe("community-api error extraction", () => {
  // Route handlers (e.g. community POST catch blocks) return a plain string
  // under `error`.
  it("surfaces the message from a string-shaped error body", async () => {
    fetchMock.mockResolvedValue(jsonResponse(404, { error: "Category not found" }));
    const err = await fetchCategories().catch((e: Error) => e);
    expect(err).toBeInstanceOf(CommunityApiError);
    expect((err as Error).message).toBe("Category not found");
  });

  // The shared sendError/RBAC layer returns a structured object under
  // `error`. Before the fix this produced the useless "[object Object]"
  // message.
  it("surfaces error.message from a structured (sendError) error body", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(403, {
        error: {
          code: "FORBIDDEN",
          message: "Insufficient permissions for this action",
          requestId: "req-123",
        },
      }),
    );
    const err = await fetchCategories().catch((e: Error) => e);
    expect(err).toBeInstanceOf(CommunityApiError);
    expect((err as Error).message).toBe("Insufficient permissions for this action");
    expect((err as Error).message).not.toContain("[object Object]");
  });
});
