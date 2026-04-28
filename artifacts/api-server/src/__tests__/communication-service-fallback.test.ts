import { describe, it, expect, vi } from "vitest";
import { EventEmitter } from "events";

vi.mock("../lib/redis", () => ({
  isRedisReady: vi.fn(() => false),
  getRedisConnection: vi.fn(() => ({
    on: vi.fn(),
    status: "end",
  })),
  createRedisConnection: vi.fn(),
  getRedis: vi.fn(() => null),
  isRedisConnected: vi.fn(async () => false),
}));

import { tryEnqueue } from "../lib/communication-service";
import type { Queue } from "bullmq";

interface FakeConnection extends EventEmitter {
  status: string;
  becomeReady(): void;
  becomeDead(): void;
}

function makeConnection(initialStatus: string): FakeConnection {
  const conn = new EventEmitter() as FakeConnection;
  conn.status = initialStatus;
  conn.becomeReady = () => {
    conn.status = "ready";
    conn.emit("ready");
  };
  conn.becomeDead = () => {
    conn.status = "end";
    conn.emit("end");
  };
  return conn;
}

interface FakeQueue {
  opts: { connection: FakeConnection };
  add: ReturnType<typeof vi.fn>;
}

function makeQueue(
  conn: FakeConnection,
  addImpl: (...args: unknown[]) => Promise<unknown>,
): FakeQueue {
  return {
    opts: { connection: conn },
    add: vi.fn(addImpl),
  };
}

describe("tryEnqueue", () => {
  it("returns true when the connection is already ready and add() resolves", async () => {
    const conn = makeConnection("ready");
    const queue = makeQueue(conn, async () => ({ id: "job-1" }));

    const result = await tryEnqueue(
      () => queue as unknown as Queue,
      "send-email",
      { foo: 1 },
      { attempts: 3 },
    );

    expect(result).toBe(true);
    expect(queue.add).toHaveBeenCalledTimes(1);
    expect(queue.add).toHaveBeenCalledWith(
      "send-email",
      { foo: 1 },
      { attempts: 3 },
    );
  });

  it("waits for the connection to become ready, then enqueues", async () => {
    const conn = makeConnection("connecting");
    const queue = makeQueue(conn, async () => ({ id: "job-2" }));

    setTimeout(() => conn.becomeReady(), 30);

    const result = await tryEnqueue(
      () => queue as unknown as Queue,
      "send-email",
      { foo: 2 },
      {},
      500,
    );

    expect(result).toBe(true);
    expect(queue.add).toHaveBeenCalledTimes(1);
  });

  it("does NOT call queue.add() if the connection never becomes ready (no orphan possible)", async () => {
    const conn = makeConnection("connecting");
    const queue = makeQueue(conn, async () => ({ id: "job-3" }));

    const t0 = Date.now();
    const result = await tryEnqueue(
      () => queue as unknown as Queue,
      "send-email",
      {},
      {},
      100,
    );
    const elapsed = Date.now() - t0;

    expect(result).toBe(false);
    expect(queue.add).not.toHaveBeenCalled();
    expect(elapsed).toBeGreaterThanOrEqual(95);
    expect(elapsed).toBeLessThan(500);
  });

  it("returns false immediately when the connection is already dead", async () => {
    const conn = makeConnection("end");
    const queue = makeQueue(conn, async () => ({ id: "job-4" }));

    const t0 = Date.now();
    const result = await tryEnqueue(
      () => queue as unknown as Queue,
      "send-email",
      {},
      {},
    );
    const elapsed = Date.now() - t0;

    expect(result).toBe(false);
    expect(queue.add).not.toHaveBeenCalled();
    expect(elapsed).toBeLessThan(50);
  });

  it("returns false when the connection transitions to dead while waiting", async () => {
    const conn = makeConnection("connecting");
    const queue = makeQueue(conn, async () => ({ id: "job-5" }));

    setTimeout(() => conn.becomeDead(), 20);

    const result = await tryEnqueue(
      () => queue as unknown as Queue,
      "send-email",
      {},
      {},
      500,
    );

    expect(result).toBe(false);
    expect(queue.add).not.toHaveBeenCalled();
  });

  it("returns false when add() rejects (after ready)", async () => {
    const conn = makeConnection("ready");
    const queue = makeQueue(conn, async () => {
      throw new Error("connection lost");
    });

    const result = await tryEnqueue(
      () => queue as unknown as Queue,
      "send-email",
      {},
      {},
      1000,
    );

    expect(result).toBe(false);
  });

  it("returns false when add() exceeds the timeout (Redis dies mid-add)", async () => {
    const conn = makeConnection("ready");
    const queue = makeQueue(
      conn,
      () => new Promise(() => { /* never resolves */ }),
    );

    const t0 = Date.now();
    const result = await tryEnqueue(
      () => queue as unknown as Queue,
      "send-email",
      {},
      {},
      150,
    );
    const elapsed = Date.now() - t0;

    expect(result).toBe(false);
    expect(elapsed).toBeGreaterThanOrEqual(140);
    expect(elapsed).toBeLessThan(800);
  });

  it("removes the orphan job if a timed-out add() eventually resolves (no duplicate sends)", async () => {
    const conn = makeConnection("ready");
    const remove = vi.fn(async () => undefined);
    let resolveAdd: ((job: { id: string; remove: typeof remove }) => void) | undefined;

    const queue = makeQueue(
      conn,
      () =>
        new Promise((resolve) => {
          resolveAdd = resolve;
        }),
    );

    const result = await tryEnqueue(
      () => queue as unknown as Queue,
      "send-email",
      {},
      {},
      80,
    );
    expect(result).toBe(false);
    expect(remove).not.toHaveBeenCalled();

    // Redis recovers: the orphan add() finally resolves with a Job. We must
    // remove it from the queue so the worker can't deliver a duplicate.
    resolveAdd?.({ id: "orphan-1", remove });
    await new Promise((r) => setTimeout(r, 30));

    expect(remove).toHaveBeenCalledTimes(1);
  });

  it("swallows late rejections from a timed-out add() (no unhandled rejection, no remove)", async () => {
    const conn = makeConnection("ready");
    let rejectAdd: ((err: Error) => void) | undefined;

    const queue = makeQueue(
      conn,
      () =>
        new Promise((_resolve, reject) => {
          rejectAdd = reject;
        }),
    );

    const unhandled: unknown[] = [];
    const handler = (err: unknown) => unhandled.push(err);
    process.on("unhandledRejection", handler);

    try {
      const result = await tryEnqueue(
        () => queue as unknown as Queue,
        "send-email",
        {},
        {},
        50,
      );
      expect(result).toBe(false);

      rejectAdd?.(new Error("late failure"));
      await new Promise((r) => setTimeout(r, 30));

      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", handler);
    }
  });

  it("falls back when the queue factory throws", async () => {
    const result = await tryEnqueue(
      () => {
        throw new Error("could not build queue");
      },
      "send-email",
      {},
      {},
    );

    expect(result).toBe(false);
  });
});
