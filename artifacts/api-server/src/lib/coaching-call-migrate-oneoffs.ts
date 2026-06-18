import {
  db,
  coachingCallsTable,
  coachingCallTemplatesTable,
} from "@workspace/db";
import { inArray, isNull } from "drizzle-orm";

// One-time, idempotent migration that converts the legacy flat list of one-off
// coaching_calls (template_id IS NULL) into recurring schedule templates, then
// back-links each call to the template it now belongs to.
//
// Why this exists: the schedule was historically managed as ~36 individually
// dated calls (4 weeks × 9 weekly slots) with NO template rows. The admin panel
// is being made schedule-first (manage ~9 recurring weekly schedules instead of
// a repetitive flat list), which requires those calls to be grouped under
// templates. The recurring infrastructure (auto top-up job, idempotent
// generation) already exists; this only seeds the templates and the links.
//
// Idempotency / safety:
//   - Runs ONLY when the templates table is empty. Once any template exists the
//     migration is a no-op, so it never re-groups admin-curated schedules or
//     fights the live editor.
//   - Reaches production the same way the other boot data-repairs do: it runs
//     in bootstrapCriticalPrerequisites() on server start, against whatever
//     DATABASE_URL the instance booted with (the agent cannot write prod DB
//     directly). It is a fast no-op on every boot after the first.
//
// Grouping key: (coachId, weekday-UTC, HH:MM-UTC). Calls in the same weekly slot
// were generated at a consistent UTC time each week, so this cleanly recovers
// the original "every <weekday> at <time> with <coach>" series. anchorAt is the
// earliest occurrence and lastGeneratedAt the latest, so the daily top-up job
// extends each series forward without recreating the existing weeks.

interface OneOffCall {
  id: number;
  title: string;
  description: string;
  callType: string;
  coachId: number;
  meetLink: string | null;
  durationMinutes: number;
  requiredEntitlement: string;
  scheduledAt: Date;
}

function slotKey(call: OneOffCall): string {
  const d = call.scheduledAt;
  const weekday = d.getUTCDay();
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${call.coachId}|${weekday}|${hh}:${mm}`;
}

export async function migrateOneOffCoachingCallsToTemplates(): Promise<{
  migrated: boolean;
  templatesCreated: number;
  callsLinked: number;
}> {
  // Only run on a templateless schedule. Any existing template means the
  // schedule is already template-managed; never touch it.
  const [existingTemplate] = await db
    .select({ id: coachingCallTemplatesTable.id })
    .from(coachingCallTemplatesTable)
    .limit(1);
  if (existingTemplate) {
    return { migrated: false, templatesCreated: 0, callsLinked: 0 };
  }

  const oneOffs = (await db
    .select({
      id: coachingCallsTable.id,
      title: coachingCallsTable.title,
      description: coachingCallsTable.description,
      callType: coachingCallsTable.callType,
      coachId: coachingCallsTable.coachId,
      meetLink: coachingCallsTable.meetLink,
      durationMinutes: coachingCallsTable.durationMinutes,
      requiredEntitlement: coachingCallsTable.requiredEntitlement,
      scheduledAt: coachingCallsTable.scheduledAt,
    })
    .from(coachingCallsTable)
    .where(isNull(coachingCallsTable.templateId))) as OneOffCall[];

  if (oneOffs.length === 0) {
    return { migrated: false, templatesCreated: 0, callsLinked: 0 };
  }

  // Bucket calls into weekly slots.
  const groups = new Map<string, OneOffCall[]>();
  for (const call of oneOffs) {
    const key = slotKey(call);
    const bucket = groups.get(key);
    if (bucket) bucket.push(call);
    else groups.set(key, [call]);
  }

  let templatesCreated = 0;
  let callsLinked = 0;

  for (const calls of groups.values()) {
    const sorted = [...calls].sort(
      (a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime(),
    );
    const earliest = sorted[0];
    const latest = sorted[sorted.length - 1];

    await db.transaction(async (tx) => {
      const [template] = await tx
        .insert(coachingCallTemplatesTable)
        .values({
          title: earliest.title,
          description: earliest.description,
          callType: earliest.callType,
          coachId: earliest.coachId,
          meetLink: earliest.meetLink,
          durationMinutes: earliest.durationMinutes,
          requiredEntitlement: earliest.requiredEntitlement,
          intervalDays: 7,
          occurrencesPerBatch: 8,
          anchorAt: earliest.scheduledAt,
          lastGeneratedAt: latest.scheduledAt,
          active: true,
        })
        .returning({ id: coachingCallTemplatesTable.id });

      const ids = sorted.map((c) => c.id);
      await tx
        .update(coachingCallsTable)
        .set({ templateId: template.id })
        .where(inArray(coachingCallsTable.id, ids));

      templatesCreated += 1;
      callsLinked += sorted.length;
    });
  }

  console.log(
    `[Bootstrap] Migrated ${callsLinked} one-off coaching call(s) into ` +
      `${templatesCreated} recurring schedule(s).`,
  );

  return { migrated: true, templatesCreated, callsLinked };
}
