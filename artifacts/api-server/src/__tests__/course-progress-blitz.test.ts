import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import { db, usersTable, courseProgressTable } from "@workspace/db";
import { eq, inArray, and } from "drizzle-orm";

import express, { type Express } from "express";
import cookieParser from "cookie-parser";
import { authenticate } from "../middleware/auth";
import { requestIdMiddleware, apiErrorHandler } from "../lib/api-errors";
import courseProgressRouter from "../routes/course-progress";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const TEST_TAG = `cp-blitz-${randomUUID().slice(0, 8)}`;

let app: Express;
const seededUserIds: number[] = [];

interface Fixture {
  id: number;
  email: string;
  cookie: string;
}

let memberA: Fixture;
let memberB: Fixture;

function signCookie(userId: number, email: string): string {
  const token = jwt.sign({ userId, email }, JWT_SECRET, { expiresIn: "1h" });
  return `access_token=${token}`;
}

async function makeUser(suffix: string): Promise<Fixture> {
  const email = `${TEST_TAG}-${suffix}@example.test`;
  const passwordHash = await bcrypt.hash("irrelevant", 4);
  const [row] = await db
    .insert(usersTable)
    .values({
      email,
      name: `User ${suffix}`,
      passwordHash,
      role: "member",
      sourceProduct: "3-month",
      emailVerified: true,
      onboardingComplete: true,
    })
    .returning({ id: usersTable.id, email: usersTable.email });
  seededUserIds.push(row.id);
  return { id: row.id, email: row.email, cookie: signCookie(row.id, row.email) };
}

beforeAll(async () => {
  app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use("/api", requestIdMiddleware);
  app.use("/api", authenticate);
  app.use("/api", courseProgressRouter);
  app.use("/api", apiErrorHandler);

  memberA = await makeUser("a");
  memberB = await makeUser("b");
});

afterAll(async () => {
  if (seededUserIds.length > 0) {
    await db
      .delete(courseProgressTable)
      .where(inArray(courseProgressTable.userId, seededUserIds));
    await db.delete(usersTable).where(inArray(usersTable.id, seededUserIds));
  }
});

const COURSE = (id: number) => `blitz-hub-step-v2-${id}`;

describe("Blitz Mark Complete — course-progress API", () => {
  it("requires authentication", async () => {
    await request(app).get("/api/course-progress").expect(401);
    await request(app)
      .post("/api/course-progress")
      .send({ courseId: COURSE(1) })
      .expect(401);
  });

  it("marks a single v2 lesson complete (POST creates a row)", async () => {
    const res = await request(app)
      .post("/api/course-progress")
      .set("Cookie", memberA.cookie)
      .send({ courseId: COURSE(1) });
    expect(res.status).toBe(201);
    expect(res.body.courseId).toBe(COURSE(1));

    const rows = await db
      .select()
      .from(courseProgressTable)
      .where(
        and(
          eq(courseProgressTable.userId, memberA.id),
          eq(courseProgressTable.courseId, COURSE(1)),
        ),
      );
    expect(rows).toHaveLength(1);
  });

  it("GET hydrates the member's completed lessons", async () => {
    const res = await request(app)
      .get("/api/course-progress")
      .set("Cookie", memberA.cookie)
      .expect(200);
    const ids = (res.body as { courseId: string }[]).map((r) => r.courseId);
    expect(ids).toContain(COURSE(1));
  });

  it("is idempotent on re-click (POST twice => one row, no error)", async () => {
    await request(app)
      .post("/api/course-progress")
      .set("Cookie", memberA.cookie)
      .send({ courseId: COURSE(2) })
      .expect(201);
    const second = await request(app)
      .post("/api/course-progress")
      .set("Cookie", memberA.cookie)
      .send({ courseId: COURSE(2) });
    expect([200, 201]).toContain(second.status);

    const rows = await db
      .select()
      .from(courseProgressTable)
      .where(
        and(
          eq(courseProgressTable.userId, memberA.id),
          eq(courseProgressTable.courseId, COURSE(2)),
        ),
      );
    expect(rows).toHaveLength(1);
  });

  it("survives rapid concurrent clicks (no duplicate rows)", async () => {
    const courseId = COURSE(3);
    await Promise.all(
      Array.from({ length: 8 }).map(() =>
        request(app)
          .post("/api/course-progress")
          .set("Cookie", memberA.cookie)
          .send({ courseId }),
      ),
    );
    const rows = await db
      .select()
      .from(courseProgressTable)
      .where(
        and(
          eq(courseProgressTable.userId, memberA.id),
          eq(courseProgressTable.courseId, courseId),
        ),
      );
    expect(rows).toHaveLength(1);
  });

  it("accepts all 23 canonical v2 lessons (bulk completion)", async () => {
    for (let i = 1; i <= 23; i++) {
      const res = await request(app)
        .post("/api/course-progress")
        .set("Cookie", memberA.cookie)
        .send({ courseId: COURSE(i) });
      expect([200, 201]).toContain(res.status);
    }
    const rows = await db
      .select()
      .from(courseProgressTable)
      .where(eq(courseProgressTable.userId, memberA.id));
    const v2 = rows.filter((r) => /^blitz-hub-step-v2-\d+$/.test(r.courseId));
    expect(v2).toHaveLength(23);
  });

  it("rejects out-of-range and malformed course ids", async () => {
    for (const bad of ["blitz-hub-step-v2-24", "blitz-hub-step-v2-0", "blitz-hub-step-v2-abc", "totally-made-up"]) {
      const res = await request(app)
        .post("/api/course-progress")
        .set("Cookie", memberA.cookie)
        .send({ courseId: bad });
      expect(res.status).toBe(400);
    }
  });

  it("unmarks a lesson (DELETE removes the row)", async () => {
    await request(app)
      .delete(`/api/course-progress/${COURSE(1)}`)
      .set("Cookie", memberA.cookie)
      .expect(200);
    const rows = await db
      .select()
      .from(courseProgressTable)
      .where(
        and(
          eq(courseProgressTable.userId, memberA.id),
          eq(courseProgressTable.courseId, COURSE(1)),
        ),
      );
    expect(rows).toHaveLength(0);
  });

  it("still accepts and removes legacy (pre-v2) hub ids for backward compat", async () => {
    const legacy = "blitz-hub-step-7";
    await request(app)
      .post("/api/course-progress")
      .set("Cookie", memberA.cookie)
      .send({ courseId: legacy })
      .expect(201);
    await request(app)
      .delete(`/api/course-progress/${legacy}`)
      .set("Cookie", memberA.cookie)
      .expect(200);
    const rows = await db
      .select()
      .from(courseProgressTable)
      .where(
        and(
          eq(courseProgressTable.userId, memberA.id),
          eq(courseProgressTable.courseId, legacy),
        ),
      );
    expect(rows).toHaveLength(0);
  });

  it("isolates progress per user (member B cannot see member A's rows)", async () => {
    await request(app)
      .post("/api/course-progress")
      .set("Cookie", memberB.cookie)
      .send({ courseId: COURSE(5) })
      .expect(201);

    const res = await request(app)
      .get("/api/course-progress")
      .set("Cookie", memberB.cookie)
      .expect(200);
    const ids = (res.body as { courseId: string }[]).map((r) => r.courseId);
    expect(ids).toEqual([COURSE(5)]);
  });
});
