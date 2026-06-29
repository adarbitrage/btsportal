import { db, paymentMethodsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";

export interface SavedCardDisplay {
  id: number;
  last4: string;
  brand: string;
  expMonth: number;
  expYear: number;
  isDefault: boolean;
  createdAt: Date;
}

export interface InsertPaymentMethodInput {
  userId: number;
  vaultId: string;
  last4: string;
  brand: string;
  expMonth: number;
  expYear: number;
}

function toDisplay(row: typeof paymentMethodsTable.$inferSelect): SavedCardDisplay {
  return {
    id: row.id,
    last4: row.last4,
    brand: row.brand,
    expMonth: row.expMonth,
    expYear: row.expYear,
    isDefault: row.isDefault,
    createdAt: row.createdAt,
  };
}

export async function insertPaymentMethod(
  input: InsertPaymentMethodInput,
): Promise<SavedCardDisplay> {
  return await db.transaction(async (tx) => {
    const existing = await tx
      .select({ id: paymentMethodsTable.id })
      .from(paymentMethodsTable)
      .where(eq(paymentMethodsTable.userId, input.userId))
      .limit(1);

    const isFirst = existing.length === 0;

    if (isFirst) {
      const [row] = await tx
        .insert(paymentMethodsTable)
        .values({
          userId: input.userId,
          vaultId: input.vaultId,
          last4: input.last4,
          brand: input.brand,
          expMonth: input.expMonth,
          expYear: input.expYear,
          isDefault: true,
        })
        .returning();
      return toDisplay(row);
    }

    const [row] = await tx
      .insert(paymentMethodsTable)
      .values({
        userId: input.userId,
        vaultId: input.vaultId,
        last4: input.last4,
        brand: input.brand,
        expMonth: input.expMonth,
        expYear: input.expYear,
        isDefault: false,
      })
      .returning();
    return toDisplay(row);
  });
}

export async function listPaymentMethods(userId: number): Promise<SavedCardDisplay[]> {
  const rows = await db
    .select()
    .from(paymentMethodsTable)
    .where(eq(paymentMethodsTable.userId, userId));
  return rows.map(toDisplay);
}

export async function getPaymentMethodForUser(
  id: number,
  userId: number,
): Promise<(typeof paymentMethodsTable.$inferSelect) | null> {
  const [row] = await db
    .select()
    .from(paymentMethodsTable)
    .where(and(eq(paymentMethodsTable.id, id), eq(paymentMethodsTable.userId, userId)))
    .limit(1);
  return row ?? null;
}

export async function setDefaultPaymentMethod(
  id: number,
  userId: number,
): Promise<boolean> {
  return await db.transaction(async (tx) => {
    const [target] = await tx
      .select({ id: paymentMethodsTable.id })
      .from(paymentMethodsTable)
      .where(and(eq(paymentMethodsTable.id, id), eq(paymentMethodsTable.userId, userId)))
      .limit(1);

    if (!target) return false;

    await tx
      .update(paymentMethodsTable)
      .set({ isDefault: false, updatedAt: new Date() })
      .where(eq(paymentMethodsTable.userId, userId));

    await tx
      .update(paymentMethodsTable)
      .set({ isDefault: true, updatedAt: new Date() })
      .where(and(eq(paymentMethodsTable.id, id), eq(paymentMethodsTable.userId, userId)));

    return true;
  });
}

export async function deletePaymentMethodRow(id: number, userId: number): Promise<boolean> {
  const result = await db
    .delete(paymentMethodsTable)
    .where(and(eq(paymentMethodsTable.id, id), eq(paymentMethodsTable.userId, userId)))
    .returning({ id: paymentMethodsTable.id });
  return result.length > 0;
}
