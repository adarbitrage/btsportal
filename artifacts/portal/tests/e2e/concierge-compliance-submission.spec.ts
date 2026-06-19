import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { test, expect } from "@playwright/test";
import bcrypt from "bcryptjs";
import { Pool } from "pg";
import type { E2EFixture } from "./global-setup";
import { loginAs, loginAsAdmin } from "./auth";

// End-to-end coverage for the two newly wired self-service request forms:
// the BTS Concierge™ task form (POST /tickets/concierge) and the Compliance
// Review form with file upload (POST /tickets/compliance). Both turn a member
// submission into a real `tickets` row and surface the generated ticket number
// in a success card. Nothing exercised the browser path before, so a
// regression (a renamed field, a broken upload step, a changed success card)
// could silently break submission with no test catching it.
//
// The spec drives the real SPA as a seeded member, captures the ticket numbers
// off the success cards, then logs in as the global-fixture admin and confirms
// both tickets land in the admin queue's "Concierge & Compliance" tab.
//
// The member is seeded with a known password here (the global-setup member's
// password hash is a throwaway, so it can't log in), mirroring the pattern in
// community-reactions.spec.ts.

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

interface MemberFixture {
  memberId: number;
  memberEmail: string;
  memberPassword: string;
}

let member: MemberFixture;
let conciergeTicketNumber = "";
let complianceTicketNumber = "";

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL must be set for the Concierge/Compliance submission E2E test.",
    );
  }

  const pool = new Pool({ connectionString: url });
  const client = await pool.connect();
  const tag = randomBytes(6).toString("hex");
  const memberEmail = `e2e-ccform-${tag}@e2e.local`;
  const memberPassword = `E2E-${randomBytes(9).toString("base64url")}`;
  const memberHash = await bcrypt.hash(memberPassword, 10);

  try {
    const memberRes = await client.query<{ id: number }>(
      `INSERT INTO users (name, email, password_hash, role, email_verified, onboarding_complete)
       VALUES ($1, $2, $3, 'member', true, true)
       RETURNING id`,
      [`E2E CC Member ${tag}`, memberEmail, memberHash],
    );
    member = {
      memberId: memberRes.rows[0].id,
      memberEmail,
      memberPassword,
    };
  } finally {
    client.release();
    await pool.end();
  }
});

test.afterAll(async () => {
  const url = process.env.DATABASE_URL;
  if (!url || !member) return;

  const pool = new Pool({ connectionString: url });
  const client = await pool.connect();
  try {
    // Tear down every ticket this member produced, plus the child rows that
    // FK-reference it (messages, SLA, attachments), then the login side-effects
    // (sessions, GHL sync log, audit log) that hold FKs on the user — otherwise
    // the final user delete throws a foreign-key error.
    const tickets = await client.query<{ id: number }>(
      `SELECT id FROM tickets WHERE user_id = $1`,
      [member.memberId],
    );
    const ticketIds = tickets.rows.map((r) => r.id);
    if (ticketIds.length > 0) {
      await client.query(`DELETE FROM ticket_messages WHERE ticket_id = ANY($1::int[])`, [ticketIds]);
      await client.query(`DELETE FROM ticket_sla WHERE ticket_id = ANY($1::int[])`, [ticketIds]);
      await client.query(`DELETE FROM ticket_attachments WHERE ticket_id = ANY($1::int[])`, [ticketIds]);
      await client.query(`DELETE FROM ticket_satisfaction WHERE ticket_id = ANY($1::int[])`, [ticketIds]);
      await client.query(`DELETE FROM tickets WHERE id = ANY($1::int[])`, [ticketIds]);
    }
    await client.query(`DELETE FROM ghl_sync_log WHERE user_id = $1`, [member.memberId]);
    await client.query(`DELETE FROM sessions WHERE user_id = $1`, [member.memberId]);
    await client.query(`DELETE FROM audit_log WHERE actor_id = $1`, [member.memberId]);
    await client.query(`DELETE FROM users WHERE id = $1`, [member.memberId]);
  } finally {
    client.release();
    await pool.end();
  }
});

test.describe("Concierge & Compliance form submissions (member portal)", () => {
  // The Vite dev server transforms each route's full module graph on first hit,
  // which can take 20-30s cold. Give every test room to absorb that one-time
  // compile on top of the actual interaction work.
  test.beforeEach(() => {
    test.setTimeout(120_000);
  });

  test("a member submits the Concierge form and a ticket number appears in the success card", async ({
    page,
  }) => {
    await loginAs(page, member.memberEmail, member.memberPassword);

    await page.goto("/concierge", { waitUntil: "commit" });

    // Form is in view once the first-name input renders.
    const firstName = page.getByTestId("input-first-name");
    await expect(firstName).toBeVisible({ timeout: 60_000 });

    await firstName.fill("Casey");
    await page.getByTestId("input-last-name").fill("Concierge");
    await page.getByTestId("input-email").fill("casey.concierge@e2e.local");
    await page.getByTestId("input-offer-name").fill("E2E Test Offer");
    await page.getByTestId("input-offer-url").fill("https://example.com/vsl");

    // Pick a network, a traffic source, and a phase — these are pill buttons
    // keyed off their visible label.
    await page.getByRole("button", { name: "Clickbank", exact: true }).click();
    await page.getByRole("button", { name: "Meta", exact: true }).click();
    await page.getByRole("button", { name: '"Build" Phase', exact: true }).click();

    // The confirm checkbox is `required`, so the form won't submit without it.
    await page.getByTestId("checkbox-confirm").check();

    const [conciergeResponse] = await Promise.all([
      page.waitForResponse(
        (res) =>
          res.url().includes("/api/tickets/concierge") &&
          res.request().method() === "POST",
        { timeout: 15_000 },
      ),
      page.getByTestId("button-submit").click(),
    ]);
    expect(
      conciergeResponse.ok(),
      `Concierge submit failed (${conciergeResponse.status()} ${conciergeResponse.statusText()})`,
    ).toBe(true);

    // Success card replaces the form and shows the generated ticket number.
    await expect(page.getByText("Task Submitted!")).toBeVisible({ timeout: 15_000 });
    const ticketEl = page.getByTestId("text-ticket-number");
    await expect(ticketEl).toBeVisible();
    conciergeTicketNumber = (await ticketEl.textContent())?.trim() ?? "";
    expect(conciergeTicketNumber).toMatch(/^BTS-\d{6}$/);
  });

  test("a member submits the Compliance form with a file and a ticket number appears", async ({
    page,
  }) => {
    await loginAs(page, member.memberEmail, member.memberPassword);

    await page.goto("/compliance", { waitUntil: "commit" });

    const firstName = page.getByTestId("input-first-name");
    await expect(firstName).toBeVisible({ timeout: 60_000 });

    await firstName.fill("Dana");
    await page.getByTestId("input-last-name").fill("Compliance");
    await page.getByTestId("input-email").fill("dana.compliance@e2e.local");
    await page.getByTestId("input-offer-name").fill("E2E Compliance Offer");

    await page.getByTestId("chip-creative-Banner").click();
    await page.getByTestId("chip-traffic-Meta").click();

    // Attach a small creative file via the hidden multi-file input. This drives
    // the real presigned-URL upload flow before the ticket is created.
    await page.locator('input[type="file"]').setInputFiles({
      name: "creative.zip",
      mimeType: "application/zip",
      buffer: Buffer.from("PK\u0003\u0004 e2e compliance creative payload"),
    });
    await expect(page.getByTestId("dropzone-files")).toContainText("1 file(s) selected");

    const [complianceResponse] = await Promise.all([
      page.waitForResponse(
        (res) =>
          res.url().includes("/api/tickets/compliance") &&
          res.request().method() === "POST",
        { timeout: 30_000 },
      ),
      page.getByTestId("button-submit").click(),
    ]);
    expect(
      complianceResponse.ok(),
      `Compliance submit failed (${complianceResponse.status()} ${complianceResponse.statusText()})`,
    ).toBe(true);

    await expect(page.getByText("Submission Received")).toBeVisible({ timeout: 15_000 });
    const ticketEl = page.getByTestId("text-ticket-number");
    await expect(ticketEl).toBeVisible();
    complianceTicketNumber = (await ticketEl.textContent())?.trim() ?? "";
    expect(complianceTicketNumber).toMatch(/^BTS-\d{6}$/);
    expect(complianceTicketNumber).not.toBe(conciergeTicketNumber);
  });

  test("admin sees both tickets under the Concierge & Compliance tab", async ({
    page,
  }) => {
    expect(
      conciergeTicketNumber,
      "Concierge ticket number must have been captured by the earlier test",
    ).toMatch(/^BTS-\d{6}$/);
    expect(
      complianceTicketNumber,
      "Compliance ticket number must have been captured by the earlier test",
    ).toMatch(/^BTS-\d{6}$/);

    const fixture = loadFixture();
    await loginAsAdmin(page, fixture);

    await page.goto("/admin/tickets", { waitUntil: "commit" });

    await expect(
      page.getByRole("heading", { name: "Ticket Queue" }),
    ).toBeVisible({ timeout: 60_000 });

    // Switch to the Concierge & Compliance view — it scopes the queue to the
    // concierge_task + compliance_review categories.
    await page.getByTestId("view-tab-concierge_compliance").click();

    // Both freshly created tickets must be listed in this tab.
    await expect(page.getByText(conciergeTicketNumber)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(complianceTicketNumber)).toBeVisible({ timeout: 15_000 });
  });
});
