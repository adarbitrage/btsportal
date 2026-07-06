import { Queue, Worker, type Job, type ConnectionOptions } from "bullmq";
import IORedis from "ioredis";
import {
  db,
  usersTable,
  userProductsTable,
  productsTable,
  coachingCallsTable,
  coachingCallAttendanceTable,
  sessionPackBookingsTable,
  announcementsTable,
  sequenceEnrollmentsTable,
  sequencesTable,
  callBookingsTable,
  kickoffCoachesTable,
  partnersTable,
} from "@workspace/db";
import { eq, and, lt, lte, gte, gt, isNotNull, sql } from "drizzle-orm";
import { enrollInSequence } from "./sequence-helpers";
import { checkAndRecordSend } from "./comms-dedup";
import { recordCommsDedupFailure } from "./comms-dedup-failure-tracker";
import { evaluateCommsDedupFailureAlert } from "./comms-dedup-failure-alerter";
import { CommunicationService } from "./communication-service";
import { QUEUE_REDIS_OPTIONS, makeThrottledRedisErrorLogger } from "./redis";
import { formatInMemberTimezone } from "./member-timezone";
import { renderPersonBlock } from "./seed-templates";

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
const QUEUE_NAME = "scheduled-comms";

let connection: IORedis | null = null;
let queue: Queue | null = null;
let worker: Worker | null = null;

function getConnection(): ConnectionOptions {
  if (!connection) {
    connection = new IORedis(REDIS_URL, { ...QUEUE_REDIS_OPTIONS });
    connection.on("error", makeThrottledRedisErrorLogger("[Scheduled Comms]"));
  }
  return connection as unknown as ConnectionOptions;
}

function getQueue(): Queue {
  if (!queue) {
    queue = new Queue(QUEUE_NAME, {
      connection: getConnection(),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 10000 },
        removeOnComplete: { count: 500 },
        removeOnFail: { count: 1000 },
      },
    });
  }
  return queue;
}

// Claim a send slot via the dedup store, distinguishing the three outcomes that
// matter to a scheduler: a fresh send (proceed), an already-recorded send (skip
// quietly), and a dedup-store failure. The last case is logged LOUDLY so a
// broken `comms_send_log` table surfaces as an error rather than silently
// suppressing every scheduled email. We still skip on error (rather than send
// blindly) so a transient outage can't trigger uncontrolled double-sends every
// 15 minutes — but the failure is now observable instead of swallowed.
async function reserveSend(
  sendKey: string,
  channel: string,
  context: string
): Promise<boolean> {
  const outcome = await checkAndRecordSend(sendKey, channel);
  if (outcome === "error") {
    console.error(
      `[Scheduled Comms] Dedup store unavailable while reserving "${sendKey}" (${context}); skipping this send to avoid uncontrolled double-sends. The comms_send_log dedup store appears broken — investigate, as scheduled emails are being suppressed.`
    );
    // Count the failure so the System Health / on-call alerting layer can see
    // it. A log line alone doesn't page anyone; repeated failures within the
    // scheduler run window drive `evaluateCommsDedupFailureAlert` (called at
    // the end of each run, and on the alerter's poll) over threshold so
    // on-call is paged that scheduled emails are being suppressed.
    recordCommsDedupFailure(channel, context);
    return false;
  }
  return outcome === "recorded";
}

// Coaching calls don't carry a per-call timezone, so format the reminder's
// human-readable date/time in the product's default timezone (America/New_York)
// for a stable, sensible value across every recipient's email.
const CALL_DISPLAY_TIMEZONE = "America/New_York";

function formatCallDateTime(scheduledAt: Date): { date: string; time: string } {
  const date = new Intl.DateTimeFormat("en-US", {
    timeZone: CALL_DISPLAY_TIMEZONE,
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(scheduledAt);
  const time = new Intl.DateTimeFormat("en-US", {
    timeZone: CALL_DISPLAY_TIMEZONE,
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(scheduledAt);
  return { date, time };
}

// Human-readable calendar date (no time component) for mentorship expiration
// emails, formatted in the product's default timezone for a stable value
// across every recipient.
function formatExpirationDate(expiresAt: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: CALL_DISPLAY_TIMEZONE,
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(expiresAt);
}

export async function processCoachingCallReminders(): Promise<void> {
  const now = new Date();
  const oneHourFromNow = new Date(now.getTime() + 60 * 60 * 1000);
  const twentyFourHoursFromNow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  const calls24h = await db
    .select({
      id: coachingCallsTable.id,
      title: coachingCallsTable.title,
      scheduledAt: coachingCallsTable.scheduledAt,
      requiredEntitlement: coachingCallsTable.requiredEntitlement,
    })
    .from(coachingCallsTable)
    .where(
      and(
        gt(coachingCallsTable.scheduledAt, oneHourFromNow),
        lte(coachingCallsTable.scheduledAt, twentyFourHoursFromNow)
      )
    );

  for (const call of calls24h) {
    // Email recipients are entitlement-based (same as the 1h SMS branch below)
    // but with no SMS/phone gating — every member entitled to the call gets the
    // reminder email. Email opt-out is handled separately via the unsubscribe
    // suppression list inside CommunicationService, not the coachingSmsOptIn
    // toggle (that toggle only governs the text).
    const recipients = await db
      .select({ id: usersTable.id, email: usersTable.email, name: usersTable.name })
      .from(usersTable)
      .innerJoin(userProductsTable, eq(usersTable.id, userProductsTable.userId))
      .innerJoin(productsTable, eq(userProductsTable.productId, productsTable.id))
      .where(
        and(
          eq(userProductsTable.status, "active"),
          sql`${productsTable.entitlementKeys}::text LIKE ${`%${call.requiredEntitlement}%`}`
        )
      );

    const { date: callDate, time: callTime } = formatCallDateTime(call.scheduledAt);

    const seen = new Set<number>();
    for (const member of recipients) {
      if (seen.has(member.id) || !member.email) continue;
      seen.add(member.id);

      const sendKey = `coaching_reminder_24h_email_${call.id}_${member.id}`;
      const isNew = await reserveSend(sendKey, "email", "coaching reminder 24h email");
      if (!isNew) continue;

      try {
        await CommunicationService.queueEmail({
          templateSlug: "coaching_reminder",
          to: member.email,
          variables: {
            member_name: member.name,
            call_title: call.title,
            call_date: callDate,
            call_time: callTime,
          },
          userId: member.id,
        });
      } catch (err) {
        console.error(
          `[Scheduled Comms] Failed to queue coaching reminder email for user ${member.id}, call ${call.id}:`,
          err
        );
      }
    }
  }

  const calls1h = await db
    .select({
      id: coachingCallsTable.id,
      title: coachingCallsTable.title,
      scheduledAt: coachingCallsTable.scheduledAt,
      requiredEntitlement: coachingCallsTable.requiredEntitlement,
    })
    .from(coachingCallsTable)
    .where(
      and(
        gt(coachingCallsTable.scheduledAt, now),
        lte(coachingCallsTable.scheduledAt, oneHourFromNow)
      )
    );

  for (const call of calls1h) {
    // Members eligible for a call are entitlement-based: anyone with an active
    // product whose entitlement_keys grant the call's requiredEntitlement.
    // Gate the text in the caller — queueSms only re-checks the master
    // smsOptIn, never the per-category coachingSmsOptIn — so select all three
    // (master + category + phone) here before queueing.
    const recipients = await db
      .select({ id: usersTable.id, phone: usersTable.phone })
      .from(usersTable)
      .innerJoin(userProductsTable, eq(usersTable.id, userProductsTable.userId))
      .innerJoin(productsTable, eq(userProductsTable.productId, productsTable.id))
      .where(
        and(
          eq(userProductsTable.status, "active"),
          sql`${productsTable.entitlementKeys}::text LIKE ${`%${call.requiredEntitlement}%`}`,
          eq(usersTable.smsOptIn, true),
          eq(usersTable.coachingSmsOptIn, true),
          isNotNull(usersTable.phone)
        )
      );

    const seen = new Set<number>();
    for (const member of recipients) {
      if (seen.has(member.id) || !member.phone) continue;
      seen.add(member.id);

      const sendKey = `coaching_reminder_1h_sms_${call.id}_${member.id}`;
      const isNew = await reserveSend(sendKey, "sms", "coaching reminder 1h SMS");
      if (!isNew) continue;

      try {
        await CommunicationService.queueSms({
          templateSlug: "coaching_reminder",
          to: member.phone,
          variables: { call_title: call.title },
          userId: member.id,
        });
      } catch (err) {
        console.error(
          `[Scheduled Comms] Failed to queue coaching reminder SMS for user ${member.id}, call ${call.id}:`,
          err
        );
      }
    }
  }
}

// Kickoff calls and accountability-partner calls (Task #1628) are both rows
// in `call_bookings`, discriminated by `type` ("kickoff" | "partner") and
// `staffType` ("kickoff_coach" | "partner"), which resolves against
// `staffId` polymorphically (see the comment on call-bookings.ts). Unlike
// group coaching calls, these are 1:1 bookings tied to a single member — so
// eligibility comes straight from the booking row rather than an entitlement
// query, and the reminder renders in that member's OWN timezone via
// `formatInMemberTimezone` (never `CALL_DISPLAY_TIMEZONE`, which stays
// reserved for the group coaching reminder above).
interface CallBookingStaffInfo {
  name: string;
  photoUrl: string | null;
  bio: string | null;
}

// Task #1714: enriched to also carry photo/bio so the 24h reminder (and the
// new booking confirmation/reschedule/cancel emails) can populate the
// person-block, resolved from the SAME staff source as the name — kickoff ->
// kickoff-coaches, partner -> partners.
async function resolveCallBookingStaffInfo(
  staffType: string,
  staffId: number,
): Promise<CallBookingStaffInfo> {
  if (staffType === "kickoff_coach") {
    const [row] = await db
      .select({
        name: kickoffCoachesTable.displayName,
        photoUrl: kickoffCoachesTable.photoUrl,
        bio: kickoffCoachesTable.bio,
      })
      .from(kickoffCoachesTable)
      .where(eq(kickoffCoachesTable.id, staffId))
      .limit(1);
    return {
      name: row?.name ?? "your kickoff coach",
      photoUrl: row?.photoUrl ?? null,
      bio: row?.bio ?? null,
    };
  }
  const [row] = await db
    .select({
      name: partnersTable.displayName,
      photoUrl: partnersTable.photoUrl,
      bio: partnersTable.bio,
    })
    .from(partnersTable)
    .where(eq(partnersTable.id, staffId))
    .limit(1);
  return {
    name: row?.name ?? "your accountability partner",
    photoUrl: row?.photoUrl ?? null,
    bio: row?.bio ?? null,
  };
}

const CALL_TYPE_LABELS: Record<string, string> = {
  kickoff: "Kickoff Call",
  partner: "Accountability Partner Call",
};

function callBookingTemplateSlug(type: string): string {
  return type === "kickoff" ? "kickoff_call_reminder" : "partner_call_reminder";
}

export async function processCallBookingReminders(): Promise<void> {
  const now = new Date();
  const oneHourFromNow = new Date(now.getTime() + 60 * 60 * 1000);
  const twentyFourHoursFromNow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  // --- 24h EMAIL reminders ---
  const bookings24h = await db
    .select({
      id: callBookingsTable.id,
      memberId: callBookingsTable.memberId,
      type: callBookingsTable.type,
      staffType: callBookingsTable.staffType,
      staffId: callBookingsTable.staffId,
      scheduledAt: callBookingsTable.scheduledAt,
    })
    .from(callBookingsTable)
    .where(
      and(
        eq(callBookingsTable.status, "booked"),
        gt(callBookingsTable.scheduledAt, oneHourFromNow),
        lte(callBookingsTable.scheduledAt, twentyFourHoursFromNow),
      ),
    );

  for (const booking of bookings24h) {
    const sendKey = `call_booking_reminder_24h_email_${booking.id}`;
    const isNew = await reserveSend(sendKey, "email", "call booking reminder 24h email");
    if (!isNew) continue;

    // Re-check the booking's live status right before sending: the dedup
    // reservation above is keyed on the booking id, not its status, so a
    // booking that got canceled/rescheduled between being queried above and
    // now must still be skipped rather than firing a stale reminder.
    const [fresh] = await db
      .select({ status: callBookingsTable.status })
      .from(callBookingsTable)
      .where(eq(callBookingsTable.id, booking.id))
      .limit(1);
    if (fresh?.status !== "booked") continue;

    const [member] = await db
      .select({ id: usersTable.id, email: usersTable.email, name: usersTable.name, timezone: usersTable.timezone })
      .from(usersTable)
      .where(eq(usersTable.id, booking.memberId))
      .limit(1);
    if (!member?.email) continue;

    const staffInfo = await resolveCallBookingStaffInfo(booking.staffType, booking.staffId);
    const { date: callDate, time: callTime } = formatInMemberTimezone(booking.scheduledAt, member.timezone);
    const callTypeLabel = CALL_TYPE_LABELS[booking.type] ?? "Call";
    const personBlockHtml = renderPersonBlock({
      name: staffInfo.name,
      photoUrl: staffInfo.photoUrl,
      bio: staffInfo.bio,
      callTypeLabel,
      dateTimeLabel: `${callDate} at ${callTime}`,
    });

    try {
      await CommunicationService.queueEmail({
        templateSlug: callBookingTemplateSlug(booking.type),
        to: member.email,
        variables: {
          member_name: member.name,
          staff_name: staffInfo.name,
          call_date: callDate,
          call_time: callTime,
          person_block_html: personBlockHtml,
        },
        userId: member.id,
      });
    } catch (err) {
      console.error(
        `[Scheduled Comms] Failed to queue ${booking.type} call reminder email for user ${member.id}, booking ${booking.id}:`,
        err,
      );
    }
  }

  // --- 1h SMS reminders ---
  const bookings1h = await db
    .select({
      id: callBookingsTable.id,
      memberId: callBookingsTable.memberId,
      type: callBookingsTable.type,
      staffType: callBookingsTable.staffType,
      staffId: callBookingsTable.staffId,
      scheduledAt: callBookingsTable.scheduledAt,
    })
    .from(callBookingsTable)
    .where(
      and(
        eq(callBookingsTable.status, "booked"),
        gt(callBookingsTable.scheduledAt, now),
        lte(callBookingsTable.scheduledAt, oneHourFromNow),
      ),
    );

  for (const booking of bookings1h) {
    // Gate the text in the caller — queueSms only re-checks the master
    // smsOptIn, never the per-category partnerCallSmsOptIn — so select all
    // three (master + category + phone) here before queueing. One category
    // covers both kickoff and partner variants (see schema comment).
    const [member] = await db
      .select({
        id: usersTable.id,
        phone: usersTable.phone,
        smsOptIn: usersTable.smsOptIn,
        partnerCallSmsOptIn: usersTable.partnerCallSmsOptIn,
      })
      .from(usersTable)
      .where(eq(usersTable.id, booking.memberId))
      .limit(1);
    if (!member?.phone || !member.smsOptIn || !member.partnerCallSmsOptIn) continue;

    const sendKey = `call_booking_reminder_1h_sms_${booking.id}`;
    const isNew = await reserveSend(sendKey, "sms", "call booking reminder 1h SMS");
    if (!isNew) continue;

    const [fresh] = await db
      .select({ status: callBookingsTable.status })
      .from(callBookingsTable)
      .where(eq(callBookingsTable.id, booking.id))
      .limit(1);
    if (fresh?.status !== "booked") continue;

    const staffInfo = await resolveCallBookingStaffInfo(booking.staffType, booking.staffId);

    try {
      const outcome = await CommunicationService.queueSms({
        templateSlug: callBookingTemplateSlug(booking.type),
        to: member.phone,
        variables: { staff_name: staffInfo.name },
        userId: member.id,
      });
      // CommunicationService/Twilio isn't configured in every environment —
      // degrade gracefully to email-only (the 24h email above still went
      // out) and report the degradation instead of failing the run.
      if (outcome.result === "skipped" && outcome.reason === "provider_not_configured") {
        console.warn(
          `[Scheduled Comms] SMS provider not configured — ${booking.type} call reminder for booking ${booking.id} sent email-only.`,
        );
      }
    } catch (err) {
      console.error(
        `[Scheduled Comms] Failed to queue ${booking.type} call reminder SMS for user ${member.id}, booking ${booking.id}:`,
        err,
      );
    }
  }
}

export async function processNewContentAlerts(): Promise<void> {
  // "New content" is surfaced to members as announcements. Scan announcements
  // created in the last 24h; per-member dedup (below) guarantees each member is
  // texted at most once per announcement even though this runs every 15 min.
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

  // Only "new_content" announcements drive these texts — event/milestone/general
  // posts are surfaced in-app but must not fire the new-content SMS (matches the
  // admin announcements UI copy and the contentSmsOptIn category semantics).
  const recentAnnouncements = await db
    .select({
      id: announcementsTable.id,
      title: announcementsTable.title,
      body: announcementsTable.body,
    })
    .from(announcementsTable)
    .where(
      and(
        gte(announcementsTable.createdAt, twentyFourHoursAgo),
        eq(announcementsTable.type, "new_content")
      )
    );

  if (recentAnnouncements.length === 0) return;

  // EMAIL: every member gets the new-content email regardless of SMS prefs —
  // contentSmsOptIn defaults to false, so without the email path members who
  // keep texts off would never hear about new lessons. Email opt-out is handled
  // by the unsubscribe suppression list inside CommunicationService, not the
  // contentSmsOptIn toggle. Restrict to members (role) so admins/staff aren't
  // emailed about member-facing content drops.
  const emailRecipients = await db
    .select({ id: usersTable.id, email: usersTable.email, name: usersTable.name })
    .from(usersTable)
    .where(eq(usersTable.role, "member"));

  for (const announcement of recentAnnouncements) {
    for (const member of emailRecipients) {
      if (!member.email) continue;

      const sendKey = `content_alert_email_${announcement.id}_${member.id}`;
      const isNew = await reserveSend(sendKey, "email", "new-content email");
      if (!isNew) continue;

      try {
        await CommunicationService.queueEmail({
          templateSlug: "new_content_alert",
          to: member.email,
          variables: {
            member_name: member.name,
            content_title: announcement.title,
            content_description: announcement.body,
          },
          userId: member.id,
        });
      } catch (err) {
        console.error(
          `[Scheduled Comms] Failed to queue new-content email for user ${member.id}, announcement ${announcement.id}:`,
          err
        );
      }
    }
  }

  // SMS: gated in the caller on master smsOptIn + the content category toggle +
  // phone. contentSmsOptIn defaults to false, so only members who explicitly
  // opted in receive these texts.
  const smsRecipients = await db
    .select({ id: usersTable.id, phone: usersTable.phone })
    .from(usersTable)
    .where(
      and(
        eq(usersTable.smsOptIn, true),
        eq(usersTable.contentSmsOptIn, true),
        isNotNull(usersTable.phone)
      )
    );

  if (smsRecipients.length === 0) return;

  for (const announcement of recentAnnouncements) {
    for (const member of smsRecipients) {
      if (!member.phone) continue;

      const sendKey = `content_alert_sms_${announcement.id}_${member.id}`;
      const isNew = await reserveSend(sendKey, "sms", "new-content SMS");
      if (!isNew) continue;

      try {
        await CommunicationService.queueSms({
          templateSlug: "new_content_alert",
          to: member.phone,
          variables: { content_title: announcement.title },
          userId: member.id,
        });
      } catch (err) {
        console.error(
          `[Scheduled Comms] Failed to queue new-content SMS for user ${member.id}, announcement ${announcement.id}:`,
          err
        );
      }
    }
  }
}

export async function processMentorshipExpirationWarnings(): Promise<void> {
  const now = new Date();
  const thirtyDaysFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  const expiring30d = await db
    .select({
      userId: userProductsTable.userId,
      userProductId: userProductsTable.id,
      productName: productsTable.name,
      expiresAt: userProductsTable.expiresAt,
      userEmail: usersTable.email,
      userName: usersTable.name,
    })
    .from(userProductsTable)
    .innerJoin(productsTable, eq(userProductsTable.productId, productsTable.id))
    .innerJoin(usersTable, eq(userProductsTable.userId, usersTable.id))
    .where(
      and(
        eq(userProductsTable.status, "active"),
        isNotNull(userProductsTable.expiresAt),
        gte(userProductsTable.expiresAt, now),
        lte(userProductsTable.expiresAt, thirtyDaysFromNow),
        eq(productsTable.type, "backend")
      )
    );

  for (const item of expiring30d) {
    if (!item.userEmail) continue;
    const isUrgent = item.expiresAt && item.expiresAt <= sevenDaysFromNow;
    const tier = isUrgent ? "7d" : "30d";
    const sendKey = `mentorship_expiration_${tier}_${item.userProductId}`;
    const isNew = await reserveSend(sendKey, "email", `mentorship expiration ${tier} email`);
    if (!isNew) continue;

    // The 7-day window is a strict subset of the 30-day window, so a member
    // who first received the 30d warning will later cross into the 7d window
    // and receive the urgent one too (distinct dedup keys, by design).
    const templateSlug = isUrgent ? "mentorship_expiring_urgent" : "mentorship_expiring_warning";
    try {
      await CommunicationService.queueEmail({
        templateSlug,
        to: item.userEmail,
        variables: {
          member_name: item.userName,
          product_name: item.productName,
          expiration_date: item.expiresAt ? formatExpirationDate(item.expiresAt) : "",
        },
        userId: item.userId,
      });
    } catch (err) {
      console.error(
        `[Scheduled Comms] Failed to queue ${tier} mentorship expiration email for user ${item.userId}, userProduct ${item.userProductId}:`,
        err
      );
    }
  }

  const expired = await db
    .select({
      userId: userProductsTable.userId,
      userProductId: userProductsTable.id,
      productName: productsTable.name,
      expiresAt: userProductsTable.expiresAt,
      userEmail: usersTable.email,
      userName: usersTable.name,
    })
    .from(userProductsTable)
    .innerJoin(productsTable, eq(userProductsTable.productId, productsTable.id))
    .innerJoin(usersTable, eq(userProductsTable.userId, usersTable.id))
    .where(
      and(
        eq(userProductsTable.status, "expired"),
        isNotNull(userProductsTable.expiresAt),
        gte(userProductsTable.expiresAt, new Date(now.getTime() - 24 * 60 * 60 * 1000)),
        eq(productsTable.type, "backend")
      )
    );

  for (const item of expired) {
    if (!item.userEmail) continue;
    const sendKey = `mentorship_expired_${item.userProductId}`;
    const isNew = await reserveSend(sendKey, "email", "mentorship expired email");
    if (!isNew) continue;

    try {
      await CommunicationService.queueEmail({
        templateSlug: "mentorship_expired",
        to: item.userEmail,
        variables: {
          member_name: item.userName,
          product_name: item.productName,
          expiration_date: item.expiresAt ? formatExpirationDate(item.expiresAt) : "",
        },
        userId: item.userId,
      });
    } catch (err) {
      console.error(
        `[Scheduled Comms] Failed to queue mentorship EXPIRED email for user ${item.userId}, userProduct ${item.userProductId}:`,
        err
      );
    }
  }
}

export async function processSessionFeedbackPrompts(): Promise<void> {
  const now = new Date();
  const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const twentyFiveHoursAgo = new Date(now.getTime() - 25 * 60 * 60 * 1000);

  const completedCalls = await db
    .select({
      id: coachingCallsTable.id,
      title: coachingCallsTable.title,
      scheduledAt: coachingCallsTable.scheduledAt,
      requiredEntitlement: coachingCallsTable.requiredEntitlement,
    })
    .from(coachingCallsTable)
    .where(
      and(
        lt(coachingCallsTable.scheduledAt, twentyFourHoursAgo),
        gte(coachingCallsTable.scheduledAt, twentyFiveHoursAgo),
        isNotNull(coachingCallsTable.recordingUrl)
      )
    );

  for (const call of completedCalls) {
    // Prefer per-call attendance: only members who actually registered/joined
    // the live call OR opened the recording (any attendance row) are asked for
    // feedback. If NO attendance was recorded for this call (e.g. tracking
    // wasn't wired for it), fall back to the old entitlement-based audience so
    // the prompt is never silently dropped. Email opt-out is handled by the
    // unsubscribe suppression list inside CommunicationService, not an SMS
    // toggle.
    const attendees = await db
      .select({ id: usersTable.id, email: usersTable.email, name: usersTable.name })
      .from(coachingCallAttendanceTable)
      .innerJoin(usersTable, eq(coachingCallAttendanceTable.userId, usersTable.id))
      .where(eq(coachingCallAttendanceTable.callId, call.id));

    const recipients =
      attendees.length > 0
        ? attendees
        : await db
            .select({ id: usersTable.id, email: usersTable.email, name: usersTable.name })
            .from(usersTable)
            .innerJoin(userProductsTable, eq(usersTable.id, userProductsTable.userId))
            .innerJoin(productsTable, eq(userProductsTable.productId, productsTable.id))
            .where(
              and(
                eq(userProductsTable.status, "active"),
                sql`${productsTable.entitlementKeys}::text LIKE ${`%${call.requiredEntitlement}%`}`
              )
            );

    const seen = new Set<number>();
    for (const member of recipients) {
      if (seen.has(member.id) || !member.email) continue;
      seen.add(member.id);

      // Per-member dedup key so each entitled member is prompted at most once
      // per call even as the 15-minute scheduler re-runs inside the window.
      const sendKey = `session_feedback_email_${call.id}_${member.id}`;
      const isNew = await reserveSend(sendKey, "email", "session feedback email");
      if (!isNew) continue;

      try {
        await CommunicationService.queueEmail({
          templateSlug: "session_feedback",
          to: member.email,
          variables: {
            member_name: member.name,
            call_title: call.title,
          },
          userId: member.id,
        });
      } catch (err) {
        console.error(
          `[Scheduled Comms] Failed to queue session feedback email for user ${member.id}, call ${call.id}:`,
          err
        );
      }
    }
  }
}

export async function processRecordingReadyNotifications(): Promise<void> {
  // "Your recording is ready" emails. We notify the members who REGISTERED for
  // a call (registered_at set) once its recording is available — these are the
  // people who intended to attend and most want to catch up, rather than every
  // member merely entitled to the call. Recording-only viewers are deliberately
  // excluded (they already have the recording). Per-member dedup means each
  // registrant is told at most once per call even as the 15-minute scheduler
  // re-runs.
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  // Bound to recently-finished calls so a freshly-populated table can't blast
  // the entire back-catalogue; dedup still guards against repeats within it.
  const callsWithRecording = await db
    .select({
      id: coachingCallsTable.id,
      title: coachingCallsTable.title,
    })
    .from(coachingCallsTable)
    .where(
      and(
        lt(coachingCallsTable.scheduledAt, now),
        gte(coachingCallsTable.scheduledAt, sevenDaysAgo),
        isNotNull(coachingCallsTable.recordingUrl)
      )
    );

  for (const call of callsWithRecording) {
    const recipients = await db
      .select({
        id: usersTable.id,
        email: usersTable.email,
        name: usersTable.name,
        phone: usersTable.phone,
        smsOptIn: usersTable.smsOptIn,
        coachingSmsOptIn: usersTable.coachingSmsOptIn,
      })
      .from(coachingCallAttendanceTable)
      .innerJoin(usersTable, eq(coachingCallAttendanceTable.userId, usersTable.id))
      .where(
        and(
          eq(coachingCallAttendanceTable.callId, call.id),
          isNotNull(coachingCallAttendanceTable.registeredAt)
        )
      );

    const seen = new Set<number>();
    for (const member of recipients) {
      if (seen.has(member.id) || !member.email) continue;
      seen.add(member.id);

      const sendKey = `recording_ready_email_${call.id}_${member.id}`;
      const isNew = await reserveSend(sendKey, "email", "recording-ready email");
      if (isNew) {
        try {
          await CommunicationService.queueEmail({
            templateSlug: "recording_ready",
            to: member.email,
            variables: {
              member_name: member.name,
              call_title: call.title,
            },
            userId: member.id,
          });
        } catch (err) {
          console.error(
            `[Scheduled Comms] Failed to queue recording-ready email for user ${member.id}, call ${call.id}:`,
            err
          );
        }
      }

      // Members who opted into SMS get a short text nudge in addition to the
      // email so they hear the recording is ready faster. Recording-ready is a
      // coaching notification, so it is gated on the per-category
      // coachingSmsOptIn (same category as the live-call reminder) on top of
      // the master smsOptIn — a member can silence coaching texts while still
      // receiving the email. queueSms re-checks the master smsOptIn server-side
      // but NOT the per-category flag, so this caller is the sole enforcement
      // point for the coaching category. A separate dedup key (channel "sms")
      // means the text fires at most once per call per member, independently of
      // the email, even as the 15-minute scheduler re-runs.
      if (member.smsOptIn && member.coachingSmsOptIn && member.phone) {
        const smsSendKey = `recording_ready_sms_${call.id}_${member.id}`;
        const smsIsNew = await reserveSend(smsSendKey, "sms", "recording-ready SMS");
        if (smsIsNew) {
          try {
            await CommunicationService.queueSms({
              templateSlug: "recording_ready",
              to: member.phone,
              variables: {
                call_title: call.title,
              },
              userId: member.id,
            });
          } catch (err) {
            console.error(
              `[Scheduled Comms] Failed to queue recording-ready SMS for user ${member.id}, call ${call.id}:`,
              err
            );
          }
        }
      }
    }
  }
}

export async function processSessionPackRecordingReadyNotifications(): Promise<void> {
  // "Your recording is ready" notifications for private coaching (session
  // pack) bookings. Unlike the group-call version above, each booking belongs to
  // a single member, and the link deep-links straight into THAT booking's
  // recording on /coaching/book-session (auto-opening the recording dialog)
  // instead of the generic /coaching page. We notify once the booking is
  // completed and its Drive recording has been ingested (recordingUrl set —
  // which is also the only state in which the member can see it via
  // /coaching/sessions/mine). Per-booking dedup means the member is told at most
  // once per booking even as the 15-minute scheduler re-runs.
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  // Bound on when the recording actually became AVAILABLE (recordingIngestAt),
  // not on the session date. Drive ingest of a Meet recording can land days —
  // occasionally more than a week — after the session itself; bounding on
  // scheduledAt (as the group-call version does) would silently drop those
  // late-arriving recordings and the member would never be notified. Keying the
  // window on recordingIngestAt instead means a recording ingested within the
  // last 7 days always notifies, however old the underlying session is. The
  // back-catalogue is still protected: recordingIngestAt is only set the moment
  // ingest succeeds, so first populating the column can't fire for old
  // recordings whose ingest timestamp predates the window, and per-booking
  // dedup still guards against repeats within it.
  const bookingsWithRecording = await db
    .select({
      id: sessionPackBookingsTable.id,
      memberId: usersTable.id,
      email: usersTable.email,
      name: usersTable.name,
      phone: usersTable.phone,
      smsOptIn: usersTable.smsOptIn,
      coachingSmsOptIn: usersTable.coachingSmsOptIn,
    })
    .from(sessionPackBookingsTable)
    .innerJoin(usersTable, eq(sessionPackBookingsTable.memberId, usersTable.id))
    .where(
      and(
        eq(sessionPackBookingsTable.status, "completed"),
        isNotNull(sessionPackBookingsTable.recordingUrl),
        isNotNull(sessionPackBookingsTable.recordingIngestAt),
        gte(sessionPackBookingsTable.recordingIngestAt, sevenDaysAgo)
      )
    );

  for (const booking of bookingsWithRecording) {
    if (!booking.email) continue;

    // Deep-link straight to this booking's recording. SessionBooking.tsx reads
    // the `recording` query param, locates the matching past session and opens
    // its recording dialog. recording_path is appended to {{portal_url}} in the
    // template, so it must be a portal-relative path (leading slash, no host).
    const recordingPath = `/coaching/book-session?recording=${booking.id}`;

    const sendKey = `session_pack_recording_ready_email_${booking.id}`;
    const isNew = await reserveSend(sendKey, "email", "session-pack recording-ready email");
    if (isNew) {
      try {
        await CommunicationService.queueEmail({
          templateSlug: "session_recording_ready",
          to: booking.email,
          variables: {
            member_name: booking.name,
            recording_path: recordingPath,
          },
          userId: booking.memberId,
        });
      } catch (err) {
        console.error(
          `[Scheduled Comms] Failed to queue session-pack recording-ready email for user ${booking.memberId}, booking ${booking.id}:`,
          err
        );
      }
    }

    // SMS nudge, gated identically to the group version: master smsOptIn AND the
    // per-category coachingSmsOptIn AND a phone on file. queueSms re-checks the
    // master smsOptIn server-side but NOT the per-category flag, so this caller
    // is the sole enforcement point for the coaching category. A separate dedup
    // key (channel "sms") means the text fires at most once per booking,
    // independently of the email.
    if (booking.smsOptIn && booking.coachingSmsOptIn && booking.phone) {
      const smsSendKey = `session_pack_recording_ready_sms_${booking.id}`;
      const smsIsNew = await reserveSend(smsSendKey, "sms", "session-pack recording-ready SMS");
      if (smsIsNew) {
        try {
          await CommunicationService.queueSms({
            templateSlug: "session_recording_ready",
            to: booking.phone,
            variables: {
              recording_path: recordingPath,
            },
            userId: booking.memberId,
          });
        } catch (err) {
          console.error(
            `[Scheduled Comms] Failed to queue session-pack recording-ready SMS for user ${booking.memberId}, booking ${booking.id}:`,
            err
          );
        }
      }
    }
  }
}

async function processCommissionNotifications(): Promise<void> {
  console.log("[Scheduled Comms] Commission notifications check — no commission table yet, skipping");
}

async function processScheduledComms(): Promise<void> {
  console.log("[Scheduled Comms] Running scheduled communications check");

  await processCoachingCallReminders();
  await processCallBookingReminders();
  await processNewContentAlerts();
  await processMentorshipExpirationWarnings();
  await processSessionFeedbackPrompts();
  await processRecordingReadyNotifications();
  await processSessionPackRecordingReadyNotifications();
  await processCommissionNotifications();

  // Evaluate the dedup-store failure alert at the end of every run so a run
  // that hit the "error" outcome repeatedly pages on-call immediately —
  // tying the page to the scheduler run window rather than waiting for the
  // alerter's background poll. Throttled per delivery channel, so this can't
  // spam on-call across consecutive runs. Fire-and-forget: alerting must not
  // mask or delay completion of the scheduler run, and it logs its own errors.
  evaluateCommsDedupFailureAlert().catch((err) => {
    console.error("[Scheduled Comms] dedup-store failure alerter dispatch failed:", err);
  });

  console.log("[Scheduled Comms] Scheduled communications check complete");
}

async function processInactivityCheck(): Promise<void> {
  console.log("[Inactivity Check] Running nightly inactivity check");

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const inactiveUsers = await db
    .select({
      id: usersTable.id,
      email: usersTable.email,
      lastLoginAt: usersTable.lastLoginAt,
    })
    .from(usersTable)
    .where(
      and(
        eq(usersTable.role, "member"),
        isNotNull(usersTable.lastLoginAt),
        lt(usersTable.lastLoginAt, sevenDaysAgo)
      )
    );

  let enrolledCount = 0;

  for (const user of inactiveUsers) {
    const [existingEnrollment] = await db
      .select({ id: sequenceEnrollmentsTable.id })
      .from(sequenceEnrollmentsTable)
      .innerJoin(sequencesTable, eq(sequenceEnrollmentsTable.sequenceId, sequencesTable.id))
      .where(
        and(
          eq(sequenceEnrollmentsTable.userId, user.id),
          eq(sequencesTable.slug, "reengagement"),
          eq(sequenceEnrollmentsTable.status, "active")
        )
      )
      .limit(1);

    if (!existingEnrollment) {
      const result = await enrollInSequence(user.id, "reengagement", {
        reason: "inactivity",
        lastLoginAt: user.lastLoginAt?.toISOString(),
      });
      if (result.enrolled) {
        enrolledCount++;
      }
    }
  }

  console.log(
    `[Inactivity Check] Found ${inactiveUsers.length} inactive users, enrolled ${enrolledCount} in reengagement sequence`
  );
}

export async function startScheduledComms(): Promise<void> {
  if (worker) return;

  try {
    const q = getQueue();

    await q.add("scheduled-comms", { type: "scheduled" }, {
      repeat: { every: 15 * 60 * 1000 },
      jobId: "scheduled-comms-processor",
    });

    await q.add("inactivity-check", { type: "inactivity" }, {
      repeat: {
        pattern: "0 2 * * *",
      },
      jobId: "nightly-inactivity-check",
    });

    worker = new Worker(
      QUEUE_NAME,
      async (job: Job) => {
        if (job.name === "inactivity-check") {
          await processInactivityCheck();
        } else {
          await processScheduledComms();
        }
      },
      {
        connection: getConnection(),
        concurrency: 1,
      }
    );

    worker.on("completed", (job) => {
      console.log(`[Scheduled Comms] Job ${job.id} completed: ${job.name}`);
    });

    worker.on("failed", (job, err) => {
      console.error(`[Scheduled Comms] Job ${job?.id} failed: ${err.message}`);
    });

    worker.on("error", (err) => {
      console.error("[Scheduled Comms] Worker error:", err.message);
    });

    console.log("[Scheduled Comms] Started — running every 15 minutes + nightly inactivity check at 2am");
  } catch (error) {
    console.error("[Scheduled Comms] Failed to start:", error);
  }
}

export async function shutdownScheduledComms(): Promise<void> {
  if (worker) {
    await worker.close();
    worker = null;
  }
  if (queue) {
    await queue.close();
    queue = null;
  }
  if (connection) {
    await connection.quit();
    connection = null;
  }
}
