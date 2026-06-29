import { randomBytes } from "node:crypto";
import { test, expect } from "@playwright/test";
import bcrypt from "bcryptjs";
import { Pool } from "pg";
import { loginAs } from "./auth";

// Regression guard for the "twitching Loading… spinner + missing Training menu"
// bug. Root cause was a doubled request path (`/api/api/content-access/me` ->
// 404) that left the content-access query permanently errored, which (a) kept
// the ContentAccessRoute guard's loading flag flipping on every remount —
// spinning every content-gated page forever — and (b) made the sidebar drop all
// content-gated nav, so members lost the Training menu entirely. See
// .agents/memory/authfetch-double-api-prefix.md.
//
// This test logs in as a real member and asserts the happy path the bug broke:
// a content-gated page (/blitz) actually renders (the guard resolves, no stuck
// spinner) AND the Training nav folder is present in the sidebar. With an empty
// content_access_map every page is open, so a plain verified member is enough to
// reproduce the original scenario (the Training/Blitz nav leaves are gated only
// by content access, not by any entitlement).
test.describe("Member content-gated pages render (content-access regression)", () => {
  // Desktop viewport so the sidebar is rendered inline (not behind the mobile
  // drawer). Cold start + first heavy-route Vite transform can be slow on the
  // shared env, so give navigations and the test a roomy budget.
  test.use({ viewport: { width: 1280, height: 900 }, navigationTimeout: 60_000 });
  test.describe.configure({ timeout: 120_000 });

  test("a member can load /blitz and still sees the Training menu", async ({
    page,
  }) => {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      throw new Error(
        "DATABASE_URL must be set for the member content-gated-pages E2E test (it seeds and tears down its own member).",
      );
    }

    const tag = randomBytes(6).toString("hex");
    const email = `e2e-content-${tag}@e2e.local`;
    const password = `E2E-${randomBytes(9).toString("base64url")}`;

    const pool = new Pool({ connectionString: databaseUrl });
    let memberId = 0;
    try {
      const hash = await bcrypt.hash(password, 10);
      const res = await pool.query<{ id: number }>(
        `INSERT INTO users (name, email, password_hash, role, email_verified, onboarding_complete)
         VALUES ($1, $2, $3, 'member', true, true)
         RETURNING id`,
        [`E2E Content Member ${tag}`, email, hash],
      );
      memberId = res.rows[0].id;

      await loginAs(page, email, password);

      // The member dashboard keeps fetching after first paint, so wait for the
      // DOM rather than the full "load" event, then let the assertions below
      // gate readiness.
      await page.goto("/blitz", { waitUntil: "domcontentloaded" });

      // (1) The page guard resolves and BlitzHub renders — i.e. NOT stuck on the
      // guard's "Loading…" spinner. The doubled-URL bug spun this forever.
      const heading = page.getByRole("heading", { name: "The Blitz™" });
      await expect(heading).toBeVisible({ timeout: 30_000 });

      // The original symptom was a fast mount/unmount *loop* (the "twitch"), so
      // assert the page stays rendered rather than flickering away.
      await page.waitForTimeout(1_500);
      await expect(heading).toBeVisible();

      // (2) The Training nav folder is present in the sidebar. The bug dropped
      // every content-gated nav item on the 404, so members lost this menu.
      const sidebar = page.getByTestId("member-sidebar-scroll");
      await expect(sidebar).toBeVisible();
      await expect(sidebar.getByText("Training", { exact: true })).toBeVisible();
    } finally {
      if (memberId) {
        await pool
          .query("DELETE FROM users WHERE id = $1", [memberId])
          .catch(() => {});
      }
      await pool.end();
    }
  });
});
