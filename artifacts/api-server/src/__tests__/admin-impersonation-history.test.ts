import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import { db, usersTable, auditLogTable } from "@workspace/db";
import { inArray } from "drizzle-orm";

import { buildTestAppWithRouters } from "./test-app";
import adminPanelRouter from "../routes/admin-panel";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const TEST_TAG = `imp-history-${randomUUID().slice(0, 8)}`;

let app: ReturnType<typeof buildTestAppWithRouters>;
let adminCookie = "";
let memberCookie = "";
let adminId = 0;
let adminEmail = "";
let memberId = 0;
const seededUserIds: number[] = [];
const seededAuditIds: number[] = [];

// Timeline anchors for the seeded session history (oldest -> newest). One
// admin acting against one member, deliberately constructed to exercise every
// pairing branch in a single chronological walk:
//   orphanStop   — a stop with no preceding open start (its start predates us)
//   start1       — opens session S1
//   stop1Early   — the EARLIEST stop after start1; S1 must pair to THIS one
//   stop1Late    — a second stop; S1 is already closed, so it's an orphan
//   start2       — opens session S2 that never closes (ongoing)
const base = Date.now() - 2 * 60 * 60 * 1000;
const tOrphanStop = new Date(base);
const tStart1 = new Date(base + 60_000);
const tStop1Early = new Date(base + 120_000); // duration of S1 = 60_000ms
const tStop1Late = new Date(base + 180_000);
const tStart2 = new Date(base + 240_000);
const S1_DURATION_MS = tStop1Early.getTime() - tStart1.getTime();

// Captured per-row ids so we can pinpoint individual seeded rows in the
// (potentially noisy) global audit-log listing.
let idOrphanStop = 0;
let idStart1 = 0;
let idStop1Early = 0;
let idStop1Late = 0;
let idStart2 = 0;

function signCookie(userId: number, email: string): string {
  const token = jwt.sign({ userId, email }, JWT_SECRET, { expiresIn: "1h" });
  return `access_token=${token}`;
}

beforeAll(async () => {
  app = buildTestAppWithRouters([adminPanelRouter]);

  const passwordHash = await bcrypt.hash("irrelevant", 4);

  const [admin] = await db
    .insert(usersTable)
    .values({
      email: `${TEST_TAG}-admin@example.test`,
      name: "Impersonation Admin",
      passwordHash,
      role: "super_admin",
      sourceProduct: "lifetime",
      emailVerified: true,
      onboardingComplete: true,
    })
    .returning({ id: usersTable.id, email: usersTable.email });
  adminId = admin.id;
  adminEmail = admin.email;
  seededUserIds.push(admin.id);
  adminCookie = signCookie(admin.id, admin.email);

  const [member] = await db
    .insert(usersTable)
    .values({
      email: `${TEST_TAG}-member@example.test`,
      name: "Impersonation Member",
      passwordHash,
      role: "member",
      sourceProduct: "lifetime",
      emailVerified: true,
      onboardingComplete: true,
    })
    .returning({ id: usersTable.id, email: usersTable.email });
  memberId = member.id;
  seededUserIds.push(member.id);
  memberCookie = signCookie(member.id, member.email);

  // Noise row against the SAME member with a non-impersonation action type —
  // must never appear in either the impersonation-history endpoint or the
  // synthetic "impersonation" audit-log filter.
  const rows = [
    {
      actionType: "impersonate_stop",
      entityType: "user",
      entityId: String(memberId),
      actorId: adminId,
      actorEmail: adminEmail,
      description: "orphan stop (start predates window)",
      createdAt: tOrphanStop,
    },
    {
      actionType: "impersonate_start",
      entityType: "user",
      entityId: String(memberId),
      actorId: adminId,
      actorEmail: adminEmail,
      description: "start session 1",
      createdAt: tStart1,
    },
    {
      actionType: "impersonate_stop",
      entityType: "user",
      entityId: String(memberId),
      actorId: adminId,
      actorEmail: adminEmail,
      description: "stop session 1 (earliest)",
      createdAt: tStop1Early,
    },
    {
      actionType: "impersonate_stop",
      entityType: "user",
      entityId: String(memberId),
      actorId: adminId,
      actorEmail: adminEmail,
      description: "stop session 1 (late duplicate)",
      createdAt: tStop1Late,
    },
    {
      actionType: "impersonate_start",
      entityType: "user",
      entityId: String(memberId),
      actorId: adminId,
      actorEmail: adminEmail,
      description: "start session 2 (ongoing)",
      createdAt: tStart2,
    },
    {
      actionType: "admin_note",
      entityType: "user",
      entityId: String(memberId),
      actorId: adminId,
      actorEmail: adminEmail,
      description: "non-impersonation noise row",
      createdAt: new Date(base + 300_000),
    },
  ];
  const inserted = await db.insert(auditLogTable).values(rows).returning({
    id: auditLogTable.id,
    actionType: auditLogTable.actionType,
    createdAt: auditLogTable.createdAt,
  });
  seededAuditIds.push(...inserted.map((r) => r.id));

  // Map each row back to its anchor by (actionType, createdAt).
  const at = (action: string, when: Date) =>
    inserted.find(
      (r) =>
        r.actionType === action &&
        r.createdAt instanceof Date &&
        r.createdAt.getTime() === when.getTime(),
    )!.id;
  idOrphanStop = at("impersonate_stop", tOrphanStop);
  idStart1 = at("impersonate_start", tStart1);
  idStop1Early = at("impersonate_stop", tStop1Early);
  idStop1Late = at("impersonate_stop", tStop1Late);
  idStart2 = at("impersonate_start", tStart2);
});

afterAll(async () => {
  if (seededAuditIds.length > 0) {
    await db.delete(auditLogTable).where(inArray(auditLogTable.id, seededAuditIds));
  }
  if (seededUserIds.length > 0) {
    await db.delete(usersTable).where(inArray(usersTable.id, seededUserIds));
  }
});

interface SessionRow {
  adminId: number | null;
  adminEmail: string | null;
  startId: number | null;
  startedAt: string | null;
  stopId: number | null;
  stoppedAt: string | null;
  durationMs: number | null;
}

describe("GET /admin/members/:id/impersonation-history", () => {
  it("pairs start->earliest stop, surfaces ongoing sessions and orphan stops, newest-first", async () => {
    const res = await request(app)
      .get(`/api/admin/members/${memberId}/impersonation-history`)
      .set("Cookie", adminCookie);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ total: expect.any(Number), limit: expect.any(Number) });
    const sessions: SessionRow[] = res.body.sessions;
    expect(Array.isArray(sessions)).toBe(true);

    // The member is freshly created, so the endpoint returns exactly the four
    // sessions our timeline produces and nothing else.
    expect(sessions).toHaveLength(4);
    expect(res.body.total).toBe(4);

    // Newest session first: the ongoing start2 leads.
    expect(sessions[0]).toMatchObject({
      startId: idStart2,
      stopId: null,
      durationMs: null,
    });
    expect(sessions[0].startedAt).toBe(tStart2.toISOString());
    expect(sessions[0].adminEmail).toBe(adminEmail);
    expect(sessions[0].adminId).toBe(adminId);

    // The paired session must bind start1 to the EARLIEST following stop
    // (stop1Early), not the later duplicate, and carry the matching duration.
    const paired = sessions.find((s) => s.startId === idStart1);
    expect(paired).toBeDefined();
    expect(paired!.stopId).toBe(idStop1Early);
    expect(paired!.stoppedAt).toBe(tStop1Early.toISOString());
    expect(paired!.startedAt).toBe(tStart1.toISOString());
    expect(paired!.durationMs).toBe(S1_DURATION_MS);

    // Two orphan stops (the pre-window stop and the late duplicate) appear as
    // sessions with no start.
    const orphans = sessions.filter((s) => s.startId === null);
    expect(orphans.map((o) => o.stopId).sort()).toEqual(
      [idOrphanStop, idStop1Late].sort(),
    );
    for (const o of orphans) {
      expect(o.startedAt).toBeNull();
      expect(o.durationMs).toBeNull();
      expect(o.stoppedAt).not.toBeNull();
    }
  });

  it("returns 400 for a non-numeric member id", async () => {
    const res = await request(app)
      .get(`/api/admin/members/not-a-number/impersonation-history`)
      .set("Cookie", adminCookie);
    expect(res.status).toBe(400);
  });

  it("rejects callers without members:view permission", async () => {
    const res = await request(app)
      .get(`/api/admin/members/${memberId}/impersonation-history`)
      .set("Cookie", memberCookie);
    expect([401, 403]).toContain(res.status);
  });
});

describe("GET /admin/audit-log?actionType=impersonation (synthetic filter)", () => {
  it("matches BOTH impersonate_start and impersonate_stop and excludes other actions", async () => {
    const res = await request(app)
      .get("/api/admin/audit-log")
      .query({ actionType: "impersonation", actorId: String(adminId), limit: "100" })
      .set("Cookie", adminCookie);

    expect(res.status).toBe(200);
    const logs: Array<{ id: number; actionType: string }> = res.body.logs;
    expect(Array.isArray(logs)).toBe(true);

    // Scoped to our admin actor, the filter returns exactly the five
    // impersonation rows — both action types — and nothing else.
    const ids = logs.map((l) => l.id).sort();
    expect(ids).toEqual(
      [idOrphanStop, idStart1, idStop1Early, idStop1Late, idStart2].sort(),
    );
    expect(
      logs.every(
        (l) => l.actionType === "impersonate_start" || l.actionType === "impersonate_stop",
      ),
    ).toBe(true);

    // The non-impersonation noise row on the same actor/member is excluded.
    expect(ids).not.toContain(
      seededAuditIds.find((id) => ![idOrphanStop, idStart1, idStop1Early, idStop1Late, idStart2].includes(id)),
    );
  });

  it("enriches impersonate_start rows with the paired duration; ongoing starts carry none", async () => {
    const res = await request(app)
      .get("/api/admin/audit-log")
      .query({ actionType: "impersonation", actorId: String(adminId), limit: "100" })
      .set("Cookie", adminCookie);

    expect(res.status).toBe(200);
    const logs: Array<{
      id: number;
      impersonationDurationMs?: number | null;
      impersonationStoppedAt?: string | null;
    }> = res.body.logs;

    // start1 is paired with its earliest following stop -> duration attached.
    const start1 = logs.find((l) => l.id === idStart1);
    expect(start1).toBeDefined();
    expect(start1!.impersonationDurationMs).toBe(S1_DURATION_MS);
    expect(start1!.impersonationStoppedAt).toBe(tStop1Early.toISOString());

    // start2 never closes -> no duration enrichment (renders "ongoing").
    const start2 = logs.find((l) => l.id === idStart2);
    expect(start2).toBeDefined();
    expect(start2!.impersonationDurationMs ?? null).toBeNull();
    expect(start2!.impersonationStoppedAt ?? null).toBeNull();
  });
});
