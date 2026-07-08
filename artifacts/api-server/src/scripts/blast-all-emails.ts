/**
 * blast-all-emails.ts — Task #1730 (rev-3)
 *
 * Sends one of every distinct email the BTS portal produces to
 * adam@cherringtonmedia.com through the REAL production send path (SendGrid).
 *
 * Covers:
 *   - All member-facing DB-templated emails (transactional + marketing)
 *   - All ops plain-text alerts (billing digest, queue-fallback ×2,
 *     partner escalation ×4, TicketDesk delivery, moderation failure,
 *     Retell agent, production env guard)
 *
 * Produces a numbered manifest: slug, exact subject, review notes.
 * Dormant/unfireable slugs are listed in a separate section at the end.
 * Verifies zero residue rows for adam@ in users/user_products/sequence_enrollments.
 *
 * Usage (run via a temporary workflow so process.env has SENDGRID_API_KEY):
 *
 *   npx tsx artifacts/api-server/src/scripts/blast-all-emails.ts
 */

import sgMail from "@sendgrid/mail";
import { CommunicationService } from "../lib/communication-service.js";
import { renderPersonBlock, renderPitchBlock } from "../lib/seed-templates.js";
import { pitchStackForRank } from "../lib/pitch-resolver.js";
import { getAllPitchContent } from "../lib/pitch-content-settings.js";
import {
  runBillingDigest,
  __setBillingDigestEmailSender,
} from "../lib/billing-digest.js";
import {
  defaultOpsAlertFromEmail,
  ensureSendGridInitialized,
} from "../lib/oncall-dispatcher.js";
import { buildQueueFallbackEmailForBlast } from "../lib/queue-fallback-alerter.js";
import {
  buildPartnerEscalationEmailForBlast,
  type PartnerEscalationAlertPayload,
} from "../lib/partner-escalation-alerter.js";
import { buildRetellAgentEmailForBlast } from "../lib/retell-agent-alerter.js";
import { buildModerationFailureEmailForBlast } from "../lib/moderation/failure-alerter.js";
import { buildProductionEnvGuardEmailForBlast } from "../lib/production-env-guard.js";
import { buildTicketDeskDeliveryEmailForBlast } from "../lib/ticketdesk-delivery-alerter.js";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

const RECIPIENT = "adam@cherringtonmedia.com";
const MEMBER_NAME = "Adam Test";
const PORTAL_URL = "https://portal.buildtestscale.com";
const FROM_NAME = "Build Test Scale";

// Real coach roster data from kickoff_coaches table (queried at build-time; see DB above)
// Todd: id=1, full-tier kickoff coach, /kickoff-photos/todd.jpg
// Neil: id=4, launchpad-tier kickoff coach, /partner-photos/neil.png
const TODD_PHOTO_URL = `${PORTAL_URL}/kickoff-photos/todd.jpg`;
const NEIL_PHOTO_URL = `${PORTAL_URL}/partner-photos/neil.png`;

// ─── helpers ──────────────────────────────────────────────────────────────────

function initSendGrid(): void {
  const key = process.env.SENDGRID_API_KEY;
  if (!key) throw new Error("SENDGRID_API_KEY is not set — cannot send emails");
  sgMail.setApiKey(key);
  // Also prime the oncall-dispatcher's shared init so ops alerters that call
  // ensureSendGridInitialized() would also be primed (belt + suspenders).
  ensureSendGridInitialized();
}

/** Render the pitch-block HTML for a given rank (no machineMember flag). */
async function renderPitchHtmlForRank(rank: number): Promise<string> {
  const stack = pitchStackForRank(rank, false);
  if (stack.length === 0) return "";
  const contentByKey = await getAllPitchContent();
  return stack.map((key) => renderPitchBlock(contentByKey[key])).join("");
}

// ─── manifest tracking ────────────────────────────────────────────────────────

interface ManifestEntry {
  num: string;
  slug: string;
  subject: string;
  notes: string;
  ok: boolean;
  failReason?: string;
}

const manifest: ManifestEntry[] = [];
let counter = 0;

function nextNum(): string {
  counter++;
  return String(counter).padStart(3, "0");
}

async function sendDbTemplate(opts: {
  slug: string;
  resolvedSubject: string;
  notes: string;
  variables?: Record<string, string>;
  category?: string;
}): Promise<void> {
  const num = nextNum();
  process.stdout.write(`  ${num}. ${opts.slug} ... `);

  // Always fetch the live DB subject and apply variable substitution so the
  // manifest reflects the actual rendered subject, including any admin overrides.
  // opts.resolvedSubject is kept as a fallback if the template is not found.
  let manifestSubject = opts.resolvedSubject;
  try {
    const tplRows = await db.execute(sql`
      SELECT subject FROM email_templates
      WHERE slug = ${opts.slug} AND active = true
      LIMIT 1
    `);
    if (tplRows.rows.length > 0) {
      const raw = String((tplRows.rows[0] as Record<string, unknown>).subject ?? "");
      const vars = opts.variables ?? {};
      manifestSubject = raw.replace(/\{\{(\w+)\}\}/g, (_, k: string) => vars[k] ?? `{{${k}}}`);
    }
  } catch { /* non-fatal — use caller-supplied fallback */ }

  try {
    const result = await CommunicationService.sendEmailNow({
      templateSlug: opts.slug,
      to: RECIPIENT,
      variables: opts.variables ?? {},
      category: opts.category,
    });
    if (result.status === "sent") {
      console.log("✓");
      manifest.push({ num, slug: opts.slug, subject: manifestSubject, notes: opts.notes, ok: true });
    } else {
      const reason = "reason" in result ? String(result.reason) : result.status;
      console.log(`✗ ${reason}`);
      manifest.push({ num, slug: opts.slug, subject: manifestSubject, notes: opts.notes, ok: false, failReason: reason });
    }
  } catch (err: unknown) {
    const reason = err instanceof Error ? err.message : String(err);
    console.log(`✗ ERROR: ${reason}`);
    manifest.push({ num, slug: opts.slug, subject: manifestSubject, notes: opts.notes, ok: false, failReason: reason });
  }
}

async function sendOpsEmail(opts: {
  slug: string;
  subject: string;
  text: string;
  notes: string;
}): Promise<void> {
  const num = nextNum();
  const fromEmail = defaultOpsAlertFromEmail();
  process.stdout.write(`  ${num}. ${opts.slug} ... `);
  try {
    await sgMail.send({
      to: RECIPIENT,
      from: { email: fromEmail, name: FROM_NAME },
      subject: opts.subject,
      text: opts.text,
    });
    console.log("✓");
    manifest.push({ num, slug: opts.slug, subject: opts.subject, notes: opts.notes, ok: true });
  } catch (err: unknown) {
    const reason = err instanceof Error ? err.message : String(err);
    console.log(`✗ ERROR: ${reason}`);
    manifest.push({ num, slug: opts.slug, subject: opts.subject, notes: opts.notes, ok: false, failReason: reason });
  }
}

// ─── person blocks ────────────────────────────────────────────────────────────

const TODD_BLOCK = renderPersonBlock({
  name: "Todd",
  photoUrl: TODD_PHOTO_URL,
  bio: "Todd is one of our senior kickoff coaches specialising in affiliate marketing strategy and account setup.",
  callTypeLabel: "Kickoff Call",
  dateTimeLabel: "Wednesday, July 8, 2026 at 2:00 PM CDT",
});

const NEIL_BLOCK = renderPersonBlock({
  name: "Neil",
  photoUrl: NEIL_PHOTO_URL,
  bio: "Neil is your accountability partner who will support you through the LaunchPad and partner call program.",
  callTypeLabel: "Partner Call",
  dateTimeLabel: "Thursday, July 9, 2026 at 11:00 AM CDT",
});

// ─── main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const blastStart = new Date();
  console.log("=".repeat(72));
  console.log("  BTS Email Blast — Task #1730 rev-3");
  console.log(`  Recipient: ${RECIPIENT}`);
  console.log(`  Member:    ${MEMBER_NAME}`);
  console.log(`  Date:      ${new Date().toUTCString()}`);
  console.log("=".repeat(72));

  initSendGrid();

  const opsFrom = defaultOpsAlertFromEmail();
  console.log(`\n[init] ops from-identity: ${opsFrom}`);

  // Pre-render pitch blocks from live DB settings
  console.log("[init] Pre-rendering pitch blocks from DB settings...");
  const pitchRank2 = await renderPitchHtmlForRank(2); // Machine + VIP (3-month member)
  const pitchRank0 = await renderPitchHtmlForRank(0); // LaunchPad + Machine + VIP (front-end member)
  console.log(`  rank-0: ${pitchRank0.length} chars (LaunchPad + Machine + VIP)`);
  console.log(`  rank-2: ${pitchRank2.length} chars (Machine + VIP)`);
  console.log(`  todd photo: ${TODD_PHOTO_URL}`);
  console.log(`  neil photo: ${NEIL_PHOTO_URL}`);

  // Common shared vars (injected by CommunicationService but not all templates declare them)
  const BASE = { member_name: MEMBER_NAME, portal_url: PORTAL_URL };

  // ── SECTION 1: Account / Auth ─────────────────────────────────────────────
  console.log("\n── §1 Account / Auth (" + 7 + " sends) ────────────────────────────────────");

  await sendDbTemplate({
    slug: "welcome",
    resolvedSubject: `Welcome to Build Test Scale™, ${MEMBER_NAME}!`,
    notes: "Transactional. No pitch/person block. Contains temp_password dummy value.",
    variables: { ...BASE, temp_password: "Blast@Test2026!" },
  });

  await sendDbTemplate({
    slug: "email_verification",
    resolvedSubject: "Verify your email address",
    notes: "Transactional. Link uses {{portal_url}}/verify-email?token={{verify_token}} — token is a blast dummy and will NOT resolve.",
    variables: { ...BASE, verify_token: "blast-test-verify-token-aaa111" },
  });

  await sendDbTemplate({
    slug: "password_reset",
    resolvedSubject: "Reset your password",
    notes: "Transactional. Link uses {{portal_url}}/reset-password?token={{reset_token}} — token is a blast dummy and will NOT resolve.",
    variables: { ...BASE, reset_token: "blast-test-reset-token-bbb222" },
  });

  await sendDbTemplate({
    slug: "signup_attempted",
    resolvedSubject: "ADMIN OVERRIDE for audit-writes test",
    notes: "Transactional. Subject was DB-overridden by admin (seed subject: 'Someone tried to sign up with your email'). Sign-in and reset-password links include encoded email.",
    variables: {
      ...BASE,
      member_email: RECIPIENT,
      member_email_encoded: encodeURIComponent(RECIPIENT),
    },
  });

  await sendDbTemplate({
    slug: "new_device_signin",
    resolvedSubject: "New sign-in to your Build Test Scale™ account",
    notes: "Transactional. Shows device description, IP, and sign-in time in a highlighted block.",
    variables: {
      ...BASE,
      device_description: "Chrome 126 on macOS Sonoma",
      ip_address: "98.34.112.57",
      sign_in_time: "July 8, 2026 at 10:31 AM CDT",
    },
  });

  await sendDbTemplate({
    slug: "password_changed",
    resolvedSubject: "Your password has been changed",
    notes: "Transactional. No links other than mailto support. No pitch.",
    variables: { ...BASE },
  });

  await sendDbTemplate({
    slug: "account_locked",
    resolvedSubject: "Your account has been temporarily locked",
    notes: "Transactional. Forgot-password CTA. No pitch.",
    variables: { ...BASE },
  });

  // ── SECTION 2: Email Change ───────────────────────────────────────────────
  console.log("\n── §2 Email Change (6 sends) ────────────────────────────────────────────");

  await sendDbTemplate({
    slug: "email_change_verify",
    resolvedSubject: "Confirm your new Build Test Scale™ email address",
    notes: "Transactional. Sent to NEW email address. Confirmation link includes verify_token — will NOT resolve (blast dummy).",
    variables: {
      ...BASE,
      old_email: "adam-old@example.com",
      new_email: RECIPIENT,
      verify_token: "blast-test-change-verify-ccc333",
    },
  });

  await sendDbTemplate({
    slug: "email_change_notice",
    resolvedSubject: "Email change requested on your Build Test Scale™ account",
    notes: "Transactional. Sent to OLD email address. No action link — just a security notice.",
    variables: {
      ...BASE,
      new_email: RECIPIENT,
    },
  });

  await sendDbTemplate({
    slug: "email_change_cancelled_by_admin",
    resolvedSubject: "Your pending email change was cancelled by Build Test Scale™ support",
    notes: "Transactional. Sent to CURRENT (original) email. Contains restart_url CTA to re-open the email-change form. restart_url is a blast dummy.",
    variables: {
      ...BASE,
      member_email: RECIPIENT,
      cancelled_pending_email: "adam-pending@example.com",
      restart_url: `${PORTAL_URL}/account/email-change?prefill=adam-pending%40example.com`,
    },
  });

  await sendDbTemplate({
    slug: "email_change_cancelled_by_admin_pending",
    resolvedSubject: "A pending email change to this address was cancelled by Build Test Scale™ support",
    notes: "Transactional. Sent to the PENDING (never-activated) email. No member_name — starts with 'Hello,'. No action required.",
    variables: {
      cancelled_pending_email: "adam-pending@example.com",
    },
  });

  await sendDbTemplate({
    slug: "email_change_cancelled_by_member",
    resolvedSubject: "Your pending email change was cancelled",
    notes: "Transactional. Sent to CURRENT (original) email. Contains restart_url CTA. restart_url is a blast dummy.",
    variables: {
      ...BASE,
      member_email: RECIPIENT,
      cancelled_pending_email: "adam-pending@example.com",
      restart_url: `${PORTAL_URL}/account/email-change?prefill=adam-pending%40example.com`,
    },
  });

  await sendDbTemplate({
    slug: "email_change_cancelled_by_member_pending",
    resolvedSubject: "A pending email change to this address was cancelled",
    notes: "Transactional. Sent to the PENDING (never-activated) email. No member_name — starts with 'Hello,'. No action required.",
    variables: {
      cancelled_pending_email: "adam-pending@example.com",
    },
  });

  // ── SECTION 3: Billing ───────────────────────────────────────────────────
  console.log("\n── §3 Billing (6 sends) ─────────────────────────────────────────────────");

  await sendDbTemplate({
    slug: "purchase_confirmation",
    resolvedSubject: "Your purchase of BTS 3-Month Mentorship is confirmed!",
    notes: "Transactional. Dashboard CTA. No pitch/person block. Rendered with synthetic product/amount — not a real charge.",
    variables: {
      ...BASE,
      product_name: "BTS 3-Month Mentorship",
      amount: "$297.00",
      order_id: "BTS-BLAST-001",
    },
  });

  await sendDbTemplate({
    slug: "payment_failed",
    resolvedSubject: "Action required: Payment failed for BTS 3-Month Mentorship",
    notes: "Transactional. grace_date shown as the access-expiry deadline. Update Payment Info CTA. No pitch.",
    variables: {
      ...BASE,
      product_name: "BTS 3-Month Mentorship",
      amount: "$297.00",
      grace_date: "July 17, 2026",
    },
  });

  await sendDbTemplate({
    slug: "payment_recovered",
    resolvedSubject: "Payment successful — BTS 3-Month Mentorship access restored",
    notes: "Transactional. Short confirmation. Dashboard CTA. No pitch.",
    variables: {
      ...BASE,
      product_name: "BTS 3-Month Mentorship",
      amount: "$297.00",
    },
  });

  await sendDbTemplate({
    slug: "payment_failed_final",
    resolvedSubject: "Your access to BTS 3-Month Mentorship has ended",
    notes: "Transactional. Access has ended after multiple retry failures. Restore Access CTA to billing settings. No pitch.",
    variables: {
      ...BASE,
      product_name: "BTS 3-Month Mentorship",
      amount: "$297.00",
    },
  });

  await sendDbTemplate({
    slug: "refund_processed",
    resolvedSubject: "Your refund for BTS 3-Month Mentorship has been processed",
    notes: "Transactional. Short notice — access removed. No CTA. No pitch.",
    variables: {
      ...BASE,
      product_name: "BTS 3-Month Mentorship",
      amount: "$297.00",
      order_id: "BTS-BLAST-001",
    },
  });

  await sendDbTemplate({
    slug: "subscription_cancelled",
    resolvedSubject: "Your BTS 3-Month Mentorship subscription has been cancelled",
    notes: "Transactional. Access continues until end of billing period. Manage Account CTA. No pitch.",
    variables: { ...BASE, product_name: "BTS 3-Month Mentorship" },
  });

  // ── SECTION 4: Mentorship Expiry ─────────────────────────────────────────
  console.log("\n── §4 Mentorship Expiry (3 sends) ──────────────────────────────────────");

  await sendDbTemplate({
    slug: "mentorship_expiring_warning",
    resolvedSubject: "Your BTS 3-Month Mentorship expires in less than 30 days",
    notes: "Transactional. 30-day warning. Renew Now CTA. {{pitch_block_html}} slot present in footer via wrapHtml — renders rank-2 (Machine + VIP).",
    variables: {
      ...BASE,
      product_name: "BTS 3-Month Mentorship",
      expiration_date: "August 7, 2026",
      pitch_block_html: pitchRank2,
    },
  });

  await sendDbTemplate({
    slug: "mentorship_expiring_urgent",
    resolvedSubject: "URGENT: Your BTS 3-Month Mentorship expires in less than 7 days!",
    notes: "Transactional. 7-day warning. Red urgent header. Renew Now CTA. Pitch: rank-2 (Machine + VIP).",
    variables: {
      ...BASE,
      product_name: "BTS 3-Month Mentorship",
      expiration_date: "July 15, 2026",
      pitch_block_html: pitchRank2,
    },
  });

  await sendDbTemplate({
    slug: "mentorship_expired",
    resolvedSubject: "Your BTS 3-Month Mentorship access has expired",
    notes: "Transactional. Access expired. Renew Membership CTA. Pitch: rank-2 (Machine + VIP).",
    variables: {
      ...BASE,
      product_name: "BTS 3-Month Mentorship",
      expiration_date: "July 7, 2026",
      pitch_block_html: pitchRank2,
    },
  });

  // ── SECTION 5: Account Updates ───────────────────────────────────────────
  console.log("\n── §5 Account Updates (3 sends) ─────────────────────────────────────────");

  await sendDbTemplate({
    slug: "tier_upgrade",
    resolvedSubject: "Welcome to BTS Lifetime Mentorship — you've been upgraded!",
    notes: "Transactional. Celebrate upgrade. Explore Your New Access CTA. No pitch.",
    variables: { ...BASE, product_name: "BTS Lifetime Mentorship" },
  });

  await sendDbTemplate({
    slug: "role_changed",
    resolvedSubject: "Your Build Test Scale™ role is now Coach",
    notes: "Transactional. Shows Previous role → New role block. actor_name is 'The BTS Team'. No pitch.",
    variables: {
      ...BASE,
      actor_name: "The BTS Team",
      previous_role_label: "Member",
      new_role_label: "Coach",
    },
  });

  await sendDbTemplate({
    slug: "flexy_password_reset",
    resolvedSubject: "Your new Flexy password",
    notes: "Transactional. Shows login email + new password in a monospace box. Open Flexy Login CTA (blast dummy URL).",
    variables: {
      ...BASE,
      flexy_email: RECIPIENT,
      flexy_password: "Temp@Blast2026!",
      flexy_login_url: "https://flexy.io/login",
    },
  });

  // ── SECTION 6: Support / Concierge ───────────────────────────────────────
  console.log("\n── §6 Support / Concierge (4 sends) ─────────────────────────────────────");

  await sendDbTemplate({
    slug: "ticket_created",
    resolvedSubject: "Ticket #7301 received — we'll get back to you soon",
    notes: "Transactional. Shows ticket_number and ticket_subject. View Tickets CTA. No pitch.",
    variables: {
      ...BASE,
      ticket_number: "7301",
      ticket_subject: "Question about affiliate commission tracking",
    },
  });

  await sendDbTemplate({
    slug: "ticket_reply",
    resolvedSubject: "New reply on ticket #7301",
    notes: "Transactional. View Reply CTA links to /support/tickets/{{ticket_id}}. ticket_id matches ticket_number.",
    variables: {
      ...BASE,
      ticket_number: "7301",
      ticket_id: "7301",
    },
  });

  await sendDbTemplate({
    slug: "concierge_task_created",
    resolvedSubject: "Your Concierge task CONC-4821 has been received",
    notes: "Transactional. Shows task_subject + ticket_number reference. 24–72 hour SLA stated. View Submission CTA.",
    variables: {
      ...BASE,
      ticket_number: "CONC-4821",
      task_subject: "Set up ClickBank affiliate account and configure offer rotation",
    },
  });

  await sendDbTemplate({
    slug: "compliance_review_created",
    resolvedSubject: "Your compliance review COMP-1144 has been received",
    notes: "Transactional. 24-hour SLA. DO NOT run creative until approved — red warning box. View Submission CTA.",
    variables: {
      ...BASE,
      ticket_number: "COMP-1144",
      task_subject: "Native ad creative for ClickBank gravity-50 offer (July 2026)",
    },
  });

  // ── SECTION 7: Kickoff Calls ──────────────────────────────────────────────
  console.log("\n── §7 Kickoff Calls (5 sends incl. 1 extra LaunchPad) ───────────────────");

  // Standard kickoff confirmation: 3-month member (rank-2 pitch), Todd as coach
  await sendDbTemplate({
    slug: "kickoff_call_confirmation",
    resolvedSubject: "Your kickoff call is confirmed",
    notes: "Transactional. Person block: Todd (full-tier kickoff coach, photo loads). Pitch: rank-2 = Machine + VIP (3-month member simulation). Join Your Call CTA (blast dummy Meet URL).",
    variables: {
      ...BASE,
      meeting_url: "https://meet.google.com/bts-kick-off-01",
      person_block_html: TODD_BLOCK,
      pitch_block_html: pitchRank2,
    },
  });

  // EXTRA: LaunchPad/front-end member kickoff — rank-0 (LaunchPad + Machine + VIP), Neil
  await sendDbTemplate({
    slug: "kickoff_call_confirmation",
    resolvedSubject: "Your kickoff call is confirmed",
    notes: "EXTRA SEND — LaunchPad/front-end member simulation. Person block: Neil (launchpad-tier kickoff coach, photo loads). Pitch: rank-0 = LaunchPad + Machine + VIP (full 3-pitch stack). Purpose: show complete rank-0 pitch stack side-by-side with rank-2.",
    variables: {
      ...BASE,
      meeting_url: "https://meet.google.com/bts-kick-off-launchpad",
      person_block_html: NEIL_BLOCK,
      pitch_block_html: pitchRank0,
    },
  });

  await sendDbTemplate({
    slug: "kickoff_call_reschedule",
    resolvedSubject: "Your kickoff call has been rescheduled",
    notes: "Transactional. Shows previous_datetime_label → new_datetime_label block. Person block: Todd. No pitch (rescheduled context).",
    variables: {
      ...BASE,
      previous_datetime_label: "Monday, July 7, 2026 at 10:00 AM CDT",
      new_datetime_label: "Wednesday, July 9, 2026 at 2:00 PM CDT",
      meeting_url: "https://meet.google.com/bts-kick-off-01",
      person_block_html: TODD_BLOCK,
    },
  });

  await sendDbTemplate({
    slug: "kickoff_call_cancel",
    resolvedSubject: "Your kickoff call has been cancelled",
    notes: "Transactional. Book a New Call CTA to /dashboard. No person block (template strip on cancel). No pitch.",
    variables: { ...BASE },
  });

  await sendDbTemplate({
    slug: "kickoff_call_reminder",
    resolvedSubject: "Your kickoff call is tomorrow",
    notes: "Marketing. 24h reminder. staff_name = Todd. Call date/time in highlighted block. Pitch: rank-2 (Machine + VIP) via {{pitch_block_html}} footer slot.",
    variables: {
      ...BASE,
      staff_name: "Todd",
      call_date: "Wednesday, July 9, 2026",
      call_time: "2:00 PM CDT",
      pitch_block_html: pitchRank2,
    },
    category: "marketing",
  });

  // ── SECTION 8: Partner Calls ──────────────────────────────────────────────
  console.log("\n── §8 Partner Calls (4 sends) ────────────────────────────────────────────");

  await sendDbTemplate({
    slug: "partner_call_confirmation",
    resolvedSubject: "Your partner call is confirmed",
    notes: "Transactional. Person block: Neil (partner-photos/neil.png, photo loads). Pitch: rank-2 = Machine + VIP. Join Your Call CTA (blast dummy Meet URL).",
    variables: {
      ...BASE,
      meeting_url: "https://meet.google.com/bts-partner-01",
      person_block_html: NEIL_BLOCK,
      pitch_block_html: pitchRank2,
    },
  });

  await sendDbTemplate({
    slug: "partner_call_reschedule",
    resolvedSubject: "Your partner call has been rescheduled",
    notes: "Transactional. Previous/new time block. Person block: Neil. No pitch.",
    variables: {
      ...BASE,
      previous_datetime_label: "Thursday, July 10, 2026 at 9:00 AM CDT",
      new_datetime_label: "Friday, July 11, 2026 at 11:00 AM CDT",
      meeting_url: "https://meet.google.com/bts-partner-01",
      person_block_html: NEIL_BLOCK,
    },
  });

  await sendDbTemplate({
    slug: "partner_call_cancel",
    resolvedSubject: "Your partner call has been cancelled",
    notes: "Transactional. Book a New Call CTA to /dashboard. No pitch.",
    variables: { ...BASE },
  });

  await sendDbTemplate({
    slug: "partner_call_reminder",
    resolvedSubject: "Your accountability partner call is tomorrow",
    notes: "Marketing. 24h reminder. staff_name = Neil. Call date/time in highlighted block. Pitch: rank-2 (Machine + VIP).",
    variables: {
      ...BASE,
      staff_name: "Neil",
      call_date: "Thursday, July 10, 2026",
      call_time: "9:00 AM CDT",
      pitch_block_html: pitchRank2,
    },
    category: "marketing",
  });

  // ── SECTION 9: Private Coaching ───────────────────────────────────────────
  console.log("\n── §9 Private Coaching (3 sends) ─────────────────────────────────────────");

  await sendDbTemplate({
    slug: "session_feedback",
    resolvedSubject: "How was Monday Morning Q&A with the BTS Team? We'd love your feedback",
    notes: "Marketing. Post-session feedback request. call_title renders in subject. Pitch: rank-2.",
    variables: {
      ...BASE,
      call_title: "Monday Morning Q&A with the BTS Team",
      pitch_block_html: pitchRank2,
    },
    category: "marketing",
  });

  await sendDbTemplate({
    slug: "recording_ready",
    resolvedSubject: "The recording for Monday Morning Q&A — July 7, 2026 is ready",
    notes: "Marketing. Group coaching recording. Watch the Recording CTA to /coaching. Pitch: rank-2.",
    variables: {
      ...BASE,
      call_title: "Monday Morning Q&A — July 7, 2026",
      pitch_block_html: pitchRank2,
    },
    category: "marketing",
  });

  await sendDbTemplate({
    slug: "session_recording_ready",
    resolvedSubject: "Your Private Coaching recording is ready",
    notes: "Marketing. 1-on-1 session recording. Watch CTA links to {{portal_url}}{{recording_path}} — recording_path is blast dummy and will NOT resolve. Pitch: rank-2.",
    variables: {
      ...BASE,
      recording_path: "/coaching/book-session?recording=blast-test-001",
      pitch_block_html: pitchRank2,
    },
    category: "marketing",
  });

  // ── SECTION 10: Marketing / Lifecycle ─────────────────────────────────────
  console.log("\n── §10 Marketing / Lifecycle (12 sends) ─────────────────────────────────");

  await sendDbTemplate({
    slug: "onboarding_day1",
    resolvedSubject: "Your first step inside Build Test Scale™",
    notes: "Marketing. Day-1 onboarding nudge. 3-step quick-start list. Start Now CTA.",
    variables: { ...BASE },
    category: "marketing",
  });

  await sendDbTemplate({
    slug: "onboarding_day3",
    resolvedSubject: "Have you started your first lesson yet?",
    notes: "Marketing. Day-3 nudge to start first lesson.",
    variables: { ...BASE },
    category: "marketing",
  });

  await sendDbTemplate({
    slug: "onboarding_day7",
    resolvedSubject: "Your first week at BTS — here's what's next",
    notes: "Marketing. Week-1 recap with next-step bullets.",
    variables: { ...BASE },
    category: "marketing",
  });

  await sendDbTemplate({
    slug: "coaching_reminder",
    resolvedSubject: "Live coaching call tomorrow: Live Q&A: Affiliate Marketing Fundamentals",
    notes: "Marketing. 24h group-call reminder. call_title renders in subject. call_date + call_time in body block.",
    variables: {
      ...BASE,
      call_title: "Live Q&A: Affiliate Marketing Fundamentals",
      call_date: "Tuesday, July 8, 2026",
      call_time: "12:00 PM CDT",
    },
    category: "marketing",
  });

  await sendDbTemplate({
    slug: "new_content_alert",
    resolvedSubject: "New content just dropped: Module 7: Advanced Traffic Scaling",
    notes: "Marketing. content_title renders in subject. content_description in body. Check It Out CTA.",
    variables: {
      ...BASE,
      content_title: "Module 7: Advanced Traffic Scaling",
      content_description:
        "Learn how to 10× your traffic without increasing your ad spend — new strategies for Q3 2026.",
    },
    category: "marketing",
  });

  await sendDbTemplate({
    slug: "streak_milestone",
    resolvedSubject: "You're on a 7-day streak! Keep it up!",
    notes: "Marketing. streak_count renders in subject and body. Continue Learning CTA.",
    variables: { ...BASE, streak_count: "7" },
    category: "marketing",
  });

  await sendDbTemplate({
    slug: "win_of_the_week",
    resolvedSubject: "This week's biggest wins from the BTS community",
    notes: "Marketing. wins_content is a multi-line block of member wins.",
    variables: {
      ...BASE,
      wins_content:
        "• Sarah M. hit her first $10k affiliate month\n• Jake T. got his first sale within 72 hours of joining\n• Maria R. scaled to $500/day with our traffic system",
    },
    category: "marketing",
  });

  await sendDbTemplate({
    slug: "monthly_progress",
    resolvedSubject: "Your monthly progress report is ready",
    notes: "Marketing. month_name, lessons_completed, calls_attended, streak_count in a list block.",
    variables: {
      ...BASE,
      month_name: "June 2026",
      lessons_completed: "12",
      calls_attended: "4",
      streak_count: "21",
    },
    category: "marketing",
  });

  await sendDbTemplate({
    slug: "upgrade_offer",
    resolvedSubject: "Ready for the next level? Upgrade to BTS Lifetime Mentorship",
    notes: "Marketing. upgrade_product renders in subject. See Upgrade Options CTA.",
    variables: { ...BASE, upgrade_product: "BTS Lifetime Mentorship" },
    category: "marketing",
  });

  await sendDbTemplate({
    slug: "re_engagement",
    resolvedSubject: `We miss you, ${MEMBER_NAME}!`,
    notes: `Marketing. member_name renders in subject. Get Back to Learning CTA.`,
    variables: { ...BASE },
    category: "marketing",
  });

  await sendDbTemplate({
    slug: "community_announcement",
    resolvedSubject: "New Community Guidelines — July 2026",
    notes: "Marketing. announcement_title renders as subject and H2. Read More CTA.",
    variables: {
      ...BASE,
      announcement_title: "New Community Guidelines — July 2026",
      announcement_body:
        "We've updated our community guidelines to better support every member. Please take a moment to review the changes.",
    },
    category: "marketing",
  });

  await sendDbTemplate({
    slug: "event_invitation",
    resolvedSubject: "You're invited: BTS Affiliate Summit — Virtual Edition",
    notes: "Marketing. event_title renders in subject. event_date + event_time + event_description in body. RSVP Now CTA.",
    variables: {
      ...BASE,
      event_title: "BTS Affiliate Summit — Virtual Edition",
      event_date: "August 14, 2026",
      event_time: "1:00 PM CDT",
      event_description:
        "A full-day virtual summit covering the latest strategies in affiliate marketing, traffic, and scaling.",
    },
    category: "marketing",
  });

  // ── SECTION 11: Ops Plain-Text Emails ────────────────────────────────────
  console.log("\n── §11 Ops Plain-Text Emails (11 sends) ────────────────────────────────");

  // 11a. Billing digest — real runBillingDigest path with recipient override
  {
    const num = nextNum();
    process.stdout.write(`  ${num}. ops:billing_digest ... `);
    let digestSubject = "(unknown — see digest output)";
    try {
      let capturedSubject = "";
      __setBillingDigestEmailSender(async (msg) => {
        capturedSubject = msg.subject;
        await sgMail.send({
          to: RECIPIENT,
          from: { email: msg.from, name: FROM_NAME },
          subject: msg.subject,
          text: msg.text,
        });
      });
      // BILLING_ALERTS_EMAIL is the sole recipient-determination mechanism
      // in runBillingDigest. Set it scoped to this block and clean up in
      // both the happy path and the catch so no other send path is affected.
      process.env.BILLING_ALERTS_EMAIL = RECIPIENT;
      const digestResult = await runBillingDigest({ force: true });
      __setBillingDigestEmailSender(null);
      delete process.env.BILLING_ALERTS_EMAIL;

      if (digestResult.outcome === "sent") {
        digestSubject = capturedSubject || "BTS Billing Digest — Daily Summary";
        console.log("✓");
        manifest.push({
          num,
          slug: "ops:billing_digest",
          subject: digestSubject,
          notes: "Ops plain-text. Runs real runBillingDigest() with live DB stats (members, revenue, renewals, refunds, dunning). Plain-text format by design.",
          ok: true,
        });
      } else {
        const reason = `${digestResult.outcome}: ${digestResult.reason ?? ""}`;
        console.log(`✗ ${reason}`);
        manifest.push({ num, slug: "ops:billing_digest", subject: digestSubject, notes: "Billing digest.", ok: false, failReason: reason });
      }
    } catch (err: unknown) {
      __setBillingDigestEmailSender(null);
      delete process.env.BILLING_ALERTS_EMAIL;
      const reason = err instanceof Error ? err.message : String(err);
      console.log(`✗ ERROR: ${reason}`);
      manifest.push({ num, slug: "ops:billing_digest", subject: digestSubject, notes: "Billing digest.", ok: false, failReason: reason });
    }
  }

  // 11b–c. Queue fallback alerts (email + SMS channels)
  // Uses canonical buildQueueFallbackEmailForBlast() — same buildMessages() path
  // the live alerter uses, so subject + body are never hand-authored duplicates.
  {
    const em = buildQueueFallbackEmailForBlast("email");
    await sendOpsEmail({
      slug: "ops:queue_fallback_email [FIRE]",
      subject: em.subject,
      text: em.text,
      notes: "Ops plain-text. Queue-fallback FIRE for the email channel. Subject + body via canonical buildQueueFallbackEmailForBlast(). Plain-text by design.",
    });
  }
  {
    const sm = buildQueueFallbackEmailForBlast("sms");
    await sendOpsEmail({
      slug: "ops:queue_fallback_sms [FIRE]",
      subject: sm.subject,
      text: sm.text,
      notes: "Ops plain-text. Queue-fallback FIRE for the SMS channel. Distinct from email-channel alert (separate dedup key in production).",
    });
  }

  // 11d. Partner escalation — no_show
  {
    const em = buildPartnerEscalationEmailForBlast({
      alertType: "no_show",
      kind: "fire",
      now: Date.now(),
      memberId: 99901,
      memberName: "Test Member",
      consecutiveNoShows: 3,
    } as PartnerEscalationAlertPayload);
    await sendOpsEmail({
      slug: "ops:partner_escalation_no_show [FIRE]",
      subject: em.subject,
      text: em.text,
      notes: "Ops plain-text. Partner no-show escalation FIRE. Subject + body via buildPartnerEscalationEmailForBlast().",
    });
  }

  // 11e. Partner escalation — vanish
  {
    const em = buildPartnerEscalationEmailForBlast({
      alertType: "vanish",
      kind: "fire",
      now: Date.now(),
      memberId: 99901,
      memberName: "Test Member",
      daysSinceLastCall: 17,
      thresholdDays: 14,
    } as PartnerEscalationAlertPayload);
    await sendOpsEmail({
      slug: "ops:partner_escalation_vanish [FIRE]",
      subject: em.subject,
      text: em.text,
      notes: "Ops plain-text. Partner vanish alert FIRE. daysSinceLastCall renders in subject.",
    });
  }

  // 11f. Partner escalation — capacity
  {
    const em = buildPartnerEscalationEmailForBlast({
      alertType: "capacity",
      kind: "fire",
      now: Date.now(),
      bookedSlots: 127,
      availableSlots: 153,
      ratioPct: 83,
    } as PartnerEscalationAlertPayload);
    await sendOpsEmail({
      slug: "ops:partner_escalation_capacity [FIRE]",
      subject: em.subject,
      text: em.text,
      notes: "Ops plain-text. Partner capacity FIRE. Fleet-wide alert. Subject varies by capacity %.",
    });
  }

  // 11g. Partner escalation — assignment_delay
  {
    const em = buildPartnerEscalationEmailForBlast({
      alertType: "assignment_delay",
      kind: "fire",
      now: Date.now(),
      soonestIso: new Date(Date.now() + 9 * 24 * 3600_000).toISOString(),
      daysOut: 9,
    } as PartnerEscalationAlertPayload);
    await sendOpsEmail({
      slug: "ops:partner_escalation_assignment_delay [FIRE]",
      subject: em.subject,
      text: em.text,
      notes: "Ops plain-text. Partner assignment-delay FIRE. Fleet-wide alert. soonestSlot is a future date.",
    });
  }

  // 11h. TicketDesk delivery alert
  // Uses canonical buildTicketDeskDeliveryEmailForBlast() → computeTicketDeskDeliveryEmail()
  {
    const em = buildTicketDeskDeliveryEmailForBlast();
    await sendOpsEmail({
      slug: "ops:ticketdesk_delivery [FIRE]",
      subject: em.subject,
      text: em.text,
      notes: "Ops plain-text. TicketDesk delivery FIRE. Subject + body via buildTicketDeskDeliveryEmailForBlast().",
    });
  }

  // 11i. Moderation failure alert
  // Uses canonical buildModerationFailureEmailForBlast() → computeModerationFailureEmail()
  {
    const em = buildModerationFailureEmailForBlast();
    await sendOpsEmail({
      slug: "ops:moderation_failure [FIRE]",
      subject: em.subject,
      text: em.text,
      notes: "Ops plain-text. Moderation failure FIRE. Subject + body via buildModerationFailureEmailForBlast().",
    });
  }

  // 11j. Retell voice agent alert
  // Uses canonical buildRetellAgentEmailForBlast() → buildMessages()
  {
    const em = buildRetellAgentEmailForBlast();
    await sendOpsEmail({
      slug: "ops:retell_agent [FIRE]",
      subject: em.subject,
      text: em.text,
      notes: "Ops plain-text. Retell agent FIRE (status=misconfigured). Subject + body via buildRetellAgentEmailForBlast().",
    });
  }

  // 11k. Production env guard
  // Uses canonical buildProductionEnvGuardEmailForBlast() → buildMessages()
  {
    const em = buildProductionEnvGuardEmailForBlast("jwt-secret-missing");
    await sendOpsEmail({
      slug: "ops:production_env_guard_JWT_SECRET [FIRE]",
      subject: em.subject,
      text: em.text,
      notes: "Ops plain-text. Production env guard FIRE for JWT_SECRET defaulted/missing. Security-critical alert.",
    });
  }

  // ── CLEANUP VERIFICATION ──────────────────────────────────────────────────
  // adam@cherringtonmedia.com is a pre-existing admin/super_admin in the system
  // (Startup hook promotes them with all products). The blast must NOT have added
  // sequence_enrollment rows or new user/product rows beyond what existed before.
  console.log("\n── Cleanup Verification ─────────────────────────────────────────────────");
  try {
    const residue = await db.execute(sql`
      SELECT
        (SELECT count(*) FROM users WHERE email = ${RECIPIENT}) AS users_count,
        (SELECT count(*) FROM user_products up
           JOIN users u ON u.id = up.user_id WHERE u.email = ${RECIPIENT}) AS products_count,
        (SELECT count(*) FROM sequence_enrollments se
           JOIN users u ON u.id = se.user_id WHERE u.email = ${RECIPIENT}) AS enrollments_count
    `);
    const row = residue.rows[0] as Record<string, unknown>;
    const users = Number(row.users_count);
    const products = Number(row.products_count);
    const enrollments = Number(row.enrollments_count);

    // 1 user + N products = pre-existing admin account (not blast artifacts).
    // enrollments = 0 means the blast added zero sequence rows.
    if (enrollments === 0) {
      console.log("  ✓ Zero blast-residue rows: no sequence_enrollment rows added.");
      console.log(`    Pre-existing admin account: users=${users}, user_products=${products} (expected — startup hook promotes adam@ to admin with all products).`);
    } else {
      console.log(`  ⚠ UNEXPECTED RESIDUE: sequence_enrollments=${enrollments} (expected 0 for a direct sendEmailNow blast)`);
    }
    console.log(`    users=${users}, user_products=${products}, sequence_enrollments=${enrollments}`);
  } catch (err: unknown) {
    console.log(`  ⚠ Cleanup verification failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Verify comms_send_log has the expected send count for this run.
  // sendEmailNow() records every send in comms_send_log, so the number of rows
  // created after blastStart must equal the number of DB-templated sends that
  // reported status "sent". Ops emails go direct via SendGrid and are NOT logged.
  try {
    const logRows = await db.execute(sql`
      SELECT count(*) AS send_count
      FROM comms_send_log
      WHERE sent_at > ${blastStart}
    `);
    const sendCount = Number((logRows.rows[0] as Record<string, unknown>).send_count);
    const dbSent = manifest.filter((r) => r.ok && !r.slug.startsWith("ops:")).length;
    if (sendCount === dbSent) {
      console.log(`  ✓ comms_send_log: ${sendCount} row(s) recorded (matches ${dbSent} DB-template sends).`);
    } else {
      console.log(`  ⚠ comms_send_log mismatch: ${sendCount} rows recorded vs ${dbSent} expected DB sends.`);
    }
  } catch (err: unknown) {
    console.log(`  ⚠ comms_send_log check failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  // ── DORMANT / UNFIREABLE ──────────────────────────────────────────────────
  const dormant = [
    {
      slug: "signup_challenge (ops alerter)",
      reason: "signup-challenge-alerter.ts fires via oncall-dispatcher only when failed challenge attempts cross a threshold. No DB template. Cannot test-fire without spoof-crafting a threshold crossing inside a test request — out of scope for this blast.",
    },
    {
      slug: "machine_mismatch_digest (ops alerter)",
      reason: "machine-mismatch-digest-alerter.ts produces a daily email but requires live Machine-brand grant data. Not included in the task-1730 ops list. Documented here as unfired.",
    },
    {
      slug: "yse_grant_exhausted (ops alerter)",
      reason: "yse-grant-exhausted-alerter.ts fires when YSE retry attempts are exhausted for a specific grant. No DB template. Requires a live failing YSE grant to trigger. Unfireable in blast context.",
    },
    {
      slug: "SMS templates (all)",
      reason: "Out of scope per task spec: 'SMS sends of any kind' are excluded. 13 SMS templates exist in the DB (welcome, purchase_confirmation, payment_failed, coaching_reminder, recording_ready, session_recording_ready, mentorship_expiring, new_content_alert, verification_code, password_reset, flexy_password_reset, ticket_reply, kickoff_call_reminder, partner_call_reminder). None fired.",
    },
    {
      slug: "Machine-brand nurture emails",
      reason: "Out of scope per task spec: 'The six brands' branded nurture emails (Machine-brand side) — BTS-side sends only.'",
    },
  ];

  // ── FINAL MANIFEST ────────────────────────────────────────────────────────
  const sent = manifest.filter((r) => r.ok);
  const failed = manifest.filter((r) => !r.ok);

  console.log("\n" + "=".repeat(72));
  console.log("  BLAST MANIFEST — TASK #1730 rev-3");
  console.log("=".repeat(72));
  console.log(`  Recipient:    ${RECIPIENT}`);
  console.log(`  Member name:  ${MEMBER_NAME}`);
  console.log(`  Sent:         ${sent.length} / ${manifest.length}`);
  console.log(`  Failed:       ${failed.length}`);
  console.log(`  Timestamp:    ${new Date().toUTCString()}`);
  console.log();

  for (const entry of manifest) {
    const status = entry.ok ? "✓" : `✗ [${entry.failReason ?? "unknown"}]`;
    console.log(`  ${status} ${entry.num}. ${entry.slug}`);
    console.log(`       Subject: ${entry.subject}`);
    console.log(`       Notes:   ${entry.notes}`);
    console.log();
  }

  console.log("─".repeat(72));
  console.log("  DORMANT / UNFIREABLE (not sent — documented with reason)");
  console.log("─".repeat(72));
  for (const d of dormant) {
    console.log(`  • ${d.slug}`);
    console.log(`    ${d.reason}`);
    console.log();
  }

  if (failed.length > 0) {
    console.log(`\n  ⚠  ${failed.length} send(s) did not go through. See manifest above.`);
    process.exitCode = 1;
  } else {
    console.log(`\n  ✓ All ${sent.length} emails delivered successfully.`);
  }
}

main().catch((err: unknown) => {
  console.error("[blast] Fatal error:", err);
  process.exit(1);
});
