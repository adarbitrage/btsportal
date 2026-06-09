import { describe, it, expect, beforeEach, vi } from "vitest";

interface FakeUser {
  id: number;
  name: string;
  email: string;
  role: string;
}

const state: {
  users: FakeUser[];
  nextId: number;
  inserts: FakeUser[];
  updates: Array<{ id: number; role: string }>;
} = { users: [], nextId: 1, inserts: [], updates: [] };

const sentEmails: Array<{ to: string; templateSlug: string; variables: Record<string, string> }> = [];

vi.mock("@workspace/db", () => {
  const usersTable = {
    id: { n: "id" },
    name: { n: "name" },
    email: { n: "email" },
    role: { n: "role" },
  };

  const db = {
    select: (cols: Record<string, unknown>) => ({
      from: (_t: unknown) => ({
        // Count query: select({ n: count(*) }).from().where()  (awaited directly)
        // Lookup query: select({ id, role }).from().where().limit(1)
        where: (cond: { val: unknown }) => {
          if ("n" in cols) {
            const n = state.users.filter((u) => u.role === "super_admin").length;
            return Promise.resolve([{ n }]);
          }
          return {
            limit: (_n: number) => {
              const u = state.users.find((x) => x.email === cond.val);
              return Promise.resolve(u ? [{ id: u.id, role: u.role }] : []);
            },
          };
        },
      }),
    }),
    update: (_t: unknown) => ({
      set: (vals: { role: string }) => ({
        where: (cond: { val: number }) => {
          const u = state.users.find((x) => x.id === cond.val);
          if (u) u.role = vals.role;
          state.updates.push({ id: cond.val, role: vals.role });
          return Promise.resolve();
        },
      }),
    }),
    insert: (_t: unknown) => ({
      values: (row: { name: string; email: string; role: string }) => ({
        returning: (_c: unknown) => {
          const created: FakeUser = {
            id: state.nextId++,
            name: row.name,
            email: row.email,
            role: row.role,
          };
          state.users.push(created);
          state.inserts.push(created);
          return Promise.resolve([{ id: created.id }]);
        },
      }),
    }),
  };

  return { db, usersTable };
});

vi.mock("drizzle-orm", () => ({
  eq: (col: { n: string }, val: unknown) => ({ col: col.n, val }),
  sql: () => ({ marker: "sql" }),
}));

vi.mock("../lib/communication-service", () => ({
  CommunicationService: {
    sendEmailNow: vi.fn(async (params: { to: string; templateSlug: string; variables: Record<string, string> }) => {
      sentEmails.push(params);
      return { status: "sent_direct", logId: 1 };
    }),
  },
}));

import { ensureFoundingSuperAdmins } from "../lib/ensure-founding-superadmins";

beforeEach(() => {
  state.users = [];
  state.nextId = 100;
  state.inserts = [];
  state.updates = [];
  sentEmails.length = 0;
});

describe("ensureFoundingSuperAdmins", () => {
  it("is a no-op when a super_admin already exists (self-disabling)", async () => {
    state.users = [
      { id: 1, name: "Existing", email: "boss@example.com", role: "super_admin" },
      { id: 7, name: "Adam", email: "adam@cherringtonmedia.com", role: "admin" },
    ];

    await ensureFoundingSuperAdmins();

    expect(state.updates).toHaveLength(0);
    expect(state.inserts).toHaveLength(0);
    expect(sentEmails).toHaveLength(0);
    // Adam is left untouched — role management belongs to the in-app flow now.
    expect(state.users.find((u) => u.email === "adam@cherringtonmedia.com")?.role).toBe("admin");
  });

  it("promotes an existing account and creates a missing one when there are 0 super_admins", async () => {
    state.users = [{ id: 7, name: "Adam", email: "adam@cherringtonmedia.com", role: "admin" }];

    await ensureFoundingSuperAdmins();

    // Adam (existing admin) promoted in place — no new account.
    const adam = state.users.find((u) => u.email === "adam@cherringtonmedia.com");
    expect(adam?.role).toBe("super_admin");
    expect(adam?.id).toBe(7);

    // Sandy (missing) created as super_admin.
    const sandy = state.users.find((u) => u.email === "sandy@cherringtonmedia.com");
    expect(sandy).toBeDefined();
    expect(sandy?.role).toBe("super_admin");
    expect(state.inserts.map((i) => i.email)).toEqual(["sandy@cherringtonmedia.com"]);

    // Exactly one password-setup email, to the correct domain only.
    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0].to).toBe("sandy@cherringtonmedia.com");
    expect(sentEmails[0].templateSlug).toBe("password_reset");
    expect(sentEmails[0].variables.reset_token).toBeTruthy();
  });

  it("does not re-email on a subsequent run once the founders exist", async () => {
    state.users = [
      { id: 7, name: "Adam", email: "adam@cherringtonmedia.com", role: "super_admin" },
      { id: 8, name: "Sandy", email: "sandy@cherringtonmedia.com", role: "super_admin" },
    ];

    await ensureFoundingSuperAdmins();

    expect(state.inserts).toHaveLength(0);
    expect(state.updates).toHaveLength(0);
    expect(sentEmails).toHaveLength(0);
  });
});
