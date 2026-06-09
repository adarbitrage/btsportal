import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// `authFetch` is the only collaborator we control. Each test resolves it
// with a hand-crafted non-OK Response so we can assert how the client
// turns the body into the Error message surfaced in admin toasts.
const authFetchMock = vi.fn();
vi.mock("@/lib/auth", () => ({
  authFetch: (...args: unknown[]) => authFetchMock(...args),
}));

import { adminPanelApi } from "@/lib/admin-panel-api";

beforeEach(() => {
  authFetchMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("admin-panel-api error extraction", () => {
  // Route handlers (e.g. the POST /admin/members catch blocks) return a
  // plain string under `error`.
  it("surfaces the message from a string-shaped error body", async () => {
    authFetchMock.mockResolvedValue(
      jsonResponse(409, { error: "A member with that email already exists" }),
    );
    await expect(
      adminPanelApi.createMember({ email: "a@b.com", name: "A" }),
    ).rejects.toThrow("A member with that email already exists");
  });

  // The shared sendError/RBAC layer (auth + permission rejections) returns
  // a structured object under `error`. Before the fix this produced the
  // useless "[object Object]" toast.
  it("surfaces error.message from a structured (sendError) error body", async () => {
    authFetchMock.mockResolvedValue(
      jsonResponse(403, {
        error: {
          code: "FORBIDDEN",
          message: "Insufficient permissions for this action",
          requestId: "req-123",
        },
      }),
    );
    const err = await adminPanelApi
      .createMember({ email: "a@b.com", name: "A" })
      .catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe("Insufficient permissions for this action");
    expect((err as Error).message).not.toContain("[object Object]");
  });

  it("falls back to the default message when the body has no usable error", async () => {
    authFetchMock.mockResolvedValue(jsonResponse(500, {}));
    await expect(
      adminPanelApi.createStaffAccount({ email: "a@b.com", name: "A", role: "support_agent" }),
    ).rejects.toThrow("Failed to create staff account");
  });
});
