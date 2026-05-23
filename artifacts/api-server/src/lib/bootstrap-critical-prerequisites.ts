import { db, productsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { seedYseProducts } from "./seed-yse-products";
import { seedMachineProductKeyMappings } from "./machine-product-key-mappings";

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

  // 1. YSE product seeding — endpoint returns UNKNOWN_SLUGS / 500 without it.
  try {
    await seedYseProducts();
  } catch (err) {
    console.error("[Bootstrap] seedYseProducts() threw:", err);
    missing.push("seedYseProducts");
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

  if (missing.length === 0) {
    console.log("[Bootstrap] All critical prerequisites OK");
  }

  return { ok: missing.length === 0, missing };
}
