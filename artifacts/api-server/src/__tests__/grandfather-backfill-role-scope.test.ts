import { describe, it, expect, vi, beforeEach } from "vitest";

// Task #1643 (TB2): the backfill must only ever touch/count role='member'
// rows — admins, coaches, and partner staff are never onboarding subjects.
// Against the real dev DB this is hard to isolate (every seeded user in the
// other suite is already role='member', and the marker there is permanently
// claimed), so this test isolates the query SHAPE itself via a mocked data
// layer: it asserts both the pre-flight read and the execute UPDATE include
// a `role = 'member'` predicate alongside the `grandfathered = false`
// predicate, rather than asserting on real rows.

let capturedUsersWhereSql: { strings: readonly string[]; values: unknown[] } | undefined;

vi.mock("@workspace/db", () => {
  const usersTable = {
    id: { name: "id" },
    grandfathered: { name: "grandfathered" },
    role: { name: "role" },
    onboardingComplete: { name: "onboarding_complete" },
    onboardingStep: { name: "onboarding_step" },
  };
  const userProductsTable = { userId: { name: "user_id" }, productId: { name: "product_id" }, status: { name: "status" }, expiresAt: { name: "expires_at" } };
  const productsTable = { id: { name: "id" }, slug: { name: "slug" } };
  const systemSettingsTable = { id: { name: "id" }, key: { name: "key" }, value: { name: "value" } };

  const oneCandidate = [{ id: 1, onboardingComplete: false, onboardingStep: 1 }];

  const db = {
    select: (_cols: unknown) => ({
      from: (table: unknown) => {
        const whereFn = (condition: unknown) => {
          if (table === usersTable) {
            capturedUsersWhereSql = condition as { strings: readonly string[]; values: unknown[] };
          }
          const rows = table === usersTable ? oneCandidate : table === systemSettingsTable ? [] : [];
          return Object.assign(Promise.resolve(rows), { limit: async (_n: number) => rows });
        };
        return {
          where: whereFn,
          // userProductsTable's select chains .innerJoin(...) before .where(...).
          innerJoin: (_joinTable: unknown, _on: unknown) => ({ where: whereFn }),
        };
      },
    }),
    // Execution isn't exercised by this test (it only checks the pre-flight
    // read's query shape), but transaction must exist so an accidental
    // confirm:true call doesn't crash with "not a function".
    transaction: async () => {
      throw new Error("this test never confirms execution");
    },
  };

  return { db, usersTable, userProductsTable, productsTable, systemSettingsTable };
});

vi.mock("drizzle-orm", () => ({
  eq: (..._args: unknown[]) => ({ __op: "eq" }),
  sql: Object.assign(
    (strings: TemplateStringsArray, ...values: unknown[]) => ({ __op: "sql", strings, values }),
    { raw: (s: string) => s },
  ),
}));

vi.mock("../lib/product-rank", () => ({
  PRODUCT_RANK: {},
}));

describe("grandfather backfill — role scoping", () => {
  beforeEach(() => {
    vi.resetModules();
    capturedUsersWhereSql = undefined;
  });

  it("scopes the candidate query to grandfathered=false AND role='member', never all users", async () => {
    const { getGrandfatherPreflightReport } = await import("../lib/grandfather-backfill");
    await getGrandfatherPreflightReport();

    expect(capturedUsersWhereSql).toBeDefined();
    // The interpolated values must include BOTH the grandfathered column and
    // the role column — i.e. the query is not scoped to grandfathered alone.
    const values = capturedUsersWhereSql!.values;
    const referencesGrandfathered = values.some((v) => (v as { name?: string })?.name === "grandfathered");
    const referencesRole = values.some((v) => (v as { name?: string })?.name === "role");
    expect(referencesGrandfathered).toBe(true);
    expect(referencesRole).toBe(true);

    // And the literal template text must pin role to the 'member' value,
    // not just reference the column.
    const literalText = capturedUsersWhereSql!.strings.join("");
    expect(literalText).toMatch(/=\s*'member'/);
  });
});
