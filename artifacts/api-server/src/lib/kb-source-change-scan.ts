import { db } from "@workspace/db";
import {
  aiSourceDocumentsTable,
  kbSourceNodeLinksTable,
  aiLiveDocumentsTable,
} from "@workspace/db/schema";
import { eq, inArray, sql } from "drizzle-orm";
import { fingerprintContent } from "./kb-source-windows.js";
import { callLLM } from "./kb-synthesis.js";
import {
  buildCoreTrainingSourceDocs,
  type CoreTrainingSourceDoc,
} from "./seed-core-training-sources.js";

/**
 * Blitz change-monitoring foundation (Task #1564) — DORMANT.
 *
 * This is the plumbing that lets an admin detect when the core-training source
 * material (the 7 Pillars / Pillars→Blitz prose + the Blitz curriculum lessons)
 * has changed since it was last filed into `ai_source_documents`, and — for the
 * changes that are MATERIAL — propose a revision of the AI reference doc(s)
 * synthesized from that material.
 *
 * It is intentionally OFF by default:
 *   - Nothing here runs on boot and nothing is scheduled.
 *   - The ONLY caller is the admin-only `/scan-core-training-changes` endpoint,
 *     which is reachable only from a DISABLED "Scan for changes" button in the
 *     AI Document Review synthesis toolbar.
 *   - It reuses the EXISTING supersede path: change proposals are created by the
 *     normal synthesis run (`synthesizeNode`), which authors an `update` draft
 *     (update_kind='update', target_live_doc_id, update_summary) whenever the
 *     affected node already has a published Live AI Document. The human approval
 *     gate is unchanged — this only proposes, never publishes.
 */

/** A core-training source whose current content differs from its stored hash. */
export interface SourceChange {
  sourceDocId: number;
  title: string;
  priorHash: string | null;
  newHash: string;
  /** Whether the LLM judged the change MATERIAL (facts/steps/rules changed). */
  material: boolean;
  /** Short human-readable reason from the significance check. */
  reason: string;
}

export interface ScanResult {
  /** How many core-training sources were examined. */
  scanned: number;
  /** Sources whose content fingerprint changed since the last scan. */
  changed: SourceChange[];
  /** The subset of `changed` the significance filter judged material. */
  material: SourceChange[];
  /**
   * Taxonomy nodes that (a) are linked to a materially-changed source AND
   * (b) already have a published Live AI Document — i.e. the nodes whose
   * reference doc a synthesis run would propose a REVISION of. De-duplicated.
   */
  affectedNodes: string[];
}

/**
 * LLM significance filter: is the edit between the previously-stored source and
 * its current content MATERIAL (facts, steps, numbers, rules, definitions
 * changed/added/removed) or trivial (typos, formatting, whitespace, reword with
 * the same meaning)? Fails OPEN (material=true) when the LLM is unavailable so a
 * genuine change is never silently dropped — a human still reviews every draft.
 */
async function isSignificantChange(
  title: string,
  priorContent: string,
  newContent: string,
): Promise<{ material: boolean; reason: string }> {
  const fallback = {
    material: true,
    reason: "Significance check unavailable — flagged for human review.",
  };
  try {
    const system =
      `You decide whether an edit to a TRAINING SOURCE document is MATERIAL. ` +
      `MATERIAL = facts, steps, numbers, rules, definitions, or instructions ` +
      `were added, removed, or changed in meaning. TRIVIAL = typos, ` +
      `punctuation, whitespace, formatting, or rewording that preserves the ` +
      `same meaning. Respond ONLY as JSON: ` +
      `{"material": boolean, "reason": "<one short sentence>"}.`;
    const user =
      `TITLE: ${title}\n\n=== PREVIOUS ===\n${priorContent.slice(0, 6000)}\n\n` +
      `=== CURRENT ===\n${newContent.slice(0, 6000)}`;
    const out = await callLLM(system, user, 300, true);
    const parsed = JSON.parse(out) as { material?: unknown; reason?: unknown };
    return {
      material: Boolean(parsed.material),
      reason:
        typeof parsed.reason === "string" && parsed.reason.trim()
          ? parsed.reason.trim()
          : "Change detected.",
    };
  } catch (err) {
    console.error(
      "[SourceChangeScan] significance check failed:",
      err instanceof Error ? err.message : err,
    );
    return fallback;
  }
}

/** Nodes that a set of source docs are linked to that ALSO have a published live doc. */
async function affectedNodesWithLiveDocs(sourceDocIds: number[]): Promise<string[]> {
  if (sourceDocIds.length === 0) return [];
  const links = await db
    .select({ node: kbSourceNodeLinksTable.node })
    .from(kbSourceNodeLinksTable)
    .where(inArray(kbSourceNodeLinksTable.sourceDocId, sourceDocIds));
  const candidateNodes = [...new Set(links.map((l) => l.node))];
  if (candidateNodes.length === 0) return [];

  // Keep only nodes with a published, citable, non-atomic live doc — the ones a
  // synthesis run would author a REVISION of (mirrors findLiveDocForNode's
  // predicate in kb-synthesis).
  const published = await db
    .select({ node: aiLiveDocumentsTable.node })
    .from(aiLiveDocumentsTable)
    .where(sql`
      ${aiLiveDocumentsTable.node} IN (${sql.join(
        candidateNodes.map((n) => sql`${n}`),
        sql`, `,
      )})
      AND ${aiLiveDocumentsTable.docClass} IN ('curated','overview')
      AND ${aiLiveDocumentsTable.lastVerified} IS NOT NULL
      AND ${aiLiveDocumentsTable.audience} <> 'admin'
      AND ${aiLiveDocumentsTable.deletedAt} IS NULL
      AND ${aiLiveDocumentsTable.title} NOT ILIKE 'What is %'
    `);
  return [
    ...new Set(
      published
        .map((r) => r.node)
        .filter((n): n is string => typeof n === "string" && n.length > 0),
    ),
  ];
}

/**
 * Scan the core-training sources for content changes.
 *
 * For every canonical core-training source doc (built live from the prose +
 * `blitz_lessons`), find its existing `ai_source_documents` row by title and:
 *   1. Refresh its content to the current canonical body.
 *   2. Recompute the content fingerprint and compare to the stored `contentHash`.
 *      A difference means the source changed since the last scan/seed.
 *   3. For each changed source, run the LLM significance filter.
 *   4. Stamp `contentHash` (new) + `lastScannedAt` (now) on every examined row.
 *
 * Sources that don't yet exist as rows are skipped (the boot seed creates them);
 * this scan is strictly about detecting CHANGES to already-filed sources.
 *
 * Returns the changed/material sources and the affected nodes that have a
 * published live doc — the input the endpoint feeds to the normal synthesis run
 * to author revision proposals through the existing supersede path.
 */
export async function scanCoreTrainingSourceChanges(): Promise<ScanResult> {
  const canonical: CoreTrainingSourceDoc[] = await buildCoreTrainingSourceDocs();

  const existing = await db
    .select({
      id: aiSourceDocumentsTable.id,
      title: aiSourceDocumentsTable.title,
      content: aiSourceDocumentsTable.content,
      contentHash: aiSourceDocumentsTable.contentHash,
    })
    .from(aiSourceDocumentsTable);
  const byTitle = new Map(existing.map((r) => [r.title.trim(), r]));

  const now = new Date();
  const changed: SourceChange[] = [];
  let scanned = 0;

  for (const doc of canonical) {
    const row = byTitle.get(doc.title.trim());
    if (!row) continue; // not filed yet — the seed owns creation.
    scanned += 1;

    const newHash = fingerprintContent(doc.content);
    const priorHash = row.contentHash;
    const contentChanged = row.content !== doc.content;
    const hashChanged = priorHash !== newHash;

    if (contentChanged || hashChanged) {
      const priorContent = row.content;
      // Refresh the stored source content + fingerprint to the current body.
      await db
        .update(aiSourceDocumentsTable)
        .set({ content: doc.content, contentHash: newHash, lastScannedAt: now })
        .where(eq(aiSourceDocumentsTable.id, row.id));

      const { material, reason } = await isSignificantChange(
        doc.title,
        priorContent,
        doc.content,
      );
      changed.push({
        sourceDocId: row.id,
        title: doc.title,
        priorHash,
        newHash,
        material,
        reason,
      });
    } else {
      // Unchanged — just record that we scanned it.
      await db
        .update(aiSourceDocumentsTable)
        .set({ lastScannedAt: now })
        .where(eq(aiSourceDocumentsTable.id, row.id));
    }
  }

  const material = changed.filter((c) => c.material);
  const affectedNodes = await affectedNodesWithLiveDocs(
    material.map((c) => c.sourceDocId),
  );

  return { scanned, changed, material, affectedNodes };
}
