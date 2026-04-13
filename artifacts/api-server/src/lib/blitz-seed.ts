import fs from "fs";
import path from "path";
import { db } from "@workspace/db";
import { kbStagingDocsTable } from "@workspace/db/schema";
import { eq, count } from "drizzle-orm";

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

    const candidates = [
      path.join(process.cwd(), "src/data", filename),
      path.join(process.cwd(), "artifacts/api-server/src/data", filename),
    ];
    const seedPath = candidates.find((p) => fs.existsSync(p));
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

export async function seedBlitzDocs() {
  await seedFromFile("blitz", "Blitz Seed", "blitz-seed.json");
  await seedFromFile("coaching_call", "Coaching Seed", "coaching-seed.json");
}
