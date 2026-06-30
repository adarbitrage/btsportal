import fs from "fs";
import path from "path";
import { db } from "@workspace/db";
import { kbStagingDocsTable, blitzLessonsTable } from "@workspace/db/schema";
import { eq, count } from "drizzle-orm";

function findSeedFile(filename: string): string | null {
  const candidates = [
    path.join(process.cwd(), "src/data", filename),
    path.join(process.cwd(), "artifacts/api-server/src/data", filename),
  ];
  return candidates.find((p) => fs.existsSync(p)) ?? null;
}

async function seedFromFile(source: string, label: string, filename: string) {
  try {
    const existing = await db
      .select({ cnt: count() })
      .from(kbStagingDocsTable)
      .where(eq(kbStagingDocsTable.source, source));

    if (existing[0].cnt > 0) {
      console.log(`[${label}] ${existing[0].cnt} docs already exist, skipping seed`);
      return;
    }

    const seedPath = findSeedFile(filename);
    if (!seedPath) {
      console.log(`[${label}] No seed file found`);
      return;
    }

    const docs = JSON.parse(fs.readFileSync(seedPath, "utf-8"));
    let inserted = 0;

    for (const doc of docs) {
      await db.insert(kbStagingDocsTable).values({
        title: doc.title,
        category: doc.category,
        content: doc.content,
        tags: doc.tags || "",
        sourceVideoTitle: doc.source_video_title,
        sourceVideoId: doc.source_video_id,
        status: doc.status || "pending_review",
        adminNotes: doc.admin_notes,
        editedContent: doc.edited_content,
        source: doc.source,
        phase: doc.phase,
        module: doc.module,
        lessonId: doc.lesson_id,
        lessonType: doc.lesson_type,
        networkPath: doc.network_path,
        publisherPath: doc.publisher_path,
        blitzOrder: doc.blitz_order,
      });
      inserted++;
    }

    console.log(`[${label}] Seeded ${inserted} documents`);
  } catch (err) {
    console.error(`[${label}] Error seeding:`, err);
  }
}

// Full decouple: Blitz lessons live in their OWN `blitz_lessons` table, never in
// the shared AI knowledge-base staging table (`kb_staging_docs`). This boot hook
// is idempotent, self-healing, and data-safe:
//
//   1. If any legacy source='blitz' rows remain in `kb_staging_docs`, copy every
//      one not already in `blitz_lessons` (dedup by title, preserving
//      content/edits), THEN delete the legacy rows. Copy-before-delete makes it
//      safe to resume even after an interrupted boot — no Blitz content is lost.
//   2. On a fresh env (no legacy rows, empty `blitz_lessons`), seed from
//      `blitz-seed.json` instead.
// Either path leaves `kb_staging_docs` free of Blitz so the AI Document Review
// surface stays clean and the admin Blitz video pipeline can never re-pollute it.
export async function migrateBlitzLessons() {
  try {
    // 1) Reconcile any legacy source='blitz' rows still in the AI staging table
    //    into blitz_lessons. This is deliberately NOT gated on blitz_lessons
    //    being empty: copy every legacy row that is not yet present (dedup by
    //    title), THEN delete the legacy rows. That ordering is data-safe even if
    //    a previous boot was interrupted mid-migration — un-copied rows are
    //    copied before anything is deleted, so no Blitz content can be lost.
    const legacy = await db
      .select()
      .from(kbStagingDocsTable)
      .where(eq(kbStagingDocsTable.source, "blitz"));

    if (legacy.length > 0) {
      const existingRows = await db
        .select({ title: blitzLessonsTable.title })
        .from(blitzLessonsTable);
      const existingTitles = new Set(existingRows.map((r) => r.title));

      let migrated = 0;
      for (const doc of legacy) {
        if (existingTitles.has(doc.title)) continue;
        await db.insert(blitzLessonsTable).values({
          title: doc.title,
          category: doc.category,
          content: doc.content,
          tags: doc.tags,
          sourceVideoTitle: doc.sourceVideoTitle,
          sourceVideoId: doc.sourceVideoId,
          // Legacy rows carried the staging default 'pending_review'; that is
          // not a review status here, so normalize to 'published' (unless the
          // row was explicitly hidden via 'rejected').
          status: doc.status === "rejected" ? "rejected" : "published",
          adminNotes: doc.adminNotes,
          editedContent: doc.editedContent,
          phase: doc.phase,
          module: doc.module,
          lessonId: doc.lessonId,
          lessonType: doc.lessonType,
          networkPath: doc.networkPath,
          publisherPath: doc.publisherPath,
          blitzOrder: doc.blitzOrder,
        });
        existingTitles.add(doc.title);
        migrated++;
      }
      if (migrated > 0) {
        console.log(
          `[Blitz Lessons] Migrated ${migrated} lessons out of kb_staging_docs into blitz_lessons`,
        );
      }

      // Every legacy row is now represented in blitz_lessons — safe to remove
      // them from the AI staging table so the Document Review surface stays
      // clean and the admin Blitz video pipeline can never re-pollute it.
      const removed = await db
        .delete(kbStagingDocsTable)
        .where(eq(kbStagingDocsTable.source, "blitz"))
        .returning({ id: kbStagingDocsTable.id });
      if (removed.length > 0) {
        console.log(
          `[Blitz Lessons] Removed ${removed.length} legacy blitz rows from kb_staging_docs`,
        );
      }
      return;
    }

    // 2) No legacy rows. On a fresh environment (empty blitz_lessons) seed from
    //    the JSON snapshot; otherwise there is nothing to do.
    const existing = await db.select({ cnt: count() }).from(blitzLessonsTable);
    if (existing[0].cnt > 0) return;

    const seedPath = findSeedFile("blitz-seed.json");
    if (!seedPath) {
      console.log("[Blitz Lessons] No legacy rows and no seed file — nothing to seed");
      return;
    }

    const docs = JSON.parse(fs.readFileSync(seedPath, "utf-8"));
    let inserted = 0;
    for (const doc of docs) {
      await db.insert(blitzLessonsTable).values({
        title: doc.title,
        category: doc.category,
        content: doc.content,
        tags: doc.tags || "",
        sourceVideoTitle: doc.source_video_title,
        sourceVideoId: doc.source_video_id,
        status:
          doc.status && doc.status !== "pending_review"
            ? doc.status
            : "published",
        adminNotes: doc.admin_notes,
        editedContent: doc.edited_content,
        phase: doc.phase,
        module: doc.module,
        lessonId: doc.lesson_id,
        lessonType: doc.lesson_type,
        networkPath: doc.network_path,
        publisherPath: doc.publisher_path,
        blitzOrder: doc.blitz_order,
      });
      inserted++;
    }
    console.log(`[Blitz Lessons] Seeded ${inserted} lessons from blitz-seed.json`);
  } catch (err) {
    console.error("[Blitz Lessons] Migration/seed failed:", err);
  }
}

// Coaching-call transcript seeding into kb_staging_docs (the AI Document Review
// queue) is intentionally paused while the AI Source Knowledge intake process is
// being mapped out — the review page must stay empty until then. Re-enable by
// setting SEED_COACHING_CALL_DOCS=true (or removing this gate).
const SEED_COACHING_CALL_DOCS = process.env.SEED_COACHING_CALL_DOCS === "true";

export async function seedBlitzDocs() {
  await migrateBlitzLessons();
  if (SEED_COACHING_CALL_DOCS) {
    await seedFromFile("coaching_call", "Coaching Seed", "coaching-seed.json");
  }
}
