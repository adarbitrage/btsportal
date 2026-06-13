/**
 * BullMQ queue for async, non-blocking TicketDesk conversation delivery.
 *
 * Mirrors the GHL sync queue pattern so TicketDesk outages never slow or
 * fail a member's ticket-create request.  Jobs retry up to MAX_ATTEMPTS
 * times with exponential back-off; failures are logged to console and
 * are observable in the queue's failed-job list.
 *
 * Queue is disabled (no-op) in test environments without an explicit
 * REDIS_URL — same guard used by the GHL queue to keep unit tests clean.
 */

import { Queue, Worker, type Job, type ConnectionOptions } from "bullmq";
import IORedis from "ioredis";
import * as ticketDesk from "./ticketdesk-client";
import { type TicketDeskConversationInput } from "./ticketdesk-client";
import { QUEUE_REDIS_OPTIONS, makeThrottledRedisErrorLogger } from "./redis";

const EXPLICIT_REDIS_URL = process.env.REDIS_URL;
const REDIS_URL = EXPLICIT_REDIS_URL || "redis://localhost:6379";
const QUEUE_NAME = "ticketdesk-delivery";
const MAX_ATTEMPTS = 5;
const BASE_DELAY = 30_000;

const IS_TEST_ENV =
  process.env.NODE_ENV === "test" || process.env.VITEST === "true";
const QUEUE_DISABLED = IS_TEST_ENV && !EXPLICIT_REDIS_URL;

let connection: IORedis | null = null;
let queue: Queue | null = null;
let worker: Worker | null = null;
let warnedDisabled = false;

function warnDisabledOnce(): void {
  if (warnedDisabled) return;
  warnedDisabled = true;
  console.log(
    "[TicketDesk Queue] Disabled (no REDIS_URL in test environment); jobs are no-ops.",
  );
}

function getConnection(): ConnectionOptions {
  if (!connection) {
    connection = new IORedis(REDIS_URL, { ...QUEUE_REDIS_OPTIONS });
    connection.on("error", makeThrottledRedisErrorLogger("[TicketDesk Queue]"));
  }
  return connection as unknown as ConnectionOptions;
}

function getQueue(): Queue {
  if (!queue) {
    queue = new Queue(QUEUE_NAME, {
      connection: getConnection(),
      defaultJobOptions: {
        attempts: MAX_ATTEMPTS,
        backoff: { type: "exponential", delay: BASE_DELAY },
        removeOnComplete: { count: 1000 },
        removeOnFail: { count: 5000 },
      },
    });
  }
  return queue;
}

export type TicketDeskDeliveryJobData = TicketDeskConversationInput;

async function processJob(
  job: Job<TicketDeskDeliveryJobData>,
): Promise<void> {
  const { contactEmail, btsTicketNumber } = job.data;
  try {
    const result = await ticketDesk.createConversation(job.data);
    console.log(
      `[TicketDesk Queue] Delivered ticket ${btsTicketNumber} for ${contactEmail} → conversation ${result.id}`,
    );
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(
      `[TicketDesk Queue] Job ${job.id} failed (attempt ${job.attemptsMade + 1}/${MAX_ATTEMPTS}) for ticket ${btsTicketNumber}: ${msg}`,
    );
    throw error;
  }
}

/**
 * Enqueues a TicketDesk conversation delivery job.
 * Returns the job ID, or null when the queue is disabled or TicketDesk is
 * not configured (TICKETDESK_API_KEY absent).
 */
export async function queueTicketDeskDelivery(
  data: TicketDeskDeliveryJobData,
): Promise<string | null> {
  if (QUEUE_DISABLED) {
    warnDisabledOnce();
    return null;
  }

  if (!ticketDesk.isConfigured()) {
    console.log(
      `[TicketDesk Queue] Skipped delivery for ${data.btsTicketNumber} — TICKETDESK_API_KEY not configured`,
    );
    return null;
  }

  try {
    const q = getQueue();
    const job = await q.add("create_conversation", data);
    console.log(
      `[TicketDesk Queue] Queued delivery for ticket ${data.btsTicketNumber} (job ${job.id})`,
    );
    return job.id ?? null;
  } catch (error) {
    console.error(
      `[TicketDesk Queue] Failed to enqueue delivery for ${data.btsTicketNumber}:`,
      error,
    );
    return null;
  }
}

export function startTicketDeskWorker(): void {
  if (QUEUE_DISABLED) {
    warnDisabledOnce();
    return;
  }
  if (worker) return;

  try {
    worker = new Worker(QUEUE_NAME, processJob, {
      connection: getConnection(),
      concurrency: 3,
    });

    worker.on("completed", (job) => {
      console.log(
        `[TicketDesk Worker] Job ${job.id} completed: ${job.name}`,
      );
    });

    worker.on("failed", (job, err) => {
      console.error(
        `[TicketDesk Worker] Job ${job?.id} failed: ${err.message}`,
      );
    });

    worker.on("error", (err) => {
      console.error("[TicketDesk Worker] Worker error:", err.message);
    });

    console.log("[TicketDesk Worker] Started processing delivery jobs");
  } catch (error) {
    console.error("[TicketDesk Worker] Failed to start worker:", error);
  }
}

export async function shutdownTicketDeskQueue(): Promise<void> {
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
