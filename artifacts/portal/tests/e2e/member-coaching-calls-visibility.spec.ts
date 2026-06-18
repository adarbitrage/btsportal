import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { test, expect } from "@playwright/test";
import { format } from "date-fns";
import bcrypt from "bcryptjs";
import { Pool } from "pg";
import type { E2EFixture } from "./global-setup";
import { apiLogin, cookieHeader, loginAs, AUTH_URL } from "./auth";

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

interface MemberCall {
  id: number;
  title: string;
  coachName: string;
  callType: string;
  scheduledAt: string;
  meetLink: string | null;
  isAccessible: boolean;
}

// Fetch the member-facing coaching calls list with a member's auth cookie,
// straight against the API (same endpoint the SPA's useListCoachingCalls hits).
// This lets us assert the full read-path *shape* (title, coach, time, link,
// gating) including the `title` that the weekly-schedule UI doesn't render.
async function fetchMemberCalls(cookie: string): Promise<MemberCall[]> {
  const res = await fetch(`${AUTH_URL}/api/coaching-calls?upcoming=true`, {
    headers: { cookie },
    signal: AbortSignal.timeout(15_000),
  });
  expect(
    res.ok,
    `Member coaching-calls API failed (HTTP ${res.status})`,
  ).toBe(true);
  return (await res.json()) as MemberCall[];
}

// Proves the OTHER half of the admin Group Calls loop: a call an admin schedules
// against the real backend actually surfaces on the member-facing Coaching page
// with the right time, coach, and Meet link — and that the `coaching:group`
// entitlement gate decides who can see the join link. The admin-write CRUD is
// covered by admin-coaching-calls-crud.spec.ts; this guards the member-read
// contract (endpoint, response shape, entitlement scrubbing) against drift.
test.describe("Member Coaching page — admin-scheduled group calls are visible + gated", () => {
  test("entitled member can join; non-entitled member sees it locked", async ({
    page,
  }) => {
    // Cold start (browser launch + server boot) can be slow on the shared env.
    test.setTimeout(120_000);
    const fixture = loadFixture();

    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      throw new Error(
        "DATABASE_URL must be set for the member coaching-calls visibility E2E test (it seeds a coach, a call, and two members).",
      );
    }

    const tag = randomBytes(6).toString("hex");
    const coachName = `E2E GroupCoach ${tag}`;
    const callTitle = `E2E Member Group Call ${tag}`;
    const meetLink = "https://meet.google.com/e2e-member-view";

    // Members with known passwords (the globalSetup member has an unusable hash,
    // and we need two distinct entitlement states anyway).
    const entitledEmail = `e2e-grp-yes-${tag}@e2e.local`;
    const entitledPassword = `E2E-${randomBytes(9).toString("base64url")}`;
    const lockedEmail = `e2e-grp-no-${tag}@e2e.local`;
    const lockedPassword = `E2E-${randomBytes(9).toString("base64url")}`;

    // Schedule the call a week out at a fixed time so it is unambiguously
    // "upcoming" and the formatted weekday/time are stable to assert against.
    const scheduledAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    scheduledAt.setHours(14, 30, 0, 0);
    const expectedWeekday = format(scheduledAt, "EEEE");
    const expectedStartTime = format(scheduledAt, "h:mm a");
    const expectedCoachFirstName = coachName.split(" ")[0];

    const pool = new Pool({ connectionString: databaseUrl });

    let coachId = 0;
    let productId = 0;
    let entitledMemberId = 0;
    let lockedMemberId = 0;
    let createdCallId = 0;

    try {
      // --- Seed coach + members + entitlement -------------------------------
      const coachRes = await pool.query<{ id: number }>(
        `INSERT INTO coaches (name, bio, specialties, does_group_calls, is_active)
         VALUES ($1, 'E2E group coach bio', 'E2E specialties', true, true)
         RETURNING id`,
        [coachName],
      );
      coachId = coachRes.rows[0].id;

      const productRes = await pool.query<{ id: number }>(
        `INSERT INTO products (slug, name, type, entitlement_keys, sort_order)
         VALUES ($1, $2, 'frontend', '["coaching:group"]'::jsonb, 0)
         RETURNING id`,
        [`e2e-grp-product-${tag}`, `E2E Group Plan ${tag}`],
      );
      productId = productRes.rows[0].id;

      const entitledHash = await bcrypt.hash(entitledPassword, 10);
      const lockedHash = await bcrypt.hash(lockedPassword, 10);

      const entitledRes = await pool.query<{ id: number }>(
        `INSERT INTO users (name, email, password_hash, role, email_verified, onboarding_complete)
         VALUES ($1, $2, $3, 'member', true, true)
         RETURNING id`,
        [`E2E Entitled ${tag}`, entitledEmail, entitledHash],
      );
      entitledMemberId = entitledRes.rows[0].id;

      const lockedRes = await pool.query<{ id: number }>(
        `INSERT INTO users (name, email, password_hash, role, email_verified, onboarding_complete)
         VALUES ($1, $2, $3, 'member', true, true)
         RETURNING id`,
        [`E2E Locked ${tag}`, lockedEmail, lockedHash],
      );
      lockedMemberId = lockedRes.rows[0].id;

      // Only the entitled member gets the coaching:group product.
      await pool.query(
        `INSERT INTO user_products (user_id, product_id, status)
         VALUES ($1, $2, 'active')`,
        [entitledMemberId, productId],
      );

      // --- Create the group call through the REAL admin write path ----------
      // Going through POST /api/admin/coaching/calls (rather than a raw INSERT)
      // keeps both halves of the loop honest: if the admin-write contract and
      // the member-read contract drift apart, this test catches it.
      const adminLogin = await apiLogin(fixture.adminEmail, fixture.adminPassword);
      expect(
        adminLogin.ok,
        `Admin login failed (HTTP ${adminLogin.status})`,
      ).toBe(true);
      const adminCookie = cookieHeader(adminLogin.setCookies);

      const createRes = await fetch(`${AUTH_URL}/api/admin/coaching/calls`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: adminCookie },
        body: JSON.stringify({
          title: callTitle,
          description: "Scheduled via the admin API for the member-visibility E2E.",
          callType: "weekly_qa",
          coachId,
          scheduledAt: scheduledAt.toISOString(),
          durationMinutes: 60,
          meetLink,
          requiredEntitlement: "coaching:group",
        }),
        signal: AbortSignal.timeout(15_000),
      });
      expect(
        createRes.ok,
        `Admin create call API failed (HTTP ${createRes.status})`,
      ).toBe(true);
      createdCallId = ((await createRes.json()) as { id: number }).id;
      expect(createdCallId).toBeGreaterThan(0);

      // --- Member-read contract via the API (covers `title`) ----------------
      const entitledApiLogin = await apiLogin(entitledEmail, entitledPassword);
      expect(entitledApiLogin.ok).toBe(true);
      const entitledCookie = cookieHeader(entitledApiLogin.setCookies);
      const entitledCalls = await fetchMemberCalls(entitledCookie);
      const entitledCall = entitledCalls.find((c) => c.id === createdCallId);
      expect(
        entitledCall,
        "Admin-scheduled call must appear in the entitled member's coaching-calls feed",
      ).toBeTruthy();
      expect(entitledCall!.title).toBe(callTitle);
      expect(entitledCall!.coachName).toBe(coachName);
      expect(entitledCall!.callType).toBe("weekly_qa");
      expect(new Date(entitledCall!.scheduledAt).getTime()).toBe(
        scheduledAt.getTime(),
      );
      expect(entitledCall!.isAccessible).toBe(true);
      expect(entitledCall!.meetLink).toBe(meetLink);

      const lockedApiLogin = await apiLogin(lockedEmail, lockedPassword);
      expect(lockedApiLogin.ok).toBe(true);
      const lockedCookie = cookieHeader(lockedApiLogin.setCookies);
      const lockedCalls = await fetchMemberCalls(lockedCookie);
      const lockedCall = lockedCalls.find((c) => c.id === createdCallId);
      expect(
        lockedCall,
        "The call still appears for the non-entitled member, but locked",
      ).toBeTruthy();
      expect(lockedCall!.title).toBe(callTitle);
      // Entitlement gate: the Meet link is scrubbed for the non-entitled member.
      expect(lockedCall!.isAccessible).toBe(false);
      expect(lockedCall!.meetLink).toBeNull();

      // --- Entitled member: sees the call on the Coaching page, can join ----
      await loginAs(page, entitledEmail, entitledPassword);
      await page.goto("/coaching");

      const entitledRow = page.getByTestId(`weekly-call-${createdCallId}`);
      await expect(entitledRow).toBeVisible({ timeout: 30_000 });
      // Time + coach are what the weekly schedule renders for each call.
      await expect(entitledRow).toContainText(expectedWeekday);
      await expect(entitledRow).toContainText(expectedStartTime);
      await expect(entitledRow).toContainText(expectedCoachFirstName);
      // Accessible -> a real "Join Call" link pointing at the admin's Meet link.
      const joinLink = entitledRow.getByRole("link", { name: /join call/i });
      await expect(joinLink).toHaveAttribute("href", meetLink);
      await expect(
        entitledRow.getByRole("button", { name: /unlock/i }),
      ).toHaveCount(0);

      // --- Non-entitled member: sees the row, but locked (no Meet link) -----
      await loginAs(page, lockedEmail, lockedPassword);
      await page.goto("/coaching");

      const lockedRow = page.getByTestId(`weekly-call-${createdCallId}`);
      await expect(lockedRow).toBeVisible({ timeout: 30_000 });
      await expect(lockedRow).toContainText(expectedCoachFirstName);
      // No join link is offered; the gate shows an "Unlock" upgrade control.
      await expect(
        lockedRow.getByRole("link", { name: /join call/i }),
      ).toHaveCount(0);
      await expect(
        lockedRow.getByRole("button", { name: /unlock/i }),
      ).toBeVisible();
    } finally {
      // Best-effort cleanup so a mid-test failure doesn't leak fixtures into the
      // shared DB for other specs.
      try {
        if (createdCallId) {
          await pool.query(`DELETE FROM coaching_calls WHERE id = $1`, [
            createdCallId,
          ]);
        }
        if (coachId) {
          await pool.query(`DELETE FROM coaching_calls WHERE coach_id = $1`, [
            coachId,
          ]);
        }
        const memberIds = [entitledMemberId, lockedMemberId].filter((id) => id > 0);
        if (memberIds.length) {
          await pool.query(`DELETE FROM user_products WHERE user_id = ANY($1::int[])`, [
            memberIds,
          ]);
          await pool.query(`DELETE FROM sessions WHERE user_id = ANY($1::int[])`, [
            memberIds,
          ]);
          // Logging in / fetching as the member can queue GHL contact-sync jobs
          // in dev, which write ghl_sync_log rows that FK-reference the user.
          // Clear them first so the user delete below isn't blocked.
          await pool.query(`DELETE FROM ghl_sync_log WHERE user_id = ANY($1::int[])`, [
            memberIds,
          ]);
          await pool.query(`DELETE FROM users WHERE id = ANY($1::int[])`, [
            memberIds,
          ]);
        }
        if (productId) {
          await pool.query(`DELETE FROM products WHERE id = $1`, [productId]);
        }
        if (coachId) {
          await pool.query(`DELETE FROM coaches WHERE id = $1`, [coachId]);
        }
      } catch (err) {
        console.error("[e2e] member-coaching-calls cleanup failed:", err);
      }
      await pool.end();
    }
  });
});
