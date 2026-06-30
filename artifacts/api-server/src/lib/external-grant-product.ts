import crypto from "crypto";
import bcrypt from "bcryptjs";
import {
  db,
  webhookLogsTable,
  productsTable,
  userProductsTable,
  usersTable,
  affiliateProfilesTable,
  commissionsTable,
  commissionRatesTable,
  referralLinksTable,
} from "@workspace/db";
import { eq, and, inArray, sql, isNotNull, lt } from "drizzle-orm";
import { queueGHLSync } from "./ghl-queue";
import { CommunicationService } from "./communication-service";
import { ensureAffiliateProfile } from "./commissions";
import { emitWebhookEvent } from "./webhook-events";

export const YSE_GRANT_EVENT_TYPE = "external.grant_product";
export const YSE_GRANT_MAX_ATTEMPTS = 5;
/**
 * Exponential backoff (in ms) between retry attempts. Index = number of
 * attempts that have already been made. After the 5th failure we stop
 * retrying and the row stays as `status='failed'` with `attempts >= MAX`
 * until an admin replays it from the dashboard.
 */
export const YSE_GRANT_BACKOFF_MS = [
  60_000,
  5 * 60_000,
  30 * 60_000,
  2 * 60 * 60_000,
  6 * 60 * 60_000,
];

/**
 * Record a failed YSE grant attempt to webhook_logs so the retry job can
 * pick it up. Uses upsert keyed on the external_id unique constraint so a
 * retry that fails again just increments the attempts counter and pushes
 * out the next retry timestamp.
 *
 * This is intentionally a self-contained INSERT … ON CONFLICT outside of
 * any caller-supplied transaction — the grant transaction is already
 * rolled back by the time we get here, and we never want a logging
 * failure to mask the real error.
 */
async function recordFailedAttempt(
  externalId: string,
  payload: ExternalGrantPayload,
  err: unknown,
): Promise<void> {
  const errorMessage = redactPii(err).substring(0, 1000);
  try {
    await db.execute(sql`
      INSERT INTO webhook_logs (external_id, event_type, status, payload,
        attempts, last_attempt_at, next_retry_at, error_message)
      VALUES (${externalId}, ${YSE_GRANT_EVENT_TYPE}, 'failed',
        ${payload as unknown as Record<string, unknown>}::jsonb,
        1, now(),
        now() + (${YSE_GRANT_BACKOFF_MS[0]} || ' milliseconds')::interval,
        ${errorMessage})
      ON CONFLICT (external_id) DO UPDATE SET
        status = 'failed',
        attempts = webhook_logs.attempts + 1,
        last_attempt_at = now(),
        error_message = EXCLUDED.error_message,
        next_retry_at = CASE
          WHEN webhook_logs.attempts + 1 >= ${YSE_GRANT_MAX_ATTEMPTS} THEN NULL
          ELSE now() + (
            (ARRAY[${sql.raw(YSE_GRANT_BACKOFF_MS.join(","))}]::bigint[])[
              LEAST(webhook_logs.attempts + 1, ${YSE_GRANT_BACKOFF_MS.length})
            ] || ' milliseconds'
          )::interval
        END
      WHERE webhook_logs.result IS NULL
    `);
  } catch (writeErr) {
    console.error(
      "[ExternalGrant] Failed to record failed-attempt row:",
      redactPii(writeErr),
    );
  }
}

export interface ExternalGrantCustomer {
  email: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
}

export interface ExternalGrantPayload {
  externalOrderId: string;
  externalSource: string;
  customer: ExternalGrantCustomer;
  productSlugs: string[];
  purchasedAt: string;
  metadata?: Record<string, unknown>;
}

export interface GrantResult {
  productSlug: string;
  productId: number;
  userProductId: number;
  alreadyGranted: boolean;
}

export interface ExternalGrantResponse {
  userId: number;
  userCreated: boolean;
  grants: GrantResult[];
  welcomeEmailQueued: boolean;
}

export interface ExternalGrantError {
  code: "UNKNOWN_SLUGS";
  unknownSlugs: string[];
}

interface ResolvedProduct {
  id: number;
  slug: string;
  name: string;
  type: string;
  durationDays: number | null;
}

/**
 * Redact PII (email addresses) from a string so it's safe to write to log
 * aggregators. Replaces local-parts with "***" while keeping the domain
 * visible for debugging (e.g. "***@example.com").
 */
export function redactPii(input: unknown): string {
  const str = input instanceof Error ? input.message : String(input ?? "");
  return str.replace(
    /([A-Za-z0-9._%+-]+)@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g,
    "***@$2",
  );
}

export class UnknownProductSlugsError extends Error {
  constructor(public readonly unknownSlugs: string[]) {
    super(`Unknown product slug(s): ${unknownSlugs.join(", ")}`);
    this.name = "UnknownProductSlugsError";
  }
}

/**
 * Single-row user_products grant — the canonical insert shared by every
 * purchase path (ThriveCart webhook, NMI native checkout, manual admin grant).
 *
 * Idempotent: a 23505 unique-constraint violation (user already holds an active
 * grant for this product) is treated as success — the existing row is left in
 * place and `alreadyGranted: true` is returned.
 *
 * Drizzle wraps PostgreSQL errors in a DrizzleQueryError; the pg code lives on
 * `err.cause.code`, not `err.code` — hence the double-check below.
 */
export async function insertUserProductGrant(params: {
  userId: number;
  productId: number;
  externalSource: string;
  externalOrderId: string;
  durationDays?: number | null;
  /** ThriveCart-specific fields — only set when source is 'thrivecart' */
  thrivecartOrderId?: string | null;
  thrivecartSubId?: string | null;
}): Promise<{ alreadyGranted: boolean }> {
  const {
    userId,
    productId,
    externalSource,
    externalOrderId,
    durationDays,
    thrivecartOrderId,
    thrivecartSubId,
  } = params;

  let expiresAt: Date | null = null;
  if (durationDays) {
    expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + durationDays);
  }

  try {
    await db.insert(userProductsTable).values({
      userId,
      productId,
      status: "active",
      externalSource,
      externalOrderId,
      expiresAt,
      thrivecartOrderId: thrivecartOrderId ?? null,
      thrivecartSubId: thrivecartSubId ?? null,
    });
    return { alreadyGranted: false };
  } catch (err: unknown) {
    const e = err as { code?: string; cause?: { code?: string } };
    if (e.code === "23505" || e.cause?.code === "23505") {
      return { alreadyGranted: true };
    }
    throw err;
  }
}

/**
 * Extend a member's active access to a product out to `newExpiresAt` after a
 * successful recurring renewal charge. Used by the renewal charger; mirrors the
 * partial-unique (user_id, product_id) WHERE status='active' invariant.
 *
 * Rules:
 *  - Only ever pushes an expiry FORWARD. The UPDATE is gated on
 *    `expires_at IS NOT NULL AND expires_at < newExpiresAt`, so a lifetime
 *    grant (expires_at NULL) or an already-further-out expiry is never shrunk.
 *  - If no active grant exists, inserts one with the exact `newExpiresAt`.
 *  - Handles the race where the active grant is inserted concurrently (the
 *    partial-unique index throws 23505) by re-running the non-shrinking update.
 *
 * Returns which branch executed (useful for tests / logging).
 */
export async function extendActiveGrantExpiry(params: {
  userId: number;
  productId: number;
  newExpiresAt: Date;
  externalSource: string;
  externalOrderId: string;
}): Promise<{ extended: boolean; created: boolean; untouched: boolean }> {
  const { userId, productId, newExpiresAt, externalSource, externalOrderId } = params;

  const nonShrinkingUpdate = () =>
    db
      .update(userProductsTable)
      .set({ expiresAt: newExpiresAt })
      .where(
        and(
          eq(userProductsTable.userId, userId),
          eq(userProductsTable.productId, productId),
          eq(userProductsTable.status, "active"),
          isNotNull(userProductsTable.expiresAt),
          lt(userProductsTable.expiresAt, newExpiresAt),
        ),
      )
      .returning({ id: userProductsTable.id });

  const updated = await nonShrinkingUpdate();
  if (updated.length > 0) {
    return { extended: true, created: false, untouched: false };
  }

  // No row was pushed forward. Either an active grant exists but is lifetime
  // (NULL) / already further out — leave it untouched — or there is no active
  // grant at all, in which case we create one.
  const [existing] = await db
    .select({ id: userProductsTable.id })
    .from(userProductsTable)
    .where(
      and(
        eq(userProductsTable.userId, userId),
        eq(userProductsTable.productId, productId),
        eq(userProductsTable.status, "active"),
      ),
    )
    .limit(1);

  if (existing) {
    return { extended: false, created: false, untouched: true };
  }

  try {
    await db.insert(userProductsTable).values({
      userId,
      productId,
      status: "active",
      externalSource,
      externalOrderId,
      expiresAt: newExpiresAt,
    });
    return { extended: false, created: true, untouched: false };
  } catch (err: unknown) {
    const e = err as { code?: string; cause?: { code?: string } };
    if (e.code === "23505" || e.cause?.code === "23505") {
      // Lost the race — an active grant now exists. Re-run the non-shrinking
      // update so we still push the expiry forward where appropriate.
      const retried = await nonShrinkingUpdate();
      return {
        extended: retried.length > 0,
        created: false,
        untouched: retried.length === 0,
      };
    }
    throw err;
  }
}

function externalIdLockKeys(externalId: string): [number, number] {
  const hash = crypto.createHash("sha256").update(externalId).digest();
  return [hash.readInt32BE(0), hash.readInt32BE(4)];
}

/**
 * Look up a previously processed result for the given external order.
 * Returns null if not found or not yet fully processed.
 */
export async function getCachedGrantResponse(
  externalSource: string,
  externalOrderId: string,
): Promise<ExternalGrantResponse | null> {
  const externalId = `${externalSource}_${externalOrderId}`;

  const [existing] = await db
    .select({ result: webhookLogsTable.result, status: webhookLogsTable.status })
    .from(webhookLogsTable)
    .where(eq(webhookLogsTable.externalId, externalId))
    .limit(1);

  if (!existing) return null;
  if (existing.status !== "processed" || !existing.result) return null;

  return existing.result as ExternalGrantResponse;
}

/**
 * Attempt to claim exclusive processing rights for an external order by
 * inserting a "received" sentinel row. Uses the unique constraint on
 * `external_id` to serialise concurrent duplicate requests at the DB level.
 *
 * Returns the new row id if the claim succeeded, or null if another caller
 * already owns it.
 */
async function claimProcessingSlot(
  externalId: string,
  eventType: string,
  payload: Record<string, unknown>,
): Promise<number | null> {
  const rows = await db
    .insert(webhookLogsTable)
    .values({
      externalId,
      eventType,
      status: "received",
      payload,
    })
    .onConflictDoNothing()
    .returning({ id: webhookLogsTable.id });

  return rows.length > 0 ? rows[0].id : null;
}

/**
 * Poll (up to `timeoutMs`) for another in-flight request to finish writing
 * the processed result, then return the cached response. Returns null when
 * the timeout elapses without a result (caller should treat as retriable).
 */
async function waitForProcessedResult(
  externalId: string,
  timeoutMs = 3000,
): Promise<ExternalGrantResponse | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 100));
    const cached = await getCachedGrantResponse(
      externalId.split("_").slice(0, 1).join(""),
      externalId,
    );
    // Re-derive source+orderId from the externalId is fragile; query directly.
    const [row] = await db
      .select({ result: webhookLogsTable.result, status: webhookLogsTable.status })
      .from(webhookLogsTable)
      .where(eq(webhookLogsTable.externalId, externalId))
      .limit(1);
    if (row?.status === "processed" && row.result) {
      return row.result as ExternalGrantResponse;
    }
    void cached; // unused – kept for clarity
  }
  return null;
}

export async function handleExternalGrantProduct(
  payload: ExternalGrantPayload,
): Promise<ExternalGrantResponse | ExternalGrantError> {
  const externalId = `${payload.externalSource}_${payload.externalOrderId}`;
  const email = payload.customer.email.toLowerCase().trim();
  const name =
    [payload.customer.firstName, payload.customer.lastName]
      .filter(Boolean)
      .join(" ") || email.split("@")[0];

  // Fetch only the requested products (efficient targeted query)
  const allProducts = await db
    .select({
      id: productsTable.id,
      slug: productsTable.slug,
      name: productsTable.name,
      type: productsTable.type,
      durationDays: productsTable.durationDays,
    })
    .from(productsTable)
    .where(inArray(productsTable.slug, payload.productSlugs));

  const bySlug = new Map<string, ResolvedProduct>();
  for (const p of allProducts) {
    bySlug.set(p.slug, p);
  }

  const products: ResolvedProduct[] = [];
  const unknownSlugs: string[] = [];
  for (const slug of payload.productSlugs) {
    const p = bySlug.get(slug);
    if (p) {
      products.push(p);
    } else {
      unknownSlugs.push(slug);
    }
  }

  if (unknownSlugs.length > 0) {
    return { code: "UNKNOWN_SLUGS", unknownSlugs };
  }

  const [lockKey1, lockKey2] = externalIdLockKeys(externalId);

  let tempPassword: string | null = null;

  type TxOutcome =
    | { cached: true; result: ExternalGrantResponse }
    | { cached: false; userId: number; userCreated: boolean; grants: GrantResult[] };

  const txOutcome = await db.transaction(async (tx): Promise<TxOutcome> => {
    // Acquire advisory lock so concurrent requests with same externalId serialize
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(${lockKey1}, ${lockKey2})`,
    );

    // Check for a cached result inside the lock
    const [existing] = await tx
      .select({ id: webhookLogsTable.id, result: webhookLogsTable.result })
      .from(webhookLogsTable)
      .where(eq(webhookLogsTable.externalId, externalId))
      .limit(1);

    if (existing?.result != null) {
      return { cached: true, result: existing.result as ExternalGrantResponse };
    }

    // Claim the processing slot before doing any grant work. We upsert
    // here so a retry of a previously-failed delivery (status='failed',
    // result=null) re-takes ownership instead of crashing on the
    // external_id unique constraint. The attempts counter advances on
    // every retake so the retry job can stop after MAX_ATTEMPTS.
    const [logEntry] = await tx
      .insert(webhookLogsTable)
      .values({
        externalId,
        eventType: YSE_GRANT_EVENT_TYPE,
        status: "processing",
        payload: payload as unknown as Record<string, unknown>,
        attempts: 1,
        lastAttemptAt: new Date(),
      })
      .onConflictDoUpdate({
        target: webhookLogsTable.externalId,
        set: {
          status: "processing",
          payload: payload as unknown as Record<string, unknown>,
          attempts: sql`${webhookLogsTable.attempts} + 1`,
          lastAttemptAt: new Date(),
          errorMessage: null,
          nextRetryAt: null,
        },
      })
      .returning({ id: webhookLogsTable.id });

    const [existingUser] = await tx
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.email, email))
      .limit(1);

    let userId: number;
    let userCreated: boolean;

    if (existingUser) {
      userId = existingUser.id;
      userCreated = false;
    } else {
      tempPassword = crypto.randomBytes(16).toString("hex");
      const passwordHash = await bcrypt.hash(tempPassword, 10);
      // Derive sourceProduct from the first frontend product being granted.
      // Mirrors resolveMemberBrand: frontend products carry the brand identity;
      // if no frontend product is in this grant, fall back to "bts".
      const frontendProduct = products.find((p) => p.type === "frontend");
      const sourceProduct = frontendProduct?.slug ?? "bts";

      const [newUser] = await tx
        .insert(usersTable)
        .values({
          email,
          name,
          passwordHash,
          phone: payload.customer.phone || null,
          sourceProduct,
        })
        .returning({ id: usersTable.id });
      userId = newUser.id;
      userCreated = true;
      console.log(`[ExternalGrant] Created new user: ${email} (id=${userId})`);
    }

    const grants: GrantResult[] = [];
    for (const product of products) {
      const [existingGrant] = await tx
        .select({ id: userProductsTable.id })
        .from(userProductsTable)
        .where(
          and(
            eq(userProductsTable.userId, userId),
            eq(userProductsTable.productId, product.id),
            eq(userProductsTable.status, "active"),
          ),
        )
        .limit(1);

      if (existingGrant) {
        grants.push({
          productSlug: product.slug,
          productId: product.id,
          userProductId: existingGrant.id,
          alreadyGranted: true,
        });
        continue;
      } else {
        let expiresAt: Date | null = null;
        if (product.durationDays) {
          expiresAt = new Date();
          expiresAt.setDate(expiresAt.getDate() + product.durationDays);
        }
        const [newGrant] = await tx
          .insert(userProductsTable)
          .values({
            userId,
            productId: product.id,
            status: "active",
            externalOrderId: payload.externalOrderId,
            externalSource: payload.externalSource,
            expiresAt,
          })
          .returning({ id: userProductsTable.id });
        grants.push({
          productSlug: product.slug,
          productId: product.id,
          userProductId: newGrant.id,
          alreadyGranted: false,
        });
        console.log(
          `[ExternalGrant] Granted product "${product.name}" to user ${email}`,
        );
      }
    }

    const result: ExternalGrantResponse = {
      userId,
      userCreated,
      grants,
      welcomeEmailQueued: userCreated,
    };

    await tx
      .update(webhookLogsTable)
      .set({
        status: "processed",
        result: result as unknown as Record<string, unknown>,
        processedAt: new Date(),
        errorMessage: null,
        nextRetryAt: null,
        lastAttemptAt: new Date(),
      })
      .where(eq(webhookLogsTable.id, logEntry.id));

    return { cached: false, userId, userCreated, grants };
  }).catch(async (err) => {
    // The transaction rolled back, so no `processing` row remains in
    // webhook_logs. Record (or update) a `failed` row so the retry job
    // can pick it up. We don't await any post-commit side-effects here
    // because nothing was committed.
    await recordFailedAttempt(externalId, payload, err);
    throw err;
  });


  if (txOutcome.cached) {
    return txOutcome.result;
  }

  const { userId, userCreated, grants } = txOutcome;

  // ── Post-commit side effects ─────────────────────────────────────────────
  // Mirrors the pattern in webhook-handler.ts: findOrCreateUser() handles
  // new-user welcome email + GHL create_contact; handleOrderSuccess() handles
  // add_tags + add_note + ensureAffiliateProfile + commission attribution.
  // GHL calls are NOT wrapped in .catch() — errors propagate to the caller,
  // matching ThriveCart behavior. Only ensureAffiliateProfile and commission
  // attribution use try/catch because their failures are non-fatal.

  if (userCreated && tempPassword) {
    // Mirrors webhook-handler.ts findOrCreateUser(): welcome email + create_contact
    CommunicationService.queueEmail({
      templateSlug: "welcome",
      to: email,
      variables: { member_name: name, temp_password: tempPassword },
      userId,
    });

    await queueGHLSync({
      action: "create_contact",
      userId,
      email,
      name,
      tags: ["new_member", "yse_signup"],
      customFields: {
        portal_member_since: new Date().toISOString(),
        source: payload.externalSource,
      },
    });
  }

  // Mirrors webhook-handler.ts handleOrderSuccess(): add_tags + add_note for all users
  const newProductTags = grants
    .filter((g) => !g.alreadyGranted)
    .map((g) => `product_${g.productSlug}`);

  if (newProductTags.length > 0) {
    await queueGHLSync({
      action: "add_tags",
      userId,
      email,
      tags: [...newProductTags, "active_customer"],
      customFields: {
        last_purchase_date: new Date().toISOString(),
      },
    });
  }

  await queueGHLSync({
    action: "add_note",
    userId,
    email,
    noteBody: `Products granted via ${payload.externalSource} (Order: ${payload.externalOrderId})`,
  });


  // Mirrors webhook-handler.ts handleOrderSuccess(): ensureAffiliateProfile + commission
  await ensureAffiliateProfile(userId).catch((err: unknown) => {
    console.error(
      "[ExternalGrant] Error ensuring affiliate profile:",
      redactPii(err),
    );
  });

  try {
    await attributeYseCommission(payload, userId, grants);
  } catch (err) {
    console.error(
      "[ExternalGrant] Commission attribution error:",
      redactPii(err),
    );
  }

  return {
    userId,
    userCreated,
    grants,
    welcomeEmailQueued: userCreated,
  };
}

export const YSE_REVOKE_EVENT_TYPE = "external.revoke_product";

export interface ExternalRevokePayload {
  externalOrderId: string;
  externalSource: string;
  reason?: string;
}

export interface RevokedProductInfo {
  userProductId: number;
  userId: number;
  productId: number;
}

export interface ExternalRevokeResponse {
  externalOrderId: string;
  externalSource: string;
  revokedCount: number;
  alreadyCancelledCount: number;
  revoked: RevokedProductInfo[];
}

/**
 * Soft-cancel a previously YSE-granted product. Sets `cancelledAt` and
 * `status='cancelled'` on every matching `user_products` row keyed by
 * (externalSource, externalOrderId) without deleting the audit trail. The
 * matching `webhook_logs` entry is updated so the result jsonb records the
 * revocation alongside the original grant payload.
 *
 * Idempotent: rows that already have `cancelledAt` set are counted as
 * `alreadyCancelledCount` and left untouched.
 */
export async function handleExternalRevokeProduct(
  payload: ExternalRevokePayload,
): Promise<ExternalRevokeResponse> {
  const externalId = `${payload.externalSource}_${payload.externalOrderId}`;
  const now = new Date();

  return db.transaction(async (tx) => {
    const matches = await tx
      .select({
        id: userProductsTable.id,
        userId: userProductsTable.userId,
        productId: userProductsTable.productId,
        cancelledAt: userProductsTable.cancelledAt,
      })
      .from(userProductsTable)
      .where(
        and(
          eq(userProductsTable.externalOrderId, payload.externalOrderId),
          eq(userProductsTable.externalSource, payload.externalSource),
        ),
      );

    const toRevoke = matches.filter((m) => m.cancelledAt == null);
    const alreadyCancelledCount = matches.length - toRevoke.length;

    if (toRevoke.length > 0) {
      await tx
        .update(userProductsTable)
        .set({ cancelledAt: now, status: "cancelled" })
        .where(
          inArray(
            userProductsTable.id,
            toRevoke.map((r) => r.id),
          ),
        );
    }

    const revocationInfo = {
      revokedAt: now.toISOString(),
      reason: payload.reason ?? null,
      revokedUserProductIds: toRevoke.map((r) => r.id),
      alreadyCancelledCount,
    };

    const [existingLog] = await tx
      .select({ id: webhookLogsTable.id, result: webhookLogsTable.result })
      .from(webhookLogsTable)
      .where(eq(webhookLogsTable.externalId, externalId))
      .limit(1);

    if (existingLog) {
      const existingResult =
        (existingLog.result as Record<string, unknown> | null) ?? {};
      await tx
        .update(webhookLogsTable)
        .set({
          status: "revoked",
          result: {
            ...existingResult,
            revocation: revocationInfo,
          } as unknown as Record<string, unknown>,
          processedAt: now,
          lastAttemptAt: now,
        })
        .where(eq(webhookLogsTable.id, existingLog.id));
    } else {
      await tx
        .insert(webhookLogsTable)
        .values({
          externalId,
          eventType: YSE_REVOKE_EVENT_TYPE,
          status: "revoked",
          payload: payload as unknown as Record<string, unknown>,
          result: { revocation: revocationInfo } as unknown as Record<
            string,
            unknown
          >,
          attempts: 1,
          lastAttemptAt: now,
          processedAt: now,
        })
        .onConflictDoNothing();
    }

    return {
      externalOrderId: payload.externalOrderId,
      externalSource: payload.externalSource,
      revokedCount: toRevoke.length,
      alreadyCancelledCount,
      revoked: toRevoke.map((r) => ({
        userProductId: r.id,
        userId: r.userId,
        productId: r.productId,
      })),
    };
  });
}

async function attributeYseCommission(
  payload: ExternalGrantPayload,
  buyerUserId: number,
  grants: GrantResult[],
): Promise<Record<string, unknown>> {
  const affiliateCode =
    typeof payload.metadata?.bts_ref === "string"
      ? payload.metadata.bts_ref.trim()
      : typeof payload.metadata?.affiliateCode === "string"
        ? payload.metadata.affiliateCode.trim()
        : "";

  if (!affiliateCode) {
    return { action: "no_attribution", reason: "No affiliate code found in metadata.bts_ref" };
  }

  const newGrants = grants.filter((g) => !g.alreadyGranted);
  if (newGrants.length === 0) {
    return { action: "no_attribution", reason: "No newly-granted products to attribute" };
  }

  const [affiliate] = await db
    .select({
      id: affiliateProfilesTable.id,
      userId: affiliateProfilesTable.userId,
      tier: affiliateProfilesTable.tier,
      status: affiliateProfilesTable.status,
    })
    .from(affiliateProfilesTable)
    .where(eq(affiliateProfilesTable.affiliateCode, affiliateCode))
    .limit(1);

  if (!affiliate) {
    return { action: "no_attribution", reason: `Affiliate code not found: ${affiliateCode}` };
  }

  if (affiliate.status !== "active") {
    return { action: "no_attribution", reason: "Affiliate is not active" };
  }

  if (affiliate.userId === buyerUserId) {
    return { action: "self_referral_rejected", reason: "Cannot earn commission on own purchase" };
  }

  const [buyerUser] = await db
    .select({ email: usersTable.email })
    .from(usersTable)
    .where(eq(usersTable.id, buyerUserId))
    .limit(1);

  const [affiliateUser] = await db
    .select({ email: usersTable.email })
    .from(usersTable)
    .where(eq(usersTable.id, affiliate.userId))
    .limit(1);

  let fraudFlag: string | null = null;
  if (buyerUser && affiliateUser) {
    const buyerDomain = buyerUser.email.split("@")[1];
    const affiliateDomain = affiliateUser.email.split("@")[1];
    const genericDomains = ["gmail.com", "yahoo.com", "outlook.com", "hotmail.com", "icloud.com", "aol.com"];
    if (buyerDomain === affiliateDomain && !genericDomains.includes(buyerDomain)) {
      fraudFlag = "same_domain_email";
    }
  }

  const rawPrice = payload.metadata?.purchasePrice ?? payload.metadata?.saleAmountCents;
  const saleAmount = rawPrice != null ? Math.round(parseFloat(String(rawPrice)) * 100) : 0;

  if (saleAmount <= 0) {
    return { action: "no_sale_amount", reason: "No purchasePrice in metadata or amount is zero" };
  }

  const commissionResults: Record<string, unknown>[] = [];

  for (const grant of newGrants) {
    const [rate] = await db
      .select({
        ratePercent: commissionRatesTable.ratePercent,
        flatBonus: commissionRatesTable.flatBonus,
      })
      .from(commissionRatesTable)
      .where(
        and(
          eq(commissionRatesTable.tier, affiliate.tier),
          eq(commissionRatesTable.productId, grant.productId),
        ),
      )
      .limit(1);

    if (!rate) {
      commissionResults.push({
        productSlug: grant.productSlug,
        action: "no_rate",
        reason: `No commission rate for tier ${affiliate.tier} on product ${grant.productSlug}`,
      });
      continue;
    }

    const ratePercent = parseFloat(rate.ratePercent);
    const commissionAmount = Math.round(saleAmount * (ratePercent / 100)) + (rate.flatBonus || 0);

    const [commission] = await db
      .insert(commissionsTable)
      .values({
        affiliateId: affiliate.id,
        productId: grant.productId,
        orderId: payload.externalOrderId,
        customerEmail: buyerUser?.email ?? "unknown",
        saleAmount,
        commissionRate: rate.ratePercent,
        commissionAmount,
        flatBonus: rate.flatBonus || 0,
        status: "pending",
        tier: affiliate.tier,
        fraudFlag,
      })
      .returning();

    await db
      .update(affiliateProfilesTable)
      .set({
        pendingBalance: sql`pending_balance + ${commissionAmount}`,
        totalEarnings: sql`total_earnings + ${commissionAmount}`,
        lifetimeConversions: sql`lifetime_conversions + 1`,
      })
      .where(eq(affiliateProfilesTable.id, affiliate.id));

    await db
      .update(referralLinksTable)
      .set({ conversionCount: sql`conversion_count + 1` })
      .where(
        and(
          eq(referralLinksTable.affiliateId, affiliate.id),
          eq(referralLinksTable.productId, grant.productId),
        ),
      );

    if (fraudFlag) {
      await db
        .update(affiliateProfilesTable)
        .set({
          fraudFlag: true,
          fraudReason: sql`coalesce(fraud_reason || '; ', '') || ${fraudFlag}`,
        })
        .where(eq(affiliateProfilesTable.id, affiliate.id));
    }

    console.log(
      `[ExternalGrant] Commission created: $${(commissionAmount / 100).toFixed(2)} for affiliate ${affiliateCode} on order ${payload.externalOrderId}`,
    );

    emitWebhookEvent("commission.earned", {
      commission_id: commission.id,
      affiliate_id: affiliate.id,
      affiliate_code: affiliateCode,
      product_id: grant.productId,
      order_id: payload.externalOrderId,
      sale_amount: saleAmount,
      commission_amount: commissionAmount,
      rate_percent: ratePercent,
      fraud_flag: fraudFlag,
    }).catch(() => {});

    commissionResults.push({
      productSlug: grant.productSlug,
      action: "commission_created",
      commissionId: commission.id,
      affiliateCode,
      affiliateId: affiliate.id,
      commissionAmount,
      ratePercent,
      fraudFlag,
    });
  }

  return { action: "attributed", commissions: commissionResults };
}
