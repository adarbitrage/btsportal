/**
 * Gated import of triaged transcripts (Task #1484).
 *
 * Reads the APPROVED triage manifest produced by the planning task (#1483,
 * `docs/transcript-triage/manifest.json`) and loads the keeper transcripts from
 * the legacy `knowledgebase_docs` corpus (doc_class='transcript') into the
 * Transcript Cleaner holding store (`transcript_cleaner_documents`, plan #1468).
 *
 * What it does:
 *   - Stitches every multi-part keeper group into ONE combined transcript
 *     (parts in `partOrder`, joined with a single space — no headings or blank
 *     lines between parts), and passes single-part keepers through as-is.
 *   - Skips `duplicateDropDocIds` (never read) and any exclude-disposition group.
 *   - Titles each combined document from the manifest `proposedTitle` (never the
 *     raw "(Part N)" chunk titles).
 *   - Tags each document with its transcriptType (folder slug) + authorityRole
 *     and sets status 'uploaded', ready for the cleaner.
 *
 * What it does NOT do: clean or file anything (that's the cleaner's job).
 *
 * It is GATED — nothing imports automatically; an admin must explicitly trigger
 * it. The import is idempotent: each created holding-store row carries a
 * provenance marker naming its manifest group, so a re-run skips groups that
 * were already imported rather than duplicating them.
 */
import fs from "node:fs";
import path from "node:path";
import { db as defaultDb, transcriptCleanerDocumentsTable, knowledgebaseDocsTable } from "@workspace/db";
import { inArray, like } from "drizzle-orm";
import {
  resolveSourceFolderByLabel,
  AUTHORITY_ROLES,
  DEFAULT_AUTHORITY_ROLE,
  type AuthorityRole,
} from "./kb-taxonomy.js";

type Db = typeof defaultDb;

/** The planning task whose approved manifest this import consumes. */
export const IMPORT_MANIFEST_TASK = 1483;
/**
 * Stable, human-readable provenance marker stamped on every imported row. The
 * group id appears in a fixed form so a re-run can recover the already-imported
 * set by parsing it back out — see {@link parseImportedGroupId}.
 */
export const IMPORT_PROVENANCE_PREFIX = "Imported from transcript triage manifest #1483";

const MANIFEST_RELATIVE_PATH = path.join("docs", "transcript-triage", "manifest.json");

// ───────────────────────────────────────────────────────────────────────────
// Manifest shape (only the fields this import relies on).
// ───────────────────────────────────────────────────────────────────────────

export interface ManifestGroup {
  groupId: string;
  title: string;
  disposition: "keep" | "exclude";
  folder?: string;
  authorityRole?: string;
  proposedTitle?: string;
  titleRenamed?: boolean;
  reason?: string;
  keepDocIds: number[];
  partOrder: (number | null)[];
  duplicateDropDocIds: number[];
}

export interface TranscriptManifest {
  task: number;
  description?: string;
  generatedAt?: string;
  groups: ManifestGroup[];
}

// ───────────────────────────────────────────────────────────────────────────
// Manifest loading.
// ───────────────────────────────────────────────────────────────────────────

/**
 * Walk up from `process.cwd()` looking for the manifest, so the import works
 * whether the server runs from the repo root or the api-server artifact dir.
 */
export function findManifestPath(startDir: string = process.cwd()): string | null {
  let dir = path.resolve(startDir);
  for (let i = 0; i < 8; i += 1) {
    const candidate = path.join(dir, MANIFEST_RELATIVE_PATH);
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

export function loadManifest(startDir?: string): TranscriptManifest {
  const file = findManifestPath(startDir);
  if (!file) {
    throw new Error(
      `Triage manifest not found (looked for ${MANIFEST_RELATIVE_PATH} from ${process.cwd()} upward). ` +
        "It is produced by the triage planning task (#1483).",
    );
  }
  const parsed = JSON.parse(fs.readFileSync(file, "utf-8")) as TranscriptManifest;
  if (!parsed || !Array.isArray(parsed.groups)) {
    throw new Error(`Triage manifest at ${file} is malformed (no groups array).`);
  }
  return parsed;
}

// ───────────────────────────────────────────────────────────────────────────
// Provenance marker helpers (idempotency).
// ───────────────────────────────────────────────────────────────────────────

/** Build the provenance note stamped onto an imported holding-store row. */
export function buildProvenanceNote(group: ManifestGroup): string {
  const partCount = group.keepDocIds.length;
  const partLabel = partCount > 1 ? `stitched from ${partCount} parts (ids ${group.keepDocIds.join(", ")})` : "single part";
  return `${IMPORT_PROVENANCE_PREFIX} — group ${group.groupId} (${partLabel}).`;
}

const GROUP_ID_RE = new RegExp(`${IMPORT_PROVENANCE_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} — group (G\\d+)`);

/** Recover the manifest group id from a stamped provenance note, if present. */
export function parseImportedGroupId(note: string | null | undefined): string | null {
  if (!note) return null;
  const m = GROUP_ID_RE.exec(note);
  return m ? m[1] : null;
}

// ───────────────────────────────────────────────────────────────────────────
// Stitching.
// ───────────────────────────────────────────────────────────────────────────

/**
 * Stitch ordered part contents into one combined transcript: trim each part,
 * drop empties, and join with a SINGLE SPACE (no heading / blank line between
 * parts — per the triage findings the parts are one continuous recording).
 */
export function stitchParts(contents: string[]): string {
  return contents
    .map((c) => (c ?? "").trim())
    .filter((c) => c.length > 0)
    .join(" ");
}

/**
 * Return the group's keeper doc ids in the manifest's approved part order.
 *
 * `partOrder` is parallel to `keepDocIds` and carries each part's sequence rank
 * (1-based; `null` for single-part / unordered keepers). We sort the ids by that
 * rank so the stitched transcript honors the triage ordering contract rather
 * than assuming `keepDocIds` is already sequenced. The sort is stable (ties and
 * nulls keep their original relative position).
 */
export function orderedKeepDocIds(group: ManifestGroup): number[] {
  const order = group.partOrder ?? [];
  return group.keepDocIds
    .map((id, index) => ({ id, index, rank: order[index] }))
    .sort((a, b) => {
      const ra = a.rank == null ? Number.POSITIVE_INFINITY : a.rank;
      const rb = b.rank == null ? Number.POSITIVE_INFINITY : b.rank;
      if (ra !== rb) return ra - rb;
      return a.index - b.index;
    })
    .map((p) => p.id);
}

// ───────────────────────────────────────────────────────────────────────────
// Planning.
// ───────────────────────────────────────────────────────────────────────────

export type PlanAction =
  | "import"
  | "skip_excluded"
  | "skip_already_imported"
  | "skip_unknown_folder"
  | "skip_missing_sources"
  | "skip_empty_content";

export interface PlanEntry {
  groupId: string;
  originalTitle: string;
  proposedTitle: string | null;
  titleRenamed: boolean;
  folder: string | null;
  transcriptType: string | null;
  authorityRole: AuthorityRole | null;
  partCount: number;
  duplicatePartsDropped: number;
  action: PlanAction;
  reason?: string;
}

export interface ImportSummary {
  manifestTask: number;
  generatedAt: string | null;
  groupsTotal: number;
  toImport: number;
  imported: number;
  stitched: number;
  singlePart: number;
  renamed: number;
  partsStitched: number;
  duplicatePartsDropped: number;
  alreadyImported: number;
  excluded: number;
  unknownFolder: number;
  missingSources: number;
  emptyContent: number;
  byFolder: Record<string, number>;
  byAuthority: Record<string, number>;
}

export interface ImportPlan {
  entries: PlanEntry[];
  summary: ImportSummary;
}

function resolveAuthorityRole(raw: string | undefined, fallback: AuthorityRole): AuthorityRole {
  return raw && (AUTHORITY_ROLES as readonly string[]).includes(raw) ? (raw as AuthorityRole) : fallback;
}

function emptySummary(manifest: TranscriptManifest): ImportSummary {
  return {
    manifestTask: manifest.task,
    generatedAt: manifest.generatedAt ?? null,
    groupsTotal: manifest.groups.length,
    toImport: 0,
    imported: 0,
    stitched: 0,
    singlePart: 0,
    renamed: 0,
    partsStitched: 0,
    duplicatePartsDropped: 0,
    alreadyImported: 0,
    excluded: 0,
    unknownFolder: 0,
    missingSources: 0,
    emptyContent: 0,
    byFolder: {},
    byAuthority: {},
  };
}

/**
 * Build the (read-only) import plan: classify every manifest group into an
 * action and roll up a summary. Reads the manifest, the already-imported set
 * (provenance markers in the holding store) and the keeper source rows so it can
 * detect missing/empty content WITHOUT writing anything.
 */
export async function buildImportPlan(database: Db = defaultDb, startDir?: string): Promise<ImportPlan> {
  const manifest = loadManifest(startDir);

  // Already-imported group ids (recovered from provenance markers).
  const existing = await database
    .select({ provenanceNote: transcriptCleanerDocumentsTable.provenanceNote })
    .from(transcriptCleanerDocumentsTable)
    .where(like(transcriptCleanerDocumentsTable.provenanceNote, `${IMPORT_PROVENANCE_PREFIX}%`));
  const alreadyImported = new Set<string>();
  for (const row of existing) {
    const gid = parseImportedGroupId(row.provenanceNote);
    if (gid) alreadyImported.add(gid);
  }

  // Source content for every keeper id across all keep groups, fetched once.
  const keeperIds = new Set<number>();
  for (const g of manifest.groups) {
    if (g.disposition === "keep") for (const id of g.keepDocIds) keeperIds.add(id);
  }
  const contentById = await loadSourceContent(database, [...keeperIds]);

  const summary = emptySummary(manifest);
  const entries: PlanEntry[] = [];

  for (const group of manifest.groups) {
    const folderEntry = group.folder ? resolveSourceFolderByLabel(group.folder) : null;
    const authorityRole = folderEntry
      ? resolveAuthorityRole(group.authorityRole, folderEntry.defaultAuthorityRole)
      : resolveAuthorityRole(group.authorityRole, DEFAULT_AUTHORITY_ROLE);

    const base: PlanEntry = {
      groupId: group.groupId,
      originalTitle: group.title,
      proposedTitle: group.proposedTitle ?? null,
      titleRenamed: Boolean(group.titleRenamed),
      folder: group.folder ?? null,
      transcriptType: folderEntry?.slug ?? null,
      authorityRole: folderEntry ? authorityRole : null,
      partCount: group.keepDocIds.length,
      duplicatePartsDropped: group.duplicateDropDocIds?.length ?? 0,
      action: "import",
    };

    if (group.disposition === "exclude") {
      summary.excluded += 1;
      entries.push({ ...base, action: "skip_excluded", reason: group.reason ?? "Excluded in triage" });
      continue;
    }
    if (alreadyImported.has(group.groupId)) {
      summary.alreadyImported += 1;
      entries.push({ ...base, action: "skip_already_imported", reason: "Already imported on a prior run" });
      continue;
    }
    if (!folderEntry) {
      summary.unknownFolder += 1;
      entries.push({ ...base, action: "skip_unknown_folder", reason: `Unrecognized folder "${group.folder ?? ""}"` });
      continue;
    }

    const missing = group.keepDocIds.filter((id) => !contentById.has(id));
    if (missing.length > 0) {
      summary.missingSources += 1;
      entries.push({
        ...base,
        action: "skip_missing_sources",
        reason: `Missing source doc(s) in knowledgebase_docs: ${missing.join(", ")}`,
      });
      continue;
    }

    const stitched = stitchParts(orderedKeepDocIds(group).map((id) => contentById.get(id) ?? ""));
    if (!stitched) {
      summary.emptyContent += 1;
      entries.push({ ...base, action: "skip_empty_content", reason: "All source parts were empty" });
      continue;
    }

    // Importable.
    summary.toImport += 1;
    if (group.keepDocIds.length > 1) {
      summary.stitched += 1;
      summary.partsStitched += group.keepDocIds.length;
    } else {
      summary.singlePart += 1;
    }
    if (group.titleRenamed) summary.renamed += 1;
    summary.duplicatePartsDropped += base.duplicatePartsDropped;
    summary.byFolder[folderEntry.slug] = (summary.byFolder[folderEntry.slug] ?? 0) + 1;
    summary.byAuthority[authorityRole] = (summary.byAuthority[authorityRole] ?? 0) + 1;
    entries.push(base);
  }

  return { entries, summary };
}

async function loadSourceContent(database: Db, ids: number[]): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  if (ids.length === 0) return out;
  // Chunk to keep the IN list reasonable.
  const CHUNK = 500;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const slice = ids.slice(i, i + CHUNK);
    const rows = await database
      .select({ id: knowledgebaseDocsTable.id, content: knowledgebaseDocsTable.content })
      .from(knowledgebaseDocsTable)
      .where(inArray(knowledgebaseDocsTable.id, slice));
    for (const r of rows) out.set(r.id, r.content ?? "");
  }
  return out;
}

// ───────────────────────────────────────────────────────────────────────────
// Execution (gated — caller must confirm).
// ───────────────────────────────────────────────────────────────────────────

export interface ImportResultEntry extends PlanEntry {
  documentId?: number;
}

export interface ImportResult {
  entries: ImportResultEntry[];
  summary: ImportSummary;
}

/**
 * Execute the import: insert one holding-store row per importable group. Builds
 * the plan first (so missing/excluded/already-imported groups are skipped), then
 * stitches + inserts only the `import` entries. Idempotent via provenance marker.
 */
export async function executeImport(database: Db = defaultDb, startDir?: string): Promise<ImportResult> {
  const manifest = loadManifest(startDir);
  const plan = await buildImportPlan(database, startDir);
  const groupById = new Map(manifest.groups.map((g) => [g.groupId, g]));

  // Re-fetch source content for the groups we will actually import.
  const keeperIds = new Set<number>();
  for (const entry of plan.entries) {
    if (entry.action !== "import") continue;
    const g = groupById.get(entry.groupId);
    if (g) for (const id of g.keepDocIds) keeperIds.add(id);
  }
  const contentById = await loadSourceContent(database, [...keeperIds]);

  const entries: ImportResultEntry[] = [];
  let imported = 0;

  for (const entry of plan.entries) {
    if (entry.action !== "import") {
      entries.push(entry);
      continue;
    }
    const group = groupById.get(entry.groupId);
    if (!group || !entry.transcriptType) {
      entries.push(entry);
      continue;
    }
    const stitched = stitchParts(orderedKeepDocIds(group).map((id) => contentById.get(id) ?? ""));
    const title = (group.proposedTitle ?? group.title).trim();
    const [doc] = await database
      .insert(transcriptCleanerDocumentsTable)
      .values({
        // The approved manifest title is human-reviewed, so it is applied as the
        // working title (visible immediately) AND carried as proposedTitle.
        title,
        proposedTitle: group.proposedTitle?.trim() || null,
        transcriptType: entry.transcriptType,
        authorityRole: entry.authorityRole,
        authorityConfidence: entry.authorityRole ? "high" : null,
        authorityEvidence: entry.authorityRole
          ? `Authority role approved in transcript triage manifest #${manifest.task}.`
          : null,
        originalContent: stitched,
        sourceName: group.title,
        provenanceNote: buildProvenanceNote(group),
        status: "uploaded",
      })
      .returning();
    imported += 1;
    entries.push({ ...entry, documentId: doc.id });
  }

  return { entries, summary: { ...plan.summary, imported } };
}
