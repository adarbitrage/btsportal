import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect } from "@playwright/test";
import type { E2EFixture } from "./global-setup";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function loadFixture(): E2EFixture {
  try {
    const raw = readFileSync(join(__dirname, ".fixture.json"), "utf8");
    return JSON.parse(raw) as E2EFixture;
  } catch (err) {
    throw new Error(
      "E2E fixture file is missing. The Playwright globalSetup must run first to seed an isolated admin + member.",
    );
  }
}

test.describe("Admin Flexy lookup card", () => {
  test("admin can search a member, see their Flexy email, and open the regenerate confirmation dialog without submitting", async ({
    page,
    request,
  }) => {
    const fixture = loadFixture();

    // Log in via the API so the cookie is set without UI flakiness on the
    // styled inputs of /login. We still navigate via the UI for the actual
    // feature flow.
    const loginRes = await request.post("/api/auth/login", {
      data: { email: fixture.adminEmail, password: fixture.adminPassword },
    });
    expect(
      loginRes.ok(),
      `Login API call failed (${loginRes.status()} ${loginRes.statusText()})`,
    ).toBe(true);

    const setCookieHeader = loginRes.headers()["set-cookie"];
    expect(setCookieHeader, "Login should return an access_token cookie").toBeTruthy();

    // Forward the access_token cookie into the browser context so SPA fetches
    // are authenticated.
    const cookies = (Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader])
      .flatMap((header) => header.split(/,(?=[^;]+=)/g))
      .map((raw) => {
        const [pair] = raw.split(";");
        const [name, ...valueParts] = pair.split("=");
        const value = valueParts.join("=");
        return name && value ? { name: name.trim(), value: value.trim() } : null;
      })
      .filter((c): c is { name: string; value: string } => c !== null);

    const baseUrlObj = new URL(process.env.E2E_BASE_URL ?? "http://localhost:25265");
    await page.context().addCookies(
      cookies.map((c) => ({
        name: c.name,
        value: c.value,
        domain: baseUrlObj.hostname,
        path: "/",
        httpOnly: true,
        secure: false,
        sameSite: "Lax" as const,
      })),
    );

    // Navigate to the Apps Manager page.
    await page.goto("/admin/apps-manager");

    await expect(
      page.getByRole("heading", { name: /Apps Manager/i }),
    ).toBeVisible();
    await expect(
      page.getByText(/Flexy login lookup/i),
    ).toBeVisible();

    // Search for the seeded member.
    const searchInput = page.getByTestId("input-flexy-member-search");
    await expect(searchInput).toBeVisible();
    await searchInput.fill(fixture.tag);

    // Wait for the debounced search results to render.
    const memberButton = page.getByTestId(
      `button-select-member-${fixture.memberId}`,
    );
    await expect(memberButton).toBeVisible({ timeout: 15_000 });
    await memberButton.click();

    // Wait for the lookup to populate the card.
    const flexyEmail = page.getByTestId("text-flexy-email");
    await expect(flexyEmail).toBeVisible({ timeout: 15_000 });
    await expect(flexyEmail).toContainText(fixture.flexyStaffEmail);

    // Regenerate button should render and be enabled (Flexy is installed).
    const regenerateButton = page.getByTestId("button-regenerate-flexy-password");
    await expect(regenerateButton).toBeVisible();
    await expect(regenerateButton).toBeEnabled();

    // Track network calls so we can prove we never actually submit the
    // regenerate request to the live GoHighLevel-backed endpoint.
    const regenCalls: string[] = [];
    page.on("request", (req) => {
      if (
        req.method() === "POST" &&
        req.url().includes("/api/admin/apps/flexy/regenerate-password/")
      ) {
        regenCalls.push(req.url());
      }
    });

    // Open the confirmation dialog.
    await regenerateButton.click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByRole("heading", { name: /Regenerate Flexy password\?/i }),
    ).toBeVisible();
    await expect(dialog.getByRole("button", { name: /Cancel/i })).toBeVisible();
    await expect(dialog.getByRole("button", { name: /^Regenerate$/i })).toBeVisible();

    // Cancel — do NOT click the inner Regenerate button. The whole point of
    // this test is to assert the dialog wiring without calling live GHL.
    await dialog.getByRole("button", { name: /Cancel/i }).click();
    await expect(dialog).toBeHidden();

    expect(
      regenCalls,
      `Regenerate endpoint must NOT be called during the cancel flow. Saw: ${regenCalls.join(", ")}`,
    ).toHaveLength(0);
  });
});
