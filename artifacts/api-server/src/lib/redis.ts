import IORedis from "ioredis";

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

const REDIS_CONNECT_TIMEOUT_MS = Number.parseInt(
  process.env.REDIS_CONNECT_TIMEOUT_MS || "2000",
  10,
);

let connection: IORedis | null = null;

export function getRedisConnection(): IORedis {
  if (!connection) {
    connection = new IORedis(REDIS_URL, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      connectTimeout: REDIS_CONNECT_TIMEOUT_MS,
    });
    connection.on("error", (err) => {
      console.error("[Redis] Connection error:", err.message);
    });
  }
  return connection;
}

export function createRedisConnection(): IORedis {
  return new IORedis(REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    connectTimeout: REDIS_CONNECT_TIMEOUT_MS,
  });
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
