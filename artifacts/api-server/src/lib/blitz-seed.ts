import fs from "fs";
import path from "path";
import { db } from "@workspace/db";
import { kbStagingDocsTable } from "@workspace/db/schema";
import { eq, count } from "drizzle-orm";

export async function seedBlitzDocs() {
  try {
    const existing = await db
      .select({ cnt: count() })
      .from(kbStagingDocsTable)
      .where(eq(kbStagingDocsTable.source, "blitz"));

    if (existing[0].cnt > 0) {
      console.log(`[Blitz Seed] ${existing[0].cnt} Blitz docs already exist, skipping seed`);
      return;
    }

    const candidates = [
      path.join(process.cwd(), "src/data/blitz-seed.json"),
      path.join(process.cwd(), "artifacts/api-server/src/data/blitz-seed.json"),
    ];
    const seedPath = candidates.find((p) => fs.existsSync(p));
    if (!seedPath) {
      console.log("[Blitz Seed] No seed file found at", candidates.join(" or "));
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

    console.log(`[Blitz Seed] Seeded ${inserted} Blitz documents`);
  } catch (err) {
    console.error("[Blitz Seed] Error seeding Blitz docs:", err);
  }
}
