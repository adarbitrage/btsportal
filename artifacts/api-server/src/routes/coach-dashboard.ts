/**
 * Coach dashboard — read-only endpoints for mentee progress visibility.
 *
 * All routes are gated to `coaching:view` (super_admin / admin).
 * No per-coach ownership filtering in v1 — every coach sees every mentee.
 *
 * Depends on:
 *  - lib/blitz/sections.ts         — canonical phase / section metadata
 *  - lib/blitz/continue-resolver.ts — shared current-section resolution logic
 *  - lib/blitz/activity.ts          — shared recent-activity fetcher
 *
 * When Task 2 ships its blitz_progress_events / user_daily_activity tables
 * the three lib/blitz/* modules are the only things that need updating;
 * this file's logic remains stable.
 */

import { Router, type IRouter, type Request } from "express";
import {
  db,
  sessionPackBookingsTable,
  sessionPackCoachesTable,
  usersTable,
  coachesTable,
  coachingCallsTable,
} from "@workspace/db";
import { sql, eq, and, asc, gte, desc } from "drizzle-orm";
import { requirePermission, requireCoachOrCoachingView } from "../middleware/rbac";
import { sendError, ErrorCodes } from "../lib/api-errors";
import {
  queryPackBookings,
  parseManualRecordingLinks,
  resolveManualRecordingFields,
} from "../lib/pack-bookings";
import { normalizeActionItems, syncBookingCoachingToGHL } from "../lib/coaching-notes";
import {
  BLITZ_PHASES,
  BLITZ_SECTIONS,
  BLITZ_SECTION_COUNT,
  BLITZ_SECTION_BY_COURSE_ID,
  BLITZ_V2_COURSE_ID_SQL_PATTERN,
} from "../lib/blitz/sections";

// Raw SQL fragment for the canonical v2 courseId filter, single-sourced from
// the shared curriculum package. `sql.raw` of a trusted compile-time constant
// emits byte-identical SQL to the previous inline literal.
const BLITZ_V2_COURSE_ID_FILTER = sql.raw(`'${BLITZ_V2_COURSE_ID_SQL_PATTERN}'`);
import { resolveCurrentSectionBulk, resolveCurrentSection } from "../lib/blitz/continue-resolver";
import { fetchRecentActivity } from "../lib/blitz/activity";

const router: IRouter = Router();

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type MenteeStatus = "active" | "stuck" | "dormant" | "new" | "completed";

interface MenteeBaseRow {
  id: number;
  name: string;
  email: string;
  joined_at: Date;
  last_login_at: Date | null;
  current_streak: number;
  tier: string;
  tier_name: string;
  blitz_count: number;
  last_blitz_at: Date | null;
  /** Whether the user had a blitz completion within the last 7 days. */
  had_recent_blitz: boolean;
  max_completed_section: number;
}

// ---------------------------------------------------------------------------
// Status computation
// ---------------------------------------------------------------------------

const SEVEN_DAYS_MS   = 7  * 24 * 60 * 60 * 1000;
const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;

function computeStatus(row: MenteeBaseRow): MenteeStatus {
  const now = Date.now();
  if (row.blitz_count >= BLITZ_SECTION_COUNT) return "completed";
  if (now - new Date(row.joined_at).getTime() <= SEVEN_DAYS_MS && row.blitz_count === 0) return "new";
  if (row.had_recent_blitz) return "active";
  if (row.last_login_at && now - new Date(row.last_login_at).getTime() <= FOURTEEN_DAYS_MS) return "stuck";
  return "dormant";
}

function completionPct(blitzCount: number): number {
  return Math.min(Math.round((blitzCount / BLITZ_SECTION_COUNT) * 100), 100);
}

// ---------------------------------------------------------------------------
// In-memory cache for /summary (60 s TTL)
// ---------------------------------------------------------------------------

let summaryCache: { data: object; expiresAt: number } | null = null;

// ---------------------------------------------------------------------------
// DB fetch helpers
// ---------------------------------------------------------------------------

/** Fetch all non-admin users with their aggregated blitz progress. */
async function fetchAllMenteeRows(): Promise<MenteeBaseRow[]> {
  const result = await db.execute(sql`
    WITH latest_product AS (
      SELECT DISTINCT ON (up.user_id)
        up.user_id,
        p.slug  AS product_slug,
        p.name  AS product_name
      FROM user_products up
      JOIN products p ON up.product_id = p.id
      WHERE up.status = 'active'
        AND (up.expires_at IS NULL OR up.expires_at > NOW())
      ORDER BY up.user_id, up.purchased_at DESC
    ),
    blitz_stats AS (
      SELECT
        cp.user_id,
        COUNT(*) FILTER (
          WHERE cp.course_id ~ ${BLITZ_V2_COURSE_ID_FILTER}
        )::int                                                              AS blitz_count,
        MAX(cp.completed_at) FILTER (
          WHERE cp.course_id ~ ${BLITZ_V2_COURSE_ID_FILTER}
        )                                                                   AS last_blitz_at,
        (COUNT(*) FILTER (
          WHERE cp.course_id ~ ${BLITZ_V2_COURSE_ID_FILTER}
            AND cp.completed_at > NOW() - INTERVAL '7 days'
        ) > 0)                                                              AS had_recent_blitz,
        MAX(
          CASE
            WHEN cp.course_id ~ ${BLITZ_V2_COURSE_ID_FILTER}
            THEN SUBSTRING(cp.course_id FROM '[0-9]+$')::int
            ELSE 0
          END
        )                                                                   AS max_completed_section
      FROM course_progress cp
      GROUP BY cp.user_id
    )
    SELECT
      u.id,
      u.name,
      u.email,
      u.member_since                                AS joined_at,
      u.last_login_at,
      u.current_streak,
      COALESCE(lp.product_slug, 'member')           AS tier,
      COALESCE(lp.product_name, 'Member')           AS tier_name,
      COALESCE(bs.blitz_count, 0)                   AS blitz_count,
      bs.last_blitz_at,
      COALESCE(bs.had_recent_blitz, false)          AS had_recent_blitz,
      COALESCE(bs.max_completed_section, 0)         AS max_completed_section
    FROM users u
    LEFT JOIN latest_product lp ON u.id = lp.user_id
    LEFT JOIN blitz_stats    bs ON u.id = bs.user_id
    WHERE u.role = 'member'
  `);

  return result.rows as unknown as MenteeBaseRow[];
}

// ---------------------------------------------------------------------------
// GET /api/coach/dashboard/summary
// ---------------------------------------------------------------------------

router.get(
  "/coach/dashboard/summary",
  requirePermission("coaching:view"),
  async (_req, res): Promise<void> => {
    const now = Date.now();
    if (summaryCache && summaryCache.expiresAt > now) {
      res.json(summaryCache.data);
      return;
    }

    try {
      const rows = await fetchAllMenteeRows();

      const counts: Record<MenteeStatus, number> = {
        active: 0, stuck: 0, dormant: 0, new: 0, completed: 0,
      };
      for (const r of rows) counts[computeStatus(r)]++;

      const pcts = rows.map(r => completionPct(r.blitz_count)).sort((a, b) => a - b);
      const mid = Math.floor(pcts.length / 2);
      const medianPct =
        pcts.length === 0
          ? 0
          : pcts.length % 2 === 1
            ? pcts[mid]
            : Math.round((pcts[mid - 1] + pcts[mid]) / 2);

      const data = {
        total_mentees: rows.length,
        by_status: counts,
        median_completion_pct: medianPct,
        needs_attention_count: counts.stuck,
      };

      summaryCache = { data, expiresAt: now + 60_000 };
      res.json(data);
    } catch (err) {
      console.error("[CoachDashboard] summary error:", err);
      sendError(res, 500, ErrorCodes.INTERNAL_ERROR, "Failed to load summary");
    }
  },
);

// ---------------------------------------------------------------------------
// GET /api/coach/dashboard/mentees
//
// Query params:
//   status  — filter by MenteeStatus
//   search  — name/email substring (case-insensitive)
//   sort    — last_active | completion_pct | daily_streak | joined_at
//             desc by default; prefix with - for asc (e.g. -joined_at)
//   cursor  — opaque base64url pagination cursor
//   limit   — page size, default 25, max 100
// ---------------------------------------------------------------------------

router.get(
  "/coach/dashboard/mentees",
  requirePermission("coaching:view"),
  async (req, res): Promise<void> => {
    const {
      status,
      search,
      sort = "last_active",
      cursor,
      limit: limitParam,
    } = req.query as Record<string, string | undefined>;

    const pageSize = Math.min(Math.max(parseInt(limitParam ?? "25", 10) || 25, 1), 100);

    try {
      const rows = await fetchAllMenteeRows();

      // Enrich with derived fields needed for filtering / sorting
      const enriched = rows.map(r => ({
        ...r,
        _status: computeStatus(r),
        _pct: completionPct(r.blitz_count),
      }));

      // Status filter
      let filtered = status ? enriched.filter(r => r._status === status) : enriched;

      // Search filter (name or email, case-insensitive)
      if (search) {
        const q = search.toLowerCase();
        filtered = filtered.filter(
          r => r.name.toLowerCase().includes(q) || r.email.toLowerCase().includes(q),
        );
      }

      // Sort — desc by default; leading "-" flips to asc
      const ascending = sort.startsWith("-");
      const sortKey   = ascending ? sort.slice(1) : sort;
      const dir       = ascending ? 1 : -1;

      filtered.sort((a, b) => {
        let av: number;
        let bv: number;
        switch (sortKey) {
          case "completion_pct":
            av = a._pct; bv = b._pct; break;
          case "daily_streak":
            av = a.current_streak; bv = b.current_streak; break;
          case "joined_at":
            av = new Date(a.joined_at).getTime();
            bv = new Date(b.joined_at).getTime();
            break;
          case "last_active":
          default:
            av = a.last_blitz_at ? new Date(a.last_blitz_at).getTime() : 0;
            bv = b.last_blitz_at ? new Date(b.last_blitz_at).getTime() : 0;
            break;
        }
        if (av !== bv) return (av - bv) * dir;
        return a.id - b.id; // stable tie-break
      });

      // Bulk-resolve current sections via the shared continue-resolver
      const userIds = filtered.map(r => r.id);
      const sectionMap = await resolveCurrentSectionBulk(userIds);

      // Cursor decode (opaque base64url offset)
      let offset = 0;
      if (cursor) {
        try {
          const decoded = JSON.parse(
            Buffer.from(cursor, "base64url").toString("utf8"),
          ) as { offset: number };
          offset = typeof decoded.offset === "number" ? decoded.offset : 0;
        } catch {
          // malformed cursor — start from beginning
        }
      }

      const page      = filtered.slice(offset, offset + pageSize);
      const nextOffset = offset + page.length;
      const hasMore   = nextOffset < filtered.length;
      const nextCursor = hasMore
        ? Buffer.from(JSON.stringify({ offset: nextOffset }), "utf8").toString("base64url")
        : null;

      const mentees = page.map(r => {
        const currentSection = sectionMap.get(r.id);
        return {
          user_id: r.id,
          name: r.name,
          email: r.email,
          tier: r.tier,
          tier_name: r.tier_name,
          joined_at: new Date(r.joined_at).toISOString(),
          last_active_at: r.last_blitz_at ? new Date(r.last_blitz_at).toISOString() : null,
          current_section: currentSection?.section ?? null,
          blitz_completion_pct: r._pct,
          daily_streak: r.current_streak,
          status: r._status,
        };
      });

      res.json({
        mentees,
        total: filtered.length,
        next_cursor: nextCursor,
      });
    } catch (err) {
      console.error("[CoachDashboard] mentees error:", err);
      sendError(res, 500, ErrorCodes.INTERNAL_ERROR, "Failed to load mentees");
    }
  },
);

// ---------------------------------------------------------------------------
// GET /api/coach/dashboard/mentee/:userId
// ---------------------------------------------------------------------------

router.get(
  "/coach/dashboard/mentee/:userId",
  requirePermission("coaching:view"),
  async (req, res): Promise<void> => {
    const userId = parseInt(req.params["userId"] as string, 10);
    if (isNaN(userId)) {
      sendError(res, 400, ErrorCodes.VALIDATION_ERROR, "Invalid userId");
      return;
    }

    try {
      // Fetch the base row for this specific user
      const baseResult = await db.execute(sql`
        WITH latest_product AS (
          SELECT DISTINCT ON (up.user_id)
            up.user_id,
            p.slug AS product_slug,
            p.name AS product_name
          FROM user_products up
          JOIN products p ON up.product_id = p.id
          WHERE up.status = 'active'
            AND (up.expires_at IS NULL OR up.expires_at > NOW())
          ORDER BY up.user_id, up.purchased_at DESC
        ),
        blitz_stats AS (
          SELECT
            cp.user_id,
            COUNT(*) FILTER (
              WHERE cp.course_id ~ ${BLITZ_V2_COURSE_ID_FILTER}
            )::int                                                             AS blitz_count,
            MAX(cp.completed_at) FILTER (
              WHERE cp.course_id ~ ${BLITZ_V2_COURSE_ID_FILTER}
            )                                                                  AS last_blitz_at,
            (COUNT(*) FILTER (
              WHERE cp.course_id ~ ${BLITZ_V2_COURSE_ID_FILTER}
                AND cp.completed_at > NOW() - INTERVAL '7 days'
            ) > 0)                                                             AS had_recent_blitz,
            MAX(
              CASE
                WHEN cp.course_id ~ ${BLITZ_V2_COURSE_ID_FILTER}
                THEN SUBSTRING(cp.course_id FROM '[0-9]+$')::int
                ELSE 0
              END
            )                                                                  AS max_completed_section
          FROM course_progress cp
          WHERE cp.user_id = ${userId}
          GROUP BY cp.user_id
        )
        SELECT
          u.id,
          u.name,
          u.email,
          u.member_since                              AS joined_at,
          u.last_login_at,
          u.current_streak,
          COALESCE(lp.product_slug, 'member')         AS tier,
          COALESCE(lp.product_name, 'Member')         AS tier_name,
          COALESCE(bs.blitz_count, 0)                 AS blitz_count,
          bs.last_blitz_at,
          COALESCE(bs.had_recent_blitz, false)        AS had_recent_blitz,
          COALESCE(bs.max_completed_section, 0)       AS max_completed_section
        FROM users u
        LEFT JOIN latest_product lp ON u.id = lp.user_id
        LEFT JOIN blitz_stats    bs ON u.id = bs.user_id
        WHERE u.id = ${userId}
          AND u.role = 'member'
      `);

      if (!baseResult.rows.length) {
        sendError(res, 404, ErrorCodes.NOT_FOUND, "Mentee not found");
        return;
      }

      const row = baseResult.rows[0] as unknown as MenteeBaseRow;

      // Fetch all blitz-v2 completions for section-level breakdowns
      const progressResult = await db.execute(sql`
        SELECT course_id, completed_at
        FROM course_progress
        WHERE user_id = ${userId}
          AND course_id ~ ${BLITZ_V2_COURSE_ID_FILTER}
        ORDER BY completed_at DESC
      `);

      const completions = progressResult.rows as Array<{ course_id: string; completed_at: Date }>;
      const completedSet = new Set(completions.map(c => c.course_id));

      // Resolve current section via the shared continue-resolver
      const continueResult = await resolveCurrentSection(userId, completedSet);

      // Section-by-section completion status (all 23 blitz sections)
      const section_completion = BLITZ_SECTIONS.map(s => {
        const found = completions.find(c => c.course_id === s.courseId);
        return {
          section_id: s.id,
          course_id: s.courseId,
          name: s.title,
          step: s.step,
          phase: s.phase,
          completed: completedSet.has(s.courseId),
          completed_at: found ? new Date(found.completed_at).toISOString() : null,
        };
      });

      // Per-phase completion breakdown
      const phase_breakdown = BLITZ_PHASES.map(phase => {
        const phaseSections = BLITZ_SECTIONS.filter(s => s.phase === phase.key);
        const completedCount = phaseSections.filter(s => completedSet.has(s.courseId)).length;
        return {
          key: phase.key,
          label: phase.label,
          total_sections: phaseSections.length,
          completed_sections: completedCount,
          completion_pct: phaseSections.length
            ? Math.round((completedCount / phaseSections.length) * 100)
            : 0,
        };
      });

      // Recent activity timeline via the shared activity fetcher
      const recent_events = await fetchRecentActivity(userId, 20);

      const status = computeStatus(row);
      const blitz_completion_pct = completionPct(row.blitz_count);

      res.json({
        user_id: row.id,
        name: row.name,
        email: row.email,
        tier: row.tier,
        tier_name: row.tier_name,
        joined_at: new Date(row.joined_at).toISOString(),
        last_active_at: row.last_blitz_at ? new Date(row.last_blitz_at).toISOString() : null,
        current_section: continueResult.section,
        blitz_completion_pct,
        daily_streak: row.current_streak,
        status,
        phase_breakdown,
        section_completion,
        recent_events,
      });
    } catch (err) {
      console.error("[CoachDashboard] mentee detail error:", err);
      sendError(res, 500, ErrorCodes.INTERNAL_ERROR, "Failed to load mentee detail");
    }
  },
);

// ===========================================================================
// Pack private coach surface — sessions list, member cross-coach history, and
// notes/action-item editing. Gated to coaches OR admins with coaching:view.
//
// Cross-coach visibility is intentional: every coach sees ALL prior notes and
// action items for a member, regardless of which coach authored them. Notes and
// action items are COACH/ADMIN-FACING ONLY and are never returned to members.
// ===========================================================================

function parsePositiveInt(value: unknown): number | null {
  const str = Array.isArray(value) ? value[0] : value;
  const num = parseInt(typeof str === "string" ? str : "", 10);
  return Number.isInteger(num) && num > 0 ? num : null;
}

// GET /api/coach/dashboard/pack/sessions — filtered list of pack bookings.
router.get(
  "/coach/dashboard/pack/sessions",
  requireCoachOrCoachingView(),
  async (req, res): Promise<void> => {
    try {
      const q = req.query as Record<string, string | undefined>;
      const limitRaw = parseInt(q.limit ?? "50", 10);
      const offsetRaw = parseInt(q.offset ?? "0", 10);
      const result = await queryPackBookings({
        status: q.status,
        coachId: parsePositiveInt(q.coachId) ?? undefined,
        q: q.q,
        from: q.from,
        to: q.to,
        likelyNoShow: q.likelyNoShow === "true",
        limit: Number.isInteger(limitRaw) ? limitRaw : undefined,
        offset: Number.isInteger(offsetRaw) ? offsetRaw : undefined,
      });
      res.json(result);
    } catch (err) {
      console.error("[CoachDashboard] pack sessions error:", err);
      sendError(res, 500, ErrorCodes.INTERNAL_ERROR, "Failed to load sessions");
    }
  },
);

// GET /api/coach/dashboard/pack/member/:memberId — a member's full cross-coach
// session history (all coaches, all notes + action items).
router.get(
  "/coach/dashboard/pack/member/:memberId",
  requireCoachOrCoachingView(),
  async (req, res): Promise<void> => {
    const memberId = parsePositiveInt(req.params["memberId"]);
    if (!memberId) {
      sendError(res, 400, ErrorCodes.VALIDATION_ERROR, "Invalid memberId");
      return;
    }
    try {
      const [member] = await db
        .select({ id: usersTable.id, name: usersTable.name, email: usersTable.email })
        .from(usersTable)
        .where(eq(usersTable.id, memberId));
      if (!member) {
        sendError(res, 404, ErrorCodes.NOT_FOUND, "Member not found");
        return;
      }

      const sessions = await db
        .select({
          id: sessionPackBookingsTable.id,
          coachId: sessionPackBookingsTable.coachId,
          coachName: sessionPackCoachesTable.name,
          scheduledAt: sessionPackBookingsTable.scheduledAt,
          endAt: sessionPackBookingsTable.endAt,
          durationMinutes: sessionPackBookingsTable.durationMinutes,
          status: sessionPackBookingsTable.status,
          title: sessionPackBookingsTable.title,
          coachNotes: sessionPackBookingsTable.coachNotes,
          actionItems: sessionPackBookingsTable.actionItems,
          recordingUrl: sessionPackBookingsTable.recordingUrl,
          summaryUrl: sessionPackBookingsTable.summaryUrl,
          transcriptUrl: sessionPackBookingsTable.transcriptUrl,
          recordingIngestStatus: sessionPackBookingsTable.recordingIngestStatus,
          outcomeAt: sessionPackBookingsTable.outcomeAt,
          createdAt: sessionPackBookingsTable.createdAt,
        })
        .from(sessionPackBookingsTable)
        .innerJoin(
          sessionPackCoachesTable,
          eq(sessionPackBookingsTable.coachId, sessionPackCoachesTable.id),
        )
        .where(eq(sessionPackBookingsTable.memberId, memberId))
        .orderBy(desc(sessionPackBookingsTable.scheduledAt));

      res.json({ member, sessions });
    } catch (err) {
      console.error("[CoachDashboard] pack member history error:", err);
      sendError(res, 500, ErrorCodes.INTERNAL_ERROR, "Failed to load member history");
    }
  },
);

// PATCH /api/coach/dashboard/pack/sessions/:id — update coach notes and/or
// action items for a booking; mirrors to the member's GHL contact card.
router.patch(
  "/coach/dashboard/pack/sessions/:id",
  requireCoachOrCoachingView(),
  async (req, res): Promise<void> => {
    const bookingId = parsePositiveInt(req.params["id"]);
    if (!bookingId) {
      sendError(res, 400, ErrorCodes.VALIDATION_ERROR, "Invalid booking id");
      return;
    }
    const hasNotes = typeof req.body?.coachNotes === "string";
    const hasActionItems = req.body?.actionItems !== undefined;
    if (!hasNotes && !hasActionItems) {
      sendError(res, 400, ErrorCodes.VALIDATION_ERROR, "coachNotes or actionItems is required");
      return;
    }

    const set: Partial<typeof sessionPackBookingsTable.$inferInsert> = {};
    if (hasNotes) set.coachNotes = (req.body.coachNotes as string).trim() || null;
    if (hasActionItems) set.actionItems = normalizeActionItems(req.body.actionItems);

    try {
      const updated = await db
        .update(sessionPackBookingsTable)
        .set(set)
        .where(eq(sessionPackBookingsTable.id, bookingId))
        .returning();
      if (updated.length === 0) {
        sendError(res, 404, ErrorCodes.NOT_FOUND, "Session not found");
        return;
      }
      const booking = updated[0];

      const [coach] = await db
        .select({ name: sessionPackCoachesTable.name })
        .from(sessionPackCoachesTable)
        .where(eq(sessionPackCoachesTable.id, booking.coachId));
      syncBookingCoachingToGHL({
        memberId: booking.memberId,
        coachName: coach?.name ?? null,
        scheduledAt: booking.scheduledAt,
        coachNotes: booking.coachNotes,
        actionItems: booking.actionItems,
      });

      res.json({ ok: true, booking });
    } catch (err) {
      console.error("[CoachDashboard] pack notes update error:", err);
      sendError(res, 500, ErrorCodes.INTERNAL_ERROR, "Failed to save");
    }
  },
);

// PATCH /api/coach/dashboard/pack/sessions/:id/recording — manually attach (or
// clear) the recording / summary / transcript links for a booking when
// auto-matching missed. Flips the ingest status to "manual" so the next ingest
// pass never overwrites the hand-entered links. COACH/ADMIN-FACING ONLY.
router.patch(
  "/coach/dashboard/pack/sessions/:id/recording",
  requireCoachOrCoachingView(),
  async (req, res): Promise<void> => {
    const bookingId = parsePositiveInt(req.params["id"]);
    if (!bookingId) {
      sendError(res, 400, ErrorCodes.VALIDATION_ERROR, "Invalid booking id");
      return;
    }
    const parsed = parseManualRecordingLinks(req.body);
    if ("error" in parsed) {
      sendError(res, 400, ErrorCodes.VALIDATION_ERROR, parsed.error);
      return;
    }

    try {
      const [existing] = await db
        .select({
          recordingUrl: sessionPackBookingsTable.recordingUrl,
          summaryUrl: sessionPackBookingsTable.summaryUrl,
          transcriptUrl: sessionPackBookingsTable.transcriptUrl,
        })
        .from(sessionPackBookingsTable)
        .where(eq(sessionPackBookingsTable.id, bookingId));
      if (!existing) {
        sendError(res, 404, ErrorCodes.NOT_FOUND, "Session not found");
        return;
      }

      const [booking] = await db
        .update(sessionPackBookingsTable)
        .set({
          ...parsed.links,
          ...resolveManualRecordingFields(existing, parsed.links),
          recordingIngestAt: new Date(),
        })
        .where(eq(sessionPackBookingsTable.id, bookingId))
        .returning();
      res.json({ ok: true, booking });
    } catch (err) {
      console.error("[CoachDashboard] pack recording update error:", err);
      sendError(res, 500, ErrorCodes.INTERNAL_ERROR, "Failed to save");
    }
  },
);

// ---------------------------------------------------------------------------
// Group Coaching — a coach's own upcoming weekly group-call dates, with a
// reversible per-date soft-cancel. Gated coach-OR-coaching:view (same as the
// pack coach surfaces above).
// ---------------------------------------------------------------------------

// Resolve the signed-in user to their coach record via coaches.userId (seeded
// from the roster). Returns null when the user has no coach row — e.g. an admin
// with coaching:view but no coach profile, who falls back to the all-coaches view.
async function resolveCoachIdForUser(userId: number): Promise<number | null> {
  const [coach] = await db
    .select({ id: coachesTable.id })
    .from(coachesTable)
    .where(eq(coachesTable.userId, userId))
    .limit(1);
  return coach?.id ?? null;
}

interface CoachGroupCall {
  id: number;
  title: string;
  coachId: number;
  coachName: string;
  scheduledAt: string;
  durationMinutes: number;
  registeredCount: number;
  cancelled: boolean;
  cancelledAt: string | null;
}

// Load a weekly_qa call and confirm the caller may manage it: a coach may only
// touch their OWN calls; an admin (coaching:view) may touch any. One-off call
// types are out of scope here and read back as "not found".
async function loadManageableGroupCall(
  req: Request,
  callId: number,
): Promise<
  | { ok: true; id: number }
  | { ok: false; status: number; code: string; message: string }
> {
  if (!Number.isInteger(callId)) {
    return { ok: false, status: 400, code: ErrorCodes.VALIDATION_ERROR, message: "Invalid call id" };
  }
  const [call] = await db
    .select({
      id: coachingCallsTable.id,
      coachId: coachingCallsTable.coachId,
      callType: coachingCallsTable.callType,
    })
    .from(coachingCallsTable)
    .where(eq(coachingCallsTable.id, callId))
    .limit(1);
  if (!call || call.callType !== "weekly_qa") {
    return { ok: false, status: 404, code: ErrorCodes.NOT_FOUND, message: "Group call not found" };
  }
  // Admins (coaching:view) get req.adminRole set by the middleware; coaches do not.
  if (!req.adminRole) {
    const coachId = await resolveCoachIdForUser(req.userId!);
    if (coachId === null || coachId !== call.coachId) {
      return {
        ok: false,
        status: 403,
        code: ErrorCodes.FORBIDDEN,
        message: "You can only manage your own group calls",
      };
    }
  }
  return { ok: true, id: call.id };
}

// GET /api/coach/group-calls — upcoming weekly group calls. A coach sees only
// their own; an admin with coaching:view sees every coach's. Cancelled
// occurrences are INCLUDED (flagged) so the coach can see and un-cancel them.
router.get(
  "/coach/group-calls",
  requireCoachOrCoachingView(),
  async (req, res): Promise<void> => {
    try {
      // Admins (coaching:view) manage the WHOLE schedule and must see every
      // coach's calls — even if the admin also happens to have a linked coach
      // row. So an admin is never scoped to a coachId; they always get the
      // all-coaches view with coachId reported as null. Only a plain coach is
      // scoped to their own coachId.
      const isAdmin = !!req.adminRole;
      const coachId = isAdmin ? null : await resolveCoachIdForUser(req.userId!);
      // A plain coach with no linked coach record owns no calls -> empty list.
      if (coachId === null && !isAdmin) {
        res.json({ coachId: null, calls: [] as CoachGroupCall[] });
        return;
      }

      const now = new Date();
      const filters = [
        eq(coachingCallsTable.callType, "weekly_qa"),
        gte(coachingCallsTable.scheduledAt, now),
      ];
      if (coachId !== null) filters.push(eq(coachingCallsTable.coachId, coachId));

      const rows = await db
        .select({
          id: coachingCallsTable.id,
          title: coachingCallsTable.title,
          coachId: coachingCallsTable.coachId,
          coachName: coachesTable.name,
          scheduledAt: coachingCallsTable.scheduledAt,
          durationMinutes: coachingCallsTable.durationMinutes,
          registeredCount: coachingCallsTable.registeredCount,
          cancelledAt: coachingCallsTable.cancelledAt,
        })
        .from(coachingCallsTable)
        .innerJoin(coachesTable, eq(coachingCallsTable.coachId, coachesTable.id))
        .where(and(...filters))
        .orderBy(asc(coachingCallsTable.scheduledAt));

      const calls: CoachGroupCall[] = rows.map((r) => ({
        id: r.id,
        title: r.title,
        coachId: r.coachId,
        coachName: r.coachName,
        scheduledAt: r.scheduledAt.toISOString(),
        durationMinutes: r.durationMinutes,
        registeredCount: r.registeredCount,
        cancelled: r.cancelledAt !== null,
        cancelledAt: r.cancelledAt ? r.cancelledAt.toISOString() : null,
      }));
      res.json({ coachId, calls });
    } catch (err) {
      console.error("[CoachDashboard] group-calls list error:", err);
      sendError(res, 500, ErrorCodes.INTERNAL_ERROR, "Failed to load group calls");
    }
  },
);

// POST /api/coach/group-calls/:id/cancel — soft-cancel a single occurrence
// (reversible). The row is kept, so the date stops being joinable but is never
// regenerated and can be reinstated.
router.post(
  "/coach/group-calls/:id/cancel",
  requireCoachOrCoachingView(),
  async (req, res): Promise<void> => {
    const loaded = await loadManageableGroupCall(req, Number(req.params["id"]));
    if (!loaded.ok) {
      sendError(res, loaded.status, loaded.code, loaded.message);
      return;
    }
    try {
      const [updated] = await db
        .update(coachingCallsTable)
        .set({ cancelledAt: new Date(), cancelledBy: req.userId! })
        .where(eq(coachingCallsTable.id, loaded.id))
        .returning({ id: coachingCallsTable.id, cancelledAt: coachingCallsTable.cancelledAt });
      res.json({ id: updated.id, cancelled: updated.cancelledAt !== null });
    } catch (err) {
      console.error("[CoachDashboard] group-call cancel error:", err);
      sendError(res, 500, ErrorCodes.INTERNAL_ERROR, "Failed to cancel call");
    }
  },
);

// POST /api/coach/group-calls/:id/restore — un-cancel a previously soft-cancelled
// occurrence. Idempotent: restoring an active call clears nothing and succeeds.
router.post(
  "/coach/group-calls/:id/restore",
  requireCoachOrCoachingView(),
  async (req, res): Promise<void> => {
    const loaded = await loadManageableGroupCall(req, Number(req.params["id"]));
    if (!loaded.ok) {
      sendError(res, loaded.status, loaded.code, loaded.message);
      return;
    }
    try {
      const [updated] = await db
        .update(coachingCallsTable)
        .set({ cancelledAt: null, cancelledBy: null })
        .where(eq(coachingCallsTable.id, loaded.id))
        .returning({ id: coachingCallsTable.id, cancelledAt: coachingCallsTable.cancelledAt });
      res.json({ id: updated.id, cancelled: updated.cancelledAt !== null });
    } catch (err) {
      console.error("[CoachDashboard] group-call restore error:", err);
      sendError(res, 500, ErrorCodes.INTERNAL_ERROR, "Failed to restore call");
    }
  },
);

export default router;
