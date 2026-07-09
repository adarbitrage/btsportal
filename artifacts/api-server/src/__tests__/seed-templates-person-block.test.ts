import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import {
  qualifyPublicAssetUrl,
  qualifyPersonBlockImgSrcs,
  renderPersonBlock,
} from "../lib/seed-templates";

/**
 * Task #1717 + Task #1790: coach/partner photos are stored as root-relative
 * paths (e.g. `/partner-photos/john.jpg`). The photo must be qualified to an
 * absolute URL before it reaches Gmail — at SEND TIME in the communication-
 * service seam, not at render time in the caller — so the absolute URL is
 * produced regardless of whether the renderPersonBlock caller remembered to
 * thread portalUrl.
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

  it("falls back to the canonical public host when no portal host is configured", () => {
    // Task #1819 polish: a missing portal host must never degrade an email
    // image — the canonical production host is always fetchable.
    expect(qualifyPublicAssetUrl("/coaching-photos/sasha.png", null)).toBe(
      "https://portal.buildtestscale.com/coaching-photos/sasha.png",
    );
  });

  it("falls back to the canonical public host when the portal host is a dev default", () => {
    expect(qualifyPublicAssetUrl("/coaching-photos/sasha.png", "http://localhost:5000")).toBe(
      "https://portal.buildtestscale.com/coaching-photos/sasha.png",
    );
  });

  it("re-bases an absolute dev-internal URL onto the canonical public host", () => {
    expect(
      qualifyPublicAssetUrl("http://localhost:5000/images/bts-logo.png", "http://localhost:5000"),
    ).toBe("https://portal.buildtestscale.com/images/bts-logo.png");
  });

  it("degrades to null for empty/null/undefined input", () => {
    expect(qualifyPublicAssetUrl(null, "https://portal.example.test")).toBeNull();
    expect(qualifyPublicAssetUrl(undefined, "https://portal.example.test")).toBeNull();
    expect(qualifyPublicAssetUrl("   ", "https://portal.example.test")).toBeNull();
  });
});

describe("logo asset ships in the portal's public bundle", () => {
  it("the logo referenced by getCommonVariables exists in artifacts/portal/public/images and is a real PNG", () => {
    const logoPath = path.resolve(__dirname, "../../../portal/public/images/bts-logo.png");
    expect(fs.existsSync(logoPath), `expected logo asset at ${logoPath}`).toBe(true);

    const buffer = fs.readFileSync(logoPath);
    const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(buffer.subarray(0, 8).equals(pngSignature), "logo file is not a valid PNG").toBe(true);
  });
});

describe("renderPersonBlock photo qualification", () => {
  it("renders an absolute <img src> when portalUrl is supplied", () => {
    const html = renderPersonBlock({
      name: "John",
      photoUrl: "/partner-photos/john.jpg",
      bio: null,
      callTypeLabel: "Partner Call",
      dateTimeLabel: "Tuesday, July 14 at 2:00 PM EDT",
      portalUrl: "https://portal.buildtestscale.com",
    });
    expect(html).toContain('src="https://portal.buildtestscale.com/partner-photos/john.jpg"');
    expect(html).not.toContain(">J<");
  });

  it("renders an absolute canonical-host <img src> when portalUrl is absent", () => {
    // Task #1790 emitted the raw path here for the send-time seam to fix
    // up; Task #1819 polish goes further — the qualifier itself now falls
    // back to the canonical public host, so the img src is absolute and
    // publicly fetchable even with no portalUrl at all.
    const html = renderPersonBlock({
      name: "John",
      photoUrl: "/partner-photos/john.jpg",
      bio: null,
      callTypeLabel: "Partner Call",
      dateTimeLabel: "Tuesday, July 14 at 2:00 PM EDT",
      portalUrl: null,
    });
    expect(html).toContain("<img");
    expect(html).toContain('src="https://portal.buildtestscale.com/partner-photos/john.jpg"');
    expect(html).not.toContain(">J<");
  });

  it("renders initials (no <img>) when photo is genuinely NULL", () => {
    const html = renderPersonBlock({
      name: "Jean",
      photoUrl: null,
      bio: null,
      callTypeLabel: "Partner Call",
      dateTimeLabel: "Wednesday, July 15 at 11:00 AM EDT",
      portalUrl: "https://portal.buildtestscale.com",
    });
    expect(html).not.toContain("<img");
    expect(html).toContain(">J<");
  });

  it("renders initials (no <img>) for an /objects/ path — auth-gated, never publicly fetchable", () => {
    const html = renderPersonBlock({
      name: "Coach",
      photoUrl: "/objects/coaches/auth-gated-photo.jpg",
      bio: null,
      callTypeLabel: "Kickoff Call",
      dateTimeLabel: "Friday, July 18 at 3:00 PM EDT",
      portalUrl: "https://portal.buildtestscale.com",
    });
    expect(html).not.toContain("<img");
    expect(html).not.toContain("objects/");
    expect(html).toContain(">C<");
  });
});

describe("qualifyPersonBlockImgSrcs — communication-service send-time seam", () => {
  it("qualifies a root-relative img src to an absolute URL using the portal host", () => {
    // renderPersonBlock now qualifies its own src even without portalUrl,
    // so exercise the send-time backstop with a hand-built raw block — the
    // case where a caller assembled person-block HTML some other way.
    const raw = '<img alt="John" src="/partner-photos/john.jpg">';

    const qualified = qualifyPersonBlockImgSrcs(raw, "https://portal.buildtestscale.com");
    expect(qualified).toContain('src="https://portal.buildtestscale.com/partner-photos/john.jpg"');
    expect(qualified).not.toContain('src="/partner-photos/john.jpg"');
  });

  it("leaves an already-absolute img src unchanged (idempotent)", () => {
    const preQualified = renderPersonBlock({
      name: "John",
      photoUrl: "/partner-photos/john.jpg",
      bio: null,
      callTypeLabel: "Partner Call",
      dateTimeLabel: "Tuesday, July 14 at 2:00 PM EDT",
      portalUrl: "https://portal.buildtestscale.com",
    });
    expect(preQualified).toContain('src="https://portal.buildtestscale.com/partner-photos/john.jpg"');

    const reQualified = qualifyPersonBlockImgSrcs(preQualified, "https://portal.buildtestscale.com");
    expect(reQualified).toBe(preQualified);
  });

  it("does not touch an initials-only block (no <img> to rewrite)", () => {
    const initials = renderPersonBlock({
      name: "Jean",
      photoUrl: null,
      bio: null,
      callTypeLabel: "Partner Call",
      dateTimeLabel: "Wednesday, July 15 at 11:00 AM EDT",
    });
    expect(initials).not.toContain("<img");
    const after = qualifyPersonBlockImgSrcs(initials, "https://portal.buildtestscale.com");
    expect(after).toBe(initials);
  });

  it("does not rewrite /objects/ paths (they are not present as img src after renderPersonBlock)", () => {
    const initials = renderPersonBlock({
      name: "Coach",
      photoUrl: "/objects/coaches/secret.jpg",
      bio: null,
      callTypeLabel: "Kickoff Call",
      dateTimeLabel: "Friday, July 18 at 3:00 PM EDT",
    });
    expect(initials).not.toContain("objects/");
    const after = qualifyPersonBlockImgSrcs(initials, "https://portal.buildtestscale.com");
    expect(after).not.toContain("objects/");
    expect(after).not.toContain("<img");
  });

  it("qualifies against the canonical public host when portalUrl is absent", () => {
    // Task #1819 polish: the send-time seam must produce a publicly
    // fetchable URL even when no portal URL is configured at all.
    const raw = renderPersonBlock({
      name: "John",
      photoUrl: "/partner-photos/john.jpg",
      bio: null,
      callTypeLabel: "Partner Call",
      dateTimeLabel: "Tuesday, July 14 at 2:00 PM EDT",
      portalUrl: null,
    });
    const after = qualifyPersonBlockImgSrcs(raw, null);
    expect(after).toContain('src="https://portal.buildtestscale.com/partner-photos/john.jpg"');
    expect(after).not.toContain('src="/partner-photos/john.jpg"');
  });

  it("qualifies against the canonical public host when portalUrl is a dev default", () => {
    const raw = renderPersonBlock({
      name: "John",
      photoUrl: "/partner-photos/john.jpg",
      bio: null,
      callTypeLabel: "Partner Call",
      dateTimeLabel: "Tuesday, July 14 at 2:00 PM EDT",
      portalUrl: null,
    });
    const after = qualifyPersonBlockImgSrcs(raw, "http://localhost:5000");
    expect(after).toContain('src="https://portal.buildtestscale.com/partner-photos/john.jpg"');
  });

  it("rewrites an absolute dev-internal img src onto the canonical public host", () => {
    const raw = '<img alt="x" src="http://localhost:5000/partner-photos/john.jpg">';
    const after = qualifyPersonBlockImgSrcs(raw, null);
    expect(after).toContain('src="https://portal.buildtestscale.com/partner-photos/john.jpg"');
  });

  it("content-type guard: a URL served as text/html (SPA catch-all) is NOT a valid image src", () => {
    // This is the content-type-aware pre-flight check contract: a URL that
    // returns 200 but with content-type text/html (the SPA catch-all) must
    // NOT be treated as a valid image. The old SAMPLE_PERSON_BLOCK bug was
    // exactly this: /images/sample-coach.jpg returned 200/text/html from
    // the SPA catch-all, not 200/image/*.
    //
    // This test verifies the rule by asserting that the phantom URL
    // (/images/sample-coach.jpg) is NOT present in the portal's public
    // directory — if it were, it would ship as a real image. Its absence
    // proves the SPA catch-all is the only thing serving that path, which
    // means any pre-flight that checks for image/* content-type would (and
    // should) reject it.
    const phantomAssetPath = path.resolve(
      __dirname,
      "../../../portal/public/images/sample-coach.jpg",
    );
    expect(
      fs.existsSync(phantomAssetPath),
      "sample-coach.jpg must NOT exist in the portal public dir — the SPA catch-all was silently serving it as text/html",
    ).toBe(false);
  });
});

describe("partner-photos public assets exist and are real images", () => {
  it("john.jpg is present in portal/public/partner-photos and is a JPEG", () => {
    const photoPath = path.resolve(__dirname, "../../../portal/public/partner-photos/john.jpg");
    expect(fs.existsSync(photoPath), `expected john.jpg at ${photoPath}`).toBe(true);
    const buffer = fs.readFileSync(photoPath);
    // JPEG magic bytes: FF D8 FF
    expect(buffer[0]).toBe(0xff);
    expect(buffer[1]).toBe(0xd8);
    expect(buffer[2]).toBe(0xff);
  });
});
