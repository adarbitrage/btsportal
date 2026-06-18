import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  coachingCallsTable,
  coachingCallTemplatesTable,
  coachingCallAttendanceTable,
  coachesTable,
} from "@workspace/db";
import { eq, asc, desc, and, gt, isNull, notExists, sql } from "drizzle-orm";
import { requirePermission } from "../middleware/rbac";

const router: IRouter = Router();

const KNOWN_CALL_TYPES = ["weekly_qa", "strategy", "mastermind", "vip_roundtable"];

const DAY_MS = 24 * 60 * 60 * 1000;
// Guard rails so a template can't be told to spawn an unbounded number of rows.
const MAX_OCCURRENCES_PER_BATCH = 52;
const MAX_INTERVAL_DAYS = 365;

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
        templateId: coachingCallsTable.templateId,
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

// --- Recurring schedule templates ----------------------------------------
//
// A template defines a repeating slot ("every Monday 2pm, coach X"). Creating
// one immediately generates the first batch of ordinary coaching_calls rows;
// "generate" extends the series by another batch. Each generated row is a
// normal coaching_calls row (linked by template_id), so editing / cancelling a
// single occurrence via the existing call CRUD never disturbs the rest.

function parseTemplateBody(
  body: Record<string, unknown>,
  { partial }: { partial: boolean },
): { values: Record<string, unknown> } | { error: string } {
  const values: Record<string, unknown> = {};

  const title = trimmedString(body.title);
  if (title !== undefined) values.title = title;
  else if (!partial) return { error: "Title is required" };

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

  // anchorAt = the first occurrence's date/time. Required on create. On update
  // it's optional, but when provided it re-anchors the schedule (day/time move)
  // and triggers a re-slot of the upcoming un-reserved occurrences.
  if (body.anchorAt !== undefined || body.scheduledAt !== undefined) {
    const anchorAt = new Date(String(body.anchorAt ?? body.scheduledAt));
    if (Number.isNaN(anchorAt.getTime())) {
      return { error: "A valid first occurrence date/time is required" };
    }
    values.anchorAt = anchorAt;
  } else if (!partial) {
    return { error: "A valid first occurrence date/time is required" };
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

  if (body.intervalDays !== undefined) {
    const interval =
      typeof body.intervalDays === "number"
        ? body.intervalDays
        : parseInt(String(body.intervalDays), 10);
    if (!Number.isInteger(interval) || interval <= 0 || interval > MAX_INTERVAL_DAYS) {
      return { error: `Interval must be between 1 and ${MAX_INTERVAL_DAYS} days` };
    }
    values.intervalDays = interval;
  }

  if (body.occurrencesPerBatch !== undefined) {
    const batch =
      typeof body.occurrencesPerBatch === "number"
        ? body.occurrencesPerBatch
        : parseInt(String(body.occurrencesPerBatch), 10);
    if (!Number.isInteger(batch) || batch <= 0 || batch > MAX_OCCURRENCES_PER_BATCH) {
      return { error: `Weeks to generate must be between 1 and ${MAX_OCCURRENCES_PER_BATCH}` };
    }
    values.occurrencesPerBatch = batch;
  }

  if (body.meetLink !== undefined) {
    values.meetLink = trimmedString(body.meetLink) ?? null;
  }
  if (body.requiredEntitlement !== undefined) {
    values.requiredEntitlement = trimmedString(body.requiredEntitlement) ?? "coaching:group";
  }
  if (body.active !== undefined) {
    values.active = Boolean(body.active);
  }

  return { values };
}

export type TemplateRow = typeof coachingCallTemplatesTable.$inferSelect;

// Compute the next `count` occurrence datetimes for a template. Generation
// always moves strictly forward: from the watermark when one exists, otherwise
// from the anchor. This is what guarantees a cancelled occurrence is never
// re-created on a later pass.
export function nextOccurrences(template: TemplateRow, count: number): Date[] {
  const intervalMs = template.intervalDays * DAY_MS;
  const occurrences: Date[] = [];
  let next = template.lastGeneratedAt
    ? new Date(template.lastGeneratedAt.getTime() + intervalMs)
    : new Date(template.anchorAt.getTime());
  for (let i = 0; i < count; i++) {
    occurrences.push(new Date(next));
    next = new Date(next.getTime() + intervalMs);
  }
  return occurrences;
}

// Insert `count` upcoming occurrences as coaching_calls rows and advance the
// template watermark. onConflictDoNothing on (template_id, scheduled_at) keeps
// it idempotent under double-clicks / retries.
export async function generateForTemplate(
  template: TemplateRow,
  count: number,
): Promise<{ created: number; through: Date }> {
  const occurrences = nextOccurrences(template, count);
  const rows = occurrences.map((scheduledAt) => ({
    title: template.title,
    description: template.description,
    callType: template.callType,
    coachId: template.coachId,
    meetLink: template.meetLink,
    scheduledAt,
    durationMinutes: template.durationMinutes,
    requiredEntitlement: template.requiredEntitlement,
    templateId: template.id,
  }));

  const inserted = await db
    .insert(coachingCallsTable)
    .values(rows)
    .onConflictDoNothing({
      target: [coachingCallsTable.templateId, coachingCallsTable.scheduledAt],
    })
    .returning({ id: coachingCallsTable.id });

  const through = occurrences[occurrences.length - 1];
  await db
    .update(coachingCallTemplatesTable)
    .set({ lastGeneratedAt: through })
    .where(eq(coachingCallTemplatesTable.id, template.id));

  return { created: inserted.length, through };
}

// Fields that, when edited on a template, must propagate to the upcoming
// (un-reserved) generated occurrences. `active` and `occurrencesPerBatch` are
// intentionally excluded: pausing/resuming or changing the batch size never
// rewrites the calls already on the schedule.
const RESLOT_TRIGGER_FIELDS = [
  "anchorAt",
  "intervalDays",
  "coachId",
  "title",
  "description",
  "callType",
  "durationMinutes",
  "meetLink",
  "requiredEntitlement",
] as const;

// The next `count` occurrence datetimes at or after `from` on the template's
// anchorAt + k*intervalDays grid. Used by the re-slot path so a day/time move
// regenerates the future cleanly without ever producing past-dated calls.
export function futureOccurrencesOnGrid(
  template: TemplateRow,
  from: Date,
  count: number,
): Date[] {
  const intervalMs = template.intervalDays * DAY_MS;
  const anchor = template.anchorAt.getTime();
  const fromMs = from.getTime();
  let k = 0;
  if (fromMs > anchor) {
    k = Math.ceil((fromMs - anchor) / intervalMs);
  }
  const occurrences: Date[] = [];
  for (let i = 0; i < count; i++) {
    occurrences.push(new Date(anchor + (k + i) * intervalMs));
  }
  return occurrences;
}

// Re-slot a template's UPCOMING occurrences after a schedule edit. Deletes only
// future occurrences that are safe to move — no registrations, no recording, no
// attendance rows — then regenerates the next batch from the (possibly new)
// schedule grid. Past calls and any future call someone has already booked are
// left exactly where they are, so RSVPs / reminders / recordings keep working.
export async function reslotTemplateFutureOccurrences(
  template: TemplateRow,
): Promise<{ deleted: number; created: number; through: Date | null }> {
  const now = new Date();

  const deleted = await db
    .delete(coachingCallsTable)
    .where(
      and(
        eq(coachingCallsTable.templateId, template.id),
        gt(coachingCallsTable.scheduledAt, now),
        eq(coachingCallsTable.registeredCount, 0),
        isNull(coachingCallsTable.recordingUrl),
        notExists(
          db
            .select({ x: sql`1` })
            .from(coachingCallAttendanceTable)
            .where(eq(coachingCallAttendanceTable.callId, coachingCallsTable.id)),
        ),
      ),
    )
    .returning({ id: coachingCallsTable.id });

  const occurrences = futureOccurrencesOnGrid(template, now, template.occurrencesPerBatch);
  const rows = occurrences.map((scheduledAt) => ({
    title: template.title,
    description: template.description,
    callType: template.callType,
    coachId: template.coachId,
    meetLink: template.meetLink,
    scheduledAt,
    durationMinutes: template.durationMinutes,
    requiredEntitlement: template.requiredEntitlement,
    templateId: template.id,
  }));

  const inserted = await db
    .insert(coachingCallsTable)
    .values(rows)
    .onConflictDoNothing({
      target: [coachingCallsTable.templateId, coachingCallsTable.scheduledAt],
    })
    .returning({ id: coachingCallsTable.id });

  // Advance the watermark so the daily top-up job continues forward from the
  // new schedule. Reads the furthest existing occurrence (covers retained
  // reserved calls that might sit past the regenerated batch).
  const [furthest] = await db
    .select({ scheduledAt: coachingCallsTable.scheduledAt })
    .from(coachingCallsTable)
    .where(eq(coachingCallsTable.templateId, template.id))
    .orderBy(desc(coachingCallsTable.scheduledAt))
    .limit(1);
  const through =
    occurrences.length > 0 ? occurrences[occurrences.length - 1] : null;
  const watermark =
    through && furthest && furthest.scheduledAt.getTime() > through.getTime()
      ? furthest.scheduledAt
      : through;
  await db
    .update(coachingCallTemplatesTable)
    .set({ lastGeneratedAt: watermark })
    .where(eq(coachingCallTemplatesTable.id, template.id));

  return { deleted: deleted.length, created: inserted.length, through: watermark };
}

// List recurring templates with the coach name, for the admin schedule manager.
router.get(
  "/admin/coaching/calls/templates",
  requirePermission("coaching:view"),
  async (_req: Request, res: Response): Promise<void> => {
    const templates = await db
      .select({
        id: coachingCallTemplatesTable.id,
        title: coachingCallTemplatesTable.title,
        description: coachingCallTemplatesTable.description,
        callType: coachingCallTemplatesTable.callType,
        coachId: coachingCallTemplatesTable.coachId,
        coachName: coachesTable.name,
        meetLink: coachingCallTemplatesTable.meetLink,
        durationMinutes: coachingCallTemplatesTable.durationMinutes,
        requiredEntitlement: coachingCallTemplatesTable.requiredEntitlement,
        intervalDays: coachingCallTemplatesTable.intervalDays,
        occurrencesPerBatch: coachingCallTemplatesTable.occurrencesPerBatch,
        anchorAt: coachingCallTemplatesTable.anchorAt,
        lastGeneratedAt: coachingCallTemplatesTable.lastGeneratedAt,
        active: coachingCallTemplatesTable.active,
      })
      .from(coachingCallTemplatesTable)
      .innerJoin(coachesTable, eq(coachingCallTemplatesTable.coachId, coachesTable.id))
      .orderBy(asc(coachingCallTemplatesTable.title));

    res.json({ templates });
  },
);

// Create a recurring template AND generate its first batch of calls in one
// step (the headline feature: set up a recurring weekly call without
// re-creating each week by hand).
router.post(
  "/admin/coaching/calls/templates",
  requirePermission("coaching:manage"),
  async (req: Request, res: Response): Promise<void> => {
    const parsed = parseTemplateBody(req.body ?? {}, { partial: false });
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

    const [template] = await db
      .insert(coachingCallTemplatesTable)
      .values(parsed.values as typeof coachingCallTemplatesTable.$inferInsert)
      .returning();

    const { created, through } = await generateForTemplate(
      template,
      template.occurrencesPerBatch,
    );

    res.status(201).json({ template: { ...template, lastGeneratedAt: through }, generated: created });
  },
);

// Edit a template's field values / cadence. This affects only FUTURE generated
// occurrences — already-generated calls are independent rows and are left
// untouched, mirroring the single-occurrence isolation guarantee.
router.patch(
  "/admin/coaching/calls/templates/:id",
  requirePermission("coaching:manage"),
  async (req: Request, res: Response): Promise<void> => {
    const templateId = parseId(req.params.id);
    if (!templateId) {
      res.status(400).json({ error: "Invalid template id" });
      return;
    }

    const parsed = parseTemplateBody(req.body ?? {}, { partial: true });
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
      .update(coachingCallTemplatesTable)
      .set(parsed.values)
      .where(eq(coachingCallTemplatesTable.id, templateId))
      .returning();

    if (!updated) {
      res.status(404).json({ error: "Template not found" });
      return;
    }

    // When a schedule edit touches the day/time, coach, or other fields copied
    // onto generated calls, re-slot the upcoming un-reserved occurrences so the
    // change actually moves the next weeks. Skip for paused schedules and for
    // edits that only flip `active` / `occurrencesPerBatch`.
    const shouldReslot =
      updated.active &&
      RESLOT_TRIGGER_FIELDS.some((f) => f in parsed.values);
    if (shouldReslot) {
      const { through } = await reslotTemplateFutureOccurrences(updated);
      res.json({ ...updated, lastGeneratedAt: through });
      return;
    }

    res.json(updated);
  },
);

// Generate the next batch of occurrences for an existing template.
router.post(
  "/admin/coaching/calls/templates/:id/generate",
  requirePermission("coaching:manage"),
  async (req: Request, res: Response): Promise<void> => {
    const templateId = parseId(req.params.id);
    if (!templateId) {
      res.status(400).json({ error: "Invalid template id" });
      return;
    }

    const [template] = await db
      .select()
      .from(coachingCallTemplatesTable)
      .where(eq(coachingCallTemplatesTable.id, templateId));
    if (!template) {
      res.status(404).json({ error: "Template not found" });
      return;
    }

    if (!template.active) {
      res.status(409).json({ error: "Cannot generate calls for a paused schedule. Resume it first." });
      return;
    }

    const { created, through } = await generateForTemplate(
      template,
      template.occurrencesPerBatch,
    );
    res.json({ generated: created, through });
  },
);

// Delete a template. Already-generated calls are kept (template_id is set NULL
// via the FK) so the existing schedule is undisturbed; the series simply stops
// auto-generating new weeks.
router.delete(
  "/admin/coaching/calls/templates/:id",
  requirePermission("coaching:manage"),
  async (req: Request, res: Response): Promise<void> => {
    const templateId = parseId(req.params.id);
    if (!templateId) {
      res.status(400).json({ error: "Invalid template id" });
      return;
    }

    const [deleted] = await db
      .delete(coachingCallTemplatesTable)
      .where(eq(coachingCallTemplatesTable.id, templateId))
      .returning({ id: coachingCallTemplatesTable.id });

    if (!deleted) {
      res.status(404).json({ error: "Template not found" });
      return;
    }

    res.json({ ok: true });
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
