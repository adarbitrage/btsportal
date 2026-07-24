import { randomBytes } from "node:crypto";
import { test, expect } from "@playwright/test";
import bcrypt from "bcryptjs";
import { Pool } from "pg";
import { loginAs } from "./auth";

// Task #1987: the Account page is now six collapsible cards (Profile, Change
// Password, Ad Balance, Payment Methods, Where You're Signed In, Notification
// Preferences), all collapsed by default, and /payment-methods redirects to
// /account?card=payment-methods with that card pre-expanded.

interface Fixture {
  memberEmail: string;
  memberPassword: string;
  memberId: number;
  coachEmail: string;
  coachPassword: string;
  coachId: number;
}

let fixture: Fixture;

test.beforeAll(async () => {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL must be set for this E2E test.");
  const pool = new Pool({ connectionString: url });
  const tag = randomBytes(6).toString("hex");
  const memberEmail = `e2e-acct-${tag}@e2e.local`;
  const memberPassword = `E2E-${randomBytes(9).toString("base64url")}`;
  const hash = await bcrypt.hash(memberPassword, 10);
  const res = await pool.query<{ id: number }>(
    `INSERT INTO users (name, email, password_hash, role, email_verified, onboarding_complete)
     VALUES ($1, $2, $3, 'member', true, true) RETURNING id`,
    [`E2E Acct ${tag}`, memberEmail, hash],
  );
  const coachEmail = `e2e-acct-coach-${tag}@e2e.local`;
  const coachPassword = `E2E-${randomBytes(9).toString("base64url")}`;
  const coachHash = await bcrypt.hash(coachPassword, 10);
  const coachRes = await pool.query<{ id: number }>(
    `INSERT INTO users (name, email, password_hash, role, email_verified, onboarding_complete)
     VALUES ($1, $2, $3, 'coach', true, true) RETURNING id`,
    [`E2E Acct Coach ${tag}`, coachEmail, coachHash],
  );
  fixture = {
    memberEmail,
    memberPassword,
    memberId: res.rows[0].id,
    coachEmail,
    coachPassword,
    coachId: coachRes.rows[0].id,
  };
  await pool.end();
});

test.afterAll(async () => {
  const url = process.env.DATABASE_URL;
  if (!url || !fixture) return;
  const pool = new Pool({ connectionString: url });
  await pool
    .query(`DELETE FROM users WHERE id = ANY($1::int[])`, [
      `{${fixture.memberId},${fixture.coachId}}`,
    ])
    .catch(() => {});
  await pool.end();
});

test("account page shows six collapsed cards and toggles expand", async ({ page }) => {
  await loginAs(page, fixture.memberEmail, fixture.memberPassword);
  await page.goto("/account");

  // All six cards visible, collapsed (toggle says Show More, content hidden).
  for (const id of ["profile", "password", "ad-balance", "payment-methods", "notifications"]) {
    await expect(page.getByTestId(`button-toggle-${id}`)).toHaveText(/Show More/);
  }
  await expect(page.getByTestId("button-toggle-sessions")).toHaveText(/Show More/);
  await expect(page.getByTestId("card-active-sessions")).toBeVisible();
  await expect(page.locator("#account-name")).toHaveCount(0);

  // Expand Profile → content appears, toggle flips.
  await page.getByTestId("button-toggle-profile").click();
  await expect(page.locator("#account-name")).toBeVisible();
  await expect(page.getByTestId("button-toggle-profile")).toHaveText(/Show Less/);

  // Expand Ad Balance → balance + Fund button.
  await page.getByTestId("button-toggle-ad-balance").click();
  await expect(page.getByTestId("text-ad-balance")).toBeVisible();
  await expect(page.getByTestId("button-fund-ad-spend")).toBeVisible();

  // Collapse Profile again.
  await page.getByTestId("button-toggle-profile").click();
  await expect(page.locator("#account-name")).toHaveCount(0);
});

test("/payment-methods redirects to account with the card expanded", async ({ page }) => {
  await loginAs(page, fixture.memberEmail, fixture.memberPassword);
  await page.goto("/payment-methods");

  await expect(page).toHaveURL(/\/account\?card=payment-methods/);
  await expect(page.getByTestId("button-toggle-payment-methods")).toHaveText(/Show Less/);
  await expect(page.getByTestId("payment-methods-card-content")).toBeVisible();
});

test("coach users do not see the Payment Methods card", async ({ page }) => {
  await loginAs(page, fixture.coachEmail, fixture.coachPassword);
  await page.goto("/account");

  // Coaches still get the other cards…
  await expect(page.getByTestId("button-toggle-profile")).toBeVisible();
  // …but the Payment Methods card is hidden entirely.
  await expect(page.getByTestId("button-toggle-payment-methods")).toHaveCount(0);
});

test("fund ad spend page renders with account back link", async ({ page }) => {
  await loginAs(page, fixture.memberEmail, fixture.memberPassword);
  await page.goto("/ad-spend/fund");

  await expect(page.getByRole("heading", { name: "Fund Ad Spend" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Back to account/ })).toBeVisible();
  await expect(page.getByText("Current Balance")).toBeVisible();
});
