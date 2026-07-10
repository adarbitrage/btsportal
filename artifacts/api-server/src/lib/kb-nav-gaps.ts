/**
 * Navigation-gap flags (Task #1776).
 *
 * ADVISORY-only persistence + lifecycle around kb_nav_gap_flags. The synthesis
 * pipeline calls {@link recordNavGapsForNode} with per-source extract text; we
 * run the action-verb-gated detector (kb-nav-vocabulary) and upsert one durable
 * row per (app, area):
 *
 *  - re-runs UPDATE counts/nodes instead of duplicating rows;
 *  - a published nav doc that covers the (app, area) suppresses new flags and
 *    auto-resolves the open row ({@link resolveNavGapsForPublishedDoc});
 *  - DISMISSED is sticky — a dismissed row is never re-opened by later runs;
 *  - nothing here ever blocks publishing (best-effort, callers try/catch).
 */

import { db } from "@workspace/db";
import { kbNavGapFlagsTable, aiLiveDocumentsTable, type KbNavGapFlag } from "@workspace/db/schema";
import { and, eq, sql, desc, asc } from "drizzle-orm";
import {
  detectNavActions,
  normalizeNavArea,
  NAV_GENERAL_AREA,
  type NavActionHit,
} from "./kb-nav-vocabulary.js";

/** Whether a published, citable nav doc already covers this (app, area). */
async function hasPublishedNavDoc(app: string, area: string): Promise<boolean> {
  const rows = await db
    .select({ id: aiLiveDocumentsTable.id })
    .from(aiLiveDocumentsTable)
    .where(sql`
      ${aiLiveDocumentsTable.docClass} = 'navigation'
      AND ${aiLiveDocumentsTable.navApp} = ${app}
      AND (${aiLiveDocumentsTable.navArea} = ${area} OR ${aiLiveDocumentsTable.navArea} = ${NAV_GENERAL_AREA})
      AND ${aiLiveDocumentsTable.lastVerified} IS NOT NULL
      AND ${aiLiveDocumentsTable.deletedAt} IS NULL
    `)
    .limit(1);
  return rows.length > 0;
}

/**
 * Record nav-action hits detected in one node's synthesis material. Upserts a
 * flag row per (app, area); adds the node to topicNodes (deduped) and keeps
 * topicCount = distinct node count. Sticky-dismiss: rows with status
 * 'dismissed' are left untouched. Resolved rows are only re-opened when the
 * covering doc no longer exists (e.g. it was soft-deleted).
 */
export async function recordNavGapsForNode(nodeSlug: string, texts: readonly string[]): Promise<void> {
  // Aggregate hits across all of the node's extracts: one (app, area) each.
  const byKey = new Map<string, NavActionHit>();
  for (const text of texts) {
    for (const hit of detectNavActions(text)) {
      const key = `${hit.app.slug}::${normalizeNavArea(hit.area)}`;
      if (!byKey.has(key)) byKey.set(key, hit);
    }
  }

  for (const hit of byKey.values()) {
    const app = hit.app.slug;
    const area = normalizeNavArea(hit.area);
    try {
      // Covered already? Never raise / re-touch.
      if (await hasPublishedNavDoc(app, area)) continue;

      const [existing] = await db
        .select()
        .from(kbNavGapFlagsTable)
        .where(and(eq(kbNavGapFlagsTable.app, app), eq(kbNavGapFlagsTable.area, area)))
        .limit(1);

      if (!existing) {
        await db
          .insert(kbNavGapFlagsTable)
          .values({
            app,
            area,
            status: "open",
            tier: hit.app.tier,
            topicNodes: [nodeSlug],
            topicCount: 1,
            lastEvidence: hit.evidence.slice(0, 500),
            lastSeenAt: new Date(),
          })
          .onConflictDoNothing();
        continue;
      }

      // STICKY dismissal: never re-open or update a dismissed row.
      if (existing.status === "dismissed") continue;

      const nodes = new Set<string>(Array.isArray(existing.topicNodes) ? existing.topicNodes : []);
      nodes.add(nodeSlug);
      await db
        .update(kbNavGapFlagsTable)
        .set({
          // A resolved row only re-opens because the covering doc is gone
          // (hasPublishedNavDoc returned false above).
          status: "open",
          topicNodes: [...nodes],
          topicCount: nodes.size,
          lastEvidence: hit.evidence.slice(0, 500),
          lastSeenAt: new Date(),
        })
        .where(eq(kbNavGapFlagsTable.id, existing.id));
    } catch (err) {
      console.error(`[NavGaps] failed to record flag ${app}/${area}:`, err instanceof Error ? err.message : err);
    }
  }
}

/**
 * Deterministic (non-LLM) cross-link section pointing a concept/process doc at
 * the published navigation walkthroughs for the apps its material references.
 * Appended verbatim to the synthesized body so click-paths stay OUT of prose and
 * the wiring never depends on the model. Returns "" when no app is referenced or
 * none of the referenced apps has a published nav doc.
 */
export async function navDocCrossLinksMarkdown(texts: readonly string[]): Promise<string> {
  const apps = new Set<string>();
  for (const text of texts) {
    for (const hit of detectNavActions(text)) apps.add(hit.app.slug);
  }
  if (apps.size === 0) return "";

  const docs = await db
    .select({
      title: aiLiveDocumentsTable.title,
      navApp: aiLiveDocumentsTable.navApp,
      navArea: aiLiveDocumentsTable.navArea,
    })
    .from(aiLiveDocumentsTable)
    .where(sql`
      ${aiLiveDocumentsTable.docClass} = 'navigation'
      AND ${aiLiveDocumentsTable.navApp} = ANY(${sql.raw(`'{${[...apps].map((a) => a.replace(/[^a-z0-9_-]/gi, "")).join(",")}}'`)}::text[])
      AND ${aiLiveDocumentsTable.lastVerified} IS NOT NULL
      AND ${aiLiveDocumentsTable.deletedAt} IS NULL
    `)
    .orderBy(asc(aiLiveDocumentsTable.navApp), asc(aiLiveDocumentsTable.navArea));
  if (docs.length === 0) return "";

  const bullets = docs.map((d) => `- ${d.title}`);
  return `\n\n## Step-by-step navigation guides\nFor exact click-paths, see these walkthrough docs:\n${bullets.join("\n")}`;
}

/**
 * Auto-resolve open flags matched by a freshly-published navigation doc.
 * A doc covering the 'general' area resolves every open flag for the app;
 * otherwise only the exact (app, area) row. Dismissed rows stay dismissed.
 */
export async function resolveNavGapsForPublishedDoc(doc: {
  id: number;
  navApp: string | null;
  navArea: string | null;
}): Promise<number> {
  if (!doc.navApp) return 0;
  const area = normalizeNavArea(doc.navArea);
  const areaCond =
    area === NAV_GENERAL_AREA
      ? sql`TRUE`
      : sql`${kbNavGapFlagsTable.area} = ${area}`;
  const resolved = await db
    .update(kbNavGapFlagsTable)
    .set({ status: "resolved", resolvedAt: new Date(), resolvedByDocId: doc.id })
    .where(and(
      eq(kbNavGapFlagsTable.app, doc.navApp),
      eq(kbNavGapFlagsTable.status, "open"),
      areaCond,
    ))
    .returning({ id: kbNavGapFlagsTable.id });
  return resolved.length;
}

/** List flags. Open first sorted by topicCount desc then tier; includes dismissed/resolved when asked. */
export async function listNavGapFlags(opts?: { includeClosed?: boolean; app?: string }): Promise<KbNavGapFlag[]> {
  const conds = [];
  if (!opts?.includeClosed) conds.push(eq(kbNavGapFlagsTable.status, "open"));
  if (opts?.app) conds.push(eq(kbNavGapFlagsTable.app, opts.app));
  const where = conds.length > 0 ? and(...conds) : undefined;
  return db
    .select()
    .from(kbNavGapFlagsTable)
    .where(where)
    .orderBy(
      sql`CASE ${kbNavGapFlagsTable.status} WHEN 'open' THEN 0 WHEN 'dismissed' THEN 1 ELSE 2 END`,
      asc(kbNavGapFlagsTable.tier),
      desc(kbNavGapFlagsTable.topicCount),
      asc(kbNavGapFlagsTable.app),
      asc(kbNavGapFlagsTable.area),
    );
}

/** Dismiss a flag — sticky forever unless an admin manually re-opens. */
export async function dismissNavGapFlag(id: number, adminUserId: number): Promise<KbNavGapFlag | null> {
  const [row] = await db
    .update(kbNavGapFlagsTable)
    .set({ status: "dismissed", dismissedAt: new Date(), dismissedBy: adminUserId })
    .where(eq(kbNavGapFlagsTable.id, id))
    .returning();
  return row ?? null;
}

/** Re-open a dismissed/resolved flag (manual admin action only). */
export async function reopenNavGapFlag(id: number): Promise<KbNavGapFlag | null> {
  const [row] = await db
    .update(kbNavGapFlagsTable)
    .set({ status: "open", dismissedAt: null, dismissedBy: null, resolvedAt: null, resolvedByDocId: null })
    .where(eq(kbNavGapFlagsTable.id, id))
    .returning();
  return row ?? null;
}

/**
 * Merge one flag's area into another (same app): union topic nodes + counts on
 * the target, delete the source row. Used by review to consolidate near-
 * duplicate free-form area labels.
 */
export async function mergeNavGapFlags(sourceId: number, targetId: number): Promise<KbNavGapFlag | null> {
  if (sourceId === targetId) return null;
  return db.transaction(async (tx) => {
    const [source] = await tx.select().from(kbNavGapFlagsTable).where(eq(kbNavGapFlagsTable.id, sourceId)).limit(1);
    const [target] = await tx.select().from(kbNavGapFlagsTable).where(eq(kbNavGapFlagsTable.id, targetId)).limit(1);
    if (!source || !target) return null;
    if (source.app !== target.app) throw new Error("Can only merge areas within the same app");
    const nodes = new Set<string>([
      ...(Array.isArray(target.topicNodes) ? target.topicNodes : []),
      ...(Array.isArray(source.topicNodes) ? source.topicNodes : []),
    ]);
    const [updated] = await tx
      .update(kbNavGapFlagsTable)
      .set({
        topicNodes: [...nodes],
        topicCount: nodes.size,
        lastEvidence: target.lastEvidence ?? source.lastEvidence,
        lastSeenAt: new Date(),
      })
      .where(eq(kbNavGapFlagsTable.id, targetId))
      .returning();
    await tx.delete(kbNavGapFlagsTable).where(eq(kbNavGapFlagsTable.id, sourceId));
    return updated ?? null;
  });
}
