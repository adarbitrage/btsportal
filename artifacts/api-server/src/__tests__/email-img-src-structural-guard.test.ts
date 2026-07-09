import { describe, it, expect } from "vitest";
import {
  getStarterEmailTemplate,
  listStarterEmailTemplateSlugs,
  renderPersonBlock,
  renderPitchBlock,
  qualifyPersonBlockImgSrcs,
  resolveEmailAssetHost,
  CANONICAL_PORTAL_ASSET_HOST,
} from "../lib/seed-templates";
import { replaceVariables, renderLogoHtml } from "../lib/communication-service";

/**
 * STRUCTURAL GUARD (Task #1819 polish): every `<img src>` in every rendered
 * starter email must be an absolute URL on the production portal host —
 * `https://portal.buildtestscale.com` — no relative paths, no dev hosts.
 *
 * This is the THIRD occurrence of the "broken logo in the inbox" bug. Every
 * prior occurrence had the same root cause: `getPortalUrl()` resolving to a
 * non-public host (dev default `http://localhost:5000`, or nothing at all)
 * and an image qualifier happily building an unfetchable URL from it. Gmail
 * proxies every email image through its own anonymous fetcher — a relative
 * path or a localhost/*.replit.dev URL ALWAYS renders as a broken image box.
 *
 * The guard renders EVERY starter template through the REAL production
 * seams (`renderLogoHtml`, `renderPersonBlock` + `qualifyPersonBlockImgSrcs`,
 * `renderPitchBlock`, `replaceVariables` — imported, not reimplemented)
 * under the WORST-CASE portal URL configurations (dev default, null,
 * workspace domain) and fails on any img src that is not an absolute
 * production-host URL. This test makes a fourth regression impossible.
 */

const PROD_IMG_SRC = /^https:\/\/portal\.buildtestscale\.com\//;

/**
 * The portal-URL configurations under which emails have historically shipped
 * broken images. The seam must produce production-host image URLs under ALL
 * of them.
 */
const WORST_CASE_PORTAL_URLS: Array<string | null> = [
  "http://localhost:5000", // dev default from getPortalUrl()
  null, // nothing configured at all
  "https://some-workspace.picard.replit.dev", // workspace preview domain
];

function extractImgSrcs(html: string): string[] {
  return Array.from(html.matchAll(/<img[^>]*\ssrc="([^"]*)"/gi)).map((m) => m[1]);
}

/** Fill every {{token}} present in the template with a benign placeholder. */
function genericVariablesFor(text: string): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const match of text.matchAll(/\{\{(\w+)\}\}/g)) {
    vars[match[1]] = "sample-value";
  }
  return vars;
}

function realSeamVariables(portalUrl: string | null): Record<string, string> {
  const personBlockRaw = renderPersonBlock({
    name: "Jordan Rivera",
    photoUrl: "/coaching-photos/sample-coach.png",
    bio: null,
    callTypeLabel: "Kickoff Call",
    dateTimeLabel: "Tuesday, July 14 at 2:00 PM EDT",
    portalUrl: null,
  });
  const pitchStack = [
    renderPitchBlock(
      {
        heading: "Sample offer",
        line: "Sample line.",
        buttonLabel: "Learn More",
        buttonUrl: "https://portal.buildtestscale.com/plans",
      },
      "primary",
    ),
    renderPitchBlock(
      {
        heading: "Second offer",
        line: "Sample line.",
        buttonLabel: "View Plans",
        buttonUrl: "https://portal.buildtestscale.com/plans",
      },
      "secondary",
    ),
    renderPitchBlock(
      {
        heading: "Third offer",
        line: "Sample line.",
        buttonLabel: "Explore",
        buttonUrl: "https://portal.buildtestscale.com/plans",
      },
      "tertiary",
    ),
  ].join("");
  return {
    // The exact seams getCommonVariables uses at send time:
    logo_html: renderLogoHtml("bts", portalUrl),
    person_block_html: qualifyPersonBlockImgSrcs(personBlockRaw, portalUrl),
    pitch_block_html: pitchStack,
    // Deliberately the worst-case value: if any template ever builds an
    // <img src> from {{portal_url}} directly (bypassing the asset seam),
    // this makes the guard fail loudly instead of passing by luck.
    portal_url: portalUrl ?? "",
  };
}

describe("structural guard: every rendered starter email ships only production-host img srcs", () => {
  const slugs = listStarterEmailTemplateSlugs();

  it("has a non-trivial starter template corpus to guard", () => {
    expect(slugs.length).toBeGreaterThan(20);
  });

  for (const portalUrl of WORST_CASE_PORTAL_URLS) {
    describe(`with portal URL = ${JSON.stringify(portalUrl)}`, () => {
      for (const slug of slugs) {
        it(`${slug}: all <img src> absolute on ${CANONICAL_PORTAL_ASSET_HOST}`, () => {
          const starter = getStarterEmailTemplate(slug);
          expect(starter, `starter template missing for ${slug}`).not.toBeNull();
          if (!starter) return;

          const variables = {
            ...genericVariablesFor(starter.htmlBody),
            ...realSeamVariables(portalUrl),
          };
          const rendered = replaceVariables(starter.htmlBody, variables);

          const srcs = extractImgSrcs(rendered);
          // Every template is wrapped by wrapHtml, whose header renders
          // {{logo_html}} — so at least the logo img must be present. If
          // this drops to zero the guard has gone blind, which is itself a
          // failure.
          expect(
            srcs.length,
            `${slug}: expected at least one <img> (the logo) in the rendered email`,
          ).toBeGreaterThanOrEqual(1);

          for (const src of srcs) {
            expect(
              src,
              `${slug}: <img src="${src}"> is not an absolute production-host URL — ` +
                `Gmail's image proxy cannot fetch relative paths or dev hosts`,
            ).toMatch(PROD_IMG_SRC);
          }
        });
      }
    });
  }
});

describe("resolveEmailAssetHost — the single seam that picks the image host", () => {
  it("falls back to the canonical host for the dev default portal URL", () => {
    expect(resolveEmailAssetHost("http://localhost:5000")).toBe(CANONICAL_PORTAL_ASSET_HOST);
  });

  it("falls back to the canonical host when nothing is configured", () => {
    expect(resolveEmailAssetHost(null)).toBe(CANONICAL_PORTAL_ASSET_HOST);
    expect(resolveEmailAssetHost(undefined)).toBe(CANONICAL_PORTAL_ASSET_HOST);
    expect(resolveEmailAssetHost("")).toBe(CANONICAL_PORTAL_ASSET_HOST);
    expect(resolveEmailAssetHost("   ")).toBe(CANONICAL_PORTAL_ASSET_HOST);
  });

  it("falls back to the canonical host for loopback and workspace domains", () => {
    expect(resolveEmailAssetHost("http://127.0.0.1:8080")).toBe(CANONICAL_PORTAL_ASSET_HOST);
    expect(resolveEmailAssetHost("https://x.picard.replit.dev")).toBe(CANONICAL_PORTAL_ASSET_HOST);
    expect(resolveEmailAssetHost("https://foo.repl.co")).toBe(CANONICAL_PORTAL_ASSET_HOST);
  });

  it("uses a configured PUBLIC portal host as-is (trailing slash trimmed)", () => {
    expect(resolveEmailAssetHost("https://portal.buildtestscale.com/")).toBe(
      "https://portal.buildtestscale.com",
    );
    expect(resolveEmailAssetHost("https://portal.example.com")).toBe("https://portal.example.com");
    // Real deployments on replit.app ARE publicly fetchable.
    expect(resolveEmailAssetHost("https://my-app.replit.app")).toBe("https://my-app.replit.app");
  });

  it("falls back to the canonical host for garbage values", () => {
    expect(resolveEmailAssetHost("not-a-url")).toBe(CANONICAL_PORTAL_ASSET_HOST);
  });
});

describe("renderLogoHtml — the real production logo seam", () => {
  for (const portalUrl of WORST_CASE_PORTAL_URLS) {
    it(`renders a production-host logo img under portal URL ${JSON.stringify(portalUrl)}`, () => {
      const html = renderLogoHtml("bts", portalUrl);
      expect(html).toContain("<img");
      const srcs = extractImgSrcs(html);
      expect(srcs).toHaveLength(1);
      expect(srcs[0]).toBe(`${CANONICAL_PORTAL_ASSET_HOST}/images/bts-logo.png`);
    });
  }

  it("uses a configured public portal host when one exists", () => {
    const html = renderLogoHtml("bts", "https://portal.buildtestscale.com");
    expect(extractImgSrcs(html)[0]).toBe(`${CANONICAL_PORTAL_ASSET_HOST}/images/bts-logo.png`);
  });
});
