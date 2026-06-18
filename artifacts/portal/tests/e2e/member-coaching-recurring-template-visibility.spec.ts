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
  title: string;
  coachName: string;
  callType: string;
  scheduledAt: string;
  meetLink: string | null;
  isAccessible: boolean;
}

// Fetch the member-facing coaching calls list with a member's auth cookie,
// straight against the API (same endpoint the SPA's useListCoachingCalls hits).
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

// Proves the recurring-template half of the admin Group Calls loop: a *recurring
// weekly call* set up via a template (POST /admin/coaching/calls/templates)
// auto-generates a batch of ordinary coaching_calls rows, and those generated
// weekly occurrences surface on the member-facing Coaching page with the right
// callType, coach, Meet link, and `coaching:group` entitlement gating. It then
// extends the series via the template's /generate endpoint and confirms the
// newly generated future weeks show up too.
//
// Task #1013 / member-coaching-calls-visibility.spec.ts covers a single one-off
// admin-scheduled call; this guards the template -> call generation path so a
// drift in the copied callType / requiredEntitlement / coach join can't silently
// hide weeks of calls from members.
test.describe("Member Coaching page — recurring-template calls are visible + gated", () => {
  test("generated weekly occurrences appear; entitled can join, non-entitled locked; /generate extends the series", async ({
    page,
  }) => {
    // Cold start (browser launch + server boot) can be slow on the shared env.
    test.setTimeout(120_000);
    const fixture = loadFixture();

    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      throw new Error(
        "DATABASE_URL must be set for the recurring-template visibility E2E test (it seeds a coach, a template, generated calls, and two members).",
      );
    }

    const tag = randomBytes(6).toString("hex");
    const coachName = `E2E RecurCoach ${tag}`;
    const templateTitle = `E2E Recurring Weekly Call ${tag}`;
    const meetLink = "https://meet.google.com/e2e-recurring-view";

    // Members with known passwords for the two entitlement states.
    const entitledEmail = `e2e-rec-yes-${tag}@e2e.local`;
    const entitledPassword = `E2E-${randomBytes(9).toString("base64url")}`;
    const lockedEmail = `e2e-rec-no-${tag}@e2e.local`;
    const lockedPassword = `E2E-${randomBytes(9).toString("base64url")}`;

    // First occurrence a week out at a fixed time so every generated occurrence
    // is unambiguously "upcoming". Weekly cadence (intervalDays 7) means each
    // batch lands on the same weekday at the same time.
    const anchorAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    anchorAt.setHours(11, 0, 0, 0);
    const occurrencesPerBatch = 2;
    const expectedCoachFirstName = coachName.split(" ")[0];

    const pool = new Pool({ connectionString: databaseUrl });

    let coachId = 0;
    let productId = 0;
    let entitledMemberId = 0;
    let lockedMemberId = 0;
    let templateId = 0;

    try {
      // --- Seed coach + members + entitlement -------------------------------
      const coachRes = await pool.query<{ id: number }>(
        `INSERT INTO coaches (name, bio, specialties, does_group_calls, is_active)
         VALUES ($1, 'E2E recurring coach bio', 'E2E specialties', true, true)
         RETURNING id`,
        [coachName],
      );
      coachId = coachRes.rows[0].id;

      const productRes = await pool.query<{ id: number }>(
        `INSERT INTO products (slug, name, type, entitlement_keys, sort_order)
         VALUES ($1, $2, 'frontend', '["coaching:group"]'::jsonb, 0)
         RETURNING id`,
        [`e2e-rec-product-${tag}`, `E2E Recurring Plan ${tag}`],
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

      // --- Create the recurring template via the REAL admin write path ------
      // Creating a template immediately generates the first batch of ordinary
      // coaching_calls rows — exercising the template -> call generation that
      // members ultimately read from.
      const adminLogin = await apiLogin(fixture.adminEmail, fixture.adminPassword);
      expect(
        adminLogin.ok,
        `Admin login failed (HTTP ${adminLogin.status})`,
      ).toBe(true);
      const adminCookie = cookieHeader(adminLogin.setCookies);

      const createRes = await fetch(
        `${AUTH_URL}/api/admin/coaching/calls/templates`,
        {
          method: "POST",
          headers: { "content-type": "application/json", cookie: adminCookie },
          body: JSON.stringify({
            title: templateTitle,
            description: "Recurring weekly call set up via the admin API for the E2E.",
            callType: "weekly_qa",
            coachId,
            anchorAt: anchorAt.toISOString(),
            durationMinutes: 60,
            intervalDays: 7,
            occurrencesPerBatch,
            meetLink,
            requiredEntitlement: "coaching:group",
          }),
          signal: AbortSignal.timeout(15_000),
        },
      );
      expect(
        createRes.ok,
        `Admin create template API failed (HTTP ${createRes.status})`,
      ).toBe(true);
      const createBody = (await createRes.json()) as {
        template: { id: number };
        generated: number;
      };
      templateId = createBody.template.id;
      expect(templateId).toBeGreaterThan(0);
      // The first batch must have spawned exactly occurrencesPerBatch calls.
      expect(createBody.generated).toBe(occurrencesPerBatch);

      // The generated rows are ordinary coaching_calls linked by template_id.
      // Read them back to learn their ids (the create response doesn't list
      // them) and to confirm they copied the template's field values verbatim.
      const firstBatch = await pool.query<{
        id: number;
        call_type: string;
        required_entitlement: string;
        coach_id: number;
        meet_link: string | null;
      }>(
        `SELECT id, call_type, required_entitlement, coach_id, meet_link
           FROM coaching_calls
          WHERE template_id = $1
          ORDER BY scheduled_at ASC`,
        [templateId],
      );
      expect(firstBatch.rows.length).toBe(occurrencesPerBatch);
      for (const row of firstBatch.rows) {
        // A drift here (wrong callType / entitlement / coach) is exactly what
        // would silently hide a generated week from members.
        expect(row.call_type).toBe("weekly_qa");
        expect(row.required_entitlement).toBe("coaching:group");
        expect(row.coach_id).toBe(coachId);
        expect(row.meet_link).toBe(meetLink);
      }
      const firstBatchIds = firstBatch.rows.map((r) => r.id);

      // --- Member-read contract via the API ---------------------------------
      const entitledApiLogin = await apiLogin(entitledEmail, entitledPassword);
      expect(entitledApiLogin.ok).toBe(true);
      const entitledCookie = cookieHeader(entitledApiLogin.setCookies);
      const entitledCalls = await fetchMemberCalls(entitledCookie);
      for (const callId of firstBatchIds) {
        const c = entitledCalls.find((mc) => mc.id === callId);
        expect(
          c,
          `Generated occurrence ${callId} must appear in the entitled member's feed`,
        ).toBeTruthy();
        expect(c!.title).toBe(templateTitle);
        expect(c!.coachName).toBe(coachName);
        expect(c!.callType).toBe("weekly_qa");
        expect(c!.isAccessible).toBe(true);
        expect(c!.meetLink).toBe(meetLink);
      }

      const lockedApiLogin = await apiLogin(lockedEmail, lockedPassword);
      expect(lockedApiLogin.ok).toBe(true);
      const lockedCookie = cookieHeader(lockedApiLogin.setCookies);
      const lockedCalls = await fetchMemberCalls(lockedCookie);
      for (const callId of firstBatchIds) {
        const c = lockedCalls.find((mc) => mc.id === callId);
        expect(
          c,
          `Generated occurrence ${callId} still appears for the non-entitled member, locked`,
        ).toBeTruthy();
        expect(c!.isAccessible).toBe(false);
        // Entitlement gate scrubs the Meet link for the non-entitled member.
        expect(c!.meetLink).toBeNull();
      }

      // --- Entitled member: sees the generated weeks on the Coaching page ----
      await loginAs(page, entitledEmail, entitledPassword);
      await page.goto("/coaching");

      for (const callId of firstBatchIds) {
        const row = page.getByTestId(`weekly-call-${callId}`);
        await expect(row).toBeVisible({ timeout: 30_000 });
        await expect(row).toContainText(expectedCoachFirstName);
        // Accessible -> a real "Join Call" link pointing at the template's Meet
        // link copied onto every generated occurrence.
        const joinLink = row.getByRole("link", { name: /join call/i });
        await expect(joinLink).toHaveAttribute("href", meetLink);
        await expect(
          row.getByRole("button", { name: /unlock/i }),
        ).toHaveCount(0);
      }

      // --- Non-entitled member: sees the rows, but locked -------------------
      await loginAs(page, lockedEmail, lockedPassword);
      await page.goto("/coaching");

      for (const callId of firstBatchIds) {
        const row = page.getByTestId(`weekly-call-${callId}`);
        await expect(row).toBeVisible({ timeout: 30_000 });
        await expect(row).toContainText(expectedCoachFirstName);
        await expect(
          row.getByRole("link", { name: /join call/i }),
        ).toHaveCount(0);
        await expect(
          row.getByRole("button", { name: /unlock/i }),
        ).toBeVisible();
      }

      // --- Extend the series: /generate produces the next batch of weeks -----
      const generateRes = await fetch(
        `${AUTH_URL}/api/admin/coaching/calls/templates/${templateId}/generate`,
        {
          method: "POST",
          headers: { "content-type": "application/json", cookie: adminCookie },
          signal: AbortSignal.timeout(15_000),
        },
      );
      expect(
        generateRes.ok,
        `Template /generate API failed (HTTP ${generateRes.status})`,
      ).toBe(true);
      const generateBody = (await generateRes.json()) as { generated: number };
      expect(generateBody.generated).toBe(occurrencesPerBatch);

      // The brand-new occurrences are the template's calls not in the first batch.
      const afterGenerate = await pool.query<{ id: number }>(
        `SELECT id FROM coaching_calls WHERE template_id = $1 ORDER BY scheduled_at ASC`,
        [templateId],
      );
      const allIds = afterGenerate.rows.map((r) => r.id);
      expect(allIds.length).toBe(occurrencesPerBatch * 2);
      const newIds = allIds.filter((id) => !firstBatchIds.includes(id));
      expect(newIds.length).toBe(occurrencesPerBatch);

      // The newly generated future weeks reach the entitled member too — both in
      // the API feed and rendered on the Coaching page.
      const entitledCallsAfter = await fetchMemberCalls(entitledCookie);
      for (const callId of newIds) {
        const c = entitledCallsAfter.find((mc) => mc.id === callId);
        expect(
          c,
          `Newly generated occurrence ${callId} must appear in the entitled member's feed`,
        ).toBeTruthy();
        expect(c!.callType).toBe("weekly_qa");
        expect(c!.isAccessible).toBe(true);
        expect(c!.meetLink).toBe(meetLink);
      }

      await loginAs(page, entitledEmail, entitledPassword);
      await page.goto("/coaching");
      for (const callId of newIds) {
        const row = page.getByTestId(`weekly-call-${callId}`);
        await expect(row).toBeVisible({ timeout: 30_000 });
        const joinLink = row.getByRole("link", { name: /join call/i });
        await expect(joinLink).toHaveAttribute("href", meetLink);
      }
    } finally {
      // Best-effort cleanup so a mid-test failure doesn't leak fixtures into the
      // shared DB for other specs.
      try {
        if (templateId) {
          // Generated calls reference the template (ON DELETE SET NULL), so
          // remove the calls first, then the template.
          await pool.query(`DELETE FROM coaching_calls WHERE template_id = $1`, [
            templateId,
          ]);
        }
        if (coachId) {
          await pool.query(`DELETE FROM coaching_calls WHERE coach_id = $1`, [
            coachId,
          ]);
          await pool.query(
            `DELETE FROM coaching_call_templates WHERE coach_id = $1`,
            [coachId],
          );
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
        console.error("[e2e] recurring-template cleanup failed:", err);
      }
      await pool.end();
    }
  });
});
