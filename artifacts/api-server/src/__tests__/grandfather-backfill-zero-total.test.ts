import { describe, it, expect, vi, beforeEach } from "vitest";

// Task #1643 (TB2): isolates the ONE sanity assertion the backfill makes —
// abort if the computed total is 0 — from the real-DB suite in
// grandfather-backfill.test.ts. Against a real dev/prod DB the total can
// never legitimately be 0 before this has run (there is always at least one
// pre-existing member), so this scenario is only reachable via a mocked data
// layer that simulates the bucket query returning nothing (e.g. pointed at
// an empty/wrong database).

const noSettingsRow: Array<{ id: number }> = [];
const noCandidates: Array<{ id: number; onboardingComplete: boolean; onboardingStep: number }> = [];

vi.mock("@workspace/db", () => {
  const usersTable = { grandfathered: { name: "grandfathered" } };
  const userProductsTable = { userId: { name: "user_id" }, productId: { name: "product_id" }, status: { name: "status" }, expiresAt: { name: "expires_at" } };
  const productsTable = { id: { name: "id" }, slug: { name: "slug" } };
  const systemSettingsTable = { id: { name: "id" }, key: { name: "key" }, value: { name: "value" } };

  function emptyResultFor(table: unknown): unknown[] {
    if (table === systemSettingsTable) return noSettingsRow;
    if (table === usersTable) return noCandidates;
    return [];
  }

  const db = {
    select: (_cols: unknown) => ({
      from: (table: unknown) => {
        const rows = emptyResultFor(table);
        const chain = {
          where: (_condition: unknown) => Object.assign(Promise.resolve(rows), { limit: async (_n: number) => rows }),
        };
        return chain;
      },
    }),
    transaction: async (_fn: unknown) => {
      throw new Error("transaction should never be reached when the computed total is 0");
    },
  };

  return { db, usersTable, userProductsTable, productsTable, systemSettingsTable };
});

vi.mock("drizzle-orm", () => ({
  eq: (..._args: unknown[]) => ({ __op: "eq" }),
  sql: Object.assign((..._args: unknown[]) => ({ __op: "sql" }), { raw: (s: string) => s }),
}));

vi.mock("../lib/product-rank", () => ({
  PRODUCT_RANK: {},
}));

describe("grandfather backfill — zero-total sanity assertion", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("throws instead of silently no-op'ing when the computed total is 0", async () => {
    const { runGrandfatherBackfill } = await import("../lib/grandfather-backfill");
    await expect(runGrandfatherBackfill({ confirm: true })).rejects.toThrow(/computed total is 0/i);
  });

  it("reports a total of 0 and an empty bucket list via pre-flight, without throwing", async () => {
    const { getGrandfatherPreflightReport } = await import("../lib/grandfather-backfill");
    const report = await getGrandfatherPreflightReport();
    expect(report.total).toBe(0);
    expect(report.buckets).toEqual([]);
  });
});
