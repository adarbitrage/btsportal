import { describe, it, expect } from "vitest";
import { formatDeviceLabel } from "@/lib/device-label";

describe("formatDeviceLabel", () => {
  it("parses Chrome on Mac", () => {
    const ua =
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
    expect(formatDeviceLabel(ua)).toBe("Chrome on Mac");
  });

  it("parses Safari on iPhone", () => {
    const ua =
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1";
    expect(formatDeviceLabel(ua)).toBe("Safari on iPhone");
  });

  it("parses Chrome on Windows", () => {
    const ua =
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
    expect(formatDeviceLabel(ua)).toBe("Chrome on Windows");
  });

  it("parses Firefox on Linux", () => {
    const ua =
      "Mozilla/5.0 (X11; Linux x86_64; rv:125.0) Gecko/20100101 Firefox/125.0";
    expect(formatDeviceLabel(ua)).toBe("Firefox on Linux");
  });

  it("detects Edge before Chrome", () => {
    const ua =
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0";
    expect(formatDeviceLabel(ua)).toBe("Edge on Windows");
  });

  it("detects Chrome on iOS (CriOS) as Chrome on iPhone", () => {
    const ua =
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/124.0.0.0 Mobile/15E148 Safari/604.1";
    expect(formatDeviceLabel(ua)).toBe("Chrome on iPhone");
  });

  it("parses Chrome on Android", () => {
    const ua =
      "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";
    expect(formatDeviceLabel(ua)).toBe("Chrome on Android");
  });

  it("falls back to the raw value when nothing is recognised", () => {
    const ua = "SomeCustomAgent/1.0";
    expect(formatDeviceLabel(ua)).toBe("SomeCustomAgent/1.0");
  });

  it("returns Unknown device for empty or missing values", () => {
    expect(formatDeviceLabel(null)).toBe("Unknown device");
    expect(formatDeviceLabel(undefined)).toBe("Unknown device");
    expect(formatDeviceLabel("")).toBe("Unknown device");
    expect(formatDeviceLabel("   ")).toBe("Unknown device");
  });
});
