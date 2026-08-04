import { getParam } from "../lib/params";
import { Router, type IRouter } from "express";
import { db, courseProgressTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { isValidBlitzCourseId } from "../lib/blitz/sections";
import { hasPageAccessForUser } from "../middleware/require-page-access";

const router: IRouter = Router();

const STATIC_VALID_COURSE_IDS = new Set([
  "quick-start",
  "finding-your-edge",
  "21-day-blitz",
  "live-coaching",
  "7-pillars",
  "direct-edge",
]);

function isValidCourseId(id: unknown): id is string {
  if (typeof id !== "string") return false;
  if (STATIC_VALID_COURSE_IDS.has(id)) return true;
  // Canonical Blitz Caterpillar Edition hub steps (v2): validated against the
  // shared @workspace/blitz-curriculum source of truth (lessons 1-23).
  if (isValidBlitzCourseId(id)) return true;
  // Legacy hub steps 1-18 (pre-v2 ids; kept so older rows can still be removed).
  const legacy = (id as string).match(/^blitz-hub-step-(\d+)$/);
  if (legacy) {
    const n = Number(legacy[1]);
    return n >= 1 && n <= 18;
  }
  return false;
}

/**
 * True when the course id belongs to the Blitz in ANY of its forms: canonical
 * v2 hub steps, legacy hub steps 1-18, or the static "21-day-blitz" course.
 * These ride the same ownership gate as the /blitz/* APIs.
 */
export function isBlitzCourseId(id: string): boolean {
  if (id === "21-day-blitz") return true;
  if (isValidBlitzCourseId(id)) return true;
  return /^blitz-hub-step-\d+$/.test(id);
}

function sendBlitzNotOwned(res: { status: (n: number) => { json: (b: unknown) => void } }): void {
  res.status(403).json({
    error: "CONTENT_NOT_OWNED",
    pageKey: "blitz",
    message: "This content isn't included in your current products.",
    upgrade: {
      reason: `Access to this page requires a product that includes "blitz".`,
      learnMorePath: "/",
    },
  });
}

router.get("/course-progress", async (req, res): Promise<void> => {
  const userId = req.userId!;
  const entries = await db
    .select()
    .from(courseProgressTable)
    .where(eq(courseProgressTable.userId, userId));

  // Blitz rows are ownership-gated content: hide them from non-owners so this
  // legacy read path can't leak Blitz progress. Non-Blitz rows always serve.
  const hasBlitzRows = entries.some((e) => isBlitzCourseId(e.courseId));
  if (hasBlitzRows && !(await hasPageAccessForUser(userId, "blitz"))) {
    res.json(entries.filter((e) => !isBlitzCourseId(e.courseId)));
    return;
  }
  res.json(entries);
});

router.post("/course-progress", async (req, res): Promise<void> => {
  const userId = req.userId!;
  const { courseId } = req.body;

  if (!isValidCourseId(courseId)) {
    res.status(400).json({ error: "Invalid courseId" });
    return;
  }

  if (isBlitzCourseId(courseId) && !(await hasPageAccessForUser(userId, "blitz"))) {
    sendBlitzNotOwned(res);
    return;
  }

  const existing = await db
    .select()
    .from(courseProgressTable)
    .where(
      and(
        eq(courseProgressTable.userId, userId),
        eq(courseProgressTable.courseId, courseId)
      )
    );

  if (existing.length > 0) {
    res.json(existing[0]);
    return;
  }

  try {
    const [entry] = await db
      .insert(courseProgressTable)
      .values({ userId, courseId })
      .onConflictDoNothing()
      .returning();

    if (!entry) {
      const [fallback] = await db
        .select()
        .from(courseProgressTable)
        .where(
          and(
            eq(courseProgressTable.userId, userId),
            eq(courseProgressTable.courseId, courseId)
          )
        );
      res.json(fallback);
      return;
    }

    res.status(201).json(entry);
  } catch {
    const [fallback] = await db
      .select()
      .from(courseProgressTable)
      .where(
        and(
          eq(courseProgressTable.userId, userId),
          eq(courseProgressTable.courseId, courseId)
        )
      );
    if (fallback) {
      res.json(fallback);
      return;
    }
    res.status(500).json({ error: "Failed to save progress" });
  }
});

router.delete("/course-progress/:courseId", async (req, res): Promise<void> => {
  const userId = req.userId!;
  const courseId = getParam(req.params.courseId);

  if (!isValidCourseId(courseId)) {
    res.status(400).json({ error: "Invalid courseId" });
    return;
  }

  if (isBlitzCourseId(courseId) && !(await hasPageAccessForUser(userId, "blitz"))) {
    sendBlitzNotOwned(res);
    return;
  }

  await db
    .delete(courseProgressTable)
    .where(
      and(
        eq(courseProgressTable.userId, userId),
        eq(courseProgressTable.courseId, courseId)
      )
    );

  res.json({ success: true });
});

export default router;
