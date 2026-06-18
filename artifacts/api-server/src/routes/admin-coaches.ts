import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  coachesTable,
  coachingCallsTable,
  coachingCallTemplatesTable,
} from "@workspace/db";
import { eq, asc, and, count, gte, inArray, sql } from "drizzle-orm";
import { requirePermission } from "../middleware/rbac";
import {
  getConnectionStatus,
  type CoachGoogleConnectionStatus,
} from "../lib/coach-google-connections";

const router: IRouter = Router();

// Field length ceilings keep the member-facing "Your Coaches" cards readable and
// guard against runaway input. These mirror the sizes the Coaching page layout
// is designed around.
const NAME_MAX = 120;
const SPECIALTIES_MAX = 200;
const BIO_MAX = 2000;
const PHOTO_URL_MAX = 2048;
const CALL_TYPE_MAX = 60;
const MAX_CALL_TYPES = 20;
const GHL_ID_MAX = 128;

function parseId(value: unknown): number | null {
  const str = Array.isArray(value) ? value[0] : value;
  const num = parseInt(typeof str === "string" ? str : String(str ?? ""), 10);
  return Number.isInteger(num) && num > 0 ? num : null;
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

  // Specialty + bio are optional. An empty string clears the field; the only
  // constraint is the length ceiling.
  if (body.specialties !== undefined) {
    const specialties =
      typeof body.specialties === "string" ? body.specialties.trim() : "";
    if (specialties.length > SPECIALTIES_MAX) {
      return { error: `Specialty must be ${SPECIALTIES_MAX} characters or fewer` };
    }
    values.specialties = specialties;
  }

  if (body.bio !== undefined) {
    const bio = typeof body.bio === "string" ? body.bio.trim() : "";
    if (bio.length > BIO_MAX) {
      return { error: `Bio must be ${BIO_MAX} characters or fewer` };
    }
    values.bio = bio;
  }

  if (body.photoUrl !== undefined) {
    const photo = parsePhotoUrl(body.photoUrl);
    if ("error" in photo) return { error: photo.error };
    values.photoUrl = photo.url;
  }

  // Scheduling fields. callTypes has a DB default, so it's optional even on
  // create; if supplied it must be well-formed (a string[]).
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

  // Private-coaching booking config (GoHighLevel). Only meaningful when the
  // coach offers private coaching, but always optional + nullable: an empty
  // string clears the field. ghlCalendarId carries a UNIQUE constraint, so a
  // duplicate is surfaced as a 409 by the create/update handlers.
  for (const field of [
    "ghlCalendarId",
    "ghlLocationId",
    "conflictGhlCalendarId",
    "conflictGhlLocationId",
  ] as const) {
    if (body[field] !== undefined) {
      if (body[field] === null) {
        values[field] = null;
        continue;
      }
      const raw = typeof body[field] === "string" ? (body[field] as string).trim() : "";
      if (!raw) {
        values[field] = null;
        continue;
      }
      if (raw.length > GHL_ID_MAX) {
        return { error: `${field} must be ${GHL_ID_MAX} characters or fewer` };
      }
      values[field] = raw;
    }
  }

  return { values };
}

// Map a Postgres unique-violation on ghl_calendar_id to a friendly 409. Any
// other error is rethrown for the generic handler.
function isGhlCalendarConflict(err: unknown): boolean {
  return (
    !!err &&
    typeof err === "object" &&
    "code" in err &&
    (err as { code?: string }).code === "23505"
  );
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
  // specialties/bio are optional (nullable) columns; coalesce to "" so every
  // coach endpoint returns a plain string and the admin editor can edit/save
  // (it calls .trim()) without null-guarding each field.
  specialties: sql<string>`coalesce(${coachesTable.specialties}, '')`.as("specialties"),
  bio: sql<string>`coalesce(${coachesTable.bio}, '')`.as("bio"),
  photoUrl: coachesTable.photoUrl,
  callTypes: coachesTable.callTypes,
  sortOrder: coachesTable.sortOrder,
  isActive: coachesTable.isActive,
  doesGroupCalls: coachesTable.doesGroupCalls,
  doesPrivateCoaching: coachesTable.doesPrivateCoaching,
  // Private-coaching booking config (GoHighLevel). Surfaced so the merged
  // Coaches editor + Connections panel can show/edit the booking calendar.
  ghlCalendarId: coachesTable.ghlCalendarId,
  ghlLocationId: coachesTable.ghlLocationId,
  // Cross-company arbiter: the coach's "other company" (Conflict) calendar.
  // Read alongside the booking calendar at click-time and mirrored a busy
  // block on every BTS booking so the two companies never double-book.
  conflictGhlCalendarId: coachesTable.conflictGhlCalendarId,
  conflictGhlLocationId: coachesTable.conflictGhlLocationId,
  // Optional link to the coach's portal login. Drives the per-coach Google
  // (Drive recordings / Calendar availability) connection status.
  userId: coachesTable.userId,
};

router.get(
  "/admin/coaching/coaches",
  requirePermission("coaching:view"),
  async (_req: Request, res: Response): Promise<void> => {
    const coaches = await db
      .select(COACH_COLUMNS)
      .from(coachesTable)
      .orderBy(asc(coachesTable.sortOrder), asc(coachesTable.name));

    // Per-coach Google connection status (Drive recordings ride the OAuth
    // grant). Only coaches linked to a portal login (userId) can have a
    // connection; the rest report null so the Connections panel can prompt to
    // link an account. Resolved in parallel.
    const googleByCoach = new Map<number, CoachGoogleConnectionStatus>();
    await Promise.all(
      coaches
        .filter((c): c is typeof c & { userId: number } => c.userId != null)
        .map(async (c) => {
          googleByCoach.set(c.id, await getConnectionStatus(c.userId));
        }),
    );

    const withConnections = coaches.map((c) => ({
      ...c,
      googleConnection: googleByCoach.get(c.id) ?? null,
    }));

    res.json({ coaches: withConnections });
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

    let updated: Record<string, unknown> | undefined;
    try {
      [updated] = await db
        .update(coachesTable)
        .set(parsed.values)
        .where(eq(coachesTable.id, coachId))
        .returning(COACH_COLUMNS);
    } catch (err) {
      if (isGhlCalendarConflict(err)) {
        res.status(409).json({ error: "Another coach already uses that GHL calendar id" });
        return;
      }
      throw err;
    }

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
// (callTypes) are accepted when supplied; otherwise they fall back to their
// schema defaults.
router.post(
  "/admin/coaching/coaches",
  requirePermission("coaching:manage"),
  async (req: Request, res: Response): Promise<void> => {
    const parsed = parseCoachBody(req.body ?? {}, { partial: false });
    if ("error" in parsed) {
      res.status(400).json({ error: parsed.error });
      return;
    }

    let created: Record<string, unknown> | undefined;
    try {
      [created] = await db
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
    } catch (err) {
      if (isGhlCalendarConflict(err)) {
        res.status(409).json({ error: "Another coach already uses that GHL calendar id" });
        return;
      }
      throw err;
    }

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

    // Both coaches must exist before we touch any calls, so we never reassign
    // to (or from) a phantom coach id built from stale client state.
    const [source] = await db
      .select({ id: coachesTable.id })
      .from(coachesTable)
      .where(eq(coachesTable.id, fromCoachId));
    if (!source) {
      res.status(404).json({ error: "Coach not found" });
      return;
    }

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
      // Structured code + count so the admin UI can offer an inline reassign /
      // cancel recovery flow instead of just surfacing the raw error string.
      res.status(409).json({
        error: `Cannot delete: this coach is assigned to ${upcomingCount} upcoming coaching call${upcomingCount === 1 ? "" : "s"}. Reassign or remove ${upcomingCount === 1 ? "it" : "them"} first.`,
        code: "coach_has_scheduled_calls",
        callCount: upcomingCount,
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

export default router;
