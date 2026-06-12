import { db, usersTable, dmThreadsTable, dmMessagesTable } from "@workspace/db";
import { eq, and, desc, isNull, sql, lt, inArray } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { isAdminRole, ADMIN_ROLES } from "../middleware/rbac";

export interface ThreadSummary {
  id: number;
  otherParty: {
    id: number;
    name: string;
    role: string;
  };
  lastMessagePreview: string | null;
  lastMessageAt: Date;
  unreadCount: number;
  createdAt: Date;
}

export interface MessageRow {
  id: number;
  threadId: number;
  senderId: number;
  body: string;
  createdAt: Date;
  readAt: Date | null;
}

export async function listThreadsForUser(userId: number, userRole: string): Promise<ThreadSummary[]> {
  if (userRole === "member") {
    const rows = await db
      .select({
        threadId: dmThreadsTable.id,
        lastMessageAt: dmThreadsTable.lastMessageAt,
        createdAt: dmThreadsTable.createdAt,
        otherPartyId: usersTable.id,
        otherPartyName: usersTable.name,
        otherPartyRole: usersTable.role,
      })
      .from(dmThreadsTable)
      .innerJoin(usersTable, eq(usersTable.id, dmThreadsTable.adminId))
      .where(eq(dmThreadsTable.memberId, userId))
      .orderBy(desc(dmThreadsTable.lastMessageAt));

    return Promise.all(
      rows.map(async (row) => {
        const { preview, unreadCount } = await getThreadMeta(row.threadId, userId);
        return {
          id: row.threadId,
          otherParty: {
            id: row.otherPartyId,
            name: row.otherPartyName,
            role: row.otherPartyRole,
          },
          lastMessagePreview: preview,
          lastMessageAt: row.lastMessageAt,
          unreadCount,
          createdAt: row.createdAt,
        };
      })
    );
  }

  // Admins see only their own threads. Coaches see ALL member↔coach threads
  // regardless of which coach is in adminId (shared inbox / coverage model —
  // any coach can pick up any thread, matching the coach-dashboard "every coach
  // sees every mentee" policy). We join staff to filter to coach-side threads only
  // so that admin↔member private threads stay invisible to coaches.
  if (isAdminRole(userRole)) {
    const rows = await db
      .select({
        threadId: dmThreadsTable.id,
        lastMessageAt: dmThreadsTable.lastMessageAt,
        createdAt: dmThreadsTable.createdAt,
        otherPartyId: usersTable.id,
        otherPartyName: usersTable.name,
        otherPartyRole: usersTable.role,
      })
      .from(dmThreadsTable)
      .innerJoin(usersTable, eq(usersTable.id, dmThreadsTable.memberId))
      .where(eq(dmThreadsTable.adminId, userId))
      .orderBy(desc(dmThreadsTable.lastMessageAt));

    return Promise.all(
      rows.map(async (row) => {
        const { preview, unreadCount } = await getThreadMeta(row.threadId, userId);
        return {
          id: row.threadId,
          otherParty: {
            id: row.otherPartyId,
            name: row.otherPartyName,
            role: row.otherPartyRole,
          },
          lastMessagePreview: preview,
          lastMessageAt: row.lastMessageAt,
          unreadCount,
          createdAt: row.createdAt,
        };
      })
    );
  }

  if (userRole === "coach") {
    // Coaches see ALL member↔coach threads (shared inbox / coverage model).
    // Use Drizzle aliases to join the users table twice: once for the member
    // side (otherParty) and once to assert the staff side is a coach.
    const staffUser = alias(usersTable, "staff_user");
    const memberUser = alias(usersTable, "member_user");

    const rows = await db
      .select({
        threadId: dmThreadsTable.id,
        lastMessageAt: dmThreadsTable.lastMessageAt,
        createdAt: dmThreadsTable.createdAt,
        otherPartyId: memberUser.id,
        otherPartyName: memberUser.name,
        otherPartyRole: memberUser.role,
      })
      .from(dmThreadsTable)
      .innerJoin(memberUser, eq(memberUser.id, dmThreadsTable.memberId))
      .innerJoin(staffUser, and(eq(staffUser.id, dmThreadsTable.adminId), eq(staffUser.role, "coach")))
      .orderBy(desc(dmThreadsTable.lastMessageAt));

    return Promise.all(
      rows.map(async (row) => {
        const { preview, unreadCount } = await getThreadMeta(row.threadId, userId);
        return {
          id: row.threadId,
          otherParty: {
            id: row.otherPartyId,
            name: row.otherPartyName,
            role: row.otherPartyRole,
          },
          lastMessagePreview: preview,
          lastMessageAt: row.lastMessageAt,
          unreadCount,
          createdAt: row.createdAt,
        };
      })
    );
  }

  return [];
}

async function getThreadMeta(
  threadId: number,
  viewerId: number
): Promise<{ preview: string | null; unreadCount: number }> {
  const [lastMsg] = await db
    .select({ body: dmMessagesTable.body })
    .from(dmMessagesTable)
    .where(eq(dmMessagesTable.threadId, threadId))
    .orderBy(desc(dmMessagesTable.createdAt))
    .limit(1);

  const [unreadRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(dmMessagesTable)
    .where(
      and(
        eq(dmMessagesTable.threadId, threadId),
        isNull(dmMessagesTable.readAt),
        sql`${dmMessagesTable.senderId} != ${viewerId}`
      )
    );

  return {
    preview: lastMsg?.body ?? null,
    unreadCount: unreadRow?.count ?? 0,
  };
}

export async function findOrCreateThread(
  memberId: number,
  adminId: number
): Promise<{ thread: typeof dmThreadsTable.$inferSelect; created: boolean }> {
  const [existing] = await db
    .select()
    .from(dmThreadsTable)
    .where(and(eq(dmThreadsTable.memberId, memberId), eq(dmThreadsTable.adminId, adminId)))
    .limit(1);

  if (existing) {
    return { thread: existing, created: false };
  }

  const [created] = await db
    .insert(dmThreadsTable)
    .values({ memberId, adminId })
    .onConflictDoNothing()
    .returning();

  if (created) {
    return { thread: created, created: true };
  }

  const [refetched] = await db
    .select()
    .from(dmThreadsTable)
    .where(and(eq(dmThreadsTable.memberId, memberId), eq(dmThreadsTable.adminId, adminId)))
    .limit(1);

  return { thread: refetched, created: false };
}

export async function listMessages(
  threadId: number,
  cursor: number | null,
  limit: number
): Promise<MessageRow[]> {
  const conditions = cursor
    ? and(eq(dmMessagesTable.threadId, threadId), lt(dmMessagesTable.id, cursor))
    : eq(dmMessagesTable.threadId, threadId);

  const rows = await db
    .select()
    .from(dmMessagesTable)
    .where(conditions)
    .orderBy(desc(dmMessagesTable.id))
    .limit(limit);

  return rows;
}

export async function insertMessage(
  threadId: number,
  senderId: number,
  body: string
): Promise<MessageRow> {
  const [message] = await db
    .insert(dmMessagesTable)
    .values({ threadId, senderId, body })
    .returning();

  await db
    .update(dmThreadsTable)
    .set({ lastMessageAt: new Date() })
    .where(eq(dmThreadsTable.id, threadId));

  return message;
}

export async function markThreadRead(threadId: number, viewerId: number): Promise<void> {
  await db
    .update(dmMessagesTable)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(dmMessagesTable.threadId, threadId),
        isNull(dmMessagesTable.readAt),
        sql`${dmMessagesTable.senderId} != ${viewerId}`
      )
    );
}

export interface RecipientRow {
  id: number;
  name: string;
  role: string;
  email: string;
}

export async function listRecipientsForUser(
  userId: number,
  userRole: string
): Promise<RecipientRow[]> {
  if (userRole === "member") {
    // Members can message admins (existing) and coaches (new).
    return db
      .select({ id: usersTable.id, name: usersTable.name, role: usersTable.role, email: usersTable.email })
      .from(usersTable)
      .where(inArray(usersTable.role, [...ADMIN_ROLES, "coach"]))
      .orderBy(usersTable.name);
  }

  if (isAdminRole(userRole) || userRole === "coach") {
    return db
      .select({ id: usersTable.id, name: usersTable.name, role: usersTable.role, email: usersTable.email })
      .from(usersTable)
      .where(eq(usersTable.role, "member"))
      .orderBy(usersTable.name);
  }

  return [];
}

export async function totalUnreadCount(userId: number, userRole: string): Promise<number> {
  // Threads the user participates in directly (member side or staff side).
  const memberThreads = db
    .select({ id: dmThreadsTable.id })
    .from(dmThreadsTable)
    .where(eq(dmThreadsTable.memberId, userId));

  const ownAdminThreads = db
    .select({ id: dmThreadsTable.id })
    .from(dmThreadsTable)
    .where(eq(dmThreadsTable.adminId, userId));

  // Coaches use a shared inbox: they can see (and should receive unread
  // indicators for) ALL member↔coach threads, not just their own.
  // Build an extra subquery for threads owned by any OTHER coach.
  let threadScope: ReturnType<typeof sql<number>>;

  if (userRole === "coach") {
    const staffUser = alias(usersTable, "staff_unread");
    const allCoachThreads = db
      .select({ id: dmThreadsTable.id })
      .from(dmThreadsTable)
      .innerJoin(staffUser, and(eq(staffUser.id, dmThreadsTable.adminId), eq(staffUser.role, "coach")));

    threadScope = sql`${dmMessagesTable.threadId} IN (
      ${memberThreads}
      UNION ALL
      ${ownAdminThreads}
      UNION ALL
      ${allCoachThreads}
    )`;
  } else {
    threadScope = sql`${dmMessagesTable.threadId} IN (
      ${memberThreads}
      UNION ALL
      ${ownAdminThreads}
    )`;
  }

  const [result] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(dmMessagesTable)
    .where(
      and(
        threadScope,
        isNull(dmMessagesTable.readAt),
        sql`${dmMessagesTable.senderId} != ${userId}`
      )
    );

  return result?.count ?? 0;
}
