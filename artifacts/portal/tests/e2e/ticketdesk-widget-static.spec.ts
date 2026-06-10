import { test, expect } from "@playwright/test";

// Smoke coverage for the TicketDesk live-chat widget tag (Task #737).
//
// The widget used to be injected at runtime by React, and the old
// `live-chat-launcher.spec.ts` asserted that dynamic injection. That behaviour
// is gone: the widget now loads from a single static <script> baked into
// artifacts/portal/index.html, so it is present on every page load with no auth
// gating at the HTML level. This spec locks in that contract — if the static tag
// is dropped, renamed, or its workspace/api attributes drift, it fails loudly
// instead of the chat launcher silently disappearing for every member.
//
// It also pings the widget URL itself so a smoke run catches the CDN/script
// going unreachable, which would break chat even with the tag intact.

// The exact widget URL + data attributes baked into index.html. Kept in lockstep
// with the static tag — a drift in either side breaks the assertions below.
const WIDGET_SRC = "https://tickets.buildtestscale.com/widget.js";
const WIDGET_WORKSPACE = "69a3830f-e36b-4c87-91fd-0c9e26b27278";
const WIDGET_API = "https://tickets.buildtestscale.com/api";

test.describe("TicketDesk widget static tag", () => {
  test("is present in <head> with the correct attributes on first (unauthenticated) load", async ({
    page,
  }) => {
    // Load the portal root as a guest — no auth helper, no cookie. The widget
    // tag is static HTML, so it must be in the served document regardless of
    // login state.
    await page.goto("/");

    const widget = page.locator(`head script[src="${WIDGET_SRC}"]`);
    await expect(widget).toHaveCount(1);
    await expect(widget).toHaveAttribute("data-workspace", WIDGET_WORKSPACE);
    await expect(widget).toHaveAttribute("data-api", WIDGET_API);
  });

  test("widget script URL is reachable (2xx)", async ({ request }) => {
    // A live launcher needs the script itself to load, not just the tag to
    // exist. Hit the absolute URL directly (not via the portal proxy) so this
    // exercises the real TicketDesk origin.
    const res = await request.get(WIDGET_SRC);
    expect(
      res.status(),
      `Expected the TicketDesk widget script at ${WIDGET_SRC} to return a 2xx, got ${res.status()}.`,
    ).toBeGreaterThanOrEqual(200);
    expect(res.status()).toBeLessThan(300);
  });
});
