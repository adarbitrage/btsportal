import { Router, type IRouter } from "express";
import { db, transcriptCleanerDocumentsTable, aiSourceDocumentsTable } from "@workspace/db";
import { eq, desc, inArray, sql, and, ne } from "drizzle-orm";
import { requirePermission } from "../../middleware/rbac";
import { getParam } from "../../lib/params";
import {
  isSourceFolder,
  resolveSourceFolder,
  AUTHORITY_ROLES,
  DEFAULT_AUTHORITY_ROLE,
  type AuthorityRole,
} from "../../lib/kb-taxonomy";
import {
  cleanTranscript,
  refineTranscript,
  loadRosterList,
} from "../../lib/transcript-cleaner";
import { buildImportPlan, executeImport } from "../../lib/transcript-import";
import { applyBlitzCaptionAutofill } from "../../lib/blitz-caption-filename";
import type { TranscriptCleanerChatTurn } from "@workspace/db";

/**
 * Transcript Cleaner (Task #1468) — mounted at /admin/transcript-cleaner.
 *
 * Raw transcripts (hand-uploaded in any format, or pre-populated by the import
 * task) are persisted in the `transcript_cleaner_documents` holding store, get
 * AI-cleaned (speaker re-attribution + authority labelling + glossary/cruft +
 * suggested title), reviewed/refined by an admin, then FILED into the AI Source
 * Knowledge library (`ai_source_documents`). Deliberately separate from the
 * curated kb_staging_docs pipeline — cleaned transcripts are raw source, never
 * citable truth, so they never route into Document Review.
 *
 * Cleaning + filing both support single-item and batch actions. Originals are
 * preserved unchanged in `originalContent`.
 */
const router: IRouter = Router();

const isAuthorityRole = (v: unknown): v is AuthorityRole =>
  typeof v === "string" && (AUTHORITY_ROLES as readonly string[]).includes(v);

function parseId(raw: string): number | null {
  const id = parseInt(raw, 10);
  return Number.isNaN(id) ? null : id;
}

// ───────────────────────────────────────────────────────────────────────────
// List + fetch.
// ───────────────────────────────────────────────────────────────────────────

/** GET /admin/transcript-cleaner/documents?status= — list held transcripts. */
router.get("/admin/transcript-cleaner/documents", requirePermission("chat:view"), async (req, res): Promise<void> => {
  const status = req.query.status as string | undefined;
  const rows = await db
    .select()
    .from(transcriptCleanerDocumentsTable)
    .where(status ? eq(transcriptCleanerDocumentsTable.status, status) : undefined)
    .orderBy(desc(transcriptCleanerDocumentsTable.updatedAt));

  const counts = await db
    .select({ status: transcriptCleanerDocumentsTable.status, cnt: sql<number>`count(*)::int` })
    .from(transcriptCleanerDocumentsTable)
    .groupBy(transcriptCleanerDocumentsTable.status);

  res.json({
    documents: rows,
    counts: counts.reduce((acc, c) => ({ ...acc, [c.status]: c.cnt }), {} as Record<string, number>),
  });
});

/** GET /admin/transcript-cleaner/roster — live coach/VA roster for the upload picker. */
router.get("/admin/transcript-cleaner/roster", requirePermission("chat:view"), async (_req, res): Promise<void> => {
  const roster = await loadRosterList();
  res.json({ roster });
});

/** GET /admin/transcript-cleaner/documents/:id — fetch a single held transcript. */
router.get("/admin/transcript-cleaner/documents/:id", requirePermission("chat:view"), async (req, res): Promise<void> => {
  const id = parseId(getParam(req.params.id));
  if (id === null) {
    res.status(400).json({ error: "Invalid document ID" });
    return;
  }
  const [doc] = await db.select().from(transcriptCleanerDocumentsTable).where(eq(transcriptCleanerDocumentsTable.id, id));
  if (!doc) {
    res.status(404).json({ error: "Document not found" });
    return;
  }
  res.json(doc);
});

// ───────────────────────────────────────────────────────────────────────────
// Create (single + batch) — intake of raw transcript text.
// ───────────────────────────────────────────────────────────────────────────

interface IntakeItem {
  content?: string;
  title?: string;
  transcriptType?: string;
  sourceName?: string;
  proposedTitle?: string;
  provenanceNote?: string;
  inLessonOrder?: number;
  vidalyticsId?: string;
  // Admin-supplied ground truth captured at upload (Task #1560).
  providedAuthorityRole?: string;
  providedAuthorityName?: string;
  providedSubject?: string;
  providedDate?: string;
}

function validateTranscriptType(value: unknown): string | null | undefined {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "string" && isSourceFolder(value)) return value;
  return undefined; // invalid sentinel
}

/** Accept a known authority role or null (unset); reject anything else. */
function validateProvidedAuthorityRole(value: unknown): AuthorityRole | null | undefined {
  if (value === undefined || value === null || value === "") return null;
  if (isAuthorityRole(value)) return value;
  return undefined; // invalid sentinel
}

/** Common provided-input columns shared by the single + batch insert paths. */
function providedInputColumns(item: IntakeItem, providedAuthorityRole: AuthorityRole | null) {
  return {
    providedAuthorityRole,
    providedAuthorityName: item.providedAuthorityName?.trim() || null,
    providedSubject: item.providedSubject?.trim() || null,
    providedDate: item.providedDate?.trim() || null,
  };
}

/** POST /admin/transcript-cleaner/documents — create one held transcript. */
router.post("/admin/transcript-cleaner/documents", requirePermission("chat:manage"), async (req, res): Promise<void> => {
  const body = req.body as IntakeItem;
  const content = typeof body.content === "string" ? body.content : "";
  if (!content.trim()) {
    res.status(400).json({ error: "Transcript content is required" });
    return;
  }
  const item = applyBlitzCaptionAutofill(body);
  const transcriptType = validateTranscriptType(item.transcriptType);
  if (transcriptType === undefined) {
    res.status(400).json({ error: "Unknown transcript type" });
    return;
  }
  const providedAuthorityRole = validateProvidedAuthorityRole(item.providedAuthorityRole);
  if (providedAuthorityRole === undefined) {
    res.status(400).json({ error: "Unknown authority role" });
    return;
  }

  const [doc] = await db
    .insert(transcriptCleanerDocumentsTable)
    .values({
      title: (item.title ?? "").trim(),
      proposedTitle: item.proposedTitle?.trim() || null,
      transcriptType,
      originalContent: content,
      sourceName: item.sourceName?.trim() || null,
      provenanceNote: item.provenanceNote?.trim() || null,
      inLessonOrder: typeof item.inLessonOrder === "number" ? item.inLessonOrder : null,
      vidalyticsId: item.vidalyticsId?.trim() || null,
      ...providedInputColumns(item, providedAuthorityRole),
      status: "uploaded",
    })
    .returning();

  res.status(201).json(doc);
});

/** POST /admin/transcript-cleaner/documents/batch — create many held transcripts. */
router.post("/admin/transcript-cleaner/documents/batch", requirePermission("chat:manage"), async (req, res): Promise<void> => {
  const items = Array.isArray((req.body as { items?: IntakeItem[] }).items)
    ? (req.body as { items: IntakeItem[] }).items
    : [];
  if (items.length === 0) {
    res.status(400).json({ error: "No transcripts provided" });
    return;
  }

  const results: Array<{ ok: boolean; id?: number; sourceName?: string; error?: string }> = [];
  for (const rawItem of items) {
    const content = typeof rawItem.content === "string" ? rawItem.content : "";
    if (!content.trim()) {
      results.push({ ok: false, sourceName: rawItem.sourceName, error: "Empty transcript" });
      continue;
    }
    const item = applyBlitzCaptionAutofill(rawItem);
    const transcriptType = validateTranscriptType(item.transcriptType);
    if (transcriptType === undefined) {
      results.push({ ok: false, sourceName: rawItem.sourceName, error: "Unknown transcript type" });
      continue;
    }
    const providedAuthorityRole = validateProvidedAuthorityRole(item.providedAuthorityRole);
    if (providedAuthorityRole === undefined) {
      results.push({ ok: false, sourceName: rawItem.sourceName, error: "Unknown authority role" });
      continue;
    }
    const [doc] = await db
      .insert(transcriptCleanerDocumentsTable)
      .values({
        title: (item.title ?? "").trim(),
        proposedTitle: item.proposedTitle?.trim() || null,
        transcriptType,
        originalContent: content,
        sourceName: item.sourceName?.trim() || null,
        provenanceNote: item.provenanceNote?.trim() || null,
        inLessonOrder: typeof item.inLessonOrder === "number" ? item.inLessonOrder : null,
        vidalyticsId: item.vidalyticsId?.trim() || null,
        ...providedInputColumns(item, providedAuthorityRole),
        status: "uploaded",
      })
      .returning();
    results.push({ ok: true, id: doc.id, sourceName: doc.sourceName ?? undefined });
  }

  res.status(201).json({ results });
});

// ───────────────────────────────────────────────────────────────────────────
// Edit / delete.
// ───────────────────────────────────────────────────────────────────────────

/** PATCH /admin/transcript-cleaner/documents/:id — edit title/type/content/flags/authority. */
router.patch("/admin/transcript-cleaner/documents/:id", requirePermission("chat:manage"), async (req, res): Promise<void> => {
  const id = parseId(getParam(req.params.id));
  if (id === null) {
    res.status(400).json({ error: "Invalid document ID" });
    return;
  }
  const [existing] = await db.select().from(transcriptCleanerDocumentsTable).where(eq(transcriptCleanerDocumentsTable.id, id));
  if (!existing) {
    res.status(404).json({ error: "Document not found" });
    return;
  }
  if (existing.status === "filed") {
    res.status(409).json({ error: "Document is already filed and cannot be edited" });
    return;
  }

  const body = req.body as {
    title?: string;
    transcriptType?: string;
    cleanedContent?: string;
    authorityRole?: string;
    authorityConfidence?: string;
    authorityEvidence?: string;
    titleNeedsInput?: boolean;
    flags?: unknown;
    provenanceNote?: string;
    providedAuthorityRole?: string | null;
    providedAuthorityName?: string | null;
    providedSubject?: string | null;
    providedDate?: string | null;
  };

  const update: Partial<typeof transcriptCleanerDocumentsTable.$inferInsert> = {};
  if (typeof body.title === "string") update.title = body.title.trim();
  if (body.transcriptType !== undefined) {
    const t = validateTranscriptType(body.transcriptType);
    if (t === undefined) {
      res.status(400).json({ error: "Unknown transcript type" });
      return;
    }
    update.transcriptType = t;
  }
  if (typeof body.cleanedContent === "string") update.cleanedContent = body.cleanedContent;
  if (body.authorityRole !== undefined) {
    if (!isAuthorityRole(body.authorityRole)) {
      res.status(400).json({ error: "Unknown authority role" });
      return;
    }
    update.authorityRole = body.authorityRole;
    // A manual authority pick is an admin override — treat it as confirmed.
    update.authorityConfidence = "high";
  }
  if (body.authorityConfidence === "high" || body.authorityConfidence === "low") {
    update.authorityConfidence = body.authorityConfidence;
  }
  if (typeof body.authorityEvidence === "string") update.authorityEvidence = body.authorityEvidence;
  if (typeof body.titleNeedsInput === "boolean") update.titleNeedsInput = body.titleNeedsInput;
  if (Array.isArray(body.flags)) update.flags = body.flags as typeof existing.flags;
  if (typeof body.provenanceNote === "string") update.provenanceNote = body.provenanceNote.trim() || null;

  // Admin-provided ground truth (Task #1560): editable before cleaning so a
  // wrong pick at upload can be corrected in-place, not by re-uploading. `null`
  // explicitly clears a field back to the call-type default / AI guess.
  if (body.providedAuthorityRole !== undefined) {
    if (body.providedAuthorityRole === null || body.providedAuthorityRole === "") {
      update.providedAuthorityRole = null;
    } else {
      const role = validateProvidedAuthorityRole(body.providedAuthorityRole);
      if (role === undefined || role === null) {
        res.status(400).json({ error: "Unknown authority role" });
        return;
      }
      update.providedAuthorityRole = role;
    }
  }
  if (body.providedAuthorityName !== undefined) {
    update.providedAuthorityName = body.providedAuthorityName?.trim() || null;
  }
  if (body.providedSubject !== undefined) {
    update.providedSubject = body.providedSubject?.trim() || null;
  }
  if (body.providedDate !== undefined) {
    update.providedDate = body.providedDate?.trim() || null;
  }

  if (Object.keys(update).length === 0) {
    res.json(existing);
    return;
  }

  const [doc] = await db
    .update(transcriptCleanerDocumentsTable)
    .set(update)
    .where(eq(transcriptCleanerDocumentsTable.id, id))
    .returning();
  res.json(doc);
});

/** DELETE /admin/transcript-cleaner/documents/:id — discard a held transcript. */
router.delete("/admin/transcript-cleaner/documents/:id", requirePermission("chat:manage"), async (req, res): Promise<void> => {
  const id = parseId(getParam(req.params.id));
  if (id === null) {
    res.status(400).json({ error: "Invalid document ID" });
    return;
  }
  const [deleted] = await db
    .delete(transcriptCleanerDocumentsTable)
    .where(eq(transcriptCleanerDocumentsTable.id, id))
    .returning({ id: transcriptCleanerDocumentsTable.id });
  if (!deleted) {
    res.status(404).json({ error: "Document not found" });
    return;
  }
  res.json({ ok: true });
});

// ───────────────────────────────────────────────────────────────────────────
// Cleaning — run the AI cleanup engine (single + batch).
// ───────────────────────────────────────────────────────────────────────────

async function runClean(id: number): Promise<{ ok: boolean; error?: string }> {
  const [doc] = await db.select().from(transcriptCleanerDocumentsTable).where(eq(transcriptCleanerDocumentsTable.id, id));
  if (!doc) return { ok: false, error: "Document not found" };

  await db
    .update(transcriptCleanerDocumentsTable)
    .set({ status: "cleaning", errorMessage: null })
    .where(eq(transcriptCleanerDocumentsTable.id, id));

  try {
    const result = await cleanTranscript({
      rawText: doc.originalContent,
      transcriptType: doc.transcriptType,
      sourceName: doc.sourceName,
      proposedTitle: doc.proposedTitle,
      providedAuthorityRole: doc.providedAuthorityRole,
      providedAuthorityName: doc.providedAuthorityName,
      providedSubject: doc.providedSubject,
      providedDate: doc.providedDate,
    });

    // Title: an imported proposedTitle is the default and is offered-not-applied;
    // otherwise the AI suggestion becomes the working title. Never clobber a
    // title the admin already set by hand.
    const workingTitle = doc.title?.trim()
      ? doc.title.trim()
      : (doc.proposedTitle?.trim() || result.suggestedTitle);

    await db
      .update(transcriptCleanerDocumentsTable)
      .set({
        cleanedContent: result.cleanedContent,
        suggestedTitle: result.suggestedTitle,
        title: workingTitle,
        titleNeedsInput: result.titleNeedsInput && !doc.proposedTitle?.trim() && !doc.title?.trim(),
        authorityRole: result.authorityRole,
        authorityConfidence: result.authorityConfidence,
        authorityEvidence: result.authorityEvidence,
        flags: result.flags,
        status: "cleaned",
        errorMessage: null,
      })
      .where(eq(transcriptCleanerDocumentsTable.id, id));
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Cleanup failed";
    await db
      .update(transcriptCleanerDocumentsTable)
      .set({ status: "error", errorMessage: message })
      .where(eq(transcriptCleanerDocumentsTable.id, id));
    return { ok: false, error: message };
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Background cleaning queue.
//
// A large transcript is chunked into several sequential AI passes and can run
// for minutes — far longer than the browser/proxy request timeout. Awaiting the
// clean inside the request made the UI show a false "failed" toast even though
// the backend finished and marked the doc `cleaned`. So cleaning runs in the
// background: the request marks the target docs `cleaning`, returns immediately
// (202), and the page reflects real progress via its existing status polling.
//
// A single in-process worker drains the queue one document at a time to stay
// within the Anthropic client's rate budget (matching the old sequential batch).
//
// The DB row itself is the atomic claim: enqueueing flips a doc to `cleaning`
// only when it isn't ALREADY `cleaning`, in one conditional UPDATE...RETURNING.
// Concurrent requests racing on the same doc serialize on that row update, so
// exactly one claims it — repeated clicks or overlapping batches can never
// double-enqueue or double-process the same file.
// ───────────────────────────────────────────────────────────────────────────
const cleanQueue: number[] = [];
let workerRunning = false;

async function drainCleanQueue(): Promise<void> {
  if (workerRunning) return;
  workerRunning = true;
  try {
    while (cleanQueue.length > 0) {
      const id = cleanQueue.shift();
      if (id === undefined) break;
      try {
        const r = await runClean(id);
        if (!r.ok) {
          console.error(`[TranscriptCleaner] Clean failed for doc ${id}: ${r.error}`);
        }
      } catch (err) {
        // runClean writes any thrown error to the row itself; this is a
        // last-resort guard so one bad doc never stalls the whole queue.
        console.error(`[TranscriptCleaner] Unexpected clean error for doc ${id}:`, err);
      }
    }
  } finally {
    workerRunning = false;
    // A doc enqueued in the tiny window between the loop exit and clearing the
    // flag would otherwise wait forever — restart the drain if any slipped in.
    if (cleanQueue.length > 0) void drainCleanQueue();
  }
}

/**
 * Atomically claim the given docs (flip to `cleaning` unless already cleaning)
 * and enqueue them for background processing. Docs that don't exist or are
 * already mid-clean are skipped. Returns the ids actually claimed.
 */
async function enqueueClean(ids: number[]): Promise<number[]> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return [];

  // Single conditional claim: only docs not already `cleaning` are flipped, and
  // RETURNING tells us exactly which ones we won. This is the race-safe gate —
  // a second concurrent request finds them already `cleaning` and claims nothing.
  const claimed = await db
    .update(transcriptCleanerDocumentsTable)
    .set({ status: "cleaning", errorMessage: null })
    .where(
      and(
        inArray(transcriptCleanerDocumentsTable.id, unique),
        ne(transcriptCleanerDocumentsTable.status, "cleaning"),
      ),
    )
    .returning({ id: transcriptCleanerDocumentsTable.id });

  const accepted = claimed.map((r) => r.id);
  if (accepted.length === 0) return [];

  cleanQueue.push(...accepted);
  void drainCleanQueue();
  return accepted;
}

/** POST /admin/transcript-cleaner/documents/:id/clean — queue one transcript. */
router.post("/admin/transcript-cleaner/documents/:id/clean", requirePermission("chat:manage"), async (req, res): Promise<void> => {
  const id = parseId(getParam(req.params.id));
  if (id === null) {
    res.status(400).json({ error: "Invalid document ID" });
    return;
  }
  const accepted = await enqueueClean([id]);
  res.status(202).json({ accepted });
});

/** POST /admin/transcript-cleaner/clean-batch — queue many transcripts. */
router.post("/admin/transcript-cleaner/clean-batch", requirePermission("chat:manage"), async (req, res): Promise<void> => {
  const ids = Array.isArray((req.body as { ids?: number[] }).ids)
    ? (req.body as { ids: number[] }).ids.filter((n) => Number.isFinite(n))
    : [];
  if (ids.length === 0) {
    res.status(400).json({ error: "No document IDs provided" });
    return;
  }
  const accepted = await enqueueClean(ids);
  res.status(202).json({ accepted });
});

// ───────────────────────────────────────────────────────────────────────────
// Refinement chat.
// ───────────────────────────────────────────────────────────────────────────

/** POST /admin/transcript-cleaner/documents/:id/refine — follow-up refinement chat. */
router.post("/admin/transcript-cleaner/documents/:id/refine", requirePermission("chat:manage"), async (req, res): Promise<void> => {
  const id = parseId(getParam(req.params.id));
  if (id === null) {
    res.status(400).json({ error: "Invalid document ID" });
    return;
  }
  const instruction = typeof (req.body as { instruction?: string }).instruction === "string"
    ? (req.body as { instruction: string }).instruction.trim()
    : "";
  if (!instruction) {
    res.status(400).json({ error: "An instruction is required" });
    return;
  }

  const [doc] = await db.select().from(transcriptCleanerDocumentsTable).where(eq(transcriptCleanerDocumentsTable.id, id));
  if (!doc) {
    res.status(404).json({ error: "Document not found" });
    return;
  }
  if (!doc.cleanedContent) {
    res.status(409).json({ error: "Transcript must be cleaned before it can be refined" });
    return;
  }

  try {
    const result = await refineTranscript({
      currentCleaned: doc.cleanedContent,
      instruction,
      transcriptType: doc.transcriptType,
      chatHistory: doc.chatHistory,
      activeFlags: doc.flags,
    });

    const newHistory: TranscriptCleanerChatTurn[] = [
      ...(doc.chatHistory ?? []),
      { role: "user", content: instruction },
      { role: "assistant", content: result.assistantMessage },
    ];

    const [updated] = await db
      .update(transcriptCleanerDocumentsTable)
      .set({
        cleanedContent: result.cleanedContent,
        flags: result.flags,
        chatHistory: newHistory,
        ...(result.authorityRole ? { authorityRole: result.authorityRole } : {}),
        ...(result.authorityConfidence ? { authorityConfidence: result.authorityConfidence } : {}),
        ...(result.authorityEvidence ? { authorityEvidence: result.authorityEvidence } : {}),
        status: "cleaned",
        errorMessage: null,
      })
      .where(eq(transcriptCleanerDocumentsTable.id, id))
      .returning();
    res.json(updated);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Refinement failed";
    res.status(500).json({ error: message });
  }
});

// ───────────────────────────────────────────────────────────────────────────
// Filing to AI Source Knowledge (single + batch).
// ───────────────────────────────────────────────────────────────────────────

async function fileOne(id: number): Promise<{ ok: boolean; error?: string; sourceDocId?: number }> {
  const [doc] = await db.select().from(transcriptCleanerDocumentsTable).where(eq(transcriptCleanerDocumentsTable.id, id));
  if (!doc) return { ok: false, error: "Document not found" };
  if (doc.status === "filed") return { ok: false, error: "Already filed" };
  if (!doc.cleanedContent) return { ok: false, error: "Transcript has not been cleaned" };
  if (!doc.transcriptType || !isSourceFolder(doc.transcriptType)) {
    return { ok: false, error: "A valid transcript type / folder is required before filing" };
  }
  const title = doc.title?.trim();
  if (!title) return { ok: false, error: "A title is required before filing" };

  const folder = resolveSourceFolder(doc.transcriptType);
  const role = isAuthorityRole(doc.authorityRole)
    ? doc.authorityRole
    : folder?.defaultAuthorityRole ?? DEFAULT_AUTHORITY_ROLE;

  const [sourceDoc] = await db
    .insert(aiSourceDocumentsTable)
    .values({
      title,
      content: doc.cleanedContent,
      sourceType: doc.transcriptType,
      authorityRole: role,
      sourceName: doc.sourceName,
      provenanceNote: doc.provenanceNote ?? "Filed from Transcript Cleaner",
    })
    .returning();

  await db
    .update(transcriptCleanerDocumentsTable)
    .set({ status: "filed", filedSourceDocId: sourceDoc.id, filedAt: new Date() })
    .where(eq(transcriptCleanerDocumentsTable.id, id));

  return { ok: true, sourceDocId: sourceDoc.id };
}

/** POST /admin/transcript-cleaner/documents/:id/file — file a single transcript. */
router.post("/admin/transcript-cleaner/documents/:id/file", requirePermission("chat:manage"), async (req, res): Promise<void> => {
  const id = parseId(getParam(req.params.id));
  if (id === null) {
    res.status(400).json({ error: "Invalid document ID" });
    return;
  }
  const result = await fileOne(id);
  if (!result.ok) {
    res.status(result.error === "Document not found" ? 404 : 400).json({ error: result.error });
    return;
  }
  const [doc] = await db.select().from(transcriptCleanerDocumentsTable).where(eq(transcriptCleanerDocumentsTable.id, id));
  res.json(doc);
});

/** POST /admin/transcript-cleaner/file-batch — file a selected set in one action. */
router.post("/admin/transcript-cleaner/file-batch", requirePermission("chat:manage"), async (req, res): Promise<void> => {
  const ids = Array.isArray((req.body as { ids?: number[] }).ids)
    ? (req.body as { ids: number[] }).ids.filter((n) => Number.isFinite(n))
    : [];
  if (ids.length === 0) {
    res.status(400).json({ error: "No document IDs provided" });
    return;
  }
  const results: Array<{ id: number; ok: boolean; error?: string; sourceDocId?: number }> = [];
  for (const id of ids) {
    const r = await fileOne(id);
    results.push({ id, ...r });
  }
  res.json({ results });
});

// ───────────────────────────────────────────────────────────────────────────
// Gated import of triaged transcripts (Task #1484).
//
// Reads the approved triage manifest (#1483) and loads keeper transcripts from
// the legacy knowledgebase_docs corpus into this holding store — stitching
// multi-part groups, skipping excludes/duplicates, titling from proposedTitle.
// The preview is read-only; the import only runs on an explicit `confirm: true`.
// ───────────────────────────────────────────────────────────────────────────

/** GET /admin/transcript-cleaner/import/preview — dry-run plan + summary (no writes). */
router.get(
  "/admin/transcript-cleaner/import/preview",
  requirePermission("chat:view"),
  async (_req, res): Promise<void> => {
    try {
      const plan = await buildImportPlan();
      res.json(plan);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to build import plan";
      res.status(500).json({ error: message });
    }
  },
);

/** POST /admin/transcript-cleaner/import — perform the import (requires confirm: true). */
router.post(
  "/admin/transcript-cleaner/import",
  requirePermission("chat:manage"),
  async (req, res): Promise<void> => {
    const confirm = (req.body as { confirm?: unknown })?.confirm === true;
    if (!confirm) {
      res.status(400).json({ error: "Import must be explicitly confirmed (send { confirm: true })." });
      return;
    }
    try {
      const result = await executeImport();
      res.status(201).json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Import failed";
      res.status(500).json({ error: message });
    }
  },
);

export default router;
