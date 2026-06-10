import IORedis, { type RedisOptions } from "ioredis";

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

const REDIS_CONNECT_TIMEOUT_MS = Number.parseInt(
  process.env.REDIS_CONNECT_TIMEOUT_MS || "2000",
  10,
);

// Upper bound on the reconnect backoff. When Redis is unreachable (e.g. an
// optional background service is offline in a test environment), ioredis would
// otherwise retry on a tight schedule, flooding the event loop and log output
// with ECONNREFUSED errors every tick and starving real request handling.
const REDIS_MAX_RETRY_DELAY_MS = Number.parseInt(
  process.env.REDIS_MAX_RETRY_DELAY_MS || "30000",
  10,
);

/**
 * Exponential backoff for ioredis reconnect attempts, capped at
 * REDIS_MAX_RETRY_DELAY_MS. Without a cap-aware strategy the client hammers an
 * unreachable Redis every ~50ms, which floods the event loop and makes e2e
 * tests time out when optional background services aren't running.
 */
export function redisRetryStrategy(times: number): number {
  const exponent = Math.min(times, 10);
  return Math.min(1000 * 2 ** exponent, REDIS_MAX_RETRY_DELAY_MS);
}

/**
 * Returns an error handler that logs Redis connection errors at most once per
 * minute, collapsing the flood of identical reconnect errors that occurs when
 * Redis is unreachable into a single throttled line (with a suppressed count)
 * so real errors stay visible in the logs.
 */
export function makeThrottledRedisErrorLogger(
  label: string,
): (err: Error) => void {
  const INTERVAL_MS = 60_000;
  let lastLoggedAt = 0;
  let suppressed = 0;
  return (err: Error) => {
    const now = Date.now();
    if (now - lastLoggedAt >= INTERVAL_MS) {
      const extra =
        suppressed > 0 ? ` (${suppressed} similar errors suppressed)` : "";
      console.error(`${label} Redis connection error: ${err.message}${extra}`);
      lastLoggedAt = now;
      suppressed = 0;
    } else {
      suppressed += 1;
    }
  };
}

/**
 * Shared ioredis options for BullMQ queue/worker connections. Includes the
 * backoff retry strategy so an unreachable Redis backs off instead of spamming
 * reconnects. Spread into `new IORedis(url, { ...QUEUE_REDIS_OPTIONS })`.
 */
export const QUEUE_REDIS_OPTIONS: RedisOptions = {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  lazyConnect: true,
  retryStrategy: redisRetryStrategy,
};

let connection: IORedis | null = null;

export function getRedisConnection(): IORedis {
  if (!connection) {
    connection = new IORedis(REDIS_URL, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      connectTimeout: REDIS_CONNECT_TIMEOUT_MS,
      retryStrategy: redisRetryStrategy,
    });
    connection.on("error", makeThrottledRedisErrorLogger("[Redis]"));
  }
  return connection;
}

export function createRedisConnection(): IORedis {
  const conn = new IORedis(REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    connectTimeout: REDIS_CONNECT_TIMEOUT_MS,
    retryStrategy: redisRetryStrategy,
  });
  conn.on("error", makeThrottledRedisErrorLogger("[Redis]"));
  return conn;
}

export function getRedis(): IORedis | null {
  if (!process.env.REDIS_URL) return null;
  return getRedisConnection();
}

/**
 * Synchronous, non-blocking check that returns true only when a Redis
 * connection has already been opened and is currently in the "ready" state.
 * Returns false if no connection has been opened yet — it does NOT eagerly
 * create one. Useful as a hint, but never use it as the sole gate before
 * starting work, since a fresh process will report false until something else
 * has triggered connection setup.
 */
export function isRedisReady(): boolean {
  return connection?.status === "ready";
}

export async function isRedisConnected(): Promise<boolean> {
  try {
    const r = getRedis();
    if (!r) return false;
    if (r.status === "ready") return true;
    const pong = await Promise.race<string | null>([
      r.ping(),
      new Promise<null>((resolve) =>
        setTimeout(() => resolve(null), REDIS_CONNECT_TIMEOUT_MS),
      ),
    ]);
    return pong === "PONG";
  } catch {
    return false;
  }
}
