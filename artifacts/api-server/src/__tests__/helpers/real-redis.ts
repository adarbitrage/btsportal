/**
 * Shared helper for the opt-in real-Redis integration suites.
 *
 * These tests spawn an actual `redis-server` subprocess on a random free port
 * so we can exercise our code against real ioredis / Lua / TTL / SCAN /
 * BullMQ semantics instead of an in-memory fake. Every suite that uses this
 * helper must:
 *
 *  - Gate itself with `describe.runIf(RUN_REDIS_INTEGRATION)` so default
 *    `pnpm test` runs (which don't have redis-server on PATH) stay green.
 *  - Call `startRealRedis()` in `beforeAll` and set
 *    `process.env.REDIS_URL = redisUrl(...)` BEFORE dynamically importing
 *    any module that captures REDIS_URL at module load (e.g. `../lib/redis`,
 *    BullMQ-using modules).
 *  - Call `stopRealRedis()` in `afterAll` to SIGTERM (then SIGKILL) the
 *    subprocess and remove its working directory.
 *
 * The server runs with persistence disabled (`--save ""`, `--appendonly no`)
 * and is bound to 127.0.0.1 only, so it leaves no on-disk state and is
 * never exposed off-box. Each suite typically `FLUSHDB`s between tests.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as net from "node:net";

export const RUN_REDIS_INTEGRATION =
  process.env.RUN_REDIS_INTEGRATION_TESTS === "1";

export interface RealRedis {
  port: number;
  dir: string;
  proc: ChildProcess;
}

export function redisUrl(rr: RealRedis): string {
  return `redis://127.0.0.1:${rr.port}`;
}

async function findFreePort(): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

export async function startRealRedis(): Promise<RealRedis> {
  const port = await findFreePort();
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "bts-redis-it-"));
  const proc = spawn(
    "redis-server",
    [
      "--port",
      String(port),
      "--bind",
      "127.0.0.1",
      "--protected-mode",
      "no",
      "--save",
      "",
      "--appendonly",
      "no",
      "--dir",
      dir,
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      err ? reject(err) : resolve();
    };
    const timer = setTimeout(
      () => finish(new Error("redis-server didn't become ready within 10s")),
      10_000,
    );
    proc.stdout?.on("data", (chunk: Buffer) => {
      if (chunk.toString().includes("Ready to accept connections")) {
        finish();
      }
    });
    proc.stderr?.on("data", (chunk: Buffer) => {
      // Bind errors land on stderr; surface them so a port collision is
      // diagnosable rather than appearing as a generic timeout.
      const s = chunk.toString();
      if (/error|fatal|aborted/i.test(s)) {
        finish(new Error(`redis-server stderr: ${s.trim()}`));
      }
    });
    proc.on("exit", (code) => {
      finish(new Error(`redis-server exited early with code ${code}`));
    });
    proc.on("error", (err) => finish(err));
  });

  return { port, dir, proc };
}

export async function stopRealRedis(rr: RealRedis | null): Promise<void> {
  if (!rr) return;
  const { proc, dir } = rr;
  await new Promise<void>((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(grace);
      resolve();
    };
    const grace = setTimeout(() => {
      try {
        proc.kill("SIGKILL");
      } catch {
        /* ignore */
      }
      finish();
    }, 3_000);
    proc.once("exit", finish);
    try {
      proc.kill("SIGTERM");
    } catch {
      finish();
    }
  });
  await fs.rm(dir, { recursive: true, force: true });
}
