import { describe, it, expect, afterEach, beforeAll, afterAll } from "vitest";
import { db, pool, usersTable, coachesTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";

// Database-level guard for the coaching_sessions.action_items
// storage-shape bug. Mirrors `products-entitlement-keys-array-check.test.ts`.
//
// `0028_coaching_sessions_action_items_array_check.sql` adds the CHECK
// constraint `coaching_sessions_action_items_is_array` so Postgres rejects
// any INSERT/UPDATE that lands a non-array, non-NULL JSONB value.
// `action_items` is a per-session list of `{ id, text, completed }`
// objects rendered by the coaching dashboard widget — a JSONB string scalar
// (the regression shape from #329) would silently break any raw JSONB
// array operator on the column and any future migration off Drizzle's
// silent string-to-array reader.
//
// `coaching_sessions.action_items` is nullable, so the constraint also
// has to accept NULL.
const TEST_REASON_PREFIX = "__action_items_check_test__";

type PgErrorShape = { code?: string; constraint?: string };
function asPgError(err: unknown): PgErrorShape {
  if (err && typeof err === "object") {
    return err as PgErrorShape;
  }
  throw new Error(`Expected a PG error object, got ${typeof err}: ${String(err)}`);
}

let testCoachId = 0;
let testMemberId = 0;

beforeAll(async () => {
  // Each session needs both a coach (FK) and a member-user (FK). Create
  // both in beforeAll so the suite is self-contained.
  const [member] = await db
    .insert(usersTable)
    .values({
      email: `${TEST_REASON_PREFIX}-member-${Date.now()}@example.test`,
      name: "action-items-check fixture member",
      passwordHash: "irrelevant",
      role: "member",
      sourceProduct: "lifetime",
      emailVerified: true,
      onboardingComplete: true,
    })
    .returning({ id: usersTable.id });
  testMemberId = member.id;

  const [coach] = await db
    .insert(coachesTable)
    .values({
      name: "action-items-check fixture coach",
      bio: "fixture",
      specialties: "fixture",
    })
    .returning({ id: coachesTable.id });
  testCoachId = coach.id;
});

afterEach(async () => {
  if (testCoachId) {
    await db.execute(
      sql`DELETE FROM coaching_sessions WHERE coach_id = ${testCoachId}`,
    );
  }
});

afterAll(async () => {
  if (testCoachId) {
    await db.delete(coachesTable).where(eq(coachesTable.id, testCoachId));
  }
  if (testMemberId) {
    await db.delete(usersTable).where(eq(usersTable.id, testMemberId));
  }
});

async function badInsert(actionItemsLiteral: string | null): Promise<unknown> {
  try {
    if (actionItemsLiteral === null) {
      await pool.query(
        `INSERT INTO coaching_sessions (coach_id, member_id, scheduled_at, action_items)
         VALUES ($1, $2, NOW(), NULL)`,
        [testCoachId, testMemberId],
      );
    } else {
      await pool.query(
        `INSERT INTO coaching_sessions (coach_id, member_id, scheduled_at, action_items)
         VALUES ($1, $2, NOW(), $3::jsonb)`,
        [testCoachId, testMemberId, actionItemsLiteral],
      );
    }
  } catch (err) {
    return err;
  }
  return null;
}

describe("coaching_sessions.action_items CHECK constraint", () => {
  it("the coaching_sessions_action_items_is_array CHECK constraint exists", async () => {
    const result = await db.execute<{ conname: string; definition: string }>(sql`
      SELECT conname, pg_get_constraintdef(oid) AS definition
      FROM pg_constraint
      WHERE conrelid = 'public.coaching_sessions'::regclass
        AND conname = 'coaching_sessions_action_items_is_array'
    `);
    expect(
      result.rows.length,
      "coaching_sessions_action_items_is_array CHECK constraint missing. " +
        "Apply lib/db/drizzle/0028_coaching_sessions_action_items_array_check.sql " +
        "against this database.",
    ).toBe(1);
    expect(result.rows[0]?.definition).toMatch(/jsonb_typeof/i);
    expect(result.rows[0]?.definition).toMatch(/'array'/i);
    expect(result.rows[0]?.definition.toLowerCase()).toMatch(/is null/);
  });

  it("rejects an INSERT whose action_items is a JSONB string scalar (the original bug shape)", async () => {
    const caught = await badInsert(JSON.stringify(JSON.stringify([{ id: "1", text: "x", completed: false }])));
    expect(caught, "INSERT was not rejected — the CHECK constraint is missing or wrong.").not.toBeNull();
    const pgErr = asPgError(caught);
    expect(pgErr.code).toBe("23514");
    expect(pgErr.constraint).toBe("coaching_sessions_action_items_is_array");
  });

  it("rejects an INSERT whose action_items is a JSONB number scalar", async () => {
    const caught = await badInsert("42");
    expect(caught).not.toBeNull();
    const pgErr = asPgError(caught);
    expect(pgErr.code).toBe("23514");
    expect(pgErr.constraint).toBe("coaching_sessions_action_items_is_array");
  });

  it("rejects an INSERT whose action_items is a JSONB object", async () => {
    const caught = await badInsert(JSON.stringify({ foo: "bar" }));
    expect(caught).not.toBeNull();
    const pgErr = asPgError(caught);
    expect(pgErr.code).toBe("23514");
    expect(pgErr.constraint).toBe("coaching_sessions_action_items_is_array");
  });

  it("rejects an UPDATE that turns an existing array into a string scalar", async () => {
    await pool.query(
      `INSERT INTO coaching_sessions (coach_id, member_id, scheduled_at, action_items)
       VALUES ($1, $2, NOW(), $3::jsonb)`,
      [testCoachId, testMemberId, JSON.stringify([{ id: "1", text: "x", completed: false }])],
    );
    let caught: unknown = null;
    try {
      await pool.query(
        `UPDATE coaching_sessions SET action_items = $1::jsonb WHERE coach_id = $2`,
        [JSON.stringify(JSON.stringify([{ id: "1", text: "x", completed: false }])), testCoachId],
      );
    } catch (err) {
      caught = err;
    }
    expect(caught).not.toBeNull();
    const pgErr = asPgError(caught);
    expect(pgErr.code).toBe("23514");
    expect(pgErr.constraint).toBe("coaching_sessions_action_items_is_array");
  });

  it("accepts an INSERT with a real JSONB array (sanity check)", async () => {
    const caught = await badInsert(JSON.stringify([{ id: "1", text: "follow up", completed: false }]));
    expect(caught).toBeNull();
  });

  it("accepts an INSERT with an empty JSONB array", async () => {
    const caught = await badInsert(JSON.stringify([]));
    expect(caught).toBeNull();
  });

  it("accepts an INSERT with NULL action_items (column is nullable)", async () => {
    const caught = await badInsert(null);
    expect(caught).toBeNull();
  });
});
