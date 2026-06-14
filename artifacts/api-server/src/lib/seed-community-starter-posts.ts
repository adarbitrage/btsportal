import crypto from "crypto";
import bcrypt from "bcryptjs";
import {
  db,
  usersTable,
  communityCategoriesTable,
  communityPostsTable,
  communityCommentsTable,
} from "@workspace/db";
import { eq, inArray, sql } from "drizzle-orm";

// Content-attribution accounts for the permanent starter posts.
// These are NOT login accounts — they use an internal domain so they can
// never be confused with real members and are excluded from the seed-post
// cleanup (which only purges marcus/jake/lisa @example.com authors).
const CONTENT_AUTHORS = [
  { email: "erika.brooks@bts-content.internal", name: "Erika Brooks" },
  { email: "sasha.b@bts-content.internal", name: "Sasha B" },
  { email: "robin.shepard@bts-content.internal", name: "Robin Shepard" },
  { email: "jordan.fitch@bts-content.internal", name: "Jordan Fitch" },
  { email: "priya.nair@bts-content.internal", name: "Priya Nair" },
  { email: "devon.walsh@bts-content.internal", name: "Devon Walsh" },
] as const;

// Stable presence marker — if this title exists the hook has already run fully
// (it is inserted last within the transaction, so its presence guarantees the
// whole set committed successfully).
const RESOURCES_POST_TITLE = "12 Timeless Marketing Tips from David Ogilvy";

export async function seedCommunityStarterPosts(): Promise<void> {
  // Fast idempotency check — O(1) using the posts title index.
  // We key off the resources post title because it is the LAST post committed
  // inside the transaction; if it exists, all prior inserts also committed.
  const [existing] = await db
    .select({ id: communityPostsTable.id })
    .from(communityPostsTable)
    .where(eq(communityPostsTable.title, RESOURCES_POST_TITLE))
    .limit(1);

  if (existing) {
    console.log("[StarterPosts] Community starter posts already present — skipping.");
    return;
  }

  console.log("[StarterPosts] Seeding community starter posts…");

  // All author accounts and posts are inserted inside a single transaction.
  // If anything fails the entire batch is rolled back so the next boot
  // retries from scratch — no risk of a partial-insert state that silently
  // skips future runs.
  await db.transaction(async (tx) => {
    // ── Step 1: Ensure content-author accounts exist ─────────────────────
    // A random password is generated so these accounts cannot be brute-forced
    // via the login form — they are attribution-only and will never be logged in.
    const randomPassword = crypto.randomBytes(32).toString("hex");
    const passwordHash = await bcrypt.hash(randomPassword, 10);

    await tx
      .insert(usersTable)
      .values(
        CONTENT_AUTHORS.map((a) => ({
          name: a.name,
          email: a.email,
          passwordHash,
          role: "member" as const,
          emailVerified: true,
          onboardingComplete: true,
        })),
      )
      .onConflictDoNothing();

    const authors = await tx
      .select({ id: usersTable.id, email: usersTable.email })
      .from(usersTable)
      .where(inArray(usersTable.email, CONTENT_AUTHORS.map((a) => a.email)));

    const byEmail = Object.fromEntries(authors.map((a) => [a.email, a.id]));
    const erikaId = byEmail["erika.brooks@bts-content.internal"];
    const sashaId = byEmail["sasha.b@bts-content.internal"];
    const robinId = byEmail["robin.shepard@bts-content.internal"];
    const jordanId = byEmail["jordan.fitch@bts-content.internal"];
    const priyaId = byEmail["priya.nair@bts-content.internal"];
    const devonId = byEmail["devon.walsh@bts-content.internal"];

    if (!erikaId || !sashaId || !robinId || !jordanId || !priyaId || !devonId) {
      throw new Error("[StarterPosts] Failed to resolve one or more content author IDs after insert.");
    }

    // ── Step 2: Resolve category IDs ─────────────────────────────────────
    const categories = await tx
      .select({ id: communityCategoriesTable.id, slug: communityCategoriesTable.slug })
      .from(communityCategoriesTable)
      .where(inArray(communityCategoriesTable.slug, ["strategies", "resources", "wins"]));

    const catBySlug = Object.fromEntries(categories.map((c) => [c.slug, c.id]));
    const strategiesCatId = catBySlug["strategies"];
    const resourcesCatId = catBySlug["resources"];
    const winsCatId = catBySlug["wins"];

    if (!strategiesCatId || !resourcesCatId || !winsCatId) {
      throw new Error(
        "[StarterPosts] Required community categories (strategies, resources, wins) not found — cannot seed starter posts.",
      );
    }

    // ── Helpers ───────────────────────────────────────────────────────────

    async function insertPost(
      authorId: number,
      categoryId: number,
      title: string,
      content: string,
    ): Promise<number> {
      const [post] = await tx
        .insert(communityPostsTable)
        .values({ authorId, categoryId, title, content, status: "active" })
        .returning({ id: communityPostsTable.id });
      return post.id;
    }

    async function insertComment(postId: number, authorId: number, content: string): Promise<void> {
      await tx.insert(communityCommentsTable).values({
        postId,
        authorId,
        content,
        status: "active",
      });
    }

    async function finalisePost(postId: number, commentCount: number): Promise<void> {
      await tx
        .update(communityPostsTable)
        .set({ commentCount })
        .where(eq(communityPostsTable.id, postId));
    }

    // ── Step 3: Strategy post ─────────────────────────────────────────────
    // Recreated from Discord #strategy-chat (6/3/2024) — Erika Brooks opens a
    // discussion on ad-angle testing strategy; Sasha B advises starting simple.
    const strategyPostId = await insertPost(
      erikaId,
      strategiesCatId,
      "Ad Angles & Campaign Testing: What's Your Approach?",
      `Hey yall — talk to me about ad angles and campaign testing. I have about 4 angles that I want to run with multiple images/headlines in each. Do you all think its best to (1) run each angle independently, test against the winner/control, and think about the testing cycle as more of a flywheel or (2) run campaigns congruently and optimize as fast as possible with a big, potentially costly initial investment? There are pluses and minuses to both — curious what yall think based on your experience working the blitz.`,
    );

    await insertComment(
      strategyPostId,
      sashaId,
      `I think it is important to know what you are testing and why. Having a lot of variables you are simultaneously cross testing can get confusing and counterproductive. Add to this that the software is new and you need to learn how and when to interpret it with some waiting times for the review process — I would recommend starting with fewer things you are testing, especially if you have an unproven product and advertorial you are starting with.\n\nSo I guess the question is, what are you testing? Advertorials? Advertorial headline/hero shots? Banner images? Banner headlines?`,
    );

    await insertComment(
      strategyPostId,
      erikaId,
      `Which are both true — everything that I'll be testing is net-new with my FMC so I think the move is to test the content in the delivery package (with a few tweaks) to establish a baseline and then move on from there.`,
    );

    await insertComment(
      strategyPostId,
      sashaId,
      `More or less, yes — at least to start off. And especially since DIYtrax is still being fine tuned a bit, you initially might want to stick to identifying broad trends as to what is working, and then start fine tuning to improve CTR, ATC cost etc... My top priority if starting with a new project would be to identify your banner ad images which consistently get a good CPC with at least a workable clickthrough rate and figure out which advertorial is a better converter. Then you can use that information to start creating more headlines for your ads, and iterating off your working images to get better converters. Start doing everything at once and for me it gets confusing as to which angle is working with which advertorial, etc.\n\nAnd to really cross test a lot of ads and advertorials and headlines and get reliable info costs a lot of money because you need a larger data set to get some sort of statistical significance — so yea, KISS.`,
    );

    await insertComment(
      strategyPostId,
      erikaId,
      `Thanks @Sasha B — I'm fighting my internal urge to go big and really appreciate the tempered approach here. Plus, adding in new campaigns and angles will be fun once I get some baseline stats 😉`,
    );

    await finalisePost(strategyPostId, 4);

    // ── Step 4: Wins posts ────────────────────────────────────────────────
    // Three invented mentee voices covering first sale, strong training day,
    // and launching a new campaign. Inserted before resources so the resources
    // post title can serve as the idempotency marker (last committed = all done).

    // Win 1 — Jordan Fitch: first affiliate sale
    const winsPost1Id = await insertPost(
      jordanId,
      winsCatId,
      "Got My First Affiliate Sale! 🎉",
      `Just wanted to share — I got my very first affiliate commission today! It's a small win but honestly it hit different. Been grinding through the training for a few weeks and finally got my first campaign live last Thursday.\n\nStayed consistent with the blitz steps, kept my ad spend low to learn the ropes, and this morning I woke up to a notification. Still can't believe it's real. Thank you to everyone in this community for the encouragement — it genuinely helps. Onwards and upwards! 🚀`,
    );

    await insertComment(
      winsPost1Id,
      erikaId,
      `Congratulations Jordan!! That first one is everything — it proves the model works and now you just have to scale what's working. So proud of you! 🙌`,
    );

    await insertComment(
      winsPost1Id,
      priyaId,
      `Yes!! Love seeing this. The first sale is always the hardest and you did it. Keep going! 🔥`,
    );

    await finalisePost(winsPost1Id, 2);

    // Win 2 — Priya Nair: strong training day
    const winsPost2Id = await insertPost(
      priyaId,
      winsCatId,
      "Solid Training Day — It Finally Clicked",
      `Today was one of those days where everything just clicked. I went back through some of the earlier blitz steps that I'd kind of rushed through before and actually took notes this time, paused the videos, re-read the guides.\n\nI feel like I've been trying to run before I can walk and today I slowed down and really followed the process the way it's laid out. No shortcuts. Just doing the work.\n\nHonestly feeling more confident about where I'm heading than I have in weeks. Sometimes the win is just showing up and actually learning. 💪`,
    );

    await insertComment(
      winsPost2Id,
      devonId,
      `This is huge! The process is designed the way it is for a reason — trusting it is genuinely half the battle. Keep that energy!`,
    );

    await insertComment(
      winsPost2Id,
      jordanId,
      `Love this. I had a similar moment last week. The blitz really does reward patience. Great job sticking with it! 🙏`,
    );

    await finalisePost(winsPost2Id, 2);

    // Win 3 — Devon Walsh: launching a second campaign
    const winsPost3Id = await insertPost(
      devonId,
      winsCatId,
      "New Campaign Is Live — Launching Feels Amazing 🎯",
      `Big day for me — I finally hit publish on my second campaign! After my first one taught me so much about what NOT to do, I feel so much more prepared going into this one.\n\nI've got better creatives, a tighter advertorial, and I actually understand what metrics I'm watching and why. Keeping my daily budget conservative until I see what's working, then I'll scale the winners.\n\nJust wanted to put this out there for anyone who's been hesitating to launch. The learning curve is real but so is the progress. Let's go! 🚀`,
    );

    await insertComment(
      winsPost3Id,
      erikaId,
      `Love this energy! Campaign number two with the lessons from number one is such a powerful combo. Rooting for you! 💪`,
    );

    await insertComment(
      winsPost3Id,
      priyaId,
      `Yes Devon!! "Conservative budget until I see what's working" — you've already got the mindset right. That's huge. Congrats! 🎉`,
    );

    await finalisePost(winsPost3Id, 2);

    // ── Step 5: Resources post (LAST — used as idempotency marker) ────────
    // Recreated from Discord #research-n-resources (6/6/2024) — Erika shares the
    // Ogilvy LinkedIn post; Robin Shepard engages and they discuss portal placement.
    // This post is inserted last so its presence guarantees the full transaction
    // committed — any mid-run failure rolls the whole batch back, not just this post.
    const resourcesPostId = await insertPost(
      erikaId,
      resourcesCatId,
      RESOURCES_POST_TITLE,
      `Interesting quotes to help inspire and center your focus when you may be feeling a bit lost — 12 timeless marketing tips from David Ogilvy:\n\nhttps://www.linkedin.com/posts/joshdviner_12-timeless-marketing-tips-from-david-ogilvy-ugcPost-7204096443610013696-3lzE\n\n**Josh Viner on LinkedIn: 12 timeless marketing tips from David Ogilvy...**\nDavid Ogilvy is considered the "Father of Advertising." Here are 12 timeless marketing tips from the legend himself. My favourite is number six.`,
    );

    await insertComment(
      resourcesPostId,
      robinId,
      `This is awesome! Is there a place to post this in your section on the New Student Portal?`,
    );

    await insertComment(resourcesPostId, erikaId, `Let me look…`);

    await insertComment(resourcesPostId, robinId, `Or you can build a place 🙂`);

    await insertComment(
      resourcesPostId,
      erikaId,
      `I can change "Motivation" to "In The News" — take a gander!`,
    );

    await insertComment(
      resourcesPostId,
      robinId,
      `Hey it's your space over there — whatever you think is best! ❤️`,
    );

    await finalisePost(resourcesPostId, 5);

    // ── Step 6: Sync category postsCount ─────────────────────────────────
    for (const catId of [strategiesCatId, resourcesCatId, winsCatId]) {
      const [row] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(communityPostsTable)
        .where(eq(communityPostsTable.categoryId, catId));
      await tx
        .update(communityCategoriesTable)
        .set({ postsCount: row?.count ?? 0 })
        .where(eq(communityCategoriesTable.id, catId));
    }
  });

  console.log(
    "[StarterPosts] ✓ Seeded 5 community starter posts (1 strategy, 1 resource, 3 wins) with comments.",
  );
}
