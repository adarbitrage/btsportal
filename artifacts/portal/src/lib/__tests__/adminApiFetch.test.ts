import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// admin-api.ts talks to the API through the global `fetch`. These tests pin
// down how `adminFetch` handles bodyless success responses — specifically the
// 204 No Content returned by DELETE /admin/announcements/:id, which used to
// throw because we always called res.json().
const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

import { deleteAnnouncement, updateAnnouncement } from "@/lib/admin-api";

describe("adminFetch empty-response handling", () => {
  it("resolves (does not throw) on a 204 No Content delete", async () => {
    fetchMock.mockResolvedValue(
      new Response(null, { status: 204 }),
    );
    await expect(deleteAnnouncement(1)).resolves.toBeUndefined();
  });

  it("still parses a JSON body on a normal 200 update", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ id: 1, title: "T", body: "B", type: "general", createdAt: "2026-01-01T00:00:00Z" }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const result = await updateAnnouncement(1, { title: "T", body: "B", type: "general" });
    expect(result).toMatchObject({ id: 1, title: "T" });
  });

  it("surfaces the server error message on a failed delete", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: "Announcement not found" }), {
        status: 404,
        headers: { "content-type": "application/json" },
      }),
    );
    await expect(deleteAnnouncement(999)).rejects.toThrow("Announcement not found");
  });
});
