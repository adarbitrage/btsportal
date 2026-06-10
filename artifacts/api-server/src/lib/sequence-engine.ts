import { Queue, Worker, type Job, type ConnectionOptions } from "bullmq";
import IORedis from "ioredis";
import {
  db,
  sequenceEnrollmentsTable,
  sequenceStepsTable,
  sequencesTable,
  usersTable,
  userProductsTable,
  productsTable,
} from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { QUEUE_REDIS_OPTIONS, makeThrottledRedisErrorLogger } from "./redis";

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
const QUEUE_NAME = "sequence-engine";

let connection: IORedis | null = null;
let queue: Queue | null = null;
let worker: Worker | null = null;

function getConnection(): ConnectionOptions {
  if (!connection) {
    connection = new IORedis(REDIS_URL, { ...QUEUE_REDIS_OPTIONS });
    connection.on("error", makeThrottledRedisErrorLogger("[Sequence Engine]"));
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

async function evaluateConditions(
  userId: number,
  conditions: {
    ifNotCompleted?: string;
    ifNotLoggedIn?: boolean;
    ifProductLevel?: string[];
  } | null
): Promise<boolean> {
  if (!conditions) return true;

  if (conditions.ifNotCompleted === "onboarding") {
    const [user] = await db
      .select({ onboardingComplete: usersTable.onboardingComplete })
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .limit(1);
    if (user?.onboardingComplete) {
      console.log(`[Sequence Engine] Skipping step for user ${userId}: onboarding already completed`);
      return false;
    }
  }

  if (conditions.ifNotLoggedIn) {
    const [user] = await db
      .select({ lastLoginAt: usersTable.lastLoginAt })
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .limit(1);
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    if (user?.lastLoginAt && user.lastLoginAt > sevenDaysAgo) {
      console.log(`[Sequence Engine] Skipping step for user ${userId}: user has logged in recently`);
      return false;
    }
  }

  if (conditions.ifProductLevel && conditions.ifProductLevel.length > 0) {
    const userProducts = await db
      .select({ slug: productsTable.slug })
      .from(userProductsTable)
      .innerJoin(productsTable, eq(userProductsTable.productId, productsTable.id))
      .where(
        and(
          eq(userProductsTable.userId, userId),
          eq(userProductsTable.status, "active")
        )
      );
    const userSlugs = userProducts.map((p) => p.slug);
    const hasRequiredProduct = conditions.ifProductLevel.some((slug) => userSlugs.includes(slug));
    if (!hasRequiredProduct) {
      console.log(`[Sequence Engine] Skipping step for user ${userId}: does not have required product level`);
      return false;
    }
  }

  return true;
}

async function processSequences(): Promise<void> {
  const activeEnrollments = await db
    .select({
      enrollment: sequenceEnrollmentsTable,
      sequence: sequencesTable,
    })
    .from(sequenceEnrollmentsTable)
    .innerJoin(sequencesTable, eq(sequenceEnrollmentsTable.sequenceId, sequencesTable.id))
    .where(
      and(
        eq(sequenceEnrollmentsTable.status, "active"),
        eq(sequencesTable.active, true)
      )
    );

  console.log(`[Sequence Engine] Processing ${activeEnrollments.length} active enrollments`);

  for (const { enrollment, sequence } of activeEnrollments) {
    try {
      const nextStepOrder = enrollment.currentStepOrder + 1;

      const [nextStep] = await db
        .select()
        .from(sequenceStepsTable)
        .where(
          and(
            eq(sequenceStepsTable.sequenceId, sequence.id),
            eq(sequenceStepsTable.stepOrder, nextStepOrder)
          )
        )
        .limit(1);

      if (!nextStep) {
        await db
          .update(sequenceEnrollmentsTable)
          .set({ status: "completed", completedAt: new Date() })
          .where(eq(sequenceEnrollmentsTable.id, enrollment.id));
        console.log(`[Sequence Engine] Enrollment ${enrollment.id} completed (no more steps)`);
        continue;
      }

      const enrolledAt = enrollment.enrolledAt;
      const minutesSinceEnrollment = (Date.now() - enrolledAt.getTime()) / (1000 * 60);

      if (minutesSinceEnrollment < nextStep.delayMinutes) {
        continue;
      }

      const conditions = nextStep.conditions as {
        ifNotCompleted?: string;
        ifNotLoggedIn?: boolean;
        ifProductLevel?: string[];
      } | null;

      const shouldSend = await evaluateConditions(enrollment.userId, conditions);

      if (shouldSend) {
        const [user] = await db
          .select({ email: usersTable.email, name: usersTable.name, phone: usersTable.phone })
          .from(usersTable)
          .where(eq(usersTable.id, enrollment.userId))
          .limit(1);

        if (user) {
          console.log(
            `[STUB:${nextStep.channel.toUpperCase()}] Would send "${nextStep.templateRef}" ` +
            `(subject: "${nextStep.subject || "N/A"}") to ${user.email} ` +
            `[Sequence: ${sequence.slug}, Step ${nextStepOrder}]`
          );
        }
      } else {
        console.log(
          `[Sequence Engine] Skipped step ${nextStepOrder} of "${sequence.slug}" for user ${enrollment.userId} (condition not met)`
        );
      }

      await db
        .update(sequenceEnrollmentsTable)
        .set({
          currentStepOrder: nextStepOrder,
          lastProcessedAt: new Date(),
        })
        .where(eq(sequenceEnrollmentsTable.id, enrollment.id));
    } catch (error) {
      console.error(`[Sequence Engine] Error processing enrollment ${enrollment.id}:`, error);
    }
  }
}

export async function startSequenceEngine(): Promise<void> {
  if (worker) return;

  try {
    const q = getQueue();

    await q.add("process-sequences", {}, {
      repeat: { every: 5 * 60 * 1000 },
      jobId: "sequence-processor",
    });

    worker = new Worker(
      QUEUE_NAME,
      async (_job: Job) => {
        await processSequences();
      },
      {
        connection: getConnection(),
        concurrency: 1,
      }
    );

    worker.on("completed", (job) => {
      console.log(`[Sequence Engine] Job ${job.id} completed`);
    });

    worker.on("failed", (job, err) => {
      console.error(`[Sequence Engine] Job ${job?.id} failed: ${err.message}`);
    });

    worker.on("error", (err) => {
      console.error("[Sequence Engine] Worker error:", err.message);
    });

    console.log("[Sequence Engine] Started — processing every 5 minutes");
  } catch (error) {
    console.error("[Sequence Engine] Failed to start:", error);
  }
}

export async function shutdownSequenceEngine(): Promise<void> {
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
