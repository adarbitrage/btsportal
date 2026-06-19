import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect } from "@playwright/test";
import type { E2EFixture } from "./global-setup";
import { loginAsAdmin } from "./auth";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function loadFixture(): E2EFixture {
  try {
    const raw = readFileSync(join(__dirname, ".fixture.json"), "utf8");
    return JSON.parse(raw) as E2EFixture;
  } catch {
    throw new Error(
      "E2E fixture file is missing. The Playwright globalSetup must run first to seed an isolated admin + member.",
    );
  }
}

// The Commission and Communications admin sections each render their own
// sidebar that collapses into a hamburger drawer below Tailwind's `md`
// breakpoint (768px), mirroring the main AdminLayout. This guards that mobile
// behavior end to end against the real SPA: at a phone-sized viewport the
// desktop sidebar must be hidden, the hamburger must open a drawer containing
// every nav link, and tapping a link must navigate and close the drawer.
//
// Keep the section configs below in lockstep with the nav arrays + data-testids
// in src/components/layout/{CommissionAdminLayout,CommunicationsLayout}.tsx.
interface Section {
  name: string;
  // The landing route to start on (admin is super_admin so all are reachable).
  landing: string;
  desktopSidebar: string;
  drawer: string;
  // Every nav link label the drawer should expose.
  navLinks: string[];
  // A link that changes the URL when tapped (proves navigation + drawer close).
  clickLabel: string;
  expectUrl: RegExp;
}

const sections: Section[] = [
  {
    name: "Commission",
    landing: "/admin/commissions",
    desktopSidebar: "commission-sidebar-desktop",
    drawer: "commission-sidebar-drawer",
    navLinks: [
      "Overview",
      "All Commissions",
      "Payouts",
      "Affiliates",
      "Rates",
      "Resources",
      "Fraud Alerts",
    ],
    clickLabel: "Payouts",
    expectUrl: /\/admin\/commissions\/payouts/,
  },
  {
    name: "Communications",
    landing: "/admin/communications/templates",
    desktopSidebar: "communications-sidebar-desktop",
    drawer: "communications-sidebar-drawer",
    navLinks: [
      "Email Templates",
      "SMS Templates",
      "Sequences",
      "Broadcasts",
      "Announcements",
      "Communication Log",
      "Analytics",
    ],
    clickLabel: "Analytics",
    expectUrl: /\/admin\/communications\/analytics/,
  },
];

test.describe("Admin sub-menus collapse into a mobile drawer", () => {
  // A phone-sized viewport (below Tailwind's 768px `md` breakpoint) so the
  // desktop sidebar's `hidden md:flex` hides it and the `md:hidden` hamburger
  // bar shows.
  test.use({ viewport: { width: 390, height: 844 } });

  for (const section of sections) {
    test(`${section.name}: hamburger opens the drawer, links navigate, drawer closes`, async ({
      page,
    }) => {
      // Cold start on the shared environment (browser launch + Vite first
      // compile of the route) can be slow, so give the flow generous headroom.
      test.setTimeout(120_000);
      const fixture = loadFixture();

      await loginAsAdmin(page, fixture);
      await page.goto(section.landing);

      // The hamburger lives in the mobile-only top bar; its presence proves we
      // rendered the collapsed mobile layout (not the desktop sidebar).
      const hamburger = page.getByRole("button", { name: "Open menu" });
      await expect(hamburger).toBeVisible({ timeout: 30_000 });

      // The desktop sidebar exists in the DOM but must be hidden at this width.
      await expect(page.getByTestId(section.desktopSidebar)).toBeHidden();

      // The drawer is only mounted while open, so it shouldn't exist yet.
      await expect(page.getByTestId(section.drawer)).toHaveCount(0);

      // --- OPEN THE DRAWER ----------------------------------------------------
      await hamburger.click();

      const drawer = page.getByTestId(section.drawer);
      await expect(drawer).toBeVisible();

      // Every nav link should be present and visible inside the drawer.
      for (const label of section.navLinks) {
        await expect(
          drawer.getByRole("link", { name: label, exact: true }),
        ).toBeVisible();
      }
      // ...plus the "Back to Portal" escape hatch and the close button.
      await expect(
        drawer.getByRole("link", { name: "Back to Portal", exact: true }),
      ).toBeVisible();
      await expect(
        drawer.getByRole("button", { name: "Close menu" }),
      ).toBeVisible();

      // --- TAP A LINK: NAVIGATES + CLOSES THE DRAWER --------------------------
      await Promise.all([
        page.waitForURL(section.expectUrl),
        drawer
          .getByRole("link", { name: section.clickLabel, exact: true })
          .click(),
      ]);

      // The drawer closes (unmounts) once the location changes.
      await expect(page.getByTestId(section.drawer)).toHaveCount(0);
      // And the hamburger is back, confirming we're still in the mobile layout
      // on the new page.
      await expect(
        page.getByRole("button", { name: "Open menu" }),
      ).toBeVisible();
    });
  }
});
