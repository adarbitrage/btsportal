import IORedis from "ioredis";

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

let connection: IORedis | null = null;

export function getRedisConnection(): IORedis {
  if (!connection) {
    connection = new IORedis(REDIS_URL, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
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
  });
}

export function getRedis(): IORedis | null {
  if (!process.env.REDIS_URL) return null;
  return getRedisConnection();
}

export async function isRedisConnected(): Promise<boolean> {
  try {
    const r = getRedis();
    if (!r) return false;
    const pong = await r.ping();
    return pong === "PONG";
  } catch {
    return false;
  }
}
