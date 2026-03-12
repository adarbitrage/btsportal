import crypto from "crypto";
import { db, webhookLogsTable, productsTable, userProductsTable, usersTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { queueGHLSync } from "./ghl-queue";

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
  console.log(`[STUB:Email] Would send welcome email to ${email} with temporary password`);

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
  console.log(`[STUB:SMS] Would send SMS notification for purchase to ${email}`);

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

  return {
    action: "granted",
    userId,
    productId: product.id,
    productName: product.name,
    isNewUser: isNew,
    expiresAt: expiresAt?.toISOString() || null,
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

  if (updated.length === 0 && orderId) {
    const fallback = await db.update(userProductsTable)
      .set({ status: "refunded" })
      .where(and(
        eq(userProductsTable.userId, user.id),
        eq(userProductsTable.productId, product.id),
        eq(userProductsTable.status, "active")
      ))
      .returning();
    if (fallback.length > 0) {
      console.log(`[Webhook] Refunded product "${product.name}" for user ${email} (fallback match)`);
    }
    return {
      action: "refunded",
      userId: user.id,
      productId: product.id,
      productName: product.name,
      recordsUpdated: fallback.length,
    };
  }

  console.log(`[Webhook] Refunded product "${product.name}" for user ${email}`);

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

  return {
    action: "refunded",
    userId: user.id,
    productId: product.id,
    productName: product.name,
    recordsUpdated: updated.length,
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
  console.log(`[STUB:Email] Would send payment failed notification to ${email}`);
  console.log(`[STUB:SMS] Would send payment failed SMS to ${email}`);

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
  console.log(`[STUB:Email] Would send payment recovered confirmation to ${email}`);

  return {
    action: "recovered",
    userId: user.id,
    productId: product.id,
    productName: product.name,
    recordsUpdated: updated.length,
  };
}
