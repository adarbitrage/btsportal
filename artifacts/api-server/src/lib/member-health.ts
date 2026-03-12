import {
  db, usersTable, userProductsTable, productsTable, progressTable,
  coachingCallsTable, communityPostsTable, communityCommentsTable,
  chatDailyUsageTable, ticketsTable, memberHealthScoresTable
} from "@workspace/db";
import { eq, and, gte, sql, count, desc } from "drizzle-orm";
import { queueGHLSync } from "./ghl-queue";

const WEIGHTS = {
  loginFrequency: 0.25,
  trainingProgress: 0.20,
  coachingAttendance: 0.15,
  communityEngagement: 0.10,
  toolUsage: 0.10,
  supportTickets: 0.10,
  recency: 0.10,
};

function clamp(value: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, value));
}

function getRiskLevel(score: number): string {
  if (score >= 70) return "healthy";
  if (score >= 40) return "watch";
  if (score >= 20) return "at_risk";
  return "critical";
}

function getTrend(current: number, previous: number | null): string {
  if (previous === null) return "new";
  const diff = current - previous;
  if (diff > 5) return "improving";
  if (diff < -5) return "declining";
  return "stable";
}

async function computeLoginFrequencyScore(userId: number, daysSince: number): Promise<number> {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const [user] = await db
    .select({ lastLoginAt: usersTable.lastLoginAt, currentStreak: usersTable.currentStreak })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);

  if (!user || !user.lastLoginAt) return 0;

  const daysSinceLogin = (Date.now() - user.lastLoginAt.getTime()) / (1000 * 60 * 60 * 24);

  if (daysSinceLogin > 30) return 0;
  if (daysSinceLogin > 14) return 20;
  if (daysSinceLogin > 7) return 40;

  const streakScore = Math.min(user.currentStreak * 10, 60);
  const recencyBonus = daysSinceLogin <= 1 ? 40 : daysSinceLogin <= 3 ? 30 : 20;

  return clamp(streakScore + recencyBonus);
}

async function computeTrainingProgressScore(userId: number): Promise<number> {
  const [result] = await db
    .select({ total: count() })
    .from(progressTable)
    .where(eq(progressTable.userId, userId));

  const completedLessons = result?.total || 0;

  const [totalResult] = await db
    .select({ total: count() })
    .from(progressTable);

  if (completedLessons === 0) return 0;
  if (completedLessons >= 20) return 100;

  return clamp(completedLessons * 5);
}

async function computeCoachingAttendanceScore(userId: number): Promise<number> {
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

  const [callsResult] = await db
    .select({ total: count() })
    .from(coachingCallsTable)
    .where(gte(coachingCallsTable.scheduledAt, ninetyDaysAgo));

  const totalCalls = callsResult?.total || 0;
  if (totalCalls === 0) return 50;

  const userProducts = await db
    .select({ status: userProductsTable.status, entitlementKeys: productsTable.entitlementKeys })
    .from(userProductsTable)
    .innerJoin(productsTable, eq(userProductsTable.productId, productsTable.id))
    .where(eq(userProductsTable.userId, userId));

  const hasCoaching = userProducts.some((p) => {
    const keys = p.entitlementKeys as string[];
    return Array.isArray(keys) && keys.some((k) => k.startsWith("coaching:"));
  });

  if (!hasCoaching) return 50;

  const [user] = await db
    .select({ lastLoginAt: usersTable.lastLoginAt, currentStreak: usersTable.currentStreak })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);

  if (!user?.lastLoginAt) return 10;

  const daysSinceLogin = (Date.now() - user.lastLoginAt.getTime()) / (1000 * 60 * 60 * 24);
  if (daysSinceLogin <= 7 && user.currentStreak >= 3) return 80;
  if (daysSinceLogin <= 14) return 60;
  if (daysSinceLogin <= 30) return 40;
  return 20;
}

async function computeCommunityEngagementScore(userId: number): Promise<number> {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const [postsResult] = await db
    .select({ total: count() })
    .from(communityPostsTable)
    .where(
      and(
        eq(communityPostsTable.authorId, userId),
        gte(communityPostsTable.createdAt, thirtyDaysAgo)
      )
    );

  const [commentsResult] = await db
    .select({ total: count() })
    .from(communityCommentsTable)
    .where(
      and(
        eq(communityCommentsTable.authorId, userId),
        gte(communityCommentsTable.createdAt, thirtyDaysAgo)
      )
    );

  const posts = postsResult?.total || 0;
  const comments = commentsResult?.total || 0;
  const totalActivity = posts * 3 + comments;

  if (totalActivity === 0) return 0;
  if (totalActivity >= 15) return 100;

  return clamp(totalActivity * 7);
}

async function computeToolUsageScore(userId: number): Promise<number> {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const dateStr = thirtyDaysAgo.toISOString().split("T")[0];

  const [result] = await db
    .select({ total: sql<number>`coalesce(sum(${chatDailyUsageTable.messageCount}), 0)::int` })
    .from(chatDailyUsageTable)
    .where(
      and(
        eq(chatDailyUsageTable.userId, userId),
        gte(chatDailyUsageTable.usageDate, dateStr)
      )
    );

  const messages = result?.total || 0;
  if (messages === 0) return 0;
  if (messages >= 50) return 100;

  return clamp(messages * 2);
}

async function computeSupportTicketScore(userId: number): Promise<number> {
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

  const [result] = await db
    .select({ total: count() })
    .from(ticketsTable)
    .where(
      and(
        eq(ticketsTable.userId, userId),
        gte(ticketsTable.createdAt, ninetyDaysAgo)
      )
    );

  const tickets = result?.total || 0;

  if (tickets === 0) return 60;
  if (tickets <= 2) return 80;
  if (tickets <= 5) return 50;

  return 20;
}

async function computeRecencyScore(userId: number): Promise<number> {
  const [user] = await db
    .select({ lastLoginAt: usersTable.lastLoginAt })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);

  if (!user?.lastLoginAt) return 0;

  const daysSinceLogin = (Date.now() - user.lastLoginAt.getTime()) / (1000 * 60 * 60 * 24);

  if (daysSinceLogin <= 1) return 100;
  if (daysSinceLogin <= 3) return 80;
  if (daysSinceLogin <= 7) return 60;
  if (daysSinceLogin <= 14) return 40;
  if (daysSinceLogin <= 30) return 20;
  return 0;
}

export async function computeMemberHealthScore(userId: number): Promise<{
  score: number;
  riskLevel: string;
  signals: Record<string, number>;
}> {
  const memberSince = await db
    .select({ memberSince: usersTable.memberSince })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);

  const daysSince = memberSince[0]
    ? (Date.now() - memberSince[0].memberSince.getTime()) / (1000 * 60 * 60 * 24)
    : 0;

  const [
    loginFrequency,
    trainingProgress,
    coachingAttendance,
    communityEngagement,
    toolUsage,
    supportTickets,
    recency,
  ] = await Promise.all([
    computeLoginFrequencyScore(userId, daysSince),
    computeTrainingProgressScore(userId),
    computeCoachingAttendanceScore(userId),
    computeCommunityEngagementScore(userId),
    computeToolUsageScore(userId),
    computeSupportTicketScore(userId),
    computeRecencyScore(userId),
  ]);

  const score = Math.round(
    loginFrequency * WEIGHTS.loginFrequency +
    trainingProgress * WEIGHTS.trainingProgress +
    coachingAttendance * WEIGHTS.coachingAttendance +
    communityEngagement * WEIGHTS.communityEngagement +
    toolUsage * WEIGHTS.toolUsage +
    supportTickets * WEIGHTS.supportTickets +
    recency * WEIGHTS.recency
  );

  return {
    score: clamp(score),
    riskLevel: getRiskLevel(score),
    signals: {
      loginFrequency,
      trainingProgress,
      coachingAttendance,
      communityEngagement,
      toolUsage,
      supportTickets,
      recency,
    },
  };
}

export async function computeAllHealthScores(): Promise<number> {
  const members = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.role, "member"));

  let processed = 0;

  for (const member of members) {
    try {
      const { score, riskLevel, signals } = await computeMemberHealthScore(member.id);

      const [existing] = await db
        .select({ id: memberHealthScoresTable.id, score: memberHealthScoresTable.score, riskLevel: memberHealthScoresTable.riskLevel })
        .from(memberHealthScoresTable)
        .where(eq(memberHealthScoresTable.userId, member.id))
        .orderBy(desc(memberHealthScoresTable.computedAt))
        .limit(1);

      const previousScore = existing?.score ?? null;
      const previousRiskLevel = existing?.riskLevel ?? null;
      const trend = getTrend(score, previousScore);

      await db.insert(memberHealthScoresTable).values({
        userId: member.id,
        score,
        riskLevel,
        loginFrequencyScore: String(signals.loginFrequency),
        trainingProgressScore: String(signals.trainingProgress),
        coachingAttendanceScore: String(signals.coachingAttendance),
        communityEngagementScore: String(signals.communityEngagement),
        toolUsageScore: String(signals.toolUsage),
        supportTicketScore: String(signals.supportTickets),
        recencyScore: String(signals.recency),
        signals,
        previousScore,
        trend,
        computedAt: new Date(),
      });

      if (previousRiskLevel && previousRiskLevel !== riskLevel) {
        await updateGHLHealthTags(member.id, riskLevel, previousRiskLevel);
      }

      processed++;
    } catch (err) {
      console.error(`[Health Score] Error computing score for user ${member.id}:`, err);
    }
  }

  return processed;
}

async function updateGHLHealthTags(userId: number, newLevel: string, oldLevel: string): Promise<void> {
  const tagMap: Record<string, string> = {
    watch: "health_watch",
    at_risk: "health_at_risk",
    critical: "health_critical",
  };

  const removeTags: string[] = [];
  if (oldLevel in tagMap) {
    removeTags.push(tagMap[oldLevel]);
  }

  const addTags: string[] = [];
  if (newLevel in tagMap) {
    addTags.push(tagMap[newLevel]);
  }

  if (addTags.length > 0 || removeTags.length > 0) {
    try {
      if (removeTags.length > 0) {
        await queueGHLSync({
          action: "remove_tags",
          userId,
          removeTags,
        });
      }
      if (addTags.length > 0) {
        await queueGHLSync({
          action: "add_tags",
          userId,
          tags: addTags,
        });
      }
    } catch (err) {
      console.error(`[Health Score] Failed to update GHL tags for user ${userId}:`, err);
    }
  }
}

export async function getHealthScoreDistribution(): Promise<Record<string, number>> {
  const members = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.role, "member"));

  const distribution: Record<string, number> = {
    healthy: 0,
    watch: 0,
    at_risk: 0,
    critical: 0,
  };

  for (const member of members) {
    const [latest] = await db
      .select({ riskLevel: memberHealthScoresTable.riskLevel })
      .from(memberHealthScoresTable)
      .where(eq(memberHealthScoresTable.userId, member.id))
      .orderBy(desc(memberHealthScoresTable.computedAt))
      .limit(1);

    if (latest) {
      distribution[latest.riskLevel] = (distribution[latest.riskLevel] || 0) + 1;
    }
  }

  return distribution;
}
