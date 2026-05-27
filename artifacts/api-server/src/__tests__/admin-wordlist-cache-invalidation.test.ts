/**
 * Default-suite regression test for the admin wordlist mutation → cache
 * invalidation contract.
 *
 * The cross-process invalidation guarantee is covered end-to-end by the
 * opt-in real-Redis test (gated on RUN_REDIS_INTEGRATION_TESTS=1). That
 * suite does NOT run on every push, so a refactor of either the admin
 * route or the wordlist module could quietly drop the guarantee.
 *
 * These tests run by default and pin two pieces of behaviour:
 *  1. After POST/PUT/DELETE on /api/admin/wordlist, the in-process
 *     wordlist cache is dropped — the very next `scanContent()` reflects
 *     the mutation instead of serving stale cached rows.
 *  2. After each mutation, the admin route publishes on the
 *     `moderation:wordlist:invalidate` channel so peer processes know to
 *     drop their own caches.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { type Express } from "express";
import request from "supertest";

type Row = {
  id: number;
  word: string;
  category: string;
  severity: "HARD" | "SOFT";
  createdAt: Date;
};

let currentRows: Row[] = [];
let nextId = 1;

vi.mock("drizzle-orm", () => ({
  eq: (_col: unknown, val: unknown) => ({ __op: "eq", val }),
  asc: () => ({ __op: "asc" }),
  desc: () => ({ __op: "desc" }),
  ilike: () => ({ __op: "ilike" }),
  and: (...conds: unknown[]) => ({ __op: "and", conds }),
}));

vi.mock("@workspace/db", () => {
  const ret = (rows: Row[]) => ({ returning: async () => rows });

  const selectBuilder: any = {
    from: () => selectBuilder,
    where: () => selectBuilder,
    orderBy: async () => currentRows,
    then: (resolve: (rows: Row[]) => unknown) =>
      Promise.resolve(currentRows).then(resolve),
  };

  const extractId = (cond: any): number | undefined => {
    if (!cond) return undefined;
    if (cond.__op === "eq") return cond.val as number;
    if (cond.__op === "and" && Array.isArray(cond.conds)) {
      for (const c of cond.conds) {
        const id = extractId(c);
        if (id !== undefined) return id;
      }
    }
    return undefined;
  };

  return {
    db: {
      select: () => selectBuilder,
      insert: () => ({
        values: (v: Omit<Row, "id" | "createdAt">) => {
          const row: Row = { id: nextId++, createdAt: new Date(), ...v };
          currentRows.push(row);
          return ret([row]);
        },
      }),
      update: () => ({
        set: (s: Partial<Row>) => ({
          where: (cond: unknown) => {
            const id = extractId(cond);
            const idx = currentRows.findIndex((r) => r.id === id);
            if (idx === -1) return ret([]);
            currentRows[idx] = { ...currentRows[idx]!, ...s };
            return ret([currentRows[idx]!]);
          },
        }),
      }),
      delete: () => ({
        where: (cond: unknown) => {
          const id = extractId(cond);
          const idx = currentRows.findIndex((r) => r.id === id);
          if (idx === -1) return ret([]);
          const [removed] = currentRows.splice(idx, 1);
          return ret([removed!]);
        },
      }),
    },
    moderationWordlistTable: {
      id: {},
      word: {},
      category: {},
      severity: {},
      createdAt: {},
    },
  };
});

vi.mock("../middleware/rbac", () => ({
  requirePermission:
    () =>
    (_req: unknown, _res: unknown, next: () => void) =>
      next(),
}));

const publishMock = vi.fn().mockResolvedValue(1);
vi.mock("../lib/redis", () => ({
  getRedis: () => ({ publish: publishMock }),
  createRedisConnection: () => ({
    publish: publishMock,
    on: () => {},
    subscribe: () => {},
    quit: async () => {},
    disconnect: () => {},
  }),
  getRedisConnection: () => ({ publish: publishMock }),
  isRedisReady: () => true,
}));

const adminWordlistRouter = (await import("../routes/admin/wordlist")).default;
const { scanContent, invalidateWordlistCache } = await import(
  "../lib/moderation/wordlist"
);

function makeApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api/admin/wordlist", adminWordlistRouter);
  return app;
}

beforeEach(() => {
  currentRows = [];
  nextId = 1;
  // Drop any cache left over from a previous test, then clear the
  // resulting publish so each test starts from a clean slate.
  invalidateWordlistCache();
  publishMock.mockClear();
});

describe("admin wordlist mutation drops the in-process cache", () => {
  it("POST: next scanContent sees the newly-added word", async () => {
    const app = makeApp();

    // Prime the cache while currentRows is empty.
    expect(await scanContent("hello shibboleth world")).toEqual([]);

    const res = await request(app)
      .post("/api/admin/wordlist")
      .send({ word: "shibboleth", category: "test", severity: "HARD" });
    expect(res.status).toBe(201);

    const matches = await scanContent("hello shibboleth world");
    expect(matches).toHaveLength(1);
    expect(matches[0]?.word).toBe("shibboleth");
  });

  it("PUT: next scanContent sees the updated word", async () => {
    const app = makeApp();

    const created = await request(app)
      .post("/api/admin/wordlist")
      .send({ word: "alpha", category: "test", severity: "HARD" });
    expect(created.status).toBe(201);
    const id = created.body.id as number;

    // Prime cache with pre-update state.
    expect(await scanContent("alpha")).toHaveLength(1);
    expect(await scanContent("bravo")).toHaveLength(0);

    const res = await request(app)
      .put(`/api/admin/wordlist/${id}`)
      .send({ word: "bravo" });
    expect(res.status).toBe(200);

    expect(await scanContent("bravo")).toHaveLength(1);
    expect(await scanContent("alpha")).toHaveLength(0);
  });

  it("DELETE: next scanContent no longer sees the removed word", async () => {
    const app = makeApp();

    const created = await request(app)
      .post("/api/admin/wordlist")
      .send({ word: "charlie", category: "test", severity: "HARD" });
    expect(created.status).toBe(201);
    const id = created.body.id as number;

    // Prime cache.
    expect(await scanContent("charlie")).toHaveLength(1);

    const res = await request(app).delete(`/api/admin/wordlist/${id}`);
    expect(res.status).toBe(200);

    expect(await scanContent("charlie")).toHaveLength(0);
  });
});

describe("admin wordlist mutation publishes cross-process invalidation", () => {
  it("publishes on moderation:wordlist:invalidate after POST/PUT/DELETE", async () => {
    const app = makeApp();

    const post = await request(app)
      .post("/api/admin/wordlist")
      .send({ word: "delta", category: "test", severity: "HARD" });
    expect(post.status).toBe(201);
    const id = post.body.id as number;

    const put = await request(app)
      .put(`/api/admin/wordlist/${id}`)
      .send({ severity: "SOFT" });
    expect(put.status).toBe(200);

    const del = await request(app).delete(`/api/admin/wordlist/${id}`);
    expect(del.status).toBe(200);

    const channels = publishMock.mock.calls.map((c) => c[0]);
    expect(channels).toEqual([
      "moderation:wordlist:invalidate",
      "moderation:wordlist:invalidate",
      "moderation:wordlist:invalidate",
    ]);

    // Payload sanity: each publish carries a parseable JSON envelope with
    // an instanceId so peer subscribers can ignore self-published echoes.
    for (const call of publishMock.mock.calls) {
      const parsed = JSON.parse(call[1] as string);
      expect(typeof parsed.instanceId).toBe("string");
      expect(typeof parsed.ts).toBe("number");
    }
  });
});
