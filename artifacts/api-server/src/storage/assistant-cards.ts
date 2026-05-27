import {
  db,
  assistantCardGroupsTable,
  assistantCardsTable,
  assistantCardQuestionsTable,
  productsTable,
} from "@workspace/db";
import { eq, asc, sql } from "drizzle-orm";

export interface AssistantQuestionRow {
  id: number;
  cardId: number;
  body: string;
  sortOrder: number;
  isActive: boolean;
}

export interface AssistantCardRow {
  id: number;
  groupId: number;
  title: string;
  description: string | null;
  icon: string | null;
  entitlementKey: string | null;
  upgradeProductId: number | null;
  sortOrder: number;
  isActive: boolean;
  upgradeProduct: { id: number; name: string; priceDisplay: string | null } | null;
  questions: AssistantQuestionRow[];
}

export interface AssistantGroupRow {
  id: number;
  name: string;
  description: string | null;
  icon: string | null;
  sortOrder: number;
  isActive: boolean;
  cards: AssistantCardRow[];
}

export async function loadFullTree(activeOnly: boolean): Promise<AssistantGroupRow[]> {
  const groups = await db
    .select()
    .from(assistantCardGroupsTable)
    .where(activeOnly ? eq(assistantCardGroupsTable.isActive, true) : sql`1=1`)
    .orderBy(asc(assistantCardGroupsTable.sortOrder));

  if (groups.length === 0) return [];

  const cards = await db
    .select({
      id: assistantCardsTable.id,
      groupId: assistantCardsTable.groupId,
      title: assistantCardsTable.title,
      description: assistantCardsTable.description,
      icon: assistantCardsTable.icon,
      entitlementKey: assistantCardsTable.entitlementKey,
      upgradeProductId: assistantCardsTable.upgradeProductId,
      sortOrder: assistantCardsTable.sortOrder,
      isActive: assistantCardsTable.isActive,
      upgradeProductName: productsTable.name,
      upgradeProductPriceDisplay: productsTable.priceDisplay,
    })
    .from(assistantCardsTable)
    .leftJoin(productsTable, eq(assistantCardsTable.upgradeProductId, productsTable.id))
    .where(activeOnly ? eq(assistantCardsTable.isActive, true) : sql`1=1`)
    .orderBy(asc(assistantCardsTable.sortOrder));

  const questions = await db
    .select()
    .from(assistantCardQuestionsTable)
    .where(activeOnly ? eq(assistantCardQuestionsTable.isActive, true) : sql`1=1`)
    .orderBy(asc(assistantCardQuestionsTable.sortOrder));

  const questionsByCard = new Map<number, AssistantQuestionRow[]>();
  for (const q of questions) {
    const existing = questionsByCard.get(q.cardId) ?? [];
    existing.push({
      id: q.id,
      cardId: q.cardId,
      body: q.body,
      sortOrder: q.sortOrder,
      isActive: q.isActive,
    });
    questionsByCard.set(q.cardId, existing);
  }

  const cardsByGroup = new Map<number, AssistantCardRow[]>();
  for (const c of cards) {
    const existing = cardsByGroup.get(c.groupId) ?? [];
    existing.push({
      id: c.id,
      groupId: c.groupId,
      title: c.title,
      description: c.description,
      icon: c.icon,
      entitlementKey: c.entitlementKey,
      upgradeProductId: c.upgradeProductId,
      sortOrder: c.sortOrder,
      isActive: c.isActive,
      upgradeProduct: c.upgradeProductId
        ? { id: c.upgradeProductId, name: c.upgradeProductName ?? "", priceDisplay: c.upgradeProductPriceDisplay ?? null }
        : null,
      questions: questionsByCard.get(c.id) ?? [],
    });
    cardsByGroup.set(c.groupId, existing);
  }

  return groups.map((g) => ({
    id: g.id,
    name: g.name,
    description: g.description,
    icon: g.icon,
    sortOrder: g.sortOrder,
    isActive: g.isActive,
    cards: cardsByGroup.get(g.id) ?? [],
  }));
}

export async function reorderGroups(orderedIds: number[]): Promise<void> {
  await db.transaction(async (tx) => {
    for (let i = 0; i < orderedIds.length; i++) {
      await tx
        .update(assistantCardGroupsTable)
        .set({ sortOrder: i })
        .where(eq(assistantCardGroupsTable.id, orderedIds[i]));
    }
  });
}

export async function reorderCards(orderedIds: number[]): Promise<void> {
  await db.transaction(async (tx) => {
    for (let i = 0; i < orderedIds.length; i++) {
      await tx
        .update(assistantCardsTable)
        .set({ sortOrder: i })
        .where(eq(assistantCardsTable.id, orderedIds[i]));
    }
  });
}

export async function reorderQuestions(orderedIds: number[]): Promise<void> {
  await db.transaction(async (tx) => {
    for (let i = 0; i < orderedIds.length; i++) {
      await tx
        .update(assistantCardQuestionsTable)
        .set({ sortOrder: i })
        .where(eq(assistantCardQuestionsTable.id, orderedIds[i]));
    }
  });
}
