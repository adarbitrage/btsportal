import crypto from "crypto";
import { db, webhookLogsTable, productsTable, userProductsTable, usersTable, affiliateProfilesTable, commissionsTable, commissionRatesTable, referralLinksTable } from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import { queueGHLSync } from "./ghl-queue";
import { CommunicationService } from "./communication-service";
import { ensureAffiliateProfile, resolveUserCommissionTier } from "./commissions";

const THRIVECART_WEBHOOK_SECRET = process.env.THRIVECART_WEBHOOK_SECRET || "";

export function verifySignature(rawBody: string, signature: string): boolean {
  if (!THRIVECART_WEBHOOK_SECRET) return false;
  if (!signature) return false;
  const expected = crypto
    .createHmac("sha256", THRIVECART_WEBHOOK_SECRET)
    .update(rawBody)
    .digest("hex");
  if (expected.length !== signature.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(signature, "hex"));
  } catch {
    return false;
  }
}

interface ThrivecartPayload {
  event: string;
  thrivecart_account?: string;
  order?: {
    id?: string;
    invoice_id?: string;
    customer?: {
      email?: string;
      name?: string;
      first_name?: string;
      last_name?: string;
    };
    item?: {
      id?: string;
      name?: string;
    };
    subscription?: {
      id?: string;
    };
  };
  customer?: {
    email?: string;
    name?: string;
    first_name?: string;
    last_name?: string;
  };
  [key: string]: unknown;
}

function extractPayload(body: Record<string, unknown>): ThrivecartPayload {
  if (body.thrivecart) {
    return body.thrivecart as ThrivecartPayload;
  }
  return body as unknown as ThrivecartPayload;
}

function deepGet(obj: Record<string, unknown>, path: string): string {
  const parts = path.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (current == null || typeof current !== "object") return "";
    current = (current as Record<string, unknown>)[part];
  }
  return current != null ? String(current) : "";
}

function flatGet(body: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const val = body[key];
    if (val != null && val !== "") return String(val);
  }
  return "";
}

function getExternalId(payload: ThrivecartPayload, body: Record<string, unknown>): string {
  const orderId = getOrderId(payload, body);
  const event = payload.event || flatGet(body, ["event"]) || "unknown";
  if (!orderId) {
    return `${event}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }
  return `${event}_${orderId}`;
}

function getCustomerInfo(payload: ThrivecartPayload, body: Record<string, unknown>): { email: string; name: string } {
  const customer = payload.order?.customer || payload.customer;
  let email = customer?.email || "";
  let name = customer?.name ||
    [customer?.first_name, customer?.last_name].filter(Boolean).join(" ") ||
    "";

  if (!email) {
    email = flatGet(body, ["customer[email]", "customer_email"]) ||
      deepGet(body, "customer.email") ||
      deepGet(body, "order.customer.email");
  }
  if (!name) {
    const first = flatGet(body, ["customer[first_name]", "customer_first_name"]) || deepGet(body, "customer.first_name");
    const last = flatGet(body, ["customer[last_name]", "customer_last_name"]) || deepGet(body, "customer.last_name");
    name = [first, last].filter(Boolean).join(" ") ||
      flatGet(body, ["customer[name]", "customer_name"]) ||
      deepGet(body, "customer.name") ||
      "Unknown";
  }

  return { email: email.toLowerCase().trim(), name: name || "Unknown" };
}

function getProductId(payload: ThrivecartPayload, body: Record<string, unknown>): string {
  return payload.order?.item?.id ||
    flatGet(body, ["thpidr", "base_product_id", "order[item][id]"]) ||
    deepGet(body, "order.item.id") ||
    "";
}

function getOrderId(payload: ThrivecartPayload, body: Record<string, unknown>): string {
  return payload.order?.id?.toString() ||
    payload.order?.invoice_id ||
    flatGet(body, ["order[id]", "order_id", "invoice_id"]) ||
    deepGet(body, "order.id") ||
    "";
}

function getSubscriptionId(payload: ThrivecartPayload, body: Record<string, unknown>): string {
  return payload.order?.subscription?.id ||
    flatGet(body, ["order[subscription][id]", "subscription_id"]) ||
    deepGet(body, "order.subscription.id") ||
    "";
}

export async function processWebhookEvent(body: Record<string, unknown>, skipSignature = false): Promise<{ success: boolean; message: string }> {
  const payload = extractPayload(body);
  const eventType = payload.event || flatGet(body, ["event"]) || "unknown";
  const externalId = getExternalId(payload, body);

  const existing = await db
    .select({ id: webhookLogsTable.id })
    .from(webhookLogsTable)
    .where(eq(webhookLogsTable.externalId, externalId))
    .limit(1);

  if (existing.length > 0) {
    return { success: true, message: "Duplicate event, already processed" };
  }

  const [logEntry] = await db.insert(webhookLogsTable).values({
    externalId,
    eventType,
    status: "processing",
    payload: body,
  }).returning();

  try {
    let result: Record<string, unknown>;

    switch (eventType) {
      case "order.success":
        result = await handleOrderSuccess(payload, body);
        break;
      case "order.refund":
        result = await handleOrderRefund(payload, body);
        break;
      case "order.subscription_cancelled":
        result = await handleSubscriptionCancelled(payload, body);
        break;
      case "order.subscription_payment_failed":
        result = await handlePaymentFailed(payload, body);
        break;
      case "order.subscription_payment_recovered":
        result = await handlePaymentRecovered(payload, body);
        break;
      default:
        result = { action: "ignored", reason: `Unknown event type: ${eventType}` };
    }

    await db.update(webhookLogsTable)
      .set({ status: "processed", result, processedAt: new Date() })
      .where(eq(webhookLogsTable.id, logEntry.id));

    return { success: true, message: `Event ${eventType} processed successfully` };
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    await db.update(webhookLogsTable)
      .set({ status: "error", errorMessage, processedAt: new Date() })
      .where(eq(webhookLogsTable.id, logEntry.id));

    console.error(`[Webhook] Error processing ${eventType}:`, errorMessage);
    return { success: false, message: errorMessage };
  }
}

async function findOrCreateUser(email: string, name: string): Promise<{ id: number; isNew: boolean }> {
  const [existingUser] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.email, email))
    .limit(1);

  if (existingUser) {
    return { id: existingUser.id, isNew: false };
  }

  const crypto = await import("crypto");
  const tempPassword = crypto.randomBytes(16).toString("hex");
  const bcrypt = await import("bcryptjs");
  const passwordHash = await bcrypt.hash(tempPassword, 10);

  const [newUser] = await db.insert(usersTable).values({
    name,
    email,
    passwordHash,
    sourceProduct: "thrivecart",
  }).returning();

  console.log(`[Webhook] Created new user: ${email} (temp password generated)`);
  CommunicationService.queueEmail({
    templateSlug: "welcome",
    to: email,
    variables: { member_name: name, temp_password: tempPassword },
    userId: newUser.id,
  });

  await queueGHLSync({
    action: "create_contact",
    userId: newUser.id,
    email,
    name,
    tags: ["new_member", "thrivecart_signup"],
    customFields: {
      portal_member_since: new Date().toISOString(),
      source: "thrivecart",
    },
  });

  return { id: newUser.id, isNew: true };
}

async function findProductByThrivecartId(thrivecartProductId: string) {
  const [product] = await db
    .select()
    .from(productsTable)
    .where(eq(productsTable.thrivecartProductId, thrivecartProductId))
    .limit(1);
  return product || null;
}

async function handleOrderSuccess(payload: ThrivecartPayload, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { email, name } = getCustomerInfo(payload, body);
  if (!email) throw new Error("No customer email in payload");

  const thrivecartProductId = getProductId(payload, body);
  if (!thrivecartProductId) throw new Error("No product ID in payload");

  const product = await findProductByThrivecartId(thrivecartProductId);
  if (!product) throw new Error(`No product mapped to ThriveCart ID: ${thrivecartProductId}`);

  const { id: userId, isNew } = await findOrCreateUser(email, name);

  const orderId = getOrderId(payload, body);
  const subscriptionId = getSubscriptionId(payload, body);

  const existingEntitlement = await db
    .select({ id: userProductsTable.id })
    .from(userProductsTable)
    .where(and(
      eq(userProductsTable.userId, userId),
      eq(userProductsTable.productId, product.id),
      eq(userProductsTable.status, "active")
    ))
    .limit(1);

  if (existingEntitlement.length > 0) {
    return { action: "skipped", reason: "User already has active entitlement for this product", userId, productId: product.id };
  }

  let expiresAt: Date | null = null;
  if (product.durationDays) {
    expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + product.durationDays);
  }

  await db.insert(userProductsTable).values({
    userId,
    productId: product.id,
    status: "active",
    thrivecartOrderId: orderId || null,
    thrivecartSubId: subscriptionId || null,
    expiresAt,
  });

  console.log(`[Webhook] Granted product "${product.name}" to user ${email}`);
  CommunicationService.queueEmail({
    templateSlug: "purchase_confirmation",
    to: email,
    variables: { member_name: name, product_name: product.name },
    userId,
  });
  const [purchaseUser] = await db.select({ phone: usersTable.phone }).from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  if (purchaseUser?.phone) {
    CommunicationService.queueSms({
      templateSlug: "purchase_confirmation",
      to: purchaseUser.phone,
      variables: { member_name: name, product_name: product.name },
      userId,
    });
  }

    await queueGHLSync({
      action: "add_tags",
      userId,
      email,
      tags: [`product_${product.slug || product.name.toLowerCase().replace(/\s+/g, "_")}`, "active_customer"],
      customFields: {
        last_purchase: product.name,
        last_purchase_date: new Date().toISOString(),
      },
    });

    await queueGHLSync({
      action: "add_note",
      userId,
      email,
      noteBody: `Purchased ${product.name} via ThriveCart (Order: ${orderId || "N/A"})`,
    });

    await ensureAffiliateProfile(userId).catch(err => {
      console.error("[Webhook] Error ensuring affiliate profile:", err);
    });

    let commissionResult: Record<string, unknown> | null = null;
    try {
      commissionResult = await handleCommissionAttribution(payload, body, userId, product, orderId);
    } catch (err) {
      console.error("[Webhook] Commission attribution error:", err);
    }

  return {
    action: "granted",
    userId,
    productId: product.id,
    productName: product.name,
    isNewUser: isNew,
    expiresAt: expiresAt?.toISOString() || null,
    commission: commissionResult,
  };
}

async function handleOrderRefund(payload: ThrivecartPayload, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { email } = getCustomerInfo(payload, body);
  if (!email) throw new Error("No customer email in payload");

  const thrivecartProductId = getProductId(payload, body);
  if (!thrivecartProductId) throw new Error("No product ID in payload");

  const product = await findProductByThrivecartId(thrivecartProductId);
  if (!product) throw new Error(`No product mapped to ThriveCart ID: ${thrivecartProductId}`);

  const [user] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.email, email))
    .limit(1);

  if (!user) throw new Error(`No user found with email: ${email}`);

  const orderId = getOrderId(payload, body);
  const conditions = [
    eq(userProductsTable.userId, user.id),
    eq(userProductsTable.productId, product.id),
    eq(userProductsTable.status, "active"),
  ];
  if (orderId) {
    conditions.push(eq(userProductsTable.thrivecartOrderId, orderId));
  }

  const updated = await db.update(userProductsTable)
    .set({ status: "refunded" })
    .where(and(...conditions))
    .returning();

  let totalUpdated = updated.length;
  if (updated.length === 0 && orderId) {
    const fallback = await db.update(userProductsTable)
      .set({ status: "refunded" })
      .where(and(
        eq(userProductsTable.userId, user.id),
        eq(userProductsTable.productId, product.id),
        eq(userProductsTable.status, "active")
      ))
      .returning();
    totalUpdated = fallback.length;
    if (fallback.length > 0) {
      console.log(`[Webhook] Refunded product "${product.name}" for user ${email} (fallback match)`);
    }
  } else {
    console.log(`[Webhook] Refunded product "${product.name}" for user ${email}`);
  }

  CommunicationService.queueEmail({
    templateSlug: "refund_processed",
    to: email,
    variables: { member_name: email, product_name: product.name },
    userId: user.id,
  });
  await queueGHLSync({
    action: "add_tags",
    userId: user.id,
    email,
    tags: ["refunded", `refund_${product.slug || product.name.toLowerCase().replace(/\s+/g, "_")}`],
  });

  await queueGHLSync({
    action: "remove_tags",
    userId: user.id,
    email,
    removeTags: [`product_${product.slug || product.name.toLowerCase().replace(/\s+/g, "_")}`],
  });

  await queueGHLSync({
    action: "add_note",
    userId: user.id,
    email,
    noteBody: `Refunded: ${product.name}`,
  });

  let commissionsReversed = 0;
  try {
    if (orderId) {
      const toReverse = await db
        .select({ id: commissionsTable.id, status: commissionsTable.status, affiliateId: commissionsTable.affiliateId, commissionAmount: commissionsTable.commissionAmount })
        .from(commissionsTable)
        .where(and(
          eq(commissionsTable.orderId, orderId),
          sql`${commissionsTable.status} IN ('pending', 'approved')`
        ));

      for (const c of toReverse) {
        await db.update(commissionsTable)
          .set({ status: "reversed", reversalReason: "Order refunded", reversedAt: new Date() })
          .where(eq(commissionsTable.id, c.id));

        const balanceField = c.status === "pending" ? "pending_balance" : "approved_balance";
        await db.update(affiliateProfilesTable)
          .set({ [c.status === "pending" ? "pendingBalance" : "approvedBalance"]: sql`${sql.identifier(balanceField)} - ${c.commissionAmount}` })
          .where(eq(affiliateProfilesTable.id, c.affiliateId));
      }

      commissionsReversed = toReverse.length;
      if (commissionsReversed > 0) {
        console.log(`[Webhook] Reversed ${commissionsReversed} commission(s) for order ${orderId}`);
      }
    }
  } catch (err) {
    console.error("[Webhook] Commission reversal error:", err);
  }

  return {
    action: "refunded",
    userId: user.id,
    productId: product.id,
    productName: product.name,
    recordsUpdated: totalUpdated,
    commissionsReversed,
  };
}

async function handleSubscriptionCancelled(payload: ThrivecartPayload, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { email } = getCustomerInfo(payload, body);
  if (!email) throw new Error("No customer email in payload");

  const thrivecartProductId = getProductId(payload, body);
  if (!thrivecartProductId) throw new Error("No product ID in payload");

  const product = await findProductByThrivecartId(thrivecartProductId);
  if (!product) throw new Error(`No product mapped to ThriveCart ID: ${thrivecartProductId}`);

  const [user] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.email, email))
    .limit(1);

  if (!user) throw new Error(`No user found with email: ${email}`);

  const updated = await db.update(userProductsTable)
    .set({ status: "cancelled", cancelledAt: new Date() })
    .where(and(
      eq(userProductsTable.userId, user.id),
      eq(userProductsTable.productId, product.id),
      eq(userProductsTable.status, "active")
    ))
    .returning();

  console.log(`[Webhook] Cancelled subscription for "${product.name}" for user ${email} (access continues until expiry)`);
  CommunicationService.queueEmail({
    templateSlug: "subscription_cancelled",
    to: email,
    variables: { member_name: email, product_name: product.name },
    userId: user.id,
  });

  await queueGHLSync({
    action: "add_tags",
    userId: user.id,
    email,
    tags: ["cancelled", `cancel_${product.slug || product.name.toLowerCase().replace(/\s+/g, "_")}`],
  });

  await queueGHLSync({
    action: "add_note",
    userId: user.id,
    email,
    noteBody: `Subscription cancelled: ${product.name}. Access continues until expiry.`,
  });

  return {
    action: "cancelled",
    userId: user.id,
    productId: product.id,
    productName: product.name,
    recordsUpdated: updated.length,
    note: "Access continues until expires_at",
  };
}

async function handlePaymentFailed(payload: ThrivecartPayload, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { email } = getCustomerInfo(payload, body);
  if (!email) throw new Error("No customer email in payload");

  const thrivecartProductId = getProductId(payload, body);
  if (!thrivecartProductId) throw new Error("No product ID in payload");

  const product = await findProductByThrivecartId(thrivecartProductId);
  if (!product) throw new Error(`No product mapped to ThriveCart ID: ${thrivecartProductId}`);

  const [user] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.email, email))
    .limit(1);

  if (!user) throw new Error(`No user found with email: ${email}`);

  const graceExpiresAt = new Date();
  graceExpiresAt.setDate(graceExpiresAt.getDate() + 7);

  const updated = await db.update(userProductsTable)
    .set({ status: "past_due", graceExpiresAt })
    .where(and(
      eq(userProductsTable.userId, user.id),
      eq(userProductsTable.productId, product.id),
      eq(userProductsTable.status, "active")
    ))
    .returning();

  console.log(`[Webhook] Payment failed for "${product.name}" for user ${email}, grace period until ${graceExpiresAt.toISOString()}`);
  const [failedPaymentUser] = await db.select({ phone: usersTable.phone, name: usersTable.name }).from(usersTable).where(eq(usersTable.id, user.id)).limit(1);
  CommunicationService.queueEmail({
    templateSlug: "payment_failed",
    to: email,
    variables: { member_name: failedPaymentUser?.name || email, product_name: product.name, grace_date: graceExpiresAt.toLocaleDateString() },
    userId: user.id,
  });
  if (failedPaymentUser?.phone) {
    CommunicationService.queueSms({
      templateSlug: "payment_failed",
      to: failedPaymentUser.phone,
      variables: { product_name: product.name },
      userId: user.id,
    });
  }

  return {
    action: "past_due",
    userId: user.id,
    productId: product.id,
    productName: product.name,
    graceExpiresAt: graceExpiresAt.toISOString(),
    recordsUpdated: updated.length,
  };
}

async function handlePaymentRecovered(payload: ThrivecartPayload, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { email } = getCustomerInfo(payload, body);
  if (!email) throw new Error("No customer email in payload");

  const thrivecartProductId = getProductId(payload, body);
  if (!thrivecartProductId) throw new Error("No product ID in payload");

  const product = await findProductByThrivecartId(thrivecartProductId);
  if (!product) throw new Error(`No product mapped to ThriveCart ID: ${thrivecartProductId}`);

  const [user] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.email, email))
    .limit(1);

  if (!user) throw new Error(`No user found with email: ${email}`);

  const updated = await db.update(userProductsTable)
    .set({ status: "active", graceExpiresAt: null })
    .where(and(
      eq(userProductsTable.userId, user.id),
      eq(userProductsTable.productId, product.id),
      eq(userProductsTable.status, "past_due")
    ))
    .returning();

  console.log(`[Webhook] Payment recovered for "${product.name}" for user ${email}`);
  const [recoveredUser] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, user.id)).limit(1);
  CommunicationService.queueEmail({
    templateSlug: "payment_recovered",
    to: email,
    variables: { member_name: recoveredUser?.name || email, product_name: product.name },
    userId: user.id,
  });

  return {
    action: "recovered",
    userId: user.id,
    productId: product.id,
    productName: product.name,
    recordsUpdated: updated.length,
  };
}

interface ProductInfo {
  id: number;
  slug: string;
  name: string;
  thrivecartProductId: string | null;
  entitlementKeys: unknown;
  durationDays: number | null;
  priceDisplay: string | null;
  sortOrder: number;
  type: string;
}

async function handleCommissionAttribution(
  payload: ThrivecartPayload,
  body: Record<string, unknown>,
  buyerUserId: number,
  product: ProductInfo,
  orderId: string
): Promise<Record<string, unknown> | null> {
  const affiliateCode =
    flatGet(body, ["bts_ref", "custom_bts_ref", "thrivecart_custom_bts_ref"]) ||
    deepGet(body, "order.custom.bts_ref") ||
    deepGet(body, "custom.bts_ref") ||
    "";

  if (!affiliateCode) {
    return { action: "no_attribution", reason: "No affiliate code found" };
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
    if (buyerDomain === affiliateDomain && !["gmail.com", "yahoo.com", "outlook.com", "hotmail.com", "icloud.com", "aol.com"].includes(buyerDomain)) {
      fraudFlag = "same_domain_email";
    }
  }

  const [rate] = await db
    .select({
      ratePercent: commissionRatesTable.ratePercent,
      flatBonus: commissionRatesTable.flatBonus,
    })
    .from(commissionRatesTable)
    .where(and(
      eq(commissionRatesTable.tier, affiliate.tier),
      eq(commissionRatesTable.productId, product.id)
    ))
    .limit(1);

  if (!rate) {
    return { action: "no_rate", reason: `No commission rate for tier ${affiliate.tier} on product ${product.slug}` };
  }

  const saleAmountRaw = flatGet(body, ["order[total]", "total", "amount"]) || deepGet(body, "order.total");
  const saleAmount = Math.round(parseFloat(saleAmountRaw || "0") * 100);

  if (saleAmount <= 0) {
    return { action: "no_sale_amount", reason: "Could not determine sale amount" };
  }

  const ratePercent = parseFloat(rate.ratePercent);
  const commissionAmount = Math.round(saleAmount * (ratePercent / 100)) + (rate.flatBonus || 0);

  const [commission] = await db.insert(commissionsTable).values({
    affiliateId: affiliate.id,
    productId: product.id,
    orderId: orderId || `order_${Date.now()}`,
    customerEmail: buyerUser?.email || "unknown",
    saleAmount,
    commissionRate: rate.ratePercent,
    commissionAmount,
    flatBonus: rate.flatBonus || 0,
    status: "pending",
    tier: affiliate.tier,
    fraudFlag,
  }).returning();

  await db.update(affiliateProfilesTable)
    .set({
      pendingBalance: sql`pending_balance + ${commissionAmount}`,
      totalEarnings: sql`total_earnings + ${commissionAmount}`,
      lifetimeConversions: sql`lifetime_conversions + 1`,
    })
    .where(eq(affiliateProfilesTable.id, affiliate.id));

  await db.update(referralLinksTable)
    .set({ conversionCount: sql`conversion_count + 1` })
    .where(and(
      eq(referralLinksTable.affiliateId, affiliate.id),
      eq(referralLinksTable.productId, product.id)
    ));

  if (fraudFlag) {
    await db.update(affiliateProfilesTable)
      .set({ fraudFlag: true, fraudReason: sql`coalesce(fraud_reason || '; ', '') || ${fraudFlag}` })
      .where(eq(affiliateProfilesTable.id, affiliate.id));
  }

  console.log(`[Webhook] Commission created: $${(commissionAmount / 100).toFixed(2)} for affiliate ${affiliateCode} on order ${orderId}`);

  return {
    action: "commission_created",
    commissionId: commission.id,
    affiliateCode,
    affiliateId: affiliate.id,
    commissionAmount,
    ratePercent,
    fraudFlag,
  };
}
