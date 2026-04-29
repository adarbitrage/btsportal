/**
 * Integration test that exercises the queue-fallback alerter against a real
 * Redis instance (instead of the in-memory fake used by
 * queue-fallback-alerter-multi-instance.test.ts). Spinning up a real Redis
 * catches drift between our fake and real-server semantics: Lua return-type
 * encoding, TTL behavior on EX, NX-on-existing semantics, key encoding, and
 * the EVAL → SET pipeline.
 *
 * Gating
 * ------
 * Real Redis is not present on every developer laptop, so this suite is
 * opt-in: it only runs when the env var `RUN_REDIS_INTEGRATION_TESTS=1` is
 * set. Set it in CI (with redis-server installed via Nix / apt / a service
 * container) to actually run the suite. Without the env var the suite is
 * skipped, keeping `pnpm test` fast and dependency-free for local runs.
 *
 * Setup
 * -----
 * - Spawn a `redis-server` subprocess on a random free port, with persistence
 *   disabled (`--save ""`, `--appendonly no`) so the test leaves no on-disk
 *   state behind. We only listen on 127.0.0.1 in protected mode-off; this is
 *   ephemeral and never exposed off-box.
 * - Wait for the "Ready to accept connections" log line before continuing,
 *   so the first test command doesn't race the server's bind.
 * - Set `process.env.REDIS_URL` to the spawned server's address BEFORE the
 *   alerter modules are imported (they capture REDIS_URL at module load
 *   inside `../lib/redis`). All alerter imports happen via dynamic `import()`
 *   inside `beforeAll`, after REDIS_URL is set.
 *
 * Mocks
 * -----
 * The DB layer is mocked exactly the same way as the in-memory variant
 * (`queue-fallback-alerter-multi-instance.test.ts`) — this test is about
 * Redis, not Drizzle. We deliberately do NOT mock `../lib/redis`: the whole
 * point is to exercise ioredis against a real server.
 *
 * Teardown
 * --------
 * - Quit the cached ioredis client so the test process can exit cleanly.
 * - SIGTERM the redis-server subprocess (SIGKILL after a short grace).
 * - Remove the temporary working directory.
 */
import {
  afterAll,
  beforeAll,
  beforeEach,
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as net from "node:net";

const REDIS_INTEGRATION = process.env.RUN_REDIS_INTEGRATION_TESTS === "1";

interface FakeAuditRow {
  actionType: string;
  entityType: string;
  entityId: string | null;
  description: string;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
}

const auditRows: FakeAuditRow[] = [];

vi.mock("@workspace/db", () => {
  const auditLogTable = {
    actionType: { name: "action_type" },
    entityType: { name: "entity_type" },
    entityId: { name: "entity_id" },
    createdAt: { name: "created_at" },
  };
  const db = {
    insert: (_table: unknown) => ({
      values: async (row: FakeAuditRow) => {
        auditRows.push(row);
      },
    }),
    select: (_cols: unknown) => ({
      from: (_table: unknown) => ({
        where: async (_condition: unknown) => {
          const cutoff = Date.now() - 24 * 60 * 60 * 1000;
          return auditRows
            .filter(
              (r) => r.actionType === "queue_fallback" && r.createdAt.getTime() >= cutoff,
            )
            .map((r) => ({ entityId: r.entityId, createdAt: r.createdAt }));
        },
      }),
    }),
  };
  return { db, auditLogTable };
});

vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => ({ _and: args }),
  eq: (a: unknown, b: unknown) => ({ _eq: [a, b] }),
  gte: (a: unknown, b: unknown) => ({ _gte: [a, b] }),
}));

// Dynamically-loaded module bindings. Populated in beforeAll AFTER we have
// started Redis and set REDIS_URL, so `../lib/redis` reads the right URL.
// `import type` is erased at compile time and carries no runtime side effect,
// so it's safe to use here even for the modules whose values we only load
// inside beforeAll.
import type * as AlerterModule from "../lib/queue-fallback-alerter";
import type * as TrackerModule from "../lib/queue-fallback-tracker";
import type * as RedisModule from "../lib/redis";
type AlertPayload = AlerterModule.AlertPayload;
type DeliveryResult = AlerterModule.DeliveryResult;

let alerterMod: typeof AlerterModule;
let trackerMod: typeof TrackerModule;
let redisMod: typeof RedisModule;

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

interface RealRedis {
  port: number;
  dir: string;
  proc: ChildProcess;
}

async function startRealRedis(): Promise<RealRedis> {
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

let realRedis: RealRedis | null = null;

interface DeliveryRecorder {
  fn: (p: AlertPayload) => Promise<DeliveryResult>;
  calls: AlertPayload[];
}

function recorder(channel: "pagerduty" | "email" | "slack"): DeliveryRecorder {
  const calls: AlertPayload[] = [];
  return {
    calls,
    fn: async (p: AlertPayload): Promise<DeliveryResult> => {
      calls.push(p);
      return { channel, ok: true };
    },
  };
}

// Use describe.runIf so the suite is silently skipped when the env var
// isn't set (typical local `pnpm test`). In CI / when the env var is set,
// the suite runs against the real spawned Redis.
describe.runIf(REDIS_INTEGRATION)(
  "queue-fallback-alerter against a real Redis (multi-instance)",
  () => {
    let pd: DeliveryRecorder;
    let email: DeliveryRecorder;
    let slack: DeliveryRecorder;
    let warnSpy: ReturnType<typeof vi.spyOn>;
    let logSpy: ReturnType<typeof vi.spyOn>;
    let errSpy: ReturnType<typeof vi.spyOn>;

    beforeAll(async () => {
      realRedis = await startRealRedis();
      process.env.REDIS_URL = `redis://127.0.0.1:${realRedis.port}`;
      // Dynamic imports happen AFTER REDIS_URL is set so `../lib/redis`
      // captures the right URL at module load.
      alerterMod = await import("../lib/queue-fallback-alerter");
      trackerMod = await import("../lib/queue-fallback-tracker");
      redisMod = await import("../lib/redis");
      // Sanity check: our REDIS_URL is actually reachable. Failing here
      // gives a clearer error than a downstream "no transition observed".
      const ok = await redisMod.isRedisConnected();
      if (!ok) throw new Error("real Redis was started but not reachable");
    }, 30_000);

    afterAll(async () => {
      // Drain the cached ioredis client so the test process can exit. We
      // intentionally use `quit` (graceful) over `disconnect` so any in-flight
      // commands finish first.
      try {
        await redisMod?.getRedis()?.quit();
      } catch {
        /* best effort */
      }
      delete process.env.REDIS_URL;

      if (realRedis) {
        const { proc, dir } = realRedis;
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
        realRedis = null;
      }
    }, 30_000);

    beforeEach(async () => {
      // FLUSHDB between tests so each scenario starts with a clean Redis. We
      // only ever wrote keys with our own prefix, but FLUSHDB is a single
      // round-trip and avoids any chance of cross-test bleed.
      await redisMod.getRedis()?.flushdb();
      auditRows.length = 0;
      trackerMod.__resetQueueFallbackTrackerForTests();
      alerterMod.__resetQueueFallbackAlerterForTests();
      pd = recorder("pagerduty");
      email = recorder("email");
      slack = recorder("slack");
      alerterMod.__setQueueFallbackAlerterDeliveriesForTests({
        pagerduty: pd.fn,
        email: email.fn,
        slack: slack.fn,
      });
      warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    });

    afterEach(() => {
      alerterMod.__setQueueFallbackAlerterDeliveriesForTests(null);
      warnSpy.mockRestore();
      logSpy.mockRestore();
      errSpy.mockRestore();
    });

    it("two pods racing on the same fire transition only page on-call once", async () => {
      await trackerMod.recordQueueFallback("email", { reason: "queue_unavailable" });

      const [resultsA, resultsB] = await Promise.all([
        alerterMod.evaluateQueueFallbackAlerts(),
        alerterMod.evaluateQueueFallbackAlerts(),
      ]);

      const fireCount = (calls: AlertPayload[]) =>
        calls.filter((c) => c.kind === "fire").length;
      expect(fireCount(pd.calls)).toBe(1);
      expect(fireCount(email.calls)).toBe(1);
      expect(fireCount(slack.calls)).toBe(1);

      const allResults = [...resultsA, ...resultsB];
      const realDeliveries = allResults.filter((r) => r.ok && !r.skipped);
      // One real delivery per channel; the loser of the CAS produces no
      // fresh delivery on this transition.
      expect(realDeliveries).toHaveLength(3);

      // Spot-check that Redis itself reflects "currently alerting=1" for the
      // email channel. This catches encoding mismatches between our Lua
      // script's stored value and what we'd read back from a real server.
      const stored = await redisMod.getRedis()?.get("queue-fallback:alerting:email");
      expect(stored).toBe("1");
      // And the TTL was applied — i.e. we ran the EX path of the script.
      const ttl = await redisMod.getRedis()?.ttl("queue-fallback:alerting:email");
      expect(ttl).toBeGreaterThan(0);
    });

    it("two pods racing on the same clear transition only resolve once", async () => {
      // Set up the fired state directly in Redis so we can observe a clean
      // clear transition without messing with system time (real Redis TTLs
      // make vi.useFakeTimers tricky here).
      await trackerMod.recordQueueFallback("email");
      await alerterMod.evaluateQueueFallbackAlerts();
      // Reset call recorders so we only count the clear-transition pages.
      pd.calls.length = 0;
      email.calls.length = 0;
      slack.calls.length = 0;
      // Drain the in-memory tracker AND the audit rows so the next eval sees
      // "no recent fallbacks" and treats it as a clear.
      trackerMod.__resetQueueFallbackTrackerForTests();
      auditRows.length = 0;
      // The throttle slots were claimed during the fire; release them so
      // the clear-transition pages can actually go out without the throttle
      // suppressing them.
      await redisMod.getRedis()?.del(
        "queue-fallback:throttle:email:pagerduty:fire",
        "queue-fallback:throttle:email:email:fire",
        "queue-fallback:throttle:email:slack:fire",
      );

      const [resultsA, resultsB] = await Promise.all([
        alerterMod.evaluateQueueFallbackAlerts(),
        alerterMod.evaluateQueueFallbackAlerts(),
      ]);

      const clearCount = (calls: AlertPayload[]) =>
        calls.filter((c) => c.kind === "clear").length;
      expect(clearCount(pd.calls)).toBe(1);
      expect(clearCount(email.calls)).toBe(1);
      expect(clearCount(slack.calls)).toBe(1);

      const allResults = [...resultsA, ...resultsB];
      const clearsDelivered = allResults.filter((r) => r.ok && !r.skipped);
      expect(clearsDelivered).toHaveLength(3);

      // After a successful clear, Redis should record the alerting flag back
      // to "0" (not deleted — we want the value present so a later "still
      // not alerting" eval also sees no transition).
      const stored = await redisMod.getRedis()?.get("queue-fallback:alerting:email");
      expect(stored).toBe("0");
    });

    it("after one pod fires, a second pod observing the same outage does not re-fire", async () => {
      await trackerMod.recordQueueFallback("email");
      await alerterMod.evaluateQueueFallbackAlerts(); // pod A fires
      expect(pd.calls.filter((c) => c.kind === "fire")).toHaveLength(1);

      // Pod B's first eval finds the alerting flag already "1" in Redis,
      // so the EVAL compare-and-set returns 0 (no transition) and no new
      // page goes out.
      const resultsB = await alerterMod.evaluateQueueFallbackAlerts();
      expect(resultsB).toHaveLength(0);
      expect(pd.calls.filter((c) => c.kind === "fire")).toHaveLength(1);
      expect(email.calls.filter((c) => c.kind === "fire")).toHaveLength(1);
      expect(slack.calls.filter((c) => c.kind === "fire")).toHaveLength(1);
    });

    it("highly-concurrent fires (10 racing pods) still produce exactly one page per channel", async () => {
      // Stress the CAS: a much larger fanout than the 2-pod case to make any
      // race-window leak obvious. Real Redis processes EVAL atomically, so
      // exactly one of the 10 callers should win the transition.
      await trackerMod.recordQueueFallback("email");
      const evals = Array.from({ length: 10 }, () =>
        alerterMod.evaluateQueueFallbackAlerts(),
      );
      const allResults = (await Promise.all(evals)).flat();

      const fireCount = (calls: AlertPayload[]) =>
        calls.filter((c) => c.kind === "fire").length;
      expect(fireCount(pd.calls)).toBe(1);
      expect(fireCount(email.calls)).toBe(1);
      expect(fireCount(slack.calls)).toBe(1);

      // Across all 10 callers, exactly one real delivery per channel went
      // out. The other 9 either reported no transition or were throttled.
      const realDeliveries = allResults.filter((r) => r.ok && !r.skipped);
      expect(realDeliveries).toHaveLength(3);
    });
  },
);
