import {
  db,
  creativeDriveFoldersTable,
  creativeDriveFilesTable,
  resourceHubItemsTable,
  resourceHubGlossaryTable,
  contentAccessMapTable,
} from "@workspace/db";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";

/**
 * Resource Hub setup (Task #2028) — idempotent boot-time hooks, following the
 * prod-data-fixes-via-startup-hooks pattern (production only receives these
 * changes when it boots after Publish; the agent cannot write prod directly).
 *
 * Two phases, both no-ops once applied:
 *
 *  Phase A — ensureResourceHubReorg(): runs BEFORE the drive boot-seeds.
 *    Reorganizes the Creative Drive folders to mirror the hub sections
 *    (owner-approved): deletes 3 retired files, renames "Headline Writing" →
 *    "Headline Library", creates "Working Documents" + "Templates & Assets",
 *    moves the working docs, applies friendly display names to the headline
 *    files, and deletes the emptied "Angles" / "Resources" folders. Runs
 *    before seedResourcesDrive so the (repointed) Campaign Checklist seeder
 *    finds the moved file instead of creating a duplicate.
 *
 *  Phase B — ensureResourceHubCuration(): runs AFTER the drive boot-seeds.
 *    Seeds the curation rows (keyed by stable slug, insert-if-absent) matching
 *    drive files by exact name, gracefully skipping items whose file record is
 *    absent (fresh envs without the admin-uploaded Headline Library simply
 *    don't show it). Also seeds the glossary TERM list (draft, empty
 *    definition) — terms extracted from the legacy knowledgebase_docs glossary
 *    (term list ONLY; none of the legacy definition text is carried over).
 */

// Advisory lock key pair (stable/unique; distinct from other drive seeds).
const LOCK_KEY_1 = 727_2028;

const OLD_HEADLINE_FOLDER = "Headline Writing";
export const HEADLINE_FOLDER = "Headline Library";
export const WORKING_DOCS_FOLDER = "Working Documents";
export const TEMPLATES_FOLDER = "Templates & Assets";
const RETIRED_FOLDERS = ["Angles", "Resources"] as const;

/** Files deleted from the drive during curation (owner-approved). */
const DELETED_FILE_NAMES = [
  "HEADLINES - carminemastropierr....pdf",
  "HEADLINES - Copywriting-Cheat-Sheet-PT-Marketing-System-1(1).pdf",
  "ANGLES - Finding Your _Edge_ In Affiliate Arbitrage.pdf",
] as const;

/** Files moved from Resources / Headline Writing into Working Documents. */
const MOVED_TO_WORKING_DOCS = [
  "Campaign Checklist.pdf",
  "Power Word Dictionary.pdf",
  "Context Word Dictionary.pdf",
  "The One-Sentence Persuasion Course.pdf",
] as const;

/** Friendly display names applied to the kept headline files (old exact name → new). */
export const HEADLINE_RENAMES: ReadonlyArray<{ from: string; to: string }> = [
  // Teaching Guides
  { from: "HEADLINES - Copyblogger-How-to-Write-Magnetic-Headlines-2.pdf", to: "How to Write Magnetic Headlines (Copyblogger).pdf" },
  { from: "HEADLINES - GreatHeadlinesInstantly.pdf", to: "Great Headlines Instantly (Robert Boduch).pdf" },
  { from: "HEADLINES - The-Entrepreneurs-Essential-Headline-Writing-Blueprint-E-book.pdf", to: "The Entrepreneur's Headline Writing Blueprint (Robert Pascoe).pdf" },
  { from: "HEADLINES - how_to_write_powerful_headlines.pdf", to: "How to Write Powerful Headlines (Andy Owen).pdf" },
  { from: "HEADLINES - HowToWriteHeadlinesUpdated.pdf", to: "The Rhetoric of Headlines (Suzanne Pope).pdf" },
  // Formulas & Checklists
  { from: "HEADLINES - Writing-Killer-Headlines.pdf", to: "Writing Killer Headlines (Stefan Georgi).pdf" },
  { from: "HEADLINES - Joel-Klettkes-Headline-Formulas-Cheat-Sheet.pdf", to: "Headline Formulas by Funnel Stage (Joel Klettke).pdf" },
  { from: "HEADLINES - Copywriting-Cheat-Sheet-PT-Marketing-System-1.pdf", to: "The Conversational Copywriting Cheat Sheet (Bret Thomson).pdf" },
  { from: "HEADLINES - Content-Marketing-Unlocked-Headline-Formula-List.pdf", to: "The Big Headline Formula List (Neil Patel).pdf" },
  // Swipe Files
  { from: "HEADLINES - 100greatestheadlinesJayAbraham.pdf", to: "100 Greatest Headlines Ever Written (Jay Abraham).pdf" },
  { from: "HEADLINES - EugeneSchwartzHeadlineSwipeFile.pdf", to: "The Eugene Schwartz Swipe File.pdf" },
  { from: "HEADLINES - masterclass-headline-swipe-file.pdf", to: "The Headline Masterclass Swipe File (Copywrite Matters).pdf" },
];

// ── Curation spec ─────────────────────────────────────────────────────────────

export type HubSection = "foundations" | "working_documents" | "templates_assets";

interface CurationSpecItem {
  slug: string;
  section: HubSection;
  kind: "file" | "external" | "group";
  displayTitle: string;
  blurb: string;
  sortOrder: number;
  /** Exact current drive file name (kind 'file'); item skipped when absent. */
  fileName?: string;
  externalUrl?: string;
  /** Slug of the parent group (children only). */
  parentSlug?: string;
  subGroupLabel?: string;
  noteLine?: string;
}

const cw = (n: number, title: string, blurb: string): CurationSpecItem => ({
  slug: `foundations-copywriting-${n}`,
  section: "foundations",
  kind: "file",
  displayTitle: title,
  blurb,
  sortOrder: n,
  fileName: `${n}. ${title}.pdf`,
  parentSlug: "foundations-copywriting",
});
const im = (n: number, title: string, blurb: string): CurationSpecItem => ({
  slug: `foundations-image-${n}`,
  section: "foundations",
  kind: "file",
  displayTitle: title,
  blurb,
  sortOrder: n,
  fileName: `${n}. ${title}.pdf`,
  parentSlug: "foundations-image",
});
const hl = (
  n: number,
  subGroupLabel: string,
  displayTitle: string,
  fileName: string,
  blurb: string,
): CurationSpecItem => ({
  slug: `headline-library-${n}`,
  section: "working_documents",
  kind: "file",
  displayTitle,
  blurb,
  sortOrder: n,
  fileName,
  parentSlug: "headline-library",
  subGroupLabel,
});

export const CURATION_SPEC: readonly CurationSpecItem[] = [
  // ── Foundations: two series groups ─────────────────────────────────────────
  {
    slug: "foundations-copywriting",
    section: "foundations",
    kind: "group",
    displayTitle: "Copywriting Foundations",
    blurb: "An eight-part series on writing headlines and ad copy that convert — work through the parts in order.",
    sortOrder: 1,
  },
  cw(1, "What a Headline Actually Does", "The single job a headline has — and why most beginner headlines fail at it."),
  cw(2, "Selling the Benefit, Not the Product", "How to translate features into the benefit your reader actually buys."),
  cw(3, "Curiosity — Withholding the How", "Building curiosity gaps that pull the click without giving the answer away."),
  cw(4, "Finding Your Angle", "Finding the specific slant that makes a familiar promise feel new."),
  cw(5, "Believability and Proof", "Making big claims believable with proof, specifics, and restraint."),
  cw(6, "Headline Formulas and the Swipe File", "How to use formulas and swipe files without writing copycat headlines."),
  cw(7, "Word Choice — Context and Power", "Choosing the power and context words that carry real weight."),
  cw(8, "The Headline Word Palette", "The working word palette to draw from when drafting headlines."),
  {
    slug: "foundations-image",
    section: "foundations",
    kind: "group",
    displayTitle: "Image Foundations",
    blurb: "An eight-part series on choosing and building ad images that stop the scroll — work through the parts in order.",
    sortOrder: 2,
  },
  im(1, "The Three Jobs of an Ad Image", "The three jobs every ad image must do before anything else matters."),
  im(2, "The Attention Devices — Expressive Subjects and the Moment of Use", "The two image devices that reliably stop the scroll."),
  im(3, "Bounded Curiosity — Show Less, Earn the Click", "How much to reveal in the image — and what to hold back."),
  im(4, "Color Without the Folklore", "What actually matters about color in ad images, minus the myths."),
  im(5, "The UGC Default — Why Authentic Beats Produced", "Why authentic-looking images beat polished, produced ones."),
  im(6, "Congruence — One Idea Through the Whole Funnel", "Keeping one idea consistent from image to headline to advertorial."),
  im(7, "The Seven Bans — Images That End Campaigns", "The seven image types that get campaigns shut down."),
  im(8, "From Angle to Image — The Working Process", "The working process for turning your angle into a finished ad image."),

  // ── Working Documents ──────────────────────────────────────────────────────
  {
    slug: "wd-campaign-toolkit",
    section: "working_documents",
    kind: "group",
    displayTitle: "Campaign Toolkit",
    blurb: "The working documents you keep open while building a campaign — the pre-launch checklist, both word dictionaries, and the persuasion classic.",
    sortOrder: 1,
  },
  {
    slug: "wd-campaign-checklist",
    section: "working_documents",
    kind: "file",
    displayTitle: "Campaign Checklist",
    blurb: "The step-by-step pre-launch checklist — work through it before you activate any campaign.",
    sortOrder: 1,
    fileName: "Campaign Checklist.pdf",
    parentSlug: "wd-campaign-toolkit",
  },
  {
    slug: "wd-power-word-dictionary",
    section: "working_documents",
    kind: "file",
    displayTitle: "Power Word Dictionary",
    blurb: "High-impact power words for headlines — upload it to ChatGPT when drafting or punching up headlines.",
    sortOrder: 2,
    fileName: "Power Word Dictionary.pdf",
    parentSlug: "wd-campaign-toolkit",
  },
  {
    slug: "wd-context-word-dictionary",
    section: "working_documents",
    kind: "file",
    displayTitle: "Context Word Dictionary",
    blurb: "Context words that frame your promise — the companion reference to upload to ChatGPT alongside the Power Word Dictionary.",
    sortOrder: 3,
    fileName: "Context Word Dictionary.pdf",
    parentSlug: "wd-campaign-toolkit",
  },
  {
    slug: "wd-one-sentence-persuasion",
    section: "working_documents",
    kind: "file",
    displayTitle: "The One-Sentence Persuasion Course",
    blurb: "Blair Warren's classic on the single sentence behind all persuasion — a quick read that sharpens every angle you write.",
    sortOrder: 4,
    fileName: "The One-Sentence Persuasion Course.pdf",
    parentSlug: "wd-campaign-toolkit",
  },
  {
    slug: "headline-library",
    section: "working_documents",
    kind: "group",
    displayTitle: "Headline Library",
    blurb: "The complete headline reference collection — teaching guides, fill-in-the-blank formulas, and classic swipe files.",
    sortOrder: 5,
    noteLine: "These are classic references. Never copy example headlines verbatim — everything you run still goes through compliance review.",
  },
  // Teaching Guides (read start to finish)
  hl(1, "Teaching Guides", "How to Write Magnetic Headlines", "How to Write Magnetic Headlines (Copyblogger).pdf",
    "Copyblogger's deep dive into headline psychology — the headline as a promise to your reader."),
  hl(2, "Teaching Guides", "Great Headlines Instantly", "Great Headlines Instantly (Robert Boduch).pdf",
    "Robert Boduch's complete 190-page manual: emotional triggers, 22 headline types, and a final-check checklist."),
  hl(3, "Teaching Guides", "The Entrepreneur's Headline Writing Blueprint", "The Entrepreneur's Headline Writing Blueprint (Robert Pascoe).pdf",
    "Robert Pascoe on the psychology of big-benefit and fear-of-loss headlines. Examples are inspiration only — never copy claims verbatim."),
  hl(4, "Teaching Guides", "How to Write Powerful Headlines", "How to Write Powerful Headlines (Andy Owen).pdf",
    "Andy Owen's timeless direct-response principles — the headline is 80 cents of your dollar."),
  hl(5, "Teaching Guides", "The Rhetoric of Headlines", "The Rhetoric of Headlines (Suzanne Pope).pdf",
    "Suzanne Pope on the classic rhetorical devices behind arresting headlines. Examples are big-brand ads — study the craft, not the format."),
  // Formulas & Checklists (keep open while you write)
  hl(11, "Formulas & Checklists", "Writing Killer Headlines", "Writing Killer Headlines (Stefan Georgi).pdf",
    "Stefan Georgi's 7 elements of high-converting native headlines, straight from the health/wellness trenches. Run everything through compliance."),
  hl(12, "Formulas & Checklists", "Headline Formulas by Funnel Stage", "Headline Formulas by Funnel Stage (Joel Klettke).pdf",
    "Joel Klettke's 50+ fill-in-the-blank formulas organized by where the reader is in the journey."),
  hl(13, "Formulas & Checklists", "The Conversational Copywriting Cheat Sheet", "The Conversational Copywriting Cheat Sheet (Bret Thomson).pdf",
    "Bret Thomson's headline templates plus the connector phrases that keep readers moving."),
  hl(14, "Formulas & Checklists", "The Big Headline Formula List", "The Big Headline Formula List (Neil Patel).pdf",
    "Neil Patel's broad formula collection. Skip the social/quiz styles — use the pain/gain and discovery formulas."),
  // Swipe Files (browse for inspiration or upload to ChatGPT)
  hl(21, "Swipe Files", "100 Greatest Headlines Ever Written", "100 Greatest Headlines Ever Written (Jay Abraham).pdf",
    "Jay Abraham's legendary collection, with notes on why each works."),
  hl(22, "Swipe Files", "The Eugene Schwartz Swipe File", "The Eugene Schwartz Swipe File.pdf",
    "Aggressive classic health/beauty headlines from the master. Inspiration only — most of these claims would not pass compliance today."),
  hl(23, "Swipe Files", "The Headline Masterclass Swipe File", "The Headline Masterclass Swipe File (Copywrite Matters).pdf",
    "Copywrite Matters' 110 templates organized by psychological trigger."),

  // ── Templates & Assets ─────────────────────────────────────────────────────
  {
    slug: "ta-tracking-templates",
    section: "templates_assets",
    kind: "group",
    displayTitle: "Tracking & Templates",
    blurb: "Your campaign P&L tracker plus the proven dedicated email template.",
    sortOrder: 1,
  },
  {
    slug: "ta-pnl-tracker",
    section: "templates_assets",
    kind: "external",
    displayTitle: "P&L Tracker",
    blurb: "Make your own copy of the campaign P&L tracking spreadsheet — if you can't track it, you can't manage it.",
    sortOrder: 1,
    externalUrl: "https://docs.google.com/spreadsheets/d/1zQ47ozphtdmTqbHaiqy3rA9-pZbaA7mUifptdLCRh20/copy",
    parentSlug: "ta-tracking-templates",
  },
  {
    slug: "ta-dedicated-email-template",
    section: "templates_assets",
    kind: "external",
    displayTitle: "Dedicated Email Template",
    blurb: "The proven dedicated email template (ZIP) — over $60 million in media sent through this exact layout.",
    sortOrder: 2,
    externalUrl: "https://experience.buildtestscale.com/wp-content/uploads/2025/04/1-DEDICATED-EMAIL-TEMPLATE.zip",
    parentSlug: "ta-tracking-templates",
  },
];

/**
 * One-time re-parenting (Task #2039): environments seeded before the group
 * cards existed have these six items at the section root. When (and only
 * when) the group row is created by THIS boot, ungrouped children are moved
 * under it. Because the move is gated on the group's creation, later admin
 * edits (including deliberately un-grouping an item) are never clobbered.
 */
export const GROUP_REPARENT: ReadonlyArray<{ groupSlug: string; childSlugs: readonly string[] }> = [
  {
    groupSlug: "wd-campaign-toolkit",
    childSlugs: [
      "wd-campaign-checklist",
      "wd-power-word-dictionary",
      "wd-context-word-dictionary",
      "wd-one-sentence-persuasion",
    ],
  },
  {
    groupSlug: "ta-tracking-templates",
    childSlugs: ["ta-pnl-tracker", "ta-dedicated-email-template"],
  },
];

// ── Glossary term list ────────────────────────────────────────────────────────
// Extracted from the legacy knowledgebase_docs glossary (category 'glossary';
// TERM LIST ONLY — the legacy definition text is never carried over), plus the
// working-vocabulary terms named in the hub spec. Definitions are AI-drafted
// from ai_live_documents and human-approved before members see them.
export const GLOSSARY_TERMS: readonly string[] = [
  "AIDA framework", "AOV", "ATC", "Advertorial", "Affiliate", "Affiliate network",
  "Angle", "Anstrex", "Banner", "CPA", "CPC", "CPM", "CTR", "Conversion (CV)",
  "Creative", "CropBot", "Customer Avatar", "DIYTrax", "DSP",
  "Email Newsletter Advertising", "Flexy", "Funnel", "Gifster", "Gravity Score",
  "Hero Shot", "Jump Page / Bridge Page", "KPIs", "Landing Page", "Listicle",
  "LiveIntent", "Media Buying", "MediaGo", "MediaMavens", "MetricMover",
  "Native Advertising", "NoEscape", "Offer", "Offer Page", "Optimization",
  "Pain Point", "PixelPress", "Pre-Qualifying", "Rev Share", "ScrapeBot",
  "Target CPA", "Tracking Tokens", "Vertical",
  // Working-vocabulary additions (Task #2028 spec)
  "Placement", "Phase Gate", "Caterpillar", "FreeAdCopy", "Swipe File",
];

// ── Phase 0: content-access gate migration ──────────────────────────────────
//
// The registry replaced the three legacy page keys (resource-library,
// creative-drive, knowledge-base) with a single `resource-hub` key. A missing
// content_access_map row means OPEN access, so any environment that had the
// legacy pages gated would silently lose that restriction on deploy. This
// carries the gating forward: the resource-hub row becomes the UNION of the
// legacy rows' product slugs (plus any existing resource-hub row's slugs),
// then the legacy rows are removed. Idempotent — a no-op once no legacy rows
// remain.
const LEGACY_ACCESS_KEYS = ["resource-library", "creative-drive", "knowledge-base"];
const HUB_ACCESS_KEY = "resource-hub";

export async function ensureResourceHubAccessMigration(): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${LOCK_KEY_1}, 3)`);

    const rows = await tx
      .select({
        id: contentAccessMapTable.id,
        pageKey: contentAccessMapTable.pageKey,
        productSlugs: contentAccessMapTable.productSlugs,
      })
      .from(contentAccessMapTable);

    const legacy = rows.filter((r) => LEGACY_ACCESS_KEYS.includes(r.pageKey));
    if (legacy.length === 0) return; // already migrated (or never gated)

    const hubRow = rows.find((r) => r.pageKey === HUB_ACCESS_KEY) ?? null;
    const union = Array.from(
      new Set([...(hubRow?.productSlugs ?? []), ...legacy.flatMap((r) => r.productSlugs)]),
    ).sort();

    if (union.length > 0) {
      if (hubRow) {
        await tx
          .update(contentAccessMapTable)
          .set({ productSlugs: union, updatedBy: "boot:resource-hub-migration" })
          .where(eq(contentAccessMapTable.id, hubRow.id));
      } else {
        await tx.insert(contentAccessMapTable).values({
          pageKey: HUB_ACCESS_KEY,
          productSlugs: union,
          updatedBy: "boot:resource-hub-migration",
        });
      }
    }

    for (const row of legacy) {
      await tx.delete(contentAccessMapTable).where(eq(contentAccessMapTable.id, row.id));
    }
    console.log(
      `[ResourceHub] access migration: merged ${legacy.length} legacy gate row(s) ` +
        `(${legacy.map((r) => r.pageKey).join(", ")}) → "${HUB_ACCESS_KEY}" ` +
        (union.length > 0 ? `gated on [${union.join(", ")}]` : "(no slugs — hub left open)"),
    );
  });
}

// ── Phase A: folder reorganization ───────────────────────────────────────────

export async function ensureResourceHubReorg(): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${LOCK_KEY_1}, 1)`);

    // 1. Delete retired files (drive rows; storage objects left behind — an
    //    orphaned blob is cheaper than deleting content by mistake).
    for (const name of DELETED_FILE_NAMES) {
      const deleted = await tx
        .delete(creativeDriveFilesTable)
        .where(eq(creativeDriveFilesTable.name, name))
        .returning({ id: creativeDriveFilesTable.id });
      if (deleted.length > 0) {
        console.log(`[ResourceHub] reorg: deleted retired file "${name}"`);
      }
    }

    // 2. Rename "Headline Writing" → "Headline Library" (skip when already done).
    const folderByName = async (name: string) => {
      const [row] = await tx
        .select({ id: creativeDriveFoldersTable.id })
        .from(creativeDriveFoldersTable)
        .where(eq(creativeDriveFoldersTable.name, name))
        .limit(1);
      return row ?? null;
    };

    const oldHeadline = await folderByName(OLD_HEADLINE_FOLDER);
    const newHeadline = await folderByName(HEADLINE_FOLDER);
    if (oldHeadline && !newHeadline) {
      await tx
        .update(creativeDriveFoldersTable)
        .set({ name: HEADLINE_FOLDER, updatedAt: new Date() })
        .where(eq(creativeDriveFoldersTable.id, oldHeadline.id));
      console.log(`[ResourceHub] reorg: renamed "${OLD_HEADLINE_FOLDER}" → "${HEADLINE_FOLDER}"`);
    }

    // 3. Ensure the new hub folders exist at root.
    const ensureFolder = async (name: string): Promise<number> => {
      const existing = await folderByName(name);
      if (existing) return existing.id;
      const [created] = await tx
        .insert(creativeDriveFoldersTable)
        .values({ name, parentId: null })
        .returning({ id: creativeDriveFoldersTable.id });
      console.log(`[ResourceHub] reorg: created folder "${name}"`);
      return created.id;
    };
    const workingDocsId = await ensureFolder(WORKING_DOCS_FOLDER);
    await ensureFolder(TEMPLATES_FOLDER);

    // 4. Move the working documents into "Working Documents" (match by exact
    //    name, only when not already there).
    for (const name of MOVED_TO_WORKING_DOCS) {
      const moved = await tx
        .update(creativeDriveFilesTable)
        .set({ folderId: workingDocsId, updatedAt: new Date() })
        .where(
          and(
            eq(creativeDriveFilesTable.name, name),
            sql`${creativeDriveFilesTable.folderId} IS DISTINCT FROM ${workingDocsId}`,
          ),
        )
        .returning({ id: creativeDriveFilesTable.id });
      if (moved.length > 0) {
        console.log(`[ResourceHub] reorg: moved "${name}" → "${WORKING_DOCS_FOLDER}"`);
      }
    }

    // 5. Apply friendly display names to the kept headline files.
    for (const { from, to } of HEADLINE_RENAMES) {
      const renamed = await tx
        .update(creativeDriveFilesTable)
        .set({ name: to, updatedAt: new Date() })
        .where(eq(creativeDriveFilesTable.name, from))
        .returning({ id: creativeDriveFilesTable.id });
      if (renamed.length > 0) {
        console.log(`[ResourceHub] reorg: renamed "${from}" → "${to}"`);
      }
    }

    // 6. Delete the emptied legacy folders (only when truly empty).
    for (const name of RETIRED_FOLDERS) {
      const folder = await folderByName(name);
      if (!folder) continue;
      const [{ files }] = (
        await tx.execute(sql`
          SELECT (SELECT count(*) FROM creative_drive_files WHERE folder_id = ${folder.id})
               + (SELECT count(*) FROM creative_drive_folders WHERE parent_id = ${folder.id}) AS files
        `)
      ).rows as Array<{ files: string }>;
      if (Number(files) === 0) {
        await tx
          .delete(creativeDriveFoldersTable)
          .where(eq(creativeDriveFoldersTable.id, folder.id));
        console.log(`[ResourceHub] reorg: deleted empty legacy folder "${name}"`);
      } else {
        console.warn(`[ResourceHub] reorg: legacy folder "${name}" not empty — left in place`);
      }
    }
  });
}

// ── Phase B: curation + glossary seeding ─────────────────────────────────────

export async function ensureResourceHubCuration(): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${LOCK_KEY_1}, 2)`);

    // Existing curation rows by slug (seed keys are stable; admin edits win —
    // an existing row is NEVER updated by this seed).
    const existing = await tx
      .select({ slug: resourceHubItemsTable.slug, id: resourceHubItemsTable.id })
      .from(resourceHubItemsTable);
    const idBySlug = new Map(existing.map((r) => [r.slug, r.id]));

    const files = await tx
      .select({ id: creativeDriveFilesTable.id, name: creativeDriveFilesTable.name })
      .from(creativeDriveFilesTable);
    const fileByName = new Map(files.map((f) => [f.name, f.id]));

    // Groups first so children can resolve parentId.
    const ordered = [...CURATION_SPEC].sort((a, b) =>
      a.kind === "group" && b.kind !== "group" ? -1 : a.kind !== "group" && b.kind === "group" ? 1 : 0,
    );

    let seeded = 0;
    const createdSlugs = new Set<string>();
    for (const item of ordered) {
      if (idBySlug.has(item.slug)) continue;

      let fileId: number | null = null;
      if (item.kind === "file") {
        fileId = fileByName.get(item.fileName!) ?? null;
        if (fileId === null) {
          // Fresh env without the admin-uploaded file — skip gracefully.
          console.warn(`[ResourceHub] curation: file "${item.fileName}" absent — skipping "${item.slug}"`);
          continue;
        }
      }
      let parentId: number | null = null;
      if (item.parentSlug) {
        parentId = idBySlug.get(item.parentSlug) ?? null;
        if (parentId === null) {
          console.warn(`[ResourceHub] curation: parent "${item.parentSlug}" absent — skipping "${item.slug}"`);
          continue;
        }
      }

      const [created] = await tx
        .insert(resourceHubItemsTable)
        .values({
          slug: item.slug,
          section: item.section,
          kind: item.kind,
          fileId,
          externalUrl: item.externalUrl ?? null,
          parentId,
          subGroupLabel: item.subGroupLabel ?? null,
          displayTitle: item.displayTitle,
          blurb: item.blurb,
          noteLine: item.noteLine ?? null,
          sortOrder: item.sortOrder,
        })
        .onConflictDoNothing({ target: resourceHubItemsTable.slug })
        .returning({ id: resourceHubItemsTable.id });
      if (created) {
        idBySlug.set(item.slug, created.id);
        createdSlugs.add(item.slug);
        seeded++;
      }
    }
    if (seeded > 0) console.log(`[ResourceHub] curation: seeded ${seeded} items`);

    // One-time re-parenting (Task #2039): only when the group row was created
    // by THIS run, pull its still-ungrouped children under it. Existing admin
    // parenting (non-null parentId) is never touched, and once the group
    // exists this whole block is a permanent no-op.
    for (const { groupSlug, childSlugs } of GROUP_REPARENT) {
      if (!createdSlugs.has(groupSlug)) continue;
      const groupId = idBySlug.get(groupSlug);
      if (!groupId) continue;
      const moved = await tx
        .update(resourceHubItemsTable)
        .set({ parentId: groupId })
        .where(
          and(
            inArray(resourceHubItemsTable.slug, [...childSlugs]),
            isNull(resourceHubItemsTable.parentId),
          ),
        )
        .returning({ slug: resourceHubItemsTable.slug });
      if (moved.length > 0) {
        console.log(
          `[ResourceHub] curation: re-parented ${moved.length} item(s) under "${groupSlug}" (${moved
            .map((m) => m.slug)
            .join(", ")})`,
        );
      }
    }

    // Repair retired-page references inside published Live AI Docs so the
    // assistant never cites /resource-library, /creative-drive, or
    // /knowledge-base (all redirect to /resource-hub now). Plain string
    // replacement — inherently idempotent (a replaced doc no longer matches).
    const LIVE_DOC_LINK_FIXES: ReadonlyArray<{ from: string; to: string }> = [
      { from: "Resource Library — Creative Drive (/resource-library)", to: "Resource Hub (/resource-hub)" },
      { from: "Resource Library — /resource-library", to: "Resource Hub — /resource-hub" },
      { from: "Resource Library (/resource-library)", to: "Resource Hub (/resource-hub)" },
      { from: "Resource Library /resource-library", to: "Resource Hub /resource-hub" },
      { from: "Creative Drive (/creative-drive)", to: "Resource Hub (/resource-hub)" },
      { from: "Knowledge Base (/knowledge-base)", to: "Resource Hub (/resource-hub)" },
      { from: "/resource-library", to: "/resource-hub" },
      { from: "/creative-drive", to: "/resource-hub" },
      { from: "/knowledge-base", to: "/resource-hub" },
    ];
    for (const { from, to } of LIVE_DOC_LINK_FIXES) {
      const updated = await tx.execute(sql`
        UPDATE ai_live_documents
        SET content = replace(content, ${from}, ${to}), updated_at = now()
        WHERE content LIKE ${"%" + from + "%"}
        RETURNING id
      `);
      if (updated.rows.length > 0) {
        console.log(
          `[ResourceHub] live-doc link repair: "${from}" → "${to}" in ${updated.rows.length} doc(s)`,
        );
      }
    }

    // Rename the legacy "Resource Library" assistant card in place so the
    // card seed (keyed on title) matches it instead of inserting a duplicate.
    await tx.execute(sql`
      UPDATE assistant_cards
      SET title = 'Resource Hub',
          description = 'Finding the Foundations series, working documents, templates, and the glossary on the Resource Hub.'
      WHERE title = 'Resource Library'
        AND NOT EXISTS (SELECT 1 FROM assistant_cards WHERE title = 'Resource Hub')
    `);

    // Glossary term list (insert-if-absent; reviewer/admin edits always win).
    const inserted = await tx
      .insert(resourceHubGlossaryTable)
      .values(GLOSSARY_TERMS.map((term) => ({ term })))
      .onConflictDoNothing({ target: resourceHubGlossaryTable.term })
      .returning({ id: resourceHubGlossaryTable.id });
    if (inserted.length > 0) {
      console.log(`[ResourceHub] glossary: seeded ${inserted.length} draft terms`);
    }
  });
}
