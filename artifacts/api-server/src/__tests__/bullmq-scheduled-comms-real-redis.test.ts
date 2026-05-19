/**
 * Integration test that exercises a BullMQ-backed queue + worker pair
 * against a real `redis-server`, mirroring the shape of the scheduled-comms
 * queue (and by extension the sequence-engine / outgoing-webhook / GHL
 * queues, which all wire BullMQ to Redis the same way).
 *
 * Why a real-Redis pass?
 * ---------------------
 * BullMQ uses a non-trivial pile of Lua scripts to atomically move jobs
 * between `wait`, `active`, `completed`, and `failed` states, plus Streams
 * (XADD/XREADGROUP) for delayed/repeated jobs. None of that is exercised
 * by the in-memory fakes we use elsewhere — a Redis-server upgrade or an
 * ioredis bump can silently break a single Lua call and we'd only see it
 * in production. This suite drives a minimal enqueue → process → complete
 * round-trip and a delayed-job round-trip to catch that drift.
 *
 * We deliberately do NOT exercise `../lib/scheduled-comms` directly — it
 * pulls in heavy DB-coupled handlers we'd have to mock just to ignore.
 * Standing up a Queue + Worker with the SAME ioredis configuration is
 * sufficient to catch BullMQ-on-real-Redis drift for every BullMQ queue
 * we run (scheduled comms, sequence engine, outgoing webhooks, GHL).
 *
 * Gating: opt-in via `RUN_REDIS_INTEGRATION_TESTS=1`.
 */
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
} from "vitest";
import { Queue, Worker, QueueEvents, type Job } from "bullmq";
import IORedis from "ioredis";
import {
  RUN_REDIS_INTEGRATION,
  redisUrl,
  startRealRedis,
  stopRealRedis,
  type RealRedis,
} from "./helpers/real-redis";

let realRedis: RealRedis | null = null;
let url = "";

// Each test creates its own queue/worker so a single failure doesn't bleed
// pending jobs into the next test. We track them here so afterEach can
// clean up even if a test throws mid-setup.
const trackedQueues: Queue[] = [];
const trackedWorkers: Worker[] = [];
const trackedEvents: QueueEvents[] = [];
const trackedConnections: IORedis[] = [];

function makeConnection(): IORedis {
  // BullMQ requires `maxRetriesPerRequest: null` on the connection used by
  // Workers (otherwise BRPOPLPUSH-style blocking reads throw). Mirror the
  // exact options scheduled-comms / sequence-engine use.
  const c = new IORedis(url, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });
  trackedConnections.push(c);
  return c;
}

describe.runIf(RUN_REDIS_INTEGRATION)(
  "BullMQ scheduled-comms-style queue against a real Redis",
  () => {
    beforeAll(async () => {
      realRedis = await startRealRedis();
      url = redisUrl(realRedis);
      process.env.REDIS_URL = url;
    }, 30_000);

    afterAll(async () => {
      delete process.env.REDIS_URL;
      await stopRealRedis(realRedis);
      realRedis = null;
    }, 30_000);

    afterEach(async () => {
      // Close workers first so they stop pulling jobs, then queues / events,
      // then the bare connections. We swallow errors because a half-set-up
      // test can leave a worker in a state where `close` rejects — we still
      // want the rest of the cleanup to run.
      for (const w of trackedWorkers.splice(0)) {
        try {
          await w.close();
        } catch {
          /* best effort */
        }
      }
      for (const q of trackedQueues.splice(0)) {
        try {
          await q.close();
        } catch {
          /* best effort */
        }
      }
      for (const e of trackedEvents.splice(0)) {
        try {
          await e.close();
        } catch {
          /* best effort */
        }
      }
      for (const c of trackedConnections.splice(0)) {
        try {
          await c.quit();
        } catch {
          /* best effort */
        }
      }

      // FLUSHDB between tests so BullMQ's own bookkeeping keys (bull:*) go
      // away. We open a one-shot connection for the flush so we don't have
      // to keep one around.
      const flusher = new IORedis(url, { maxRetriesPerRequest: null });
      try {
        await flusher.flushdb();
      } finally {
        await flusher.quit();
      }
    });

    it("enqueues and processes a single job against real Redis", async () => {
      const queueName = `it-scheduled-comms-${Date.now()}`;
      const queue = new Queue(queueName, { connection: makeConnection() });
      trackedQueues.push(queue);

      const processed: Array<{ name: string; data: unknown }> = [];
      const worker = new Worker(
        queueName,
        async (job: Job) => {
          processed.push({ name: job.name, data: job.data });
          return { ok: true };
        },
        { connection: makeConnection(), concurrency: 1 },
      );
      trackedWorkers.push(worker);

      const events = new QueueEvents(queueName, { connection: makeConnection() });
      trackedEvents.push(events);
      await events.waitUntilReady();

      const job = await queue.add("scheduled-comms", {
        type: "scheduled",
        marker: "hello",
      });

      // QueueEvents.waitUntilFinished resolves when BullMQ writes the
      // job-completed event to the Stream — which is exactly the path that
      // depends on real Redis Streams support.
      const result = await job.waitUntilFinished(events, 10_000);
      expect(result).toEqual({ ok: true });

      expect(processed).toHaveLength(1);
      expect(processed[0].name).toBe("scheduled-comms");
      expect(processed[0].data).toEqual({ type: "scheduled", marker: "hello" });
    });

    it("processes delayed jobs after their delay elapses (Streams/ZSET delayed-set path)", async () => {
      // Delayed jobs live in a separate Redis ZSET (`bull:<name>:delayed`)
      // and are promoted to `wait` by BullMQ's delayed-job Lua script when
      // their `delay` has elapsed. This is one of the most Redis-specific
      // BullMQ paths, so it's the most valuable to drive against a real
      // server.
      const queueName = `it-delayed-${Date.now()}`;
      const queue = new Queue(queueName, { connection: makeConnection() });
      trackedQueues.push(queue);

      const startedAt = Date.now();
      let processedAt = 0;
      const worker = new Worker(
        queueName,
        async () => {
          processedAt = Date.now();
          return "done";
        },
        { connection: makeConnection(), concurrency: 1 },
      );
      trackedWorkers.push(worker);

      const events = new QueueEvents(queueName, { connection: makeConnection() });
      trackedEvents.push(events);
      await events.waitUntilReady();

      const job = await queue.add(
        "delayed-job",
        { type: "delayed" },
        { delay: 500 },
      );
      const result = await job.waitUntilFinished(events, 10_000);

      expect(result).toBe("done");
      // The job MUST have waited at least the configured delay. Allow a
      // small fudge for scheduler granularity, but it shouldn't fire
      // immediately (which would indicate the delayed-set Lua path was
      // bypassed entirely).
      expect(processedAt - startedAt).toBeGreaterThanOrEqual(400);
    });

    it("two workers on the same queue each process some of a burst (no double-processing)", async () => {
      // Two workers sharing a queue is the multi-pod story for our BullMQ
      // queues. Each job MUST be processed by exactly one worker — that's
      // a hard guarantee of BullMQ's atomic move-to-active Lua script and
      // the single property most likely to silently break on a redis or
      // ioredis upgrade.
      const queueName = `it-parallel-${Date.now()}`;
      const queue = new Queue(queueName, { connection: makeConnection() });
      trackedQueues.push(queue);

      const processedByA: string[] = [];
      const processedByB: string[] = [];
      const workerA = new Worker(
        queueName,
        async (job: Job) => {
          processedByA.push(job.data.id);
        },
        { connection: makeConnection(), concurrency: 4 },
      );
      const workerB = new Worker(
        queueName,
        async (job: Job) => {
          processedByB.push(job.data.id);
        },
        { connection: makeConnection(), concurrency: 4 },
      );
      trackedWorkers.push(workerA, workerB);

      const events = new QueueEvents(queueName, { connection: makeConnection() });
      trackedEvents.push(events);
      await events.waitUntilReady();

      const N = 25;
      const jobs = await Promise.all(
        Array.from({ length: N }, (_, i) =>
          queue.add("burst", { id: `j${i}` }),
        ),
      );
      await Promise.all(jobs.map((j) => j.waitUntilFinished(events, 10_000)));

      const all = [...processedByA, ...processedByB].sort();
      const expected = Array.from({ length: N }, (_, i) => `j${i}`).sort();
      // Every job processed exactly once, across both workers. This is the
      // hard BullMQ guarantee we care about — the move-to-active Lua
      // script must give each job to exactly one worker. We intentionally
      // do NOT assert that both workers got at least one job: under
      // scheduler timing a fast worker can legitimately drain the queue
      // before the second one wakes up, and we don't want flake on a
      // weaker, non-guaranteed property. The split is logged for visual
      // diagnostics only.
      expect(all).toEqual(expected);
      console.log(
        `[bullmq-real-redis] worker split: A=${processedByA.length} B=${processedByB.length}`,
      );
    });
  },
);
