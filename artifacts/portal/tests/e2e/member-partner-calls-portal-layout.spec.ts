import { randomBytes } from "node:crypto";
import { test, expect } from "@playwright/test";
import bcrypt from "bcryptjs";
import { Pool } from "pg";
import { loginAs } from "./auth";

// Regression guard for Task: "Show Accountability Partner page inside portal
// layout". /coaching/partner-calls reuses the onboarding BookPartnerCall
// component; outside onboarding its Wrapper used to render bare children (no
// sidebar / portal chrome). It must now wrap every state in AppLayout so the
// member sidebar is visible, while the onboarding route keeps OnboardingLayout.
test.describe("Accountability Partner page renders inside portal layout", () => {
  test.use({ viewport: { width: 1280, height: 900 }, navigationTimeout: 60_000 });
  test.describe.configure({ timeout: 120_000 });

  test("member sees sidebar + no-partner state on /coaching/partner-calls", async ({
    page,
  }) => {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      throw new Error(
        "DATABASE_URL must be set for the partner-calls layout E2E test (it seeds and tears down its own member).",
      );
    }

    const tag = randomBytes(6).toString("hex");
    const email = `e2e-pclayout-${tag}@e2e.local`;
    const password = `E2E-${randomBytes(9).toString("base64url")}`;

    const pool = new Pool({ connectionString: databaseUrl });
    let memberId = 0;
    try {
      const hash = await bcrypt.hash(password, 10);
      const res = await pool.query<{ id: number }>(
        `INSERT INTO users (name, email, password_hash, role, email_verified, onboarding_complete)
         VALUES ($1, $2, $3, 'member', true, true)
         RETURNING id`,
        [`E2E PC Layout ${tag}`, email, hash],
      );
      memberId = res.rows[0].id;

      await loginAs(page, email, password);

      await page.goto("/coaching/partner-calls", { waitUntil: "domcontentloaded" });

      // The page content renders (a fresh member has no partner assigned).
      await expect(
        page.getByRole("heading", { name: "Accountability Partner Coming Soon" }),
      ).toBeVisible({ timeout: 30_000 });

      // …inside the portal shell: the member sidebar is present.
      const sidebar = page.getByTestId("member-sidebar-scroll");
      await expect(sidebar).toBeVisible();
    } finally {
      if (memberId) {
        await pool
          .query("DELETE FROM sessions WHERE user_id = $1", [memberId])
          .catch((err) => console.error("session cleanup failed:", err));
        await pool
          .query("DELETE FROM users WHERE id = $1", [memberId])
          .catch((err) => console.error("user cleanup failed:", err));
      }
      await pool.end();
    }
  });
});
