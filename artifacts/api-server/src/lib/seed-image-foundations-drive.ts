import fs from "fs";
import path from "path";
import { createHash } from "crypto";
import { db, creativeDriveFoldersTable, creativeDriveFilesTable } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import { objectStorageClient, ObjectStorageService } from "./objectStorage";

/**
 * Image Foundations — Creative Drive boot-seed.
 *
 * Publishes the 8 committed "Image Foundations" PDFs (rendered at build time
 * by scripts/src/render-image-foundations.ts and checked into
 * src/assets/image-foundations/) into a Creative Drive folder named
 * "Image Foundations" (sibling of "Copywriting Foundations"), visible to all
 * members.
 *
 * Clone of seed-copywriting-foundations-drive.ts — same delivery architecture:
 *   1. hash each committed PDF (sha256) and derive a content-addressed object
 *      path `/objects/image-foundations/<slug>-<hash12>.pdf`;
 *   2. upload to object storage ONLY when that object doesn't already exist;
 *   3. upsert the folder row + 8 file rows (sort_order 1-8, series order)
 *      under a pg_advisory_xact_lock so concurrent boots can't double-seed.
 *
 * Idempotency contract:
 *   - Folder keyed by exact name "Image Foundations" (wherever an admin may
 *     have moved it); created at root only when absent.
 *   - File rows keyed by (folderId, sortOrder). Unchanged PDF → zero writes.
 *     Changed PDF (new hash) → row is updated in place to the new objectPath/
 *     size (and canonical display name), never duplicated.
 *   - Rows/objects for old hashes are left behind (cheap, and safer than
 *     deleting content an admin may have re-linked).
 *
 * NOTE: doc 2's markdown filename is frozen as 02-faces-gaze-and-hands.md, but
 * the series was retitled — the committed PDF and every member-visible string
 * use "The Attention Devices" with no trace of the old title.
 *
 * No-ops loudly (warn, no throw) when the asset dir or object storage env is
 * missing (e.g. a fresh env without PRIVATE_OBJECT_DIR).
 */

export const IMAGE_FOUNDATIONS_FOLDER = "Image Foundations";

/** Series order + member-facing display names (numbered, matching each doc's H1). */
export const IMAGE_FOUNDATIONS_FILES: ReadonlyArray<{
  sortOrder: number;
  pdf: string; // committed filename under src/assets/image-foundations
  name: string; // member-facing file name in the Drive
}> = [
  { sortOrder: 1, pdf: "01-the-three-jobs-of-an-ad-image.pdf", name: "1. The Three Jobs of an Ad Image.pdf" },
  { sortOrder: 2, pdf: "02-the-attention-devices.pdf", name: "2. The Attention Devices — Expressive Subjects and the Moment of Use.pdf" },
  { sortOrder: 3, pdf: "03-bounded-curiosity.pdf", name: "3. Bounded Curiosity — Show Less, Earn the Click.pdf" },
  { sortOrder: 4, pdf: "04-color-without-the-folklore.pdf", name: "4. Color Without the Folklore.pdf" },
  { sortOrder: 5, pdf: "05-the-ugc-default.pdf", name: "5. The UGC Default — Why Authentic Beats Produced.pdf" },
  { sortOrder: 6, pdf: "06-congruence-one-idea-through-the-funnel.pdf", name: "6. Congruence — One Idea Through the Whole Funnel.pdf" },
  { sortOrder: 7, pdf: "07-the-seven-bans.pdf", name: "7. The Seven Bans — Images That End Campaigns.pdf" },
  { sortOrder: 8, pdf: "08-from-angle-to-image.pdf", name: "8. From Angle to Image — The Working Process.pdf" },
];

// Advisory lock key pair for this seed (arbitrary but stable/unique;
// distinct from the copywriting seed's 727_2005/1).
const LOCK_KEY_1 = 727_2012;
const LOCK_KEY_2 = 1;

function assetsDir(): string | null {
  const candidates = [
    path.join(process.cwd(), "src/assets/image-foundations"),
    path.join(process.cwd(), "artifacts/api-server/src/assets/image-foundations"),
  ];
  for (const dir of candidates) {
    if (fs.existsSync(dir)) return dir;
  }
  return null;
}

function parseObjectPath(fullPath: string): { bucketName: string; objectName: string } {
  const p = fullPath.startsWith("/") ? fullPath : `/${fullPath}`;
  const parts = p.split("/");
  return { bucketName: parts[1], objectName: parts.slice(2).join("/") };
}

export async function seedImageFoundationsDrive(): Promise<void> {
  const dir = assetsDir();
  if (!dir) {
    console.warn("[Seed] Image Foundations: asset dir missing, skipping");
    return;
  }

  let privateDir: string;
  try {
    privateDir = new ObjectStorageService().getPrivateObjectDir();
  } catch (err) {
    console.warn(
      "[Seed] Image Foundations: object storage not configured, skipping:",
      err instanceof Error ? err.message : err,
    );
    return;
  }
  if (privateDir.endsWith("/")) privateDir = privateDir.slice(0, -1);

  // Read + hash every committed PDF up front; missing files abort loudly
  // (a partial series in the member Drive would be worse than none).
  const entries = IMAGE_FOUNDATIONS_FILES.map((f) => {
    const filePath = path.join(dir, f.pdf);
    const bytes = fs.readFileSync(filePath);
    const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 12);
    const slug = f.pdf.replace(/\.pdf$/, "");
    const objectPath = `/objects/image-foundations/${slug}-${hash}.pdf`;
    return { ...f, bytes, objectPath };
  });

  // Upload any missing objects BEFORE taking the DB lock (uploads are slow and
  // content-addressed, so concurrent uploads of the same bytes are harmless).
  for (const entry of entries) {
    const storagePath = `${privateDir}/image-foundations/${entry.objectPath.split("/").pop()}`;
    const { bucketName, objectName } = parseObjectPath(storagePath);
    const file = objectStorageClient.bucket(bucketName).file(objectName);
    const [exists] = await file.exists();
    if (exists) continue;
    await file.save(entry.bytes, {
      contentType: "application/pdf",
      resumable: false,
    });
    console.log(`[Seed] Image Foundations: uploaded ${entry.objectPath}`);
  }

  await db.transaction(async (tx) => {
    // Serialize concurrent boots (see memory: boot-seed check-then-insert race).
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${LOCK_KEY_1}, ${LOCK_KEY_2})`);

    // Folder: keyed by exact name wherever it lives; create at root if absent.
    const [existingFolder] = await tx
      .select({ id: creativeDriveFoldersTable.id })
      .from(creativeDriveFoldersTable)
      .where(eq(creativeDriveFoldersTable.name, IMAGE_FOUNDATIONS_FOLDER))
      .limit(1);
    let folderId: number;
    if (existingFolder) {
      folderId = existingFolder.id;
    } else {
      const [created] = await tx
        .insert(creativeDriveFoldersTable)
        .values({ name: IMAGE_FOUNDATIONS_FOLDER, parentId: null })
        .returning({ id: creativeDriveFoldersTable.id });
      folderId = created.id;
      console.log(`[Seed] Image Foundations: created Drive folder #${folderId}`);
    }

    for (const entry of entries) {
      const [existing] = await tx
        .select({
          id: creativeDriveFilesTable.id,
          objectPath: creativeDriveFilesTable.objectPath,
        })
        .from(creativeDriveFilesTable)
        .where(
          and(
            eq(creativeDriveFilesTable.folderId, folderId),
            eq(creativeDriveFilesTable.sortOrder, entry.sortOrder),
          ),
        )
        .limit(1);

      if (!existing) {
        await tx.insert(creativeDriveFilesTable).values({
          folderId,
          name: entry.name,
          objectPath: entry.objectPath,
          mimeType: "application/pdf",
          sizeBytes: entry.bytes.length,
          sortOrder: entry.sortOrder,
        });
        console.log(`[Seed] Image Foundations: added "${entry.name}"`);
      } else if (existing.objectPath !== entry.objectPath) {
        // Content changed since the row was seeded — repoint in place.
        await tx
          .update(creativeDriveFilesTable)
          .set({
            name: entry.name,
            objectPath: entry.objectPath,
            mimeType: "application/pdf",
            sizeBytes: entry.bytes.length,
            updatedAt: new Date(),
          })
          .where(eq(creativeDriveFilesTable.id, existing.id));
        console.log(`[Seed] Image Foundations: updated "${entry.name}"`);
      }
      // Unchanged → zero writes.
    }
  });
}
