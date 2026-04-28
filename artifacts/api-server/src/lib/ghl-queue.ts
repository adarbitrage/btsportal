import { Queue, Worker, type Job, type ConnectionOptions } from "bullmq";
import IORedis from "ioredis";
import { db, ghlSyncLogTable, ghlConfigTable, usersTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import * as ghlClient from "./ghl-client";

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
const QUEUE_NAME = "ghl-sync";
const RATE_LIMIT_MAX = 90;
const RATE_LIMIT_DURATION = 60000;
const MAX_ATTEMPTS = 5;
const BASE_DELAY = 30000;

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
      console.error("[GHL Queue] Redis connection error:", err.message);
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
        backoff: {
          type: "exponential",
          delay: BASE_DELAY,
        },
        removeOnComplete: { count: 1000 },
        removeOnFail: { count: 5000 },
      },
    });
  }
  return queue;
}

export interface GHLSyncJobData {
  action: string;
  userId?: number;
  email?: string;
  name?: string;
  phone?: string;
  tags?: string[];
  removeTags?: string[];
  customFields?: Record<string, string>;
  pipelineId?: string;
  stageId?: string;
  noteBody?: string;
  taskTitle?: string;
  taskBody?: string;
  taskDueDate?: string;
  contactId?: string;
  metadata?: Record<string, unknown>;
}

async function isSyncEnabled(): Promise<boolean> {
  try {
    const [config] = await db
      .select()
      .from(ghlConfigTable)
      .where(and(eq(ghlConfigTable.configKey, "sync_enabled"), eq(ghlConfigTable.enabled, true)))
      .limit(1);
    if (config && config.configValue === "false") {
      return false;
    }
    return true;
  } catch {
    return true;
  }
}

async function resolveContactId(
  userId: number | undefined,
  email: string | undefined,
  name: string | undefined
): Promise<string | null> {
  if (!email && userId) {
    const [user] = await db
      .select({ email: usersTable.email, ghlContactId: usersTable.ghlContactId, name: usersTable.name })
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .limit(1);
    if (!user) return null;
    if (user.ghlContactId) return user.ghlContactId;
    email = user.email;
    name = name || user.name;
  }

  if (!email) return null;

  let contactId = await ghlClient.searchContactByEmail(email);

  if (!contactId) {
    contactId = await ghlClient.createContact({
      email,
      name: name || "Unknown",
    });
  }

  if (contactId && userId) {
    await db
      .update(usersTable)
      .set({ ghlContactId: contactId })
      .where(eq(usersTable.id, userId));
  }

  return contactId;
}

async function processJob(job: Job<GHLSyncJobData>): Promise<void> {
  const { action, userId, email, name, contactId: providedContactId } = job.data;

  let logId: number | undefined;

  try {
    const [logEntry] = await db
      .insert(ghlSyncLogTable)
      .values({
        userId: userId || null,
        action,
        direction: "outbound",
        payload: job.data as unknown as Record<string, unknown>,
        status: "processing",
        attempts: job.attemptsMade + 1,
      })
      .returning();
    logId = logEntry.id;
  } catch (err) {
    console.error("[GHL Worker] Failed to create log entry:", err);
  }

  try {
    const contactId = providedContactId || (await resolveContactId(userId, email, name));

    if (!contactId && action !== "create_contact") {
      throw new Error("Could not resolve GHL contact ID");
    }

    switch (action) {
      case "create_contact": {
        const newId = await resolveContactId(userId, email, name);
        if (newId) {
          if (job.data.tags && job.data.tags.length > 0) {
            await ghlClient.addTags(newId, job.data.tags);
          }
          if (job.data.customFields || job.data.phone) {
            await ghlClient.updateContact(newId, {
              phone: job.data.phone,
              customField: job.data.customFields,
            });
          }
        }
        if (logId) {
          await db
            .update(ghlSyncLogTable)
            .set({ ghlContactId: newId, status: "completed", processedAt: new Date() })
            .where(eq(ghlSyncLogTable.id, logId));
        }
        break;
      }
      case "update_contact": {
        await ghlClient.updateContact(contactId!, {
          name: job.data.name,
          phone: job.data.phone,
          email: job.data.email,
          customField: job.data.customFields,
        });
        if (logId) {
          await db
            .update(ghlSyncLogTable)
            .set({ ghlContactId: contactId, status: "completed", processedAt: new Date() })
            .where(eq(ghlSyncLogTable.id, logId));
        }
        break;
      }
      case "add_tags": {
        if (job.data.tags && job.data.tags.length > 0) {
          await ghlClient.addTags(contactId!, job.data.tags);
        }
        if (job.data.customFields) {
          await ghlClient.updateContact(contactId!, {
            customField: job.data.customFields,
          });
        }
        if (logId) {
          await db
            .update(ghlSyncLogTable)
            .set({ ghlContactId: contactId, status: "completed", processedAt: new Date() })
            .where(eq(ghlSyncLogTable.id, logId));
        }
        break;
      }
      case "remove_tags": {
        if (job.data.removeTags && job.data.removeTags.length > 0) {
          await ghlClient.removeTags(contactId!, job.data.removeTags);
        }
        if (logId) {
          await db
            .update(ghlSyncLogTable)
            .set({ ghlContactId: contactId, status: "completed", processedAt: new Date() })
            .where(eq(ghlSyncLogTable.id, logId));
        }
        break;
      }
      case "move_pipeline": {
        await ghlClient.movePipeline({
          contactId: contactId!,
          pipelineId: job.data.pipelineId!,
          stageId: job.data.stageId!,
        });
        if (logId) {
          await db
            .update(ghlSyncLogTable)
            .set({ ghlContactId: contactId, status: "completed", processedAt: new Date() })
            .where(eq(ghlSyncLogTable.id, logId));
        }
        break;
      }
      case "add_note": {
        await ghlClient.addNote({
          contactId: contactId!,
          body: job.data.noteBody || "",
        });
        if (logId) {
          await db
            .update(ghlSyncLogTable)
            .set({ ghlContactId: contactId, status: "completed", processedAt: new Date() })
            .where(eq(ghlSyncLogTable.id, logId));
        }
        break;
      }
      case "create_task": {
        await ghlClient.createTask({
          contactId: contactId!,
          title: job.data.taskTitle || "Portal Task",
          body: job.data.taskBody,
          dueDate: job.data.taskDueDate,
        });
        if (logId) {
          await db
            .update(ghlSyncLogTable)
            .set({ ghlContactId: contactId, status: "completed", processedAt: new Date() })
            .where(eq(ghlSyncLogTable.id, logId));
        }
        break;
      }
      default:
        console.warn(`[GHL Worker] Unknown action: ${action}`);
        if (logId) {
          await db
            .update(ghlSyncLogTable)
            .set({ status: "failed", errorMessage: `Unknown action: ${action}`, processedAt: new Date() })
            .where(eq(ghlSyncLogTable.id, logId));
        }
    }

    console.log(`[GHL Worker] Completed job ${job.id}: ${action} for userId=${userId}`);
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[GHL Worker] Job ${job.id} failed (attempt ${job.attemptsMade + 1}): ${errorMessage}`);

    if (logId) {
      const isFinalAttempt = job.attemptsMade + 1 >= MAX_ATTEMPTS;
      await db
        .update(ghlSyncLogTable)
        .set({
          status: isFinalAttempt ? "failed" : "retrying",
          errorMessage,
          attempts: job.attemptsMade + 1,
          processedAt: isFinalAttempt ? new Date() : undefined,
        })
        .where(eq(ghlSyncLogTable.id, logId));
    }

    throw error;
  }
}

export async function queueGHLSync(data: GHLSyncJobData): Promise<string | null> {
  if (!ghlClient.isConfigured()) {
    console.log(`[GHL Sync] Skipped ${data.action} — GHL not configured`);
    return null;
  }

  const enabled = await isSyncEnabled();
  if (!enabled) {
    console.log(`[GHL Sync] Skipped ${data.action} — sync disabled via kill switch`);
    return null;
  }

  try {
    const q = getQueue();
    const job = await q.add(data.action, data);
    console.log(`[GHL Sync] Queued ${data.action} (job ${job.id}) for userId=${data.userId}`);
    return job.id || null;
  } catch (error) {
    console.error(`[GHL Sync] Failed to queue ${data.action}:`, error);
    return null;
  }
}

export function startWorker(): void {
  if (worker) return;

  try {
    worker = new Worker(QUEUE_NAME, processJob, {
      connection: getConnection(),
      concurrency: 5,
      limiter: {
        max: RATE_LIMIT_MAX,
        duration: RATE_LIMIT_DURATION,
      },
    });

    worker.on("completed", (job) => {
      console.log(`[GHL Worker] Job ${job.id} completed: ${job.name}`);
    });

    worker.on("failed", (job, err) => {
      console.error(`[GHL Worker] Job ${job?.id} failed: ${err.message}`);
    });

    worker.on("error", (err) => {
      console.error("[GHL Worker] Worker error:", err.message);
    });

    console.log("[GHL Worker] Started processing GHL sync jobs");
  } catch (error) {
    console.error("[GHL Worker] Failed to start worker:", error);
  }
}

export async function getQueueStatus(): Promise<{
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
}> {
  try {
    const q = getQueue();
    const [waiting, active, completed, failed, delayed] = await Promise.all([
      q.getWaitingCount(),
      q.getActiveCount(),
      q.getCompletedCount(),
      q.getFailedCount(),
      q.getDelayedCount(),
    ]);
    return { waiting, active, completed, failed, delayed };
  } catch {
    return { waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0 };
  }
}

export async function retryJob(jobId: string): Promise<boolean> {
  try {
    const q = getQueue();
    const job = await q.getJob(jobId);
    if (!job) return false;
    await job.retry();
    return true;
  } catch {
    return false;
  }
}

export async function shutdown(): Promise<void> {
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
