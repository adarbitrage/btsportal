/**
 * fix-signup-attempted-footer.ts — Task #1786
 *
 * The `signup_attempted` email template is admin-customized (starter_hash
 * NULL) and was intentionally skipped by the Task #1782 footer refresh, so
 * it is the only member-facing template still on the old condensed footer.
 *
 * This script performs the fix exactly the way an admin would via the
 * admin-panel email template editor:
 *   1. Logs in as the super admin against the locally running API server.
 *   2. PUTs the current starter content (which is rendered through the new
 *      `wrapHtml` full legal footer) to the template via the admin editor
 *      endpoint — so version history + audit log are recorded, and
 *      `starter_hash` stays NULL (admin-owned copy, as the task requires).
 *   3. Verifies the saved row.
 *   4. Sends ONE real test email to adam@cherringtonmedia.com through the
 *      normal template send path (renders straight from the just-saved DB
 *      row) to prove the new footer.
 *
 * Usage (via a temporary console workflow so process.env has
 * SENDGRID_API_KEY; email dev-gate opened only for the recipient):
 *
 *   PORTAL_URL=https://portal.buildtestscale.com \
 *   DEV_EMAIL_ALLOWLIST=adam@cherringtonmedia.com \
 *     npx tsx artifacts/api-server/src/scripts/fix-signup-attempted-footer.ts
 */

import sgMail from "@sendgrid/mail";
import { CommunicationService } from "../lib/communication-service.js";
import { getStarterEmailTemplate } from "../lib/seed-templates.js";
import { getPortalUrl, __invalidatePortalUrlCacheForTests } from "../lib/portal-url-settings.js";
import { db, emailTemplatesTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const API_BASE = "http://127.0.0.1:8080/api";
const ADMIN_EMAIL = "adam@cherringtonmedia.com";
const RECIPIENT = "adam@cherringtonmedia.com";
const EXPECTED_PORTAL_URL = "https://portal.buildtestscale.com";
const SLUG = "signup_attempted";

function initSendGrid(): void {
  const key = process.env.SENDGRID_API_KEY;
  if (!key) throw new Error("SENDGRID_API_KEY is not set — cannot send emails");
  sgMail.setApiKey(key);
}

async function assertPortalUrlPinned(): Promise<void> {
  __invalidatePortalUrlCacheForTests();
  const resolved = await getPortalUrl();
  if (resolved !== EXPECTED_PORTAL_URL) {
    throw new Error(
      `PORTAL_URL resolved to "${resolved}", expected "${EXPECTED_PORTAL_URL}". ABORTING.`,
    );
  }
  console.log(`[init] Portal URL pinned: ${resolved}`);
}

function extractCookies(res: Response): string {
  const cookies = res.headers.getSetCookie?.() ?? [];
  return cookies.map((c) => c.split(";")[0]).join("; ");
}

async function loginAsAdmin(): Promise<string> {
  const password = process.env.BTS_ADMIN_TEST_PASSWORD;
  if (!password) throw new Error("BTS_ADMIN_TEST_PASSWORD not set in env");
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: ADMIN_EMAIL, password }),
  });
  if (!res.ok) {
    throw new Error(`Login failed: ${res.status} ${await res.text()}`);
  }
  const cookie = extractCookies(res);
  if (!cookie.includes("access_token")) {
    throw new Error("Login response did not set access_token cookie");
  }
  console.log(`[login] Logged in as ${ADMIN_EMAIL}`);
  return cookie;
}

async function main(): Promise<void> {
  console.log("[task-1786] Fixing signup_attempted footer via admin editor endpoint");

  initSendGrid();
  await assertPortalUrlPinned();

  const starter = getStarterEmailTemplate(SLUG);
  if (!starter) throw new Error(`No starter template for slug ${SLUG}`);
  if (!starter.htmlBody.includes("Copyright {{current_year}} Build. Test. Scale., LLC dba Build, Test, Scale")) {
    throw new Error("Starter htmlBody does not contain the new footer copyright string — aborting");
  }

  const cookie = await loginAsAdmin();

  // Find the template row id via the admin list endpoint.
  const listRes = await fetch(`${API_BASE}/admin/communications/email-templates`, {
    headers: { Cookie: cookie },
  });
  if (!listRes.ok) throw new Error(`List templates failed: ${listRes.status} ${await listRes.text()}`);
  const templates = (await listRes.json()) as Array<{ id: number; slug: string }>;
  const row = templates.find((t) => t.slug === SLUG);
  if (!row) throw new Error(`Template ${SLUG} not found via admin API`);
  console.log(`[edit] Found template id=${row.id}`);

  // Save the refreshed content through the admin editor endpoint (records a
  // version snapshot + audit entry; PUT sets starterHash NULL because content
  // fields are touched — the admin owns this copy going forward).
  const putRes = await fetch(`${API_BASE}/admin/communications/email-templates/${row.id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({
      name: starter.name,
      subject: starter.subject,
      htmlBody: starter.htmlBody,
      textBody: starter.textBody,
      variables: starter.variables,
    }),
  });
  if (!putRes.ok) throw new Error(`PUT failed: ${putRes.status} ${await putRes.text()}`);
  const updated = (await putRes.json()) as Record<string, unknown>;
  console.log(`[edit] Saved. starterHash=${String(updated.starterHash)} editedFromDefault=${String(updated.editedFromDefault)}`);

  // Verify the DB row directly.
  const [dbRow] = await db
    .select()
    .from(emailTemplatesTable)
    .where(eq(emailTemplatesTable.slug, SLUG));
  if (!dbRow) throw new Error("DB row vanished?!");
  if (dbRow.starterHash !== null) throw new Error(`starter_hash is not NULL: ${dbRow.starterHash}`);
  const checks: Array<[string, boolean]> = [
    ["new copyright entity string", dbRow.htmlBody.includes("Copyright {{current_year}} Build. Test. Scale., LLC dba Build, Test, Scale&#8482;")],
    ["dark navy footer block", dbRow.htmlBody.includes('bgcolor="#0f172a"')],
    ["9 canonical links: privacy", dbRow.htmlBody.includes("buildtestscale.com/privacy-policy")],
    ["terms-of-service link", dbRow.htmlBody.includes("buildtestscale.com/terms-of-service")],
    ["earnings disclaimer link", dbRow.htmlBody.includes("buildtestscale.com/earnings-disclaimer")],
    ["affiliate disclaimer link", dbRow.htmlBody.includes("buildtestscale.com/affiliate-disclaimer")],
    ["dmca link", dbRow.htmlBody.includes("buildtestscale.com/dmca-policy")],
    ["accessibility link", dbRow.htmlBody.includes("buildtestscale.com/accessibility-statement")],
    ["sms terms link", dbRow.htmlBody.includes("buildtestscale.com/sms-terms-and-conditions")],
    ["refund policy link", dbRow.htmlBody.includes("buildtestscale.com/performance-guarantee")],
    ["contact us link", dbRow.htmlBody.includes("buildtestscale.com/contact-us")],
    ["3-paragraph disclaimer", dbRow.htmlBody.includes("*DISCLAIMER") && dbRow.htmlBody.includes("NO GUARANTEE") && dbRow.htmlBody.includes("THE LEVEL OF SUCCESS YOU REACH")],
  ];
  const failed = checks.filter(([, ok]) => !ok);
  if (failed.length) throw new Error(`Footer verification failed: ${failed.map(([n]) => n).join(", ")}`);
  console.log(`[verify] All ${checks.length} footer checks passed; starter_hash is NULL (admin-owned).`);

  // Real test send, rendered from the just-saved DB row.
  console.log(`[send] Sending ${SLUG} test email to ${RECIPIENT} …`);
  const result = await CommunicationService.sendEmailNow({
    templateSlug: SLUG,
    to: RECIPIENT,
    variables: {
      member_name: "Adam",
      member_email: RECIPIENT,
      member_email_encoded: encodeURIComponent(RECIPIENT),
    },
  });
  console.log(`[send] Result: ${JSON.stringify(result)}`);
  console.log(`[send] ✓ Done. Check ${RECIPIENT} for the email — verify dark navy footer, 9 policy links, copyright entity string, three-paragraph disclaimer.`);
  process.exit(0);
}

main().catch((err) => {
  console.error("[task-1786] FAILED:", err);
  process.exit(1);
});
