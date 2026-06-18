import { Router, type IRouter, type Request, type Response } from "express";
import { db, coachesTable } from "@workspace/db";
import { eq, asc } from "drizzle-orm";
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

// Validate the editable profile fields for a PATCH. Every field is optional so
// admins can update one at a time, but any field that IS present must be valid.
function parseCoachBody(
  body: Record<string, unknown>,
): { values: Record<string, unknown> } | { error: string } {
  const values: Record<string, unknown> = {};

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
// without direct DB edits.
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
      })
      .from(coachesTable)
      .orderBy(asc(coachesTable.name));

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

export default router;
