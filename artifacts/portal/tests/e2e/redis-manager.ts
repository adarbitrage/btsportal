import { execSync, execFileSync } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

// Auto-provisions a throwaway local Redis for the e2e run so the Redis-gated
// specs (e.g. the abuse-rate-limiter 429 case in verify-email-recovery.spec.ts)
// actually execute instead of skipping themselves. The whole thing is
// best-effort: if Redis can't be located or started, we return null and the
// gated specs fall back to skipping cleanly rather than failing the run.

function resolveBin(name: string): string | undefined {
  try {
    const found = execSync(`command -v ${name}`, { encoding: "utf8" }).trim();
    if (found) return found;
  } catch {
    /* not on PATH */
  }
  return undefined;
}

function resolveRedisCli(serverPath: string): string | undefined {
  // redis-cli normally ships alongside redis-server in the same bin dir.
  const sibling = join(dirname(serverPath), "redis-cli");
  if (existsSync(sibling)) return sibling;
  return resolveBin("redis-cli");
}

function sleepSync(ms: number): void {
  // execSync gives us a synchronous sleep without pulling in extra deps; the
  // config module that calls us runs synchronously before workers fork.
  try {
    execSync(`sleep ${(ms / 1000).toFixed(3)}`);
  } catch {
    /* ignore */
  }
}

function pingRedis(cliBin: string | undefined, port: number): boolean {
  if (!cliBin) return false;
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      const out = execFileSync(cliBin, ["-p", String(port), "ping"], {
        encoding: "utf8",
        timeout: 2000,
      }).trim();
      if (out.toUpperCase() === "PONG") return true;
    } catch {
      /* not ready yet */
    }
    sleepSync(150);
  }
  return false;
}

function shutdownRedis(cliBin: string | undefined, port: number): void {
  if (!cliBin) return;
  try {
    // `shutdown nosave` tells the daemon to exit; redis-cli then errors because
    // the connection drops mid-command, so swallow whatever it throws.
    execFileSync(cliBin, ["-p", String(port), "shutdown", "nosave"], {
      stdio: "ignore",
      timeout: 3000,
    });
  } catch {
    /* expected: connection closes as the server exits */
  }
}

let shutdownRegistered = false;

function registerShutdown(cliBin: string | undefined, port: number): void {
  if (shutdownRegistered) return;
  shutdownRegistered = true;
  const stop = () => shutdownRedis(cliBin, port);
  process.once("exit", stop);
  process.once("SIGINT", () => {
    stop();
    process.exit(130);
  });
  process.once("SIGTERM", () => {
    stop();
    process.exit(143);
  });
}

/**
 * Starts a disposable local Redis and returns its URL, or null when one can't
 * be provisioned. Behavior:
 *   - If REDIS_URL is already set, that instance is used as-is (we don't manage
 *     our own — the caller pointed us at a real Redis on purpose).
 *   - If E2E_NO_REDIS is set, we skip provisioning entirely.
 *   - Otherwise we daemonize a throwaway redis-server (no persistence) on
 *     E2E_REDIS_PORT (default 6399), verify it answers PING, and register an
 *     exit/SIGINT/SIGTERM handler to shut it down when the run finishes.
 * Any failure along the way returns null so the Redis-gated specs skip cleanly.
 */
export function startManagedRedisIfPossible(): string | null {
  if (process.env.REDIS_URL) return process.env.REDIS_URL;
  if (process.env.E2E_NO_REDIS) return null;

  const serverBin = resolveBin("redis-server");
  if (!serverBin) return null;
  const cliBin = resolveRedisCli(serverBin);

  const port = Number(process.env.E2E_REDIS_PORT || "6399");
  if (!Number.isInteger(port) || port <= 0) return null;

  let dataDir: string;
  try {
    dataDir = mkdtempSync(join(tmpdir(), "e2e-redis-"));
  } catch {
    return null;
  }

  try {
    execFileSync(
      serverBin,
      [
        "--port",
        String(port),
        "--bind",
        "127.0.0.1",
        "--daemonize",
        "yes",
        "--save",
        "",
        "--appendonly",
        "no",
        "--dir",
        dataDir,
      ],
      { stdio: "ignore", timeout: 5000 },
    );
  } catch {
    // Couldn't start (e.g. the port is already taken) — skip gracefully.
    return null;
  }

  if (!pingRedis(cliBin, port)) {
    // Started but never became reachable; best-effort cleanup then bail.
    shutdownRedis(cliBin, port);
    return null;
  }

  registerShutdown(cliBin, port);
  return `redis://127.0.0.1:${port}`;
}
