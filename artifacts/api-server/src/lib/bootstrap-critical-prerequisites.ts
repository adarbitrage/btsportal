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
import { runNavigationDriftScan } from "./kb-nav-drift-scan";
import { seedHeadlineConceptsStaging } from "./seed-headline-concepts-staging";
import { seedImageFoundationsStaging } from "./seed-image-foundations-staging";
import { rebrandOldBrandSourceContent } from "./rebrand-old-brand-source-content";
import {
  ANTI_HALLUCINATION_SYSTEM_PROMPT,
  ANTI_HALLUCINATION_SENTINEL,
  DIRECT_ANSWER_SENTINEL,
  DEEP_ASSISTANT_SENTINEL,
  NAMING_NAVIGATION_SENTINEL,
  NAMES_FROM_DOCS_SENTINEL,
  ESCALATION_LADDER_SENTINEL,
  NO_KB_SCAFFOLDING_SENTINEL,
  PORTAL_LINK_SENTINEL,
  BLITZ_STEPS_SENTINEL,
  CLARIFIER_SENTINEL,
  ANSWER_DEPTH_SENTINEL,
  SYNTHESIS_CONSISTENCY_SENTINEL,
  FORMATTING_STYLE_SENTINEL,
  PLACEMENT_PROTOCOL_SENTINEL,
  STEP_NAMES_SENTINEL,
  CAMPAIGN_SPINE_SENTINEL,
  CREATIVE_BOUNDARY_SENTINEL,
  CHECKPOINT_PROGRESS_SENTINEL,
  NEAR_MISS_CLOSE_MATCH_SENTINEL,
  CHECKLIST_NOT_BLITZ_SENTINEL,
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

  // 0a-4b. KB ownership gate (data-driven): owner_page_key column on staging +
  //        live docs, plus an idempotent stamp of the Blitz corpora ('blitz'
  //        page key). Retrieval fails closed for gated docs, so the stamp only
  //        ever ADDS gating — never opens content up.
  try {
    await runKbOwnershipStampMigration();
  } catch (err) {
    console.error("[Bootstrap] runKbOwnershipStampMigration() threw:", err);
    missing.push("kbOwnershipStampMigration");
  }

  // 0a-4c. Post-publish reconciliation repairs (Aug 2026): purge the dead
  //        direct-edge access-map/course-progress residue, and run the ONE-TIME
  //        sourceProduct backfill (marker-gated so later deliberate
  //        source_product edits are never clobbered by a reboot).
  try {
    await runDirectEdgeResidueCleanup();
  } catch (err) {
    console.error("[Bootstrap] runDirectEdgeResidueCleanup() threw:", err);
    missing.push("directEdgeResidueCleanup");
  }
  try {
    await runSourceProductBackfillOnce();
  } catch (err) {
    console.error("[Bootstrap] runSourceProductBackfillOnce() threw:", err);
    missing.push("sourceProductBackfillOnce");
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
  //    variant with the spelled-out "Fourteen-Day Blitz" in kb_staging_docs. This ensures the text-to-speech engine says
  //    "fourteen-day" rather than "one-four-day". Idempotent: rows that already
  //    carry the spelled-out form (or don't contain the phrase at all) are
  //    untouched. Must run at boot so production also receives the fix.
  try {
    await ensureFourteenDayBlitzPronunciation();
  } catch (err) {
    console.error("[Bootstrap] ensureFourteenDayBlitzPronunciation() threw:", err);
    missing.push("ensureFourteenDayBlitzPronunciation");
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

  // 8e. Seed the headline-concept doc set (Task #1994) as DRAFTS into the
  //     kb_staging_docs AI Document Review queue: 7 new concept docs + 1
  //     revision proposal for the live "Headlines & Copy" doc. Human gate
  //     absolute — everything lands pending_review; nothing goes live here.
  //     Idempotent via (source, sourceVideoTitle); insert-only, so reviewer
  //     edits/decisions are never clobbered.
  try {
    await seedHeadlineConceptsStaging();
  } catch (err) {
    console.error("[Bootstrap] seedHeadlineConceptsStaging() threw:", err);
    missing.push("seedHeadlineConceptsStaging");
  }

  // 8f. Seed the Image Foundations doc set (Task #2010) as DRAFTS into the
  //     kb_staging_docs AI Document Review queue: 7 new image-selection
  //     concept docs + 1 revision proposal for the live "Creative Strategy"
  //     doc. Human gate absolute — everything lands pending_review; nothing
  //     goes live here. Idempotent via (source, sourceVideoTitle);
  //     insert-only, so reviewer edits/decisions are never clobbered.
  try {
    await seedImageFoundationsStaging();
  } catch (err) {
    console.error("[Bootstrap] seedImageFoundationsStaging() threw:", err);
    missing.push("seedImageFoundationsStaging");
  }

  // 10. The legacy knowledgebase stack (knowledgebase_docs / knowledgebase_bookmarks)
  //     has been fully retired (Task #2029): no boot step reads or writes it, and
  //     the tables themselves are dropped. ai_live_documents (the assistant's
  //     retrieval corpus) is owned exclusively by the staging review ->
  //     push-approved pipeline and the admin Live AI Documents CRUD.

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
  // Ensure the active system prompt has the anti-hallucination grounding rules.
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
      !activePrompt.content.includes(DEEP_ASSISTANT_SENTINEL) ||
      !activePrompt.content.includes(NAMING_NAVIGATION_SENTINEL) ||
      !activePrompt.content.includes(NAMES_FROM_DOCS_SENTINEL) ||
      !activePrompt.content.includes(ESCALATION_LADDER_SENTINEL) ||
      !activePrompt.content.includes(NO_KB_SCAFFOLDING_SENTINEL) ||
      !activePrompt.content.includes(PORTAL_LINK_SENTINEL) ||
      !activePrompt.content.includes(BLITZ_STEPS_SENTINEL) ||
      !activePrompt.content.includes(CLARIFIER_SENTINEL) ||
      !activePrompt.content.includes(ANSWER_DEPTH_SENTINEL) ||
      !activePrompt.content.includes(SYNTHESIS_CONSISTENCY_SENTINEL) ||
      !activePrompt.content.includes(FORMATTING_STYLE_SENTINEL) ||
      !activePrompt.content.includes(PLACEMENT_PROTOCOL_SENTINEL) ||
      !activePrompt.content.includes(STEP_NAMES_SENTINEL) ||
      !activePrompt.content.includes(CAMPAIGN_SPINE_SENTINEL) ||
      !activePrompt.content.includes(CREATIVE_BOUNDARY_SENTINEL) ||
      !activePrompt.content.includes(CHECKPOINT_PROGRESS_SENTINEL) ||
     !activePrompt.content.includes(NEAR_MISS_CLOSE_MATCH_SENTINEL) ||
     !activePrompt.content.includes(CHECKLIST_NOT_BLITZ_SENTINEL))
  ) {
    await db
      .update(chatSystemPromptsTable)
      .set({ content: ANTI_HALLUCINATION_SYSTEM_PROMPT })
      .where(eq(chatSystemPromptsTable.id, activePrompt.id));
    console.log(
      "[Bootstrap] Updated active system prompt with grounding + direct-answer + deep-assistant-persona + naming/navigation + names-from-docs + escalation-ladder + no-scaffolding + portal-link + blitz-steps + clarifier + answer-depth + synthesis-consistency + formatting + placement-protocol + step-names + campaign-spine + creative-boundary + checkpoint-progress rules.",
    );
  }

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
  await db.execute(sql`ALTER TABLE ai_live_documents ADD COLUMN IF NOT EXISTS audience text NOT NULL DEFAULT 'member'`);
  await db.execute(sql`ALTER TABLE ai_live_documents ADD COLUMN IF NOT EXISTS source_path text`);
  await db.execute(sql`ALTER TABLE ai_live_documents ADD COLUMN IF NOT EXISTS source_label text`);
  await db.execute(sql`ALTER TABLE ai_live_documents ADD COLUMN IF NOT EXISTS doc_class text`);
  await db.execute(sql`ALTER TABLE ai_live_documents ADD COLUMN IF NOT EXISTS home_root text`);
  await db.execute(sql`ALTER TABLE ai_live_documents ADD COLUMN IF NOT EXISTS node text`);
  await db.execute(sql`ALTER TABLE ai_live_documents ADD COLUMN IF NOT EXISTS tags jsonb NOT NULL DEFAULT '[]'::jsonb`);
  await db.execute(sql`ALTER TABLE ai_live_documents ADD COLUMN IF NOT EXISTS blitz_section integer`);
  await db.execute(sql`ALTER TABLE ai_live_documents ADD COLUMN IF NOT EXISTS owner_page_key text`);
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
 * KB ownership gate (owner_page_key) — additive column on kb_staging_docs (the
 * live-docs column rides the parity migration above) plus the idempotent Blitz
 * stamp: every Blitz-derived doc (section-import staging rows; live rows
 * carrying a blitz_section anchor) declares `owner_page_key = 'blitz'` so
 * retrieval can gate it through the SAME content-access check the Blitz APIs
 * use. Re-runs every boot, so a publish that lands without the stamp is
 * repaired on the next boot; publish itself also preserves/copies the key.
 */
async function runKbOwnershipStampMigration(): Promise<void> {
  await db.execute(sql`ALTER TABLE kb_staging_docs ADD COLUMN IF NOT EXISTS owner_page_key text`);
  await db.execute(sql`
    UPDATE kb_staging_docs SET owner_page_key = 'blitz'
    WHERE source = 'blitz_section_import' AND owner_page_key IS NULL`);
  await db.execute(sql`
    UPDATE ai_live_documents SET owner_page_key = 'blitz'
    WHERE blitz_section IS NOT NULL AND owner_page_key IS NULL`);

  // Front-end curriculum gate: the 7-Pillars docs (re-authored as the
  // assistant's source corpus) are gated on the `seven-pillars` page key so
  // non-owners get zero 7-Pillars material from chat, mirroring the Blitz gate.
  //
  // Matched by NORMALIZED title identity (lowercase, all non-alphanumerics
  // stripped), NOT exact strings: the Aug 2026 publish proved exact-title
  // matching is brittle across environments — prod's copy of "The 7 Pillars of
  // a Profitable Digital Business" lacks the ™ character, so the stamp never
  // landed there. Normalization tolerates ™/punctuation/whitespace drift while
  // still requiring full-title equality (no substring over-matching).
  // Idempotent; re-runs every boot to self-heal.
  const normalizedList = sql.join(
    SEVEN_PILLARS_TITLES.map((t) => sql`${normalizeKbDocTitle(t)}`),
    sql`, `,
  );
  await db.execute(sql`
    UPDATE ai_live_documents SET owner_page_key = 'seven-pillars'
    WHERE owner_page_key IS NULL
      AND regexp_replace(lower(title), '[^a-z0-9]+', '', 'g') IN (${normalizedList})`);
  await db.execute(sql`
    UPDATE kb_staging_docs SET owner_page_key = 'seven-pillars'
    WHERE owner_page_key IS NULL
      AND regexp_replace(lower(title), '[^a-z0-9]+', '', 'g') IN (${normalizedList})`);
}

/**
 * Direct Edge was removed entirely (page, route, card). This purges any
 * lingering residue so environments that never ran the manual purge (prod)
 * self-heal on boot. Idempotent — deleting already-absent rows is a no-op.
 */
async function runDirectEdgeResidueCleanup(): Promise<void> {
  const mapRes = await db.execute(
    sql`DELETE FROM content_access_map WHERE page_key = 'direct-edge' RETURNING page_key`,
  );
  const progRes = await db.execute(
    sql`DELETE FROM course_progress WHERE course_id = 'direct-edge' RETURNING id`,
  );
  const mapCount = (mapRes as unknown as { rows: unknown[] }).rows.length;
  const progCount = (progRes as unknown as { rows: unknown[] }).rows.length;
  if (mapCount > 0 || progCount > 0) {
    console.log(
      `[Bootstrap] Direct-edge residue cleanup: removed ${mapCount} access-map row(s), ${progCount} course-progress row(s)`,
    );
  }
}

const SOURCE_PRODUCT_BACKFILL_MARKER = "source_product_backfill_2026_08";

/**
 * ONE-TIME sourceProduct backfill (mirrors scripts/backfill-source-product.ts):
 * every user gets users.source_product from their earliest active front-end
 * grant, else 'bts'. Marker-gated in system_settings so it runs exactly once
 * per environment — a perpetual boot enforcement would silently clobber any
 * later deliberate source_product edit (admin brand flips, test accounts).
 */
async function runSourceProductBackfillOnce(): Promise<void> {
  // Advisory lock: two instances booting concurrently must not both run the
  // backfill (the update is idempotent, but "exactly once" is the contract).
  await db.execute(sql`SELECT pg_advisory_lock(hashtext(${SOURCE_PRODUCT_BACKFILL_MARKER}))`);
  try {
    await runSourceProductBackfillOnceLocked();
  } finally {
    await db.execute(sql`SELECT pg_advisory_unlock(hashtext(${SOURCE_PRODUCT_BACKFILL_MARKER}))`);
  }
}

async function runSourceProductBackfillOnceLocked(): Promise<void> {
  const marker = await db.execute(
    sql`SELECT value FROM system_settings WHERE key = ${SOURCE_PRODUCT_BACKFILL_MARKER}`,
  );
  if ((marker as unknown as { rows: unknown[] }).rows.length > 0) return;

  const pre = await db.execute(
    sql`SELECT COUNT(*)::int AS n FROM users WHERE source_product IS NULL`,
  );
  const preNull = Number((pre as unknown as { rows: { n: number }[] }).rows[0]?.n ?? 0);

  const res = await db.execute(sql`
    WITH entry AS (
      SELECT DISTINCT ON (up.user_id) up.user_id, p.slug
      FROM user_products up
      JOIN products p ON up.product_id = p.id
      WHERE up.status = 'active'
        AND p.type = 'frontend'
        AND (up.expires_at IS NULL OR up.expires_at >= now())
      ORDER BY up.user_id, up.created_at ASC
    )
    UPDATE users u
    SET source_product = COALESCE(entry.slug, 'bts')
    FROM (SELECT id FROM users) all_users
    LEFT JOIN entry ON entry.user_id = all_users.id
    WHERE u.id = all_users.id
      AND u.source_product IS DISTINCT FROM COALESCE(entry.slug, 'bts')
    RETURNING u.id`);
  const updated = (res as unknown as { rows: unknown[] }).rows.length;

  await db.execute(sql`
    INSERT INTO system_settings (key, value)
    VALUES (${SOURCE_PRODUCT_BACKFILL_MARKER}, ${JSON.stringify({ ranAt: new Date().toISOString(), preNullCount: preNull, updated })})
    ON CONFLICT (key) DO NOTHING`);

  console.log(
    `[Bootstrap] sourceProduct backfill (one-time): pre-flight NULL count=${preNull}, rows updated=${updated}; marker '${SOURCE_PRODUCT_BACKFILL_MARKER}' recorded`,
  );
}

/** Canonical seven-pillars doc titles (dev-authored forms; matching is normalized). */
export const SEVEN_PILLARS_TITLES = [
  "The 7 Pillars™ of a Profitable Digital Business (checklist for building a profitable affiliate marketing business the Build Test Scale way)",
  "What Are the BTS 7 Pillars and How They Map to the Blitz",
  "The 7 Pillars™ of a Profitable Digital Business",
  "BTS Blitz Overview: How Build, Test, Scale Maps to the 7 Pillars",
];

/**
 * Title identity used by the seven-pillars ownership stamp: lowercase with
 * every non-alphanumeric run removed. MUST stay in lockstep with the SQL
 * `regexp_replace(lower(title), '[^a-z0-9]+', '', 'g')` in
 * runKbOwnershipStampMigration().
 */
export function normalizeKbDocTitle(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, "");
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
 * "Fourteen-Day Blitz" in kb_staging_docs (staging / pending-review;
 * approved rows are pushed to ai_live_documents). Idempotent: rows that
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
