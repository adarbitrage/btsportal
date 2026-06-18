import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { test, expect } from "@playwright/test";
import bcrypt from "bcryptjs";
import { Pool } from "pg";
import type { E2EFixture } from "./global-setup";
import { loginAs, loginAsAdmin } from "./auth";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function loadAdminFixture(): E2EFixture {
  try {
    const raw = readFileSync(join(__dirname, ".fixture.json"), "utf8");
    return JSON.parse(raw) as E2EFixture;
  } catch {
    throw new Error(
      "E2E fixture file is missing. The Playwright globalSetup must run first to seed an isolated admin.",
    );
  }
}

// End-to-end coverage for the admin coach picker on the Group Coaching calendar
// (/coach/group-coaching). Task #1115's frontend tests mock the data hooks, so
// the real API + UI wiring is unverified against a live server. This spec drives
// the real SPA against the real API and asserts the `?coachId` scoping contract:
//
//   1. An admin sees the coach picker, and switching it re-scopes the calendar
//      to the selected coach (the other coach's call vanishes).
//   2. A plain coach sees NO picker and only their OWN calls (never the other
//      coach's), proving they're pinned server-side to their own calendar.
//
// Each coach gets exactly ONE upcoming weekly_qa call, on distinct future dates,
// so the page's "focus the soonest call" effect deterministically surfaces that
// coach's call in the day-detail panel after a (re)scope, and the OTHER coach's
// call id is provably absent from the DOM.

interface CoachPickerFixture {
  coachUserEmail: string;
  coachUserPassword: string;
  coachUserId: number;
  coachAId: number;
  coachBId: number;
  coachAName: string;
  coachBName: string;
  coachACallId: number;
  coachBCallId: number;
}

let fixture: CoachPickerFixture;

test.beforeAll(async () => {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL must be set for the admin coach-picker E2E test (it seeds + tears down coaches and calls).",
    );
  }

  const pool = new Pool({ connectionString: url });
  const client = await pool.connect();
  const tag = randomBytes(6).toString("hex");

  const coachUserEmail = `e2e-coachpick-${tag}@e2e.local`;
  const coachUserPassword = `E2E-${randomBytes(9).toString("base64url")}`;
  const coachUserHash = await bcrypt.hash(coachUserPassword, 10);
  const coachAName = `E2E PickCoachA ${tag}`;
  const coachBName = `E2E PickCoachB ${tag}`;

  // Two distinct future dates so each coach's single call is unambiguously the
  // "soonest" for that coach, and the two never collide on one calendar day.
  const coachACallAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  coachACallAt.setHours(10, 0, 0, 0);
  const coachBCallAt = new Date(Date.now() + 9 * 24 * 60 * 60 * 1000);
  coachBCallAt.setHours(14, 0, 0, 0);

  try {
    await client.query("BEGIN");

    // A real coach login (role 'coach') drives the plain-coach scenario. It must
    // be email_verified or the login route refuses to mint a session.
    const coachUserRes = await client.query<{ id: number }>(
      `INSERT INTO users (name, email, password_hash, role, email_verified, onboarding_complete)
       VALUES ($1, $2, $3, 'coach', true, true)
       RETURNING id`,
      [`E2E Coach User ${tag}`, coachUserEmail, coachUserHash],
    );
    const coachUserId = coachUserRes.rows[0].id;

    // Coach A is linked to the login above (the plain coach views THIS calendar).
    // Coach B has no login — it only exists to prove the admin can scope to a
    // different coach and that a plain coach never sees it.
    const coachARes = await client.query<{ id: number }>(
      `INSERT INTO coaches (name, user_id, does_group_calls, is_active)
       VALUES ($1, $2, true, true)
       RETURNING id`,
      [coachAName, coachUserId],
    );
    const coachAId = coachARes.rows[0].id;

    const coachBRes = await client.query<{ id: number }>(
      `INSERT INTO coaches (name, does_group_calls, is_active)
       VALUES ($1, true, true)
       RETURNING id`,
      [coachBName],
    );
    const coachBId = coachBRes.rows[0].id;

    const coachACallRes = await client.query<{ id: number }>(
      `INSERT INTO coaching_calls
         (title, description, call_type, coach_id, scheduled_at, duration_minutes, required_entitlement)
       VALUES ($1, 'E2E coach-picker A call', 'weekly_qa', $2, $3, 60, 'coaching:group')
       RETURNING id`,
      [`${coachAName} weekly`, coachAId, coachACallAt.toISOString()],
    );
    const coachACallId = coachACallRes.rows[0].id;

    const coachBCallRes = await client.query<{ id: number }>(
      `INSERT INTO coaching_calls
         (title, description, call_type, coach_id, scheduled_at, duration_minutes, required_entitlement)
       VALUES ($1, 'E2E coach-picker B call', 'weekly_qa', $2, $3, 60, 'coaching:group')
       RETURNING id`,
      [`${coachBName} weekly`, coachBId, coachBCallAt.toISOString()],
    );
    const coachBCallId = coachBCallRes.rows[0].id;

    await client.query("COMMIT");

    fixture = {
      coachUserEmail,
      coachUserPassword,
      coachUserId,
      coachAId,
      coachBId,
      coachAName,
      coachBName,
      coachACallId,
      coachBCallId,
    };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
});

test.afterAll(async () => {
  const url = process.env.DATABASE_URL;
  if (!url || !fixture) return;
  const pool = new Pool({ connectionString: url });
  try {
    // FK order: calls reference coaches; coaches reference the user (SET NULL).
    await pool.query(`DELETE FROM coaching_calls WHERE coach_id = ANY($1::int[])`, [
      [fixture.coachAId, fixture.coachBId],
    ]);
    await pool.query(`DELETE FROM coaches WHERE id = ANY($1::int[])`, [
      [fixture.coachAId, fixture.coachBId],
    ]);
    await pool.query(`DELETE FROM users WHERE id = $1`, [fixture.coachUserId]);
  } catch (err) {
    console.error("[e2e] coach-picker cleanup failed:", err);
  } finally {
    await pool.end();
  }
});

test.describe("Admin coach picker on the Group Coaching calendar", () => {
  test("admin switches the picker and the calendar re-scopes to the selected coach", async ({
    page,
  }) => {
    test.setTimeout(120_000);

    // Sign in as the seeded admin (super_admin with coaching:view).
    await loginAsAdmin(page, loadAdminFixture());

    await page.goto("/coach/group-coaching", { waitUntil: "domcontentloaded" });

    // The picker is the admin-only tell: a plain coach never renders it.
    const picker = page.getByTestId("coach-picker");
    await expect(picker).toBeVisible({ timeout: 30_000 });

    const coachACall = page.getByTestId(`group-call-${fixture.coachACallId}`);
    const coachBCall = page.getByTestId(`group-call-${fixture.coachBCallId}`);

    // Scope to coach A: only A's call should surface in the day-detail panel
    // (the "focus the soonest call" effect brings it into view), and B's call
    // must NOT be in the DOM because the calendar is scoped to A.
    await picker.selectOption(String(fixture.coachAId));
    await expect(coachACall).toBeVisible({ timeout: 30_000 });
    await expect(coachBCall).toHaveCount(0);
    // Admins see the coach's name in the day detail.
    await expect(coachACall).toContainText(fixture.coachAName);

    // Switch to coach B: the calendar must re-scope — B's call appears, A's is gone.
    await picker.selectOption(String(fixture.coachBId));
    await expect(coachBCall).toBeVisible({ timeout: 30_000 });
    await expect(coachACall).toHaveCount(0);
    await expect(coachBCall).toContainText(fixture.coachBName);
  });

  test("admin can cancel and reinstate a coach's group call", async ({
    page,
  }) => {
    test.setTimeout(120_000);

    // Sign in as the seeded admin (super_admin with coaching:view).
    await loginAsAdmin(page, loadAdminFixture());

    await page.goto("/coach/group-coaching", { waitUntil: "domcontentloaded" });

    // Scope to coach A so their single (soonest) call surfaces in the day-detail
    // panel — the card we'll drive through cancel -> reinstate.
    const picker = page.getByTestId("coach-picker");
    await expect(picker).toBeVisible({ timeout: 30_000 });
    await picker.selectOption(String(fixture.coachAId));

    const card = page.getByTestId(`group-call-${fixture.coachACallId}`);
    await expect(card).toBeVisible({ timeout: 30_000 });
    // The seeded call starts active.
    await expect(card).toHaveAttribute("data-cancelled", "false");

    // Cancel: open the confirm dialog from the card's "Cancel this date" button,
    // confirm the AlertDialog, and assert the card flips to its cancelled state
    // once the mutation's query invalidation refetches the calendar. The dialog's
    // action shares the "Cancel this date" label with the card button, so scope
    // the click to the dialog.
    await page
      .getByTestId(`group-call-cancel-${fixture.coachACallId}`)
      .click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel this date" }).click();

    await expect(card).toHaveAttribute("data-cancelled", "true", {
      timeout: 30_000,
    });
    const reinstate = page.getByTestId(
      `group-call-restore-${fixture.coachACallId}`,
    );
    await expect(reinstate).toBeVisible();

    // Reinstate: un-cancel is low-stakes, so it fires immediately (no confirm).
    // The same card returns to its active state.
    await reinstate.click();
    await expect(card).toHaveAttribute("data-cancelled", "false", {
      timeout: 30_000,
    });
    await expect(
      page.getByTestId(`group-call-cancel-${fixture.coachACallId}`),
    ).toBeVisible();
  });

  test("a plain coach sees no picker and only their own calendar", async ({
    page,
  }) => {
    test.setTimeout(120_000);

    await loginAs(page, fixture.coachUserEmail, fixture.coachUserPassword);
    await page.goto("/coach/group-coaching", { waitUntil: "domcontentloaded" });

    // Their own (coach A's) soonest call surfaces once data loads.
    const coachACall = page.getByTestId(`group-call-${fixture.coachACallId}`);
    await expect(coachACall).toBeVisible({ timeout: 30_000 });

    // No admin coach picker for a plain coach.
    await expect(page.getByTestId("coach-picker")).toHaveCount(0);

    // The other coach's call must never appear — a plain coach is pinned
    // server-side to their own calendar and can't scope to anyone else.
    await expect(page.getByTestId(`group-call-${fixture.coachBCallId}`)).toHaveCount(0);
  });
});
