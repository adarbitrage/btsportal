import { randomBytes } from "node:crypto";
import { test, expect } from "@playwright/test";
import bcrypt from "bcryptjs";
import { Pool } from "pg";
import { loginAs } from "./auth";

// End-to-end coverage for the community "like" (reaction) flow from the member
// portal. Task #799 added an API-level contract test for POST
// /community/reactions, but nothing exercised the browser path: a member
// clicking the flame control on a post/comment and the count actually toggling.
// The original silent failure (client sending camelCase body keys) only ever
// surfaced as a UI error toast, so a portal-side regression would slip past the
// API test. This spec seeds its own member + post + comment, drives the real
// SPA, and asserts the count updates with no error toast.

interface ReactionFixture {
  memberEmail: string;
  memberPassword: string;
  postId: number;
  commentId: number;
  categoryId: number;
  memberId: number;
  productId: number;
}

let fixture: ReactionFixture;

test.beforeAll(async () => {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL must be set for the community reactions E2E test.");
  }

  const pool = new Pool({ connectionString: url });
  const client = await pool.connect();
  const tag = randomBytes(6).toString("hex");
  const memberEmail = `e2e-react-${tag}@e2e.local`;
  const memberPassword = `E2E-${randomBytes(9).toString("base64url")}`;
  const memberHash = await bcrypt.hash(memberPassword, 10);

  try {
    await client.query("BEGIN");

    const memberRes = await client.query<{ id: number }>(
      `INSERT INTO users (name, email, password_hash, role, email_verified, onboarding_complete)
       VALUES ($1, $2, $3, 'member', true, true)
       RETURNING id`,
      [`E2E React Member ${tag}`, memberEmail, memberHash],
    );
    const memberId = memberRes.rows[0].id;

    // Grant community access via a throwaway product carrying the entitlement.
    const productRes = await client.query<{ id: number }>(
      `INSERT INTO products (slug, name, type, entitlement_keys, sort_order)
       VALUES ($1, $2, 'backend', $3::jsonb, 999)
       RETURNING id`,
      [`e2e-react-prod-${tag}`, `E2E React Product ${tag}`, JSON.stringify(["community:access"])],
    );
    const productId = productRes.rows[0].id;

    await client.query(
      `INSERT INTO user_products (user_id, product_id, status)
       VALUES ($1, $2, 'active')`,
      [memberId, productId],
    );

    const categoryRes = await client.query<{ id: number }>(
      `INSERT INTO community_categories (name, slug, description, sort_order, is_active)
       VALUES ($1, $2, 'e2e reactions', 1, true)
       RETURNING id`,
      [`E2E React Cat ${tag}`, `e2e-react-cat-${tag}`],
    );
    const categoryId = categoryRes.rows[0].id;

    const postRes = await client.query<{ id: number }>(
      `INSERT INTO community_posts (author_id, category_id, title, content, status, reaction_count, comment_count)
       VALUES ($1, $2, $3, $4, 'active', 0, 1)
       RETURNING id`,
      [memberId, categoryId, `E2E reaction target ${tag}`, "A post to react to from the portal."],
    );
    const postId = postRes.rows[0].id;

    const commentRes = await client.query<{ id: number }>(
      `INSERT INTO community_comments (post_id, author_id, content, status, reaction_count)
       VALUES ($1, $2, $3, 'active', 0)
       RETURNING id`,
      [postId, memberId, "A comment to react to from the portal."],
    );
    const commentId = commentRes.rows[0].id;

    await client.query("COMMIT");

    fixture = {
      memberEmail,
      memberPassword,
      postId,
      commentId,
      categoryId,
      memberId,
      productId,
    };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
});

test.afterAll(async () => {
  const url = process.env.DATABASE_URL;
  if (!url || !fixture) return;

  const pool = new Pool({ connectionString: url });
  const client = await pool.connect();
  try {
    // Community + reaction artefacts the test produced.
    await client.query("DELETE FROM community_reactions WHERE user_id = $1", [fixture.memberId]);
    await client.query("DELETE FROM community_notifications WHERE user_id = $1 OR actor_id = $1", [fixture.memberId]);
    await client.query("DELETE FROM community_comments WHERE post_id = $1", [fixture.postId]);
    await client.query("DELETE FROM community_posts WHERE id = $1", [fixture.postId]);
    await client.query("DELETE FROM user_products WHERE user_id = $1", [fixture.memberId]);
    await client.query("DELETE FROM products WHERE id = $1", [fixture.productId]);
    await client.query("DELETE FROM community_categories WHERE id = $1", [fixture.categoryId]);
    // Side-effects of logging in (session + GHL sync row) hold FKs on users.
    await client.query("DELETE FROM ghl_sync_log WHERE user_id = $1", [fixture.memberId]);
    await client.query("DELETE FROM sessions WHERE user_id = $1", [fixture.memberId]);
    await client.query("DELETE FROM audit_log WHERE actor_id = $1", [fixture.memberId]);
    await client.query("DELETE FROM users WHERE id = $1", [fixture.memberId]);
  } finally {
    client.release();
    await pool.end();
  }
});

test.describe("Community reactions (member portal)", () => {
  test("a member can like a post and a comment, the count updates, and no error toast appears", async ({
    page,
  }) => {
    await loginAs(page, fixture.memberEmail, fixture.memberPassword);

    await page.goto(`/community/${fixture.postId}`, { waitUntil: "domcontentloaded" });

    // The post detail renders once the seeded post body is visible.
    await expect(
      page.getByText("A post to react to from the portal."),
    ).toBeVisible({ timeout: 15_000 });

    // --- React to the POST ---
    const postReact = page.getByTestId(`button-react-post-${fixture.postId}`);
    await expect(postReact).toBeVisible();
    // Seeded with zero reactions, so it starts un-reacted with no count shown.
    await expect(postReact).toHaveAttribute("data-reacted", "false");
    await expect(page.getByTestId(`button-react-post-${fixture.postId}-count`)).toHaveCount(0);

    await postReact.click();

    // Reaction toggled on and the count surfaces as 1.
    await expect(postReact).toHaveAttribute("data-reacted", "true", { timeout: 15_000 });
    const postCount = page.getByTestId(`button-react-post-${fixture.postId}-count`);
    await expect(postCount).toBeVisible();
    await expect(postCount).toHaveText("1");

    // --- React to the COMMENT ---
    const commentReact = page.getByTestId(`button-react-comment-${fixture.commentId}`);
    await expect(commentReact).toBeVisible({ timeout: 15_000 });
    await expect(commentReact).toHaveAttribute("data-reacted", "false");

    await commentReact.click();

    await expect(commentReact).toHaveAttribute("data-reacted", "true", { timeout: 15_000 });
    const commentCount = page.getByTestId(`button-react-comment-${fixture.commentId}-count`);
    await expect(commentCount).toBeVisible();
    await expect(commentCount).toHaveText("1");

    // No reaction-failure toast at any point — the original silent regression
    // surfaced purely as this destructive toast.
    await expect(page.getByText("Failed to update reaction")).toHaveCount(0);

    // --- Un-react the POST to prove the toggle is bidirectional ---
    // Removing the like must decrement the count back to 0 (so the count span
    // disappears entirely) and un-highlight the button. This shares the same
    // optimistic-update + refetch path as adding a like, where the post
    // normalizer once dropped the reacted state, so a regression here would
    // leave the button stuck "reacted" or the count stuck at 1.
    await postReact.click();
    await expect(postReact).toHaveAttribute("data-reacted", "false", { timeout: 15_000 });
    await expect(page.getByTestId(`button-react-post-${fixture.postId}-count`)).toHaveCount(0);

    // --- Un-react the COMMENT to prove the comment toggle is bidirectional ---
    await commentReact.click();
    await expect(commentReact).toHaveAttribute("data-reacted", "false", { timeout: 15_000 });
    await expect(page.getByTestId(`button-react-comment-${fixture.commentId}-count`)).toHaveCount(0);

    await expect(page.getByText("Failed to update reaction")).toHaveCount(0);
  });
});
