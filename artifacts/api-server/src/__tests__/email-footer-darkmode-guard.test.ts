import { describe, it, expect } from "vitest";
import { getStarterEmailTemplate, CALL_BOOKING_LIFECYCLE_SLUGS } from "../lib/seed-templates";

/**
 * Task #1811: dark-mode footer protection guard.
 *
 * The legal footer <td> in wrapHtml() carries protective attributes so
 * dark-mode email clients (Gmail, Outlook) do not invert the dark navy
 * background into unreadable text:
 *   - data-ogsb="#0f172a" / data-ogsc="#94a3b8" (Outlook dark-mode hints)
 *   - background:#0f172a !important + background-color:#0f172a !important
 *
 * These attributes are easy to drop silently in a future footer edit, so this
 * test asserts they exist in the raw starter-template HTML of every
 * call-booking lifecycle email (plus a representative non-lifecycle template).
 */
const REQUIRED_DARK_MODE_FRAGMENTS = [
  'data-ogsb="#0f172a"',
  'data-ogsc="#94a3b8"',
  "background:#0f172a !important",
  "background-color:#0f172a !important",
] as const;

// Representative non-lifecycle starter templates also rendered via wrapHtml();
// covers the shared footer beyond the call-booking lifecycle set.
const NON_LIFECYCLE_SLUGS = ["welcome", "password_reset", "purchase_confirmation"] as const;

describe("email footer keeps its dark-mode protection attributes", () => {
  for (const slug of [...CALL_BOOKING_LIFECYCLE_SLUGS, ...NON_LIFECYCLE_SLUGS]) {
    it(`${slug}: footer <td> carries data-ogsb/data-ogsc and !important background locks`, () => {
      const starter = getStarterEmailTemplate(slug);
      expect(starter, `No starter template registered for slug "${slug}"`).toBeTruthy();
      if (!starter) return;

      for (const fragment of REQUIRED_DARK_MODE_FRAGMENTS) {
        expect(starter.htmlBody, `${slug} footer is missing dark-mode protection: ${fragment}`).toContain(fragment);
      }
    });
  }

  it("dark-mode attributes live on the same footer <td> element (not scattered)", () => {
    const starter = getStarterEmailTemplate(CALL_BOOKING_LIFECYCLE_SLUGS[0]);
    expect(starter).toBeTruthy();
    if (!starter) return;

    // The footer opening tag must contain all four protections together.
    const footerTdMatch = starter.htmlBody.match(/<td[^>]*data-ogsb[^>]*>/);
    expect(footerTdMatch, "no <td> with data-ogsb found in footer").toBeTruthy();
    const footerTd = footerTdMatch![0];
    for (const fragment of REQUIRED_DARK_MODE_FRAGMENTS) {
      expect(footerTd, `footer <td> tag missing: ${fragment}`).toContain(fragment);
    }
  });
});
