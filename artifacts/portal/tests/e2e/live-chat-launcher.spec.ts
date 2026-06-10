import { randomBytes } from "node:crypto";
import { test, expect, type Page } from "@playwright/test";
import bcrypt from "bcryptjs";
import { Pool } from "pg";
import { loginAs } from "./auth";

// End-to-end coverage for the Live Chat launcher (LiveChatLauncher) gated by
// AuthenticatedChatWidget in App.tsx. The component test under
// src/components/chat/__tests__ mocks auth, entitlements, and wouter, so it
// proves the wiring but never renders the real signed-in portal. This spec logs
// a real onboarded member into the running SPA against the real API + DB and
// asserts:
//   1. the "Live Chat" button is actually visible bottom-right on /dashboard,
//   2. it targets the TicketDesk URL (the embedded support panel iframe), and
//   3. when the member holds the `chat:ai` entitlement (so the AI ChatWidget
//      also renders), the two launchers stack instead of overlapping.

const TICKETDESK_URL = "https://tickets.buildtestscale.com/";

const LIVE_CHAT_LABEL = /open live chat support/i;
const AI_CHAT_LABEL = /^open chat$/i;

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function rectsOverlap(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

// Force the member's `/api/members/me` response to include `chat:ai` so the AI
// ChatWidget mounts alongside the live-chat launcher. We patch the *real*
// response rather than fabricating one so every other field the page relies on
// stays authentic. The glob ends at `me`, so the related `/me/products` and
// `/me/entitlements` calls are left untouched.
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

// Verify the panel can actually *render* TicketDesk, not just that the iframe
// is wired to its URL. The component spec proves the in-app fallback works when
// the iframe fails; this proves the happy path is still real by hitting the
// live TicketDesk endpoint and confirming it (a) responds and (b) does not set
// framing headers that would silently turn the embedded panel into a blank box.
// If TicketDesk ever adds X-Frame-Options: DENY/SAMEORIGIN or a CSP
// `frame-ancestors 'none'/'self'`, this fails loudly instead of users hitting a
// dead panel that only the 8s timeout rescues.
test.describe("Live Chat launcher — TicketDesk embeddability", () => {
  test("TicketDesk responds and does not block being framed", async () => {
    let res: Response;
    try {
      res = await fetch(TICKETDESK_URL, {
        redirect: "follow",
        signal: AbortSignal.timeout(20_000),
      });
      await res.text().catch(() => undefined);
    } catch (err) {
      throw new Error(
        `Could not reach TicketDesk at ${TICKETDESK_URL}: ${String(err)}`,
      );
    }

    expect(
      res.ok,
      `TicketDesk (${TICKETDESK_URL}) should respond 2xx, got HTTP ${res.status}`,
    ).toBe(true);

    // X-Frame-Options: DENY or SAMEORIGIN blocks the cross-origin portal frame.
    const xfo = res.headers.get("x-frame-options");
    expect(
      xfo === null || !/deny|sameorigin/i.test(xfo),
      `TicketDesk now sends X-Frame-Options: "${xfo}", which blocks the embedded Live Chat panel — the in-app iframe will silently fail.`,
    ).toBe(true);

    // CSP frame-ancestors 'none' or only 'self' would likewise block framing
    // from the portal's origin.
    const csp = res.headers.get("content-security-policy");
    const frameAncestors = csp
      ?.split(";")
      .map((d) => d.trim().toLowerCase())
      .find((d) => d.startsWith("frame-ancestors"));
    if (frameAncestors) {
      const sources = frameAncestors.replace("frame-ancestors", "").trim();
      const blocks =
        sources === "'none'" || sources === "'self'" || sources === "";
      expect(
        blocks,
        `TicketDesk now sends CSP "${frameAncestors}", which blocks the embedded Live Chat panel.`,
      ).toBe(false);
    }
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

  test("shows the Live Chat button bottom-right and opens the TicketDesk panel", async ({
    page,
  }) => {
    await loginAs(page, memberEmail, memberPassword);
    await page.goto("/dashboard");

    const launcher = page.getByRole("button", { name: LIVE_CHAT_LABEL });
    await expect(launcher).toBeVisible({ timeout: 15_000 });
    await expect(launcher).toContainText("Live Chat");

    // Bottom-right placement: the button sits in the right half and lower half
    // of the viewport.
    const viewport = page.viewportSize();
    expect(viewport, "viewport size should be available").not.toBeNull();
    const box = await launcher.boundingBox();
    expect(box, "launcher should have a bounding box").not.toBeNull();
    expect(box!.x).toBeGreaterThan(viewport!.width / 2);
    expect(box!.y + box!.height).toBeGreaterThan(viewport!.height / 2);

    // Without the chat:ai entitlement the AI ChatWidget renders nothing, so the
    // live-chat launcher is the only floating button.
    await expect(
      page.getByRole("button", { name: AI_CHAT_LABEL }),
    ).toHaveCount(0);

    // Clicking opens the embedded support panel whose iframe points at the
    // TicketDesk URL.
    await launcher.click();
    const iframe = page.locator('iframe[title="Live Chat Support"]');
    await expect(iframe).toBeVisible({ timeout: 15_000 });
    await expect(iframe).toHaveAttribute("src", TICKETDESK_URL);
  });

  test("stacks above the AI ChatWidget without overlapping when chat:ai is granted", async ({
    page,
  }) => {
    await grantAiChatEntitlement(page);
    await loginAs(page, memberEmail, memberPassword);
    await page.goto("/dashboard");

    const liveChat = page.getByRole("button", { name: LIVE_CHAT_LABEL });
    const aiChat = page.getByRole("button", { name: AI_CHAT_LABEL });

    await expect(liveChat).toBeVisible({ timeout: 15_000 });
    await expect(aiChat).toBeVisible({ timeout: 15_000 });

    const liveBox = await liveChat.boundingBox();
    const aiBox = await aiChat.boundingBox();
    expect(liveBox, "live-chat launcher should have a bounding box").not.toBeNull();
    expect(aiBox, "AI chat launcher should have a bounding box").not.toBeNull();

    // The whole point of the `stacked` prop: the two floating launchers must not
    // sit on top of each other.
    expect(
      rectsOverlap(liveBox!, aiBox!),
      `Live Chat (${JSON.stringify(liveBox)}) and AI chat (${JSON.stringify(
        aiBox,
      )}) launchers must not overlap`,
    ).toBe(false);

    // The live-chat launcher is lifted above the AI chat launcher (smaller y =
    // higher on screen), and both stay pinned to the right edge.
    expect(liveBox!.y).toBeLessThan(aiBox!.y);
    expect(Math.abs(liveBox!.x + liveBox!.width - (aiBox!.x + aiBox!.width))).toBeLessThan(8);
  });
});
