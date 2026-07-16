import { db, productsTable, chatSystemPromptsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { runTapfiliateColumnMigration } from "./tapfiliate-migration";
import { seedYseProducts } from "./seed-yse-products";
import { seedMachineBrandProducts } from "./seed-machine-brand-products";
import { seedVipProduct } from "./seed-vip-product";
import { seedVipArbitrageProduct } from "./seed-vip-arbitrage-product";
import { seedMachineMembershipProduct } from "./seed-machine-membership-product";
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
import { runNavigationDriftScan } from "./kb-nav-drift-scan";
import { seedProcessKb } from "./seed-process-kb";
import { seedConceptsKb } from "./seed-concepts-kb";
import {
  rescrubKnowledgebaseDocs,
  findUnscrubbedTitles,
} from "./rescrub-knowledgebase-docs";
import { rebrandOldBrandSourceContent } from "./rebrand-old-brand-source-content";
import {
  ANTI_HALLUCINATION_SYSTEM_PROMPT,
  ANTI_HALLUCINATION_SENTINEL,
  DIRECT_ANSWER_SENTINEL,
  BLITZ_NAMING_SENTINEL,
  DEEP_ASSISTANT_SENTINEL,
  NAMES_FROM_DOCS_SENTINEL,
  CLARIFY_FIRST_SENTINEL,
  DEPTH_CEILING_SENTINEL,
  NAVIGATION_SOURCE_SENTINEL,
  NO_ANSWER_FALLBACK_SENTINEL,
  NO_KB_SCAFFOLDING_SENTINEL,
  PORTAL_LINK_SENTINEL,
  BLITZ_STEPS_SENTINEL,
  DEPTH_MATCH_SENTINEL,
  SYNTHESIS_CONSISTENCY_SENTINEL,
  LEGACY_GENERIC_KB_TITLES,
} from "./chat-system-prompt";
import { ensureFoundingSuperAdmins } from "./ensure-founding-superadmins";
import { backfillMissingLiveDocEmbeddings } from "./kb-embeddings";
import { seedToolTags } from "./kb-tool-tags";
import { refreshHouseTermAliasCache } from "./bts-house-terms";
import { backfillUndeliveredTickets } from "./ticketdesk-queue";
import { migrateOneOffCoachingCallsToTemplates } from "./coaching-call-migrate-oneoffs";
import {
  migrateOnboardingStepsToSevenStepContract,
  migrateOnboardingStepsToSixStepContract,
  migrateOnboardingStepsToSendOffContract,
} from "./onboarding-advancement";
import { seedSendoffVideoSettings, seedDevSendoffDummyVideo } from "./sendoff-video-settings";
import { seedCallBookingRoster } from "./seed-call-booking-roster";
import { seedPartnerPhotos } from "./seed-partner-photos";
import { runGrandfatherBackfillBootHook } from "./grandfather-backfill";

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

  // 0a-1b. pgvector extension + ai_live_documents embedding columns (Task
  //        #1803, IF NOT EXISTS — idempotent). CREATE EXTENSION cannot ride
  //        drizzle push, so this boot hook is how BOTH dev and prod acquire the
  //        semantic-retrieval columns. Purely additive; on failure the columns
  //        stay absent and retrieval remains lexical-only (the hybrid path
  //        degrades gracefully).
  try {
    await runAiLiveDocumentEmbeddingColumnMigration();
  } catch (err) {
    console.error("[Bootstrap] runAiLiveDocumentEmbeddingColumnMigration() threw:", err);
    missing.push("aiLiveDocumentEmbeddingColumnMigration");
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

  // 0a-4. Bring ai_live_documents to parity with knowledgebase_docs and repoint
  //       the kb_doc_provenance FK onto it (Task #1531). Every assistant
  //       retrieval path (chat, voice, RAG retriever) and the staging push now
  //       read/write ai_live_documents; this idempotent DDL adds the parity
  //       columns, the STORED generated search_vector + GIN index, the title
  //       unique index, and swaps the provenance FK BEFORE any of those paths
  //       run, avoiding "column does not exist" on environments where the schema
  //       push hasn't run yet.
  try {
    await runAiLiveDocumentsParityMigration();
  } catch (err) {
    console.error("[Bootstrap] runAiLiveDocumentsParityMigration() threw:", err);
    missing.push("aiLiveDocumentsParityMigration");
  }

  // 0a-5. Admin-manageable TOOL-tag vocabulary (Task #1586). Retrieval + triage
  //       read a MERGED effective vocab (DB tool tags + code concept +
  //       troubleshooting). Create the tables before seeding so a fresh dev DB
  //       (no companion .sql yet) still works, then seed the baseline tool tags
  //       and warm the in-memory cache.
  try {
    await runKbToolTagsMigration();
    await seedToolTags();
  } catch (err) {
    console.error("[Bootstrap] kb tool-tags migration/seed threw:", err);
    missing.push("kbToolTagsSeed");
  }

  // 0a-6. Admin-manageable BTS house-term auto-correct overrides (Task #1676).
  //       The Transcript Cleaner reads a MERGED effective alias map (code
  //       baseline + enabled DB overrides). Create the table before the refresh
  //       so a fresh dev DB (no companion .sql yet) still works, then warm the
  //       in-memory map and register it with the cleaner.
  try {
    await runBtsHouseTermAliasesMigration();
    await refreshHouseTermAliasCache();
  } catch (err) {
    console.error("[Bootstrap] bts house-term aliases migration/refresh threw:", err);
    missing.push("btsHouseTermAliases");
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

  // 1a-2. VIP status product (Task #1660) — a pure status product, never sold
  //       standalone; admins compose it with a `1year` grant via the member
  //       detail Products tab. Historically dev-only (seed.ts), so production
  //       needs this boot seeder. Idempotent: insert-if-missing on slug.
  try {
    await seedVipProduct();
  } catch (err) {
    console.error("[Bootstrap] seedVipProduct() threw:", err);
    missing.push("seedVipProduct");
  }

  // 1a-3. VIP Arbitrage product (Task #1854) — a Machine-side investment
  //       program whose Portal row exists purely to record purchases so
  //       isVipArbitrageMember (pitch-resolver.ts) can suppress the VIP
  //       Arbitrage email pitch for existing holders. No entitlement keys,
  //       no rank, no expiry. Idempotent: insert-if-missing on slug.
  try {
    await seedVipArbitrageProduct();
  } catch (err) {
    console.error("[Bootstrap] seedVipArbitrageProduct() threw:", err);
    missing.push("seedVipArbitrageProduct");
  }

  // 1a-4. Machine membership product (Task #1901) — records ownership of The
  //       Machine itself so isMachineMember (pitch-resolver.ts) can suppress
  //       the Machine email pitches for existing owners. No entitlement keys,
  //       no rank, no expiry. Idempotent: insert-if-missing on slug.
  try {
    await seedMachineMembershipProduct();
  } catch (err) {
    console.error("[Bootstrap] seedMachineMembershipProduct() threw:", err);
    missing.push("seedMachineMembershipProduct");
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

  // 8b-2. Portal navigation drift scan (Task #1778): if the nav map's content
  //     hash changed since the last boot, flag (advisory-only) every pending
  //     truth draft and published citable doc that references a changed
  //     location so it gets re-verified — drafts via a `navigation_drift`
  //     risk flag, live docs via the existing flaggedStaleAt surface.
  try {
    await runNavigationDriftScan();
  } catch (err) {
    console.error("[Bootstrap] runNavigationDriftScan() threw:", err);
    missing.push("runNavigationDriftScan");
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

  // 10. RETIRED (Task #1826): the boot mirror that copied citable legacy
  //     knowledgebase_docs rows into ai_live_documents is gone. The two systems
  //     are now fully decoupled: ai_live_documents (the assistant's retrieval
  //     corpus) is owned EXCLUSIVELY by the staging review → push-approved
  //     pipeline and the admin Live AI Documents CRUD. The boot seeders
  //     (steps 8-8d) still author the legacy table because the member-facing
  //     Knowledge Base (/kb/search, browse, counts, bookmarks) reads it
  //     directly — but nothing at boot writes ai_live_documents from it, so
  //     admin deletes stick across restarts and new legacy seeds never leak
  //     into the AI corpus.

  // 10b. Backfill missing/stale semantic embeddings (Task #1803). Idempotent
  //      (only touches rows with a NULL or wrong-model embedding) and
  //      fire-and-forget: boot must NEVER block on the embeddings API. When
  //      OPENAI_API_KEY is absent it logs loudly and retrieval stays
  //      lexical-only — by design.
  void backfillMissingLiveDocEmbeddings().catch((err) => {
    console.error("[Bootstrap] backfillMissingLiveDocEmbeddings() threw:", err);
  });

  // 11. One-time, idempotent migration of mid-flight onboarding members from
  //     the old 5-step numbering to the (now superseded) 7-step contract
  //     (Task #1578): old step 4 (orientation) / 5 (quick-start) -> new step 4
  //     (book kickoff). Completed members are never touched. Claimed via a
  //     system_settings marker row so it can only ever fire once, even across
  //     restarts — see migrateOnboardingStepsToSevenStepContract() for why a
  //     plain "already at step 4" check isn't safe here (4/5 are reused with
  //     new meaning in the new contract). Must run at boot so production also
  //     receives the remap (the agent cannot write prod directly). Kept even
  //     though the 7-step contract has since been superseded (see #12) —
  //     members who never got this remap still need it before the #12 remap
  //     runs.
  try {
    await migrateOnboardingStepsToSevenStepContract();
  } catch (err) {
    console.error("[Bootstrap] migrateOnboardingStepsToSevenStepContract() threw:", err);
    missing.push("migrateOnboardingStepsToSevenStepContract");
  }

  // 11b. One-time, idempotent migration of mid-flight onboarding members from
  //      the old 7-step numbering (which included an in-portal ToS signing
  //      step) to the new 6-step contract (ToS signing step removed; platform
  //      ToS is now a browsewrap link only). Old steps 2 (documents) and 3
  //      (profile) both collapse onto new step 2 (profile), and every step
  //      after it shifts down by one. Runs independently of (and after) the
  //      5->7 migration above — see migrateOnboardingStepsToSixStepContract()
  //      for the full old->new step map and why a claim-row (not a value
  //      check) is required.
  try {
    await migrateOnboardingStepsToSixStepContract();
  } catch (err) {
    console.error("[Bootstrap] migrateOnboardingStepsToSixStepContract() threw:", err);
    missing.push("migrateOnboardingStepsToSixStepContract");
  }

  // 11c. One-time, idempotent migration of mid-flight onboarding members from
  //      the old 6-step numbering (pillars_watched=5, partner_call_completed=6
  //      for "full") onto the new send_off contract (Task #1666). Runs after
  //      (and independently of) the 6-step migration above — see
  //      migrateOnboardingStepsToSendOffContract() for the full old->new step
  //      map and why "launchpad" needs no row change at all.
  try {
    await migrateOnboardingStepsToSendOffContract();
  } catch (err) {
    console.error("[Bootstrap] migrateOnboardingStepsToSendOffContract() threw:", err);
    missing.push("migrateOnboardingStepsToSendOffContract");
  }

  // 11d. Idempotent boot seed for the per-variant send-off video settings
  //      (Task #1666) so the two new keys (sendoff_video_full/launchpad) show
  //      up in the generic admin Settings UI without an admin having to know
  //      the raw key names. Never overwrites an existing row.
  try {
    await seedSendoffVideoSettings();
  } catch (err) {
    console.error("[Bootstrap] seedSendoffVideoSettings() threw:", err);
    missing.push("seedSendoffVideoSettings");
  }

  // 11e. Task #1687, intentionally extended to production by Task #1701:
  //      auto-fill both send-off video slots with a temporary DUMMY video (an
  //      internal, brand-neutral, already-hosted portal clip) so the owner
  //      can preview the send_off step's real iframe player before real
  //      send-off videos are uploaded. The owner reviews exclusively on the
  //      published portal, so this now intentionally runs in every
  //      environment, including production. It can never silently ship as
  //      final (the stored description keeps the DUMMY marker prefix) and
  //      can never clobber a real value once the owner sets one (the seed
  //      only ever fills a currently-blank slot).
  try {
    await seedDevSendoffDummyVideo();
  } catch (err) {
    console.error("[Bootstrap] seedDevSendoffDummyVideo() threw:", err);
    missing.push("seedDevSendoffDummyVideo");
  }

  // 12. Seed the verified accountability-partner and kickoff-coach GHL
  //     calendar roster (Task #1611). Idempotent (update-if-exists/insert-if-
  //     missing keyed on displayName); reaches prod only on boot since the
  //     agent cannot write prod directly.
  try {
    await seedCallBookingRoster();
  } catch (err) {
    console.error("[Bootstrap] seedCallBookingRoster() threw:", err);
    missing.push("seedCallBookingRoster");
  }

  // 13. Arm partner + kickoff-coach headshots (Task #1612). Must run AFTER
  //     seedCallBookingRoster so a fresh boot (e.g. first prod deploy with
  //     both seeds) sees the roster rows and sets their photos in the same
  //     boot instead of one boot later. Idempotent; only fills NULL
  //     photo_url, never inserts or clobbers.
  try {
    await seedPartnerPhotos();
  } catch (err) {
    console.error("[Bootstrap] seedPartnerPhotos() threw:", err);
    missing.push("seedPartnerPhotos");
  }

  // 14. Grandfather backfill for pre-existing members (Task #1643, TB2).
  //     Report-and-confirm gate: every boot logs the LIVE pre-flight bucket
  //     counts until the one-time marker exists, but never writes anything
  //     unless an admin has explicitly armed it via
  //     `PUT /admin/settings/grandfather_backfill_armed`. This is the only
  //     way the repair reaches production (the agent cannot write prod
  //     directly) while still honoring report -> confirm -> execute — see
  //     docs/grandfather-backfill-runbook.md for the full prod sequence.
  //     Non-fatal: never blocks traffic.
  try {
    await runGrandfatherBackfillBootHook();
  } catch (err) {
    console.error("[Bootstrap] runGrandfatherBackfillBootHook() threw:", err);
    missing.push("grandfatherBackfill");
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
      !activePrompt.content.includes(BLITZ_NAMING_SENTINEL) ||
      !activePrompt.content.includes(DEEP_ASSISTANT_SENTINEL) ||
      !activePrompt.content.includes(NAMES_FROM_DOCS_SENTINEL) ||
      !activePrompt.content.includes(CLARIFY_FIRST_SENTINEL) ||
      !activePrompt.content.includes(DEPTH_CEILING_SENTINEL) ||
      !activePrompt.content.includes(NAVIGATION_SOURCE_SENTINEL) ||
      !activePrompt.content.includes(NO_ANSWER_FALLBACK_SENTINEL) ||
      !activePrompt.content.includes(NO_KB_SCAFFOLDING_SENTINEL) ||
      !activePrompt.content.includes(PORTAL_LINK_SENTINEL) ||
      !activePrompt.content.includes(BLITZ_STEPS_SENTINEL) ||
      !activePrompt.content.includes(DEPTH_MATCH_SENTINEL) ||
      !activePrompt.content.includes(SYNTHESIS_CONSISTENCY_SENTINEL))
  ) {
    await db
      .update(chatSystemPromptsTable)
      .set({ content: ANTI_HALLUCINATION_SYSTEM_PROMPT })
      .where(eq(chatSystemPromptsTable.id, activePrompt.id));
    console.log(
      "[Bootstrap] Updated active system prompt with grounding + direct-answer + Blitz-naming + deep-assistant-persona + names-from-docs + clarify-first + depth-ceiling + navigation/legacy + no-answer-fallback + portal-link + blitz-steps + depth-match + synthesis-consistency rules.",
    );
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

  // 3b. Rebrand stored OLD-BRAND references (Cherrington / TCE / … -> BTS / Adam)
  //     in the two raw AI-source tables that have no re-scrub pass of their own:
  //     transcript_cleaner_documents (holding store) and ai_source_documents
  //     (filed source library). The #1604 cleaner rules only rebrand NEW cleans /
  //     refine + retrieval; this backfill fixes content already cleaned / filed
  //     before those rules landed. Old-brand ONLY — coach / VA attribution in raw
  //     source is deliberately preserved (NOT the full privacy filter). Runs here
  //     (not just in post-merge, which only touches the dev DB) so a fresh
  //     production deploy applies it against its own DATABASE_URL — the only way
  //     the rewrite reaches prod. Idempotent: only rows that actually change are
  //     written, so it is a fast no-op once everything is on-brand.
  const rebrand = await rebrandOldBrandSourceContent((m) => console.log(m));
  console.log(
    `[Bootstrap] old-brand source rebrand: ` +
      `${rebrand.transcriptCleaner.updated}/${rebrand.transcriptCleaner.scanned} ` +
      `transcript_cleaner + ${rebrand.aiSource.updated}/${rebrand.aiSource.scanned} ` +
      `ai_source row(s) updated.`,
  );

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

async function runKbToolTagsMigration(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS kb_tool_tags (
      id serial PRIMARY KEY,
      slug text NOT NULL UNIQUE,
      label text NOT NULL,
      triggers jsonb NOT NULL DEFAULT '[]'::jsonb,
      enabled boolean NOT NULL DEFAULT true,
      protected boolean NOT NULL DEFAULT false,
      source text NOT NULL DEFAULT 'seed',
      created_by integer REFERENCES users(id) ON DELETE SET NULL,
      created_at timestamp with time zone NOT NULL DEFAULT now(),
      updated_at timestamp with time zone NOT NULL DEFAULT now()
    )`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS kb_tool_tags_enabled_idx ON kb_tool_tags (enabled)`);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS kb_proposed_tool_tags (
      id serial PRIMARY KEY,
      slug text NOT NULL UNIQUE,
      label text NOT NULL,
      suggested_triggers jsonb NOT NULL DEFAULT '[]'::jsonb,
      status text NOT NULL DEFAULT 'pending',
      occurrence_count integer NOT NULL DEFAULT 1,
      example_context text,
      reviewed_by integer REFERENCES users(id) ON DELETE SET NULL,
      reviewed_at timestamp with time zone,
      first_seen_at timestamp with time zone NOT NULL DEFAULT now(),
      last_seen_at timestamp with time zone NOT NULL DEFAULT now()
    )`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS kb_proposed_tool_tags_status_idx ON kb_proposed_tool_tags (status)`);
}

async function runBtsHouseTermAliasesMigration(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS bts_house_term_aliases (
      id serial PRIMARY KEY,
      misspelling text NOT NULL UNIQUE,
      canonical text NOT NULL,
      enabled boolean NOT NULL DEFAULT true,
      source text NOT NULL DEFAULT 'admin',
      note text,
      created_by integer REFERENCES users(id) ON DELETE SET NULL,
      created_at timestamp with time zone NOT NULL DEFAULT now(),
      updated_at timestamp with time zone NOT NULL DEFAULT now()
    )`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS bts_house_term_aliases_enabled_idx ON bts_house_term_aliases (enabled)`);
}

async function runAiLiveDocumentsParityMigration(): Promise<void> {
  // Parity columns (mirror knowledgebase_docs).
  await db.execute(sql`ALTER TABLE ai_live_documents ADD COLUMN IF NOT EXISTS audience text NOT NULL DEFAULT 'member'`);
  await db.execute(sql`ALTER TABLE ai_live_documents ADD COLUMN IF NOT EXISTS source_path text`);
  await db.execute(sql`ALTER TABLE ai_live_documents ADD COLUMN IF NOT EXISTS source_label text`);
  await db.execute(sql`ALTER TABLE ai_live_documents ADD COLUMN IF NOT EXISTS doc_class text`);
  await db.execute(sql`ALTER TABLE ai_live_documents ADD COLUMN IF NOT EXISTS home_root text`);
  await db.execute(sql`ALTER TABLE ai_live_documents ADD COLUMN IF NOT EXISTS node text`);
  await db.execute(sql`ALTER TABLE ai_live_documents ADD COLUMN IF NOT EXISTS tags jsonb NOT NULL DEFAULT '[]'::jsonb`);
  await db.execute(sql`ALTER TABLE ai_live_documents ADD COLUMN IF NOT EXISTS blitz_section integer`);
  await db.execute(sql`ALTER TABLE ai_live_documents ADD COLUMN IF NOT EXISTS ceiling text`);
  await db.execute(sql`ALTER TABLE ai_live_documents ADD COLUMN IF NOT EXISTS handoff text`);
  await db.execute(sql`ALTER TABLE ai_live_documents ADD COLUMN IF NOT EXISTS last_verified timestamp with time zone`);
  // STORED generated full-text vector — the exact expression every retrieval
  // query uses inline, so it is byte-for-byte equivalent to the previous form.
  await db.execute(
    sql`ALTER TABLE ai_live_documents ADD COLUMN IF NOT EXISTS search_vector tsvector GENERATED ALWAYS AS (to_tsvector('english', title || ' ' || content)) STORED`,
  );
  // Title unique so the staging push + citable sync can upsert on title.
  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS ai_live_documents_title_uniq ON ai_live_documents (title)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS ai_live_documents_doc_class_idx ON ai_live_documents (doc_class)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS ai_live_documents_home_root_idx ON ai_live_documents (home_root)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS ai_live_documents_search_idx ON ai_live_documents USING gin (search_vector)`);
  // Repoint the provenance FK onto ai_live_documents. Drop the legacy FK first.
  await db.execute(sql`ALTER TABLE kb_doc_provenance DROP CONSTRAINT IF EXISTS kb_doc_provenance_doc_id_knowledgebase_docs_id_fk`);
  // Data-safe repoint: pre-existing provenance rows reference knowledgebase_docs
  // ids. Remap to the mirrored ai_live twin by title (the mirror upserts on
  // title), then drop any that still cannot resolve, so ADD CONSTRAINT never
  // fails validation on prod data. Pre-cutover this table is empty (the staging
  // publish that writes provenance is new here), so this is a no-op today and a
  // safety net for replays / any future prod state.
  await db.execute(sql`
    UPDATE kb_doc_provenance p
    SET doc_id = al.id
    FROM knowledgebase_docs k
    JOIN ai_live_documents al ON al.title = k.title
    WHERE p.doc_id = k.id
      AND NOT EXISTS (SELECT 1 FROM ai_live_documents a2 WHERE a2.id = p.doc_id)`);
  await db.execute(sql`
    DELETE FROM kb_doc_provenance p
    WHERE NOT EXISTS (SELECT 1 FROM ai_live_documents a WHERE a.id = p.doc_id)`);
  await db.execute(sql`DO $$ BEGIN
    ALTER TABLE kb_doc_provenance
      ADD CONSTRAINT kb_doc_provenance_doc_id_ai_live_documents_id_fk
      FOREIGN KEY (doc_id) REFERENCES ai_live_documents(id)
      ON DELETE cascade ON UPDATE no action;
  EXCEPTION WHEN duplicate_object THEN NULL; END $$`);
}

/**
 * pgvector extension + semantic-embedding columns on ai_live_documents
 * (Task #1803). Boot-hook DDL is the sanctioned path here because
 * `CREATE EXTENSION` cannot ride drizzle push, and the columns must exist
 * before any hybrid-retrieval query references them. Purely additive +
 * idempotent.
 */
async function runAiLiveDocumentEmbeddingColumnMigration(): Promise<void> {
  await db.execute(sql`CREATE EXTENSION IF NOT EXISTS vector`);
  await db.execute(
    sql`ALTER TABLE ai_live_documents
        ADD COLUMN IF NOT EXISTS embedding vector(1536),
        ADD COLUMN IF NOT EXISTS embedding_model text,
        ADD COLUMN IF NOT EXISTS embedding_generated_at timestamp with time zone`,
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
