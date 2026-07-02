import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  partnersTable,
  partnerAssignmentsTable,
  usersTable,
} from "@workspace/db";
import { eq, asc, desc, and, sql } from "drizzle-orm";
import { requirePermission } from "../middleware/rbac";
import { reassignMember, endActiveAssignment } from "../lib/partner-assignment";

const router: IRouter = Router();

const DISPLAY_NAME_MAX = 120;
const BIO_MAX = 2000;
const PHOTO_URL_MAX = 2048;

function parseId(value: unknown): number | null {
  const str = Array.isArray(value) ? value[0] : value;
  const num = parseInt(typeof str === "string" ? str : String(str ?? ""), 10);
  return Number.isInteger(num) && num > 0 ? num : null;
}

function parsePartnerBody(
  body: Record<string, unknown>,
  { partial }: { partial: boolean },
): { values: Record<string, unknown> } | { error: string } {
  const values: Record<string, unknown> = {};

  if (body.displayName !== undefined) {
    const displayName =
      typeof body.displayName === "string" ? body.displayName.trim() : "";
    if (!displayName) return { error: "Display name is required" };
    if (displayName.length > DISPLAY_NAME_MAX) {
      return { error: `Display name must be ${DISPLAY_NAME_MAX} characters or fewer` };
    }
    values.displayName = displayName;
  } else if (!partial) {
    return { error: "Display name is required" };
  }

  if (body.bio !== undefined) {
    const bio = typeof body.bio === "string" ? body.bio.trim() : "";
    if (bio.length > BIO_MAX) {
      return { error: `Bio must be ${BIO_MAX} characters or fewer` };
    }
    values.bio = bio || null;
  }

  if (body.photoUrl !== undefined) {
    if (body.photoUrl === null) {
      values.photoUrl = null;
    } else {
      const trimmed = typeof body.photoUrl === "string" ? body.photoUrl.trim() : "";
      if (trimmed.length > PHOTO_URL_MAX) {
        return { error: `Photo URL must be ${PHOTO_URL_MAX} characters or fewer` };
      }
      values.photoUrl = trimmed || null;
    }
  }

  if (body.isActive !== undefined) {
    if (typeof body.isActive !== "boolean") {
      return { error: "isActive must be a boolean" };
    }
    values.isActive = body.isActive;
  }

  if (body.maxDailyCalls !== undefined) {
    const n = Number(body.maxDailyCalls);
    if (!Number.isInteger(n) || n < 0) {
      return { error: "maxDailyCalls must be a non-negative integer" };
    }
    values.maxDailyCalls = n;
  }

  if (body.ghlCalendarId !== undefined) {
    if (body.ghlCalendarId === null) {
      values.ghlCalendarId = null;
    } else {
      const trimmed = typeof body.ghlCalendarId === "string" ? body.ghlCalendarId.trim() : "";
      values.ghlCalendarId = trimmed || null;
    }
  }

  return { values };
}

const PARTNER_COLUMNS = {
  id: partnersTable.id,
  displayName: partnersTable.displayName,
  bio: sql<string>`coalesce(${partnersTable.bio}, '')`.as("bio"),
  photoUrl: partnersTable.photoUrl,
  isActive: partnersTable.isActive,
  maxDailyCalls: partnersTable.maxDailyCalls,
  ghlCalendarId: partnersTable.ghlCalendarId,
  userId: partnersTable.userId,
};

// List every partner along with their current active-assignment count, so the
// admin panel can show load at a glance and pick a partner for reassignment.
router.get(
  "/admin/partners",
  requirePermission("partners:view"),
  async (_req: Request, res: Response): Promise<void> => {
    const partners = await db
      .select({
        ...PARTNER_COLUMNS,
        activeAssignmentCount: sql<number>`count(${partnerAssignmentsTable.id}) filter (where ${partnerAssignmentsTable.status} = 'active')`,
      })
      .from(partnersTable)
      .leftJoin(partnerAssignmentsTable, eq(partnerAssignmentsTable.partnerId, partnersTable.id))
      .groupBy(partnersTable.id)
      .orderBy(asc(partnersTable.displayName));

    res.json({ partners });
  },
);

router.post(
  "/admin/partners",
  requirePermission("partners:manage"),
  async (req: Request, res: Response): Promise<void> => {
    const parsed = parsePartnerBody(req.body ?? {}, { partial: false });
    if ("error" in parsed) {
      res.status(400).json({ error: parsed.error });
      return;
    }
    const [created] = await db
      .insert(partnersTable)
      .values(parsed.values as { displayName: string })
      .returning(PARTNER_COLUMNS);
    res.status(201).json({ ...created, activeAssignmentCount: 0 });
  },
);

router.patch(
  "/admin/partners/:id",
  requirePermission("partners:manage"),
  async (req: Request, res: Response): Promise<void> => {
    const partnerId = parseId(req.params.id);
    if (!partnerId) {
      res.status(400).json({ error: "Invalid partner id" });
      return;
    }
    const parsed = parsePartnerBody(req.body ?? {}, { partial: true });
    if ("error" in parsed) {
      res.status(400).json({ error: parsed.error });
      return;
    }
    if (Object.keys(parsed.values).length === 0) {
      res.status(400).json({ error: "No fields to update" });
      return;
    }
    const [updated] = await db
      .update(partnersTable)
      .set(parsed.values)
      .where(eq(partnersTable.id, partnerId))
      .returning(PARTNER_COLUMNS);
    if (!updated) {
      res.status(404).json({ error: "Partner not found" });
      return;
    }
    const [{ activeAssignmentCount }] = await db
      .select({
        activeAssignmentCount: sql<number>`count(*) filter (where ${partnerAssignmentsTable.status} = 'active')`,
      })
      .from(partnerAssignmentsTable)
      .where(eq(partnerAssignmentsTable.partnerId, partnerId));
    res.json({ ...updated, activeAssignmentCount });
  },
);

// Full assignment history for one member, most recent first. Used by the
// admin reassignment panel to show who a member has had before.
router.get(
  "/admin/members/:memberId/partner-assignments",
  requirePermission("partners:view"),
  async (req: Request, res: Response): Promise<void> => {
    const memberId = parseId(req.params.memberId);
    if (!memberId) {
      res.status(400).json({ error: "Invalid member id" });
      return;
    }
    const history = await db
      .select({
        id: partnerAssignmentsTable.id,
        partnerId: partnerAssignmentsTable.partnerId,
        partnerDisplayName: partnersTable.displayName,
        status: partnerAssignmentsTable.status,
        assignedAt: partnerAssignmentsTable.assignedAt,
        endedAt: partnerAssignmentsTable.endedAt,
        endedReason: partnerAssignmentsTable.endedReason,
      })
      .from(partnerAssignmentsTable)
      .innerJoin(partnersTable, eq(partnerAssignmentsTable.partnerId, partnersTable.id))
      .where(eq(partnerAssignmentsTable.memberId, memberId))
      .orderBy(desc(partnerAssignmentsTable.assignedAt));
    res.json({ history });
  },
);

// Admin-initiated reassignment (gated on partners:manage, a stricter
// permission than the read-only partners:view above). Ends the member's
// current active assignment and either assigns a named partner or re-runs
// round robin when no partnerId is given.
router.post(
  "/admin/members/:memberId/reassign-partner",
  requirePermission("partners:manage"),
  async (req: Request, res: Response): Promise<void> => {
    const memberId = parseId(req.params.memberId);
    if (!memberId) {
      res.status(400).json({ error: "Invalid member id" });
      return;
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    if (!reason) {
      res.status(400).json({ error: "reason is required" });
      return;
    }
    let partnerId: number | undefined;
    if (body.partnerId !== undefined && body.partnerId !== null) {
      const parsedPartnerId = parseId(body.partnerId);
      if (!parsedPartnerId) {
        res.status(400).json({ error: "Invalid partnerId" });
        return;
      }
      const [partner] = await db
        .select({ id: partnersTable.id, isActive: partnersTable.isActive })
        .from(partnersTable)
        .where(eq(partnersTable.id, parsedPartnerId))
        .limit(1);
      if (!partner) {
        res.status(404).json({ error: "Partner not found" });
        return;
      }
      if (!partner.isActive) {
        res.status(400).json({ error: "Cannot assign an inactive partner" });
        return;
      }
      partnerId = parsedPartnerId;
    }

    const [member] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.id, memberId))
      .limit(1);
    if (!member) {
      res.status(404).json({ error: "Member not found" });
      return;
    }

    const result = await reassignMember(memberId, { partnerId, reason });
    if (!result.partnerId) {
      res.status(409).json({ error: "No active partners available to assign" });
      return;
    }
    res.json({ partnerId: result.partnerId });
  },
);

// Manually end a member's active assignment with no replacement (e.g. the
// member's access was revoked outside the normal expiry sweep).
router.post(
  "/admin/members/:memberId/end-partner-assignment",
  requirePermission("partners:manage"),
  async (req: Request, res: Response): Promise<void> => {
    const memberId = parseId(req.params.memberId);
    if (!memberId) {
      res.status(400).json({ error: "Invalid member id" });
      return;
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const reason = typeof body.reason === "string" ? body.reason.trim() : "Ended by admin";
    const ended = await endActiveAssignment(memberId, reason);
    res.json({ ended });
  },
);

export default router;
