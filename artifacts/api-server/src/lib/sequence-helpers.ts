import { db, sequencesTable, sequenceEnrollmentsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";

export async function enrollInSequence(
  userId: number,
  sequenceSlug: string,
  metadata?: Record<string, unknown>
): Promise<{ enrolled: boolean; enrollmentId?: number; reason?: string }> {
  const [sequence] = await db
    .select()
    .from(sequencesTable)
    .where(and(eq(sequencesTable.slug, sequenceSlug), eq(sequencesTable.active, true)))
    .limit(1);

  if (!sequence) {
    console.log(`[Sequence] Sequence "${sequenceSlug}" not found or inactive`);
    return { enrolled: false, reason: "Sequence not found or inactive" };
  }

  const [existing] = await db
    .select({ id: sequenceEnrollmentsTable.id })
    .from(sequenceEnrollmentsTable)
    .where(
      and(
        eq(sequenceEnrollmentsTable.userId, userId),
        eq(sequenceEnrollmentsTable.sequenceId, sequence.id),
        eq(sequenceEnrollmentsTable.status, "active")
      )
    )
    .limit(1);

  if (existing) {
    console.log(`[Sequence] User ${userId} already enrolled in "${sequenceSlug}"`);
    return { enrolled: false, reason: "Already enrolled" };
  }

  const [enrollment] = await db
    .insert(sequenceEnrollmentsTable)
    .values({
      userId,
      sequenceId: sequence.id,
      status: "active",
      currentStepOrder: 0,
      metadata: metadata || {},
    })
    .returning();

  console.log(`[Sequence] Enrolled user ${userId} in "${sequenceSlug}" (enrollment ${enrollment.id})`);
  return { enrolled: true, enrollmentId: enrollment.id };
}

export async function cancelSequence(
  userId: number,
  sequenceSlug: string
): Promise<{ cancelled: boolean; reason?: string }> {
  const [sequence] = await db
    .select({ id: sequencesTable.id })
    .from(sequencesTable)
    .where(eq(sequencesTable.slug, sequenceSlug))
    .limit(1);

  if (!sequence) {
    return { cancelled: false, reason: "Sequence not found" };
  }

  const updated = await db
    .update(sequenceEnrollmentsTable)
    .set({ status: "cancelled", cancelledAt: new Date() })
    .where(
      and(
        eq(sequenceEnrollmentsTable.userId, userId),
        eq(sequenceEnrollmentsTable.sequenceId, sequence.id),
        eq(sequenceEnrollmentsTable.status, "active")
      )
    )
    .returning();

  if (updated.length === 0) {
    return { cancelled: false, reason: "No active enrollment found" };
  }

  console.log(`[Sequence] Cancelled user ${userId} from "${sequenceSlug}"`);
  return { cancelled: true };
}

export async function cancelAllSequencesForUser(userId: number): Promise<number> {
  const updated = await db
    .update(sequenceEnrollmentsTable)
    .set({ status: "cancelled", cancelledAt: new Date() })
    .where(
      and(
        eq(sequenceEnrollmentsTable.userId, userId),
        eq(sequenceEnrollmentsTable.status, "active")
      )
    )
    .returning();

  if (updated.length > 0) {
    console.log(`[Sequence] Cancelled ${updated.length} active enrollments for user ${userId}`);
  }
  return updated.length;
}
