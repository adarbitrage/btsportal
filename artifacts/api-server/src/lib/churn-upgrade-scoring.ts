import {
  db, usersTable, userProductsTable, productsTable,
  memberHealthScoresTable, progressTable, chatDailyUsageTable,
  communityPostsTable
} from "@workspace/db";
import { eq, and, gte, desc, count, sql } from "drizzle-orm";
import { COACH_ROLE } from "@workspace/auth";

export interface ChurnRisk {
  userId: number;
  userName: string;
  email: string;
  productName: string;
  expiresAt: Date;
  daysToExpiration: number;
  healthScore: number;
  churnProbability: number;
  riskFactors: string[];
}

export interface UpgradeCandidate {
  userId: number;
  userName: string;
  email: string;
  currentProduct: string;
  upgradeProbability: number;
  signals: string[];
}

export async function computeChurnRisks(): Promise<ChurnRisk[]> {
  const now = new Date();
  const sixtyDaysOut = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000);

  const expiringProducts = await db
    .select({
      userId: userProductsTable.userId,
      userName: usersTable.name,
      email: usersTable.email,
      productName: productsTable.name,
      expiresAt: userProductsTable.expiresAt,
      productType: productsTable.type,
    })
    .from(userProductsTable)
    .innerJoin(productsTable, eq(userProductsTable.productId, productsTable.id))
    .innerJoin(usersTable, eq(userProductsTable.userId, usersTable.id))
    .where(
      and(
        eq(userProductsTable.status, "active"),
        gte(userProductsTable.expiresAt, now),
        sql`${userProductsTable.expiresAt} <= ${sixtyDaysOut}`
      )
    );

  const risks: ChurnRisk[] = [];

  for (const product of expiringProducts) {
    if (!product.expiresAt) continue;

    const daysToExpiration = Math.ceil(
      (product.expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
    );

    const [healthRow] = await db
      .select({ score: memberHealthScoresTable.score })
      .from(memberHealthScoresTable)
      .where(eq(memberHealthScoresTable.userId, product.userId))
      .orderBy(desc(memberHealthScoresTable.computedAt))
      .limit(1);

    const healthScore = healthRow?.score ?? 50;

    const riskFactors: string[] = [];

    const healthFactor = (100 - healthScore) / 100;
    if (healthScore < 40) riskFactors.push("Low health score");

    const expirationFactor = Math.max(0, 1 - daysToExpiration / 60);
    if (daysToExpiration <= 14) riskFactors.push("Expiring soon");

    const historicalRenewalRate = 0.7;
    const renewalFactor = 1 - historicalRenewalRate;

    const [user] = await db
      .select({ lastLoginAt: usersTable.lastLoginAt, currentStreak: usersTable.currentStreak })
      .from(usersTable)
      .where(eq(usersTable.id, product.userId))
      .limit(1);

    let engagementFactor = 0.5;
    if (user?.lastLoginAt) {
      const daysSinceLogin = (now.getTime() - user.lastLoginAt.getTime()) / (1000 * 60 * 60 * 24);
      if (daysSinceLogin > 14) {
        engagementFactor = 0.8;
        riskFactors.push("Inactive for 14+ days");
      } else if (daysSinceLogin > 7) {
        engagementFactor = 0.6;
        riskFactors.push("Low recent activity");
      } else {
        engagementFactor = 0.2;
      }
    } else {
      engagementFactor = 0.9;
      riskFactors.push("Never logged in");
    }

    const churnProbability = parseFloat(
      (
        healthFactor * 0.35 +
        expirationFactor * 0.25 +
        renewalFactor * 0.20 +
        engagementFactor * 0.20
      ).toFixed(4)
    );

    risks.push({
      userId: product.userId,
      userName: product.userName,
      email: product.email,
      productName: product.productName,
      expiresAt: product.expiresAt,
      daysToExpiration,
      healthScore,
      churnProbability: Math.min(churnProbability, 1),
      riskFactors,
    });
  }

  risks.sort((a, b) => b.churnProbability - a.churnProbability);
  return risks;
}

export async function computeUpgradeCandidates(): Promise<UpgradeCandidate[]> {
  const frontendMembers = await db
    .select({
      userId: userProductsTable.userId,
      userName: usersTable.name,
      email: usersTable.email,
      productName: productsTable.name,
      productSlug: productsTable.slug,
      productType: productsTable.type,
      purchasedAt: userProductsTable.purchasedAt,
    })
    .from(userProductsTable)
    .innerJoin(productsTable, eq(userProductsTable.productId, productsTable.id))
    .innerJoin(usersTable, eq(userProductsTable.userId, usersTable.id))
    .where(
      and(
        eq(userProductsTable.status, "active"),
        sql`${productsTable.type} IN ('frontend', 'launchpad')`,
        // Coaches are staff, never upsell prospects — exclude even if a coach
        // happens to also hold a frontend/launchpad product.
        sql`${usersTable.role} <> ${COACH_ROLE}`
      )
    );

  const candidates: UpgradeCandidate[] = [];

  for (const member of frontendMembers) {
    const signals: string[] = [];
    let score = 0;

    const [progressResult] = await db
      .select({ total: count() })
      .from(progressTable)
      .where(eq(progressTable.userId, member.userId));

    const completedLessons = progressResult?.total || 0;
    if (completedLessons >= 10) {
      score += 25;
      signals.push(`Completed ${completedLessons} lessons`);
    } else if (completedLessons >= 5) {
      score += 15;
      signals.push(`Completed ${completedLessons} lessons`);
    }

    const [user] = await db
      .select({ lastLoginAt: usersTable.lastLoginAt, currentStreak: usersTable.currentStreak })
      .from(usersTable)
      .where(eq(usersTable.id, member.userId))
      .limit(1);

    if (user?.lastLoginAt) {
      const daysSinceLogin = (Date.now() - user.lastLoginAt.getTime()) / (1000 * 60 * 60 * 24);
      if (daysSinceLogin <= 3) {
        score += 20;
        signals.push("Active in last 3 days");
      } else if (daysSinceLogin <= 7) {
        score += 10;
        signals.push("Active in last week");
      }
    }

    if (user?.currentStreak && user.currentStreak >= 5) {
      score += 10;
      signals.push(`${user.currentStreak}-day streak`);
    }

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const dateStr = thirtyDaysAgo.toISOString().split("T")[0];

    const [chatResult] = await db
      .select({ total: sql<number>`coalesce(sum(${chatDailyUsageTable.messageCount}), 0)::int` })
      .from(chatDailyUsageTable)
      .where(
        and(
          eq(chatDailyUsageTable.userId, member.userId),
          gte(chatDailyUsageTable.usageDate, dateStr)
        )
      );

    const chatMessages = chatResult?.total || 0;
    if (chatMessages >= 20) {
      score += 15;
      signals.push("Heavy AI tool usage");
    } else if (chatMessages >= 5) {
      score += 8;
      signals.push("Moderate AI tool usage");
    }

    const daysSincePurchase = (Date.now() - member.purchasedAt.getTime()) / (1000 * 60 * 60 * 24);
    if (daysSincePurchase >= 30 && daysSincePurchase <= 90) {
      score += 15;
      signals.push("In optimal upgrade window (30-90 days)");
    } else if (daysSincePurchase > 90) {
      score += 5;
    }

    const [communityResult] = await db
      .select({ total: count() })
      .from(communityPostsTable)
      .where(
        and(
          eq(communityPostsTable.authorId, member.userId),
          gte(communityPostsTable.createdAt, new Date(Date.now() - 30 * 24 * 60 * 60 * 1000))
        )
      );

    const communityPosts = communityResult?.total || 0;
    if (communityPosts >= 3) {
      score += 15;
      signals.push("Active community participant");
    } else if (communityPosts >= 1) {
      score += 8;
      signals.push("Some community activity");
    }

    const upgradeProbability = parseFloat((Math.min(score, 100) / 100).toFixed(4));

    if (upgradeProbability > 0.2) {
      candidates.push({
        userId: member.userId,
        userName: member.userName,
        email: member.email,
        currentProduct: member.productName,
        upgradeProbability,
        signals,
      });
    }
  }

  candidates.sort((a, b) => b.upgradeProbability - a.upgradeProbability);
  return candidates;
}
