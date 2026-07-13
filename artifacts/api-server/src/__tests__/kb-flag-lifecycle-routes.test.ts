import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import {
  db,
  usersTable,
  kbStagingDocsTable,
  kbTriageAuditLogTable,
  kbHighlightDismissalsTable,
  kbFlagResolutionsTable,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import type { RiskFlag } from "../lib/kb-flags.js";

import { buildTestAppWithRouters } from "./test-app";
import knowledgebaseStagingRouter from "../routes/admin/knowledgebase-staging";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const TEST_TAG = `kb-fl-${randomUUID().slice(0, 8)}`;

const seededUserIds: number[] = [];
const seededStagingIds: number[] = [];
const seededDismissalIds: number[] = [];

let app: ReturnType<typeof buildTestAppWithRouters>;
let adminCookie: string;

// A passage the review-risk analyzer reliably highlights: a leftover
// synthesis [SITUATIONAL] tag. Unique per run so dismissals never collide
// with other rows in the shared dev DB.
const TAGGED_LINE = `[SITUATIONAL] ${TEST_TAG} aim for the flux threshold before each batch.`;

const CRITICAL_FLAG: RiskFlag = {
  type: "conflict",
  severity: "critical",
  message: `${TEST_TAG} conflicts with a verified doc`,
  detail: "Seeded for lifecycle test",
};

async function seedAdmin(): Promise<void> {
  const email = `${TEST_TAG}-admin@example.test`;
  const passwordHash = await bcrypt.hash("irrelevant", 4);
  const [row] = await db
    .insert(usersTable)
    .values({
      email,
      name: "Flag Lifecycle Admin",
      passwordHash,
      role: "admin",
      sourceProduct: "lifetime",
      emailVerified: true,
      onboardingComplete: true,
    })
    .returning({ id: usersTable.id });
  seededUserIds.push(row.id);
  const token = jwt.sign({ userId: row.id, email }, JWT_SECRET, { expiresIn: "1h" });
  adminCookie = `access_token=${token}`;
}

async function seedDoc(opts: {
  content: string;
  riskFlags?: RiskFlag[];
  needsExpert?: boolean;
}): Promise<number> {
  const [row] = await db
    .insert(kbStagingDocsTable)
    .values({
      title: `${TEST_TAG}-doc-${seededStagingIds.length}`,
      category: "curriculum",
      content: opts.content,
      status: "needs_review",
      source: "synthesis",
      riskFlags: opts.riskFlags ?? [],
      needsExpert: opts.needsExpert ?? false,
    })
    .returning({ id: kbStagingDocsTable.id });
  seededStagingIds.push(row.id);
  return row.id;
}

beforeAll(async () => {
  app = buildTestAppWithRouters([knowledgebaseStagingRouter]);
  await seedAdmin();
});

afterAll(async () => {
  if (seededDismissalIds.length > 0) {
    await db
      .delete(kbHighlightDismissalsTable)
      .where(inArray(kbHighlightDismissalsTable.id, seededDismissalIds));
  }
  if (seededStagingIds.length > 0) {
    await db
      .delete(kbFlagResolutionsTable)
      .where(inArray(kbFlagResolutionsTable.stagingDocId, seededStagingIds));
    await db
      .delete(kbTriageAuditLogTable)
      .where(inArray(kbTriageAuditLogTable.stagingDocId, seededStagingIds));
    await db.delete(kbStagingDocsTable).where(inArray(kbStagingDocsTable.id, seededStagingIds));
  }
  if (seededUserIds.length > 0) {
    await db.delete(usersTable).where(inArray(usersTable.id, seededUserIds));
  }
});

describe("approval gate + flag resolution lifecycle", () => {
  it("blocks transition-to-approved while an active flag remains, then allows it after resolve", async () => {
    const docId = await seedDoc({
      content: `${TEST_TAG} clean body with no risky passages at all.`,
      riskFlags: [CRITICAL_FLAG],
      needsExpert: true,
    });

    // Gate fires only on the transition to approved.
    const blocked = await request(app)
      .patch(`/api/${docId}`)
      .set("Cookie", adminCookie)
      .send({ status: "approved" });
    expect(blocked.status).toBe(409);
    expect(blocked.body.outstanding.flags).toHaveLength(1);
    expect(blocked.body.outstanding.flags[0].type).toBe("conflict");

    // Non-approval PATCHes pass through the gate untouched.
    const notesOnly = await request(app)
      .patch(`/api/${docId}`)
      .set("Cookie", adminCookie)
      .send({ adminNotes: "still reviewing" });
    expect(notesOnly.status).toBe(200);

    // Resolve the flag (audit-trailed) — clears needsExpert (it was the only critical).
    const resolved = await request(app)
      .post(`/api/${docId}/flags/resolve`)
      .set("Cookie", adminCookie)
      .send({ flagType: "conflict", reason: "verified against the contract" });
    expect(resolved.status).toBe(200);
    expect(resolved.body.needsExpert).toBe(false);
    expect(resolved.body.flagStates[0].resolved).toBe(true);

    const audits = await db
      .select()
      .from(kbTriageAuditLogTable)
      .where(eq(kbTriageAuditLogTable.stagingDocId, docId));
    expect(audits.some((a) => a.eventType === "flag_resolved")).toBe(true);

    // Approval now goes through.
    const approved = await request(app)
      .patch(`/api/${docId}`)
      .set("Cookie", adminCookie)
      .send({ status: "approved" });
    expect(approved.status).toBe(200);
    expect(approved.body.status).toBe("approved");
  });

  it("unresolve reopens the flag and re-blocks approval", async () => {
    const docId = await seedDoc({
      content: `${TEST_TAG} another clean body.`,
      riskFlags: [CRITICAL_FLAG],
      needsExpert: true,
    });

    await request(app)
      .post(`/api/${docId}/flags/resolve`)
      .set("Cookie", adminCookie)
      .send({ flagType: "conflict" });

    const reopened = await request(app)
      .post(`/api/${docId}/flags/unresolve`)
      .set("Cookie", adminCookie)
      .send({ flagType: "conflict" });
    expect(reopened.status).toBe(200);
    expect(reopened.body.needsExpert).toBe(true);

    const blocked = await request(app)
      .patch(`/api/${docId}`)
      .set("Cookie", adminCookie)
      .send({ status: "approved" });
    expect(blocked.status).toBe(409);
  });

  it("resolving an unknown or absent flag type is rejected", async () => {
    const docId = await seedDoc({ content: `${TEST_TAG} body.`, riskFlags: [] });

    const badType = await request(app)
      .post(`/api/${docId}/flags/resolve`)
      .set("Cookie", adminCookie)
      .send({ flagType: "not_a_flag" });
    expect(badType.status).toBe(400);

    const absent = await request(app)
      .post(`/api/${docId}/flags/resolve`)
      .set("Cookie", adminCookie)
      .send({ flagType: "conflict" });
    expect(absent.status).toBe(409);
  });
});

describe("highlight dismissal lifecycle", () => {
  it("dismisses an active highlight, gates approval until then, and undo re-flags it", async () => {
    const docId = await seedDoc({ content: `Intro line.\n\n${TAGGED_LINE}\n\nOutro.` });

    // The leftover synthesis tag is an active highlight → approval is blocked.
    const blocked = await request(app)
      .patch(`/api/${docId}`)
      .set("Cookie", adminCookie)
      .send({ status: "approved" });
    expect(blocked.status).toBe(409);
    expect(blocked.body.outstanding.highlights.length).toBeGreaterThan(0);
    const highlight = blocked.body.outstanding.highlights[0];

    // Persistently ignore it (kind + normalized excerpt).
    const dismissed = await request(app)
      .post("/api/highlight-dismissals")
      .set("Cookie", adminCookie)
      .send({ kind: highlight.kind, excerpt: highlight.excerpt, docId });
    expect(dismissed.status).toBe(200);
    const dismissalId: number = dismissed.body.dismissal.id;
    seededDismissalIds.push(dismissalId);

    // review-insights now reports it under dismissedHighlights, not highlights.
    const insights = await request(app)
      .get(`/api/${docId}/review-insights`)
      .set("Cookie", adminCookie);
    expect(insights.status).toBe(200);
    expect(insights.body.highlights).toHaveLength(0);
    expect(insights.body.dismissedHighlights.map((h: { dismissalId: number }) => h.dismissalId)).toContain(
      dismissalId,
    );

    // Approval goes through with the highlight ignored.
    const approved = await request(app)
      .patch(`/api/${docId}`)
      .set("Cookie", adminCookie)
      .send({ status: "approved" });
    expect(approved.status).toBe(200);

    // Undo → the passage flags again.
    const undo = await request(app)
      .delete(`/api/highlight-dismissals/${dismissalId}`)
      .set("Cookie", adminCookie);
    expect(undo.status).toBe(200);
    const after = await request(app).get(`/api/${docId}/review-insights`).set("Cookie", adminCookie);
    expect(after.body.highlights.length).toBeGreaterThan(0);
  });

  it("refuses to dismiss possible_member_name highlights (name vocab owns those)", async () => {
    const res = await request(app)
      .post("/api/highlight-dismissals")
      .set("Cookie", adminCookie)
      .send({ kind: "possible_member_name", excerpt: "Jane Doe" });
    expect(res.status).toBe(400);
  });

  it("refuses to dismiss a highlight not present on the doc's current text", async () => {
    const docId = await seedDoc({ content: `${TEST_TAG} totally clean.` });
    const res = await request(app)
      .post("/api/highlight-dismissals")
      .set("Cookie", adminCookie)
      .send({ kind: "synthesis_situational", excerpt: "[SITUATIONAL] not in the doc", docId });
    expect(res.status).toBe(409);
  });
});
