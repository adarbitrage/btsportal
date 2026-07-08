/**
 * Boot-time portal-navigation drift scan (Task #1778, step 4).
 *
 * The portal nav map (@workspace/portal-nav-map) is content-hashed into a
 * version (see kb-nav-grounding.ts). Every synthesized truth draft is stamped
 * with the version it was written against. On boot (right after the seeded
 * Operations navigation doc refreshes) this scan:
 *
 *   1. Reads the latest stored nav-map snapshot (kb_nav_map_versions).
 *   2. If the current map's version differs, diffs OLD vs NEW to find CHANGED
 *      locations (removed / renamed / description-changed paths — additions
 *      never invalidate existing docs).
 *   3. Flags, ADVISORY-only (never auto-edits content):
 *      - pending truth drafts in kb_staging_docs that mention a changed
 *        location and were stamped against an older map → appends a
 *        `navigation_drift` risk flag (surfaced as a review-queue chip);
 *      - published citable docs in ai_live_documents that mention a changed
 *        location → sets flaggedStaleAt/flaggedReason (the existing
 *        re-verification surface in the AI Live Documents admin).
 *   4. Records the current version + snapshot so the next change diffs against
 *      it.
 *
 * Idempotent: same version → no-op; a doc already flagged (stale flag set /
 * drift risk-flag present) is never double-flagged.
 */

import { db } from "@workspace/db";
import { kbStagingDocsTable, kbNavMapVersionsTable, aiLiveDocumentsTable } from "@workspace/db/schema";
import { sql, eq, and, isNull, inArray, desc } from "drizzle-orm";
import {
  canonicalNavMapSnapshot,
  computeNavMapVersion,
  diffNavMaps,
  changeReferenceTokens,
  type NavItem,
  type NavMapChange,
} from "@workspace/portal-nav-map";

const DRIFT_FLAG_TYPE = "navigation_drift";

function mentionsAnyToken(content: string, tokens: readonly string[]): string | null {
  const lower = content.toLowerCase();
  for (const t of tokens) {
    if (t.length < 3) continue;
    if (lower.includes(t.toLowerCase())) return t;
  }
  return null;
}

function describeChanges(changes: readonly NavMapChange[]): string {
  return changes
    .filter((c) => c.kind !== "added")
    .map((c) => {
      if (c.kind === "removed") return `"${c.oldLabel}" (${c.path}) was removed`;
      if (c.kind === "renamed") return `"${c.oldLabel}" is now "${c.newLabel}" (${c.path})`;
      return `"${c.newLabel ?? c.oldLabel}" (${c.path}) changed`;
    })
    .join("; ");
}

export interface NavDriftScanResult {
  currentVersion: string;
  changed: boolean;
  flaggedStagingDocs: number;
  flaggedLiveDocs: number;
}

export async function runNavigationDriftScan(): Promise<NavDriftScanResult> {
  const currentVersion = computeNavMapVersion();
  const currentSnapshot = canonicalNavMapSnapshot();

  const [latest] = await db
    .select()
    .from(kbNavMapVersionsTable)
    .orderBy(desc(kbNavMapVersionsTable.id))
    .limit(1);

  const recordCurrent = async () => {
    await db
      .insert(kbNavMapVersionsTable)
      .values({ version: currentVersion, snapshot: currentSnapshot })
      .onConflictDoNothing({ target: kbNavMapVersionsTable.version });
  };

  if (!latest) {
    // First boot with the feature: baseline only, nothing to diff against.
    await recordCurrent();
    return { currentVersion, changed: false, flaggedStagingDocs: 0, flaggedLiveDocs: 0 };
  }
  if (latest.version === currentVersion) {
    return { currentVersion, changed: false, flaggedStagingDocs: 0, flaggedLiveDocs: 0 };
  }

  const oldItems = (latest.snapshot ?? []) as NavItem[];
  const changes = diffNavMaps(oldItems, currentSnapshot);
  const tokens = changeReferenceTokens(changes);
  const changeSummary = describeChanges(changes);

  let flaggedStagingDocs = 0;
  let flaggedLiveDocs = 0;

  if (tokens.length > 0) {
    // 1. Pending truth drafts written against an older map.
    const pendingDrafts = await db
      .select({
        id: kbStagingDocsTable.id,
        content: kbStagingDocsTable.content,
        editedContent: kbStagingDocsTable.editedContent,
        riskFlags: kbStagingDocsTable.riskFlags,
        navMapVersion: kbStagingDocsTable.navMapVersion,
      })
      .from(kbStagingDocsTable)
      .where(
        and(
          eq(kbStagingDocsTable.docType, "truth_draft"),
          inArray(kbStagingDocsTable.status, ["pending_review", "needs_review"]),
        ),
      );

    for (const draft of pendingDrafts) {
      if (draft.navMapVersion === currentVersion) continue;
      const flags = Array.isArray(draft.riskFlags) ? draft.riskFlags : [];
      if (flags.some((f) => f?.type === DRIFT_FLAG_TYPE)) continue;
      const text = draft.editedContent ?? draft.content ?? "";
      const hit = mentionsAnyToken(text, tokens);
      if (!hit) continue;
      const newFlags = [
        ...flags,
        {
          type: DRIFT_FLAG_TYPE,
          severity: "medium",
          message: "Portal navigation changed since this draft was written",
          detail: `Draft references "${hit}". Changes: ${changeSummary}`.slice(0, 800),
        },
      ];
      await db
        .update(kbStagingDocsTable)
        .set({ riskFlags: newFlags })
        .where(eq(kbStagingDocsTable.id, draft.id));
      flaggedStagingDocs++;
    }

    // 2. Published citable docs referencing a changed location → the existing
    //    re-verification surface (flaggedStaleAt/flaggedReason).
    const liveDocs = await db
      .select({
        id: aiLiveDocumentsTable.id,
        content: aiLiveDocumentsTable.content,
      })
      .from(aiLiveDocumentsTable)
      .where(and(isNull(aiLiveDocumentsTable.deletedAt), isNull(aiLiveDocumentsTable.flaggedStaleAt)));

    for (const doc of liveDocs) {
      const hit = mentionsAnyToken(doc.content ?? "", tokens);
      if (!hit) continue;
      await db
        .update(aiLiveDocumentsTable)
        .set({
          flaggedStaleAt: new Date(),
          flaggedReason:
            `Portal navigation changed: doc references "${hit}". ${changeSummary}`.slice(0, 800),
        })
        .where(eq(aiLiveDocumentsTable.id, doc.id));
      flaggedLiveDocs++;
    }
  }

  await recordCurrent();
  console.log(
    `[NavDriftScan] nav map changed (${latest.version} → ${currentVersion}); flagged ${flaggedStagingDocs} draft(s), ${flaggedLiveDocs} live doc(s)`,
  );
  return { currentVersion, changed: true, flaggedStagingDocs, flaggedLiveDocs };
}
