import {
  db,
  creativeDriveFoldersTable,
  creativeDriveFilesTable,
  resourceHubItemsTable,
  resourceHubGlossaryTable,
  contentAccessMapTable,
} from "@workspace/db";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { snapshotLiveDocVersion } from "./live-doc-snapshot.js";

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
    blurb: "A nine-part series on writing headlines and ad copy that convert — work through the parts in order.",
    sortOrder: 1,
  },
  cw(1, "What a Headline Actually Does", "The single job a headline has — and why most beginner headlines fail at it."),
  cw(2, "Finding Your Angle", "Choosing the big idea your ad leads with — before you write a single headline."),
  cw(3, "Extracting Angles from Existing Copy", "Mining the advertorial and sales page for angles already anchored to the offer."),
  cw(4, "Selling the Benefit, Not the Product", "How to translate features into the benefit your reader actually buys."),
  cw(5, "Curiosity — Withholding the How", "Building curiosity gaps that pull the click without giving the answer away."),
  cw(6, "Believability and Proof", "Making big claims believable with proof, specifics, and restraint."),
  cw(7, "Headline Formulas and the Swipe File", "How to use formulas and swipe files without writing copycat headlines."),
  cw(8, "Word Choice — Context and Power", "Choosing the power and context words that carry real weight."),
  cw(9, "The Headline Word Palette", "The working word palette to draw from when drafting headlines."),
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
    blurb:
      "The step-by-step pre-launch checklist — work through it before you activate any campaign. This is a printable version of the Checklist page found in the Blitz™.",
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

// ── Phase 0b: one-time LaunchPad+ tighten (view-only hub, owner decision) ────
//
// The Resource Hub was originally seeded open to all front-end offers. The
// owner restricted it to LaunchPad-and-above (mentorship tiers only), so
// already-seeded environments (dev AND prod on next publish) must have any
// front-end/funnel product slugs stripped from the existing resource-hub map
// row. Marker-gated in system_settings so it runs exactly once per
// environment — after that, admin edits (including deliberately re-opening
// the hub to a front-end product) always win.
const LAUNCHPAD_TIGHTEN_MARKER = "resource_hub_launchpad_tighten_2026_08";

export async function ensureResourceHubLaunchpadTighten(): Promise<void> {
  const { MAPPABLE_PRODUCTS } = await import("@workspace/content-access-registry");
  const nonMentorship = new Set(
    MAPPABLE_PRODUCTS.filter((p) => p.group !== "mentorship").map((p) => p.slug),
  );

  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${LOCK_KEY_1}, 5)`);

    const marker = await tx.execute(
      sql`SELECT value FROM system_settings WHERE key = ${LAUNCHPAD_TIGHTEN_MARKER}`,
    );
    if ((marker as unknown as { rows: unknown[] }).rows.length > 0) return;

    const [hubRow] = await tx
      .select({
        id: contentAccessMapTable.id,
        productSlugs: contentAccessMapTable.productSlugs,
      })
      .from(contentAccessMapTable)
      .where(eq(contentAccessMapTable.pageKey, HUB_ACCESS_KEY))
      .limit(1);

    let removed: string[] = [];
    if (hubRow) {
      const kept = hubRow.productSlugs.filter((s) => !nonMentorship.has(s));
      removed = hubRow.productSlugs.filter((s) => nonMentorship.has(s));
      if (removed.length > 0) {
        await tx
          .update(contentAccessMapTable)
          .set({
            productSlugs: kept,
            updatedBy: "boot:resource-hub-launchpad-tighten",
            updatedAt: new Date(),
          })
          .where(eq(contentAccessMapTable.id, hubRow.id));
      }
    }

    await tx.execute(sql`
      INSERT INTO system_settings (key, value)
      VALUES (${LAUNCHPAD_TIGHTEN_MARKER}, ${JSON.stringify({ ranAt: new Date().toISOString(), removed })})
      ON CONFLICT (key) DO NOTHING`);

    if (removed.length > 0) {
      console.log(
        `[ResourceHub] LaunchPad+ tighten (one-time): removed [${removed.join(", ")}] from the "${HUB_ACCESS_KEY}" access row`,
      );
    }
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

// ── Phase A2: admin-uploaded drive file rows (durable-storage seed) ──────────
//
// Canary Close-Out item 2: the Headline Library set, both word dictionaries,
// and The One-Sentence Persuasion Course were uploaded through the dev admin
// UI, so their `creative_drive_files` rows existed only in the dev DB — a
// fresh prod boot found no rows, and the curation seed skipped those hub
// entries ("file ... absent"). The PDF *bytes* already live in the shared,
// durable object-storage bucket (`/objects/uploads/<id>`), which every
// environment reads. This seed makes the DB rows themselves boot-derived:
// insert-if-absent by exact file name, pointing at the existing bucket
// object, gated on the object actually existing (skip + warn when the bucket
// genuinely lacks it, e.g. a scratch env with a different bucket). Admin
// renames/moves win — an existing row with the name is never touched, and
// rows are keyed by the same exact names Phase A's rename/move steps produce.
interface UploadedFileSeed {
  name: string;
  objectPath: string;
  mimeType: string;
  sizeBytes: number;
  folder: string;
}

export const UPLOADED_FILE_SEEDS: readonly UploadedFileSeed[] = [
  // Working Documents
  { name: "Power Word Dictionary.pdf", objectPath: "/objects/uploads/8eb032eb-d57f-4764-9f16-a8a34f2de4d8", mimeType: "application/pdf", sizeBytes: 117778, folder: WORKING_DOCS_FOLDER },
  { name: "Context Word Dictionary.pdf", objectPath: "/objects/uploads/a71be5e0-b8e5-49bc-9084-f93180fa0a19", mimeType: "application/pdf", sizeBytes: 615947, folder: WORKING_DOCS_FOLDER },
  { name: "The One-Sentence Persuasion Course.pdf", objectPath: "/objects/uploads/cfba8b51-b92e-4a32-ab8e-a2da0e8df7ad", mimeType: "application/pdf", sizeBytes: 229831, folder: WORKING_DOCS_FOLDER },
  // Headline Library
  { name: "How to Write Magnetic Headlines (Copyblogger).pdf", objectPath: "/objects/uploads/6b8f9ac8-329d-46bd-9367-17e5b153ae39", mimeType: "application/pdf", sizeBytes: 356190, folder: HEADLINE_FOLDER },
  { name: "Great Headlines Instantly (Robert Boduch).pdf", objectPath: "/objects/uploads/68d82031-2e6f-4bc7-81da-db33bf459f9e", mimeType: "application/pdf", sizeBytes: 862973, folder: HEADLINE_FOLDER },
  { name: "The Entrepreneur's Headline Writing Blueprint (Robert Pascoe).pdf", objectPath: "/objects/uploads/b1f76bef-b0ff-45b2-8bfe-6052e597e446", mimeType: "application/pdf", sizeBytes: 1428039, folder: HEADLINE_FOLDER },
  { name: "How to Write Powerful Headlines (Andy Owen).pdf", objectPath: "/objects/uploads/7ed0decb-2e3e-4341-bbaf-47278d1ee24a", mimeType: "application/pdf", sizeBytes: 2082309, folder: HEADLINE_FOLDER },
  { name: "The Rhetoric of Headlines (Suzanne Pope).pdf", objectPath: "/objects/uploads/f9fd4a93-ec40-491f-b3c1-d34b5e90aa38", mimeType: "application/pdf", sizeBytes: 8772458, folder: HEADLINE_FOLDER },
  { name: "Writing Killer Headlines (Stefan Georgi).pdf", objectPath: "/objects/uploads/d2a2dfb2-181e-457e-baab-652593333d42", mimeType: "application/pdf", sizeBytes: 829991, folder: HEADLINE_FOLDER },
  { name: "Headline Formulas by Funnel Stage (Joel Klettke).pdf", objectPath: "/objects/uploads/f2d6aece-4b29-427e-b45a-14febcef4a65", mimeType: "application/pdf", sizeBytes: 175592, folder: HEADLINE_FOLDER },
  { name: "The Conversational Copywriting Cheat Sheet (Bret Thomson).pdf", objectPath: "/objects/uploads/01fc5388-617e-400a-844a-ab4b9db20b3a", mimeType: "application/pdf", sizeBytes: 857608, folder: HEADLINE_FOLDER },
  { name: "The Big Headline Formula List (Neil Patel).pdf", objectPath: "/objects/uploads/c6faaf86-838e-459b-abb8-24ecdadc0c0c", mimeType: "application/pdf", sizeBytes: 291219, folder: HEADLINE_FOLDER },
  { name: "100 Greatest Headlines Ever Written (Jay Abraham).pdf", objectPath: "/objects/uploads/e0dffdc1-3444-4bff-9eff-391f94bb3637", mimeType: "application/pdf", sizeBytes: 136651, folder: HEADLINE_FOLDER },
  { name: "The Eugene Schwartz Swipe File.pdf", objectPath: "/objects/uploads/0b1483a9-b51b-4424-9093-1b4c0bff2100", mimeType: "application/pdf", sizeBytes: 1417105, folder: HEADLINE_FOLDER },
  { name: "The Headline Masterclass Swipe File (Copywrite Matters).pdf", objectPath: "/objects/uploads/847a5e27-9030-44a7-b877-0348239fbc6a", mimeType: "application/pdf", sizeBytes: 476762, folder: HEADLINE_FOLDER },
];

export async function ensureUploadedDriveFiles(): Promise<void> {
  // Existence checks against the bucket happen OUTSIDE the transaction (slow
  // network calls; no need to hold the lock). Import lazily so environments
  // without object storage configured fail per-file, not at module load.
  const { ObjectStorageService } = await import("./objectStorage");
  const storage = new ObjectStorageService();

  const existingRows = await db
    .select({ name: creativeDriveFilesTable.name, objectPath: creativeDriveFilesTable.objectPath })
    .from(creativeDriveFilesTable);
  const existingNames = new Set(existingRows.map((r) => r.name));
  // Rename safety: a row already pointing at the seed's bucket object means
  // the file exists (possibly admin-renamed) — never recreate it by name.
  const existingObjectPaths = new Set(existingRows.map((r) => r.objectPath));

  const toInsert: UploadedFileSeed[] = [];
  for (const seed of UPLOADED_FILE_SEEDS) {
    if (existingNames.has(seed.name) || existingObjectPaths.has(seed.objectPath)) continue;
    try {
      await storage.getObjectEntityFile(seed.objectPath); // throws when absent
      toInsert.push(seed);
    } catch {
      console.warn(
        `[ResourceHub] uploaded-file seed: bucket object missing for "${seed.name}" (${seed.objectPath}) — skipping`,
      );
    }
  }
  if (toInsert.length === 0) return;

  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${LOCK_KEY_1}, 4)`);

    const folderIdByName = new Map<string, number>();
    const resolveFolder = async (name: string): Promise<number> => {
      const cached = folderIdByName.get(name);
      if (cached !== undefined) return cached;
      const [existing] = await tx
        .select({ id: creativeDriveFoldersTable.id })
        .from(creativeDriveFoldersTable)
        .where(eq(creativeDriveFoldersTable.name, name))
        .limit(1);
      let id = existing?.id;
      if (id === undefined) {
        const [created] = await tx
          .insert(creativeDriveFoldersTable)
          .values({ name, parentId: null })
          .returning({ id: creativeDriveFoldersTable.id });
        id = created.id;
        console.log(`[ResourceHub] uploaded-file seed: created folder "${name}"`);
      }
      folderIdByName.set(name, id);
      return id;
    };

    let seeded = 0;
    for (const seed of toInsert) {
      // Re-check inside the lock (another boot may have inserted meanwhile) —
      // by name AND by object path (rename safety).
      const [row] = await tx
        .select({ id: creativeDriveFilesTable.id })
        .from(creativeDriveFilesTable)
        .where(
          sql`${creativeDriveFilesTable.name} = ${seed.name} OR ${creativeDriveFilesTable.objectPath} = ${seed.objectPath}`,
        )
        .limit(1);
      if (row) continue;
      await tx.insert(creativeDriveFilesTable).values({
        name: seed.name,
        folderId: await resolveFolder(seed.folder),
        objectPath: seed.objectPath,
        mimeType: seed.mimeType,
        sizeBytes: seed.sizeBytes,
      });
      seeded++;
    }
    if (seeded > 0) {
      console.log(`[ResourceHub] uploaded-file seed: inserted ${seeded} drive file row(s)`);
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

    // Targeted copy refreshes for already-seeded rows: only rows whose blurb
    // still exactly matches the OLD seed text are updated, so any admin edit
    // wins and the repair is a permanent no-op once applied.
    const BLURB_REFRESHES: ReadonlyArray<{ slug: string; from: string; to: string }> = [
      {
        slug: "wd-campaign-checklist",
        from: "The step-by-step pre-launch checklist — work through it before you activate any campaign.",
        to: "The step-by-step pre-launch checklist — work through it before you activate any campaign. This is a printable version of the Checklist page found in the Blitz™.",
      },
      {
        slug: "foundations-copywriting",
        from: "An eight-part series on writing headlines and ad copy that convert — work through the parts in order.",
        to: "A nine-part series on writing headlines and ad copy that convert — work through the parts in order.",
      },
    ];
    for (const fix of BLURB_REFRESHES) {
      const updated = await tx
        .update(resourceHubItemsTable)
        .set({ blurb: fix.to })
        .where(and(eq(resourceHubItemsTable.slug, fix.slug), eq(resourceHubItemsTable.blurb, fix.from)))
        .returning({ slug: resourceHubItemsTable.slug });
      if (updated.length > 0) {
        console.log(`[ResourceHub] curation: refreshed blurb for "${fix.slug}"`);
      }
    }

    // Copywriting Foundations 9-doc reorder (Task #2095): environments seeded
    // with the original 8-doc series have curation rows 2-8 whose slugs are
    // positional (foundations-copywriting-N) but whose titles/blurbs now
    // belong at a different position. The Drive seed repoints each drive-file
    // row IN PLACE by sortOrder, so each curation row's fileId already points
    // at the file now occupying that position — only the display copy needs
    // repair. Gated on the exact OLD seed title so admin edits always win,
    // and a permanent no-op once applied.
    const FOUNDATIONS_RETITLES: ReadonlyArray<{ slug: string; fromTitle: string; toTitle: string; toBlurb: string }> = [
      { slug: "foundations-copywriting-2", fromTitle: "Selling the Benefit, Not the Product", toTitle: "Finding Your Angle", toBlurb: "Choosing the big idea your ad leads with — before you write a single headline." },
      { slug: "foundations-copywriting-3", fromTitle: "Curiosity — Withholding the How", toTitle: "Extracting Angles from Existing Copy", toBlurb: "Mining the advertorial and sales page for angles already anchored to the offer." },
      { slug: "foundations-copywriting-4", fromTitle: "Finding Your Angle", toTitle: "Selling the Benefit, Not the Product", toBlurb: "How to translate features into the benefit your reader actually buys." },
      { slug: "foundations-copywriting-5", fromTitle: "Believability and Proof", toTitle: "Curiosity — Withholding the How", toBlurb: "Building curiosity gaps that pull the click without giving the answer away." },
      { slug: "foundations-copywriting-6", fromTitle: "Headline Formulas and the Swipe File", toTitle: "Believability and Proof", toBlurb: "Making big claims believable with proof, specifics, and restraint." },
      { slug: "foundations-copywriting-7", fromTitle: "Word Choice — Context and Power", toTitle: "Headline Formulas and the Swipe File", toBlurb: "How to use formulas and swipe files without writing copycat headlines." },
      { slug: "foundations-copywriting-8", fromTitle: "The Headline Word Palette", toTitle: "Word Choice — Context and Power", toBlurb: "Choosing the power and context words that carry real weight." },
    ];
    for (const fix of FOUNDATIONS_RETITLES) {
      const updated = await tx
        .update(resourceHubItemsTable)
        .set({ displayTitle: fix.toTitle, blurb: fix.toBlurb })
        .where(
          and(
            eq(resourceHubItemsTable.slug, fix.slug),
            eq(resourceHubItemsTable.displayTitle, fix.fromTitle),
          ),
        )
        .returning({ slug: resourceHubItemsTable.slug });
      if (updated.length > 0) {
        console.log(`[ResourceHub] curation: retitled "${fix.slug}" → "${fix.toTitle}"`);
      }
    }

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
    // Task #2098: content mutation on live docs must snapshot version history
    // first (same transaction) and clear stale embeddings atomically — the
    // boot embedding backfill regenerates them. Snapshot each affected doc at
    // most once per boot run, before its first change.
    const snapshottedThisRun = new Set<number>();
    for (const { from, to } of LIVE_DOC_LINK_FIXES) {
      const affected = await tx.execute(sql`
        SELECT id FROM ai_live_documents
        WHERE content LIKE ${"%" + from + "%"}
        FOR UPDATE
      `);
      if (affected.rows.length === 0) continue;
      for (const row of affected.rows as Array<{ id: number }>) {
        const docId = Number(row.id);
        if (!snapshottedThisRun.has(docId)) {
          await snapshotLiveDocVersion(tx, docId);
          snapshottedThisRun.add(docId);
        }
      }
      const updated = await tx.execute(sql`
        UPDATE ai_live_documents
        SET content = replace(content, ${from}, ${to}),
            updated_at = now(),
            embedding = NULL,
            embedding_model = NULL,
            embedding_generated_at = NULL
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
