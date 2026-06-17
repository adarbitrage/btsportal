import { Router, type IRouter, type Request, type Response } from "express";
import { db, coachingCallsTable, coachesTable } from "@workspace/db";
import { eq, asc } from "drizzle-orm";
import { requirePermission } from "../middleware/rbac";

const router: IRouter = Router();

const KNOWN_CALL_TYPES = ["weekly_qa", "strategy", "mastermind", "vip_roundtable"];

function parseId(value: unknown): number | null {
  const str = Array.isArray(value) ? value[0] : value;
  const num = parseInt(typeof str === "string" ? str : String(str ?? ""), 10);
  return Number.isInteger(num) && num > 0 ? num : null;
}

function trimmedString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

// Parse and validate the editable fields shared by create + update. `partial`
// allows PATCH to omit fields that aren't being changed; create requires the
// core fields up front.
function parseCallBody(
  body: Record<string, unknown>,
  { partial }: { partial: boolean },
): { values: Record<string, unknown> } | { error: string } {
  const values: Record<string, unknown> = {};

  const title = trimmedString(body.title);
  if (title !== undefined) values.title = title;
  else if (!partial) return { error: "Title is required" };

  // Description is optional content but the column is NOT NULL; default to "".
  if (body.description !== undefined) {
    values.description = typeof body.description === "string" ? body.description.trim() : "";
  } else if (!partial) {
    values.description = "";
  }

  if (body.callType !== undefined) {
    const callType = trimmedString(body.callType);
    if (!callType || !KNOWN_CALL_TYPES.includes(callType)) {
      return { error: `Call type must be one of: ${KNOWN_CALL_TYPES.join(", ")}` };
    }
    values.callType = callType;
  }

  if (body.coachId !== undefined) {
    const coachId = parseId(body.coachId);
    if (!coachId) return { error: "A valid coach is required" };
    values.coachId = coachId;
  } else if (!partial) {
    return { error: "A valid coach is required" };
  }

  if (body.scheduledAt !== undefined) {
    const scheduledAt = new Date(String(body.scheduledAt));
    if (Number.isNaN(scheduledAt.getTime())) {
      return { error: "A valid date/time is required" };
    }
    values.scheduledAt = scheduledAt;
  } else if (!partial) {
    return { error: "A valid date/time is required" };
  }

  if (body.durationMinutes !== undefined) {
    const duration =
      typeof body.durationMinutes === "number"
        ? body.durationMinutes
        : parseInt(String(body.durationMinutes), 10);
    if (!Number.isInteger(duration) || duration <= 0) {
      return { error: "Duration must be a positive number of minutes" };
    }
    values.durationMinutes = duration;
  }

  // meetLink and recordingUrl are nullable: an empty string clears them.
  if (body.meetLink !== undefined) {
    values.meetLink = trimmedString(body.meetLink) ?? null;
  }
  if (body.recordingUrl !== undefined) {
    values.recordingUrl = trimmedString(body.recordingUrl) ?? null;
  }

  if (body.requiredEntitlement !== undefined) {
    values.requiredEntitlement = trimmedString(body.requiredEntitlement) ?? "coaching:group";
  }

  return { values };
}

// List every coaching call (group calls + one-off sessions) for the admin
// schedule manager, ordered by scheduled time (soonest first), joined with the
// coach name.
router.get(
  "/admin/coaching/calls",
  requirePermission("coaching:view"),
  async (_req: Request, res: Response): Promise<void> => {
    const calls = await db
      .select({
        id: coachingCallsTable.id,
        title: coachingCallsTable.title,
        description: coachingCallsTable.description,
        callType: coachingCallsTable.callType,
        coachId: coachingCallsTable.coachId,
        coachName: coachesTable.name,
        meetLink: coachingCallsTable.meetLink,
        scheduledAt: coachingCallsTable.scheduledAt,
        durationMinutes: coachingCallsTable.durationMinutes,
        requiredEntitlement: coachingCallsTable.requiredEntitlement,
        recordingUrl: coachingCallsTable.recordingUrl,
        registeredCount: coachingCallsTable.registeredCount,
      })
      .from(coachingCallsTable)
      .innerJoin(coachesTable, eq(coachingCallsTable.coachId, coachesTable.id))
      .orderBy(asc(coachingCallsTable.scheduledAt));

    res.json({ calls });
  },
);

// Coaches available to host calls, for the schedule editor's dropdown.
router.get(
  "/admin/coaching/calls/coaches",
  requirePermission("coaching:view"),
  async (_req: Request, res: Response): Promise<void> => {
    const coaches = await db
      .select({ id: coachesTable.id, name: coachesTable.name })
      .from(coachesTable)
      .orderBy(asc(coachesTable.name));
    res.json({ coaches });
  },
);

router.post(
  "/admin/coaching/calls",
  requirePermission("coaching:manage"),
  async (req: Request, res: Response): Promise<void> => {
    const parsed = parseCallBody(req.body ?? {}, { partial: false });
    if ("error" in parsed) {
      res.status(400).json({ error: parsed.error });
      return;
    }

    const [coach] = await db
      .select({ id: coachesTable.id })
      .from(coachesTable)
      .where(eq(coachesTable.id, parsed.values.coachId as number));
    if (!coach) {
      res.status(400).json({ error: "Selected coach does not exist" });
      return;
    }

    const [created] = await db
      .insert(coachingCallsTable)
      .values(parsed.values as typeof coachingCallsTable.$inferInsert)
      .returning();

    res.status(201).json(created);
  },
);

router.patch(
  "/admin/coaching/calls/:id",
  requirePermission("coaching:manage"),
  async (req: Request, res: Response): Promise<void> => {
    const callId = parseId(req.params.id);
    if (!callId) {
      res.status(400).json({ error: "Invalid call id" });
      return;
    }

    const parsed = parseCallBody(req.body ?? {}, { partial: true });
    if ("error" in parsed) {
      res.status(400).json({ error: parsed.error });
      return;
    }
    if (Object.keys(parsed.values).length === 0) {
      res.status(400).json({ error: "No fields to update" });
      return;
    }

    if (parsed.values.coachId !== undefined) {
      const [coach] = await db
        .select({ id: coachesTable.id })
        .from(coachesTable)
        .where(eq(coachesTable.id, parsed.values.coachId as number));
      if (!coach) {
        res.status(400).json({ error: "Selected coach does not exist" });
        return;
      }
    }

    const [updated] = await db
      .update(coachingCallsTable)
      .set(parsed.values)
      .where(eq(coachingCallsTable.id, callId))
      .returning();

    if (!updated) {
      res.status(404).json({ error: "Coaching call not found" });
      return;
    }

    res.json(updated);
  },
);

router.delete(
  "/admin/coaching/calls/:id",
  requirePermission("coaching:manage"),
  async (req: Request, res: Response): Promise<void> => {
    const callId = parseId(req.params.id);
    if (!callId) {
      res.status(400).json({ error: "Invalid call id" });
      return;
    }

    const [deleted] = await db
      .delete(coachingCallsTable)
      .where(eq(coachingCallsTable.id, callId))
      .returning({ id: coachingCallsTable.id });

    if (!deleted) {
      res.status(404).json({ error: "Coaching call not found" });
      return;
    }

    res.json({ ok: true });
  },
);

export default router;
