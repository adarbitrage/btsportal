import { Queue, Worker, type Job, type ConnectionOptions } from "bullmq";
import IORedis from "ioredis";
import {
  db,
  usersTable,
  userProductsTable,
  productsTable,
  coachingCallsTable,
  sequenceEnrollmentsTable,
  sequencesTable,
} from "@workspace/db";
import { eq, and, lt, lte, gte, gt, isNotNull } from "drizzle-orm";
import { enrollInSequence } from "./sequence-helpers";
import { checkAndRecordSend } from "./comms-dedup";
import { QUEUE_REDIS_OPTIONS, makeThrottledRedisErrorLogger } from "./redis";

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
const QUEUE_NAME = "scheduled-comms";

let connection: IORedis | null = null;
let queue: Queue | null = null;
let worker: Worker | null = null;

function getConnection(): ConnectionOptions {
  if (!connection) {
    connection = new IORedis(REDIS_URL, { ...QUEUE_REDIS_OPTIONS });
    connection.on("error", makeThrottledRedisErrorLogger("[Scheduled Comms]"));
  }
  return connection as unknown as ConnectionOptions;
}

function getQueue(): Queue {
  if (!queue) {
    queue = new Queue(QUEUE_NAME, {
      connection: getConnection(),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 10000 },
        removeOnComplete: { count: 500 },
        removeOnFail: { count: 1000 },
      },
    });
  }
  return queue;
}

async function processCoachingCallReminders(): Promise<void> {
  const now = new Date();
  const oneHourFromNow = new Date(now.getTime() + 60 * 60 * 1000);
  const twentyFourHoursFromNow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  const calls24h = await db
    .select({
      id: coachingCallsTable.id,
      title: coachingCallsTable.title,
      scheduledAt: coachingCallsTable.scheduledAt,
      requiredEntitlement: coachingCallsTable.requiredEntitlement,
    })
    .from(coachingCallsTable)
    .where(
      and(
        gt(coachingCallsTable.scheduledAt, oneHourFromNow),
        lte(coachingCallsTable.scheduledAt, twentyFourHoursFromNow)
      )
    );

  for (const call of calls24h) {
    const sendKey = `coaching_reminder_24h_${call.id}`;
    const isNew = await checkAndRecordSend(sendKey, "email");
    if (isNew) {
      console.log(`[STUB:EMAIL] Would send 24h coaching call reminder for "${call.title}" (${call.scheduledAt.toISOString()})`);
    }
  }

  const calls1h = await db
    .select({
      id: coachingCallsTable.id,
      title: coachingCallsTable.title,
      scheduledAt: coachingCallsTable.scheduledAt,
    })
    .from(coachingCallsTable)
    .where(
      and(
        gt(coachingCallsTable.scheduledAt, now),
        lte(coachingCallsTable.scheduledAt, oneHourFromNow)
      )
    );

  for (const call of calls1h) {
    const sendKey = `coaching_reminder_1h_${call.id}`;
    const isNew = await checkAndRecordSend(sendKey, "sms");
    if (isNew) {
      console.log(`[STUB:SMS] Would send 1h coaching call reminder SMS for "${call.title}" (${call.scheduledAt.toISOString()})`);
    }
  }
}

async function processMentorshipExpirationWarnings(): Promise<void> {
  const now = new Date();
  const thirtyDaysFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  const expiring30d = await db
    .select({
      userId: userProductsTable.userId,
      userProductId: userProductsTable.id,
      productName: productsTable.name,
      expiresAt: userProductsTable.expiresAt,
      userEmail: usersTable.email,
    })
    .from(userProductsTable)
    .innerJoin(productsTable, eq(userProductsTable.productId, productsTable.id))
    .innerJoin(usersTable, eq(userProductsTable.userId, usersTable.id))
    .where(
      and(
        eq(userProductsTable.status, "active"),
        isNotNull(userProductsTable.expiresAt),
        gte(userProductsTable.expiresAt, now),
        lte(userProductsTable.expiresAt, thirtyDaysFromNow),
        eq(productsTable.type, "backend")
      )
    );

  for (const item of expiring30d) {
    const isUrgent = item.expiresAt && item.expiresAt <= sevenDaysFromNow;
    const tier = isUrgent ? "7d" : "30d";
    const sendKey = `mentorship_expiration_${tier}_${item.userProductId}`;
    const isNew = await checkAndRecordSend(sendKey, "email");
    if (isNew) {
      if (isUrgent) {
        console.log(`[STUB:EMAIL] Would send 7-day mentorship expiration warning to ${item.userEmail} for "${item.productName}"`);
      } else {
        console.log(`[STUB:EMAIL] Would send 30-day mentorship expiration warning to ${item.userEmail} for "${item.productName}"`);
      }
    }
  }

  const expired = await db
    .select({
      userId: userProductsTable.userId,
      userProductId: userProductsTable.id,
      productName: productsTable.name,
      expiresAt: userProductsTable.expiresAt,
      userEmail: usersTable.email,
    })
    .from(userProductsTable)
    .innerJoin(productsTable, eq(userProductsTable.productId, productsTable.id))
    .innerJoin(usersTable, eq(userProductsTable.userId, usersTable.id))
    .where(
      and(
        eq(userProductsTable.status, "expired"),
        isNotNull(userProductsTable.expiresAt),
        gte(userProductsTable.expiresAt, new Date(now.getTime() - 24 * 60 * 60 * 1000)),
        eq(productsTable.type, "backend")
      )
    );

  for (const item of expired) {
    const sendKey = `mentorship_expired_${item.userProductId}`;
    const isNew = await checkAndRecordSend(sendKey, "email");
    if (isNew) {
      console.log(`[STUB:EMAIL] Would send mentorship EXPIRED notice to ${item.userEmail} for "${item.productName}"`);
    }
  }
}

async function processSessionFeedbackPrompts(): Promise<void> {
  const now = new Date();
  const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const twentyFiveHoursAgo = new Date(now.getTime() - 25 * 60 * 60 * 1000);

  const completedCalls = await db
    .select({
      id: coachingCallsTable.id,
      title: coachingCallsTable.title,
      scheduledAt: coachingCallsTable.scheduledAt,
    })
    .from(coachingCallsTable)
    .where(
      and(
        lt(coachingCallsTable.scheduledAt, twentyFourHoursAgo),
        gte(coachingCallsTable.scheduledAt, twentyFiveHoursAgo),
        isNotNull(coachingCallsTable.recordingUrl)
      )
    );

  for (const call of completedCalls) {
    const sendKey = `session_feedback_${call.id}`;
    const isNew = await checkAndRecordSend(sendKey, "email");
    if (isNew) {
      console.log(`[STUB:EMAIL] Would send session feedback prompt for "${call.title}" (ended ~24h ago)`);
    }
  }
}

async function processCommissionNotifications(): Promise<void> {
  console.log("[Scheduled Comms] Commission notifications check — no commission table yet, skipping");
}

async function processScheduledComms(): Promise<void> {
  console.log("[Scheduled Comms] Running scheduled communications check");

  await processCoachingCallReminders();
  await processMentorshipExpirationWarnings();
  await processSessionFeedbackPrompts();
  await processCommissionNotifications();

  console.log("[Scheduled Comms] Scheduled communications check complete");
}

async function processInactivityCheck(): Promise<void> {
  console.log("[Inactivity Check] Running nightly inactivity check");

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const inactiveUsers = await db
    .select({
      id: usersTable.id,
      email: usersTable.email,
      lastLoginAt: usersTable.lastLoginAt,
    })
    .from(usersTable)
    .where(
      and(
        eq(usersTable.role, "member"),
        isNotNull(usersTable.lastLoginAt),
        lt(usersTable.lastLoginAt, sevenDaysAgo)
      )
    );

  let enrolledCount = 0;

  for (const user of inactiveUsers) {
    const [existingEnrollment] = await db
      .select({ id: sequenceEnrollmentsTable.id })
      .from(sequenceEnrollmentsTable)
      .innerJoin(sequencesTable, eq(sequenceEnrollmentsTable.sequenceId, sequencesTable.id))
      .where(
        and(
          eq(sequenceEnrollmentsTable.userId, user.id),
          eq(sequencesTable.slug, "reengagement"),
          eq(sequenceEnrollmentsTable.status, "active")
        )
      )
      .limit(1);

    if (!existingEnrollment) {
      const result = await enrollInSequence(user.id, "reengagement", {
        reason: "inactivity",
        lastLoginAt: user.lastLoginAt?.toISOString(),
      });
      if (result.enrolled) {
        enrolledCount++;
      }
    }
  }

  console.log(
    `[Inactivity Check] Found ${inactiveUsers.length} inactive users, enrolled ${enrolledCount} in reengagement sequence`
  );
}

export async function startScheduledComms(): Promise<void> {
  if (worker) return;

  try {
    const q = getQueue();

    await q.add("scheduled-comms", { type: "scheduled" }, {
      repeat: { every: 15 * 60 * 1000 },
      jobId: "scheduled-comms-processor",
    });

    await q.add("inactivity-check", { type: "inactivity" }, {
      repeat: {
        pattern: "0 2 * * *",
      },
      jobId: "nightly-inactivity-check",
    });

    worker = new Worker(
      QUEUE_NAME,
      async (job: Job) => {
        if (job.name === "inactivity-check") {
          await processInactivityCheck();
        } else {
          await processScheduledComms();
        }
      },
      {
        connection: getConnection(),
        concurrency: 1,
      }
    );

    worker.on("completed", (job) => {
      console.log(`[Scheduled Comms] Job ${job.id} completed: ${job.name}`);
    });

    worker.on("failed", (job, err) => {
      console.error(`[Scheduled Comms] Job ${job?.id} failed: ${err.message}`);
    });

    worker.on("error", (err) => {
      console.error("[Scheduled Comms] Worker error:", err.message);
    });

    console.log("[Scheduled Comms] Started — running every 15 minutes + nightly inactivity check at 2am");
  } catch (error) {
    console.error("[Scheduled Comms] Failed to start:", error);
  }
}

export async function shutdownScheduledComms(): Promise<void> {
  if (worker) {
    await worker.close();
    worker = null;
  }
  if (queue) {
    await queue.close();
    queue = null;
  }
  if (connection) {
    await connection.quit();
    connection = null;
  }
}
