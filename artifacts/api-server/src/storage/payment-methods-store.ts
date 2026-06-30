import { db, paymentMethodsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";

export interface InsertPaymentMethodInput {
  userId: number;
  vaultId: string;
  last4: string;
  brand: string;
  expMonth: number;
  expYear: number;
}

export interface SavedCardDisplay {
  id: number;
  last4: string;
  brand: string;
  expMonth: number;
  expYear: number;
  isDefault: boolean;
  createdAt: Date;
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

function isPgUniqueViolation(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const e = err as { code?: string; cause?: { code?: string } };
  return e.code === "23505" || e.cause?.code === "23505";
}

export async function insertPaymentMethod(
  input: InsertPaymentMethodInput,
): Promise<SavedCardDisplay> {
  return await db.transaction(async (tx) => {
    // Lock all existing rows for this user to prevent concurrent races that
    // could produce two is_default = true rows before the DB index catches them.
    const existing = await tx
      .select({ id: paymentMethodsTable.id })
      .from(paymentMethodsTable)
      .where(eq(paymentMethodsTable.userId, input.userId))
      .for("update");

    const isFirst = existing.length === 0;

    try {
      const [row] = await tx
        .insert(paymentMethodsTable)
        .values({
          userId: input.userId,
          vaultId: input.vaultId,
          last4: input.last4,
          brand: input.brand,
          expMonth: input.expMonth,
          expYear: input.expYear,
          isDefault: isFirst,
        })
        .returning();
      return toDisplay(row);
    } catch (err) {
      if (isFirst && isPgUniqueViolation(err)) {
        // A concurrent insert already claimed the default slot; insert as non-default.
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
      }
      throw err;
    }
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
    // Lock ALL rows for this user so concurrent "set default" calls are serialized.
    // After acquiring the lock, we know no other transaction is mid-flight on these rows.
    const allRows = await tx
      .select({ id: paymentMethodsTable.id })
      .from(paymentMethodsTable)
      .where(eq(paymentMethodsTable.userId, userId))
      .for("update");

    const target = allRows.find((r) => r.id === id);
    if (!target) return false;

    // Clear every existing default for this user, then set the target.
    // Because we hold row-level locks, no concurrent transaction can observe
    // two simultaneous defaults.
    await tx
      .update(paymentMethodsTable)
      .set({ isDefault: false, updatedAt: new Date() })
      .where(eq(paymentMethodsTable.userId, userId));

    try {
      await tx
        .update(paymentMethodsTable)
        .set({ isDefault: true, updatedAt: new Date() })
        .where(and(eq(paymentMethodsTable.id, id), eq(paymentMethodsTable.userId, userId)));
    } catch (err) {
      if (isPgUniqueViolation(err)) {
        // Should not happen once locks are held, but handled defensively.
        throw new Error("CONCURRENT_DEFAULT_CONFLICT");
      }
      throw err;
    }

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
