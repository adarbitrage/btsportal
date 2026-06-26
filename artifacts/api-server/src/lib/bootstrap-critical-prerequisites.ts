import { db, productsTable, chatSystemPromptsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { runTapfiliateColumnMigration } from "./tapfiliate-migration";
import { seedYseProducts } from "./seed-yse-products";
import { seedMachineBrandProducts } from "./seed-machine-brand-products";
import { reconcileEntitlementKeys } from "./reconcile-entitlement-keys";
import { seedMachineProductKeyMappings } from "./machine-product-key-mappings";
import {
  seedKnowledgebaseFromFiles,
  seedInternalSops,
  ensureBtsAgreementKbContent,
  reclassifyKnowledgebaseDocClasses,
} from "./seed-kb";
import { seedMemberBroadContent } from "./seed-kb-member-content";
import { seedOperationsKb } from "./seed-operations-kb";
import { seedProcessKb } from "./seed-process-kb";
import { seedConceptsKb } from "./seed-concepts-kb";
import {
  rescrubKnowledgebaseDocs,
  findUnscrubbedTitles,
} from "./rescrub-knowledgebase-docs";
import {
  ANTI_HALLUCINATION_SYSTEM_PROMPT,
  ANTI_HALLUCINATION_SENTINEL,
  DIRECT_ANSWER_SENTINEL,
  BLITZ_NAMING_SENTINEL,
  LEGACY_GENERIC_KB_TITLES,
} from "./chat-system-prompt";
import { ensureFoundingSuperAdmins } from "./ensure-founding-superadmins";
import { backfillUndeliveredTickets } from "./ticketdesk-queue";
import { migrateOneOffCoachingCallsToTemplates } from "./coaching-call-migrate-oneoffs";

// Critical prerequisites for the /api/integrations/machine-purchase and
// /api/integrations/grant-product endpoints. Both are awaited from index.ts
// BEFORE the HTTP server starts accepting traffic so a freshly-deployed
// instance can never race a request that lands during seeding.
//
// Each check logs loudly on failure so on-call sees drift in the deploy
// log immediately rather than discovering it via 5xx alerts hours later.
// Checks throw if a prerequisite cannot be satisfied — index.ts decides
// whether that's fatal (preferred) or surface-only (degraded).

export interface PrerequisiteResult {
  ok: boolean;
  missing: string[];
}

export async function bootstrapCriticalPrerequisites(): Promise<PrerequisiteResult> {
  const missing: string[] = [];

  // 0. Add Tapfiliate columns (IF NOT EXISTS — idempotent).
  try {
    await runTapfiliateColumnMigration();
  } catch (err) {
    console.error("[Bootstrap] runTapfiliateColumnMigration() threw:", err);
    missing.push("tapfiliateColumnMigration");
  }

  // 0a. Add ticket delivery-status columns (IF NOT EXISTS — idempotent).
  //     These columns track whether each portal ticket was successfully mirrored
  //     to TicketDesk; they power the admin UI delivery badge and the System
  //     Health undelivered-ticket counter. Added at boot so production picks
  //     them up on the next deploy without a separate migration run.
  try {
    await runTicketDeliveryColumnMigration();
  } catch (err) {
    console.error("[Bootstrap] runTicketDeliveryColumnMigration() threw:", err);
    missing.push("ticketDeliveryColumnMigration");
  }

  // 0a-2. Add knowledgebase_docs.audience column (IF NOT EXISTS — idempotent).
  //       Every member-facing KB retrieval path (AI Assistant chat, voice KB
  //       search, RAG retriever, searchTranscripts) now filters on this column
  //       to exclude admin-only docs. Added at boot so existing databases pick
  //       it up BEFORE any retrieval query references it, avoiding a
  //       "column audience does not exist" runtime error on environments where
  //       the schema push hasn't run yet.
  try {
    await runKnowledgebaseAudienceColumnMigration();
  } catch (err) {
    console.error("[Bootstrap] runKnowledgebaseAudienceColumnMigration() threw:", err);
    missing.push("knowledgebaseAudienceColumnMigration");
  }

  // 0a-3. Add knowledgebase_docs.source_path and source_label columns
  //       (IF NOT EXISTS — idempotent). These columns power the member KB search
  //       deep-links. Added at boot so /kb/search queries and the broad-content
  //       seed never hit a "column does not exist" error on environments where
  //       the schema push hasn't run yet.
  try {
    await runKnowledgebaseSourceColumnsMigration();
  } catch (err) {
    console.error("[Bootstrap] runKnowledgebaseSourceColumnsMigration() threw:", err);
    missing.push("knowledgebaseSourceColumnsMigration");
  }

  // 0b. Backfill undelivered tickets — runs in the background after the HTTP
  //     server starts so it doesn't delay boot.  The backfill is idempotent
  //     (delivery_last_attempt_at IS NULL guard) and only touches tickets
  //     created more than 15 minutes ago so in-flight queue jobs are not
  //     double-notified.
  backfillUndeliveredTickets().catch((err) => {
    console.error("[Bootstrap] backfillUndeliveredTickets() threw:", err);
  });

  // 1. YSE product seeding — endpoint returns UNKNOWN_SLUGS / 500 without it.
  try {
    await seedYseProducts();
  } catch (err) {
    console.error("[Bootstrap] seedYseProducts() threw:", err);
    missing.push("seedYseProducts");
  }

  // 1a. Machine brand products (backroad, offmarket, reserve_income,
  //     silent_partner, test_like_mad). These were dev-only (seed.ts) and
  //     therefore absent in production — /grant-product returns UNKNOWN_SLUGS
  //     for them without this seeder. Idempotent: insert-if-missing on slug.
  try {
    await seedMachineBrandProducts();
  } catch (err) {
    console.error("[Bootstrap] seedMachineBrandProducts() threw:", err);
    missing.push("seedMachineBrandProducts");
  }

  // 1b. Default machine_product_key_mappings rows so the receiver can
  //     translate Machine `portal_product_keys` → Portal product slugs on a
  //     freshly-provisioned environment. Admin edits are preserved via
  //     onConflictDoNothing so a restart never clobbers them.
  try {
    await seedMachineProductKeyMappings();
  } catch (err) {
    console.error("[Bootstrap] seedMachineProductKeyMappings() threw:", err);
    missing.push("seedMachineProductKeyMappings");
  }

  // 2. Verify yse_front_end product actually exists post-seed (catches
  //    transient DB issues during seeding).
  const [yseFrontEnd] = await db
    .select({ id: productsTable.id })
    .from(productsTable)
    .where(eq(productsTable.slug, "yse_front_end"))
    .limit(1);
  if (!yseFrontEnd) {
    console.error(
      "[Bootstrap] CRITICAL: products.yse_front_end row is MISSING after seeding. " +
        "POST /api/integrations/machine-purchase will return 500 UNKNOWN_SLUGS until this is fixed.",
    );
    missing.push("products.yse_front_end");
  }

  // 3. Verify webhook_logs.external_id has the unique constraint required by
  //    external-grant-product.ts ON CONFLICT clause. Without it, every
  //    machine-purchase request crashes at the webhook_logs upsert.
  const constraintRows = await db.execute(
    sql`SELECT 1 FROM pg_constraint
        WHERE conrelid = 'webhook_logs'::regclass
          AND contype = 'u'
          AND conkey = (
            SELECT array_agg(attnum)
            FROM pg_attribute
            WHERE attrelid = 'webhook_logs'::regclass
              AND attname = 'external_id'
          )
        LIMIT 1`,
  );
  // node-postgres returns `.rows`; drizzle's execute() returns the raw result.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = (constraintRows as any).rows ?? constraintRows;
  if (!Array.isArray(rows) || rows.length === 0) {
    console.error(
      "[Bootstrap] CRITICAL: webhook_logs.external_id has NO unique constraint. " +
        "POST /api/integrations/machine-purchase and /api/integrations/grant-product " +
        "will return 500 on every call (ON CONFLICT clause requires this constraint). " +
        "Fix: apply the drizzle schema (lib/db/src/schema/webhook-logs.ts declares .unique()) " +
        "via Publish schema diff, or ALTER TABLE webhook_logs ADD CONSTRAINT " +
        "webhook_logs_external_id_unique UNIQUE (external_id).",
    );
    missing.push("webhook_logs.external_id UNIQUE constraint");
  }

  // 4. Remove legacy generic KB docs and ensure the anti-hallucination system
  //    prompt is active. Idempotent: safe to run on every startup.
  try {
    await ensureKBGrounding();
  } catch (err) {
    console.error("[Bootstrap] ensureKBGrounding() threw:", err);
    missing.push("ensureKBGrounding");
  }

  // 5. Ensure the founding super_admins (Adam + Sandy) always hold super_admin.
  //    Breaks the "0 super_admins, but assigning roles needs a super_admin"
  //    deadlock on a fresh production DB, and idempotently promotes any founder
  //    who isn't super_admin yet. No-op once both founders are super_admin.
  try {
    await ensureFoundingSuperAdmins();
  } catch (err) {
    console.error("[Bootstrap] ensureFoundingSuperAdmins() threw:", err);
    missing.push("ensureFoundingSuperAdmins");
  }

  // 1c. Additive entitlement-key reconcile: grants new brand/offer keys to
  //     existing product rows without removing any prior keys. Idempotent:
  //     re-running when keys are already present is a no-op.
  try {
    await reconcileEntitlementKeys();
  } catch (err) {
    console.error("[Bootstrap] reconcileEntitlementKeys() threw:", err);
    missing.push("reconcileEntitlementKeys");
  }

  // 5a. Convert legacy one-off coaching calls into recurring schedule
  //     templates (one-time, idempotent — no-op once any template exists). This
  //     is what powers the schedule-first admin Group Calls panel. Runs at boot
  //     so production picks it up on the next deploy without a manual migration.
  try {
    await migrateOneOffCoachingCallsToTemplates();
  } catch (err) {
    console.error(
      "[Bootstrap] migrateOneOffCoachingCallsToTemplates() threw:",
      err,
    );
    missing.push("migrateOneOffCoachingCallsToTemplates");
  }

  // 6. Update the company contact address from the old Plano address to the
  //    new Austin address in KB docs and legal documents. Idempotent: rows that
  //    already have the new address are not touched. This must run at boot so
  //    that production environments (which cannot be reached by the dev seed)
  //    also receive the update on next deploy.
  try {
    await ensureCompanyAddressUpdated();
  } catch (err) {
    console.error("[Bootstrap] ensureCompanyAddressUpdated() threw:", err);
    missing.push("ensureCompanyAddressUpdated");
  }

  // 7. Replace every numeric "14-Day Blitz" / "14-day blitz" / "14 Day Blitz"
  //    variant with the spelled-out "Fourteen-Day Blitz" in knowledgebase_docs
  //    and kb_staging_docs. This ensures the text-to-speech engine says
  //    "fourteen-day" rather than "one-four-day". Idempotent: rows that already
  //    carry the spelled-out form (or don't contain the phrase at all) are
  //    untouched. Must run at boot so production also receives the fix.
  try {
    await ensureFourteenDayBlitzPronunciation();
  } catch (err) {
    console.error("[Bootstrap] ensureFourteenDayBlitzPronunciation() threw:", err);
    missing.push("ensureFourteenDayBlitzPronunciation");
  }

  // 8. Force-refresh the refund + BTS Mentorship Agreement KB articles and the
  //    affiliate-marketing glossary from the source files (overwriting stale
  //    rows). The normal KB seeder uses ON CONFLICT DO NOTHING, so it can add
  //    the five new Agreement articles but can never update the two pre-existing
  //    refund articles or the glossary rows that already carry stale content.
  //    Production is a separate database the agent cannot write directly, so
  //    this overwrite only reaches it when a freshly-deployed instance applies
  //    it on boot. Idempotent: only rows whose content/category actually differ
  //    from the source are rewritten.
  try {
    await ensureBtsAgreementKbContent();
  } catch (err) {
    console.error("[Bootstrap] ensureBtsAgreementKbContent() threw:", err);
    missing.push("ensureBtsAgreementKbContent");
  }

  // 8b. Seed the Operations root (Task #3, Bucket C): human-verified curated
  //     docs for the coach roster, support routing/escalation, coaching call
  //     hours, refunds, membership basics, "how to get help", and the current
  //     portal navigation map. Stamped with a fixed authored verification date
  //     so they are immediately citable. Idempotent (keyed on title, only
  //     rewrites changed rows); reaches prod only on boot.
  try {
    await seedOperationsKb();
  } catch (err) {
    console.error("[Bootstrap] seedOperationsKb() threw:", err);
    missing.push("seedOperationsKb");
  }

  // 8c. Seed the Process root (Task #4a, Bucket A→B — content campaign):
  //     human-verified curated/overview docs for the campaign-build lifecycle,
  //     mined from the clean training-video corpus and rewritten as current
  //     BTS truth (stale brand/product/portal-nav references translated; in-app
  //     nav preserved). Covers all eight Process nodes, highest-demand gaps
  //     (DIYTrax/Flexy/MetricMover/Caterpillar) first. Stamped with a fixed
  //     authored verification date so they are immediately citable. Idempotent
  //     (keyed on title, only rewrites changed rows); reaches prod only on boot.
  try {
    await seedProcessKb();
  } catch (err) {
    console.error("[Bootstrap] seedProcessKb() threw:", err);
    missing.push("seedProcessKb");
  }

  // 8d. Seed the Concepts & Skills root (Task #4b, Bucket A→B): human-verified
  //     curated docs for the marketing-craft topics (angles, headlines & copy,
  //     creative strategy, offer strategy, testing methodology, scaling
  //     strategy, metrics & unit economics, traffic & placements), synthesised
  //     from the coaching transcripts and rewritten into current BTS voice.
  //     Each carries the conceptual→coaching depth ceiling. Stamped with a
  //     fixed authored verification date so they are immediately citable.
  //     Idempotent (keyed on title, only rewrites changed rows); reaches prod
  //     only on boot.
  try {
    await seedConceptsKb();
  } catch (err) {
    console.error("[Bootstrap] seedConceptsKb() threw:", err);
    missing.push("seedConceptsKb");
  }

  // 9. Backfill doc_class on every legacy knowledgebase_docs row so transcript-
  //    derived rows (coaching / curriculum) are reclassified as non-citable
  //    training data BEFORE the assistant serves a single answer. Idempotent
  //    (only touches NULL doc_class). Awaited so the reclassification is in
  //    place before retrieval runs; reaches prod via boot (post-merge is dev-only).
  try {
    await reclassifyKnowledgebaseDocClasses();
  } catch (err) {
    console.error("[Bootstrap] reclassifyKnowledgebaseDocClasses() threw:", err);
    missing.push("reclassifyKnowledgebaseDocClasses");
  }

  if (missing.length === 0) {
    console.log("[Bootstrap] All critical prerequisites OK");
  }

  return { ok: missing.length === 0, missing };
}

export async function ensureKBGrounding(): Promise<void> {
  // 1. Remove legacy generic KB docs that can bias retrieval toward non-BTS facts.
  //    These were the original 10 placeholder rows seeded before real BTS content
  //    was ingested. The real BTS corpus (curriculum, faq, glossary, coaching, etc.)
  //    now covers these topics with authoritative content.
  const placeholders = LEGACY_GENERIC_KB_TITLES.map((t) => `'${t.replace(/'/g, "''")}'`).join(", ");
  const deleteResult = await db.execute(
    sql.raw(`DELETE FROM knowledgebase_docs WHERE title IN (${placeholders}) RETURNING id`),
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const deletedCount = ((deleteResult as any).rows ?? deleteResult).length;
  if (deletedCount > 0) {
    console.log(`[Bootstrap] Removed ${deletedCount} legacy generic KB doc(s).`);
  }

  // 2. Ensure the active system prompt has the anti-hallucination grounding rules.
  //    If it's missing the sentinel (e.g. an old deploy still has the original prompt),
  //    overwrite it. The check is a substring test so it's safe to run every startup.
  const [activePrompt] = await db
    .select({ id: chatSystemPromptsTable.id, content: chatSystemPromptsTable.content })
    .from(chatSystemPromptsTable)
    .where(eq(chatSystemPromptsTable.isActive, true))
    .limit(1);

  if (
    activePrompt &&
    (!activePrompt.content.includes(ANTI_HALLUCINATION_SENTINEL) ||
      !activePrompt.content.includes(DIRECT_ANSWER_SENTINEL) ||
      !activePrompt.content.includes(BLITZ_NAMING_SENTINEL))
  ) {
    await db
      .update(chatSystemPromptsTable)
      .set({ content: ANTI_HALLUCINATION_SYSTEM_PROMPT })
      .where(eq(chatSystemPromptsTable.id, activePrompt.id));
    console.log("[Bootstrap] Updated active system prompt with grounding + direct-answer + Blitz-naming rules.");
  }

  // 3. Re-scrub every existing knowledgebase_docs row through the privacy filter
  //    and verify the titles are clean — AWAITED so it completes BEFORE the HTTP
  //    server accepts traffic (ensureKBGrounding is awaited by
  //    bootstrapCriticalPrerequisites, which index.ts awaits before app.listen).
  //    This closes the rollout window where a freshly-deployed instance could
  //    otherwise serve a stale title/content still carrying a coach surname.
  //
  //    Why the re-scrub runs here at all (not just in post-merge.sh): post-merge
  //    only ever touches the DEV database. PRODUCTION is a separate database the
  //    agent cannot write directly, so the only way the title/content re-scrub
  //    reaches prod is for a freshly-deployed instance to apply it against the
  //    DATABASE_URL it boots with. The re-scrub is idempotent (only rows that
  //    actually change are written) and de-duplicates colliding scrubbed titles
  //    with a numeric suffix, so it never violates the UNIQUE constraint and is
  //    a fast no-op once everything is clean.
  const rescrub = await rescrubKnowledgebaseDocs((m) => console.log(m));

  // One-time cleanliness verification: after the re-scrub no title may still
  // carry an unscrubbed private token. Logged as deploy evidence; a non-empty
  // result means the privacy filter missed a variant and must be widened.
  const titleLeaks = await findUnscrubbedTitles();
  if (titleLeaks.length > 0) {
    console.error(
      `[Bootstrap] CRITICAL: ${titleLeaks.length} knowledgebase_docs title(s) ` +
        `still carry an unscrubbed coach surname after re-scrub: ` +
        titleLeaks.map((l) => `#${l.id} "${l.title}"`).join("; ") +
        `. Widen the rule in lib/content-privacy-filter.ts to cover the variant.`,
    );
  } else {
    console.log(
      `[Bootstrap] knowledgebase_docs titles verified clean ` +
        `(${rescrub.titleUpdated} retitled, ${rescrub.contentUpdated} content ` +
        `cleaned this run across ${rescrub.scanned} rows).`,
    );
  }

  // 4. Ingest BTS knowledge base files (idempotent via ON CONFLICT DO NOTHING).
  //    Runs in the background after startup so it doesn't block the HTTP server.
  //    Seed content is already scrubbed at ingest time (seed-kb runs
  //    scrubPrivateContent before INSERT), so new rows are clean without waiting
  //    on the re-scrub above — which targets pre-existing stale rows.
  seedKnowledgebaseFromFiles().catch((err) => {
    console.error("[Bootstrap] KB file ingestion failed:", err);
  });

  // 5. Seed internal, admin-only SOP docs (idempotent, audience='admin').
  //    These are excluded from every member-facing KB retrieval path and
  //    surface only in the admin Knowledge Base page. Inserts the row
  //    directly to the DB (editing a knowledge-base/*.txt file would not).
  seedInternalSops().catch((err) => {
    console.error("[Bootstrap] Internal SOP seeding failed:", err);
  });

  // 6. Seed member-facing broad content index (Blitz lessons, Resource Library,
  //    individual glossary terms) with source_path deep-links. Idempotent via
  //    ON CONFLICT (title) DO UPDATE — re-runs safely refresh content + paths.
  seedMemberBroadContent().catch((err) => {
    console.error("[Bootstrap] Member broad content seeding failed:", err);
  });
}

async function runKnowledgebaseAudienceColumnMigration(): Promise<void> {
  await db.execute(
    sql`ALTER TABLE knowledgebase_docs
        ADD COLUMN IF NOT EXISTS audience text NOT NULL DEFAULT 'member'`,
  );
}

async function runKnowledgebaseSourceColumnsMigration(): Promise<void> {
  await db.execute(
    sql`ALTER TABLE knowledgebase_docs
        ADD COLUMN IF NOT EXISTS source_path text`,
  );
  await db.execute(
    sql`ALTER TABLE knowledgebase_docs
        ADD COLUMN IF NOT EXISTS source_label text`,
  );
}

async function runTicketDeliveryColumnMigration(): Promise<void> {
  await db.execute(
    sql`ALTER TABLE tickets
        ADD COLUMN IF NOT EXISTS delivery_status text NOT NULL DEFAULT 'pending'`,
  );
  await db.execute(
    sql`ALTER TABLE tickets
        ADD COLUMN IF NOT EXISTS delivery_last_attempt_at timestamp with time zone`,
  );
  await db.execute(
    sql`ALTER TABLE tickets
        ADD COLUMN IF NOT EXISTS delivery_last_error text`,
  );
}

const OLD_COMPANY_ADDRESS = "3000 Custer Road, Suite 270 #1505, Plano, TX 75075";
const NEW_COMPANY_ADDRESS = "5900 Balcones Drive STE 100, Austin, TX 78731";

async function ensureCompanyAddressUpdated(): Promise<void> {
  const kbResult = await db.execute(
    sql`UPDATE knowledgebase_docs
        SET content = REPLACE(content, ${OLD_COMPANY_ADDRESS}, ${NEW_COMPANY_ADDRESS}),
            updated_at = NOW()
        WHERE content LIKE ${"%" + OLD_COMPANY_ADDRESS + "%"}
        RETURNING id`,
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const kbUpdated = ((kbResult as any).rows ?? kbResult).length;
  if (kbUpdated > 0) {
    console.log(`[Bootstrap] Updated company address in ${kbUpdated} knowledgebase_docs row(s).`);
  }

  const legalResult = await db.execute(
    sql`UPDATE legal_documents
        SET content = REPLACE(content, ${OLD_COMPANY_ADDRESS}, ${NEW_COMPANY_ADDRESS})
        WHERE content LIKE ${"%" + OLD_COMPANY_ADDRESS + "%"}
        RETURNING id`,
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const legalUpdated = ((legalResult as any).rows ?? legalResult).length;
  if (legalUpdated > 0) {
    console.log(`[Bootstrap] Updated company address in ${legalUpdated} legal_documents row(s).`);
  }

  const tosContactOld = "For questions, contact us at support@buildtestscale.com.";
  const tosContactNew =
    "For questions, contact us at support@buildtestscale.com or by mail at Build Test Scale, LLC, 5900 Balcones Drive STE 100, Austin, TX 78731.";
  const tosResult = await db.execute(
    sql`UPDATE legal_documents
        SET content = REPLACE(content, ${tosContactOld}, ${tosContactNew})
        WHERE type = 'terms_of_service'
          AND content LIKE ${"%" + tosContactOld + "%"}
          AND content NOT LIKE ${"%" + NEW_COMPANY_ADDRESS + "%"}
        RETURNING id`,
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tosUpdated = ((tosResult as any).rows ?? tosResult).length;
  if (tosUpdated > 0) {
    console.log(`[Bootstrap] Added mailing address to Terms of Service contact section.`);
  }
}

/**
 * Replace every numeric "14-Day Blitz" variant with the spelled-out
 * "Fourteen-Day Blitz" in knowledgebase_docs (live, read by the assistant)
 * and kb_staging_docs (staging / pending-review). Idempotent: rows that
 * already carry the correct form are untouched.
 *
 * Why at boot: source-file edits and the seeder's ON CONFLICT DO NOTHING
 * never update already-ingested rows. Prod is a separate database the agent
 * cannot reach except via a deploy, so this hook is the only reliable path
 * to propagate the fix there.
 */
async function ensureFourteenDayBlitzPronunciation(): Promise<void> {
  const replaceExpr = (col: string) =>
    `REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(${col},
      '14-Day Blitz','Fourteen-Day Blitz'),
      '14-day Blitz','Fourteen-Day Blitz'),
      '14 Day Blitz','Fourteen-Day Blitz'),
      '14-day blitz','Fourteen-Day Blitz'),
      '14 day blitz','Fourteen-Day Blitz')`;

  const likeFilter =
    `(content ILIKE '%14-Day Blitz%' OR content ILIKE '%14 Day Blitz%'` +
    ` OR content ILIKE '%14-day blitz%'` +
    ` OR title   ILIKE '%14-Day Blitz%' OR title   ILIKE '%14 Day Blitz%'` +
    ` OR title   ILIKE '%14-day blitz%')`;

  const kbResult = await db.execute(
    sql.raw(
      `UPDATE knowledgebase_docs
       SET content = ${replaceExpr("content")},
           title   = ${replaceExpr("title")}
       WHERE ${likeFilter}
       RETURNING id`,
    ),
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const kbUpdated = ((kbResult as any).rows ?? kbResult).length;
  if (kbUpdated > 0) {
    console.log(
      `[Bootstrap] Replaced "14-Day Blitz" with "Fourteen-Day Blitz" in ${kbUpdated} knowledgebase_docs row(s).`,
    );
  }

  const stagingResult = await db.execute(
    sql.raw(
      `UPDATE kb_staging_docs
       SET content = ${replaceExpr("content")},
           title   = ${replaceExpr("title")}
       WHERE ${likeFilter}
       RETURNING id`,
    ),
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const stagingUpdated = ((stagingResult as any).rows ?? stagingResult).length;
  if (stagingUpdated > 0) {
    console.log(
      `[Bootstrap] Replaced "14-Day Blitz" with "Fourteen-Day Blitz" in ${stagingUpdated} kb_staging_docs row(s).`,
    );
  }
}
