import { eq, sql } from "drizzle-orm";
import {
  aiLiveDocumentsTable,
  aiLiveDocumentVersionsTable,
  kbDocProvenanceTable,
} from "@workspace/db/schema";

// ── Live-doc version snapshot seam (Task #2098) ─────────────────────────────
//
// INCIDENT: on 2026-08-04 seven rich, human-reviewed Live AI Documents were
// silently overwritten because a writer (test fixture upsert) bypassed the
// version-snapshot logic that only lived inline in the push endpoint's update
// path. THE RULE: every code path that overwrites the body (title/content) or
// taxonomy of an EXISTING ai_live_documents row must snapshot the prior state
// into ai_live_document_versions FIRST, in the same transaction. This module
// is the single shared implementation.
//
// Also: never hard-delete ai_live_documents rows — version history has
// ON DELETE CASCADE, so a hard delete destroys the snapshots too. Soft-delete
// (deleted_at) only.

type DbOrTx = {
  select: typeof import("@workspace/db").db.select;
  insert: typeof import("@workspace/db").db.insert;
  execute: typeof import("@workspace/db").db.execute;
};

export type LiveDocSnapshotSource = {
  id: number;
  title: string;
  content: string;
  docClass: string | null;
  homeRoot: string | null;
  node: string | null;
  lastVerified: Date | null;
};

/**
 * Snapshot the CURRENT state of a live doc into ai_live_document_versions.
 * Call inside the same transaction as the overwrite, BEFORE writing.
 *
 * Pass the already-selected row when you have it (avoids a re-read); pass an
 * id to have the helper read it. Returns the new version number, or null when
 * the doc does not exist (nothing to snapshot).
 */
export async function snapshotLiveDocVersion(
  tx: DbOrTx,
  docOrId: LiveDocSnapshotSource | number,
  opts: { supersededByStagingDocId?: number | null } = {},
): Promise<number | null> {
  let doc: LiveDocSnapshotSource | undefined;
  if (typeof docOrId === "number") {
    const [row] = await tx
      .select()
      .from(aiLiveDocumentsTable)
      .where(eq(aiLiveDocumentsTable.id, docOrId));
    doc = row as LiveDocSnapshotSource | undefined;
  } else {
    doc = docOrId;
  }
  if (!doc) return null;

  const res = await tx.execute(sql`
    SELECT count(*)::int AS cnt FROM ai_live_document_versions WHERE doc_id = ${doc.id}
  `);
  const priorVersions = Number((res.rows[0] as { cnt: number }).cnt);

  const priorProvenance = await tx
    .select({
      sourceId: kbDocProvenanceTable.sourceId,
      chunkRef: kbDocProvenanceTable.chunkRef,
      relation: kbDocProvenanceTable.relation,
    })
    .from(kbDocProvenanceTable)
    .where(eq(kbDocProvenanceTable.docId, doc.id));

  const versionNumber = priorVersions + 1;
  await tx.insert(aiLiveDocumentVersionsTable).values({
    docId: doc.id,
    versionNumber,
    title: doc.title,
    content: doc.content,
    docClass: doc.docClass,
    homeRoot: doc.homeRoot,
    node: doc.node,
    lastVerified: doc.lastVerified,
    provenance: priorProvenance,
    supersededByStagingDocId: opts.supersededByStagingDocId ?? null,
  });
  return versionNumber;
}
