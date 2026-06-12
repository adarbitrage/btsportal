import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import {
  db,
  usersTable,
  productsTable,
  userProductsTable,
  communityCategoriesTable,
  communityPostsTable,
  communityReactionsTable,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

vi.mock("../lib/moderation/engine", () => ({
  evaluate: vi.fn().mockResolvedValue({
    flagged: false,
    triggeredBy: "none",
    wordlistMatches: [],
    aiScores: { toxicity: 0, spam: 0, harassment: 0, hate_speech: 0 },
  }),
}));

import { buildTestAppWithRouters } from "./test-app";
import communityRouter from "../routes/community";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const TEST_TAG = `reactions-contract-${randomUUID().slice(0, 8)}`;

let app: ReturnType<typeof buildTestAppWithRouters>;

const seededUserIds: number[] = [];
const seededProductIds: number[] = [];
let categoryId: number;
let memberCookie: string;
let memberId: number;
let postId: number;

function signCookie(userId: number, email: string): string {
  const token = jwt.sign({ userId, email }, JWT_SECRET, { expiresIn: "1h" });
  return `access_token=${token}`;
}

beforeAll(async () => {
  app = buildTestAppWithRouters([communityRouter]);

  const [cat] = await db
    .insert(communityCategoriesTable)
    .values({
      name: `${TEST_TAG} Category`,
      slug: `${TEST_TAG}-cat`,
      description: "test",
      sortOrder: 1,
      isActive: true,
    })
    .returning({ id: communityCategoriesTable.id });
  categoryId = cat.id;

  const passwordHash = await bcrypt.hash("irrelevant", 4);
  const [member] = await db
    .insert(usersTable)
    .values({
      email: `${TEST_TAG}-member@example.test`,
      name: "Reaction Member",
      passwordHash,
      role: "member",
      sourceProduct: "lifetime",
      emailVerified: true,
      onboardingComplete: true,
    })
    .returning({ id: usersTable.id, email: usersTable.email });
  memberId = member.id;
  memberCookie = signCookie(member.id, member.email);
  seededUserIds.push(member.id);

  const [product] = await db
    .insert(productsTable)
    .values({
      slug: `${TEST_TAG}-prod`,
      name: `${TEST_TAG} community product`,
      type: "backend",
      entitlementKeys: ["community:access"] as unknown as string[],
      sortOrder: 99,
    })
    .returning({ id: productsTable.id });
  seededProductIds.push(product.id);
  await db.insert(userProductsTable).values({
    userId: member.id,
    productId: product.id,
    status: "active",
  });

  const [post] = await db
    .insert(communityPostsTable)
    .values({
      authorId: member.id,
      categoryId,
      title: "reaction target post",
      content: "a post to react to",
      status: "active",
    })
    .returning({ id: communityPostsTable.id });
  postId = post.id;
});

afterAll(async () => {
  if (seededUserIds.length > 0) {
    await db.delete(communityReactionsTable).where(inArray(communityReactionsTable.userId, seededUserIds));
    await db.delete(communityPostsTable).where(inArray(communityPostsTable.authorId, seededUserIds));
    await db.delete(userProductsTable).where(inArray(userProductsTable.userId, seededUserIds));
    await db.delete(usersTable).where(inArray(usersTable.id, seededUserIds));
  }
  if (seededProductIds.length > 0) {
    await db.delete(productsTable).where(inArray(productsTable.id, seededProductIds));
  }
  if (categoryId) {
    await db.delete(communityCategoriesTable).where(eq(communityCategoriesTable.id, categoryId));
  }
});

/**
 * Guards against the camelCase→snake_case regression: the reactions endpoint
 * accepts snake_case body keys (`target_type`/`target_id`). A client sending
 * camelCase keys used to fail silently with only a UI error toast — these
 * tests document the wire contract so that mismatch can't come back unnoticed.
 */
describe("POST /community/reactions request contract", () => {
  it("returns 200 for valid snake_case target_type/target_id", async () => {
    const res = await request(app)
      .post("/api/community/reactions")
      .set("Cookie", memberCookie)
      .send({ target_type: "post", target_id: postId, type: "like" });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ toggled: "added" });
    expect(typeof res.body.reactionCount).toBe("number");
  });

  it("returns 400 when camelCase keys (targetType/targetId) are sent", async () => {
    const res = await request(app)
      .post("/api/community/reactions")
      .set("Cookie", memberCookie)
      .send({ targetType: "post", targetId: postId, type: "like" });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("target_type must be 'post' or 'comment'");
  });

  it("returns 400 when target_id is missing even though target_type is valid", async () => {
    const res = await request(app)
      .post("/api/community/reactions")
      .set("Cookie", memberCookie)
      .send({ target_type: "post", type: "like" });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("target_id must be a number");
  });
});
