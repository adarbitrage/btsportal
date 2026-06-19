import { randomBytes } from "node:crypto";
import { test, expect } from "@playwright/test";
import bcrypt from "bcryptjs";
import { Pool } from "pg";
import { loginAs } from "./auth";

// End-to-end coverage for the member-facing reply-attachment guardrails in
// TicketDetail.tsx. The server-side limits already have backend coverage
// (api-server ticket-reply-attachment-limits.test.ts), but the portal mirror —
// the client-side validateTicketAttachment call in `addFiles` that surfaces an
// instant inline error (data-testid="reply-upload-error") and keeps a
// disallowed/oversized file out of the staged list — had no automated check.
// A regression there (e.g. a dropped accept filter or a broken validation call)
// would let a bad file slip through to the upload step / API with no test
// catching the lost instant feedback.
//
// The spec seeds an isolated member with a known password plus an open ticket,
// drives the real SPA reply composer, and asserts:
//   * a disallowed-type file produces the inline error and never stages (so it
//     can't be sent), and
//   * a valid attachment stages, uploads through the real presigned-URL flow,
//     and the reply posts successfully.

interface ReplyMemberFixture {
  memberId: number;
  memberEmail: string;
  memberPassword: string;
  ticketId: number;
  ticketNumber: string;
}

let member: ReplyMemberFixture;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL must be set for the ticket reply attachment-limits E2E test.",
    );
  }

  const pool = new Pool({ connectionString: url });
  const client = await pool.connect();
  const tag = randomBytes(6).toString("hex");
  const memberEmail = `e2e-reply-attach-${tag}@e2e.local`;
  const memberPassword = `E2E-${randomBytes(9).toString("base64url")}`;
  const memberHash = await bcrypt.hash(memberPassword, 10);
  const ticketNumber = `BTS-${randomBytes(4).toString("hex").slice(0, 6).toUpperCase()}`;

  try {
    const memberRes = await client.query<{ id: number }>(
      `INSERT INTO users (name, email, password_hash, role, email_verified, onboarding_complete)
       VALUES ($1, $2, $3, 'member', true, true)
       RETURNING id`,
      [`E2E Reply Member ${tag}`, memberEmail, memberHash],
    );
    const memberId = memberRes.rows[0].id;

    const ticketRes = await client.query<{ id: number }>(
      `INSERT INTO tickets (user_id, ticket_number, subject, status, category, priority)
       VALUES ($1, $2, $3, 'open', 'other', 'normal')
       RETURNING id`,
      [memberId, ticketNumber, `Reply attachment limits ${tag}`],
    );

    member = {
      memberId,
      memberEmail,
      memberPassword,
      ticketId: ticketRes.rows[0].id,
      ticketNumber,
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
    // Attachments FK-reference their reply message, so drop them before the
    // messages they point at.
    await client.query(`DELETE FROM ticket_attachments WHERE ticket_id = $1`, [member.ticketId]);
    await client.query(`DELETE FROM ticket_messages WHERE ticket_id = $1`, [member.ticketId]);
    await client.query(`DELETE FROM ticket_sla WHERE ticket_id = $1`, [member.ticketId]);
    await client.query(`DELETE FROM ticket_satisfaction WHERE ticket_id = $1`, [member.ticketId]);
    await client.query(`DELETE FROM tickets WHERE id = $1`, [member.ticketId]);
    await client.query(`DELETE FROM ghl_sync_log WHERE user_id = $1`, [member.memberId]);
    await client.query(`DELETE FROM sessions WHERE user_id = $1`, [member.memberId]);
    await client.query(`DELETE FROM audit_log WHERE actor_id = $1`, [member.memberId]);
    await client.query(`DELETE FROM users WHERE id = $1`, [member.memberId]);
  } finally {
    client.release();
    await pool.end();
  }
});

test.describe("Ticket reply attachment limits (member portal)", () => {
  // The Vite dev server compiles each route's module graph on first hit, which
  // can take 20-30s cold; give every test room to absorb that one-time compile.
  test.beforeEach(() => {
    test.setTimeout(120_000);
  });

  test("a disallowed-type file shows an inline error and never stages for sending", async ({
    page,
  }) => {
    await loginAs(page, member.memberEmail, member.memberPassword);
    await page.goto(`/support/tickets/${member.ticketId}`, { waitUntil: "commit" });

    // The reply composer renders once its textarea is visible.
    const replyBox = page.getByPlaceholder("Type your reply here...");
    await expect(replyBox).toBeVisible({ timeout: 60_000 });
    await replyBox.fill("Here is the file you asked for.");

    // Watch for any attempt to upload to object storage or post the reply — a
    // rejected file must never reach either.
    let uploadRequested = false;
    let replyPosted = false;
    page.on("request", (req) => {
      const u = req.url();
      if (u.includes("/api/storage/uploads/request-url") && req.method() === "POST") {
        uploadRequested = true;
      }
      if (
        u.includes(`/api/tickets/${member.ticketId}/messages`) &&
        req.method() === "POST"
      ) {
        replyPosted = true;
      }
    });

    // Select an executable, which is not on the ticket-attachment allow-list.
    await page.getByTestId("reply-file-input").setInputFiles({
      name: "malware.exe",
      mimeType: "application/x-msdownload",
      buffer: Buffer.from("MZ e2e disallowed reply attachment payload"),
    });

    // The inline error appears immediately with the shared allow-list message.
    const uploadError = page.getByTestId("reply-upload-error");
    await expect(uploadError).toBeVisible({ timeout: 10_000 });
    await expect(uploadError).toContainText(/can't be attached/i);

    // The disallowed file is dropped, never staged — so there is nothing to
    // upload or send. The staged-files list must not exist for it.
    await expect(page.getByTestId("reply-files-list")).toHaveCount(0);

    // No upload was requested as a direct result of the rejected selection.
    await page.waitForTimeout(500);
    expect(
      uploadRequested,
      "a disallowed file must not request a presigned upload URL",
    ).toBe(false);
    expect(
      replyPosted,
      "selecting a disallowed file must not auto-post the reply",
    ).toBe(false);
  });

  test("a valid attachment stages, uploads, and the reply posts successfully", async ({
    page,
  }) => {
    await loginAs(page, member.memberEmail, member.memberPassword);
    await page.goto(`/support/tickets/${member.ticketId}`, { waitUntil: "commit" });

    const replyBox = page.getByPlaceholder("Type your reply here...");
    await expect(replyBox).toBeVisible({ timeout: 60_000 });

    const replyBody = `Valid attachment reply ${randomBytes(4).toString("hex")}`;
    await replyBox.fill(replyBody);

    // A small PNG is on the allow-list and under the size cap.
    await page.getByTestId("reply-file-input").setInputFiles({
      name: "creative.png",
      mimeType: "image/png",
      buffer: Buffer.from("\u0089PNG\r\n\u001a\n e2e valid reply attachment"),
    });

    // The valid file stages (no inline error) and shows in the files list.
    await expect(page.getByTestId("reply-upload-error")).toHaveCount(0);
    const stagedFile = page.getByTestId("reply-file-0");
    await expect(stagedFile).toBeVisible({ timeout: 10_000 });
    await expect(stagedFile).toContainText("creative.png");

    // Send the reply — this drives the real presigned-URL upload then POSTs the
    // message. Assert the API accepts it (201).
    const [replyResponse] = await Promise.all([
      page.waitForResponse(
        (res) =>
          res.url().includes(`/api/tickets/${member.ticketId}/messages`) &&
          res.request().method() === "POST",
        { timeout: 30_000 },
      ),
      page.getByTestId("reply-send-btn").click(),
    ]);
    expect(
      replyResponse.status(),
      `Reply send failed (${replyResponse.status()} ${replyResponse.statusText()})`,
    ).toBe(201);

    // The composer clears on success and the new reply renders in the thread.
    await expect(replyBox).toHaveValue("", { timeout: 15_000 });
    await expect(page.getByText(replyBody)).toBeVisible({ timeout: 15_000 });
  });
});
