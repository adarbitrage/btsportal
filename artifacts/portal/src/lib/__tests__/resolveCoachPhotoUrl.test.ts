import { describe, it, expect } from "vitest";
import { resolveCoachPhotoUrl } from "@/lib/coaches-admin-api";

// Guards the storage-path resolver that turns a stored coach photo value into a
// renderable <img> src. Absolute http(s) URLs (paste-a-URL flow) must pass
// through unchanged; internal "/objects/..." paths from the upload flow must be
// prefixed with the base-path-aware storage serving route. BASE_URL defaults to
// "/" under vitest, so the storage prefix is "/api/storage".
describe("resolveCoachPhotoUrl", () => {
  it("passes an absolute https URL through unchanged", () => {
    const url = "https://example.com/headshots/coach.jpg";
    expect(resolveCoachPhotoUrl(url)).toBe(url);
  });

  it("passes an absolute http URL through unchanged", () => {
    const url = "http://example.com/headshots/coach.jpg";
    expect(resolveCoachPhotoUrl(url)).toBe(url);
  });

  it("prefixes an internal /objects/... path with the storage route", () => {
    expect(
      resolveCoachPhotoUrl("/objects/uploads/coach-abc123.png"),
    ).toBe("/api/storage/objects/uploads/coach-abc123.png");
  });

  it("trims surrounding whitespace before resolving", () => {
    expect(
      resolveCoachPhotoUrl("  /objects/uploads/coach-abc123.png  "),
    ).toBe("/api/storage/objects/uploads/coach-abc123.png");
    expect(resolveCoachPhotoUrl("  https://example.com/x.jpg  ")).toBe(
      "https://example.com/x.jpg",
    );
  });

  it("returns null for null, undefined, empty, or whitespace-only values", () => {
    expect(resolveCoachPhotoUrl(null)).toBeNull();
    expect(resolveCoachPhotoUrl(undefined)).toBeNull();
    expect(resolveCoachPhotoUrl("")).toBeNull();
    expect(resolveCoachPhotoUrl("   ")).toBeNull();
  });

  it("returns an unrecognized non-URL value as-is (trimmed)", () => {
    expect(resolveCoachPhotoUrl("  some-legacy-value  ")).toBe(
      "some-legacy-value",
    );
  });
});
