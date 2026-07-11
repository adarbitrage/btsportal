import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { randomUUID } from "crypto";
import { db, emailTemplatesTable, systemSettingsTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import {
  getStarterEmailTemplate,
  listStarterEmailTemplateSlugs,
  renderPersonBlock,
  renderPitchBlock,
  type PitchEmphasis,
} from "../lib/seed-templates";
import {
  PORTAL_URL_SETTING_KEY,
  __invalidatePortalUrlCacheForTests,
} from "../lib/portal-url-settings";

/**
 * Email polish fix: structural regression guard for the recurring "broken
 * header logo" bug (this was the THIRD time it shipped broken). Every prior
 * fix patched a specific call site; this test instead sends EVERY seeded
 * email template through the REAL send-time path —
 * `CommunicationService.sendEmailNow`, which resolves the portal URL,
 * builds `logo_html`/qualifies `person_block_html` via `getCommonVariables`,
 * and interpolates the template — with the portal URL pinned to the real
 * production host via an actual DB row (not hand-built common variables).
 * It captures the rendered HTML at the `sgMail.send` boundary, extracts
 * every `<img src="...">`, and fails if ANY of them is not an absolute
 * `https://portal.buildtestscale.com/...` URL.
 *
 * This makes the whole *class* of regression impossible to ship silently:
 *   - a relative path (`/images/...`) that escaped `qualifyPublicAssetUrl`
 *   - an `http://` (non-TLS) URL
 *   - a `localhost` / `*.replit.dev` / any other non-prod host leaking in
 *     because a script or environment resolved the wrong portal URL
 *   - a regression in `getCommonVariables`'s logo/person-block qualification
 *     seam itself, since this test calls the real send path rather than
 *     reimplementing variable assembly
 *
 * Root cause confirmed during this fix: running a send-adjacent script
 * directly via a bare shell (not through the app's running workflow, which
 * has `PORTAL_URL` in its process env) silently resolves the portal URL to
 * the dev default (`http://localhost:5000`) per `portal-url-settings.ts`'s
 * documented fallback order — the previous regressions are consistent with
 * a one-off script having been run that way. This test guards the send path
 * itself so that mistake can never again reach a real send.
 */

vi.hoisted(() => {
  process.env.SENDGRID_API_KEY = "SG.test-key-not-real";
});

const { sendMock } = vi.hoisted(() => ({
  sendMock: vi.fn(
    async (
      msg: { html: string; text: string; [k: string]: unknown },
    ): Promise<[{ headers: Record<string, string> }, unknown]> => [
      { headers: { "x-message-id": "stub-msg-id" } },
      {},
    ],
  ),
}));

vi.mock("@sendgrid/mail", () => ({
  default: {
    setApiKey: vi.fn(),
    send: sendMock,
  },
}));

vi.mock("../lib/redis", () => ({
  getRedis: () => null,
  getRedisConnection: vi.fn(),
  createRedisConnection: vi.fn(),
  isRedisConnected: async () => false,
}));

import { CommunicationService } from "../lib/communication-service";

const PROD_PORTAL_URL = "https://portal.buildtestscale.com";
const ABSOLUTE_PROD_IMG_RE = /^https:\/\/portal\.buildtestscale\.com\//;

const TEST_TAG = `img-src-guard-${randomUUID().slice(0, 8)}`;

function extractImgSrcs(html: string): string[] {
  const out: string[] = [];
  const re = /<img[^>]+src=["']([^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    out.push(m[1]);
  }
  return out;
}

function testSlugFor(starterSlug: string): string {
  return `${TEST_TAG}-${starterSlug}`;
}

const starterSlugs = listStarterEmailTemplateSlugs();

async function setPortalRow(url: string) {
  await db
    .delete(systemSettingsTable)
    .where(eq(systemSettingsTable.key, PORTAL_URL_SETTING_KEY));
  await db.insert(systemSettingsTable).values({
    key: PORTAL_URL_SETTING_KEY,
    value: url,
    category: "branding",
  });
  __invalidatePortalUrlCacheForTests();
}

/** A representative person-block send (booking confirmations) with a
 * root-relative photo path — exercises `qualifyPersonBlockImgSrcs` inside
 * `getCommonVariables` exactly as call-bookings.ts/scheduled-comms.ts do. */
function buildPersonBlockHtml(): string {
  return renderPersonBlock({
    name: "Jordan Rivera",
    photoUrl: "/coaching-photos/jordan.png",
    bio: "Coach bio text.",
    callTypeLabel: "Kickoff Call",
    dateTimeLabel: "Tuesday, July 14 at 2:00 PM EDT",
    // Intentionally omit portalUrl here — the whole point is that
    // getCommonVariables (not the caller) must qualify the resulting
    // root-relative <img src> against the real send-time portal URL.
  });
}

/** A representative multi-pitch stack (all three rendered positions) with a
 * thumbnail on the primary block. */
function buildPitchStackHtmlForPositions(positions: PitchEmphasis[]): string {
  return positions
    .map((position, i) =>
      renderPitchBlock(
        {
          heading: `Pitch ${i}`,
          line: "Pitch line copy.",
          buttonLabel: "Learn More",
          buttonUrl: `${PROD_PORTAL_URL}/plans`,
          thumbnailUrl: i === 0 ? `${PROD_PORTAL_URL}/images/pitch-thumbnails/example.gif` : undefined,
          thumbnailLinkUrl: i === 0 ? `${PROD_PORTAL_URL}/plans` : undefined,
        },
        position,
      ),
    )
    .join("");
}

beforeAll(async () => {
  process.env.SENDGRID_API_KEY = "SG.test-key-not-real";

  // Copy every starter template's real content into a test-tagged DB row so
  // sendEmailNow's real template lookup + getCommonVariables assembly run
  // against the exact seeded HTML, without touching the live rows other
  // tests/the running app depend on.
  for (const slug of starterSlugs) {
    const starter = getStarterEmailTemplate(slug);
    if (!starter) continue;
    await db.insert(emailTemplatesTable).values({
      slug: testSlugFor(slug),
      name: `[guard] ${starter.name}`,
      subject: starter.subject,
      htmlBody: starter.htmlBody,
      textBody: starter.textBody,
      category: starter.category,
      active: true,
    });
  }
});

afterAll(async () => {
  await db
    .delete(emailTemplatesTable)
    .where(inArray(emailTemplatesTable.slug, starterSlugs.map(testSlugFor)));
  await db
    .delete(systemSettingsTable)
    .where(eq(systemSettingsTable.key, PORTAL_URL_SETTING_KEY));
  __invalidatePortalUrlCacheForTests();
});

beforeEach(async () => {
  sendMock.mockClear();
  await setPortalRow(PROD_PORTAL_URL);
});

describe("email img src absolute-prod-host guard (logo regression class guard)", () => {
  expect(starterSlugs.length).toBeGreaterThan(0);

  for (const slug of starterSlugs) {
    it(`${slug}: every <img src> rendered through the real send path is an absolute https://portal.buildtestscale.com/... URL`, async () => {
      const result = await CommunicationService.sendEmailNow({
        templateSlug: testSlugFor(slug),
        to: "guard@example.test",
        variables: {
          member_name: "Guard Test",
          person_block_html: buildPersonBlockHtml(),
          pitch_block_html: buildPitchStackHtmlForPositions(["primary", "secondary", "tertiary"]),
        },
      });

      expect(result.status, `send for ${slug} did not succeed: ${JSON.stringify(result)}`).toBe("sent");
      expect(sendMock).toHaveBeenCalledTimes(1);
      const sentMsg = sendMock.mock.calls[0]![0] as unknown as { html: string };
      const imgSrcs = extractImgSrcs(sentMsg.html);

      // Every send includes at least the header logo.
      expect(imgSrcs.length).toBeGreaterThan(0);

      for (const src of imgSrcs) {
        expect(
          ABSOLUTE_PROD_IMG_RE.test(src),
          `${slug} has a non-absolute-prod-host <img src="${src}">`,
        ).toBe(true);
      }
    });
  }
});

describe("logo regression: real send-time host resolution failure modes", () => {
  it("still resolves an absolute prod-host logo <img src> when the portal URL comes from PORTAL_URL env (not a DB row)", async () => {
    await db
      .delete(systemSettingsTable)
      .where(eq(systemSettingsTable.key, PORTAL_URL_SETTING_KEY));
    const originalEnv = process.env.PORTAL_URL;
    process.env.PORTAL_URL = PROD_PORTAL_URL;
    __invalidatePortalUrlCacheForTests();
    try {
      const anySlug = starterSlugs[0]!;
      const result = await CommunicationService.sendEmailNow({
        templateSlug: testSlugFor(anySlug),
        to: "guard-env@example.test",
        variables: { member_name: "Guard Test" },
      });
      expect(result.status).toBe("sent");
      const sentMsg = sendMock.mock.calls.at(-1)![0] as unknown as { html: string };
      const imgSrcs = extractImgSrcs(sentMsg.html);
      expect(imgSrcs.length).toBeGreaterThan(0);
      for (const src of imgSrcs) {
        expect(ABSOLUTE_PROD_IMG_RE.test(src)).toBe(true);
      }
    } finally {
      if (originalEnv === undefined) {
        delete process.env.PORTAL_URL;
      } else {
        process.env.PORTAL_URL = originalEnv;
      }
      __invalidatePortalUrlCacheForTests();
    }
  });

  // Proves the guard actually catches the regression class instead of being
  // a tautology that always passes — each of these mirrors a real way the
  // bug has shipped before (relative path, http, localhost, other host).
  describe("negative control: the assertion actually fails on known-bad srcs", () => {
    const badSrcs = [
      "/images/bts-logo.png",
      "http://portal.buildtestscale.com/images/bts-logo.png",
      "http://localhost:5000/images/bts-logo.png",
      "https://example.com/images/bts-logo.png",
      "https://some-repl-name.replit.dev/images/bts-logo.png",
    ];
    for (const bad of badSrcs) {
      it(`rejects "${bad}"`, () => {
        expect(ABSOLUTE_PROD_IMG_RE.test(bad)).toBe(false);
      });
    }
  });
});
