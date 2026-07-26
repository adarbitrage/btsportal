import fs from "fs";
import path from "path";
import { createHash } from "crypto";
import { db, creativeDriveFoldersTable, creativeDriveFilesTable } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import { objectStorageClient, ObjectStorageService } from "./objectStorage";

/**
 * Copywriting Foundations — Creative Drive boot-seed (Task #2005).
 *
 * Publishes the 8 committed "Copywriting Foundations" PDFs (rendered at build
 * time by scripts/src/render-copywriting-foundations.ts and checked into
 * src/assets/copywriting-foundations/) into a Creative Drive folder named
 * "Copywriting Foundations", visible to all members (the Creative Drive has
 * no per-folder gating; access rides the existing `creative-drive` page key).
 *
 * Delivery architecture: this seed IS the prod delivery mechanism — dev-side
 * uploads/DB rows don't survive the merge/publish path, so on every boot we:
 *   1. hash each committed PDF (sha256) and derive a content-addressed object
 *      path `/objects/copywriting-foundations/<slug>-<hash12>.pdf`;
 *   2. upload to object storage ONLY when that object doesn't already exist
 *      (content-addressing makes re-upload checks a pure existence test);
 *   3. upsert the folder row + 8 file rows (sort_order 1-8, series order)
 *      under a pg_advisory_xact_lock so concurrent boots can't double-seed.
 *
 * Idempotency contract:
 *   - Folder keyed by exact name "Copywriting Foundations" (wherever an admin
 *     may have moved it); created at root only when absent.
 *   - File rows keyed by (folderId, sortOrder). Unchanged PDF → zero writes.
 *     Changed PDF (new hash) → row is updated in place to the new objectPath/
 *     size (and canonical display name), never duplicated.
 *   - Rows/objects for old hashes are left behind (cheap, and safer than
 *     deleting content an admin may have re-linked).
 *   - Existing "Headline Writing" / "Angles" folders are never touched.
 *
 * No-ops loudly (warn, no throw) when the asset dir or object storage env is
 * missing (e.g. a fresh env without PRIVATE_OBJECT_DIR).
 */

export const COPYWRITING_FOUNDATIONS_FOLDER = "Copywriting Foundations";

/** Series order + member-facing display names (Rulings 5-8). */
export const COPYWRITING_FOUNDATIONS_FILES: ReadonlyArray<{
  sortOrder: number;
  pdf: string; // committed filename under src/assets/copywriting-foundations
  name: string; // member-facing file name in the Drive
}> = [
  { sortOrder: 1, pdf: "01-what-a-headline-actually-does.pdf", name: "1. What a Headline Actually Does.pdf" },
  { sortOrder: 2, pdf: "02-selling-the-benefit-not-the-product.pdf", name: "2. Selling the Benefit, Not the Product.pdf" },
  { sortOrder: 3, pdf: "03-curiosity-withholding-the-how.pdf", name: "3. Curiosity — Withholding the How.pdf" },
  { sortOrder: 4, pdf: "04-finding-your-angle.pdf", name: "4. Finding Your Angle.pdf" },
  { sortOrder: 5, pdf: "05-believability-and-proof.pdf", name: "5. Believability and Proof.pdf" },
  { sortOrder: 6, pdf: "06-headline-formulas-and-the-swipe-file.pdf", name: "6. Headline Formulas and the Swipe File.pdf" },
  { sortOrder: 7, pdf: "07-word-choice-context-and-power.pdf", name: "7. Word Choice — Context and Power.pdf" },
  { sortOrder: 8, pdf: "08-headline-word-palette.pdf", name: "8. The Headline Word Palette.pdf" },
];

// Advisory lock key pair for this seed (arbitrary but stable/unique).
const LOCK_KEY_1 = 727_2005;
const LOCK_KEY_2 = 1;

function assetsDir(): string | null {
  const candidates = [
    path.join(process.cwd(), "src/assets/copywriting-foundations"),
    path.join(process.cwd(), "artifacts/api-server/src/assets/copywriting-foundations"),
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

export async function seedCopywritingFoundationsDrive(): Promise<void> {
  const dir = assetsDir();
  if (!dir) {
    console.warn("[Seed] Copywriting Foundations: asset dir missing, skipping");
    return;
  }

  let privateDir: string;
  try {
    privateDir = new ObjectStorageService().getPrivateObjectDir();
  } catch (err) {
    console.warn(
      "[Seed] Copywriting Foundations: object storage not configured, skipping:",
      err instanceof Error ? err.message : err,
    );
    return;
  }
  if (privateDir.endsWith("/")) privateDir = privateDir.slice(0, -1);

  // Read + hash every committed PDF up front; missing files abort loudly
  // (a partial series in the member Drive would be worse than none).
  const entries = COPYWRITING_FOUNDATIONS_FILES.map((f) => {
    const filePath = path.join(dir, f.pdf);
    const bytes = fs.readFileSync(filePath);
    const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 12);
    const slug = f.pdf.replace(/\.pdf$/, "");
    const objectPath = `/objects/copywriting-foundations/${slug}-${hash}.pdf`;
    return { ...f, bytes, objectPath };
  });

  // Upload any missing objects BEFORE taking the DB lock (uploads are slow and
  // content-addressed, so concurrent uploads of the same bytes are harmless).
  for (const entry of entries) {
    const storagePath = `${privateDir}/copywriting-foundations/${entry.objectPath.split("/").pop()}`;
    const { bucketName, objectName } = parseObjectPath(storagePath);
    const file = objectStorageClient.bucket(bucketName).file(objectName);
    const [exists] = await file.exists();
    if (exists) continue;
    await file.save(entry.bytes, {
      contentType: "application/pdf",
      resumable: false,
    });
    console.log(`[Seed] Copywriting Foundations: uploaded ${entry.objectPath}`);
  }

  await db.transaction(async (tx) => {
    // Serialize concurrent boots (see memory: boot-seed check-then-insert race).
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${LOCK_KEY_1}, ${LOCK_KEY_2})`);

    // Folder: keyed by exact name wherever it lives; create at root if absent.
    const [existingFolder] = await tx
      .select({ id: creativeDriveFoldersTable.id })
      .from(creativeDriveFoldersTable)
      .where(eq(creativeDriveFoldersTable.name, COPYWRITING_FOUNDATIONS_FOLDER))
      .limit(1);
    let folderId: number;
    if (existingFolder) {
      folderId = existingFolder.id;
    } else {
      const [created] = await tx
        .insert(creativeDriveFoldersTable)
        .values({ name: COPYWRITING_FOUNDATIONS_FOLDER, parentId: null })
        .returning({ id: creativeDriveFoldersTable.id });
      folderId = created.id;
      console.log(
        `[Seed] Copywriting Foundations: created Drive folder #${folderId}`,
      );
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
        console.log(`[Seed] Copywriting Foundations: added "${entry.name}"`);
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
        console.log(`[Seed] Copywriting Foundations: updated "${entry.name}"`);
      }
      // Unchanged → zero writes.
    }
  });
}
