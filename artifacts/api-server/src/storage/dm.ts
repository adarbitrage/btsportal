import { db, usersTable, dmThreadsTable, dmMessagesTable } from "@workspace/db";
import { eq, and, desc, isNull, sql, lt, inArray } from "drizzle-orm";
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
  const member = usersTable;

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

  if (isAdminRole(userRole)) {
    const adminMember = usersTable;
    const rows = await db
      .select({
        threadId: dmThreadsTable.id,
        lastMessageAt: dmThreadsTable.lastMessageAt,
        createdAt: dmThreadsTable.createdAt,
        otherPartyId: adminMember.id,
        otherPartyName: adminMember.name,
        otherPartyRole: adminMember.role,
      })
      .from(dmThreadsTable)
      .innerJoin(adminMember, eq(adminMember.id, dmThreadsTable.memberId))
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
    return db
      .select({ id: usersTable.id, name: usersTable.name, role: usersTable.role, email: usersTable.email })
      .from(usersTable)
      .where(inArray(usersTable.role, [...ADMIN_ROLES]))
      .orderBy(usersTable.name);
  }

  if (isAdminRole(userRole)) {
    return db
      .select({ id: usersTable.id, name: usersTable.name, role: usersTable.role, email: usersTable.email })
      .from(usersTable)
      .where(eq(usersTable.role, "member"))
      .orderBy(usersTable.name);
  }

  return [];
}

export async function totalUnreadCount(userId: number): Promise<number> {
  const memberThreads = db
    .select({ id: dmThreadsTable.id })
    .from(dmThreadsTable)
    .where(eq(dmThreadsTable.memberId, userId));

  const adminThreads = db
    .select({ id: dmThreadsTable.id })
    .from(dmThreadsTable)
    .where(eq(dmThreadsTable.adminId, userId));

  const [result] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(dmMessagesTable)
    .where(
      and(
        sql`${dmMessagesTable.threadId} IN (${memberThreads} UNION ALL ${adminThreads})`,
        isNull(dmMessagesTable.readAt),
        sql`${dmMessagesTable.senderId} != ${userId}`
      )
    );

  return result?.count ?? 0;
}
