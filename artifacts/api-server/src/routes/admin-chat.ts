import { Router, type IRouter } from "express";
import {
  db,
  chatSessionsTable,
  chatMessagesTable,
  chatDailyUsageTable,
  chatSystemPromptsTable,
  knowledgebaseDocsTable,
  chatRateLimitsTable,
  usersTable,
  ticketMessagesTable,
} from "@workspace/db";
import { eq, and, desc, sql, asc, like, gte, lte, ilike } from "drizzle-orm";
import { requirePermission } from "../middleware/rbac";

const router: IRouter = Router();

router.get("/admin/chat/analytics", requirePermission("chat:view"), async (req, res): Promise<void> => {
  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setUTCHours(0, 0, 0, 0);

  const weekStart = new Date(now);
  weekStart.setDate(weekStart.getDate() - 7);
  weekStart.setUTCHours(0, 0, 0, 0);

  const monthStart = new Date(now);
  monthStart.setDate(monthStart.getDate() - 30);
  monthStart.setUTCHours(0, 0, 0, 0);

  const [todayCount] = await db.select({ count: sql<number>`count(*)::int` })
    .from(chatMessagesTable)
    .where(gte(chatMessagesTable.createdAt, todayStart));

  const [weekCount] = await db.select({ count: sql<number>`count(*)::int` })
    .from(chatMessagesTable)
    .where(gte(chatMessagesTable.createdAt, weekStart));

  const [monthCount] = await db.select({ count: sql<number>`count(*)::int` })
    .from(chatMessagesTable)
    .where(gte(chatMessagesTable.createdAt, monthStart));

  const [totalCount] = await db.select({ count: sql<number>`count(*)::int` })
    .from(chatMessagesTable);

  const tierBreakdown = await db.select({
    tier: chatDailyUsageTable.chatTier,
    totalMessages: sql<number>`sum(${chatDailyUsageTable.messageCount})::int`,
    uniqueUsers: sql<number>`count(distinct ${chatDailyUsageTable.userId})::int`,
  })
    .from(chatDailyUsageTable)
    .groupBy(chatDailyUsageTable.chatTier);

  const avgPerUser = await db.execute(sql`
    SELECT COALESCE(ROUND(AVG(daily_total), 1), 0) as avg_messages_per_user_per_day
    FROM (
      SELECT user_id, usage_date, SUM(message_count) as daily_total
      FROM chat_daily_usage
      WHERE usage_date >= ${monthStart.toISOString().split("T")[0]}
      GROUP BY user_id, usage_date
    ) sub
  `);

  const peakHours = await db.execute(sql`
    SELECT EXTRACT(HOUR FROM created_at AT TIME ZONE 'UTC') as hour, COUNT(*)::int as count
    FROM chat_messages
    WHERE created_at >= ${monthStart}
    GROUP BY hour
    ORDER BY hour
  `);

  const [totalSessions] = await db.select({ count: sql<number>`count(*)::int` })
    .from(chatSessionsTable)
    .where(eq(chatSessionsTable.isDeleted, false));

  const [flaggedCount] = await db.select({ count: sql<number>`count(*)::int` })
    .from(chatMessagesTable)
    .where(eq(chatMessagesTable.flagged, true));

  res.json({
    messages: {
      today: todayCount?.count ?? 0,
      week: weekCount?.count ?? 0,
      month: monthCount?.count ?? 0,
      total: totalCount?.count ?? 0,
    },
    tierBreakdown: tierBreakdown.map(t => ({
      tier: t.tier,
      totalMessages: t.totalMessages ?? 0,
      uniqueUsers: t.uniqueUsers ?? 0,
    })),
    avgMessagesPerUserPerDay: Number((avgPerUser.rows[0] as any)?.avg_messages_per_user_per_day ?? 0),
    peakHours: (peakHours.rows as any[]).map(r => ({
      hour: Number(r.hour),
      count: r.count,
    })),
    totalSessions: totalSessions?.count ?? 0,
    flaggedMessages: flaggedCount?.count ?? 0,
  });
});

router.get("/admin/chat/sessions", requirePermission("chat:view"), async (req, res): Promise<void> => {
  const page = parseInt(req.query.page as string) || 1;
  const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
  const offset = (page - 1) * limit;
  const search = (req.query.search as string) || "";
  const userId = req.query.userId ? parseInt(req.query.userId as string) : null;
  const dateFrom = req.query.dateFrom as string;
  const dateTo = req.query.dateTo as string;
  const flaggedOnly = req.query.flagged === "true";
  const ticketCreated = req.query.ticketCreated === "true";

  let query = db
    .select({
      id: chatSessionsTable.id,
      userId: chatSessionsTable.userId,
      title: chatSessionsTable.title,
      createdAt: chatSessionsTable.createdAt,
      updatedAt: chatSessionsTable.updatedAt,
      userName: usersTable.name,
      userEmail: usersTable.email,
    })
    .from(chatSessionsTable)
    .innerJoin(usersTable, eq(chatSessionsTable.userId, usersTable.id))
    .where(eq(chatSessionsTable.isDeleted, false))
    .$dynamic();

  const conditions: any[] = [eq(chatSessionsTable.isDeleted, false)];

  if (userId) {
    conditions.push(eq(chatSessionsTable.userId, userId));
  }

  if (search) {
    conditions.push(
      sql`EXISTS (
        SELECT 1 FROM chat_messages cm 
        WHERE cm.session_id = ${chatSessionsTable.id} 
        AND cm.content ILIKE ${`%${search}%`}
      )`
    );
  }

  if (dateFrom) {
    conditions.push(gte(chatSessionsTable.createdAt, new Date(dateFrom)));
  }

  if (dateTo) {
    const endDate = new Date(dateTo);
    endDate.setDate(endDate.getDate() + 1);
    conditions.push(lte(chatSessionsTable.createdAt, endDate));
  }

  if (flaggedOnly) {
    conditions.push(
      sql`EXISTS (
        SELECT 1 FROM chat_messages cm 
        WHERE cm.session_id = ${chatSessionsTable.id} 
        AND cm.flagged = true
      )`
    );
  }

  if (ticketCreated) {
    conditions.push(
      sql`EXISTS (
        SELECT 1 FROM ${ticketMessagesTable} tm 
        WHERE tm.body LIKE '%[Created from AI Chat Session]%'
        AND tm.ticket_id IN (
          SELECT t.id FROM tickets t 
          WHERE t.created_by = ${chatSessionsTable.userId}
        )
      )`
    );
  }

  const sessions = await db
    .select({
      id: chatSessionsTable.id,
      userId: chatSessionsTable.userId,
      title: chatSessionsTable.title,
      createdAt: chatSessionsTable.createdAt,
      updatedAt: chatSessionsTable.updatedAt,
      userName: usersTable.name,
      userEmail: usersTable.email,
    })
    .from(chatSessionsTable)
    .innerJoin(usersTable, eq(chatSessionsTable.userId, usersTable.id))
    .where(and(...conditions))
    .orderBy(desc(chatSessionsTable.updatedAt))
    .limit(limit)
    .offset(offset);

  const [countResult] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(chatSessionsTable)
    .innerJoin(usersTable, eq(chatSessionsTable.userId, usersTable.id))
    .where(and(...conditions));

  const sessionsWithMeta = await Promise.all(
    sessions.map(async (s) => {
      const [msgCount] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(chatMessagesTable)
        .where(eq(chatMessagesTable.sessionId, s.id));

      const [flagCount] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(chatMessagesTable)
        .where(and(eq(chatMessagesTable.sessionId, s.id), eq(chatMessagesTable.flagged, true)));

      return {
        ...s,
        messageCount: msgCount?.count ?? 0,
        flaggedCount: flagCount?.count ?? 0,
      };
    })
  );

  res.json({
    sessions: sessionsWithMeta,
    pagination: {
      page,
      limit,
      total: countResult?.count ?? 0,
      totalPages: Math.ceil((countResult?.count ?? 0) / limit),
    },
  });
});

router.get("/admin/chat/sessions/:sessionId", requirePermission("chat:view"), async (req, res): Promise<void> => {
  const sessionId = parseInt(req.params.sessionId);
  if (isNaN(sessionId)) {
    res.status(400).json({ error: "Invalid session ID" });
    return;
  }

  const [session] = await db
    .select({
      id: chatSessionsTable.id,
      userId: chatSessionsTable.userId,
      title: chatSessionsTable.title,
      createdAt: chatSessionsTable.createdAt,
      updatedAt: chatSessionsTable.updatedAt,
      userName: usersTable.name,
      userEmail: usersTable.email,
    })
    .from(chatSessionsTable)
    .innerJoin(usersTable, eq(chatSessionsTable.userId, usersTable.id))
    .where(eq(chatSessionsTable.id, sessionId));

  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  const messages = await db
    .select()
    .from(chatMessagesTable)
    .where(eq(chatMessagesTable.sessionId, sessionId))
    .orderBy(asc(chatMessagesTable.createdAt));

  res.json({ ...session, messages });
});

router.patch("/admin/chat/messages/:messageId/flag", requirePermission("chat:manage"), async (req, res): Promise<void> => {
  const messageId = parseInt(req.params.messageId);
  if (isNaN(messageId)) {
    res.status(400).json({ error: "Invalid message ID" });
    return;
  }

  const [existing] = await db.select().from(chatMessagesTable).where(eq(chatMessagesTable.id, messageId));
  if (!existing) {
    res.status(404).json({ error: "Message not found" });
    return;
  }

  const { flagged } = req.body as { flagged?: boolean };
  const newFlagged = flagged !== undefined ? flagged : !existing.flagged;

  const [updated] = await db
    .update(chatMessagesTable)
    .set({ flagged: newFlagged })
    .where(eq(chatMessagesTable.id, messageId))
    .returning();

  res.json(updated);
});

router.patch("/admin/chat/messages/:messageId/notes", requirePermission("chat:manage"), async (req, res): Promise<void> => {
  const messageId = parseInt(req.params.messageId);
  if (isNaN(messageId)) {
    res.status(400).json({ error: "Invalid message ID" });
    return;
  }

  const [existing] = await db.select().from(chatMessagesTable).where(eq(chatMessagesTable.id, messageId));
  if (!existing) {
    res.status(404).json({ error: "Message not found" });
    return;
  }

  const { notes } = req.body as { notes?: string };

  const [updated] = await db
    .update(chatMessagesTable)
    .set({ adminNotes: notes ?? null })
    .where(eq(chatMessagesTable.id, messageId))
    .returning();

  res.json(updated);
});

router.get("/admin/chat/system-prompts", requirePermission("chat:view"), async (_req, res): Promise<void> => {
  const prompts = await db
    .select()
    .from(chatSystemPromptsTable)
    .orderBy(desc(chatSystemPromptsTable.id));

  res.json(prompts);
});

router.post("/admin/chat/system-prompts", requirePermission("chat:manage"), async (req, res): Promise<void> => {
  const { name, content } = req.body as { name?: string; content?: string };

  if (!name || !content) {
    res.status(400).json({ error: "Name and content are required" });
    return;
  }

  const [maxVersion] = await db.select({
    maxVer: sql<number>`COALESCE(MAX(${chatSystemPromptsTable.version}), 0)::int`,
  }).from(chatSystemPromptsTable);

  const newVersion = (maxVersion?.maxVer ?? 0) + 1;

  const [prompt] = await db
    .insert(chatSystemPromptsTable)
    .values({ name, content, version: newVersion, isActive: false })
    .returning();

  res.status(201).json(prompt);
});

router.patch("/admin/chat/system-prompts/:id/activate", requirePermission("chat:manage"), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid prompt ID" });
    return;
  }

  const [existing] = await db.select().from(chatSystemPromptsTable).where(eq(chatSystemPromptsTable.id, id));
  if (!existing) {
    res.status(404).json({ error: "System prompt not found" });
    return;
  }

  const [updated] = await db.transaction(async (tx) => {
    await tx.update(chatSystemPromptsTable).set({ isActive: false }).where(eq(chatSystemPromptsTable.isActive, true));
    return tx
      .update(chatSystemPromptsTable)
      .set({ isActive: true })
      .where(eq(chatSystemPromptsTable.id, id))
      .returning();
  });

  res.json(updated);
});

router.post("/admin/chat/system-prompts/preview", requirePermission("chat:manage"), async (req, res): Promise<void> => {
  const { content, testMessage } = req.body as { content?: string; testMessage?: string };

  if (!content || !testMessage) {
    res.status(400).json({ error: "Content and testMessage are required" });
    return;
  }

  try {
    const { getAnthropicClient } = await import("@workspace/integrations-anthropic-ai");
    const response = await getAnthropicClient().messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1000,
      system: content
        .replace(/\{\{member_name\}\}/g, "Test User")
        .replace(/\{\{chat_tier\}\}/g, "chat:full")
        .replace(/\{\{daily_limit\}\}/g, "50"),
      messages: [{ role: "user", content: testMessage }],
    });

    const text = response.content
      .filter((b: any) => b.type === "text")
      .map((b: any) => b.text)
      .join("");

    res.json({ response: text });
  } catch (err: any) {
    res.status(500).json({ error: "Preview failed: " + (err.message || "Unknown error") });
  }
});

router.get("/admin/chat/knowledgebase", requirePermission("chat:view"), async (req, res): Promise<void> => {
  const category = req.query.category as string;
  const search = req.query.search as string;

  const conditions: any[] = [];

  if (category) {
    conditions.push(eq(knowledgebaseDocsTable.category, category));
  }

  if (search) {
    conditions.push(
      sql`to_tsvector('english', ${knowledgebaseDocsTable.title} || ' ' || ${knowledgebaseDocsTable.content}) @@ plainto_tsquery('english', ${search})`
    );
  }

  const docs = await db
    .select()
    .from(knowledgebaseDocsTable)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(knowledgebaseDocsTable.updatedAt));

  const docsWithChunks = docs.map(d => ({
    ...d,
    chunkCount: Math.ceil(d.content.length / 500),
  }));

  res.json(docsWithChunks);
});

router.post("/admin/chat/knowledgebase", requirePermission("chat:manage"), async (req, res): Promise<void> => {
  const { title, category, content } = req.body as { title?: string; category?: string; content?: string };

  if (!title || !content) {
    res.status(400).json({ error: "Title and content are required" });
    return;
  }

  const [doc] = await db
    .insert(knowledgebaseDocsTable)
    .values({ title, category: category || "faq", content })
    .returning();

  res.status(201).json({ ...doc, chunkCount: Math.ceil(doc.content.length / 500) });
});

router.put("/admin/chat/knowledgebase/:id", requirePermission("chat:manage"), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid document ID" });
    return;
  }

  const [existing] = await db.select().from(knowledgebaseDocsTable).where(eq(knowledgebaseDocsTable.id, id));
  if (!existing) {
    res.status(404).json({ error: "Document not found" });
    return;
  }

  const { title, category, content } = req.body as { title?: string; category?: string; content?: string };
  const updates: Record<string, any> = {};
  if (title !== undefined) updates.title = title;
  if (category !== undefined) updates.category = category;
  if (content !== undefined) updates.content = content;

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "Nothing to update" });
    return;
  }

  const [updated] = await db
    .update(knowledgebaseDocsTable)
    .set(updates)
    .where(eq(knowledgebaseDocsTable.id, id))
    .returning();

  res.json({ ...updated, chunkCount: Math.ceil(updated.content.length / 500) });
});

router.delete("/admin/chat/knowledgebase/:id", requirePermission("chat:manage"), async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid document ID" });
    return;
  }

  const [existing] = await db.select().from(knowledgebaseDocsTable).where(eq(knowledgebaseDocsTable.id, id));
  if (!existing) {
    res.status(404).json({ error: "Document not found" });
    return;
  }

  await db.delete(knowledgebaseDocsTable).where(eq(knowledgebaseDocsTable.id, id));

  res.json({ success: true });
});

router.get("/admin/chat/rate-limits", requirePermission("chat:view"), async (_req, res): Promise<void> => {
  const limits = await db
    .select()
    .from(chatRateLimitsTable)
    .orderBy(asc(chatRateLimitsTable.tier));

  res.json(limits);
});

router.put("/admin/chat/rate-limits", requirePermission("chat:manage"), async (req, res): Promise<void> => {
  const { limits } = req.body as { limits?: Array<{ tier: string; dailyLimit: number; maxOutputTokens: number }> };

  if (!limits || !Array.isArray(limits)) {
    res.status(400).json({ error: "limits array is required" });
    return;
  }

  const validTiers = ["chat:basic", "chat:full", "chat:custom"];
  for (const l of limits) {
    if (!validTiers.includes(l.tier)) {
      res.status(400).json({ error: `Invalid tier: ${l.tier}` });
      return;
    }
    if (typeof l.dailyLimit !== "number" || l.dailyLimit < 1) {
      res.status(400).json({ error: `dailyLimit must be a positive number for ${l.tier}` });
      return;
    }
    if (typeof l.maxOutputTokens !== "number" || l.maxOutputTokens < 100) {
      res.status(400).json({ error: `maxOutputTokens must be at least 100 for ${l.tier}` });
      return;
    }
  }

  const results = await Promise.all(
    limits.map(async (l) => {
      const [updated] = await db
        .insert(chatRateLimitsTable)
        .values(l)
        .onConflictDoUpdate({
          target: chatRateLimitsTable.tier,
          set: { dailyLimit: l.dailyLimit, maxOutputTokens: l.maxOutputTokens },
        })
        .returning();
      return updated;
    })
  );

  res.json(results);
});

export default router;
