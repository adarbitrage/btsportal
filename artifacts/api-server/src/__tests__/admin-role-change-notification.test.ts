import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import { db, usersTable, auditLogTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

vi.mock("../lib/redis", () => ({
  getRedis: () => null,
  getRedisConnection: vi.fn(),
  createRedisConnection: vi.fn(),
  isRedisConnected: async () => false,
}));

const { queueEmailMock } = vi.hoisted(() => ({
  queueEmailMock: vi.fn<
    (params: unknown) => Promise<{ result: "queued" }>
  >(async () => ({ result: "queued" })),
}));

vi.mock("../lib/communication-service", () => ({
  CommunicationService: {
    queueEmail: queueEmailMock,
  },
}));

import { buildTestAppWithRouters } from "./test-app";
import adminPanelRouter from "../routes/admin-panel";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const TEST_TAG = `admin-role-change-${randomUUID().slice(0, 8)}`;

const seededUserIds: number[] = [];
let app: ReturnType<typeof buildTestAppWithRouters>;
let adminCookie: string;
let memberCookie: string;
let adminId: number;
let adminName: string;

interface SeededUser {
  id: number;
  email: string;
  name: string;
}

function signCookie(userId: number, email: string): string {
  const token = jwt.sign({ userId, email }, JWT_SECRET, { expiresIn: "1h" });
  return `access_token=${token}`;
}

async function insertUser(role: string, suffix: string, name?: string): Promise<SeededUser> {
  const email = `${TEST_TAG}-${suffix}@example.test`;
  const finalName = name ?? `Test ${suffix}`;
  const passwordHash = await bcrypt.hash("irrelevant-test-password", 4);
  const [row] = await db
    .insert(usersTable)
    .values({
      email,
      name: finalName,
      passwordHash,
      role,
      sourceProduct: "lifetime",
      emailVerified: true,
      onboardingComplete: true,
    })
    .returning({ id: usersTable.id });
  seededUserIds.push(row.id);
  return { id: row.id, email, name: finalName };
}

async function setRole(userId: number, role: string) {
  await db.update(usersTable).set({ role }).where(eq(usersTable.id, userId));
}

beforeAll(async () => {
  app = buildTestAppWithRouters([adminPanelRouter]);
  const admin = await insertUser("super_admin", "admin", "Sandra Superadmin");
  const member = await insertUser("member", "non-admin");
  adminId = admin.id;
  adminName = admin.name;
  adminCookie = signCookie(admin.id, admin.email);
  memberCookie = signCookie(member.id, member.email);
});

afterAll(async () => {
  if (seededUserIds.length > 0) {
    await db
      .delete(auditLogTable)
      .where(inArray(auditLogTable.actorId, seededUserIds));
    await db.delete(usersTable).where(inArray(usersTable.id, seededUserIds));
  }
});

describe("POST /api/admin/members/:id/role role-change notification", () => {
  beforeEach(() => {
    queueEmailMock.mockClear();
  });

  it("emails the affected member when their role actually changes", async () => {
    const target = await insertUser("member", "promote-target", "Pat Promotee");

    const res = await request(app)
      .post(`/api/admin/members/${target.id}/role`)
      .set("Cookie", adminCookie)
      .send({ role: "support_agent" });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: target.id, role: "support_agent", changed: true });

    expect(queueEmailMock).toHaveBeenCalledTimes(1);
    const [params] = queueEmailMock.mock.calls[0] as [{
      templateSlug: string;
      to: string;
      userId: number;
      variables: Record<string, string>;
    }];
    expect(params.templateSlug).toBe("role_changed");
    expect(params.to).toBe(target.email);
    expect(params.userId).toBe(target.id);
    expect(params.variables).toMatchObject({
      member_name: "Pat Promotee",
      actor_name: adminName,
      previous_role_label: "Member",
      new_role_label: "Support Agent",
    });
  });

  it("uses friendly labels when demoting an admin back to member", async () => {
    const target = await insertUser("admin", "demote-target", "Dee Demotee");

    const res = await request(app)
      .post(`/api/admin/members/${target.id}/role`)
      .set("Cookie", adminCookie)
      .send({ role: "member" });

    expect(res.status).toBe(200);
    expect(queueEmailMock).toHaveBeenCalledTimes(1);
    const [params] = queueEmailMock.mock.calls[0] as [{
      variables: Record<string, string>;
    }];
    expect(params.variables.previous_role_label).toBe("Admin");
    expect(params.variables.new_role_label).toBe("Member");
  });

  it("does NOT email the member when the role is unchanged (no-op assignment)", async () => {
    const target = await insertUser("admin", "noop-target", "Noah Noop");

    const res = await request(app)
      .post(`/api/admin/members/${target.id}/role`)
      .set("Cookie", adminCookie)
      .send({ role: "admin" });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: target.id, role: "admin", changed: false });
    expect(queueEmailMock).not.toHaveBeenCalled();
  });

  it("does NOT email when an unauthorized caller is rejected", async () => {
    const target = await insertUser("member", "rbac-target");

    const res = await request(app)
      .post(`/api/admin/members/${target.id}/role`)
      .set("Cookie", memberCookie)
      .send({ role: "admin" });

    expect(res.status).toBe(403);

    // Role must not have changed and no notification fired.
    const [row] = await db
      .select({ role: usersTable.role })
      .from(usersTable)
      .where(eq(usersTable.id, target.id));
    expect(row.role).toBe("member");
    expect(queueEmailMock).not.toHaveBeenCalled();
  });

  it("does NOT email when input validation fails", async () => {
    const target = await insertUser("member", "validation-target");

    const res = await request(app)
      .post(`/api/admin/members/${target.id}/role`)
      .set("Cookie", adminCookie)
      .send({ role: "not-a-real-role" });

    expect(res.status).toBe(400);
    expect(queueEmailMock).not.toHaveBeenCalled();
  });

  it("falls back to the actor's email when the actor has no name", async () => {
    // Insert an admin with an empty name to confirm the fallback chain.
    const namelessAdmin = await insertUser("super_admin", "nameless-admin", "");
    // We seeded with empty string; the route falls back to email if name is blank.
    await db.update(usersTable).set({ name: "" }).where(eq(usersTable.id, namelessAdmin.id));
    const namelessCookie = signCookie(namelessAdmin.id, namelessAdmin.email);

    const target = await insertUser("member", "nameless-target");
    const res = await request(app)
      .post(`/api/admin/members/${target.id}/role`)
      .set("Cookie", namelessCookie)
      .send({ role: "support_agent" });

    expect(res.status).toBe(200);
    expect(queueEmailMock).toHaveBeenCalledTimes(1);
    const [params] = queueEmailMock.mock.calls[0] as [{ variables: Record<string, string> }];
    expect(params.variables.actor_name).toBe(namelessAdmin.email);
  });

  it("still returns 200 when the notification queue throws", async () => {
    queueEmailMock.mockImplementationOnce(async () => {
      throw new Error("simulated outage");
    });
    const target = await insertUser("member", "queue-failure-target", "Quentin Queue");

    const res = await request(app)
      .post(`/api/admin/members/${target.id}/role`)
      .set("Cookie", adminCookie)
      .send({ role: "support_agent" });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: target.id, role: "support_agent", changed: true });
    // Role still changed in the DB.
    const [row] = await db
      .select({ role: usersTable.role })
      .from(usersTable)
      .where(eq(usersTable.id, target.id));
    expect(row.role).toBe("support_agent");
  });
});
