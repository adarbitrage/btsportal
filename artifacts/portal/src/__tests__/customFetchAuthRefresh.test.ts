import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, customFetch } from "@workspace/api-client-react";

// Regression coverage for the "Apps page won't load on nav, must refresh" bug.
// Root cause: access tokens are 15-minute JWTs and the data layer had no
// recovery path, so once a token expired every generated-hook query 401'd and
// surfaced an error (React Query uses retry:false) until a full page reload
// re-minted the token. customFetch now refreshes once (single-flight) on a 401
// and replays the request. These tests pin that behaviour at the fetch layer.

const APPS_URL = "/api/apps";
const REFRESH_URL = "/api/auth/refresh";

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function refreshCallCount(): number {
  return fetchMock.mock.calls.filter(
    ([url]) => String(url) === REFRESH_URL,
  ).length;
}

describe("customFetch transparent access-token refresh", () => {
  it("refreshes once and replays the request when the token has expired", async () => {
    let refreshed = false;
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (String(url) === REFRESH_URL) {
        expect(init?.method).toBe("POST");
        refreshed = true;
        return jsonResponse({ id: 1 }, 200);
      }
      return refreshed
        ? jsonResponse([{ appName: "lander", status: "ready" }], 200)
        : jsonResponse({ error: "Unauthorized" }, 401);
    });

    const result = await customFetch<Array<{ appName: string }>>(APPS_URL, {
      method: "GET",
    });

    expect(result).toEqual([{ appName: "lander", status: "ready" }]);
    expect(refreshCallCount()).toBe(1);
    // original 401 + refresh + replayed request
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("coalesces concurrent 401s into a single refresh (single-flight)", async () => {
    let refreshed = false;
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url) === REFRESH_URL) {
        refreshed = true;
        return jsonResponse({ id: 1 }, 200);
      }
      return refreshed
        ? jsonResponse([{ appName: "lander" }], 200)
        : jsonResponse({ error: "Unauthorized" }, 401);
    });

    const [a, b] = await Promise.all([
      customFetch<Array<{ appName: string }>>(APPS_URL, { method: "GET" }),
      customFetch<Array<{ appName: string }>>(APPS_URL, { method: "GET" }),
    ]);

    expect(a).toEqual([{ appName: "lander" }]);
    expect(b).toEqual([{ appName: "lander" }]);
    expect(refreshCallCount()).toBe(1);
  });

  it("surfaces the original 401 when the refresh itself fails", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url) === REFRESH_URL) {
        return jsonResponse({ error: "Invalid or expired refresh token" }, 401);
      }
      return jsonResponse({ error: "Unauthorized" }, 401);
    });

    await expect(
      customFetch(APPS_URL, { method: "GET" }),
    ).rejects.toMatchObject({ name: "ApiError", status: 401 });
    expect(refreshCallCount()).toBe(1);
  });

  it("does not attempt a refresh for auth endpoints (avoids loops)", async () => {
    fetchMock.mockImplementation(async () =>
      jsonResponse({ error: "Invalid credentials" }, 401),
    );

    await expect(
      customFetch("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email: "x@y.z", password: "nope" }),
      }),
    ).rejects.toBeInstanceOf(ApiError);
    expect(refreshCallCount()).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
