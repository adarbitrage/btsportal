import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import {
  db,
  usersTable,
  productsTable,
  assistantCardGroupsTable,
  assistantCardsTable,
  assistantCardQuestionsTable,
} from "@workspace/db";
import { inArray } from "drizzle-orm";

vi.mock("../lib/redis", () => ({
  getRedis: () => null,
  isRedisConnected: async () => false,
  getRedisConnection: vi.fn(),
  createRedisConnection: vi.fn(),
}));

import { buildTestAppWithRouters } from "./test-app";
import assistantCardsRouter from "../routes/assistant-cards";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const TEST_TAG = `assistant-cards-zero-filter-${randomUUID().slice(0, 8)}`;

const seededUserIds: number[] = [];
const seededProductIds: number[] = [];
const seededGroupIds: number[] = [];
const seededCardIds: number[] = [];
const seededQuestionIds: number[] = [];

let app: ReturnType<typeof buildTestAppWithRouters>;
let memberCookie: string;

// Card IDs we will assert behavior for.
let cardWithQuestionsId: number;
let cardWithOnlyInactiveQuestionsId: number;
let cardWithNoQuestionsId: number;
let cardInEmptyOnlyGroupId: number;
let populatedGroupId: number;
let emptyOnlyGroupId: number;

function signCookie(userId: number, email: string): string {
  const token = jwt.sign({ userId, email }, JWT_SECRET, { expiresIn: "1h" });
  return `access_token=${token}`;
}

async function insertMember(): Promise<{ id: number; email: string }> {
  const email = `${TEST_TAG}-member@example.test`;
  const passwordHash = await bcrypt.hash("irrelevant-test-password", 4);
  const [row] = await db
    .insert(usersTable)
    .values({
      email,
      name: `Test Member ${TEST_TAG}`,
      passwordHash,
      role: "member",
      sourceProduct: "lifetime",
      emailVerified: true,
      onboardingComplete: true,
    })
    .returning({ id: usersTable.id });
  seededUserIds.push(row.id);
  return { id: row.id, email };
}

beforeAll(async () => {
  app = buildTestAppWithRouters([assistantCardsRouter]);

  const member = await insertMember();
  memberCookie = signCookie(member.id, member.email);

  // Two groups: one will end up with at least one visible card, one will end
  // up empty because the only card it contains has zero active questions.
  const [populatedGroup] = await db
    .insert(assistantCardGroupsTable)
    .values({
      name: `${TEST_TAG}-populated-group`,
      sortOrder: 9001,
      isActive: true,
    })
    .returning({ id: assistantCardGroupsTable.id });
  populatedGroupId = populatedGroup.id;
  seededGroupIds.push(populatedGroup.id);

  const [emptyOnlyGroup] = await db
    .insert(assistantCardGroupsTable)
    .values({
      name: `${TEST_TAG}-empty-only-group`,
      sortOrder: 9002,
      isActive: true,
    })
    .returning({ id: assistantCardGroupsTable.id });
  emptyOnlyGroupId = emptyOnlyGroup.id;
  seededGroupIds.push(emptyOnlyGroup.id);

  // Card with at least one active question — should appear.
  const [cardWithQuestions] = await db
    .insert(assistantCardsTable)
    .values({
      groupId: populatedGroupId,
      title: `${TEST_TAG}-card-with-questions`,
      sortOrder: 1,
      isActive: true,
    })
    .returning({ id: assistantCardsTable.id });
  cardWithQuestionsId = cardWithQuestions.id;
  seededCardIds.push(cardWithQuestions.id);

  // Card with only an inactive question — should be filtered (zero ACTIVE questions).
  const [cardWithOnlyInactiveQuestions] = await db
    .insert(assistantCardsTable)
    .values({
      groupId: populatedGroupId,
      title: `${TEST_TAG}-card-inactive-only`,
      sortOrder: 2,
      isActive: true,
    })
    .returning({ id: assistantCardsTable.id });
  cardWithOnlyInactiveQuestionsId = cardWithOnlyInactiveQuestions.id;
  seededCardIds.push(cardWithOnlyInactiveQuestions.id);

  // Card with no questions at all — should be filtered.
  const [cardWithNoQuestions] = await db
    .insert(assistantCardsTable)
    .values({
      groupId: populatedGroupId,
      title: `${TEST_TAG}-card-no-questions`,
      sortOrder: 3,
      isActive: true,
    })
    .returning({ id: assistantCardsTable.id });
  cardWithNoQuestionsId = cardWithNoQuestions.id;
  seededCardIds.push(cardWithNoQuestions.id);

  // Card inside the second group, with zero questions — whole group should drop.
  const [cardInEmptyOnlyGroup] = await db
    .insert(assistantCardsTable)
    .values({
      groupId: emptyOnlyGroupId,
      title: `${TEST_TAG}-card-empty-group`,
      sortOrder: 1,
      isActive: true,
    })
    .returning({ id: assistantCardsTable.id });
  cardInEmptyOnlyGroupId = cardInEmptyOnlyGroup.id;
  seededCardIds.push(cardInEmptyOnlyGroup.id);

  // Questions:
  // - one active question on cardWithQuestionsId
  // - one inactive question on cardWithOnlyInactiveQuestionsId
  // (No questions on the other two cards.)
  const [activeQ] = await db
    .insert(assistantCardQuestionsTable)
    .values({
      cardId: cardWithQuestionsId,
      body: `${TEST_TAG}-active-question`,
      sortOrder: 1,
      isActive: true,
    })
    .returning({ id: assistantCardQuestionsTable.id });
  seededQuestionIds.push(activeQ.id);

  const [inactiveQ] = await db
    .insert(assistantCardQuestionsTable)
    .values({
      cardId: cardWithOnlyInactiveQuestionsId,
      body: `${TEST_TAG}-inactive-question`,
      sortOrder: 1,
      isActive: false,
    })
    .returning({ id: assistantCardQuestionsTable.id });
  seededQuestionIds.push(inactiveQ.id);
});

afterAll(async () => {
  if (seededQuestionIds.length > 0) {
    await db
      .delete(assistantCardQuestionsTable)
      .where(inArray(assistantCardQuestionsTable.id, seededQuestionIds));
  }
  if (seededCardIds.length > 0) {
    await db
      .delete(assistantCardsTable)
      .where(inArray(assistantCardsTable.id, seededCardIds));
  }
  if (seededGroupIds.length > 0) {
    await db
      .delete(assistantCardGroupsTable)
      .where(inArray(assistantCardGroupsTable.id, seededGroupIds));
  }
  if (seededProductIds.length > 0) {
    await db
      .delete(productsTable)
      .where(inArray(productsTable.id, seededProductIds));
  }
  if (seededUserIds.length > 0) {
    await db
      .delete(usersTable)
      .where(inArray(usersTable.id, seededUserIds));
  }
});

describe("GET /api/assistant/cards zero-question filter", () => {
  it("hides cards with zero active questions and drops groups that become empty", async () => {
    const res = await request(app)
      .get("/api/assistant/cards")
      .set("Cookie", memberCookie);

    expect(res.status).toBe(200);
    const groups = res.body.groups as Array<{
      id: number;
      cards: Array<{ id: number; locked: boolean; questions: Array<{ id: number }> }>;
    }>;
    expect(Array.isArray(groups)).toBe(true);

    const populated = groups.find((g) => g.id === populatedGroupId);
    expect(populated, "populated group should be present").toBeDefined();

    const cardIds = populated!.cards.map((c) => c.id);
    expect(cardIds).toContain(cardWithQuestionsId);
    expect(cardIds).not.toContain(cardWithNoQuestionsId);
    expect(cardIds).not.toContain(cardWithOnlyInactiveQuestionsId);

    const emptyOnly = groups.find((g) => g.id === emptyOnlyGroupId);
    expect(
      emptyOnly,
      "group whose only card has zero active questions must be omitted entirely",
    ).toBeUndefined();

    // Defense-in-depth: no group in the response should be returned with an
    // empty cards array. (We do NOT assert questions.length > 0 on every
    // returned card, because locked cards intentionally come back with an
    // empty questions array even when their underlying card has questions.)
    for (const g of groups) {
      expect(g.cards.length).toBeGreaterThan(0);
    }

    // Sanity: the seeded card that should be visible is unlocked and carries
    // its active question. The filter operates before the lock projection,
    // so an unlocked card in the response should always have >= 1 question.
    const visibleCard = populated!.cards.find((c) => c.id === cardWithQuestionsId)!;
    expect(visibleCard.locked).toBe(false);
    expect(visibleCard.questions.length).toBe(1);

    // Reference unused vars to keep TS happy if logic changes.
    void cardInEmptyOnlyGroupId;
  });
});
