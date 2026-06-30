import { db, btsOrdersTable, btsOrderItemsTable, productsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

export interface CreateOrderLineItem {
  productId: number | null;
  description?: string | null;
  unitPriceCents: number;
  quantity?: number;
}

export interface CreateOrderInput {
  orderNumber: string;
  userId: number | null;
  email: string;
  totalCents: number;
  currency?: string;
  orderType: "one_time" | "recurring_initial" | "recurring_renewal" | "wallet_topup";
  /**
   * Optional subscription this order belongs to. Set at insert time so even a
   * DECLINED recurring_renewal order carries its subscription_id (the initial
   * subscribe path leaves this undefined and links post-creation, because the
   * subscription row does not exist yet when the order is created).
   */
  subscriptionId?: number | null;
  metadata?: Record<string, unknown> | null;
  lineItems: CreateOrderLineItem[];
}

export interface OrderWithItems {
  id: number;
  orderNumber: string;
  userId: number | null;
  email: string;
  totalCents: number;
  currency: string;
  status: string;
  gatewayTransactionId: string | null;
  orderType: string;
  metadata: unknown;
  createdAt: Date;
  updatedAt: Date;
  items: {
    id: number;
    orderId: number;
    productId: number | null;
    description: string | null;
    unitPriceCents: number;
    quantity: number;
    entitlementKeysSnapshot: unknown;
    createdAt: Date;
  }[];
}

/**
 * Create a bts_order with one or more line items in a single transaction.
 * Entitlement keys are snapshotted from the products table at create time so
 * later product edits do not rewrite order history.
 */
export async function createOrder(input: CreateOrderInput): Promise<OrderWithItems> {
  return await db.transaction(async (tx) => {
    const [order] = await tx
      .insert(btsOrdersTable)
      .values({
        orderNumber: input.orderNumber,
        userId: input.userId,
        email: input.email,
        totalCents: input.totalCents,
        currency: input.currency ?? "USD",
        orderType: input.orderType,
        subscriptionId: input.subscriptionId ?? null,
        metadata: input.metadata ?? null,
        status: "pending",
      })
      .returning();

    const insertedItems = [];
    for (const li of input.lineItems) {
      let entitlementKeysSnapshot: unknown = null;
      if (li.productId != null) {
        const [product] = await tx
          .select({ entitlementKeys: productsTable.entitlementKeys })
          .from(productsTable)
          .where(eq(productsTable.id, li.productId))
          .limit(1);
        entitlementKeysSnapshot = product?.entitlementKeys ?? null;
      }

      const [item] = await tx
        .insert(btsOrderItemsTable)
        .values({
          orderId: order.id,
          productId: li.productId,
          description: li.description ?? null,
          unitPriceCents: li.unitPriceCents,
          quantity: li.quantity ?? 1,
          entitlementKeysSnapshot,
        })
        .returning();

      insertedItems.push(item);
    }

    return { ...order, items: insertedItems };
  });
}

export interface UpdateOrderStatusInput {
  status: string;
  gatewayTransactionId?: string | null;
  metadata?: Record<string, unknown> | null;
}

/**
 * Update the status (and optionally gatewayTransactionId / metadata) of an
 * existing order.  Used by the checkout service after a charge attempt
 * resolves (paid, failed, or partial-error).
 */
export async function updateOrderStatus(
  id: number,
  update: UpdateOrderStatusInput,
): Promise<void> {
  await db
    .update(btsOrdersTable)
    .set({
      status: update.status,
      updatedAt: new Date(),
      ...(update.gatewayTransactionId !== undefined
        ? { gatewayTransactionId: update.gatewayTransactionId }
        : {}),
      ...(update.metadata !== undefined ? { metadata: update.metadata } : {}),
    })
    .where(eq(btsOrdersTable.id, id));
}

/**
 * Fetch a single order (with its line items) by internal id.
 * Returns null if not found.
 */
export async function getOrderById(id: number): Promise<OrderWithItems | null> {
  const [order] = await db
    .select()
    .from(btsOrdersTable)
    .where(eq(btsOrdersTable.id, id))
    .limit(1);

  if (!order) return null;

  const items = await db
    .select()
    .from(btsOrderItemsTable)
    .where(eq(btsOrderItemsTable.orderId, id));

  return { ...order, items };
}

/**
 * Fetch a single order (with its line items) by human-readable order number.
 * Returns null if not found.
 */
export async function getOrderByNumber(orderNumber: string): Promise<OrderWithItems | null> {
  const [order] = await db
    .select()
    .from(btsOrdersTable)
    .where(eq(btsOrdersTable.orderNumber, orderNumber))
    .limit(1);

  if (!order) return null;

  const items = await db
    .select()
    .from(btsOrderItemsTable)
    .where(eq(btsOrderItemsTable.orderId, order.id));

  return { ...order, items };
}
