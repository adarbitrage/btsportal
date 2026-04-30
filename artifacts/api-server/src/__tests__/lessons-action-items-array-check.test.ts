import { describe, it, expect, afterEach, beforeAll, afterAll } from "vitest";
import { db, pool, tracksTable, modulesTable, lessonsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";

// Database-level guard for the two `action_items` JSONB columns in the
// lessons schema (`lessons`, `lesson_versions`). Mirrors
// `coaching-sessions-action-items-array-check.test.ts`.
//
// `0030_lessons_action_items_array_check.sql` adds two CHECK constraints
// (one per table) so Postgres rejects any INSERT/UPDATE that lands a
// non-array, non-NULL JSONB value. Both columns feed the per-lesson
// checklist rendered by `LessonView` — a JSONB string scalar (the
// regression shape from #329) would silently break the renderer's
// `.map(...)` iteration and the lesson page would render a blank
// checklist with no error in the logs.
//
// Both columns are nullable, so the constraints also have to accept NULL.
const TEST_PREFIX = "__lesson_action_items_check_test__";

type PgErrorShape = { code?: string; constraint?: string };
function asPgError(err: unknown): PgErrorShape {
  if (err && typeof err === "object") {
    return err as PgErrorShape;
  }
  throw new Error(`Expected a PG error object, got ${typeof err}: ${String(err)}`);
}

// `lessons` requires a real `module_id` (FK), and `modules` requires a
// real `track_id` (FK). `lesson_versions` requires a real `lesson_id`
// (FK). Seed the full chain in beforeAll so the suite is self-contained.
let testTrackId = 0;
let testModuleId = 0;
let testLessonId = 0;

beforeAll(async () => {
  const [track] = await db
    .insert(tracksTable)
    .values({
      title: `${TEST_PREFIX} fixture track`,
      description: "fixture",
    })
    .returning({ id: tracksTable.id });
  testTrackId = track.id;

  const [mod] = await db
    .insert(modulesTable)
    .values({
      trackId: testTrackId,
      title: `${TEST_PREFIX} fixture module`,
      description: "fixture",
    })
    .returning({ id: modulesTable.id });
  testModuleId = mod.id;

  // A parent lesson for the lesson_versions FK. action_items left NULL so
  // we don't trip the constraint on the fixture itself.
  const [lesson] = await db
    .insert(lessonsTable)
    .values({
      moduleId: testModuleId,
      title: `${TEST_PREFIX} fixture lesson`,
      description: "fixture",
    })
    .returning({ id: lessonsTable.id });
  testLessonId = lesson.id;
});

afterEach(async () => {
  // Clean up any test rows from both tables. lesson_versions points at
  // testLessonId; lessons rows from this test all live under
  // testModuleId, except for the fixture lesson itself which we keep.
  await db.execute(
    sql`DELETE FROM lesson_versions WHERE lesson_id = ${testLessonId}`,
  );
  await db.execute(
    sql`DELETE FROM lessons WHERE module_id = ${testModuleId} AND id <> ${testLessonId}`,
  );
});

afterAll(async () => {
  if (testLessonId) {
    await db.delete(lessonsTable).where(eq(lessonsTable.id, testLessonId));
  }
  if (testModuleId) {
    await db.delete(modulesTable).where(eq(modulesTable.id, testModuleId));
  }
  if (testTrackId) {
    await db.delete(tracksTable).where(eq(tracksTable.id, testTrackId));
  }
});

const CATALOG_ROWS = [
  {
    table: "lessons" as const,
    constraint: "lessons_action_items_is_array",
    migration: "0030_lessons_action_items_array_check.sql",
  },
  {
    table: "lesson_versions" as const,
    constraint: "lesson_versions_action_items_is_array",
    migration: "0030_lessons_action_items_array_check.sql",
  },
];

describe("lessons.action_items CHECK constraints (catalog)", () => {
  for (const { table, constraint, migration } of CATALOG_ROWS) {
    it(`the ${constraint} CHECK constraint exists on ${table}`, async () => {
      const result = await db.execute<{ conname: string; definition: string }>(sql.raw(`
        SELECT conname, pg_get_constraintdef(oid) AS definition
        FROM pg_constraint
        WHERE conrelid = 'public.${table}'::regclass
          AND conname = '${constraint}'
      `));
      expect(
        result.rows.length,
        `${constraint} CHECK constraint missing on ${table}. Apply lib/db/drizzle/${migration} against this database.`,
      ).toBe(1);
      expect(result.rows[0]?.definition).toMatch(/jsonb_typeof/i);
      expect(result.rows[0]?.definition).toMatch(/'array'/i);
      // Both columns are nullable, so the constraint must also accept NULL.
      expect(result.rows[0]?.definition.toLowerCase()).toMatch(/is null/);
    });
  }
});

describe("lessons.action_items CHECK constraint", () => {
  async function badInsert(actionItemsLiteral: string | null): Promise<unknown> {
    try {
      if (actionItemsLiteral === null) {
        await pool.query(
          `INSERT INTO lessons (module_id, title, description, action_items)
           VALUES ($1, $2, $3, NULL)`,
          [testModuleId, `${TEST_PREFIX}lesson_${Date.now()}`, "fixture"],
        );
      } else {
        await pool.query(
          `INSERT INTO lessons (module_id, title, description, action_items)
           VALUES ($1, $2, $3, $4::jsonb)`,
          [testModuleId, `${TEST_PREFIX}lesson_${Date.now()}`, "fixture", actionItemsLiteral],
        );
      }
    } catch (err) {
      return err;
    }
    return null;
  }

  it("rejects an INSERT whose action_items is a JSONB string scalar (the original bug shape)", async () => {
    const caught = await badInsert(
      JSON.stringify(JSON.stringify([{ id: "1", text: "x", sortOrder: 0 }])),
    );
    expect(caught, "INSERT was not rejected — the CHECK constraint is missing or wrong.").not.toBeNull();
    const pgErr = asPgError(caught);
    expect(pgErr.code).toBe("23514");
    expect(pgErr.constraint).toBe("lessons_action_items_is_array");
  });

  it("rejects an INSERT whose action_items is a JSONB number scalar", async () => {
    const caught = await badInsert("42");
    expect(caught).not.toBeNull();
    const pgErr = asPgError(caught);
    expect(pgErr.code).toBe("23514");
    expect(pgErr.constraint).toBe("lessons_action_items_is_array");
  });

  it("rejects an INSERT whose action_items is a JSONB object", async () => {
    const caught = await badInsert(JSON.stringify({ foo: "bar" }));
    expect(caught).not.toBeNull();
    const pgErr = asPgError(caught);
    expect(pgErr.code).toBe("23514");
    expect(pgErr.constraint).toBe("lessons_action_items_is_array");
  });

  it("rejects an UPDATE that turns an existing array into a string scalar", async () => {
    const title = `${TEST_PREFIX}update_${Date.now()}`;
    await pool.query(
      `INSERT INTO lessons (module_id, title, description, action_items)
       VALUES ($1, $2, $3, $4::jsonb)`,
      [testModuleId, title, "fixture", JSON.stringify([{ id: "1", text: "x", sortOrder: 0 }])],
    );
    let caught: unknown = null;
    try {
      await pool.query(
        `UPDATE lessons SET action_items = $1::jsonb WHERE title = $2`,
        [JSON.stringify(JSON.stringify([{ id: "1", text: "x", sortOrder: 0 }])), title],
      );
    } catch (err) {
      caught = err;
    }
    expect(caught).not.toBeNull();
    const pgErr = asPgError(caught);
    expect(pgErr.code).toBe("23514");
    expect(pgErr.constraint).toBe("lessons_action_items_is_array");
  });

  it("accepts an INSERT with a real JSONB array (sanity check)", async () => {
    const caught = await badInsert(
      JSON.stringify([{ id: "1", text: "follow up", sortOrder: 0 }]),
    );
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

describe("lesson_versions.action_items CHECK constraint", () => {
  async function badInsert(versionNumber: number, actionItemsLiteral: string | null): Promise<unknown> {
    try {
      if (actionItemsLiteral === null) {
        await pool.query(
          `INSERT INTO lesson_versions
             (lesson_id, version_number, title, content_type, action_items)
           VALUES ($1, $2, $3, $4, NULL)`,
          [testLessonId, versionNumber, "ver", "video"],
        );
      } else {
        await pool.query(
          `INSERT INTO lesson_versions
             (lesson_id, version_number, title, content_type, action_items)
           VALUES ($1, $2, $3, $4, $5::jsonb)`,
          [testLessonId, versionNumber, "ver", "video", actionItemsLiteral],
        );
      }
    } catch (err) {
      return err;
    }
    return null;
  }

  it("rejects an INSERT whose action_items is a JSONB string scalar (the original bug shape)", async () => {
    const caught = await badInsert(
      201,
      JSON.stringify(JSON.stringify([{ id: "1", text: "x", sortOrder: 0 }])),
    );
    expect(caught).not.toBeNull();
    const pgErr = asPgError(caught);
    expect(pgErr.code).toBe("23514");
    expect(pgErr.constraint).toBe("lesson_versions_action_items_is_array");
  });

  it("rejects an INSERT whose action_items is a JSONB object", async () => {
    const caught = await badInsert(202, JSON.stringify({ foo: "bar" }));
    expect(caught).not.toBeNull();
    const pgErr = asPgError(caught);
    expect(pgErr.code).toBe("23514");
    expect(pgErr.constraint).toBe("lesson_versions_action_items_is_array");
  });

  it("rejects an UPDATE that turns an existing array into a string scalar", async () => {
    const versionNumber = 250;
    await pool.query(
      `INSERT INTO lesson_versions
         (lesson_id, version_number, title, content_type, action_items)
       VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [
        testLessonId,
        versionNumber,
        "ver",
        "video",
        JSON.stringify([{ id: "1", text: "x", sortOrder: 0 }]),
      ],
    );
    let caught: unknown = null;
    try {
      await pool.query(
        `UPDATE lesson_versions SET action_items = $1::jsonb
         WHERE lesson_id = $2 AND version_number = $3`,
        [
          JSON.stringify(JSON.stringify([{ id: "1", text: "x", sortOrder: 0 }])),
          testLessonId,
          versionNumber,
        ],
      );
    } catch (err) {
      caught = err;
    }
    expect(caught).not.toBeNull();
    const pgErr = asPgError(caught);
    expect(pgErr.code).toBe("23514");
    expect(pgErr.constraint).toBe("lesson_versions_action_items_is_array");
  });

  it("accepts an INSERT with a real JSONB array (sanity check)", async () => {
    const caught = await badInsert(
      203,
      JSON.stringify([{ id: "1", text: "follow up", sortOrder: 0 }]),
    );
    expect(caught).toBeNull();
  });

  it("accepts an INSERT with NULL action_items (column is nullable)", async () => {
    const caught = await badInsert(204, null);
    expect(caught).toBeNull();
  });
});
