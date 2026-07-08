import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { qualifyPublicAssetUrl, renderPersonBlock } from "../lib/seed-templates";

/**
 * Task #1717: coach/partner photos are stored as root-relative paths (e.g.
 * `/coaching-photos/sasha.png`). Those have no browser origin to resolve
 * against once baked into a sent email, so they must be qualified into an
 * absolute URL against the configured portal host before they reach the
 * `<img src>` — or degrade to the initials avatar rather than a broken
 * image box.
 */
describe("qualifyPublicAssetUrl", () => {
  it("qualifies a root-relative path against the portal host", () => {
    expect(qualifyPublicAssetUrl("/coaching-photos/sasha.png", "https://portal.example.test")).toBe(
      "https://portal.example.test/coaching-photos/sasha.png",
    );
  });

  it("adds the leading slash when the stored path is missing one", () => {
    expect(qualifyPublicAssetUrl("coaching-photos/sasha.png", "https://portal.example.test")).toBe(
      "https://portal.example.test/coaching-photos/sasha.png",
    );
  });

  it("passes an already-absolute http(s) URL through unchanged", () => {
    expect(qualifyPublicAssetUrl("https://cdn.example.test/sasha.png", "https://portal.example.test")).toBe(
      "https://cdn.example.test/sasha.png",
    );
  });

  it("degrades to null for an internal object-storage path (never publicly fetchable)", () => {
    expect(qualifyPublicAssetUrl("/objects/coaches/sasha.png", "https://portal.example.test")).toBeNull();
  });

  it("degrades to null when no portal host is configured", () => {
    expect(qualifyPublicAssetUrl("/coaching-photos/sasha.png", null)).toBeNull();
  });

  it("degrades to null for empty/null/undefined input", () => {
    expect(qualifyPublicAssetUrl(null, "https://portal.example.test")).toBeNull();
    expect(qualifyPublicAssetUrl(undefined, "https://portal.example.test")).toBeNull();
    expect(qualifyPublicAssetUrl("   ", "https://portal.example.test")).toBeNull();
  });
});

describe("logo asset ships in the portal's public bundle", () => {
  it("the logo referenced by getCommonVariables exists in artifacts/portal/public/images and is a real PNG", () => {
    // Deterministic stand-in for a live curl check: the header logo URL is
    // built from a fixed path ("/images/bts-logo.png") in
    // communication-service.ts. That path is only genuinely fetchable in
    // production if the file lives in the portal's *public* directory (it
    // ships verbatim into `dist/public`, same as the working
    // `/coaching-photos/*` files) rather than, say, `src/assets` (bundled
    // and hashed, or not shipped at all). This can't prove the *deployed*
    // bundle serves `image/*` — that still requires the canary curl against
    // the live host — but it does deterministically catch the asset being
    // deleted, renamed, or moved to a non-public location, which is what
    // silently produces the SPA-HTML-fallback 200 the task diagnosed.
    const logoPath = path.resolve(__dirname, "../../../portal/public/images/bts-logo.png");
    expect(fs.existsSync(logoPath), `expected logo asset at ${logoPath}`).toBe(true);

    const buffer = fs.readFileSync(logoPath);
    const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(buffer.subarray(0, 8).equals(pngSignature), "logo file is not a valid PNG").toBe(true);
  });
});

describe("renderPersonBlock photo qualification", () => {
  it("renders an absolute <img src> when a portalUrl is supplied", () => {
    const html = renderPersonBlock({
      name: "Sasha Bennett",
      photoUrl: "/coaching-photos/sasha.png",
      bio: null,
      callTypeLabel: "Partner Call",
      dateTimeLabel: "Wednesday, July 15 at 11:00 AM EDT",
      portalUrl: "https://portal.example.test",
    });
    expect(html).toContain('src="https://portal.example.test/coaching-photos/sasha.png"');
  });

  it("falls back to the initials avatar (no <img>) when photo can't be qualified", () => {
    const html = renderPersonBlock({
      name: "Sasha Bennett",
      photoUrl: "/coaching-photos/sasha.png",
      bio: null,
      callTypeLabel: "Partner Call",
      dateTimeLabel: "Wednesday, July 15 at 11:00 AM EDT",
      portalUrl: null,
    });
    expect(html).not.toContain("<img");
    expect(html).toContain(">S<");
  });
});
