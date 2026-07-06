/**
 * Preview harness for Task #1714 (branded email layout redesign).
 *
 * Renders EVERY member-facing email template through the new `wrapHtml()`
 * layout, using the same DB rows + variable-substitution path production
 * sends use, and writes one `.html` file per template plus an `index.html`
 * gallery into `.local/email-previews/`. Ops/internal templates (escalation,
 * digest, TicketDesk fallback, probes) are deliberately excluded — they stay
 * plain text per Task #1714 scope and are not part of this redesign.
 *
 * This script also supports sending a small number of real test emails to a
 * live inbox for visual verification (the two booking confirmations + one
 * 24h reminder, per the task's "Verify + canary" step). It reuses
 * `CommunicationService.sendEmailNow` so the real send path (SendGrid,
 * dedupe-free) is exercised exactly as production would.
 *
 * Usage (from the repo root):
 *
 *   pnpm --filter @workspace/api-server exec tsx src/scripts/preview-emails.ts
 *
 *   # Also send the 3 real verification emails to a live inbox:
 *   PREVIEW_SEND_TO=you@gmail.com \
 *     pnpm --filter @workspace/api-server exec tsx src/scripts/preview-emails.ts --send
 *
 * Requires `SENDGRID_API_KEY` (and a configured portal URL) to actually
 * deliver mail; without `--send` the script only renders local HTML files
 * and touches no external service.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { db, emailTemplatesTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { renderPersonBlock, renderPitchBlock } from "../lib/seed-templates.js";
import { CommunicationService } from "../lib/communication-service.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.resolve(__dirname, "../../../../.local/email-previews");

// Member-facing slugs the Task #1714 layout redesign touches. Deliberately
// excludes ops/internal sends (escalations, billing digest, TicketDesk
// fallback, monitoring probes), which stay plain text per the task's "Keep
// ops sends plain" step and were never routed through `wrapHtml()`.
const PREVIEW_SLUGS = [
  "welcome",
  "email_verification",
  "password_reset",
  "signup_attempted",
  "new_device_signin",
  "email_change_verify",
  "email_change_notice",
  "email_change_cancelled_by_admin",
  "email_change_cancelled_by_admin_pending",
  "email_change_cancelled_by_member",
  "email_change_cancelled_by_member_pending",
  "purchase_confirmation",
  "payment_failed",
  "payment_recovered",
  "refund_processed",
  "subscription_cancelled",
  "mentorship_expiring_warning",
  "mentorship_expiring_urgent",
  "mentorship_expired",
  "payment_failed_final",
  "role_changed",
  "ticket_reply",
  "session_feedback",
  "session_recording_ready",
  "concierge_task_created",
  "compliance_review_created",
  "kickoff_call_reminder",
  "partner_call_reminder",
  "kickoff_call_confirmation",
  "kickoff_call_reschedule",
  "kickoff_call_cancel",
  "partner_call_confirmation",
  "partner_call_reschedule",
  "partner_call_cancel",
];

// Sample person-block used for every booking-subject template so the
// preview shows the card with a photo, bio, and labeled member-timezone
// datetime — the same shape `call-bookings.ts`/`scheduled-comms.ts` build.
const SAMPLE_PERSON_BLOCK = renderPersonBlock({
  name: "Jordan Rivera",
  photoUrl: "https://portal.buildtestscale.com/images/sample-coach.jpg",
  bio: "Jordan has helped 200+ members build and scale their first online business.",
  callTypeLabel: "Kickoff Call",
  dateTimeLabel: "Tuesday, July 14 at 2:00 PM EDT",
});

const SAMPLE_PITCH_BLOCK = renderPitchBlock({
  heading: "Ready for more 1-on-1 support?",
  line: "Book time with a coach to work through your next milestone.",
  buttonLabel: "Book a Session",
  buttonUrl: "https://portal.buildtestscale.com/coaching",
});

const BOOKING_SLUGS = new Set([
  "kickoff_call_reminder",
  "partner_call_reminder",
  "kickoff_call_confirmation",
  "kickoff_call_reschedule",
  "kickoff_call_cancel",
  "partner_call_confirmation",
  "partner_call_reschedule",
  "partner_call_cancel",
]);

function sampleVariables(slug: string): Record<string, string> {
  const base: Record<string, string> = {
    member_name: "Alex Morgan",
    member_email: "alex.morgan@example.com",
    coach_name: "Jordan Rivera",
    partner_name: "Jordan Rivera",
    ticket_number: "4821",
    ticket_id: "4821",
    cancelled_pending_email: "old-address@example.com",
    call_type_label: "Kickoff Call",
    old_datetime_label: "Monday, July 6 at 10:00 AM EDT",
    new_datetime_label: "Tuesday, July 14 at 2:00 PM EDT",
    datetime_label: "Tuesday, July 14 at 2:00 PM EDT",
    meeting_url: "https://meet.google.com/abc-defg-hij",
    rebooking_url: "https://portal.buildtestscale.com/coaching/book",
  };
  if (BOOKING_SLUGS.has(slug)) {
    base.person_block_html = SAMPLE_PERSON_BLOCK;
  }
  // Show the pitch slot populated on exactly one template so the gallery
  // demonstrates it without implying every send carries a pitch (the
  // resolver that decides when to populate it is out of scope).
  if (slug === "session_feedback") {
    base.pitch_block_html = SAMPLE_PITCH_BLOCK;
  }
  return base;
}

async function renderSlug(slug: string): Promise<{ subject: string; html: string } | null> {
  const [template] = await db
    .select()
    .from(emailTemplatesTable)
    .where(and(eq(emailTemplatesTable.slug, slug), eq(emailTemplatesTable.active, true)))
    .limit(1);
  if (!template) {
    console.warn(`[preview] skipping ${slug}: not found in DB (run boot seeding first)`);
    return null;
  }
  // Reuse the exact same rendering CommunicationService uses in production
  // by round-tripping through sendEmailNow's dry-run twin: we can't call the
  // private renderer directly (not exported), so we replicate the same
  // token-substitution contract here for local file preview only. Real
  // sends (--send) go through the actual production path.
  const vars = sampleVariables(slug);
  const html = localRender(template.htmlBody, vars);
  const subject = localRender(template.subject, vars);
  return { subject, html };
}

// Minimal re-implementation of communication-service.ts's `replaceVariables`
// + `getCommonVariables` defaults, used ONLY for local static-file preview
// rendering (no network/DB side effects beyond the initial template fetch).
// Real verification sends below use the actual production code path.
function localRender(template: string, extra: Record<string, string>): string {
  const commonDefaults: Record<string, string> = {
    portal_url: "https://portal.buildtestscale.com",
    support_email: "support@buildtestscale.com",
    company_name: "Build Test Scale\u2122",
    logo_html:
      '<img src="https://portal.buildtestscale.com/images/bts-logo.png" alt="Build Test Scale" width="160" style="display:inline-block;max-width:160px;height:auto;border:0;">',
    ticketdesk_url: "https://buildtestscale.ticketdesk.example/support",
    person_block_html: "",
    pitch_block_html: "",
    current_year: new Date().getFullYear().toString(),
  };
  const vars = { ...commonDefaults, ...extra };
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(vars, key) ? vars[key] : match,
  );
}

async function renderAllToDisk(): Promise<string[]> {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const rendered: string[] = [];
  for (const slug of PREVIEW_SLUGS) {
    const result = await renderSlug(slug);
    if (!result) continue;
    const filePath = path.join(OUTPUT_DIR, `${slug}.html`);
    fs.writeFileSync(filePath, result.html, "utf8");
    rendered.push(slug);
    console.log(`[preview] wrote ${slug}.html ("${result.subject}")`);
  }

  const indexHtml = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Email Preview Gallery — Task #1714</title>
<style>body{font-family:sans-serif;max-width:600px;margin:40px auto;} li{margin:6px 0;} a{color:#1a56db;}</style>
</head><body>
<h1>Email Preview Gallery</h1>
<p>${rendered.length} member-facing templates rendered through the new branded layout.</p>
<ul>${rendered.map((s) => `<li><a href="./${s}.html" target="_blank">${s}</a></li>`).join("\n")}</ul>
</body></html>`;
  fs.writeFileSync(path.join(OUTPUT_DIR, "index.html"), indexHtml, "utf8");
  console.log(`\n[preview] gallery written to ${OUTPUT_DIR}/index.html (${rendered.length} templates)`);
  return rendered;
}

async function sendVerificationEmails(to: string): Promise<void> {
  console.log(`\n[preview] sending 3 verification emails to ${to} via the real production send path...`);

  const kickoffResult = await CommunicationService.sendEmailNow({
    templateSlug: "kickoff_call_confirmation",
    to,
    variables: {
      member_name: "Alex Morgan",
      call_type_label: "Kickoff Call",
      datetime_label: "Tuesday, July 14 at 2:00 PM EDT",
      meeting_url: "https://meet.google.com/abc-defg-hij",
      person_block_html: SAMPLE_PERSON_BLOCK,
    },
  });
  console.log(`[preview] kickoff_call_confirmation -> ${kickoffResult.status}${"reason" in kickoffResult ? ` (${(kickoffResult as any).reason})` : ""}`);

  const partnerResult = await CommunicationService.sendEmailNow({
    templateSlug: "partner_call_confirmation",
    to,
    variables: {
      member_name: "Alex Morgan",
      call_type_label: "Partner Call",
      datetime_label: "Wednesday, July 15 at 11:00 AM EDT",
      meeting_url: "https://meet.google.com/xyz-uvwx-yz1",
      person_block_html: renderPersonBlock({
        name: "Sasha Bennett",
        photoUrl: null,
        bio: "Sasha specializes in partner-call strategy and accountability.",
        callTypeLabel: "Partner Call",
        dateTimeLabel: "Wednesday, July 15 at 11:00 AM EDT",
      }),
    },
  });
  console.log(`[preview] partner_call_confirmation -> ${partnerResult.status}${"reason" in partnerResult ? ` (${(partnerResult as any).reason})` : ""}`);

  const reminderResult = await CommunicationService.sendEmailNow({
    templateSlug: "kickoff_call_reminder",
    to,
    variables: {
      member_name: "Alex Morgan",
      call_type_label: "Kickoff Call",
      datetime_label: "Tuesday, July 14 at 2:00 PM EDT",
      meeting_url: "https://meet.google.com/abc-defg-hij",
      person_block_html: SAMPLE_PERSON_BLOCK,
    },
  });
  console.log(`[preview] kickoff_call_reminder -> ${reminderResult.status}${"reason" in reminderResult ? ` (${(reminderResult as any).reason})` : ""}`);
}

async function main() {
  const rendered = await renderAllToDisk();
  if (rendered.length === 0) {
    console.error("[preview] No templates rendered — is the DB seeded? Run the API server once to trigger boot seeding, then re-run this script.");
    process.exitCode = 1;
    return;
  }

  const shouldSend = process.argv.includes("--send");
  if (shouldSend) {
    const to = process.env.PREVIEW_SEND_TO;
    if (!to) {
      console.error("[preview] --send requires PREVIEW_SEND_TO=you@example.com");
      process.exitCode = 1;
      return;
    }
    await sendVerificationEmails(to);
  } else {
    console.log("\n[preview] (dry run) pass --send with PREVIEW_SEND_TO=you@example.com to also email the 3 verification sends to a live inbox.");
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[preview] failed:", err);
    process.exit(1);
  });
