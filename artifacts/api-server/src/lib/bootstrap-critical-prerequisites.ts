import { db, productsTable, chatSystemPromptsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { runTapfiliateColumnMigration } from "./tapfiliate-migration";
import { seedYseProducts } from "./seed-yse-products";
import { seedMachineBrandProducts } from "./seed-machine-brand-products";
import { seedMachineProductKeyMappings } from "./machine-product-key-mappings";
import { seedKnowledgebaseFromFiles } from "./seed-kb";
import {
  rescrubKnowledgebaseDocs,
  findUnscrubbedTitles,
} from "./rescrub-knowledgebase-docs";
import {
  ANTI_HALLUCINATION_SYSTEM_PROMPT,
  ANTI_HALLUCINATION_SENTINEL,
  LEGACY_GENERIC_KB_TITLES,
} from "./chat-system-prompt";
import { ensureFoundingSuperAdmins } from "./ensure-founding-superadmins";

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

  if (missing.length === 0) {
    console.log("[Bootstrap] All critical prerequisites OK");
  }

  return { ok: missing.length === 0, missing };
}

async function ensureKBGrounding(): Promise<void> {
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

  if (activePrompt && !activePrompt.content.includes(ANTI_HALLUCINATION_SENTINEL)) {
    await db
      .update(chatSystemPromptsTable)
      .set({ content: ANTI_HALLUCINATION_SYSTEM_PROMPT })
      .where(eq(chatSystemPromptsTable.id, activePrompt.id));
    console.log("[Bootstrap] Updated active system prompt with anti-hallucination grounding rules.");
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
}
