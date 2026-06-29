import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { db } from "@workspace/db";
import { blitzLessonsTable } from "@workspace/db/schema";
import { ne, asc } from "drizzle-orm";

/**
 * One-off snapshot generator for the FROZEN Blitz archive lesson library.
 *
 * The archive (admin-only `/blitz-archive`) must be fully independent of the
 * live database so edits to live Blitz content can never alter the backup.
 * This script reads the current Blitz lessons and writes a static JSON file
 * into the portal; `LessonLibraryArchive.tsx` reads that JSON instead of the API.
 *
 * Re-run manually only if you intentionally want to refresh the frozen archive:
 *   pnpm --filter @workspace/api-server exec tsx src/scripts/snapshot-blitz-archive-lessons.ts
 */

const OUT = resolve(
  import.meta.dirname,
  "../../../../artifacts/portal/src/components/blitz/blitz-archive-lessons.json",
);

async function main() {
  const rows = await db
    .select()
    .from(blitzLessonsTable)
    .where(ne(blitzLessonsTable.status, "rejected"))
    .orderBy(asc(blitzLessonsTable.blitzOrder), asc(blitzLessonsTable.id));

  const lessons = rows.map((r) => ({
    id: r.id,
    title: r.title,
    category: r.category,
    tags: r.tags,
    sourceVideoTitle: r.sourceVideoTitle,
    phase: r.phase,
    module: r.module,
    lessonId: r.lessonId,
    lessonType: r.lessonType,
    networkPath: r.networkPath,
    publisherPath: r.publisherPath,
    blitzOrder: r.blitzOrder,
  }));

  const details: Record<number, unknown> = {};
  for (const r of rows) {
    details[r.id] = {
      id: r.id,
      title: r.title,
      category: r.category,
      tags: r.tags,
      content: r.editedContent || r.content,
      sourceVideoTitle: r.sourceVideoTitle,
      sourceVideoId: r.sourceVideoId,
      phase: r.phase,
      module: r.module,
      lessonId: r.lessonId,
      lessonType: r.lessonType,
      networkPath: r.networkPath,
      publisherPath: r.publisherPath,
      blitzOrder: r.blitzOrder,
    };
  }

  writeFileSync(OUT, JSON.stringify({ lessons, details }, null, 2));
  console.log(`[snapshot] wrote ${rows.length} lessons to ${OUT}`);
  process.exit(0);
}

main().catch((err) => {
  console.error("[snapshot] failed:", err);
  process.exit(1);
});
