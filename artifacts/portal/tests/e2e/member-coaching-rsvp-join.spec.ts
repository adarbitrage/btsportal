import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { test, expect } from "@playwright/test";
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
  meetLink: string | null;
  hasRegistered: boolean;
}

async function fetchMemberCalls(cookie: string): Promise<MemberCall[]> {
  const res = await fetch(`${AUTH_URL}/api/coaching-calls?upcoming=true`, {
    headers: { cookie },
    signal: AbortSignal.timeout(15_000),
  });
  expect(res.ok, `Member coaching-calls API failed (HTTP ${res.status})`).toBe(
    true,
  );
  return (await res.json()) as MemberCall[];
}

// End-to-end pass through the member RSVP -> Join flow on the Coaching page,
// against the real API + DB. The API-side rules (1h RSVP cutoff, meet-link
// withholding, joined_at stamping) are covered by integration tests; this spec
// guards the UI wiring on top of them:
//   - RSVP button registers and flips to the "RSVP'd" (cancel) state
//   - cancel returns to the RSVP state; re-RSVP works
//   - inside the 1h cutoff a registered member sees the disabled
//     "Join opens 5 min before" waiting state, and the listing API withholds
//     the meet link
//   - a non-registered member inside the cutoff sees "RSVPs closed"
//   - inside the 5-minute join window the Join Call button appears; clicking
//     it opens the meet link in a new tab and stamps joined_at
// The client's window logic runs off a 30s clock tick against fetched data, so
// after each DB time-flip the page is reloaded to refetch.
test.describe("Member Coaching page — RSVP-to-Join flow", () => {
  test("RSVP, cancel, waiting state, closed state, and Join", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const fixture = loadFixture();

    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      throw new Error(
        "DATABASE_URL must be set for the RSVP-to-Join E2E test (it seeds a coach, calls, and a member).",
      );
    }

    const tag = randomBytes(6).toString("hex");
    const coachName = `E2E RsvpCoach ${tag}`;
    const meetLink = `https://meet.google.com/e2e-rsvp-${tag}`;
    const memberEmail = `e2e-rsvp-${tag}@e2e.local`;
    const memberPassword = `E2E-${randomBytes(9).toString("base64url")}`;

    const pool = new Pool({ connectionString: databaseUrl });

    let coachId = 0;
    let closedCoachId = 0;
    let productId = 0;
    let memberId = 0;
    let mainCallId = 0; // the call we walk through RSVP -> Join
    let closedCallId = 0; // already inside the 1h cutoff, never RSVP'd

    // Flip the main call's start time in the DB so the same call walks through
    // the RSVP-open, waiting, and join-open windows without real waiting.
    async function setCallStart(minutesFromNow: number): Promise<void> {
      await pool.query(
        `UPDATE coaching_calls
           SET scheduled_at = NOW() + ($1 || ' minutes')::interval
         WHERE id = $2`,
        [String(minutesFromNow), mainCallId],
      );
    }

    try {
      // --- Seed coach + entitled member --------------------------------------
      const coachRes = await pool.query<{ id: number }>(
        `INSERT INTO coaches (name, bio, specialties, does_group_calls, is_active)
         VALUES ($1, 'E2E rsvp coach bio', 'E2E specialties', true, true)
         RETURNING id`,
        [coachName],
      );
      coachId = coachRes.rows[0].id;

      // The weekly schedule collapses calls sharing weekday + HH:mm + coach
      // into one slot (soonest wins). The closed call gets its OWN coach so it
      // can never dedup away the main call once its time is flipped near the
      // closed call's start.
      const closedCoachRes = await pool.query<{ id: number }>(
        `INSERT INTO coaches (name, bio, specialties, does_group_calls, is_active)
         VALUES ($1, 'E2E closed coach bio', 'E2E specialties', true, true)
         RETURNING id`,
        [`E2E ClosedCoach ${tag}`],
      );
      closedCoachId = closedCoachRes.rows[0].id;

      const productRes = await pool.query<{ id: number }>(
        `INSERT INTO products (slug, name, type, entitlement_keys, sort_order)
         VALUES ($1, $2, 'frontend', '["coaching:group"]'::jsonb, 0)
         RETURNING id`,
        [`e2e-rsvp-product-${tag}`, `E2E RSVP Plan ${tag}`],
      );
      productId = productRes.rows[0].id;

      const memberHash = await bcrypt.hash(memberPassword, 10);
      const memberRes = await pool.query<{ id: number }>(
        `INSERT INTO users (name, email, password_hash, role, email_verified, onboarding_complete)
         VALUES ($1, $2, $3, 'member', true, true)
         RETURNING id`,
        [`E2E Rsvp Member ${tag}`, memberEmail, memberHash],
      );
      memberId = memberRes.rows[0].id;

      await pool.query(
        `INSERT INTO user_products (user_id, product_id, status)
         VALUES ($1, $2, 'active')`,
        [memberId, productId],
      );

      // --- Create both calls through the real admin write path ---------------
      const adminLogin = await apiLogin(fixture.adminEmail, fixture.adminPassword);
      expect(adminLogin.ok, `Admin login failed (HTTP ${adminLogin.status})`).toBe(
        true,
      );
      const adminCookie = cookieHeader(adminLogin.setCookies);

      async function createCall(
        title: string,
        scheduledAt: Date,
        callCoachId: number,
      ): Promise<number> {
        const res = await fetch(`${AUTH_URL}/api/admin/coaching/calls`, {
          method: "POST",
          headers: { "content-type": "application/json", cookie: adminCookie },
          body: JSON.stringify({
            title,
            description: "Seeded by the RSVP-to-Join E2E.",
            callType: "weekly_qa",
            coachId: callCoachId,
            scheduledAt: scheduledAt.toISOString(),
            durationMinutes: 60,
            meetLink,
            requiredEntitlement: "coaching:group",
          }),
          signal: AbortSignal.timeout(15_000),
        });
        expect(res.ok, `Admin create call failed (HTTP ${res.status})`).toBe(true);
        return ((await res.json()) as { id: number }).id;
      }

      // Main call: a week out, so RSVP is unambiguously open.
      mainCallId = await createCall(
        `E2E RSVP Flow Call ${tag}`,
        new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        coachId,
      );
      // Closed call: 30 minutes out — inside the 1h cutoff from the start.
      closedCallId = await createCall(
        `E2E RSVP Closed Call ${tag}`,
        new Date(Date.now() + 30 * 60 * 1000),
        closedCoachId,
      );

      // --- 1) RSVP-open call shows RSVP; closed call shows "RSVPs closed" ----
      await loginAs(page, memberEmail, memberPassword);
      await page.goto("/coaching");

      const registerBtn = page.getByTestId(`weekly-register-${mainCallId}`);
      await expect(registerBtn).toBeVisible({ timeout: 30_000 });
      await expect(registerBtn).toHaveText(/RSVP/);

      // Never-registered + inside the cutoff -> disabled "RSVPs closed".
      const closedBtn = page.getByTestId(`weekly-closed-${closedCallId}`);
      await expect(closedBtn).toBeVisible();
      await expect(closedBtn).toBeDisabled();
      await expect(closedBtn).toHaveText(/RSVPs closed/i);

      // --- 2) RSVP -> RSVP'd (cancel) state ----------------------------------
      await registerBtn.click();
      const cancelBtn = page.getByTestId(`weekly-cancel-${mainCallId}`);
      await expect(cancelBtn).toBeVisible({ timeout: 15_000 });
      await expect(cancelBtn).toContainText(/RSVP'd/);

      // --- 3) Cancel returns to the RSVP state, then re-RSVP -----------------
      await cancelBtn.click();
      await expect(
        page.getByTestId(`weekly-register-${mainCallId}`),
      ).toBeVisible({ timeout: 15_000 });
      await page.getByTestId(`weekly-register-${mainCallId}`).click();
      await expect(
        page.getByTestId(`weekly-cancel-${mainCallId}`),
      ).toBeVisible({ timeout: 15_000 });

      // Server truth: the re-RSVP must be persisted (registered_at stamped)
      // before we flip the clock. Guards against a UI state that only *looks*
      // registered.
      await expect
        .poll(
          async () => {
            const res = await pool.query<{ registered_at: Date | null }>(
              `SELECT registered_at FROM coaching_call_attendance
               WHERE call_id = $1 AND user_id = $2`,
              [mainCallId, memberId],
            );
            return res.rows[0]?.registered_at ?? null;
          },
          { timeout: 15_000, message: "registered_at should be stamped after re-RSVP" },
        )
        .not.toBeNull();

      // --- 4) Inside the cutoff (registered): waiting state, link withheld ---
      await setCallStart(30); // 30 min out: RSVP closed, join not yet open

      // The listing API withholds the meet link outside the join window even
      // for a registered member — the Join click is the only way to get it.
      const memberApiLogin = await apiLogin(memberEmail, memberPassword);
      expect(memberApiLogin.ok).toBe(true);
      const memberCookie = cookieHeader(memberApiLogin.setCookies);
      const outOfWindow = (await fetchMemberCalls(memberCookie)).find(
        (c) => c.id === mainCallId,
      );
      console.log("[e2e] out-of-window API row:", JSON.stringify(outOfWindow));
      expect(outOfWindow?.hasRegistered).toBe(true);
      expect(outOfWindow?.meetLink).toBeNull();

      await page.reload();
      const waitingBtn = page.getByTestId(`weekly-waiting-${mainCallId}`);
      await expect(waitingBtn).toBeVisible({ timeout: 30_000 });
      await expect(waitingBtn).toBeDisabled();
      await expect(waitingBtn).toContainText(/Join opens 5 min before/i);

      // --- 5) Join window: Join Call appears, opens the link, stamps joined_at
      await setCallStart(3); // 3 min out: inside the 5-minute join window
      await page.reload();
      const joinBtn = page.getByTestId(`weekly-join-${mainCallId}`);
      await expect(joinBtn).toBeVisible({ timeout: 30_000 });
      await expect(joinBtn).toHaveText(/Join Call/);

      // Stub the external meet URL so the popup doesn't actually hit Google
      // (which redirects unknown meeting codes) — what matters is that the SPA
      // opened the exact link the join endpoint handed back.
      await page.context().route("https://meet.google.com/**", (route) =>
        route.fulfill({
          status: 200,
          contentType: "text/html",
          body: "<html><body>e2e meet stub</body></html>",
        }),
      );
      const popupPromise = page.context().waitForEvent("page", {
        timeout: 30_000,
      });
      await joinBtn.click();
      const popup = await popupPromise;
      await popup.waitForLoadState("domcontentloaded").catch(() => undefined);
      expect(popup.url()).toBe(meetLink);
      await popup.close().catch(() => undefined);

      // joined_at is stamped on the member's attendance row.
      await expect
        .poll(
          async () => {
            const res = await pool.query<{ joined_at: Date | null }>(
              `SELECT joined_at FROM coaching_call_attendance
               WHERE call_id = $1 AND user_id = $2`,
              [mainCallId, memberId],
            );
            return res.rows[0]?.joined_at ?? null;
          },
          { timeout: 15_000, message: "joined_at should be stamped after Join" },
        )
        .not.toBeNull();
    } finally {
      // Best-effort cleanup so a mid-test failure doesn't leak fixtures.
      try {
        const callIds = [mainCallId, closedCallId].filter((id) => id > 0);
        if (callIds.length) {
          await pool.query(
            `DELETE FROM coaching_call_attendance WHERE call_id = ANY($1::int[])`,
            [callIds],
          );
          await pool.query(`DELETE FROM coaching_calls WHERE id = ANY($1::int[])`, [
            callIds,
          ]);
        }
        for (const cid of [coachId, closedCoachId]) {
          if (cid) {
            await pool.query(`DELETE FROM coaching_calls WHERE coach_id = $1`, [
              cid,
            ]);
          }
        }
        if (memberId) {
          await pool.query(`DELETE FROM user_products WHERE user_id = $1`, [
            memberId,
          ]);
          await pool.query(`DELETE FROM sessions WHERE user_id = $1`, [memberId]);
          await pool.query(`DELETE FROM ghl_sync_log WHERE user_id = $1`, [
            memberId,
          ]);
          await pool.query(`DELETE FROM users WHERE id = $1`, [memberId]);
        }
        if (productId) {
          await pool.query(`DELETE FROM products WHERE id = $1`, [productId]);
        }
        for (const cid of [coachId, closedCoachId]) {
          if (cid) {
            await pool.query(`DELETE FROM coaches WHERE id = $1`, [cid]);
          }
        }
      } catch (err) {
        console.error("[e2e] rsvp-join cleanup failed:", err);
      }
      await pool.end();
    }
  });
});
