import { describe, it, expect } from "vitest";
import { getStarterEmailTemplate, CALL_BOOKING_LIFECYCLE_SLUGS } from "../lib/seed-templates";
import { replaceVariables } from "../lib/communication-service";

// ── Full legal footer assertions (Task #1782) ────────────────────────────────
// All 9 canonical link hrefs that must appear in every lifecycle email footer.
const REQUIRED_FOOTER_HREFS = [
  "https://buildtestscale.com/privacy-policy",
  "https://buildtestscale.com/terms-of-service",
  "https://buildtestscale.com/earnings-disclaimer",
  "https://buildtestscale.com/affiliate-disclaimer",
  "https://buildtestscale.com/dmca-policy",
  "https://buildtestscale.com/accessibility-statement",
  "https://buildtestscale.com/sms-terms-and-conditions",
  "https://buildtestscale.com/performance-guarantee",
  "https://buildtestscale.com/contact-us",
] as const;

// Key fragments of the three disclaimer paragraphs.
const REQUIRED_DISCLAIMER_FRAGMENTS = [
  // Para 1 — bold/underline marker + opening clause
  "*DISCLAIMER</b></u>:",
  "We are committed to transparency and integrity",
  // Para 2 — bold/underline markers for NO GUARANTEE and NO WARRANTY
  "NO GUARANTEE</b></u>",
  "NO WARRANTY</b></u>",
  "not indicative of future results",
  // Para 3 — bold ALL-CAPS block
  "THE LEVEL OF SUCCESS YOU REACH EMPLOYING THESE TECHNIQUES",
  "BECAUSE OF THIS, WE CANNOT GUARANTEE YOUR EARNINGS LEVEL",
] as const;

// Exact copyright entity string (year is a token, resolved separately).
const COPYRIGHT_ENTITY = "Build. Test. Scale., LLC dba Build, Test, Scale";

/**
 * Task #1717 structural guard: renders every call-booking lifecycle email
 * template through the REAL production interpolation function
 * (`replaceVariables`, imported — not reimplemented) using the EXACT
 * variable set its real send site supplies, then asserts no literal `{{`
 * survives in the rendered subject/html/text.
 *
 * This is the regression guard for the real bug found in Task #1717's
 * Gmail testing: `scripts/preview-emails.ts` sent `kickoff_call_reminder`
 * without `staff_name`/`call_date`/`call_time`, so the live template body
 * (which interpolates those three tokens directly, in addition to the
 * person-block card) shipped the raw `{{staff_name}}` etc. tokens to the
 * inbox. Any future template edit that adds a token the send site doesn't
 * supply — or any send-site edit that drops a variable the template still
 * references — fails this test immediately, without needing a live send.
 *
 * `common` mirrors (deliberately duplicated, not imported) the
 * always-present defaults `getCommonVariables` merges into every send
 * (`portal_url`, `current_year`, `company_name`, `support_email`,
 * `logo_html`, `person_block_html`, `pitch_block_html`) so this test stays
 * a pure function of the template + explicit send-site variables, with no
 * DB/env dependency.
 */
const common: Record<string, string> = {
  portal_url: "https://portal.example.test",
  current_year: "2026",
  company_name: "Build Test Scale",
  support_email: "support@example.test",
  logo_html: '<img src="https://portal.example.test/images/bts-logo.png" alt="Build Test Scale" width="160">',
  ticketdesk_url: "https://support.example.test",
  person_block_html: "",
  pitch_block_html: "",
};

// One entry per lifecycle template, mirroring EXACTLY what the real send
// site (`call-bookings.ts::sendCallBookingLifecycleEmail` or
// `scheduled-comms.ts::processCallBookingReminders`) passes as `variables`
// on top of the common defaults above. Keep this list in lockstep with
// those two call sites — that's the whole point of the guard.
const LIFECYCLE_SEND_SITE_VARIABLES: Record<string, Record<string, string>> = {
  kickoff_call_confirmation: {
    member_name: "Alex Morgan",
    meeting_url: "https://meet.google.com/abc-defg-hij",
    person_block_html: "<div>person block</div>",
  },
  partner_call_confirmation: {
    member_name: "Alex Morgan",
    meeting_url: "https://meet.google.com/abc-defg-hij",
    person_block_html: "<div>person block</div>",
  },
  kickoff_call_reschedule: {
    member_name: "Alex Morgan",
    meeting_url: "https://meet.google.com/abc-defg-hij",
    person_block_html: "<div>person block</div>",
    previous_datetime_label: "Monday, July 13 at 10:00 AM EDT",
    new_datetime_label: "Tuesday, July 14 at 2:00 PM EDT",
  },
  partner_call_reschedule: {
    member_name: "Alex Morgan",
    meeting_url: "https://meet.google.com/abc-defg-hij",
    person_block_html: "<div>person block</div>",
    previous_datetime_label: "Monday, July 13 at 10:00 AM EDT",
    new_datetime_label: "Tuesday, July 14 at 2:00 PM EDT",
  },
  kickoff_call_cancel: {
    member_name: "Alex Morgan",
    person_block_html: "<div>person block</div>",
  },
  partner_call_cancel: {
    member_name: "Alex Morgan",
    person_block_html: "<div>person block</div>",
  },
  kickoff_call_reminder: {
    member_name: "Alex Morgan",
    staff_name: "Jordan Rivera",
    call_date: "Tuesday, July 14",
    call_time: "2:00 PM EDT",
    person_block_html: "<div>person block</div>",
  },
  partner_call_reminder: {
    member_name: "Alex Morgan",
    staff_name: "Sasha Bennett",
    call_date: "Wednesday, July 15",
    call_time: "11:00 AM EDT",
    person_block_html: "<div>person block</div>",
  },
};

describe("lifecycle email templates render with no leftover {{ tokens", () => {
  for (const [slug, sendSiteVariables] of Object.entries(LIFECYCLE_SEND_SITE_VARIABLES)) {
    it(`${slug}: subject/html/text fully interpolate`, () => {
      const starter = getStarterEmailTemplate(slug);
      expect(starter, `No starter template registered for slug "${slug}"`).toBeTruthy();
      if (!starter) return;

      const variables = { ...common, ...sendSiteVariables };
      const renderedSubject = replaceVariables(starter.subject, variables);
      const renderedHtml = replaceVariables(starter.htmlBody, variables);
      const renderedText = replaceVariables(starter.textBody, variables);

      expect(renderedSubject, `${slug} subject still contains a raw {{ token`).not.toContain("{{");
      expect(renderedHtml, `${slug} htmlBody still contains a raw {{ token`).not.toContain("{{");
      expect(renderedText, `${slug} textBody still contains a raw {{ token`).not.toContain("{{");
    });
  }

  it("every declared lifecycle template slug has a send-site variable fixture in this guard", () => {
    // Derives the "known lifecycle slugs" list from `CALL_BOOKING_LIFECYCLE_SLUGS`
    // (seed-templates.ts) instead of a hand-maintained array in this test file,
    // so a newly added call-booking lifecycle slug fails this check loudly
    // instead of the guard silently not covering it.
    for (const slug of CALL_BOOKING_LIFECYCLE_SLUGS) {
      expect(Object.keys(LIFECYCLE_SEND_SITE_VARIABLES), `no fixture for lifecycle slug "${slug}"`).toContain(slug);
    }
    expect(
      Object.keys(LIFECYCLE_SEND_SITE_VARIABLES).length,
      "guard has a fixture not present in CALL_BOOKING_LIFECYCLE_SLUGS — remove it or add it to the source of truth",
    ).toBe(CALL_BOOKING_LIFECYCLE_SLUGS.length);
  });
});

/**
 * Task #1782: full legal footer structure guard.
 *
 * Asserts that every lifecycle template's rendered HTML contains:
 *   - All 9 canonical policy/contact link hrefs (verbatim, no portal-relative
 *     paths — the footer uses absolute buildtestscale.com URLs)
 *   - The exact copyright entity string with the resolved current year
 *   - Key fragments from each of the three disclaimer paragraphs, including
 *     the email-safe bold/underline HTML markers
 *
 * These assertions deliberately check the rendered output (post-substitution),
 * not the raw template, so a future change that accidentally drops a link or
 * corrupts the disclaimer HTML fails here immediately.
 */
describe("lifecycle email templates contain the full legal footer", () => {
  for (const [slug, sendSiteVariables] of Object.entries(LIFECYCLE_SEND_SITE_VARIABLES)) {
    it(`${slug}: all 9 policy links present`, () => {
      const starter = getStarterEmailTemplate(slug);
      if (!starter) return;
      const variables = { ...common, ...sendSiteVariables };
      const renderedHtml = replaceVariables(starter.htmlBody, variables);

      for (const href of REQUIRED_FOOTER_HREFS) {
        expect(renderedHtml, `${slug} is missing footer link: ${href}`).toContain(href);
      }
    });

    it(`${slug}: copyright line with dynamic year and exact entity string`, () => {
      const starter = getStarterEmailTemplate(slug);
      if (!starter) return;
      const variables = { ...common, ...sendSiteVariables };
      const renderedHtml = replaceVariables(starter.htmlBody, variables);

      expect(renderedHtml, `${slug} missing resolved year in copyright`).toContain("Copyright 2026");
      expect(renderedHtml, `${slug} missing exact copyright entity string`).toContain(COPYRIGHT_ENTITY);
    });

    it(`${slug}: three-paragraph disclaimer with email-safe bold/underline markers`, () => {
      const starter = getStarterEmailTemplate(slug);
      if (!starter) return;
      const variables = { ...common, ...sendSiteVariables };
      const renderedHtml = replaceVariables(starter.htmlBody, variables);

      for (const fragment of REQUIRED_DISCLAIMER_FRAGMENTS) {
        expect(renderedHtml, `${slug} missing disclaimer fragment: "${fragment}"`).toContain(fragment);
      }
    });

    it(`${slug}: old condensed footer links (Terms of Service / Support) are not in the footer`, () => {
      const starter = getStarterEmailTemplate(slug);
      if (!starter) return;
      const variables = { ...common, ...sendSiteVariables };
      const renderedHtml = replaceVariables(starter.htmlBody, variables);

      expect(renderedHtml, `${slug} still contains a ticketdesk_url link in the footer`).not.toContain(">Support</a>");
      expect(renderedHtml, `${slug} still contains old portal terms-of-service link in the footer`).not.toContain("/terms-of-service\">Terms of Service</a>");
    });
  }
});
