import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { test, expect } from "@playwright/test";
import { Pool } from "pg";
import type { E2EFixture } from "./global-setup";
import { apiLogin, loginAsAdmin } from "./auth";

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

test.describe("Admin Members — Create Staff Account", () => {
  test("super_admin provisions a staff account, gets a one-time temp password, and the new account can sign in", async ({
    page,
  }) => {
    // The shared dev environment can be slow on cold start (browser launch +
    // background jobs), so give the whole flow generous headroom.
    test.setTimeout(120_000);
    const fixture = loadFixture();

    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      throw new Error(
        "DATABASE_URL must be set for the Create Staff Account E2E test (it verifies and cleans up the created account).",
      );
    }

    const tag = randomBytes(6).toString("hex");
    const newStaffName = `E2E Staff ${tag}`;
    const newStaffEmail = `e2e-staff-new-${tag}@e2e.local`;
    const STAFF_ROLE = "content_manager";
    const STAFF_ROLE_LABEL = "Content Manager";

    const pool = new Pool({ connectionString: databaseUrl });

    try {
      await loginAsAdmin(page, fixture);

      await page.goto("/admin/members");

      // The "Create Staff Account" button is only rendered for users with the
      // members:assign_role permission (super_admin), so it doubles as a guard.
      const addStaffButton = page.getByTestId("button-add-staff");
      await expect(addStaffButton).toBeVisible({ timeout: 15_000 });
      await addStaffButton.click();

      const dialog = page.getByTestId("dialog-add-staff");
      await expect(dialog).toBeVisible();

      await dialog.getByTestId("input-new-staff-name").fill(newStaffName);
      await dialog.getByTestId("input-new-staff-email").fill(newStaffEmail);

      // Pick a non-default role to exercise the role picker (default is
      // Support Agent). Radix Select renders options into a portal.
      await dialog.getByTestId("select-new-staff-role").click();
      await page.getByRole("option", { name: STAFF_ROLE_LABEL }).click();

      // Submit and wait for the real round-trip to the API + database.
      const [createResponse] = await Promise.all([
        page.waitForResponse(
          (res) =>
            res.url().includes("/api/admin/staff") &&
            res.request().method() === "POST",
          { timeout: 30_000 },
        ),
        dialog.getByTestId("button-confirm-add-staff").click(),
      ]);
      expect(
        createResponse.ok(),
        `Create staff API call failed (${createResponse.status()} ${createResponse.statusText()})`,
      ).toBe(true);

      const created = (await createResponse.json()) as {
        success: boolean;
        id: number;
        email: string;
        role: string;
        temporaryPassword: string;
      };
      const newStaffId = created.id;

      // The credentials dialog must show the one-time temporary password.
      const credentialsDialog = page.getByTestId("dialog-staff-credentials");
      await expect(credentialsDialog).toBeVisible();
      await expect(credentialsDialog.getByTestId("text-staff-email")).toHaveText(
        newStaffEmail,
      );
      await expect(credentialsDialog.getByTestId("text-staff-role")).toHaveText(
        STAFF_ROLE_LABEL,
      );

      const tempPasswordEl = credentialsDialog.getByTestId("text-staff-temp-password");
      await expect(tempPasswordEl).toBeVisible();
      const tempPassword = (await tempPasswordEl.textContent())?.trim() ?? "";
      expect(tempPassword.length).toBeGreaterThan(8);
      // The UI must show the exact password the API returned (shown only once).
      expect(tempPassword).toBe(created.temporaryPassword);

      // Confirm the account was actually persisted with the chosen role and is
      // immediately active (email verified, onboarding complete).
      const dbRow = await pool.query<{
        id: number;
        email: string;
        role: string;
        email_verified: boolean;
        onboarding_complete: boolean;
      }>(
        `SELECT id, email, role, email_verified, onboarding_complete
         FROM users WHERE email = $1`,
        [newStaffEmail],
      );
      expect(dbRow.rowCount).toBe(1);
      expect(dbRow.rows[0].id).toBe(newStaffId);
      expect(dbRow.rows[0].role).toBe(STAFF_ROLE);
      expect(dbRow.rows[0].email_verified).toBe(true);
      expect(dbRow.rows[0].onboarding_complete).toBe(true);

      // End-to-end proof the temp password works: the new account can sign in.
      const newAccountLogin = await apiLogin(newStaffEmail, tempPassword);
      expect(
        newAccountLogin.ok,
        `New staff account failed to sign in with the temporary password (HTTP ${newAccountLogin.status})`,
      ).toBe(true);

      // Close the credentials dialog cleanly.
      await credentialsDialog.getByTestId("button-done-staff-credentials").click();
      await expect(credentialsDialog).toBeHidden();
    } finally {
      // Clean up the account this spec created — the shared global-teardown only
      // knows about the seeded admin + member, not this freshly minted staff.
      try {
        const idForCleanup = await pool.query<{ id: number }>(
          `SELECT id FROM users WHERE email = $1`,
          [newStaffEmail],
        );
        const ids = idForCleanup.rows.map((r) => r.id);
        if (ids.length > 0) {
          await pool.query(`DELETE FROM audit_log WHERE actor_id = ANY($1::int[])`, [ids]);
          await pool.query(`DELETE FROM sessions WHERE user_id = ANY($1::int[])`, [ids]);
          await pool.query(`DELETE FROM users WHERE id = ANY($1::int[])`, [ids]);
        }
      } catch {
        /* best-effort cleanup */
      }
      await pool.end();
    }
  });
});
