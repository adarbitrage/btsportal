#!/bin/bash
set -e
pnpm install --frozen-lockfile

# Apply data-repair and column-shape migrations BEFORE `drizzle-kit push`,
# so push has a clean slate to sync the schema non-interactively.
#
# Why each of these is needed:
#
# 1. 0027_vault_resources_tags_array_check.sql
#    Reshapes already-seeded `vault_resources.tags` rows that landed as
#    JSONB string scalars (the bug fixed in #329) back into JSONB arrays
#    AND attaches the matching CHECK constraint. If we skip this, `push`
#    aborts with `vault_resources_tags_is_array is violated by some row`
#    because the constraint addition validates the bad legacy data.
#
# 2. 0038_community_reactions_target_type.sql
#    Adds `target_type` / `target_id` / `type` to `community_reactions`
#    and backfills them from the legacy `post_id` / `comment_id` columns.
#    Without this, `drizzle-kit push` sees a new `target_type` column in
#    the schema and an unrelated legacy column (`reaction_type`) in the
#    DB, and stops on an interactive rename prompt
#    ("Is target_type … created or renamed from another column?") that
#    `--force` does NOT auto-answer — rename detection is separate from
#    data-loss confirmation. Applying the SQL first means `target_type`
#    already exists in the DB, so push has no rename to disambiguate.
#
# Both files are written to be idempotent (guarded ADD COLUMN / ADD
# CONSTRAINT / UPDATE WHERE …), so re-running them against an
# already-migrated database is a safe no-op.
#
# Each block is gated on `to_regclass('public.<table>')` so that on a
# truly empty database (where neither table exists yet) the repair is
# skipped — push-force will create the tables in their final shape, no
# rename prompt or constraint-violation to worry about. The gate only
# fires on drifted databases where the legacy table is already present.
apply_if_table_exists() {
  local table="$1"
  local file="$2"
  local exists
  exists=$(psql "$DATABASE_URL" -tAX -c "SELECT to_regclass('public.${table}') IS NOT NULL;")
  if [ "$exists" = "t" ]; then
    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$file" >/dev/null
  fi
}

if [ -n "$DATABASE_URL" ]; then
  apply_if_table_exists vault_resources \
    lib/db/drizzle/0027_vault_resources_tags_array_check.sql
  apply_if_table_exists community_reactions \
    lib/db/drizzle/0038_community_reactions_target_type.sql

  # 3. chat_system_prompts.name UNIQUE constraint.
  #    The schema declares `name` as `.unique()`. On a drifted DB where
  #    the table already exists with rows but no unique constraint,
  #    drizzle-kit push stops on another non-`--force` prompt:
  #        "You're about to add chat_system_prompts_name_unique unique
  #         constraint to the table, which contains N items. … Do you
  #         want to truncate chat_system_prompts table?"
  #    Adding the constraint up front (idempotently) makes push see it
  #    already exists and skip the prompt. On a fresh DB the table
  #    doesn't exist yet, so the gate skips this and push creates the
  #    column + constraint together in one shot — no prompt either way.
  if [ "$(psql "$DATABASE_URL" -tAX -c "SELECT to_regclass('public.chat_system_prompts') IS NOT NULL;")" = "t" ]; then
    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "
      DO \$\$ BEGIN
        ALTER TABLE chat_system_prompts
          ADD CONSTRAINT chat_system_prompts_name_unique UNIQUE (name);
      EXCEPTION WHEN duplicate_object THEN NULL;
               WHEN duplicate_table  THEN NULL;
      END \$\$;
    " >/dev/null
  fi

  # 4. Drop the legacy entitlement-based 1-on-1 coaching tables.
  #    Their schema definitions were removed, but `drizzle-kit push` only runs
  #    when the live-schema-drift test FAILS, and that test asserts schema ⊆ DB
  #    (it does not flag tables that exist in the DB but not in the schema). So a
  #    pure table REMOVAL leaves the drift test green, push is skipped, and these
  #    tables would otherwise linger in prod forever. Drop them explicitly here.
  #    The file is idempotent (DROP TABLE IF EXISTS … CASCADE), so on a fresh DB
  #    that never had these tables it is a harmless no-op.
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
    -f lib/db/drizzle/0045_drop_legacy_one_on_one_coaching.sql >/dev/null

  # 5. Unify the two coach rosters into a single `coaches` table.
  #    Adds the capability flags + private-coaching config columns, migrates the
  #    session_pack_coaches roster into coaches, repoints the bookings FK, and
  #    DROPs session_pack_coaches. The table REMOVAL (like step 4) leaves the
  #    live-schema-drift test green, so push would skip it — apply explicitly.
  #    Idempotent (ADD COLUMN IF NOT EXISTS / guarded DO blocks / DROP IF EXISTS).
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
    -f lib/db/drizzle/0049_unify_coaches.sql >/dev/null

  # 6. Drop the coach_away_periods table + the vestigial coaches.timezone column.
  #    The "away periods" feature was removed (coaches use their own Google
  #    Calendar) and coaches.timezone had zero functional reads. Both are pure
  #    REMOVALS, so the live-schema-drift gate below (schema ⊆ DB) stays green
  #    and push would never fire to apply them — drop them explicitly here, like
  #    steps 4 and 5. Idempotent (DROP TABLE/COLUMN IF EXISTS), so on a fresh DB
  #    that never had them it is a harmless no-op.
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
    -f lib/db/drizzle/0054_drop_coach_away_periods_and_timezone.sql >/dev/null

  # 7. Add the comms_send_log table (the comms-dedup idempotency ledger).
  #    A pure additive table: applying it explicitly here keeps the
  #    live-schema-drift gate below green so push stays skipped on the common
  #    merge instead of flipping to FAIL and triggering a slow whole-DB
  #    `drizzle-kit push --force` just to create one table.
  #    Idempotent (CREATE TABLE IF NOT EXISTS).
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
    -f lib/db/drizzle/0051_comms_send_log.sql >/dev/null

  # 8. Add the coaching_calls_template_slot_unq UNIQUE constraint.
  #    Like step 3 (chat_system_prompts_name_unique): on a drifted DB that
  #    already holds coaching_calls rows, `drizzle-kit push --force` stops on a
  #    non-`--force` "…add coaching_calls_template_slot_unq … Do you want to
  #    truncate coaching_calls table?" prompt when it tries to add this
  #    constraint, which hangs/aborts the non-TTY post-merge. Adding it up front
  #    (idempotently, self-gated on the table existing) makes push see it already
  #    present and skip the prompt. On a fresh DB the table doesn't exist yet, so
  #    this no-ops and push creates the table + constraint together.
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
    -f lib/db/drizzle/0052_coaching_calls_template_slot_unq.sql >/dev/null

  # 9. Drop the vestigial coaches.call_types column. No scheduling/booking code
  #    ever read it (call cadence lives in coaching_call_templates). A pure
  #    REMOVAL, so the live-schema-drift gate below (schema ⊆ DB) stays green and
  #    push would never fire to apply it — drop it explicitly here, like step 6.
  #    Idempotent (DROP COLUMN IF EXISTS), so on a DB that never had it it no-ops.
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
    -f lib/db/drizzle/0055_drop_coach_call_types.sql >/dev/null

  # 10. Add the ticket_attachments table (compliance-review file uploads).
  #     A pure additive table: applying it explicitly here keeps the
  #     live-schema-drift gate below green so push stays skipped on the common
  #     merge instead of flipping to FAIL and triggering a slow whole-DB
  #     `drizzle-kit push --force` just to create one table (like step 7).
  #     Idempotent (CREATE TABLE IF NOT EXISTS).
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
    -f lib/db/drizzle/0056_ticket_attachments.sql >/dev/null

  # 11. Add the KB taxonomy foundation tables (kb_transcript_sources +
  #     kb_doc_provenance). Two pure additive tables: applying them explicitly
  #     here keeps the live-schema-drift gate below green so push stays skipped
  #     on this merge instead of flipping to FAIL and triggering a slow whole-DB
  #     `drizzle-kit push --force` (which, on this DB, hangs/EOFs on an
  #     interactive prompt under the non-TTY post-merge) just to create two
  #     tables. Apply in dependency order: kb_transcript_sources (0069) before
  #     kb_doc_provenance (0070), which FK-references it. The taxonomy columns
  #     added to knowledgebase_docs (0071) ship in the same #1401 foundation —
  #     additive/nullable (tags NOT NULL but DEFAULT-backfilled), so they apply
  #     here too to keep the gate green. Idempotent (CREATE TABLE/COLUMN/INDEX
  #     IF NOT EXISTS, guarded ADD CONSTRAINT).
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
    -f lib/db/drizzle/0069_kb_transcript_sources.sql >/dev/null
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
    -f lib/db/drizzle/0070_kb_doc_provenance.sql >/dev/null
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
    -f lib/db/drizzle/0071_knowledgebase_docs_taxonomy_columns.sql >/dev/null

  # 12. Add the Task #2 (authoring/review pipeline) taxonomy + screening/risk
  #     columns to kb_staging_docs and the durable last_mined_at marker to
  #     kb_transcript_sources. These shipped as a "dev ALTER only" change with no
  #     companion .sql, so on merge the shared dev DB fell behind the schema and
  #     the live-schema-drift gate below flipped to FAIL — which then fell back to
  #     `drizzle-kit push --force` and hung/aborted on an interactive
  #     "truncate coaching_calls?" prompt under the non-TTY post-merge. Applying
  #     these additive columns explicitly keeps the gate green so push stays
  #     skipped (same pattern as steps 7/10/11). Idempotent (ADD COLUMN/INDEX
  #     IF NOT EXISTS, guarded ADD CONSTRAINT). kb_transcript_sources (0069) must
  #     already exist for the source_id FK — it is created earlier in this block.
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
    -f lib/db/drizzle/0072_kb_staging_taxonomy_screening_columns.sql >/dev/null

  # 13. Create the content_access_map table (new table: one row per gated
  #     portal page, holding the product slugs that unlock it). Written as
  #     CREATE TABLE IF NOT EXISTS so re-running is a no-op. Applying it here
  #     ensures the live-schema-drift test below passes on the first run and
  #     the conditional push stays skipped.
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
    -f lib/db/drizzle/0073_content_access_map.sql >/dev/null

  # 14. NMI Billing Tier 2: 6 additive columns on products + bts_orders +
  #     bts_order_items tables. All operations are idempotent (ADD COLUMN IF
  #     NOT EXISTS, CREATE TABLE/INDEX IF NOT EXISTS, guarded DO blocks for
  #     constraints). Applying here keeps the live-schema-drift gate green so
  #     the conditional push stays skipped on the common merge.
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
    -f lib/db/drizzle/0075_nmi_billing_schema.sql >/dev/null

  # 15. NMI Billing Tier 3a: checkout_idempotency table.
  #     New table that tracks in-flight and completed one-time checkout attempts
  #     so the same idempotency key is never charged twice. Idempotent (CREATE
  #     TABLE IF NOT EXISTS, guarded DO block for the status CHECK constraint).
  #     Applying here keeps the live-schema-drift gate green so the conditional
  #     push stays skipped on the common merge.
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
    -f lib/db/drizzle/0076_checkout_idempotency.sql >/dev/null

  # 16. NMI Billing Tier 6.1: subscriptions table + subscription_id on bts_orders.
  #     New table for recurring subscriptions and a nullable additive FK column
  #     on bts_orders linking orders to their subscription. Idempotent (CREATE
  #     TABLE IF NOT EXISTS, guarded DO blocks for CHECK constraints, CREATE
  #     INDEX IF NOT EXISTS, ALTER TABLE ... ADD COLUMN IF NOT EXISTS).
  #     Applying here keeps the live-schema-drift gate green so the conditional
  #     push stays skipped on the common merge.
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
    -f lib/db/drizzle/0077_subscriptions.sql >/dev/null

  # 17. AI Live Documents scaffold (phase-1 empty corpus table).
  #     The GIN full-text expression index has been removed because drizzle-kit
  #     ^0.31.9 generates a malformed `tsvector_ops` statement that Postgres
  #     rejects (blocked the Publish flow). The migration now drops the index if
  #     it exists (idempotent) and creates only the table + slug unique index.
  #     Idempotent (CREATE TABLE/INDEX IF NOT EXISTS, DROP INDEX IF EXISTS).
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
    -f lib/db/drizzle/0077_ai_live_documents.sql >/dev/null

  # 18. AI Source Knowledge library (the raw-source mining layer).
  #     New, empty, additive table cleanly separated from both the legacy
  #     `knowledgebase_docs` retrieval corpus and the curated `ai_live_documents`
  #     corpus. Applying it explicitly here keeps the live-schema-drift gate
  #     below green so the conditional push stays skipped on the common merge
  #     instead of triggering a slow whole-DB `drizzle-kit push --force` just to
  #     create one table (same pattern as steps 7/10/11/15). Idempotent (CREATE
  #     TABLE/INDEX IF NOT EXISTS).
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
    -f lib/db/drizzle/0082_ai_source_documents.sql >/dev/null

  # 19. Transcript Cleaner holding store (Task #1468).
  #     New, empty, additive table where raw uploaded/imported transcripts sit
  #     while they are AI-cleaned + admin-reviewed, before being filed into
  #     ai_source_documents. Deliberately separate from kb_staging_docs (raw
  #     source, not curated truth). Applying it explicitly here keeps the
  #     live-schema-drift gate below green so the conditional push stays skipped
  #     on the common merge instead of triggering a slow whole-DB
  #     `drizzle-kit push --force` just to create one table (same pattern as
  #     steps 7/10/11/15/18). Idempotent (CREATE TABLE/INDEX IF NOT EXISTS).
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
    -f lib/db/drizzle/0083_transcript_cleaner_documents.sql >/dev/null

  # 20. Transcript Cleaner: in_lesson_order column (Task #1520).
  #     Additive, nullable column that preserves the 1-based order of a video
  #     within its lesson when Blitz caption filenames are auto-recognized on
  #     upload. Applying it explicitly here keeps the live-schema-drift gate
  #     below green so the conditional push stays skipped on the common merge
  #     (same pattern as steps 7/10/11/15/18/19). Idempotent (ADD COLUMN IF NOT
  #     EXISTS), so on a fresh DB / re-run it is a harmless no-op.
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
    -f lib/db/drizzle/0084_transcript_cleaner_in_lesson_order.sql >/dev/null

  # 21. Transcript Cleaner: vidalytics_id column (Task #1520).
  #     Additive, nullable column that stores the source Vidalytics video id
  #     captured from a recognized Blitz caption filename — the real key that
  #     links a captioned transcript to every Blitz lesson the video appears in.
  #     Applying it explicitly here keeps the live-schema-drift gate below green
  #     so the conditional push stays skipped on the common merge (same pattern
  #     as step 20). Idempotent (ADD COLUMN IF NOT EXISTS).
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
    -f lib/db/drizzle/0085_transcript_cleaner_vidalytics_id.sql >/dev/null

  # 22. Ad-spend funding ledger (Task #1536).
  #     New append-only table `ad_spend_transactions` with a user_id index and
  #     a null-tolerant unique index on nmi_transaction_id (the idempotency key
  #     for funding credits). Applying it here keeps the live-schema-drift gate
  #     green so the conditional push stays skipped. Idempotent
  #     (CREATE TABLE/INDEX IF NOT EXISTS).
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
    -f lib/db/drizzle/0086_ad_spend_transactions.sql >/dev/null

  # 23. AI Live Documents parity + provenance FK swap (Task #1531).
  #     Brings ai_live_documents to full parity with legacy knowledgebase_docs
  #     (audience/taxonomy/source/verification columns + a STORED generated
  #     search_vector + plain GIN index + title unique) and repoints the
  #     kb_doc_provenance FK from knowledgebase_docs onto ai_live_documents so
  #     the staging push writes citable docs there. Applying it here keeps the
  #     live-schema-drift gate below green so the conditional push stays skipped
  #     (same pattern as steps 7/10/11/15/18-22). Idempotent (ADD COLUMN/INDEX
  #     IF NOT EXISTS, DROP CONSTRAINT IF EXISTS + guarded ADD CONSTRAINT).
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
    -f lib/db/drizzle/0087_ai_live_documents_parity.sql >/dev/null

  # 24. Synthesis Engine topic index (Task #1533).
  #     New additive many-to-many table `kb_source_node_links` mapping
  #     ai_source_documents onto taxonomy nodes with an LLM/lexical relevance
  #     score. It is the topic layer synthesis reads to gather all material for a
  #     node across the corpus. Applying it here keeps the live-schema-drift gate
  #     green so the conditional push stays skipped. Idempotent
  #     (CREATE TABLE/INDEX IF NOT EXISTS).
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
    -f lib/db/drizzle/0088_kb_source_node_links.sql >/dev/null

  # 25. Synthesis Engine multi-source provenance (Task #1533).
  #     Additive nullable jsonb column `kb_staging_docs.synthesis_sources`
  #     holding the list of source documents a synthesized truth-doc draft was
  #     consolidated from. Applying it here keeps the live-schema-drift gate
  #     green so the conditional push stays skipped. Idempotent
  #     (ADD COLUMN IF NOT EXISTS).
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
    -f lib/db/drizzle/0089_kb_staging_synthesis_sources.sql >/dev/null

  # 26. Synthesis Engine Part 2 — per-source "incorporated" marker (Task #1534).
  #     Additive nullable column `ai_source_documents.incorporated_at` marking the
  #     last time a source was folded into a node synthesis (NULL = never). Drives
  #     incremental runs. Applying it here keeps the live-schema-drift gate green
  #     so the conditional push stays skipped. Idempotent (ADD COLUMN IF NOT EXISTS).
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
    -f lib/db/drizzle/0090_ai_source_documents_incorporated_at.sql >/dev/null

  # 27. Synthesis Engine Part 2 — durable per-node synthesis state (Task #1534).
  #     New additive table `kb_node_synthesis_state` recording, per taxonomy node,
  #     when it was last synthesized and from which source docs — the marker that
  #     makes incremental re-synthesis of only affected nodes possible. Applying it
  #     here keeps the live-schema-drift gate green so the conditional push stays
  #     skipped. Idempotent (CREATE TABLE/INDEX IF NOT EXISTS).
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
    -f lib/db/drizzle/0091_kb_node_synthesis_state.sql >/dev/null

  # 28. Synthesis Engine Part 3 — update-vs-create link (Task #1535).
  #     Additive nullable columns on kb_staging_docs (update_kind,
  #     target_live_doc_id, update_summary) that mark a synthesis draft as a
  #     REVISION of an existing published Live AI Document rather than a new one.
  #     Applying it here keeps the live-schema-drift gate green so the conditional
  #     push stays skipped. Idempotent (ADD COLUMN IF NOT EXISTS).
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
    -f lib/db/drizzle/0092_kb_staging_update_link.sql >/dev/null

  # 29. Synthesis Engine Part 3 — Live AI Document version history (Task #1535).
  #     New additive table `ai_live_document_versions` that snapshots the prior
  #     published content of a Live AI Document before an approved revision
  #     supersedes it (preserving version + provenance history). Applying it here
  #     keeps the live-schema-drift gate green so the conditional push stays
  #     skipped. Idempotent (CREATE TABLE/INDEX IF NOT EXISTS).
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
    -f lib/db/drizzle/0093_ai_live_document_versions.sql >/dev/null

  # 30. Synthesis Engine full-source read (Task #1561) — per-source, per-node
  #     MAP-phase extract cache. New additive table `kb_source_node_extracts`
  #     that caches the finished node-relevant extract for each source so that,
  #     now that the map phase reads the WHOLE of every source and the reduce
  #     folds in ALL linked sources, incremental re-runs only re-extract sources
  #     whose content actually changed. Applying it here keeps the
  #     live-schema-drift gate green so the conditional push stays skipped
  #     (same pattern as steps 7/10/11/15/18-24/27/29). Idempotent
  #     (CREATE TABLE/INDEX IF NOT EXISTS).
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
    -f lib/db/drizzle/0094_kb_source_node_extracts.sql >/dev/null

  # 31. Billing hardening (Task #1572) — DB-backed billing job heartbeat.
  #     New additive table `billing_ops_heartbeat` that stores the renewal
  #     charger's last_run_at (the dead-man's-switch source) and the daily
  #     digest's cross-process send claim in Postgres, NOT Redis — precisely so
  #     the heartbeat survives the Redis outage it is meant to detect. Applying
  #     it explicitly here keeps the live-schema-drift gate below green so the
  #     conditional push stays skipped on the common merge (same pattern as
  #     steps 7/10/11/15/18-24/27/29/30). Idempotent (CREATE TABLE IF NOT
  #     EXISTS, guarded ADD CONSTRAINT).
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
    -f lib/db/drizzle/0095_billing_ops_heartbeat.sql >/dev/null

  # 32. Blitz change-monitoring foundation (Task #1564) — DORMANT.
  #     Additive nullable columns `ai_source_documents.content_hash` (sha256
  #     fingerprint of content at last scan) + `last_scanned_at`, plus a
  #     one-time idempotent backfill of the hash for existing rows (via
  #     pgcrypto digest(), which matches the app's fingerprintContent). These
  #     back the disabled "Scan for changes" flow that detects when a
  #     core-training source changed and proposes a reference-doc revision
  #     through the existing supersede path. Applying it here keeps the
  #     live-schema-drift gate green so the conditional push stays skipped
  #     (same pattern as steps 20/21/26/30/31). Idempotent (ADD COLUMN IF NOT
  #     EXISTS, CREATE EXTENSION IF NOT EXISTS, UPDATE gated on NULL).
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
    -f lib/db/drizzle/0095_ai_source_documents_content_hash.sql >/dev/null

  # 33. Accountability Partner system (Task #1577) — partners,
  #     partner_assignments, kickoff_coaches. Three new additive tables (a
  #     roster, an assignment-history log with a partial unique index enforcing
  #     one active assignment per member, and a separate kickoff-coach roster).
  #     Applying it here keeps the live-schema-drift gate green so the
  #     conditional push stays skipped on the common merge (same pattern as
  #     steps 7/10/11/15/18-24/27/29-32). Idempotent (CREATE TABLE/INDEX IF NOT
  #     EXISTS, guarded ADD CONSTRAINT).
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
    -f lib/db/drizzle/0096_partner_assignment_tables.sql >/dev/null

  # 34. Native kickoff + partner call booking (Task #1591) — new additive
  #     `call_bookings` table (the single store-of-record for both call
  #     types) plus `ghl_calendar_id` on partners/kickoff_coaches and
  #     `cadence_per_week` on partner_assignments. Applying it here keeps the
  #     live-schema-drift gate green so the conditional push stays skipped on
  #     the common merge (same pattern as steps 7/10/11/15/18-24/27/29-33).
  #     Idempotent (CREATE TABLE/INDEX IF NOT EXISTS, guarded ADD
  #     CONSTRAINT/COLUMN).
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
    -f lib/db/drizzle/0097_call_bookings.sql >/dev/null
fi

# Schema sync — CONDITIONAL push.
#
# `drizzle-kit push --force` does a full "Pulling schema from database"
# introspection of the ENTIRE database every time it runs. On this large DB
# that costs 1-3 minutes (more under concurrent-merge load) and is by far the
# single biggest, most load-sensitive step in post-merge — and on the common
# merge that touches NO schema it introspects everything only to apply nothing.
# That unconditional push is what made post-merge setup time out.
#
# So we gate the push on the drift test instead of running it every time:
#
#   - The drift test's vitest globalSetup applies the idempotent companion
#     `.sql` migrations (SYNC_MIGRATIONS_ONLY) and then asserts the live dev DB
#     matches every table/column declared in lib/db/src/schema/. It is the same
#     vitest file the `db-drift` workflow exercises.
#   - If it PASSES, the schema is already in sync and a full push would be a
#     no-op — skip it. This is the common (fast) path.
#   - If it FAILS, a genuine schema change merged that isn't in the dev DB yet.
#     Run push-force to apply it, then re-run the drift test to confirm the push
#     actually resolved the drift (the task #561 failure mode: push skipped,
#     errored partially, or the DB was manually altered).
#
# `set -e` does not trip on the command in an `if` condition, so a drift-test
# failure here cleanly routes to the push branch instead of aborting. A failed
# push, or drift that survives the push, still aborts post-merge (as it should).
#
# Note: the drift test verifies tables/columns, not indexes/constraints. A
# merge that ONLY adds an index/constraint with no companion `.sql` would not
# be detected here and its push would be skipped — an acceptable trade for a
# dev DB (perf-only; constraint changes ship with companion `.sql` that the
# globalSetup applies regardless of this gate).
if pnpm --filter @workspace/db exec vitest run src/live-schema-drift.test.ts; then
  echo "post-merge: dev DB schema already in sync — skipping drizzle-kit push --force"
else
  echo "post-merge: schema drift detected — running drizzle-kit push --force"
  pnpm --filter db push-force
  # Confirm the push resolved the drift before we trust the dev DB.
  pnpm --filter @workspace/db exec vitest run src/live-schema-drift.test.ts
fi

# Run the plan-metadata backfill from task #319. The SQL is fully idempotent
# (each UPDATE is gated on `tagline IS NULL AND highlights = '[]'`), so it
# only writes rows that still have the column defaults from `drizzle-kit push`
# and never clobbers a row an admin has already edited. We invoke psql
# directly because `drizzle-kit push` only syncs schema, not data.
if [ -n "$DATABASE_URL" ]; then
  psql "$DATABASE_URL" \
    -v ON_ERROR_STOP=1 \
    -f lib/db/drizzle/0033_products_plan_metadata.sql \
    >/dev/null
fi

# Re-scrub knowledgebase_docs through the centralized privacy filter so a
# freshly-synced dev database can never re-introduce a coach surname that was
# already removed (e.g. a stale row copy carrying "Wisbaum"). The script cleans
# both content AND titles; titles carry a UNIQUE constraint, so a scrubbed
# title that would collide with another row is de-duplicated with a numeric
# suffix instead of aborting the run. It only updates rows that actually change,
# so it is idempotent and a no-op when nothing needs cleaning. Keeps the
# kb-coach-name-leak-guard DB test green after every merge without anyone
# running the script by hand.
if [ -n "$DATABASE_URL" ]; then
  pnpm --filter @workspace/api-server exec tsx \
    src/scripts/rescrub-knowledgebase-docs.ts
fi

# Rebrand stored OLD-BRAND references (Cherrington / TCE / … -> BTS / Adam) in the
# two raw AI-source tables that have no re-scrub pass of their own:
# transcript_cleaner_documents (holding store) and ai_source_documents (filed
# source library). The #1604 cleaner rules only rebrand NEW cleans / refine +
# retrieval; this one-shot fixes content already cleaned / filed before those
# rules landed. Old-brand ONLY — coach / VA attribution in raw source is
# preserved (NOT the full privacy filter). Idempotent: only rows that actually
# change are written, so a re-run is a no-op.
if [ -n "$DATABASE_URL" ]; then
  pnpm --filter @workspace/api-server exec tsx \
    src/scripts/rebrand-old-brand-source-content.ts
fi

# Transcript Cleaner admin-supplied cleaning inputs (Task #1560). Additive,
# all-nullable columns captured at upload time. The drift test only fires
# push --force when the schema is out of sync, so add these columns explicitly
# and idempotently (ADD COLUMN IF NOT EXISTS) so prod picks them up on merge
# even when the drift gate short-circuits. No backfill — unset means fall back.
if [ -n "$DATABASE_URL" ]; then
  psql "$DATABASE_URL" \
    -v ON_ERROR_STOP=1 \
    -f lib/db/drizzle/0094_transcript_cleaner_provided_inputs.sql \
    >/dev/null
fi

# Admin-manageable TOOL-tag vocabulary + AI-proposes queue (Task #1586). New
# tables, so the drift gate DOES fire push --force — but apply the companion
# .sql explicitly and idempotently (CREATE TABLE / INDEX IF NOT EXISTS) so prod
# picks them up on merge regardless of whether the drift short-circuits. The
# api-server boot also runs the same DDL, so this is belt-and-suspenders.
if [ -n "$DATABASE_URL" ]; then
  psql "$DATABASE_URL" \
    -v ON_ERROR_STOP=1 \
    -f lib/db/drizzle/0097_kb_tool_tags.sql \
    >/dev/null
fi

# Onboarding tier-aware completion effects idempotency ledger (Task #1642 /
# TB1). New, empty, additive table `onboarding_effects` (per-(member, effect)
# claim ledger for the one-time creation-time nurture enrollment + completion-
# time sequence cancellation). Applying it explicitly here keeps the
# live-schema-drift gate below green so the conditional push stays skipped on
# the common merge instead of triggering a slow whole-DB
# `drizzle-kit push --force` just to create one table (same pattern as steps
# 7/10/11/15/18-24/27/29-34). Idempotent (CREATE TABLE/INDEX IF NOT EXISTS).
if [ -n "$DATABASE_URL" ]; then
  psql "$DATABASE_URL" \
    -v ON_ERROR_STOP=1 \
    -f lib/db/drizzle/0102_onboarding_effects.sql \
    >/dev/null
fi

# Coaching-transcript VALUE SCREENER durable store (Task #1702). New, empty,
# additive tables (kb_call_screenings, kb_screened_exchanges) for the
# value-screening layer that sits between the existing source screening/mining
# gates and the synthesis engine. Applying it explicitly here keeps the
# live-schema-drift gate green so the conditional push stays skipped on the
# common merge instead of triggering a slow whole-DB `drizzle-kit push --force`
# just to create these tables (same pattern as the other additive-table steps
# above). Idempotent (CREATE TABLE/INDEX IF NOT EXISTS), so on a fresh DB /
# re-run it is a harmless no-op.
if [ -n "$DATABASE_URL" ]; then
  psql "$DATABASE_URL" \
    -v ON_ERROR_STOP=1 \
    -f lib/db/drizzle/0105_kb_value_screener.sql \
    >/dev/null
fi

# Value-screener CALIBRATION removal (Task #1707). The screener is now a
# recall-biased de-noiser with no few-shot calibration loop, so 0105's
# kb_calibration_examples table and the kb_call_screenings.calibration_version
# stamp are dropped. This is a table/column REMOVAL: the live-schema-drift gate
# only checks schema ⊆ DB, so the conditional push never fires to DROP them —
# they must be dropped explicitly here or they linger in prod. Idempotent
# (DROP ... IF EXISTS), so a fresh DB / re-run is a harmless no-op.
if [ -n "$DATABASE_URL" ]; then
  psql "$DATABASE_URL" \
    -v ON_ERROR_STOP=1 \
    -f lib/db/drizzle/0106_drop_kb_screener_calibration.sql \
    >/dev/null
fi
