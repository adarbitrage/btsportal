import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listPrograms } from "../lib/tapfiliate";

const ORIGINAL_KEY = process.env.TAPFILIATE_API_KEY;

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

describe("listPrograms pagination", () => {
  beforeEach(() => {
    process.env.TAPFILIATE_API_KEY = "test-key";
  });

  afterEach(() => {
    process.env.TAPFILIATE_API_KEY = ORIGINAL_KEY;
    vi.restoreAllMocks();
  });

  it("fetches all pages until an empty page is returned", async () => {
    const page1 = Array.from({ length: 25 }, (_, i) => ({
      id: `p${i + 1}`,
      title: `Program ${i + 1}`,
    }));
    const page2 = [
      { id: "p26", title: "Heat Haven" },
      { id: "p27", title: "GrippIt" },
    ];

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(page1))
      .mockResolvedValueOnce(jsonResponse(page2))
      .mockResolvedValueOnce(jsonResponse([]));
    vi.stubGlobal("fetch", fetchMock);

    const result = await listPrograms();

    expect(result).toHaveLength(27);
    expect(result.map((p) => p.title)).toContain("Heat Haven");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[0][0]).toContain("/programs/?page=1");
    expect(fetchMock.mock.calls[1][0]).toContain("/programs/?page=2");
    expect(fetchMock.mock.calls[2][0]).toContain("/programs/?page=3");
  });

  it("stops and de-duplicates when pagination does not advance", async () => {
    const samePage = [
      { id: "p1", title: "Program 1" },
      { id: "p2", title: "Program 2" },
    ];

    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(samePage));
    vi.stubGlobal("fetch", fetchMock);

    const result = await listPrograms();

    expect(result).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
