import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// `authFetch` is the only collaborator we need to control. Each test
// resolves it with a hand-crafted Response so we can assert how the
// helper interprets headers, the streaming body, and the trailers
// fallback path.
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

/**
 * Build a Response whose body is a real ReadableStream so the helper
 * exercises its streaming-counter path (the same path the portal uses
 * in production). Splitting the bytes across multiple chunks proves the
 * counters carry state across chunk boundaries.
 */
function buildStreamingResponse(opts: {
  chunks: string[];
  headers?: Record<string, string>;
  contentType?: string;
}): Response {
  const headers = new Headers({
    "content-type": opts.contentType ?? "text/csv",
    ...opts.headers,
  });
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const enc = new TextEncoder();
      for (const c of opts.chunks) controller.enqueue(enc.encode(c));
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers });
}

describe("adminPanelApi.exportAuditLog — streaming counts and cap header", () => {
  it("reads the up-front X-Audit-Log-Hard-Cap header", async () => {
    authFetchMock.mockResolvedValue(
      buildStreamingResponse({
        chunks: ["id\n1\n2\n3\n"],
        headers: { "x-audit-log-hard-cap": "12345" },
      }),
    );

    const result = await adminPanelApi.exportAuditLog("csv");

    expect(authFetchMock).toHaveBeenCalledTimes(1);
    expect(result.hardCap).toBe(12345);
  });

  it("returns hardCap=null when the header is missing or malformed", async () => {
    authFetchMock.mockResolvedValueOnce(
      buildStreamingResponse({ chunks: ["id\n1\n"] }),
    );
    const a = await adminPanelApi.exportAuditLog("csv");
    expect(a.hardCap).toBeNull();

    authFetchMock.mockResolvedValueOnce(
      buildStreamingResponse({
        chunks: ["id\n"],
        headers: { "x-audit-log-hard-cap": "not-a-number" },
      }),
    );
    const b = await adminPanelApi.exportAuditLog("csv");
    expect(b.hardCap).toBeNull();
  });

  it("counts CSV data rows accurately even when split across chunk boundaries", async () => {
    authFetchMock.mockResolvedValue(
      buildStreamingResponse({
        // Body is `header\nrow1\nrow2\nrow3` (no trailing newline,
        // matching the streaming export's writer). Split mid-stream so
        // we exercise the header-LF state carrying across chunks.
        chunks: ["id,actor\n1,a\n2,b\n", "3,c"],
      }),
    );

    const result = await adminPanelApi.exportAuditLog("csv");

    // Three data rows: three newlines (header LF + two row separators)
    // and `3,c` past the last LF proves data was emitted, so the
    // counter returns the full newline count.
    expect(result.rowsReceived).toBe(3);
  });

  it("does not over-count CSV rows when fields contain embedded newlines (RFC 4180)", async () => {
    // The audit log's `description` column is free-text and the server
    // wraps any value containing `\n`/`\r`/`,`/`"` in double quotes per
    // RFC 4180. A naive `\n` counter would inflate the row count and
    // either miss real cap hits or fire false "capped" warnings on
    // exports with multi-line descriptions. Two real data rows where the
    // first description contains 3 embedded newlines must still report
    // exactly 2 rows.
    const body =
      'id,description\n' +
      '1,"line1\nline2\nline3\nline4"\n' +
      '2,plain';
    authFetchMock.mockResolvedValue(
      buildStreamingResponse({ chunks: [body] }),
    );

    const result = await adminPanelApi.exportAuditLog("csv");
    expect(result.rowsReceived).toBe(2);
  });

  it("handles escaped double-quotes inside CSV fields without losing quote state", async () => {
    // `""` inside a quoted field is an escaped double quote — the
    // counter must stay in quoted mode after seeing it, otherwise the
    // following `\n` would be wrongly treated as a row terminator.
    const body =
      'id,description\n' +
      '1,"he said ""hi"" then\nnewline"\n' +
      '2,"another ""quoted"" line"';
    authFetchMock.mockResolvedValue(
      buildStreamingResponse({ chunks: [body] }),
    );

    const result = await adminPanelApi.exportAuditLog("csv");
    expect(result.rowsReceived).toBe(2);
  });

  it("survives a quote split across chunk boundaries inside a quoted field", async () => {
    // Pathological chunking: a `"` byte that could be either an escaped
    // quote or the end of a quoted field lands at the very end of one
    // chunk, with the disambiguating next byte at the start of the
    // following chunk. The pendingQuote state must carry across.
    const body =
      'id,description\n' +
      '1,"a""b\nc"\n' + // contains "" escape and an embedded newline
      '2,plain';
    // Split right after the first `"` of the `""` escape.
    const splitAt = body.indexOf('""') + 1;
    authFetchMock.mockResolvedValue(
      buildStreamingResponse({
        chunks: [body.slice(0, splitAt), body.slice(splitAt)],
      }),
    );

    const result = await adminPanelApi.exportAuditLog("csv");
    expect(result.rowsReceived).toBe(2);
  });

  it("returns 0 CSV rows when only the header was streamed", async () => {
    authFetchMock.mockResolvedValue(
      buildStreamingResponse({ chunks: ["id,actor\n"] }),
    );
    const result = await adminPanelApi.exportAuditLog("csv");
    // Header LF is present but no byte followed it — must report zero
    // rows, not one (off-by-one would silently lie about an empty file).
    expect(result.rowsReceived).toBe(0);
  });

  it("counts JSON top-level objects via brace depth, ignoring braces in strings", async () => {
    // Three rows. The middle row has braces and quotes inside string
    // values to verify the state machine doesn't get confused by them.
    authFetchMock.mockResolvedValue(
      buildStreamingResponse({
        contentType: "application/json",
        chunks: [
          '[{"id":1},',
          // Brace inside a string + escaped quote — must not affect the
          // top-level depth.
          '{"id":2,"desc":"has { and \\" in it"},',
          '{"id":3}]',
        ],
      }),
    );

    const result = await adminPanelApi.exportAuditLog("json");
    expect(result.rowsReceived).toBe(3);
  });

  it("falls back to .blob() and still counts rows when the body has no streaming reader", async () => {
    // Some test fakes (and older browsers) hand back a Response without
    // a `body.getReader()` — the helper must still read the blob and
    // derive rowsReceived from it.
    const body = '[{"id":1},{"id":2},{"id":3},{"id":4}]';
    const fakeResponse = {
      ok: true,
      status: 200,
      headers: new Headers({
        "content-type": "application/json",
        "x-audit-log-hard-cap": "1000000",
      }),
      // No `body` field at all → reader path is skipped.
      blob: async () => new Blob([body], { type: "application/json" }),
    } as unknown as Response;
    authFetchMock.mockResolvedValue(fakeResponse);

    const result = await adminPanelApi.exportAuditLog("json");
    expect(result.rowsReceived).toBe(4);
    expect(result.hardCap).toBe(1_000_000);
  });

  it("reads the X-Audit-Log-Truncated trailer when the response exposes one", async () => {
    // Browsers don't expose trailers, but supertest-style fakes do via
    // `response.trailers`. The helper should pick that up so non-browser
    // SDK consumers get the authoritative server flag.
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("id\n1\n2\n"));
        controller.close();
      },
    });
    const res = new Response(stream, {
      status: 200,
      headers: new Headers({
        "content-type": "text/csv",
        "x-audit-log-hard-cap": "5",
      }),
    });
    Object.defineProperty(res, "trailers", {
      value: { "x-audit-log-truncated": "true" },
    });
    authFetchMock.mockResolvedValue(res);

    const result = await adminPanelApi.exportAuditLog("csv");
    expect(result.truncated).toBe(true);
    expect(result.hardCap).toBe(5);
  });

  it("returns truncated=null when no trailer is exposed (the browser default)", async () => {
    authFetchMock.mockResolvedValue(
      buildStreamingResponse({ chunks: ["id\n1\n"] }),
    );
    const result = await adminPanelApi.exportAuditLog("csv");
    expect(result.truncated).toBeNull();
  });
});
