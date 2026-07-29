/**
 * Task #2026: refreshUserQuietly must update the user on success but NEVER
 * clear the signed-in user on failure — Checkout calls it right after a
 * successful charge, and a transient /auth/me hiccup must not bounce a
 * member who just paid to the login page.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, waitFor, act } from "@testing-library/react";
import { AuthProvider, AuthContext } from "../auth";
import { useContext } from "react";
import type { AuthContextType } from "../auth";

let ctx: AuthContextType | null = null;

function Capture() {
  ctx = useContext(AuthContext);
  return null;
}

const me = { id: 1, email: "m@example.com", name: "M", role: "member", onboardingComplete: true };
const meUpdated = { ...me, onboardingComplete: false };

function okJson(body: unknown) {
  return { ok: true, status: 200, json: async () => body } as Response;
}
function fail(status = 500) {
  return { ok: false, status, json: async () => ({}) } as Response;
}

describe("refreshUserQuietly", () => {
  beforeEach(() => {
    ctx = null;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("updates the user snapshot on success", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okJson(me));
    vi.stubGlobal("fetch", fetchMock);
    render(
      <AuthProvider>
        <Capture />
      </AuthProvider>,
    );
    await waitFor(() => expect(ctx?.user).toMatchObject({ id: 1, onboardingComplete: true }));

    fetchMock.mockResolvedValue(okJson(meUpdated));
    let returned: unknown;
    await act(async () => {
      returned = await ctx!.refreshUserQuietly();
    });
    expect(returned).toMatchObject({ onboardingComplete: false });
    await waitFor(() => expect(ctx?.user).toMatchObject({ onboardingComplete: false }));
  });

  it("keeps the signed-in user when the refresh fails", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okJson(me));
    vi.stubGlobal("fetch", fetchMock);
    render(
      <AuthProvider>
        <Capture />
      </AuthProvider>,
    );
    await waitFor(() => expect(ctx?.user).toMatchObject({ id: 1 }));

    fetchMock.mockResolvedValue(fail(500));
    let returned: unknown = "sentinel";
    await act(async () => {
      returned = await ctx!.refreshUserQuietly();
    });
    expect(returned).toBeNull();
    // The critical assertion: user is NOT cleared.
    expect(ctx?.user).toMatchObject({ id: 1 });

    fetchMock.mockRejectedValue(new Error("network down"));
    await act(async () => {
      returned = await ctx!.refreshUserQuietly();
    });
    expect(returned).toBeNull();
    expect(ctx?.user).toMatchObject({ id: 1 });
  });
});
