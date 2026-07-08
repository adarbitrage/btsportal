/**
 * blast-all-emails-v2.ts — Task #1736 (corrected re-run of the Task #1730 blast)
 *
 * Fixes, relative to blast-all-emails.ts (kept as-is for audit trail):
 *   1. Pins PORTAL_URL to the production host for this run (never the dev
 *      default) and asserts it resolved correctly before sending anything.
 *   2. Person-blocks use REAL roster rows queried live from `kickoff_coaches`
 *      / `partners` (no invented names/bios/photos), one roster member per
 *      distinct booking-email type — never the same person twice.
 *   3. Every email's body datetime and person-card datetime are derived from
 *      the exact same `Date` object (single-sourced), formatted once via
 *      `formatInMemberTimezone`, not two independently hand-typed strings.
 *   4. A PRE-FLIGHT PASS renders every planned email through a capture-only
 *      monkey-patch of `sgMail.send` (nothing is delivered), collects every
 *      unique `<img src>` across all jobs, and fetch-verifies each one
 *      returns 200 + `image/*`. The whole run ABORTS with a report if any
 *      asset fails — no real send happens.
 *   5. Only after the pre-flight passes does the REAL send pass run through
 *      the unmodified `sgMail.send`.
 *   6. One send per distinct email type (no extra/duplicate simulations).
 *
 * Usage (via a temporary console workflow so process.env has SENDGRID_API_KEY):
 *
 *   PORTAL_URL=https://portal.buildtestscale.com \
 *     npx tsx artifacts/api-server/src/scripts/blast-all-emails-v2.ts
 */

import sgMail from "@sendgrid/mail";
import { CommunicationService } from "../lib/communication-service.js";
import { renderPersonBlock, renderPitchBlock } from "../lib/seed-templates.js";
import { pitchStackForRank } from "../lib/pitch-resolver.js";
import { getAllPitchContent } from "../lib/pitch-content-settings.js";
import { getPortalUrl, __invalidatePortalUrlCacheForTests } from "../lib/portal-url-settings.js";
import { formatInMemberTimezone } from "../lib/member-timezone.js";
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
const EXPECTED_PORTAL_URL = "https://portal.buildtestscale.com";
const FROM_NAME = "Build Test Scale";
const MEMBER_TZ = "America/Chicago";

// A single shared "now" — every scheduled-call Date used anywhere in this
// script is derived from this instant so re-runs are reproducible within one
// process invocation and nothing is independently hand-typed twice.
const NOW = new Date();
function hoursFromNow(h: number): Date {
  return new Date(NOW.getTime() + h * 3600_000);
}
function label(d: Date): { date: string; time: string; combined: string } {
  const { date, time } = formatInMemberTimezone(d, MEMBER_TZ);
  return { date, time, combined: `${date} at ${time}` };
}

// ─── init / assertions ──────────────────────────────────────────────────────

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
      `Set PORTAL_URL=${EXPECTED_PORTAL_URL} in the process environment before running this script. ABORTING — no email will be sent.`,
    );
  }
  console.log(`[init] Portal URL pinned: ${resolved}`);
}

// ─── real roster (queried live, not hardcoded) ─────────────────────────────

interface RosterPerson {
  name: string;
  photoUrl: string | null;
  bio: string | null;
}

async function loadRoster(): Promise<{
  kickoff: Record<"Todd" | "Mark" | "Bruce" | "Neil", RosterPerson>;
  partner: Record<"Jean" | "Mikha" | "John" | "Neil", RosterPerson>;
}> {
  const kc = await db.execute(sql`
    SELECT display_name, photo_url, bio FROM kickoff_coaches
    WHERE is_active = true AND display_name IN ('Todd', 'Mark', 'Bruce', 'Neil')
  `);
  const p = await db.execute(sql`
    SELECT display_name, photo_url, bio FROM partners
    WHERE is_active = true AND display_name IN ('Jean', 'Mikha', 'John', 'Neil')
  `);

  const toMap = (rows: Record<string, unknown>[]) => {
    const m = new Map<string, RosterPerson>();
    for (const r of rows) {
      m.set(String(r.display_name), {
        name: String(r.display_name),
        photoUrl: r.photo_url === null ? null : String(r.photo_url),
        bio: r.bio === null ? null : String(r.bio),
      });
    }
    return m;
  };

  const kcMap = toMap(kc.rows as Record<string, unknown>[]);
  const pMap = toMap(p.rows as Record<string, unknown>[]);

  const required = { kickoff: ["Todd", "Mark", "Bruce", "Neil"], partner: ["Jean", "Mikha", "John", "Neil"] };
  for (const name of required.kickoff) {
    if (!kcMap.has(name)) throw new Error(`Live roster is missing active kickoff coach "${name}" — aborting.`);
  }
  for (const name of required.partner) {
    if (!pMap.has(name)) throw new Error(`Live roster is missing active partner "${name}" — aborting.`);
  }

  return {
    kickoff: {
      Todd: kcMap.get("Todd")!,
      Mark: kcMap.get("Mark")!,
      Bruce: kcMap.get("Bruce")!,
      Neil: kcMap.get("Neil")!,
    },
    partner: {
      Jean: pMap.get("Jean")!,
      Mikha: pMap.get("Mikha")!,
      John: pMap.get("John")!,
      Neil: pMap.get("Neil")!,
    },
  };
}

/** Render the pitch-block HTML for a given rank (no machineMember flag). */
async function renderPitchHtmlForRank(rank: number): Promise<string> {
  const stack = pitchStackForRank(rank, false);
  if (stack.length === 0) return "";
  const contentByKey = await getAllPitchContent();
  return stack.map((key) => renderPitchBlock(contentByKey[key])).join("");
}

// ─── job model ──────────────────────────────────────────────────────────────

interface DbTemplateJob {
  kind: "db_template";
  slug: string;
  variables: Record<string, string>;
  category?: string;
  notes: string;
}

interface OpsEmailJob {
  kind: "ops_email";
  slug: string;
  subject: string;
  text: string;
  notes: string;
}

interface BillingDigestJob {
  kind: "billing_digest";
  slug: "ops:billing_digest";
  notes: string;
}

type Job = DbTemplateJob | OpsEmailJob | BillingDigestJob;

interface ManifestEntry {
  num: string;
  slug: string;
  subject: string;
  notes: string;
  ok: boolean;
  failReason?: string;
}

// ─── image extraction ───────────────────────────────────────────────────────

function extractImgSrcs(html: string): string[] {
  const out: string[] = [];
  const re = /<img[^>]+src=["']([^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    out.push(m[1]);
  }
  return out;
}

async function checkImageUrl(url: string): Promise<{ ok: boolean; status?: number; contentType?: string; error?: string }> {
  try {
    const res = await fetch(url, { method: "GET" });
    const contentType = res.headers.get("content-type") ?? "";
    const ok = res.ok && contentType.startsWith("image/");
    return { ok, status: res.status, contentType };
  } catch (err: unknown) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ─── main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("=".repeat(72));
  console.log("  BTS Email Blast — Task #1736 (corrected re-run)");
  console.log(`  Recipient: ${RECIPIENT}`);
  console.log(`  Member:    ${MEMBER_NAME}`);
  console.log(`  Date:      ${new Date().toUTCString()}`);
  console.log("=".repeat(72));

  initSendGrid();
  await assertPortalUrlPinned();
  const roster = await loadRoster();
  console.log("[init] Live roster loaded:");
  console.log(`  kickoff: Todd(confirm) photo=${roster.kickoff.Todd.photoUrl}`);
  console.log(`           Mark(reschedule) photo=${roster.kickoff.Mark.photoUrl}`);
  console.log(`           Bruce(cancel — person block, per real call-bookings.ts behavior) photo=${roster.kickoff.Bruce.photoUrl}`);
  console.log(`           Neil(reminder, text staff_name only) photo=${roster.kickoff.Neil.photoUrl}`);
  console.log(`  partner: Jean(confirm) photo=${roster.partner.Jean.photoUrl ?? "(none — renders initials avatar)"}`);
  console.log(`           Mikha(reschedule) photo=${roster.partner.Mikha.photoUrl}`);
  console.log(`           John(cancel — person block) photo=${roster.partner.John.photoUrl}`);
  console.log(`           Neil(reminder, text staff_name only) photo=${roster.partner.Neil.photoUrl}`);

  console.log("[init] Pre-rendering pitch blocks from DB settings...");
  const pitchRank2 = await renderPitchHtmlForRank(2); // Machine + VIP (3-month member)
  console.log(`  rank-2: ${pitchRank2.length} chars (Machine + VIP)`);

  const portalUrl = (await getPortalUrl())!;
  const BASE = { member_name: MEMBER_NAME, portal_url: portalUrl };

  // Single-sourced Date values — one Date object per call event, reused for
  // BOTH the email body variables and the person-block dateTimeLabel so the
  // two can never diverge the way Task #1730's blast did.
  const kickoffConfirmAt = hoursFromNow(30);
  const kickoffReschedulePrevAt = hoursFromNow(10);
  const kickoffRescheduleNewAt = hoursFromNow(54);
  const kickoffReminderAt = hoursFromNow(24);

  const partnerConfirmAt = hoursFromNow(36);
  const partnerReschedulePrevAt = hoursFromNow(16);
  const partnerRescheduleNewAt = hoursFromNow(60);
  const partnerReminderAt = hoursFromNow(26);

  const kickoffConfirmLabel = label(kickoffConfirmAt);
  const kickoffReschedulePrevLabel = label(kickoffReschedulePrevAt);
  const kickoffRescheduleNewLabel = label(kickoffRescheduleNewAt);
  const kickoffReminderLabel = label(kickoffReminderAt);

  const partnerConfirmLabel = label(partnerConfirmAt);
  const partnerReschedulePrevLabel = label(partnerReschedulePrevAt);
  const partnerRescheduleNewLabel = label(partnerRescheduleNewAt);
  const partnerReminderLabel = label(partnerReminderAt);

  // Person blocks — each built from the SAME label object used in the body
  // variables for that same job, so body and card render the identical time.
  const KICKOFF_CONFIRM_BLOCK = renderPersonBlock({
    name: roster.kickoff.Todd.name,
    photoUrl: roster.kickoff.Todd.photoUrl,
    bio: roster.kickoff.Todd.bio,
    callTypeLabel: "Kickoff Call",
    dateTimeLabel: kickoffConfirmLabel.combined,
    portalUrl,
  });
  const KICKOFF_RESCHEDULE_BLOCK = renderPersonBlock({
    name: roster.kickoff.Mark.name,
    photoUrl: roster.kickoff.Mark.photoUrl,
    bio: roster.kickoff.Mark.bio,
    callTypeLabel: "Kickoff Call",
    dateTimeLabel: kickoffRescheduleNewLabel.combined,
    portalUrl,
  });
  // Production's call-bookings.ts builds personBlockHtml for EVERY event
  // including cancel (see forensics report) — matched here, not stripped.
  const KICKOFF_CANCEL_BLOCK = renderPersonBlock({
    name: roster.kickoff.Bruce.name,
    photoUrl: roster.kickoff.Bruce.photoUrl,
    bio: roster.kickoff.Bruce.bio,
    callTypeLabel: "Kickoff Call (cancelled)",
    dateTimeLabel: kickoffConfirmLabel.combined,
    portalUrl,
  });

  const PARTNER_CONFIRM_BLOCK = renderPersonBlock({
    name: roster.partner.Jean.name,
    photoUrl: roster.partner.Jean.photoUrl,
    bio: roster.partner.Jean.bio,
    callTypeLabel: "Partner Call",
    dateTimeLabel: partnerConfirmLabel.combined,
    portalUrl,
  });
  const PARTNER_RESCHEDULE_BLOCK = renderPersonBlock({
    name: roster.partner.Mikha.name,
    photoUrl: roster.partner.Mikha.photoUrl,
    bio: roster.partner.Mikha.bio,
    callTypeLabel: "Partner Call",
    dateTimeLabel: partnerRescheduleNewLabel.combined,
    portalUrl,
  });
  const PARTNER_CANCEL_BLOCK = renderPersonBlock({
    name: roster.partner.John.name,
    photoUrl: roster.partner.John.photoUrl,
    bio: roster.partner.John.bio,
    callTypeLabel: "Partner Call (cancelled)",
    dateTimeLabel: partnerConfirmLabel.combined,
    portalUrl,
  });

  // ── Job list (one entry per distinct email type) ─────────────────────────
  const jobs: Job[] = [
    // §1 Account / Auth
    { kind: "db_template", slug: "welcome", notes: "Transactional. No pitch/person block.", variables: { ...BASE, temp_password: "Blast@Test2026!" } },
    { kind: "db_template", slug: "email_verification", notes: "Transactional. verify_token is a blast dummy and will NOT resolve.", variables: { ...BASE, verify_token: "blast-test-verify-token-aaa111" } },
    { kind: "db_template", slug: "password_reset", notes: "Transactional. reset_token is a blast dummy and will NOT resolve.", variables: { ...BASE, reset_token: "blast-test-reset-token-bbb222" } },
    { kind: "db_template", slug: "signup_attempted", notes: "Transactional. Sign-in and reset-password links include encoded email.", variables: { ...BASE, member_email: RECIPIENT, member_email_encoded: encodeURIComponent(RECIPIENT) } },
    { kind: "db_template", slug: "new_device_signin", notes: "Transactional. Device/IP/time block.", variables: { ...BASE, device_description: "Chrome 126 on macOS Sonoma", ip_address: "98.34.112.57", sign_in_time: label(NOW).combined } },
    { kind: "db_template", slug: "password_changed", notes: "Transactional. No pitch.", variables: { ...BASE } },
    { kind: "db_template", slug: "account_locked", notes: "Transactional. Forgot-password CTA. No pitch.", variables: { ...BASE } },

    // §2 Email Change
    { kind: "db_template", slug: "email_change_verify", notes: "Transactional. Sent to NEW email. verify_token is a blast dummy.", variables: { ...BASE, old_email: "adam-old@example.com", new_email: RECIPIENT, verify_token: "blast-test-change-verify-ccc333" } },
    { kind: "db_template", slug: "email_change_notice", notes: "Transactional. Sent to OLD email address. No action link.", variables: { ...BASE, new_email: RECIPIENT } },
    { kind: "db_template", slug: "email_change_cancelled_by_admin", notes: "Transactional. Sent to CURRENT email. restart_url is a blast dummy.", variables: { ...BASE, member_email: RECIPIENT, cancelled_pending_email: "adam-pending@example.com", restart_url: `${portalUrl}/account/email-change?prefill=adam-pending%40example.com` } },
    { kind: "db_template", slug: "email_change_cancelled_by_admin_pending", notes: "Transactional. Sent to the PENDING email. No member_name.", variables: { cancelled_pending_email: "adam-pending@example.com" } },
    { kind: "db_template", slug: "email_change_cancelled_by_member", notes: "Transactional. Sent to CURRENT email. restart_url is a blast dummy.", variables: { ...BASE, member_email: RECIPIENT, cancelled_pending_email: "adam-pending@example.com", restart_url: `${portalUrl}/account/email-change?prefill=adam-pending%40example.com` } },
    { kind: "db_template", slug: "email_change_cancelled_by_member_pending", notes: "Transactional. Sent to the PENDING email. No member_name.", variables: { cancelled_pending_email: "adam-pending@example.com" } },

    // §3 Billing
    { kind: "db_template", slug: "purchase_confirmation", notes: "Transactional. Synthetic product/amount — not a real charge.", variables: { ...BASE, product_name: "BTS 3-Month Mentorship", amount: "$297.00", order_id: "BTS-BLAST-001" } },
    { kind: "db_template", slug: "payment_failed", notes: "Transactional. grace_date is the access-expiry deadline.", variables: { ...BASE, product_name: "BTS 3-Month Mentorship", amount: "$297.00", grace_date: label(hoursFromNow(9 * 24)).date } },
    { kind: "db_template", slug: "payment_recovered", notes: "Transactional. Short confirmation.", variables: { ...BASE, product_name: "BTS 3-Month Mentorship", amount: "$297.00" } },
    { kind: "db_template", slug: "payment_failed_final", notes: "Transactional. Access ended after retries.", variables: { ...BASE, product_name: "BTS 3-Month Mentorship", amount: "$297.00" } },
    { kind: "db_template", slug: "refund_processed", notes: "Transactional. Short notice — access removed.", variables: { ...BASE, product_name: "BTS 3-Month Mentorship", amount: "$297.00", order_id: "BTS-BLAST-001" } },
    { kind: "db_template", slug: "subscription_cancelled", notes: "Transactional. Access continues until end of billing period.", variables: { ...BASE, product_name: "BTS 3-Month Mentorship" } },

    // §4 Mentorship Expiry
    { kind: "db_template", slug: "mentorship_expiring_warning", notes: "Transactional. 30-day warning. Pitch: rank-2.", variables: { ...BASE, product_name: "BTS 3-Month Mentorship", expiration_date: label(hoursFromNow(30 * 24)).date, pitch_block_html: pitchRank2 } },
    { kind: "db_template", slug: "mentorship_expiring_urgent", notes: "Transactional. 7-day warning. Pitch: rank-2.", variables: { ...BASE, product_name: "BTS 3-Month Mentorship", expiration_date: label(hoursFromNow(7 * 24)).date, pitch_block_html: pitchRank2 } },
    { kind: "db_template", slug: "mentorship_expired", notes: "Transactional. Access expired. Pitch: rank-2.", variables: { ...BASE, product_name: "BTS 3-Month Mentorship", expiration_date: label(hoursFromNow(-24)).date, pitch_block_html: pitchRank2 } },

    // §5 Account Updates
    { kind: "db_template", slug: "tier_upgrade", notes: "Transactional. Celebrate upgrade.", variables: { ...BASE, product_name: "BTS Lifetime Mentorship" } },
    { kind: "db_template", slug: "role_changed", notes: "Transactional. Previous → New role block.", variables: { ...BASE, actor_name: "The BTS Team", previous_role_label: "Member", new_role_label: "Coach" } },
    { kind: "db_template", slug: "flexy_password_reset", notes: "Transactional. Login email + new password box.", variables: { ...BASE, flexy_email: RECIPIENT, flexy_password: "Temp@Blast2026!", flexy_login_url: "https://flexy.io/login" } },

    // §6 Support / Concierge
    { kind: "db_template", slug: "ticket_created", notes: "Transactional. ticket_number + ticket_subject.", variables: { ...BASE, ticket_number: "7301", ticket_subject: "Question about affiliate commission tracking" } },
    { kind: "db_template", slug: "ticket_reply", notes: "Transactional. View Reply CTA.", variables: { ...BASE, ticket_number: "7301", ticket_id: "7301" } },
    { kind: "db_template", slug: "concierge_task_created", notes: "Transactional. 24–72h SLA stated.", variables: { ...BASE, ticket_number: "CONC-4821", task_subject: "Set up ClickBank affiliate account and configure offer rotation" } },
    { kind: "db_template", slug: "compliance_review_created", notes: "Transactional. 24h SLA. Warning box.", variables: { ...BASE, ticket_number: "COMP-1144", task_subject: "Native ad creative for ClickBank gravity-50 offer (July 2026)" } },

    // §7 Kickoff Calls — real roster, single-sourced datetimes, one per type
    {
      kind: "db_template",
      slug: "kickoff_call_confirmation",
      notes: `Transactional. Person block: ${roster.kickoff.Todd.name} (real kickoff_coaches row, photo loads). Pitch: rank-2. Body + card datetime both from the same Date (${kickoffConfirmLabel.combined}).`,
      variables: { ...BASE, meeting_url: "https://meet.google.com/bts-kick-off-01", person_block_html: KICKOFF_CONFIRM_BLOCK, pitch_block_html: pitchRank2 },
    },
    {
      kind: "db_template",
      slug: "kickoff_call_reschedule",
      notes: `Transactional. Person block: ${roster.kickoff.Mark.name}. previous_datetime_label/new_datetime_label + card all single-sourced from Date objects.`,
      variables: { ...BASE, previous_datetime_label: kickoffReschedulePrevLabel.combined, new_datetime_label: kickoffRescheduleNewLabel.combined, meeting_url: "https://meet.google.com/bts-kick-off-01", person_block_html: KICKOFF_RESCHEDULE_BLOCK },
    },
    {
      kind: "db_template",
      slug: "kickoff_call_cancel",
      notes: `Transactional. Person block: ${roster.kickoff.Bruce.name} — INCLUDED because real call-bookings.ts always builds personBlockHtml for cancel too (forensics finding: the old blast's "no person block on cancel" assumption was a script bug, not production behavior).`,
      variables: { ...BASE, person_block_html: KICKOFF_CANCEL_BLOCK },
    },
    {
      kind: "db_template",
      slug: "kickoff_call_reminder",
      notes: `Marketing. staff_name = ${roster.kickoff.Neil.name} (text only — this template has no photo slot). call_date/call_time from the same Date object (${kickoffReminderLabel.combined}). Pitch: rank-2.`,
      variables: { ...BASE, staff_name: roster.kickoff.Neil.name, call_date: kickoffReminderLabel.date, call_time: kickoffReminderLabel.time, pitch_block_html: pitchRank2 },
      category: "marketing",
    },

    // §8 Partner Calls — real roster, single-sourced datetimes, one per type
    {
      kind: "db_template",
      slug: "partner_call_confirmation",
      notes: `Transactional. Person block: ${roster.partner.Jean.name} (real partners row, NULL photo -> renders initials avatar by design). Pitch: rank-2. Body + card datetime both from the same Date (${partnerConfirmLabel.combined}).`,
      variables: { ...BASE, meeting_url: "https://meet.google.com/bts-partner-01", person_block_html: PARTNER_CONFIRM_BLOCK, pitch_block_html: pitchRank2 },
    },
    {
      kind: "db_template",
      slug: "partner_call_reschedule",
      notes: `Transactional. Person block: ${roster.partner.Mikha.name} (photo loads). previous/new datetime + card all single-sourced.`,
      variables: { ...BASE, previous_datetime_label: partnerReschedulePrevLabel.combined, new_datetime_label: partnerRescheduleNewLabel.combined, meeting_url: "https://meet.google.com/bts-partner-01", person_block_html: PARTNER_RESCHEDULE_BLOCK },
    },
    {
      kind: "db_template",
      slug: "partner_call_cancel",
      notes: `Transactional. Person block: ${roster.partner.John.name} (photo loads) — matches real call-bookings.ts cancel behavior.`,
      variables: { ...BASE, person_block_html: PARTNER_CANCEL_BLOCK },
    },
    {
      kind: "db_template",
      slug: "partner_call_reminder",
      notes: `Marketing. staff_name = ${roster.partner.Neil.name} (text only). call_date/call_time from the same Date object (${partnerReminderLabel.combined}). Pitch: rank-2.`,
      variables: { ...BASE, staff_name: roster.partner.Neil.name, call_date: partnerReminderLabel.date, call_time: partnerReminderLabel.time, pitch_block_html: pitchRank2 },
      category: "marketing",
    },

    // §9 Private Coaching
    { kind: "db_template", slug: "session_feedback", notes: "Marketing. Post-session feedback request. Pitch: rank-2.", variables: { ...BASE, call_title: "Monday Morning Q&A with the BTS Team", pitch_block_html: pitchRank2 }, category: "marketing" },
    { kind: "db_template", slug: "recording_ready", notes: "Marketing. Group coaching recording. Pitch: rank-2.", variables: { ...BASE, call_title: `Monday Morning Q&A — ${label(hoursFromNow(-24)).date}`, pitch_block_html: pitchRank2 }, category: "marketing" },
    { kind: "db_template", slug: "session_recording_ready", notes: "Marketing. 1-on-1 session recording. recording_path is a blast dummy. Pitch: rank-2.", variables: { ...BASE, recording_path: "/coaching/book-session?recording=blast-test-001", pitch_block_html: pitchRank2 }, category: "marketing" },

    // §10 Marketing / Lifecycle
    { kind: "db_template", slug: "onboarding_day1", notes: "Marketing. Day-1 onboarding nudge.", variables: { ...BASE }, category: "marketing" },
    { kind: "db_template", slug: "onboarding_day3", notes: "Marketing. Day-3 nudge.", variables: { ...BASE }, category: "marketing" },
    { kind: "db_template", slug: "onboarding_day7", notes: "Marketing. Week-1 recap.", variables: { ...BASE }, category: "marketing" },
    { kind: "db_template", slug: "coaching_reminder", notes: "Marketing. 24h group-call reminder.", variables: { ...BASE, call_title: "Live Q&A: Affiliate Marketing Fundamentals", call_date: label(hoursFromNow(24)).date, call_time: label(hoursFromNow(24)).time }, category: "marketing" },
    { kind: "db_template", slug: "new_content_alert", notes: "Marketing. content_title in subject.", variables: { ...BASE, content_title: "Module 7: Advanced Traffic Scaling", content_description: "Learn how to 10× your traffic without increasing your ad spend — new strategies for Q3 2026." }, category: "marketing" },
    { kind: "db_template", slug: "streak_milestone", notes: "Marketing. streak_count in subject/body.", variables: { ...BASE, streak_count: "7" }, category: "marketing" },
    { kind: "db_template", slug: "win_of_the_week", notes: "Marketing. Multi-line wins block.", variables: { ...BASE, wins_content: "• Sarah M. hit her first $10k affiliate month\n• Jake T. got his first sale within 72 hours of joining\n• Maria R. scaled to $500/day with our traffic system" }, category: "marketing" },
    { kind: "db_template", slug: "monthly_progress", notes: "Marketing. Progress stats list.", variables: { ...BASE, month_name: "June 2026", lessons_completed: "12", calls_attended: "4", streak_count: "21" }, category: "marketing" },
    { kind: "db_template", slug: "upgrade_offer", notes: "Marketing. upgrade_product in subject.", variables: { ...BASE, upgrade_product: "BTS Lifetime Mentorship" }, category: "marketing" },
    { kind: "db_template", slug: "re_engagement", notes: "Marketing. member_name in subject.", variables: { ...BASE }, category: "marketing" },
    { kind: "db_template", slug: "community_announcement", notes: "Marketing. announcement_title/body.", variables: { ...BASE, announcement_title: "New Community Guidelines — July 2026", announcement_body: "We've updated our community guidelines to better support every member. Please take a moment to review the changes." }, category: "marketing" },
    { kind: "db_template", slug: "event_invitation", notes: "Marketing. Event details + RSVP CTA.", variables: { ...BASE, event_title: "BTS Affiliate Summit — Virtual Edition", event_date: label(hoursFromNow(37 * 24)).date, event_time: label(hoursFromNow(37 * 24)).time, event_description: "A full-day virtual summit covering the latest strategies in affiliate marketing, traffic, and scaling." }, category: "marketing" },

    // §11 Ops plain-text alerts (no images — unaffected by the asset gate)
    { kind: "billing_digest", slug: "ops:billing_digest", notes: "Ops plain-text. Runs real runBillingDigest() with live DB stats. See forensics report for the 5x-overrun finding from the #1730 run — not re-triggered here (single controlled invocation)." },
    (() => { const em = buildQueueFallbackEmailForBlast("email"); return { kind: "ops_email", slug: "ops:queue_fallback_email [FIRE]", subject: em.subject, text: em.text, notes: "Ops plain-text. Queue-fallback FIRE, email channel." } as OpsEmailJob; })(),
    (() => { const em = buildQueueFallbackEmailForBlast("sms"); return { kind: "ops_email", slug: "ops:queue_fallback_sms [FIRE]", subject: em.subject, text: em.text, notes: "Ops plain-text. Queue-fallback FIRE, SMS channel." } as OpsEmailJob; })(),
    (() => { const em = buildPartnerEscalationEmailForBlast({ alertType: "no_show", kind: "fire", now: Date.now(), memberId: 99901, memberName: "Test Member", consecutiveNoShows: 3 } as PartnerEscalationAlertPayload); return { kind: "ops_email", slug: "ops:partner_escalation_no_show [FIRE]", subject: em.subject, text: em.text, notes: "Ops plain-text. Partner no-show escalation FIRE." } as OpsEmailJob; })(),
    (() => { const em = buildPartnerEscalationEmailForBlast({ alertType: "vanish", kind: "fire", now: Date.now(), memberId: 99901, memberName: "Test Member", daysSinceLastCall: 17, thresholdDays: 14 } as PartnerEscalationAlertPayload); return { kind: "ops_email", slug: "ops:partner_escalation_vanish [FIRE]", subject: em.subject, text: em.text, notes: "Ops plain-text. Partner vanish alert FIRE." } as OpsEmailJob; })(),
    (() => { const em = buildPartnerEscalationEmailForBlast({ alertType: "capacity", kind: "fire", now: Date.now(), bookedSlots: 127, availableSlots: 153, ratioPct: 83 } as PartnerEscalationAlertPayload); return { kind: "ops_email", slug: "ops:partner_escalation_capacity [FIRE]", subject: em.subject, text: em.text, notes: "Ops plain-text. Partner capacity FIRE." } as OpsEmailJob; })(),
    (() => { const em = buildPartnerEscalationEmailForBlast({ alertType: "assignment_delay", kind: "fire", now: Date.now(), soonestIso: hoursFromNow(9 * 24).toISOString(), daysOut: 9 } as PartnerEscalationAlertPayload); return { kind: "ops_email", slug: "ops:partner_escalation_assignment_delay [FIRE]", subject: em.subject, text: em.text, notes: "Ops plain-text. Partner assignment-delay FIRE." } as OpsEmailJob; })(),
    (() => { const em = buildTicketDeskDeliveryEmailForBlast(); return { kind: "ops_email", slug: "ops:ticketdesk_delivery [FIRE]", subject: em.subject, text: em.text, notes: "Ops plain-text. TicketDesk delivery FIRE." } as OpsEmailJob; })(),
    (() => { const em = buildModerationFailureEmailForBlast(); return { kind: "ops_email", slug: "ops:moderation_failure [FIRE]", subject: em.subject, text: em.text, notes: "Ops plain-text. Moderation failure FIRE." } as OpsEmailJob; })(),
    (() => { const em = buildRetellAgentEmailForBlast(); return { kind: "ops_email", slug: "ops:retell_agent [FIRE]", subject: em.subject, text: em.text, notes: "Ops plain-text. Retell agent FIRE (status=misconfigured)." } as OpsEmailJob; })(),
    (() => { const em = buildProductionEnvGuardEmailForBlast("jwt-secret-missing"); return { kind: "ops_email", slug: "ops:production_env_guard_JWT_SECRET [FIRE]", subject: em.subject, text: em.text, notes: "Ops plain-text. Production env guard FIRE for JWT_SECRET." } as OpsEmailJob; })(),
  ];

  // ── PRE-FLIGHT PASS: capture-only render, no delivery ─────────────────────
  console.log("\n" + "=".repeat(72));
  console.log("  PRE-FLIGHT ASSET GATE (capture-only — nothing is sent yet)");
  console.log("=".repeat(72));

  const capturedHtml: string[] = [];
  const originalSend = sgMail.send.bind(sgMail);
  // Monkey-patch sgMail.send to capture the rendered html without delivering.
  // Restored to the real implementation before the real send pass below.
  (sgMail as unknown as { send: typeof sgMail.send }).send = (async (msg: unknown) => {
    const m = msg as { html?: string } | { html?: string }[];
    const list = Array.isArray(m) ? m : [m];
    for (const item of list) {
      if (item?.html) capturedHtml.push(item.html);
    }
    return [{ statusCode: 202, headers: { "x-message-id": "dry-run-not-sent" }, body: {} }, {}];
  }) as unknown as typeof sgMail.send;

  for (const job of jobs) {
    if (job.kind === "db_template") {
      try {
        await CommunicationService.sendEmailNow({ templateSlug: job.slug, to: RECIPIENT, variables: job.variables, category: job.category });
      } catch (err) {
        console.log(`  [dry-run] ${job.slug} threw during render: ${err instanceof Error ? err.message : String(err)}`);
      }
    } else if (job.kind === "ops_email") {
      capturedHtml.push(""); // no html for plain-text ops alerts
    } else if (job.kind === "billing_digest") {
      // Billing digest is plain-text (runBillingDigest sends via text field,
      // not html) — nothing to capture for the asset gate.
    }
  }

  // Restore the real sender before doing anything else.
  (sgMail as unknown as { send: typeof sgMail.send }).send = originalSend;

  const allImgSrcs = Array.from(new Set(capturedHtml.flatMap(extractImgSrcs)));
  console.log(`[preflight] Rendered ${jobs.filter((j) => j.kind === "db_template").length} DB-template emails, extracted ${allImgSrcs.length} unique <img src> URL(s).`);

  const failures: { url: string; status?: number; contentType?: string; error?: string }[] = [];
  for (const url of allImgSrcs) {
    const result = await checkImageUrl(url);
    if (result.ok) {
      console.log(`  ✓ ${url} (${result.status} ${result.contentType})`);
    } else {
      console.log(`  ✗ ${url} — ${result.error ?? `${result.status} ${result.contentType}`}`);
      failures.push({ url, ...result });
    }
  }

  if (failures.length > 0) {
    console.log("\n" + "=".repeat(72));
    console.log(`  ABORTING — ${failures.length} asset(s) failed pre-flight check. NO EMAIL WAS SENT.`);
    console.log("=".repeat(72));
    for (const f of failures) {
      console.log(`  ✗ ${f.url}: ${f.error ?? `HTTP ${f.status}, content-type ${f.contentType}`}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log(`\n[preflight] ✓ All ${allImgSrcs.length} asset(s) verified 200 + image/*. Proceeding to real send pass.`);

  // ── REAL SEND PASS ─────────────────────────────────────────────────────────
  const blastStart = new Date();
  const manifest: ManifestEntry[] = [];
  let counter = 0;
  function nextNum(): string {
    counter++;
    return String(counter).padStart(3, "0");
  }

  console.log("\n" + "=".repeat(72));
  console.log("  REAL SEND PASS");
  console.log("=".repeat(72));

  for (const job of jobs) {
    const num = nextNum();
    if (job.kind === "db_template") {
      process.stdout.write(`  ${num}. ${job.slug} ... `);
      let manifestSubject = job.slug;
      try {
        const tplRows = await db.execute(sql`SELECT subject FROM email_templates WHERE slug = ${job.slug} AND active = true LIMIT 1`);
        if (tplRows.rows.length > 0) {
          const raw = String((tplRows.rows[0] as Record<string, unknown>).subject ?? "");
          manifestSubject = raw.replace(/\{\{(\w+)\}\}/g, (_, k: string) => job.variables[k] ?? `{{${k}}}`);
        }
      } catch { /* non-fatal */ }
      try {
        const result = await CommunicationService.sendEmailNow({ templateSlug: job.slug, to: RECIPIENT, variables: job.variables, category: job.category });
        if (result.status === "sent") {
          console.log("✓");
          manifest.push({ num, slug: job.slug, subject: manifestSubject, notes: job.notes, ok: true });
        } else {
          const reason = "reason" in result ? String(result.reason) : result.status;
          console.log(`✗ ${reason}`);
          manifest.push({ num, slug: job.slug, subject: manifestSubject, notes: job.notes, ok: false, failReason: reason });
        }
      } catch (err: unknown) {
        const reason = err instanceof Error ? err.message : String(err);
        console.log(`✗ ERROR: ${reason}`);
        manifest.push({ num, slug: job.slug, subject: manifestSubject, notes: job.notes, ok: false, failReason: reason });
      }
    } else if (job.kind === "ops_email") {
      process.stdout.write(`  ${num}. ${job.slug} ... `);
      const fromEmail = defaultOpsAlertFromEmail();
      try {
        await sgMail.send({ to: RECIPIENT, from: { email: fromEmail, name: FROM_NAME }, subject: job.subject, text: job.text });
        console.log("✓");
        manifest.push({ num, slug: job.slug, subject: job.subject, notes: job.notes, ok: true });
      } catch (err: unknown) {
        const reason = err instanceof Error ? err.message : String(err);
        console.log(`✗ ERROR: ${reason}`);
        manifest.push({ num, slug: job.slug, subject: job.subject, notes: job.notes, ok: false, failReason: reason });
      }
    } else if (job.kind === "billing_digest") {
      process.stdout.write(`  ${num}. ${job.slug} ... `);
      let digestSubject = "(unknown — see digest output)";
      try {
        let capturedSubject = "";
        __setBillingDigestEmailSender(async (msg) => {
          capturedSubject = msg.subject;
          await sgMail.send({ to: RECIPIENT, from: { email: msg.from, name: FROM_NAME }, subject: msg.subject, text: msg.text });
        });
        process.env.BILLING_ALERTS_EMAIL = RECIPIENT;
        const digestResult = await runBillingDigest({ force: true });
        __setBillingDigestEmailSender(null);
        delete process.env.BILLING_ALERTS_EMAIL;

        if (digestResult.outcome === "sent") {
          digestSubject = capturedSubject || "BTS Billing Digest — Daily Summary";
          console.log("✓");
          manifest.push({ num, slug: job.slug, subject: digestSubject, notes: job.notes, ok: true });
        } else {
          const reason = `${digestResult.outcome}: ${digestResult.reason ?? ""}`;
          console.log(`✗ ${reason}`);
          manifest.push({ num, slug: job.slug, subject: digestSubject, notes: job.notes, ok: false, failReason: reason });
        }
      } catch (err: unknown) {
        __setBillingDigestEmailSender(null);
        delete process.env.BILLING_ALERTS_EMAIL;
        const reason = err instanceof Error ? err.message : String(err);
        console.log(`✗ ERROR: ${reason}`);
        manifest.push({ num, slug: job.slug, subject: digestSubject, notes: job.notes, ok: false, failReason: reason });
      }
    }
  }

  // ── CLEANUP VERIFICATION ──────────────────────────────────────────────────
  console.log("\n── Cleanup / Residue Verification ───────────────────────────────────────");
  try {
    const residue = await db.execute(sql`
      SELECT
        (SELECT count(*) FROM users WHERE email = ${RECIPIENT} AND name = 'Adam Test') AS adam_test_users,
        (SELECT count(*) FROM call_bookings cb JOIN users u ON u.id = cb.member_id WHERE u.email = ${RECIPIENT}) AS bookings_count,
        (SELECT count(*) FROM sequence_enrollments se JOIN users u ON u.id = se.user_id WHERE u.email = ${RECIPIENT}) AS enrollments_count
    `);
    const row = residue.rows[0] as Record<string, unknown>;
    console.log(`  Adam Test users (email=${RECIPIENT} AND name literally "Adam Test"): ${row.adam_test_users}`);
    console.log(`  call_bookings for ${RECIPIENT}: ${row.bookings_count}`);
    console.log(`  sequence_enrollments for ${RECIPIENT}: ${row.enrollments_count}`);
  } catch (err: unknown) {
    console.log(`  ⚠ Residue verification query failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  try {
    const logRows = await db.execute(sql`
      SELECT count(*) AS send_count FROM communication_log
      WHERE recipient_email = ${RECIPIENT} AND status = 'sent' AND created_at > ${blastStart}
    `);
    const sendCount = Number((logRows.rows[0] as Record<string, unknown>).send_count);
    const dbSent = manifest.filter((r) => r.ok && !r.slug.startsWith("ops:")).length;
    if (sendCount === dbSent) {
      console.log(`  ✓ communication_log: ${sendCount} row(s) recorded with status=sent (matches ${dbSent} DB-template sends).`);
    } else {
      console.log(`  ⚠ communication_log mismatch: ${sendCount} rows recorded vs ${dbSent} expected DB sends.`);
    }
  } catch (err: unknown) {
    console.log(`  ⚠ communication_log check failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  // ── FINAL MANIFEST ────────────────────────────────────────────────────────
  const sent = manifest.filter((r) => r.ok);
  const failed = manifest.filter((r) => !r.ok);

  console.log("\n" + "=".repeat(72));
  console.log("  BLAST MANIFEST — TASK #1736");
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

  if (failed.length > 0) {
    console.log(`\n  ⚠  ${failed.length} send(s) did not go through. See manifest above.`);
    process.exitCode = 1;
  } else {
    console.log(`\n  ✓ All ${sent.length} emails delivered successfully.`);
  }
}

main().catch((err: unknown) => {
  console.error("[blast-v2] Fatal error:", err);
  process.exit(1);
});
