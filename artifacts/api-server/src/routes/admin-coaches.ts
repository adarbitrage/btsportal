import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  coachesTable,
  coachingCallsTable,
  coachingCallTemplatesTable,
  coachAwayPeriodsTable,
} from "@workspace/db";
import { eq, asc, and, gte, count, inArray } from "drizzle-orm";
import { requirePermission } from "../middleware/rbac";
import { coachingDateString } from "../lib/coach-availability";

const router: IRouter = Router();

const AWAY_REASON_MAX = 200;

// Validate a calendar date in strict YYYY-MM-DD form. Parsing alone is too
// lenient (it accepts "2026-13-40" by rolling over), so we re-format and compare
// to reject impossible dates.
function parseAwayDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
  const d = new Date(`${trimmed}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  const roundTrip = d.toISOString().slice(0, 10);
  return roundTrip === trimmed ? trimmed : null;
}

// Field length ceilings keep the member-facing "Your Coaches" cards readable and
// guard against runaway input. These mirror the sizes the Coaching page layout
// is designed around.
const NAME_MAX = 120;
const SPECIALTIES_MAX = 200;
const BIO_MAX = 2000;
const PHOTO_URL_MAX = 2048;
const CALL_TYPE_MAX = 60;
const MAX_CALL_TYPES = 20;
const TIMEZONE_MAX = 64;

function parseId(value: unknown): number | null {
  const str = Array.isArray(value) ? value[0] : value;
  const num = parseInt(typeof str === "string" ? str : String(str ?? ""), 10);
  return Number.isInteger(num) && num > 0 ? num : null;
}

// Validate an IANA timezone string (e.g. "America/New_York"). Intl throws a
// RangeError for an unknown zone, which is the cheapest reliable check.
function isValidTimezone(tz: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

// Accept the coach photo as either an absolute http(s) URL (paste-a-URL flow) or
// an internal object-storage path produced by the upload flow (e.g.
// "/objects/uploads/<uuid>"). An empty string clears the photo (column is
// nullable). Stored values are rendered by the client, which resolves the
// internal path to a served URL.
function parsePhotoUrl(value: unknown): { url: string | null } | { error: string } {
  if (typeof value !== "string" || value.trim() === "") return { url: null };
  const trimmed = value.trim();
  if (trimmed.length > PHOTO_URL_MAX) {
    return { error: `Photo URL must be ${PHOTO_URL_MAX} characters or fewer` };
  }
  // Internal object-storage path from the photo upload flow; stored verbatim.
  if (trimmed.startsWith("/objects/")) {
    return { url: trimmed };
  }
  // App-bundled static asset shipped in the portal's public dir (e.g. the
  // seeded coach roster headshots under /coaching-photos/); stored verbatim.
  if (trimmed.startsWith("/coaching-photos/")) {
    return { url: trimmed };
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { error: "Photo URL must be a valid URL" };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { error: "Photo URL must start with http:// or https://" };
  }
  return { url: trimmed };
}

// Validate the editable profile fields shared by create + update. On PATCH
// every field is optional (admins can change one at a time), but any field that
// IS present must be valid. On create (`partial: false`) the required fields
// must be present.
function parseCoachBody(
  body: Record<string, unknown>,
  { partial }: { partial: boolean },
): { values: Record<string, unknown> } | { error: string } {
  const values: Record<string, unknown> = {};

  if (body.name !== undefined) {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) return { error: "Name is required" };
    if (name.length > NAME_MAX) {
      return { error: `Name must be ${NAME_MAX} characters or fewer` };
    }
    values.name = name;
  } else if (!partial) {
    return { error: "Name is required" };
  }

  if (body.specialties !== undefined) {
    const specialties =
      typeof body.specialties === "string" ? body.specialties.trim() : "";
    if (!specialties) return { error: "Specialty is required" };
    if (specialties.length > SPECIALTIES_MAX) {
      return { error: `Specialty must be ${SPECIALTIES_MAX} characters or fewer` };
    }
    values.specialties = specialties;
  } else if (!partial) {
    return { error: "Specialty is required" };
  }

  if (body.bio !== undefined) {
    const bio = typeof body.bio === "string" ? body.bio.trim() : "";
    if (!bio) return { error: "Bio is required" };
    if (bio.length > BIO_MAX) {
      return { error: `Bio must be ${BIO_MAX} characters or fewer` };
    }
    values.bio = bio;
  } else if (!partial) {
    return { error: "Bio is required" };
  }

  if (body.photoUrl !== undefined) {
    const photo = parsePhotoUrl(body.photoUrl);
    if ("error" in photo) return { error: photo.error };
    values.photoUrl = photo.url;
  }

  // Scheduling fields. Both have DB defaults, so they're optional even on
  // create; if supplied they must be well-formed. callTypes is a string[],
  // timezone is an IANA zone string.
  if (body.callTypes !== undefined) {
    if (!Array.isArray(body.callTypes)) {
      return { error: "Call types must be a list" };
    }
    const types: string[] = [];
    for (const item of body.callTypes) {
      const t = typeof item === "string" ? item.trim() : "";
      if (!t) continue;
      if (t.length > CALL_TYPE_MAX) {
        return { error: `Each call type must be ${CALL_TYPE_MAX} characters or fewer` };
      }
      types.push(t);
    }
    if (types.length > MAX_CALL_TYPES) {
      return { error: `A coach can have at most ${MAX_CALL_TYPES} call types` };
    }
    values.callTypes = types;
  }

  if (body.timezone !== undefined) {
    const tz = typeof body.timezone === "string" ? body.timezone.trim() : "";
    if (!tz) return { error: "Timezone is required" };
    if (tz.length > TIMEZONE_MAX) {
      return { error: `Timezone must be ${TIMEZONE_MAX} characters or fewer` };
    }
    if (!isValidTimezone(tz)) {
      return { error: "Timezone must be a valid IANA timezone (e.g. America/New_York)" };
    }
    values.timezone = tz;
  }

  // Visibility / capability switches. isActive controls whether the coach
  // appears on the member-facing "Your Coaches" grid (which lists active
  // group-call coaches); doesGroupCalls / doesPrivateCoaching express what the
  // coach actually does. Each is optional on a PATCH; any present value must be
  // a real boolean (not a truthy string) so we never silently coerce bad input.
  for (const field of ["isActive", "doesGroupCalls", "doesPrivateCoaching"] as const) {
    if (body[field] !== undefined) {
      if (typeof body[field] !== "boolean") {
        return { error: `${field} must be a boolean` };
      }
      values[field] = body[field];
    }
  }

  return { values };
}

// List every coach with the profile fields the member-facing "Your Coaches"
// grid renders, so admins can keep names, specialties, photos, and bios current
// without direct DB edits. Ordered by sortOrder (then name as a stable
// tiebreaker) so the admin list mirrors the order members see on the Coaching
// page, which also orders by sortOrder.
// The profile columns returned by every coach endpoint. Kept in one place so
// list / create / update / reorder stay in lockstep with what the editor
// renders.
const COACH_COLUMNS = {
  id: coachesTable.id,
  name: coachesTable.name,
  specialties: coachesTable.specialties,
  bio: coachesTable.bio,
  photoUrl: coachesTable.photoUrl,
  callTypes: coachesTable.callTypes,
  timezone: coachesTable.timezone,
  sortOrder: coachesTable.sortOrder,
  isActive: coachesTable.isActive,
  doesGroupCalls: coachesTable.doesGroupCalls,
  doesPrivateCoaching: coachesTable.doesPrivateCoaching,
};

router.get(
  "/admin/coaching/coaches",
  requirePermission("coaching:view"),
  async (_req: Request, res: Response): Promise<void> => {
    const coaches = await db
      .select(COACH_COLUMNS)
      .from(coachesTable)
      .orderBy(asc(coachesTable.sortOrder), asc(coachesTable.name));

    // Surface each coach's active + upcoming away periods so admins can see who
    // is (or will be) hidden from the member grid. Past periods are omitted —
    // a coach is auto-restored once endDate passes, so they're no longer
    // actionable. Grouped by coachId for the per-coach card.
    const today = coachingDateString();
    const awayRows = await db
      .select({
        id: coachAwayPeriodsTable.id,
        coachId: coachAwayPeriodsTable.coachId,
        startDate: coachAwayPeriodsTable.startDate,
        endDate: coachAwayPeriodsTable.endDate,
        reason: coachAwayPeriodsTable.reason,
      })
      .from(coachAwayPeriodsTable)
      .where(gte(coachAwayPeriodsTable.endDate, today))
      .orderBy(asc(coachAwayPeriodsTable.startDate));

    const awayByCoach = new Map<number, typeof awayRows>();
    for (const row of awayRows) {
      const list = awayByCoach.get(row.coachId);
      if (list) list.push(row);
      else awayByCoach.set(row.coachId, [row]);
    }

    const withAway = coaches.map((c) => ({
      ...c,
      awayPeriods: (awayByCoach.get(c.id) ?? []).map((p) => ({
        id: p.id,
        startDate: p.startDate,
        endDate: p.endDate,
        reason: p.reason,
        // Active right now vs. starts in the future, so the UI can label it.
        isActive: p.startDate <= today && p.endDate >= today,
      })),
    }));

    res.json({ coaches: withAway });
  },
);

// Persist the display order of coaches. The client sends the full ordered list
// of coach ids; we rewrite each coach's sortOrder to its index so the order is
// reflected immediately on the member Coaching page (which orders by sortOrder).
// Done in a transaction so a partial failure never leaves a half-applied order.
router.put(
  "/admin/coaching/coaches/order",
  requirePermission("coaching:manage"),
  async (req: Request, res: Response): Promise<void> => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const rawIds = Array.isArray(body.ids) ? body.ids : null;
    if (!rawIds || rawIds.length === 0) {
      res.status(400).json({ error: "ids must be a non-empty array" });
      return;
    }

    const ids: number[] = [];
    for (const raw of rawIds) {
      const id = parseId(raw);
      if (!id) {
        res.status(400).json({ error: "ids must be positive integers" });
        return;
      }
      ids.push(id);
    }
    if (new Set(ids).size !== ids.length) {
      res.status(400).json({ error: "ids must be unique" });
      return;
    }

    // Every id must reference an existing coach so we never silently drop a
    // reorder request that was built from stale client state.
    const existing = await db
      .select({ id: coachesTable.id })
      .from(coachesTable)
      .where(inArray(coachesTable.id, ids));
    if (existing.length !== ids.length) {
      res.status(400).json({ error: "One or more coaches no longer exist" });
      return;
    }

    await db.transaction(async (tx) => {
      for (let i = 0; i < ids.length; i++) {
        await tx
          .update(coachesTable)
          .set({ sortOrder: i })
          .where(eq(coachesTable.id, ids[i]));
      }
    });

    const coaches = await db
      .select(COACH_COLUMNS)
      .from(coachesTable)
      .orderBy(asc(coachesTable.sortOrder), asc(coachesTable.name));

    res.json({ coaches });
  },
);

// Update a coach's editable profile fields (name, specialties, bio, photoUrl).
// Changes are reflected immediately on the member Coaching page, which reads the
// same coaches table.
router.patch(
  "/admin/coaching/coaches/:id",
  requirePermission("coaching:manage"),
  async (req: Request, res: Response): Promise<void> => {
    const coachId = parseId(req.params.id);
    if (!coachId) {
      res.status(400).json({ error: "Invalid coach id" });
      return;
    }

    const parsed = parseCoachBody(req.body ?? {}, { partial: true });
    if ("error" in parsed) {
      res.status(400).json({ error: parsed.error });
      return;
    }
    if (Object.keys(parsed.values).length === 0) {
      res.status(400).json({ error: "No fields to update" });
      return;
    }

    const [updated] = await db
      .update(coachesTable)
      .set(parsed.values)
      .where(eq(coachesTable.id, coachId))
      .returning(COACH_COLUMNS);

    if (!updated) {
      res.status(404).json({ error: "Coach not found" });
      return;
    }

    res.json(updated);
  },
);

// Create a new coach. New coaches are made visible on the member Coaching page
// immediately by defaulting doesGroupCalls + isActive to true (the member
// "/coaches" endpoint lists only active group-call coaches). Scheduling fields
// (callTypes, timezone) are accepted when supplied; otherwise they fall back to
// their schema defaults.
router.post(
  "/admin/coaching/coaches",
  requirePermission("coaching:manage"),
  async (req: Request, res: Response): Promise<void> => {
    const parsed = parseCoachBody(req.body ?? {}, { partial: false });
    if ("error" in parsed) {
      res.status(400).json({ error: parsed.error });
      return;
    }

    const [created] = await db
      .insert(coachesTable)
      .values({
        ...(parsed.values as { name: string }),
        // Default to a visible group-call coach so new coaches show up on the
        // member grid immediately, but let an explicit switch override.
        doesGroupCalls:
          parsed.values.doesGroupCalls !== undefined
            ? (parsed.values.doesGroupCalls as boolean)
            : true,
        ...(parsed.values.isActive !== undefined
          ? { isActive: parsed.values.isActive as boolean }
          : { isActive: true }),
        ...(parsed.values.doesPrivateCoaching !== undefined
          ? { doesPrivateCoaching: parsed.values.doesPrivateCoaching as boolean }
          : {}),
      })
      .returning(COACH_COLUMNS);

    res.status(201).json(created);
  },
);

// Delete a coach. The coaches table is referenced by coaching_calls.coachId and
// coaching_call_templates.coachId (both NOT NULL with the default RESTRICT
// behavior), so a coach who still hosts calls or recurring schedules cannot be
// removed without orphaning those rows. We surface a clear 409 instead of a raw
// FK error, calling out upcoming calls first since that's the common case. Any
// other lingering FK reference (e.g. session-pack bookings) is caught as a 409
// fallback rather than surfacing as an unhandled 500.

// List the scheduled coaching calls that reference this coach, so when a delete
// is blocked the admin can see exactly which calls are in the way and decide to
// reassign or cancel them. Ordered soonest-first to match the schedule manager.
router.get(
  "/admin/coaching/coaches/:id/calls",
  requirePermission("coaching:view"),
  async (req: Request, res: Response): Promise<void> => {
    const coachId = parseId(req.params.id);
    if (!coachId) {
      res.status(400).json({ error: "Invalid coach id" });
      return;
    }

    const calls = await db
      .select({
        id: coachingCallsTable.id,
        title: coachingCallsTable.title,
        callType: coachingCallsTable.callType,
        scheduledAt: coachingCallsTable.scheduledAt,
        durationMinutes: coachingCallsTable.durationMinutes,
        registeredCount: coachingCallsTable.registeredCount,
      })
      .from(coachingCallsTable)
      .where(eq(coachingCallsTable.coachId, coachId))
      .orderBy(asc(coachingCallsTable.scheduledAt));

    res.json({ calls });
  },
);

// Bulk-reassign every coaching call currently assigned to this coach over to a
// different coach. This is the in-app path that lets an admin clear the FK
// references blocking a delete without touching the database directly. Done in a
// single UPDATE so a partial failure never leaves the calls split across two
// coaches.
router.post(
  "/admin/coaching/coaches/:id/reassign-calls",
  requirePermission("coaching:manage"),
  async (req: Request, res: Response): Promise<void> => {
    const fromCoachId = parseId(req.params.id);
    if (!fromCoachId) {
      res.status(400).json({ error: "Invalid coach id" });
      return;
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const toCoachId = parseId(body.toCoachId);
    if (!toCoachId) {
      res.status(400).json({ error: "A valid destination coach is required" });
      return;
    }
    if (toCoachId === fromCoachId) {
      res.status(400).json({ error: "Choose a different coach to reassign to" });
      return;
    }

    // The destination coach must exist so we never reassign calls to a phantom
    // coach id built from stale client state.
    const [destination] = await db
      .select({ id: coachesTable.id })
      .from(coachesTable)
      .where(eq(coachesTable.id, toCoachId));
    if (!destination) {
      res.status(400).json({ error: "Destination coach does not exist" });
      return;
    }

    const reassigned = await db
      .update(coachingCallsTable)
      .set({ coachId: toCoachId })
      .where(eq(coachingCallsTable.coachId, fromCoachId))
      .returning({ id: coachingCallsTable.id });

    res.json({ reassigned: reassigned.length });
  },
);

// Bulk-cancel (delete) every coaching call currently assigned to this coach.
// The other path to clearing the FK references blocking a delete: an admin who
// no longer wants these calls at all. Any remaining FK reference on a call
// (e.g. attendance rows) surfaces as a 409 rather than an unhandled 500.
router.post(
  "/admin/coaching/coaches/:id/cancel-calls",
  requirePermission("coaching:manage"),
  async (req: Request, res: Response): Promise<void> => {
    const coachId = parseId(req.params.id);
    if (!coachId) {
      res.status(400).json({ error: "Invalid coach id" });
      return;
    }

    try {
      const cancelled = await db
        .delete(coachingCallsTable)
        .where(eq(coachingCallsTable.coachId, coachId))
        .returning({ id: coachingCallsTable.id });

      res.json({ cancelled: cancelled.length });
    } catch (err) {
      // 23503 = foreign_key_violation. A call still has dependent rows (e.g.
      // attendance) that must be cleared first.
      if (
        err &&
        typeof err === "object" &&
        "code" in err &&
        (err as { code?: string }).code === "23503"
      ) {
        res.status(409).json({
          error:
            "One or more of this coach's calls have attendance records and cannot be cancelled here. Reassign them to another coach instead.",
        });
        return;
      }
      throw err;
    }
  },
);

// Remove a coach from the roster. Guard against deleting a coach who is still
// referenced by scheduled coaching calls (coaching_calls.coachId is a NOT NULL
// FK): deleting would orphan those rows / violate the constraint, so we block
// with a clear message and a count. Any other lingering FK reference
// (templates, bookings) surfaces as a 409 too rather than an unhandled 500.
router.delete(
  "/admin/coaching/coaches/:id",
  requirePermission("coaching:manage"),
  async (req: Request, res: Response): Promise<void> => {
    const coachId = parseId(req.params.id);
    if (!coachId) {
      res.status(400).json({ error: "Invalid coach id" });
      return;
    }

    const [existing] = await db
      .select({ id: coachesTable.id })
      .from(coachesTable)
      .where(eq(coachesTable.id, coachId));
    if (!existing) {
      res.status(404).json({ error: "Coach not found" });
      return;
    }

    const now = new Date();
    const [{ value: upcomingCount }] = await db
      .select({ value: count() })
      .from(coachingCallsTable)
      .where(
        and(
          eq(coachingCallsTable.coachId, coachId),
          gte(coachingCallsTable.scheduledAt, now),
        ),
      );
    if (upcomingCount > 0) {
      res.status(409).json({
        error: `Cannot delete: this coach is assigned to ${upcomingCount} upcoming coaching call${upcomingCount === 1 ? "" : "s"}. Reassign or remove ${upcomingCount === 1 ? "it" : "them"} first.`,
      });
      return;
    }

    const [{ value: templateCount }] = await db
      .select({ value: count() })
      .from(coachingCallTemplatesTable)
      .where(eq(coachingCallTemplatesTable.coachId, coachId));
    if (templateCount > 0) {
      res.status(409).json({
        error: `Cannot delete: this coach is assigned to ${templateCount} recurring schedule${templateCount === 1 ? "" : "s"}. Remove ${templateCount === 1 ? "it" : "them"} first.`,
      });
      return;
    }

    const [{ value: pastCount }] = await db
      .select({ value: count() })
      .from(coachingCallsTable)
      .where(eq(coachingCallsTable.coachId, coachId));
    if (pastCount > 0) {
      res.status(409).json({
        error: `Cannot delete: this coach is referenced by ${pastCount} past coaching call${pastCount === 1 ? "" : "s"} and must be kept for history.`,
      });
      return;
    }

    try {
      await db.delete(coachesTable).where(eq(coachesTable.id, coachId));
      res.json({ ok: true });
    } catch (err) {
      // 23503 = foreign_key_violation. Another table not checked above (e.g.
      // session-pack bookings) still references this coach; surface a 409
      // rather than an unhandled 500.
      if (
        err &&
        typeof err === "object" &&
        "code" in err &&
        (err as { code?: string }).code === "23503"
      ) {
        res.status(409).json({
          error:
            "This coach is still referenced by other coaching records (like scheduled calls or templates) and cannot be deleted.",
        });
        return;
      }
      throw err;
    }
  },
);

// --- Away periods -----------------------------------------------------------
// Let a coach (or an admin on their behalf) mark a date range as "away". While
// today falls inside an away period the coach is hidden from the member "Your
// Coaches" grid and is not bookable for private coaching (see
// lib/coach-availability.ts), then auto-restored once the period ends.

// Add an away period for a coach. Body: { startDate, endDate, reason? } where
// the dates are YYYY-MM-DD (inclusive). endDate must be >= startDate. Past
// ranges are rejected — an away period that already ended can't hide anyone, so
// it's almost always a typo; the end must be today or later.
router.post(
  "/admin/coaching/coaches/:id/away",
  requirePermission("coaching:manage"),
  async (req: Request, res: Response): Promise<void> => {
    const coachId = parseId(req.params.id);
    if (!coachId) {
      res.status(400).json({ error: "Invalid coach id" });
      return;
    }

    const [existing] = await db
      .select({ id: coachesTable.id })
      .from(coachesTable)
      .where(eq(coachesTable.id, coachId));
    if (!existing) {
      res.status(404).json({ error: "Coach not found" });
      return;
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const startDate = parseAwayDate(body.startDate);
    const endDate = parseAwayDate(body.endDate);
    if (!startDate) {
      res.status(400).json({ error: "A valid start date (YYYY-MM-DD) is required" });
      return;
    }
    if (!endDate) {
      res.status(400).json({ error: "A valid end date (YYYY-MM-DD) is required" });
      return;
    }
    if (endDate < startDate) {
      res.status(400).json({ error: "End date must be on or after the start date" });
      return;
    }
    if (endDate < coachingDateString()) {
      res.status(400).json({ error: "End date cannot be in the past" });
      return;
    }

    let reason: string | null = null;
    if (body.reason !== undefined && body.reason !== null) {
      if (typeof body.reason !== "string") {
        res.status(400).json({ error: "Reason must be text" });
        return;
      }
      const trimmed = body.reason.trim();
      if (trimmed.length > AWAY_REASON_MAX) {
        res.status(400).json({ error: `Reason must be ${AWAY_REASON_MAX} characters or fewer` });
        return;
      }
      reason = trimmed || null;
    }

    const [created] = await db
      .insert(coachAwayPeriodsTable)
      .values({ coachId, startDate, endDate, reason })
      .returning({
        id: coachAwayPeriodsTable.id,
        startDate: coachAwayPeriodsTable.startDate,
        endDate: coachAwayPeriodsTable.endDate,
        reason: coachAwayPeriodsTable.reason,
      });

    const today = coachingDateString();
    res.status(201).json({
      ...created,
      isActive: created.startDate <= today && created.endDate >= today,
    });
  },
);

// Remove an away period (cancel a planned absence or end one early). The coach
// reappears on the member grid and becomes bookable again as soon as no active
// period covers today.
router.delete(
  "/admin/coaching/coaches/:id/away/:awayId",
  requirePermission("coaching:manage"),
  async (req: Request, res: Response): Promise<void> => {
    const coachId = parseId(req.params.id);
    const awayId = parseId(req.params.awayId);
    if (!coachId || !awayId) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }

    const deleted = await db
      .delete(coachAwayPeriodsTable)
      .where(
        and(
          eq(coachAwayPeriodsTable.id, awayId),
          eq(coachAwayPeriodsTable.coachId, coachId),
        ),
      )
      .returning({ id: coachAwayPeriodsTable.id });

    if (deleted.length === 0) {
      res.status(404).json({ error: "Away period not found" });
      return;
    }

    res.json({ ok: true });
  },
);

export default router;
