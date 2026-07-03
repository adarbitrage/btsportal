/**
 * Partner dashboard (Task #1592) — roster, today's calls, per-mentee detail
 * (notes/concern flag/cadence), and mark-call-done for accountability
 * partners.
 *
 * Scoping:
 *  - `partner` role sees only their own mentees (resolved via
 *    partners.user_id = req.userId).
 *  - Admin roles with `partners:view` may view ANY partner's dashboard by
 *    passing `?partnerId=`.
 *  - Write actions (notes, cadence, mark-done) require an actual partner
 *    login — admins are read-only here even with `partners:view`.
 */

import { Router, type IRouter } from "express";
import {
  db,
  partnersTable,
  partnerAssignmentsTable,
  partnerNotesTable,
  callBookingsTable,
  usersTable,
} from "@workspace/db";
import { sql, eq, and, asc, desc } from "drizzle-orm";
import { requirePartnerOrPartnersView } from "../middleware/rbac";
import { sendError, ErrorCodes } from "../lib/api-errors";
import { resolveCurrentSectionBulk, resolveCurrentSection } from "../lib/blitz/continue-resolver";
import { BLITZ_SECTION_COUNT, BLITZ_V2_COURSE_ID_SQL_PATTERN } from "../lib/blitz/sections";
import { markPartnerCallDone } from "../lib/partner-call-completion";
import { daysSince, computeConsecutiveNoShows } from "../lib/partner-escalation-metrics";

const router: IRouter = Router();

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function completionPct(blitzCount: number): number {
  return Math.min(Math.round((blitzCount / BLITZ_SECTION_COUNT) * 100), 100);
}

function parsePositiveInt(value: unknown): number | null {
  const str = Array.isArray(value) ? value[0] : value;
  const num = parseInt(typeof str === "string" ? str : String(str ?? ""), 10);
  return Number.isInteger(num) && num > 0 ? num : null;
}

type PartnerContext = { partnerId: number };
type PartnerContextError = { status: number; code: string; message: string };

/**
 * Resolve which partner's dashboard the caller may see.
 *  - Partner login: resolved from partners.user_id (their own row only).
 *  - Admin login (partners:view): must pass ?partnerId= explicitly — there is
 *    no combined "all partners" view.
 */
async function resolvePartnerContext(
  req: { adminRole?: string; userId?: number; query: Record<string, unknown> },
): Promise<PartnerContext | PartnerContextError> {
  if (req.adminRole) {
    const partnerId = parsePositiveInt(req.query["partnerId"]);
    if (!partnerId) {
      return { status: 400, code: ErrorCodes.VALIDATION_ERROR, message: "partnerId query param is required for admin access" };
    }
    const [partner] = await db
      .select({ id: partnersTable.id })
      .from(partnersTable)
      .where(eq(partnersTable.id, partnerId))
      .limit(1);
    if (!partner) {
      return { status: 404, code: ErrorCodes.NOT_FOUND, message: "Partner not found" };
    }
    return { partnerId: partner.id };
  }

  const [partner] = await db
    .select({ id: partnersTable.id })
    .from(partnersTable)
    .where(eq(partnersTable.userId, req.userId!))
    .limit(1);
  if (!partner) {
    return { status: 404, code: ErrorCodes.NOT_FOUND, message: "No partner profile is linked to this account" };
  }
  return { partnerId: partner.id };
}

function isContextError(ctx: PartnerContext | PartnerContextError): ctx is PartnerContextError {
  return (ctx as PartnerContextError).code !== undefined;
}

// ===========================================================================
// GET /partner/dashboard/roster — active mentees for the resolved partner
// ===========================================================================

router.get(
  "/partner/dashboard/roster",
  requirePartnerOrPartnersView(),
  async (req, res): Promise<void> => {
    const ctx = await resolvePartnerContext(req);
    if (isContextError(ctx)) {
      sendError(res, ctx.status, ctx.code, ctx.message);
      return;
    }

    try {
      const assignments = await db
        .select({
          memberId: partnerAssignmentsTable.memberId,
          cadencePerWeek: partnerAssignmentsTable.cadencePerWeek,
          assignedAt: partnerAssignmentsTable.assignedAt,
          name: usersTable.name,
          email: usersTable.email,
          joinedAt: usersTable.memberSince,
        })
        .from(partnerAssignmentsTable)
        .innerJoin(usersTable, eq(usersTable.id, partnerAssignmentsTable.memberId))
        .where(
          and(
            eq(partnerAssignmentsTable.partnerId, ctx.partnerId),
            eq(partnerAssignmentsTable.status, "active"),
          ),
        )
        .orderBy(asc(usersTable.name));

      if (assignments.length === 0) {
        res.json({ mentees: [] });
        return;
      }

      const memberIds = assignments.map((a) => a.memberId);
      const idArrayLiteral = `{${memberIds.join(",")}}`;

      const [sectionMap, nextCallResult, lastCallResult, concernResult, noShowResult] = await Promise.all([
        resolveCurrentSectionBulk(memberIds),
        db.execute(sql`
          SELECT DISTINCT ON (member_id) member_id, id, scheduled_at, meeting_url
          FROM call_bookings
          WHERE staff_type = 'partner' AND staff_id = ${ctx.partnerId}
            AND status = 'booked' AND scheduled_at >= NOW()
            AND member_id = ANY(${idArrayLiteral}::int[])
          ORDER BY member_id, scheduled_at ASC
        `),
        db.execute(sql`
          SELECT DISTINCT ON (member_id) member_id, scheduled_at
          FROM call_bookings
          WHERE staff_type = 'partner' AND staff_id = ${ctx.partnerId}
            AND status = 'completed'
            AND member_id = ANY(${idArrayLiteral}::int[])
          ORDER BY member_id, scheduled_at DESC
        `),
        db.execute(sql`
          SELECT DISTINCT member_id
          FROM partner_notes
          WHERE is_concern = true AND member_id = ANY(${idArrayLiteral}::int[])
        `),
        db.execute(sql`
          SELECT member_id, status
          FROM call_bookings
          WHERE staff_type = 'partner' AND staff_id = ${ctx.partnerId}
            AND status IN ('completed', 'no_show')
            AND member_id = ANY(${idArrayLiteral}::int[])
          ORDER BY member_id, scheduled_at DESC
        `),
      ]);

      const nextCallByMember = new Map(
        (nextCallResult.rows as Array<{ member_id: number; id: number; scheduled_at: Date; meeting_url: string | null }>)
          .map((r) => [r.member_id, r]),
      );
      const lastCallByMember = new Map(
        (lastCallResult.rows as Array<{ member_id: number; scheduled_at: Date }>).map((r) => [r.member_id, r]),
      );
      const concernMemberIds = new Set(
        (concernResult.rows as Array<{ member_id: number }>).map((r) => r.member_id),
      );
      const consecutiveNoShowsByMember = computeConsecutiveNoShows(
        noShowResult.rows as Array<{ member_id: number; status: string }>,
      );

      const mentees = assignments.map((a) => {
        const current = sectionMap.get(a.memberId);
        const nextCall = nextCallByMember.get(a.memberId);
        const lastCall = lastCallByMember.get(a.memberId);
        return {
          member_id: a.memberId,
          name: a.name,
          email: a.email,
          joined_at: new Date(a.joinedAt).toISOString(),
          cadence_per_week: a.cadencePerWeek,
          assigned_at: new Date(a.assignedAt).toISOString(),
          current_section: current?.section ?? null,
          blitz_status: current?.status ?? "new",
          next_call: nextCall
            ? { id: nextCall.id, scheduled_at: new Date(nextCall.scheduled_at).toISOString(), meeting_url: nextCall.meeting_url }
            : null,
          last_completed_call_at: lastCall ? new Date(lastCall.scheduled_at).toISOString() : null,
          days_since_last_completed_call: daysSince(lastCall?.scheduled_at ?? null),
          consecutive_no_shows: consecutiveNoShowsByMember.get(a.memberId) ?? 0,
          has_concern: concernMemberIds.has(a.memberId),
        };
      });

      res.json({ mentees });
    } catch (err) {
      console.error("[PartnerDashboard] roster error:", err);
      sendError(res, 500, ErrorCodes.INTERNAL_ERROR, "Failed to load roster");
    }
  },
);

// ===========================================================================
// GET /partner/dashboard/today — today's booked calls for the resolved partner
// ===========================================================================

router.get(
  "/partner/dashboard/today",
  requirePartnerOrPartnersView(),
  async (req, res): Promise<void> => {
    const ctx = await resolvePartnerContext(req);
    if (isContextError(ctx)) {
      sendError(res, ctx.status, ctx.code, ctx.message);
      return;
    }

    try {
      const result = await db.execute(sql`
        SELECT cb.id, cb.member_id, cb.scheduled_at, cb.end_at, cb.status,
               cb.meeting_url, cb.duration_minutes,
               u.name AS member_name, u.email AS member_email
        FROM call_bookings cb
        JOIN users u ON u.id = cb.member_id
        WHERE cb.staff_type = 'partner' AND cb.staff_id = ${ctx.partnerId}
          AND cb.status IN ('booked', 'completed', 'no_show')
          AND cb.scheduled_at >= date_trunc('day', NOW())
          AND cb.scheduled_at < date_trunc('day', NOW()) + interval '1 day'
        ORDER BY cb.scheduled_at ASC
      `);

      const calls = (result.rows as Array<{
        id: number; member_id: number; scheduled_at: Date; end_at: Date; status: string;
        meeting_url: string | null; duration_minutes: number; member_name: string; member_email: string;
      }>).map((r) => ({
        id: r.id,
        member_id: r.member_id,
        member_name: r.member_name,
        member_email: r.member_email,
        scheduled_at: new Date(r.scheduled_at).toISOString(),
        end_at: new Date(r.end_at).toISOString(),
        duration_minutes: r.duration_minutes,
        meeting_url: r.meeting_url,
        status: r.status,
      }));

      res.json({ calls });
    } catch (err) {
      console.error("[PartnerDashboard] today error:", err);
      sendError(res, 500, ErrorCodes.INTERNAL_ERROR, "Failed to load today's calls");
    }
  },
);

// ===========================================================================
// GET /partner/dashboard/mentee/:memberId — full mentee detail
// ===========================================================================

router.get(
  "/partner/dashboard/mentee/:memberId",
  requirePartnerOrPartnersView(),
  async (req, res): Promise<void> => {
    const memberId = parsePositiveInt(req.params["memberId"]);
    if (!memberId) {
      sendError(res, 400, ErrorCodes.VALIDATION_ERROR, "Invalid memberId");
      return;
    }

    const ctx = await resolvePartnerContext(req);
    if (isContextError(ctx)) {
      sendError(res, ctx.status, ctx.code, ctx.message);
      return;
    }

    try {
      const [assignment] = await db
        .select({
          cadencePerWeek: partnerAssignmentsTable.cadencePerWeek,
          assignedAt: partnerAssignmentsTable.assignedAt,
          partnerId: partnerAssignmentsTable.partnerId,
        })
        .from(partnerAssignmentsTable)
        .where(
          and(
            eq(partnerAssignmentsTable.memberId, memberId),
            eq(partnerAssignmentsTable.status, "active"),
          ),
        )
        .limit(1);

      if (!assignment || assignment.partnerId !== ctx.partnerId) {
        sendError(res, 404, ErrorCodes.NOT_FOUND, "Mentee not found in this partner's roster");
        return;
      }

      const [member] = await db
        .select({
          id: usersTable.id,
          name: usersTable.name,
          email: usersTable.email,
          joinedAt: usersTable.memberSince,
        })
        .from(usersTable)
        .where(eq(usersTable.id, memberId))
        .limit(1);

      if (!member) {
        sendError(res, 404, ErrorCodes.NOT_FOUND, "Mentee not found");
        return;
      }

      const blitzCountResult = await db.execute(sql`
        SELECT count(*)::int AS blitz_count
        FROM course_progress
        WHERE user_id = ${memberId} AND course_id ~ ${BLITZ_V2_COURSE_ID_SQL_PATTERN}
      `);
      const completedCount = (blitzCountResult.rows[0] as { blitz_count: number } | undefined)?.blitz_count ?? 0;
      const continueResult = await resolveCurrentSection(memberId);

      const notesRows = await db
        .select({
          id: partnerNotesTable.id,
          body: partnerNotesTable.body,
          isConcern: partnerNotesTable.isConcern,
          createdAt: partnerNotesTable.createdAt,
          authorPartnerId: partnerNotesTable.authorPartnerId,
          authorName: partnersTable.displayName,
        })
        .from(partnerNotesTable)
        .innerJoin(partnersTable, eq(partnersTable.id, partnerNotesTable.authorPartnerId))
        .where(eq(partnerNotesTable.memberId, memberId))
        .orderBy(desc(partnerNotesTable.createdAt));

      const callRows = await db
        .select({
          id: callBookingsTable.id,
          scheduledAt: callBookingsTable.scheduledAt,
          endAt: callBookingsTable.endAt,
          status: callBookingsTable.status,
          meetingUrl: callBookingsTable.meetingUrl,
        })
        .from(callBookingsTable)
        .where(
          and(
            eq(callBookingsTable.memberId, memberId),
            eq(callBookingsTable.type, "partner"),
          ),
        )
        .orderBy(desc(callBookingsTable.scheduledAt));

      const lastCompletedCall = callRows.find((c) => c.status === "completed");
      const consecutiveNoShows = computeConsecutiveNoShows(
        callRows
          .filter((c) => c.status === "completed" || c.status === "no_show")
          .map((c) => ({ member_id: memberId, status: c.status })),
      ).get(memberId) ?? 0;

      res.json({
        member_id: member.id,
        name: member.name,
        email: member.email,
        joined_at: new Date(member.joinedAt).toISOString(),
        current_section: continueResult.section,
        blitz_status: continueResult.status,
        blitz_completion_pct: completionPct(completedCount),
        cadence_per_week: assignment.cadencePerWeek,
        assigned_at: new Date(assignment.assignedAt).toISOString(),
        last_completed_call_at: lastCompletedCall ? new Date(lastCompletedCall.scheduledAt).toISOString() : null,
        days_since_last_completed_call: daysSince(lastCompletedCall?.scheduledAt ?? null),
        consecutive_no_shows: consecutiveNoShows,
        notes: notesRows.map((n) => ({
          id: n.id,
          body: n.body,
          is_concern: n.isConcern,
          author_partner_id: n.authorPartnerId,
          author_name: n.authorName,
          created_at: new Date(n.createdAt).toISOString(),
        })),
        calls: callRows.map((c) => ({
          id: c.id,
          scheduled_at: new Date(c.scheduledAt).toISOString(),
          end_at: new Date(c.endAt).toISOString(),
          status: c.status,
          meeting_url: c.meetingUrl,
        })),
      });
    } catch (err) {
      console.error("[PartnerDashboard] mentee detail error:", err);
      sendError(res, 500, ErrorCodes.INTERNAL_ERROR, "Failed to load mentee detail");
    }
  },
);

// ===========================================================================
// POST /partner/dashboard/mentee/:memberId/notes — add a note (partner only)
// ===========================================================================

const NOTE_BODY_MAX = 4000;

router.post(
  "/partner/dashboard/mentee/:memberId/notes",
  requirePartnerOrPartnersView(),
  async (req, res): Promise<void> => {
    if (req.adminRole) {
      sendError(res, 403, ErrorCodes.FORBIDDEN, "Only the assigned partner can add notes");
      return;
    }

    const memberId = parsePositiveInt(req.params["memberId"]);
    if (!memberId) {
      sendError(res, 400, ErrorCodes.VALIDATION_ERROR, "Invalid memberId");
      return;
    }

    const body = typeof req.body?.body === "string" ? req.body.body.trim() : "";
    const isConcern = req.body?.isConcern === true;
    if (!body) {
      sendError(res, 400, ErrorCodes.VALIDATION_ERROR, "Note body is required");
      return;
    }
    if (body.length > NOTE_BODY_MAX) {
      sendError(res, 400, ErrorCodes.VALIDATION_ERROR, `Note must be ${NOTE_BODY_MAX} characters or fewer`);
      return;
    }

    const ctx = await resolvePartnerContext(req);
    if (isContextError(ctx)) {
      sendError(res, ctx.status, ctx.code, ctx.message);
      return;
    }

    try {
      const [assignment] = await db
        .select({ partnerId: partnerAssignmentsTable.partnerId })
        .from(partnerAssignmentsTable)
        .where(
          and(
            eq(partnerAssignmentsTable.memberId, memberId),
            eq(partnerAssignmentsTable.status, "active"),
          ),
        )
        .limit(1);

      if (!assignment || assignment.partnerId !== ctx.partnerId) {
        sendError(res, 404, ErrorCodes.NOT_FOUND, "Mentee not found in this partner's roster");
        return;
      }

      const [note] = await db
        .insert(partnerNotesTable)
        .values({ memberId, authorPartnerId: ctx.partnerId, body, isConcern })
        .returning();

      res.status(201).json({
        id: note.id,
        body: note.body,
        is_concern: note.isConcern,
        author_partner_id: note.authorPartnerId,
        created_at: new Date(note.createdAt).toISOString(),
      });
    } catch (err) {
      console.error("[PartnerDashboard] add note error:", err);
      sendError(res, 500, ErrorCodes.INTERNAL_ERROR, "Failed to add note");
    }
  },
);

// ===========================================================================
// PATCH /partner/dashboard/mentee/:memberId/cadence — set weekly cadence
// ===========================================================================

router.patch(
  "/partner/dashboard/mentee/:memberId/cadence",
  requirePartnerOrPartnersView(),
  async (req, res): Promise<void> => {
    if (req.adminRole) {
      sendError(res, 403, ErrorCodes.FORBIDDEN, "Only the assigned partner can set cadence");
      return;
    }

    const memberId = parsePositiveInt(req.params["memberId"]);
    if (!memberId) {
      sendError(res, 400, ErrorCodes.VALIDATION_ERROR, "Invalid memberId");
      return;
    }

    const raw = req.body?.cadencePerWeek;
    let cadencePerWeek: number | null;
    if (raw === null) {
      cadencePerWeek = null;
    } else {
      const num = parsePositiveInt(raw);
      if (!num || num > 7) {
        sendError(res, 400, ErrorCodes.VALIDATION_ERROR, "cadencePerWeek must be an integer between 1 and 7, or null");
        return;
      }
      cadencePerWeek = num;
    }

    const ctx = await resolvePartnerContext(req);
    if (isContextError(ctx)) {
      sendError(res, ctx.status, ctx.code, ctx.message);
      return;
    }

    try {
      const updated = await db
        .update(partnerAssignmentsTable)
        .set({ cadencePerWeek })
        .where(
          and(
            eq(partnerAssignmentsTable.memberId, memberId),
            eq(partnerAssignmentsTable.status, "active"),
            eq(partnerAssignmentsTable.partnerId, ctx.partnerId),
          ),
        )
        .returning({ id: partnerAssignmentsTable.id, cadencePerWeek: partnerAssignmentsTable.cadencePerWeek });

      if (updated.length === 0) {
        sendError(res, 404, ErrorCodes.NOT_FOUND, "Mentee not found in this partner's roster");
        return;
      }

      res.json({ member_id: memberId, cadence_per_week: updated[0].cadencePerWeek });
    } catch (err) {
      console.error("[PartnerDashboard] set cadence error:", err);
      sendError(res, 500, ErrorCodes.INTERNAL_ERROR, "Failed to set cadence");
    }
  },
);

// ===========================================================================
// POST /partner/dashboard/calls/:id/mark-done — flip a booked call to
// completed, advancing onboarding on the member's first completed call via
// the shared markPartnerCallDone helper (also used by the future T7 webhook).
// ===========================================================================

router.post(
  "/partner/dashboard/calls/:id/mark-done",
  requirePartnerOrPartnersView(),
  async (req, res): Promise<void> => {
    if (req.adminRole) {
      sendError(res, 403, ErrorCodes.FORBIDDEN, "Only the assigned partner can mark a call done");
      return;
    }

    const bookingId = parsePositiveInt(req.params["id"]);
    if (!bookingId) {
      sendError(res, 400, ErrorCodes.VALIDATION_ERROR, "Invalid call id");
      return;
    }

    const ctx = await resolvePartnerContext(req);
    if (isContextError(ctx)) {
      sendError(res, ctx.status, ctx.code, ctx.message);
      return;
    }

    try {
      const [booking] = await db
        .select({ id: callBookingsTable.id, staffId: callBookingsTable.staffId, staffType: callBookingsTable.staffType, status: callBookingsTable.status })
        .from(callBookingsTable)
        .where(eq(callBookingsTable.id, bookingId))
        .limit(1);

      if (!booking || booking.staffType !== "partner" || booking.staffId !== ctx.partnerId) {
        sendError(res, 404, ErrorCodes.NOT_FOUND, "Call not found in this partner's schedule");
        return;
      }

      if (booking.status !== "booked") {
        sendError(res, 409, ErrorCodes.VALIDATION_ERROR, `Call is already "${booking.status}"`);
        return;
      }

      const result = await markPartnerCallDone(bookingId);
      res.json({ id: bookingId, updated: result.updated, onboarding_advanced: result.onboardingAdvanced });
    } catch (err) {
      console.error("[PartnerDashboard] mark-done error:", err);
      sendError(res, 500, ErrorCodes.INTERNAL_ERROR, "Failed to mark call done");
    }
  },
);

export default router;
