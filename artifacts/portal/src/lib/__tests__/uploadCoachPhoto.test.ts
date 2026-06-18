import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Guards the two-step presigned-URL upload flow that turns a selected file into
// the internal "/objects/..." path the rest of the coach-photo feature depends
// on. Step 1: POST /api/storage/uploads/request-url returns { uploadURL,
// objectPath }. Step 2: PUT the raw file to uploadURL with its Content-Type. On
// success it returns objectPath; a non-ok PUT must throw a friendly error.
const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

import { uploadCoachPhoto } from "@/lib/coaches-admin-api";

const UPLOAD_URL = "https://storage.example.com/signed/put-here?token=abc";
const OBJECT_PATH = "/objects/uploads/coach-xyz789.png";

function makeFile(): File {
  return new File(["binary-bytes"], "headshot.png", { type: "image/png" });
}

function presignResponse() {
  return new Response(
    JSON.stringify({ uploadURL: UPLOAD_URL, objectPath: OBJECT_PATH }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

describe("uploadCoachPhoto", () => {
  it("requests a presigned URL, PUTs the file, and returns the object path", async () => {
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (typeof url === "string" && url.endsWith("/storage/uploads/request-url")) {
        return Promise.resolve(presignResponse());
      }
      return Promise.resolve(new Response(null, { status: 200 }));
    });

    const file = makeFile();
    const result = await uploadCoachPhoto(file);

    expect(result).toBe(OBJECT_PATH);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // Step 1: POST metadata (name/size/contentType), NOT the file itself.
    const [requestUrl, requestInit] = fetchMock.mock.calls[0];
    expect(requestUrl).toContain("/storage/uploads/request-url");
    expect(requestInit?.method).toBe("POST");
    expect(JSON.parse(requestInit?.body as string)).toEqual({
      name: "headshot.png",
      size: file.size,
      contentType: "image/png",
    });

    // Step 2: PUT the raw file to the presigned URL with its Content-Type.
    const [putUrl, putInit] = fetchMock.mock.calls[1];
    expect(putUrl).toBe(UPLOAD_URL);
    expect(putInit?.method).toBe("PUT");
    expect(putInit?.body).toBe(file);
    expect((putInit?.headers as Record<string, string>)["Content-Type"]).toBe(
      "image/png",
    );
  });

  it("throws a friendly error when the PUT upload fails", async () => {
    fetchMock.mockImplementation((url: string) => {
      if (typeof url === "string" && url.endsWith("/storage/uploads/request-url")) {
        return Promise.resolve(presignResponse());
      }
      return Promise.resolve(new Response(null, { status: 403 }));
    });

    await expect(uploadCoachPhoto(makeFile())).rejects.toThrow(
      "Upload failed. Please try again.",
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("surfaces the server error when requesting the presigned URL fails", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: "Failed to generate upload URL" }), {
        status: 500,
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(uploadCoachPhoto(makeFile())).rejects.toThrow(
      "Failed to generate upload URL",
    );
    // Never attempts the PUT if it never got an upload URL.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
