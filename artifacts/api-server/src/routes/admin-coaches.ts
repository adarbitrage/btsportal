import { Router, type IRouter, type Request, type Response } from "express";
import { db, coachesTable, coachingCallsTable } from "@workspace/db";
import { eq, asc, count, inArray } from "drizzle-orm";
import { requirePermission } from "../middleware/rbac";

const router: IRouter = Router();

// Field length ceilings keep the member-facing "Your Coaches" cards readable and
// guard against runaway input. These mirror the sizes the Coaching page layout
// is designed around.
const NAME_MAX = 120;
const SPECIALTIES_MAX = 200;
const BIO_MAX = 2000;
const PHOTO_URL_MAX = 2048;

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

// Validate the editable profile fields. For a PATCH every field is optional so
// admins can update one at a time, but any field that IS present must be valid.
// For a create (requireAll), the three text fields must all be supplied; the
// validation rules are otherwise identical so create and edit stay in lockstep.
function parseCoachBody(
  body: Record<string, unknown>,
  options: { requireAll?: boolean } = {},
): { values: Record<string, unknown> } | { error: string } {
  const values: Record<string, unknown> = {};

  if (options.requireAll) {
    if (body.name === undefined) return { error: "Name is required" };
    if (body.specialties === undefined) return { error: "Specialty is required" };
    if (body.bio === undefined) return { error: "Bio is required" };
  }

  if (body.name !== undefined) {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) return { error: "Name is required" };
    if (name.length > NAME_MAX) {
      return { error: `Name must be ${NAME_MAX} characters or fewer` };
    }
    values.name = name;
  }

  if (body.specialties !== undefined) {
    const specialties =
      typeof body.specialties === "string" ? body.specialties.trim() : "";
    if (!specialties) return { error: "Specialty is required" };
    if (specialties.length > SPECIALTIES_MAX) {
      return { error: `Specialty must be ${SPECIALTIES_MAX} characters or fewer` };
    }
    values.specialties = specialties;
  }

  if (body.bio !== undefined) {
    const bio = typeof body.bio === "string" ? body.bio.trim() : "";
    if (!bio) return { error: "Bio is required" };
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

  return { values };
}

// List every coach with the profile fields the member-facing "Your Coaches"
// grid renders, so admins can keep names, specialties, photos, and bios current
// without direct DB edits. Ordered by sortOrder (then name as a stable
// tiebreaker) so the admin list mirrors the order members see on the Coaching
// page, which also orders by sortOrder.
router.get(
  "/admin/coaching/coaches",
  requirePermission("coaching:view"),
  async (_req: Request, res: Response): Promise<void> => {
    const coaches = await db
      .select({
        id: coachesTable.id,
        name: coachesTable.name,
        specialties: coachesTable.specialties,
        bio: coachesTable.bio,
        photoUrl: coachesTable.photoUrl,
        sortOrder: coachesTable.sortOrder,
      })
      .from(coachesTable)
      .orderBy(asc(coachesTable.sortOrder), asc(coachesTable.name));

    res.json({ coaches });
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
      .select({
        id: coachesTable.id,
        name: coachesTable.name,
        specialties: coachesTable.specialties,
        bio: coachesTable.bio,
        photoUrl: coachesTable.photoUrl,
        sortOrder: coachesTable.sortOrder,
      })
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

    const parsed = parseCoachBody(req.body ?? {});
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
      .returning({
        id: coachesTable.id,
        name: coachesTable.name,
        specialties: coachesTable.specialties,
        bio: coachesTable.bio,
        photoUrl: coachesTable.photoUrl,
      });

    if (!updated) {
      res.status(404).json({ error: "Coach not found" });
      return;
    }

    res.json(updated);
  },
);

// Create a new coach. All three text fields are required (same validation as
// edit); photo is optional. New coaches are flagged doesGroupCalls=true (and
// isActive defaults to true) so they show up immediately in the member-facing
// "Your Coaches" grid, which only lists active group-call coaches.
router.post(
  "/admin/coaching/coaches",
  requirePermission("coaching:manage"),
  async (req: Request, res: Response): Promise<void> => {
    const parsed = parseCoachBody(req.body ?? {}, { requireAll: true });
    if ("error" in parsed) {
      res.status(400).json({ error: parsed.error });
      return;
    }

    const [created] = await db
      .insert(coachesTable)
      .values({
        name: parsed.values.name as string,
        specialties: parsed.values.specialties as string,
        bio: parsed.values.bio as string,
        photoUrl: (parsed.values.photoUrl as string | null) ?? null,
        doesGroupCalls: true,
      })
      .returning({
        id: coachesTable.id,
        name: coachesTable.name,
        specialties: coachesTable.specialties,
        bio: coachesTable.bio,
        photoUrl: coachesTable.photoUrl,
      });

    res.status(201).json(created);
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

    const [{ value: callCount }] = await db
      .select({ value: count() })
      .from(coachingCallsTable)
      .where(eq(coachingCallsTable.coachId, coachId));

    if (callCount > 0) {
      res.status(409).json({
        error: `This coach is assigned to ${callCount} scheduled coaching call${
          callCount === 1 ? "" : "s"
        }. Reassign or remove those calls before deleting the coach.`,
      });
      return;
    }

    try {
      const [deleted] = await db
        .delete(coachesTable)
        .where(eq(coachesTable.id, coachId))
        .returning({ id: coachesTable.id });

      if (!deleted) {
        res.status(404).json({ error: "Coach not found" });
        return;
      }

      res.status(204).end();
    } catch (err) {
      // 23503 = foreign_key_violation. Another table (e.g. templates or
      // session-pack bookings) still references this coach.
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
