/**
 * send-booking-confirmation-sample.ts — Task #1782 acceptance artifact
 *
 * Sends ONE kickoff_call_confirmation email to adam@cherringtonmedia.com
 * through the REAL production send path (SendGrid), using real roster data
 * from the live DB, to prove the full legal footer renders correctly in a
 * live Gmail inbox.
 *
 * Usage (via a temporary console workflow so process.env has SENDGRID_API_KEY):
 *
 *   PORTAL_URL=https://portal.buildtestscale.com \
 *     npx tsx artifacts/api-server/src/scripts/send-booking-confirmation-sample.ts
 */

import sgMail from "@sendgrid/mail";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { CommunicationService } from "../lib/communication-service.js";
import { renderPersonBlock } from "../lib/seed-templates.js";
import { formatInMemberTimezone } from "../lib/member-timezone.js";
import { getPortalUrl, __invalidatePortalUrlCacheForTests } from "../lib/portal-url-settings.js";
import { ensureSendGridInitialized } from "../lib/oncall-dispatcher.js";

const RECIPIENT = "adam@cherringtonmedia.com";
const MEMBER_NAME = "Adam";
const MEMBER_TZ = "America/Chicago";
const EXPECTED_PORTAL_URL = "https://portal.buildtestscale.com";

function initSendGrid(): void {
  const key = process.env.SENDGRID_API_KEY;
  if (!key) throw new Error("SENDGRID_API_KEY is not set — cannot send emails");
  sgMail.setApiKey(key);
  ensureSendGridInitialized();
}

async function assertPortalUrlPinned(): Promise<void> {
  __invalidatePortalUrlCacheForTests();
  const resolved = await getPortalUrl();
  if (resolved !== EXPECTED_PORTAL_URL) {
    throw new Error(
      `PORTAL_URL did not resolve to the production host. Got "${resolved}", expected "${EXPECTED_PORTAL_URL}". ` +
      `Set PORTAL_URL=${EXPECTED_PORTAL_URL} in the process environment before running this script. ABORTING.`,
    );
  }
  console.log(`[init] Portal URL pinned: ${resolved}`);
}

async function loadFirstActiveKickoffCoach(): Promise<{
  name: string;
  photoUrl: string | null;
  bio: string | null;
}> {
  const rows = await db.execute(sql`
    SELECT name, photo_url, bio FROM coaches
    WHERE is_active = true AND does_private_coaching = false
    ORDER BY sort_order ASC
    LIMIT 1
  `);
  if (!rows.rows.length) {
    // Fall back to any active coach
    const fallback = await db.execute(sql`
      SELECT name, photo_url, bio FROM coaches WHERE is_active = true ORDER BY sort_order ASC LIMIT 1
    `);
    if (!fallback.rows.length) throw new Error("No active coaches found in DB — aborting.");
    const r = fallback.rows[0] as Record<string, unknown>;
    return {
      name: String(r.name),
      photoUrl: r.photo_url === null ? null : String(r.photo_url),
      bio: r.bio === null ? null : String(r.bio),
    };
  }
  const r = rows.rows[0] as Record<string, unknown>;
  return {
    name: String(r.name),
    photoUrl: r.photo_url === null ? null : String(r.photo_url),
    bio: r.bio === null ? null : String(r.bio),
  };
}

async function main(): Promise<void> {
  console.log("[sample-send] Task #1782 — booking-confirmation sample to verify full legal footer");

  initSendGrid();
  await assertPortalUrlPinned();

  const portalUrl = await getPortalUrl();
  const coach = await loadFirstActiveKickoffCoach();
  console.log(`[sample-send] Using coach: ${coach.name}`);

  // Schedule the "call" 48 hours from now so the datetime is clearly in the future.
  const scheduledAt = new Date(Date.now() + 48 * 3600_000);
  const { date: callDate, time: callTime } = formatInMemberTimezone(scheduledAt, MEMBER_TZ);
  const dateTimeLabel = `${callDate} at ${callTime}`;

  const personBlockHtml = renderPersonBlock({
    name: coach.name,
    photoUrl: coach.photoUrl,
    bio: coach.bio,
    callTypeLabel: "Kickoff Call",
    dateTimeLabel,
    portalUrl,
  });

  const meetingUrl = "https://meet.google.com/sample-task-1782-verify";

  console.log(`[sample-send] Sending kickoff_call_confirmation to ${RECIPIENT} …`);
  await CommunicationService.sendEmailNow({
    templateSlug: "kickoff_call_confirmation",
    to: RECIPIENT,
    variables: {
      member_name: MEMBER_NAME,
      meeting_url: meetingUrl,
      person_block_html: personBlockHtml,
    },
  });

  console.log(`[sample-send] ✓ Sent successfully. Check ${RECIPIENT} for the email with the full legal footer.`);
  console.log(`[sample-send]   Verify: dark navy footer block, 9 policy links, copyright "Build. Test. Scale., LLC dba Build, Test, Scale™", three-paragraph disclaimer.`);

  process.exit(0);
}

main().catch((err) => {
  console.error("[sample-send] FAILED:", err);
  process.exit(1);
});
