import { randomBytes } from "node:crypto";
import { test, expect, type Page } from "@playwright/test";
import bcrypt from "bcryptjs";
import { Pool } from "pg";
import { loginAs } from "./auth";
import {
  TICKETDESK_WIDGET_SCRIPT_URL,
  TICKETDESK_WIDGET_WORKSPACE_ID,
  TICKETDESK_WIDGET_API_URL,
} from "../../src/config/support";

// End-to-end coverage for the Live Chat launcher (LiveChatLauncher) gated by
// AuthenticatedChatWidget in App.tsx. The component test under
// src/components/chat/__tests__ mocks auth, entitlements, and wouter, so it
// proves the script-injection wiring but never renders the real signed-in
// portal. This spec logs a real onboarded member into the running SPA against
// the real API + DB and asserts:
//   1. the TicketDesk widget script is injected into the page on /dashboard,
//   2. it carries the correct data-workspace and data-api attributes,
//   3. it is NOT injected on auth/onboarding routes (hidden routes), and
//   4. the stacked CSS offset is applied when the member holds chat:ai.

// Force the member's `/api/members/me` response to include `chat:ai` so the AI
// ChatWidget mounts alongside the live-chat launcher.
async function grantAiChatEntitlement(page: Page): Promise<void> {
  await page.route("**/api/members/me", async (route) => {
    const response = await route.fetch();
    const json = await response.json();
    const entitlements: string[] = Array.isArray(json.entitlements)
      ? json.entitlements
      : [];
    json.entitlements = Array.from(new Set([...entitlements, "chat:ai"]));
    await route.fulfill({ response, json });
  });
}

// Verify the widget script URL is actually reachable — a 2xx response means
// the script will load for real members. If TicketDesk ever moves the script
// or removes public access, this fails loudly before members notice.
test.describe("Live Chat launcher — TicketDesk widget script accessibility", () => {
  test("TicketDesk widget script URL responds 2xx", async () => {
    let res: Response;
    try {
      res = await fetch(TICKETDESK_WIDGET_SCRIPT_URL, {
        redirect: "follow",
        signal: AbortSignal.timeout(20_000),
      });
      await res.text().catch(() => undefined);
    } catch (err) {
      throw new Error(
        `Could not reach TicketDesk widget script at ${TICKETDESK_WIDGET_SCRIPT_URL}: ${String(err)}`,
      );
    }

    expect(
      res.ok,
      `TicketDesk widget script (${TICKETDESK_WIDGET_SCRIPT_URL}) should respond 2xx, got HTTP ${res.status}`,
    ).toBe(true);
  });
});

test.describe.serial("Live Chat launcher — signed-in member", () => {
  const databaseUrl = process.env.DATABASE_URL;

  const tag = randomBytes(6).toString("hex");
  const memberEmail = `e2e-livechat-${tag}@e2e.local`;
  const memberPassword = `E2E-${randomBytes(9).toString("base64url")}`;
  const memberName = `E2E LiveChat Member ${tag}`;

  let pool: Pool;
  let memberId = 0;

  test.beforeAll(async () => {
    if (!databaseUrl) {
      throw new Error(
        "DATABASE_URL must be set for the live-chat launcher E2E test (it seeds and tears down its own onboarded member).",
      );
    }
    pool = new Pool({ connectionString: databaseUrl });
    const memberHash = await bcrypt.hash(memberPassword, 10);
    const res = await pool.query<{ id: number }>(
      `INSERT INTO users (name, email, password_hash, role, email_verified, onboarding_complete)
       VALUES ($1, $2, $3, 'member', true, true)
       RETURNING id`,
      [memberName, memberEmail, memberHash],
    );
    memberId = res.rows[0].id;
  });

  test.afterAll(async () => {
    if (!pool) return;
    try {
      if (memberId > 0) {
        await pool.query(`DELETE FROM sessions WHERE user_id = $1`, [memberId]);
        await pool.query(`DELETE FROM users WHERE id = $1`, [memberId]);
      }
    } catch (err) {
      console.error("[e2e] live-chat launcher cleanup failed:", err);
    } finally {
      await pool.end();
    }
  });

  test("injects the TicketDesk widget script with correct attributes on /dashboard", async ({
    page,
  }) => {
    await loginAs(page, memberEmail, memberPassword);
    await page.goto("/dashboard");

    // The script tag should be injected into <head>.
    const scriptLocator = page.locator(
      `script[id="ticketdesk-widget-script"]`,
    );
    await expect(scriptLocator).toBeAttached({ timeout: 15_000 });
    await expect(scriptLocator).toHaveAttribute("src", TICKETDESK_WIDGET_SCRIPT_URL);
    await expect(scriptLocator).toHaveAttribute("data-workspace", TICKETDESK_WIDGET_WORKSPACE_ID);
    await expect(scriptLocator).toHaveAttribute("data-api", TICKETDESK_WIDGET_API_URL);
  });

  test("does not inject the widget script on auth routes (e.g. /login)", async ({
    page,
  }) => {
    // Visit the login page without being authenticated.
    await page.goto("/login");
    await page.waitForLoadState("networkidle");

    const scriptLocator = page.locator(`script[id="ticketdesk-widget-script"]`);
    await expect(scriptLocator).not.toBeAttached();
  });

  test("injects the stacked CSS offset when the member holds the chat:ai entitlement", async ({
    page,
  }) => {
    await grantAiChatEntitlement(page);
    await loginAs(page, memberEmail, memberPassword);
    await page.goto("/dashboard");

    // The stacked style override is injected when both launchers are present.
    const styleLocator = page.locator(`style[id="ticketdesk-widget-stacked"]`);
    await expect(styleLocator).toBeAttached({ timeout: 15_000 });

    const styleContent = await styleLocator.textContent();
    expect(styleContent).toContain("96px");
  });

  test("does not inject the stacked CSS offset when the member lacks the chat:ai entitlement", async ({
    page,
  }) => {
    await loginAs(page, memberEmail, memberPassword);
    await page.goto("/dashboard");

    // Script is injected (chat is enabled) but no stacking style needed.
    await expect(
      page.locator(`script[id="ticketdesk-widget-script"]`),
    ).toBeAttached({ timeout: 15_000 });

    await expect(
      page.locator(`style[id="ticketdesk-widget-stacked"]`),
    ).not.toBeAttached();
  });
});
