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
import { eq, and, inArray, sql } from "drizzle-orm";
import { queueGHLSync } from "./ghl-queue";
import { CommunicationService } from "./communication-service";
import { ensureAffiliateProfile } from "./commissions";
import { emitWebhookEvent } from "./webhook-events";

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

    // Claim the processing slot before doing any grant work
    const [logEntry] = await tx
      .insert(webhookLogsTable)
      .values({
        externalId,
        eventType: "external.grant_product",
        status: "processing",
        payload: payload as unknown as Record<string, unknown>,
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
      const [newUser] = await tx
        .insert(usersTable)
        .values({
          email,
          name,
          passwordHash,
          phone: payload.customer.phone || null,
          sourceProduct: "yse",
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
      })
      .where(eq(webhookLogsTable.id, logEntry.id));

    return { cached: false, userId, userCreated, grants };
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
