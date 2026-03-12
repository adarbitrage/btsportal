import { Queue, Worker, type Job, type ConnectionOptions } from "bullmq";
import IORedis from "ioredis";
import crypto from "crypto";
import { db, webhookSubscriptionsTable, webhookDeliveriesTable } from "@workspace/db";
import { eq, and, lte, sql } from "drizzle-orm";

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
const QUEUE_NAME = "outgoing-webhooks";
const MAX_ATTEMPTS = 5;
const BACKOFF_SCHEDULE = [30_000, 120_000, 900_000, 3_600_000, 21_600_000];
const DELIVERY_TIMEOUT_MS = 30_000;
const AUTO_DISABLE_FAILURE_DAYS = 3;

let connection: IORedis | null = null;
let queue: Queue | null = null;
let worker: Worker | null = null;

function getConnection(): ConnectionOptions {
  if (!connection) {
    connection = new IORedis(REDIS_URL, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      lazyConnect: true,
    });
    connection.on("error", (err) => {
      console.error("[Outgoing Webhook Queue] Redis connection error:", err.message);
    });
  }
  return connection as unknown as ConnectionOptions;
}

function getQueue(): Queue {
  if (!queue) {
    queue = new Queue(QUEUE_NAME, {
      connection: getConnection(),
      defaultJobOptions: {
        attempts: MAX_ATTEMPTS,
        backoff: { type: "custom" },
        removeOnComplete: { count: 5000 },
        removeOnFail: { count: 10000 },
      },
    });
  }
  return queue;
}

export interface OutgoingWebhookJobData {
  deliveryId: number;
  subscriptionId: number;
  targetUrl: string;
  secret: string;
  eventType: string;
  eventId: string;
  payload: Record<string, unknown>;
}

function signPayload(payload: string, secret: string, timestamp: number): string {
  const toSign = `${timestamp}.${payload}`;
  return crypto.createHmac("sha256", secret).update(toSign).digest("hex");
}

async function processDelivery(job: Job<OutgoingWebhookJobData>): Promise<void> {
  const { deliveryId, subscriptionId, targetUrl, secret, eventType, eventId, payload } = job.data;
  const timestamp = Math.floor(Date.now() / 1000);
  const body = JSON.stringify(payload);
  const signature = signPayload(body, secret, timestamp);

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);

    const response = await fetch(targetUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-BTS-Webhook-Id": eventId,
        "X-BTS-Webhook-Timestamp": String(timestamp),
        "X-BTS-Webhook-Signature": `sha256=${signature}`,
        "X-BTS-Webhook-Event": eventType,
        "User-Agent": "BTS-Webhooks/1.0",
      },
      body,
      signal: controller.signal,
    });

    clearTimeout(timeout);

    const responseText = await response.text().catch(() => "");
    const truncatedResponse = responseText.substring(0, 2000);

    if (response.ok) {
      await db.update(webhookDeliveriesTable).set({
        status: "delivered",
        httpStatus: response.status,
        responseBody: truncatedResponse,
        attemptCount: job.attemptsMade + 1,
        completedAt: new Date(),
      }).where(eq(webhookDeliveriesTable.id, deliveryId));

      await db.update(webhookSubscriptionsTable).set({
        lastSuccessAt: new Date(),
        consecutiveFailureDays: 0,
      }).where(eq(webhookSubscriptionsTable.id, subscriptionId));

      console.log(`[Outgoing Webhook] Delivered ${eventType} to subscription ${subscriptionId} (HTTP ${response.status})`);
    } else {
      const isFinal = job.attemptsMade + 1 >= MAX_ATTEMPTS;
      await db.update(webhookDeliveriesTable).set({
        status: isFinal ? "failed" : "retrying",
        httpStatus: response.status,
        responseBody: truncatedResponse,
        attemptCount: job.attemptsMade + 1,
        errorMessage: `HTTP ${response.status}`,
        nextRetryAt: isFinal ? null : new Date(Date.now() + (BACKOFF_SCHEDULE[job.attemptsMade] || BACKOFF_SCHEDULE[BACKOFF_SCHEDULE.length - 1])),
        completedAt: isFinal ? new Date() : null,
      }).where(eq(webhookDeliveriesTable.id, deliveryId));

      if (isFinal) {
        await handlePersistentFailure(subscriptionId);
      }

      throw new Error(`HTTP ${response.status}: ${truncatedResponse.substring(0, 200)}`);
    }
  } catch (error: unknown) {
    if (error instanceof Error && error.message.startsWith("HTTP ")) {
      throw error;
    }

    const errorMessage = error instanceof Error ? error.message : String(error);
    const isFinal = job.attemptsMade + 1 >= MAX_ATTEMPTS;

    await db.update(webhookDeliveriesTable).set({
      status: isFinal ? "failed" : "retrying",
      attemptCount: job.attemptsMade + 1,
      errorMessage: errorMessage.substring(0, 500),
      nextRetryAt: isFinal ? null : new Date(Date.now() + (BACKOFF_SCHEDULE[job.attemptsMade] || BACKOFF_SCHEDULE[BACKOFF_SCHEDULE.length - 1])),
      completedAt: isFinal ? new Date() : null,
    }).where(eq(webhookDeliveriesTable.id, deliveryId));

    if (isFinal) {
      await handlePersistentFailure(subscriptionId);
    }

    throw error;
  }
}

async function handlePersistentFailure(subscriptionId: number): Promise<void> {
  try {
    const [sub] = await db.select({
      consecutiveFailureDays: webhookSubscriptionsTable.consecutiveFailureDays,
      lastFailureAt: webhookSubscriptionsTable.lastFailureAt,
    }).from(webhookSubscriptionsTable).where(eq(webhookSubscriptionsTable.id, subscriptionId)).limit(1);

    if (!sub) return;

    const now = new Date();
    const lastFailure = sub.lastFailureAt;
    const isNewDay = !lastFailure || (now.getTime() - lastFailure.getTime()) > 24 * 60 * 60 * 1000;

    const newFailureDays = isNewDay ? sub.consecutiveFailureDays + 1 : sub.consecutiveFailureDays;

    const updates: Record<string, unknown> = {
      lastFailureAt: now,
      consecutiveFailureDays: newFailureDays,
    };

    if (newFailureDays >= AUTO_DISABLE_FAILURE_DAYS) {
      updates.active = false;
      updates.disabledAt = now;
      updates.disabledReason = `Auto-disabled after ${AUTO_DISABLE_FAILURE_DAYS} consecutive days of delivery failures`;
      console.warn(`[Outgoing Webhook] Auto-disabled subscription ${subscriptionId} after ${AUTO_DISABLE_FAILURE_DAYS} days of failures`);
    }

    await db.update(webhookSubscriptionsTable).set(updates).where(eq(webhookSubscriptionsTable.id, subscriptionId));
  } catch (err) {
    console.error("[Outgoing Webhook] Error handling persistent failure:", err);
  }
}

export async function queueDelivery(data: OutgoingWebhookJobData): Promise<string | null> {
  try {
    const q = getQueue();
    const job = await q.add(`deliver:${data.eventType}`, data, {
      backoff: { type: "custom" },
    });
    return job.id || null;
  } catch (error) {
    console.error("[Outgoing Webhook] Failed to queue delivery:", error);
    return null;
  }
}

export async function retryDelivery(deliveryId: number): Promise<boolean> {
  try {
    const [delivery] = await db.select().from(webhookDeliveriesTable)
      .where(eq(webhookDeliveriesTable.id, deliveryId)).limit(1);

    if (!delivery) return false;
    if (delivery.status === "delivered" || delivery.status === "pending" || delivery.status === "retrying") return false;

    const [sub] = await db.select().from(webhookSubscriptionsTable)
      .where(eq(webhookSubscriptionsTable.id, delivery.subscriptionId)).limit(1);

    if (!sub) return false;

    await db.update(webhookDeliveriesTable).set({
      status: "retrying",
      attemptCount: 0,
      errorMessage: null,
      httpStatus: null,
      responseBody: null,
      completedAt: null,
      nextRetryAt: null,
    }).where(eq(webhookDeliveriesTable.id, deliveryId));

    await queueDelivery({
      deliveryId: delivery.id,
      subscriptionId: delivery.subscriptionId,
      targetUrl: sub.targetUrl,
      secret: sub.secret,
      eventType: delivery.eventType,
      eventId: delivery.eventId,
      payload: delivery.payload as Record<string, unknown>,
    });

    return true;
  } catch (error) {
    console.error("[Outgoing Webhook] Failed to retry delivery:", error);
    return false;
  }
}

export function startOutgoingWebhookWorker(): void {
  if (worker) return;

  try {
    worker = new Worker(QUEUE_NAME, processDelivery, {
      connection: getConnection(),
      concurrency: 10,
      settings: {
        backoffStrategy: (attemptsMade: number) => {
          return BACKOFF_SCHEDULE[attemptsMade - 1] || BACKOFF_SCHEDULE[BACKOFF_SCHEDULE.length - 1];
        },
      },
    });

    worker.on("completed", (job) => {
      console.log(`[Outgoing Webhook Worker] Job ${job.id} completed`);
    });

    worker.on("failed", (job, err) => {
      console.error(`[Outgoing Webhook Worker] Job ${job?.id} failed: ${err.message}`);
    });

    worker.on("error", (err) => {
      console.error("[Outgoing Webhook Worker] Worker error:", err.message);
    });

    console.log("[Outgoing Webhook Worker] Started processing outgoing webhook deliveries");
  } catch (error) {
    console.error("[Outgoing Webhook Worker] Failed to start worker:", error);
  }
}

export async function shutdownOutgoingWebhookQueue(): Promise<void> {
  if (worker) {
    await worker.close();
    worker = null;
  }
  if (queue) {
    await queue.close();
    queue = null;
  }
}
