import { Router, type IRouter } from "express";
import {
  db,
  chatSessionsTable,
  chatMessagesTable,
  chatDailyUsageTable,
  chatPromptsTable,
  chatSystemPromptsTable,
  knowledgebaseDocsTable,
  chatRateLimitsTable,
  ticketsTable,
  ticketMessagesTable,
  usersTable,
} from "@workspace/db";
import { eq, and, desc, sql, asc } from "drizzle-orm";
import { getAnthropicClient } from "@workspace/integrations-anthropic-ai";
import { getUserEntitlements, hasMemberAccessBypass } from "../lib/entitlements";

const router: IRouter = Router();

interface ChatTierConfig {
  dailyLimit: number;
  maxOutputTokens: number;
  historyDepth: number;
  sessionRetentionDays: number | null;
  knowledgebaseCategories: string[];
}

function getChatTier(entitlements: Set<string>, bypass = false): string {
  if (entitlements.has("chat:custom")) return "chat:custom";
  if (entitlements.has("chat:full")) return "chat:full";
  if (entitlements.has("chat:basic")) return "chat:basic";
  if (bypass) return "chat:full";
  return "none";
}

const TIER_DEFAULTS: Record<string, ChatTierConfig> = {
  "chat:custom": {
    dailyLimit: 100,
    maxOutputTokens: 4000,
    historyDepth: 30,
    sessionRetentionDays: null,
    knowledgebaseCategories: ["faq", "platform_guide", "marketing", "compliance", "advanced_strategy", "troubleshooting", "strategy", "curriculum", "sop", "glossary", "coaching"],
  },
  "chat:full": {
    dailyLimit: 50,
    maxOutputTokens: 2000,
    historyDepth: 20,
    sessionRetentionDays: 30,
    knowledgebaseCategories: ["faq", "platform_guide", "marketing", "compliance", "advanced_strategy", "troubleshooting", "strategy", "curriculum", "sop", "glossary", "coaching"],
  },
  "chat:basic": {
    dailyLimit: 20,
    maxOutputTokens: 1000,
    historyDepth: 10,
    sessionRetentionDays: 7,
    knowledgebaseCategories: ["faq", "platform_guide", "strategy", "curriculum", "sop", "glossary"],
  },
};

async function getTierConfig(tier: string): Promise<ChatTierConfig> {
  const defaults = TIER_DEFAULTS[tier] ?? {
    dailyLimit: 0,
    maxOutputTokens: 0,
    historyDepth: 0,
    sessionRetentionDays: 0,
    knowledgebaseCategories: [],
  };

  try {
    const [dbConfig] = await db
      .select()
      .from(chatRateLimitsTable)
      .where(eq(chatRateLimitsTable.tier, tier))
      .limit(1);

    if (dbConfig) {
      return {
        ...defaults,
        dailyLimit: dbConfig.dailyLimit,
        maxOutputTokens: dbConfig.maxOutputTokens,
      };
    }
  } catch {
  }

  return defaults;
}

function getTodayDate(): string {
  return new Date().toISOString().split("T")[0];
}

async function getDailyUsage(userId: number): Promise<number> {
  const today = getTodayDate();
  const [usage] = await db
    .select()
    .from(chatDailyUsageTable)
    .where(and(eq(chatDailyUsageTable.userId, userId), eq(chatDailyUsageTable.usageDate, today)));
  return usage?.messageCount ?? 0;
}

async function tryIncrementDailyUsage(userId: number, chatTier: string, dailyLimit: number): Promise<{ allowed: boolean; count: number }> {
  const today = getTodayDate();
  const result = await db.execute(
    sql`INSERT INTO chat_daily_usage (user_id, usage_date, message_count, chat_tier)
        VALUES (${userId}, ${today}, 1, ${chatTier})
        ON CONFLICT (user_id, usage_date)
        DO UPDATE SET message_count = chat_daily_usage.message_count + 1
          WHERE chat_daily_usage.message_count < ${dailyLimit}
        RETURNING message_count`
  );
  if (result.rows.length === 0) {
    return { allowed: false, count: dailyLimit };
  }
  return { allowed: true, count: (result.rows[0] as any).message_count };
}

async function searchKnowledgebase(query: string, categories: string[]): Promise<Array<{ title: string; content: string; category: string }>> {
  if (categories.length === 0) return [];

  const categoriesArray = `{${categories.join(",")}}`;

  const primaryResults = await db.execute(
    sql`SELECT title, content, category,
        ts_rank(to_tsvector('english', title || ' ' || content), websearch_to_tsquery('english', ${query})) as rank
      FROM knowledgebase_docs
      WHERE to_tsvector('english', title || ' ' || content) @@ websearch_to_tsquery('english', ${query})
        AND category = ANY(${categoriesArray}::text[])
        AND audience <> 'admin'
      ORDER BY rank DESC
      LIMIT 6`
  );

  if ((primaryResults.rows as any[]).length >= 3) {
    return (primaryResults.rows as any[]).map((r) => ({
      title: r.title,
      content: r.content,
      category: r.category,
    }));
  }

  const orQuery = query.trim().split(/\s+/).filter(Boolean).join(" | ");
  const fallbackResults = await db.execute(
    sql`SELECT title, content, category,
        ts_rank(to_tsvector('english', title || ' ' || content), to_tsquery('english', ${orQuery})) as rank
      FROM knowledgebase_docs
      WHERE to_tsvector('english', title || ' ' || content) @@ to_tsquery('english', ${orQuery})
        AND category = ANY(${categoriesArray}::text[])
        AND audience <> 'admin'
      ORDER BY rank DESC
      LIMIT 6`
  );

  const seen = new Set((primaryResults.rows as any[]).map((r: any) => r.title));
  const merged = [...(primaryResults.rows as any[])];
  for (const r of fallbackResults.rows as any[]) {
    if (!seen.has(r.title)) {
      merged.push(r);
      seen.add(r.title);
    }
  }

  return merged.slice(0, 6).map((r) => ({
    title: r.title,
    content: r.content,
    category: r.category,
  }));
}

async function getActiveSystemPrompt(): Promise<string> {
  const [prompt] = await db
    .select()
    .from(chatSystemPromptsTable)
    .where(eq(chatSystemPromptsTable.isActive, true))
    .limit(1);
  return prompt?.content ?? "You are a helpful assistant for the Build Test Scale (BTS) affiliate marketing platform.";
}

router.post("/chat", async (req, res): Promise<void> => {
  const userId = req.userId!;
  const { message, sessionId } = req.body as { message?: string; sessionId?: number };

  if (!message || typeof message !== "string" || message.trim().length === 0) {
    res.status(400).json({ error: "Message is required" });
    return;
  }

  const entitlements = await getUserEntitlements(userId);
  const chatTier = getChatTier(entitlements, await hasMemberAccessBypass(userId));

  if (chatTier === "none") {
    res.status(403).json({ error: "You do not have access to the AI chat assistant. Please upgrade your plan." });
    return;
  }

  const config = await getTierConfig(chatTier);

  const usageResult = await tryIncrementDailyUsage(userId, chatTier, config.dailyLimit);
  if (!usageResult.allowed) {
    res.status(429).json({
      error: "Daily message limit reached",
      limit: config.dailyLimit,
      used: usageResult.count,
      resetTime: new Date(new Date().setUTCHours(24, 0, 0, 0)).toISOString(),
    });
    return;
  }

  let session;
  if (sessionId) {
    const [existing] = await db
      .select()
      .from(chatSessionsTable)
      .where(and(eq(chatSessionsTable.id, sessionId), eq(chatSessionsTable.userId, userId), eq(chatSessionsTable.isDeleted, false)));
    if (!existing) {
      res.status(404).json({ error: "Chat session not found" });
      return;
    }
    session = existing;
  } else {
    const title = message.slice(0, 60) + (message.length > 60 ? "..." : "");
    const [newSession] = await db
      .insert(chatSessionsTable)
      .values({ userId, title })
      .returning();
    session = newSession;
  }

  await db.insert(chatMessagesTable).values({
    sessionId: session.id,
    role: "user",
    content: message.trim(),
  });

  const history = await db
    .select()
    .from(chatMessagesTable)
    .where(eq(chatMessagesTable.sessionId, session.id))
    .orderBy(desc(chatMessagesTable.createdAt))
    .limit(config.historyDepth);

  const orderedHistory = history.reverse();

  const ragResults = await searchKnowledgebase(message, config.knowledgebaseCategories);

  const [user] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, userId));

  let systemPrompt = await getActiveSystemPrompt();

  systemPrompt = systemPrompt
    .replace(/\{\{member_name\}\}/g, user?.name ?? "Member")
    .replace(/\{\{chat_tier\}\}/g, chatTier)
    .replace(/\{\{daily_limit\}\}/g, String(config.dailyLimit));

  if (ragResults.length > 0) {
    const ragContext = ragResults
      .map((r) => `[${r.category}] ${r.title}:\n${r.content}`)
      .join("\n\n---\n\n");
    systemPrompt += `\n\n## Relevant Knowledge Base Articles\n\n${ragContext}`;
  } else {
    systemPrompt += `\n\n## Knowledge Base Search Result\n\nNo BTS knowledge base articles matched this query. You must not fabricate an answer based on general affiliate marketing knowledge. If the member is asking about anything BTS-specific (which traffic sources BTS uses, which tools BTS provides, specific BTS processes, policies, or team members), clearly state that you don't have that information in the knowledge base right now and direct them to a live coaching call or contact support at support@buildtestscale.com.`;
  }

  const chatMessages = orderedHistory.map((m) => ({
    role: m.role as "user" | "assistant",
    content: m.content,
  }));

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  res.write(`data: ${JSON.stringify({ sessionId: session.id })}\n\n`);

  let fullResponse = "";

  try {
    const stream = getAnthropicClient().messages.stream({
      model: "claude-sonnet-4-6",
      max_tokens: config.maxOutputTokens,
      system: systemPrompt,
      messages: chatMessages,
    });

    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        fullResponse += event.delta.text;
        res.write(`data: ${JSON.stringify({ content: event.delta.text })}\n\n`);
      }
    }

    await db.insert(chatMessagesTable).values({
      sessionId: session.id,
      role: "assistant",
      content: fullResponse,
    });

    const suggestTicket = fullResponse.includes("[SUGGEST_TICKET]");

    res.write(`data: ${JSON.stringify({ done: true, suggestTicket })}\n\n`);
    res.end();
  } catch (err: any) {
    console.error("Chat stream error:", err);
    res.write(`data: ${JSON.stringify({ error: "An error occurred while generating a response. Please try again." })}\n\n`);
    res.end();
  }
});

function getRetentionFilter(retentionDays: number | null) {
  if (retentionDays === null) return undefined;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - retentionDays);
  return cutoff;
}

router.get("/chat/sessions", async (req, res): Promise<void> => {
  const userId = req.userId!;
  const page = parseInt(req.query.page as string) || 1;
  const limit = Math.min(parseInt(req.query.limit as string) || 20, 50);
  const offset = (page - 1) * limit;

  const entitlements = await getUserEntitlements(userId);
  const chatTier = getChatTier(entitlements, await hasMemberAccessBypass(userId));
  const config = await getTierConfig(chatTier);
  const retentionCutoff = getRetentionFilter(config.sessionRetentionDays);

  const conditions = [eq(chatSessionsTable.userId, userId), eq(chatSessionsTable.isDeleted, false)];
  if (retentionCutoff) {
    conditions.push(sql`${chatSessionsTable.createdAt} >= ${retentionCutoff}` as any);
  }

  const sessions = await db
    .select({
      id: chatSessionsTable.id,
      title: chatSessionsTable.title,
      createdAt: chatSessionsTable.createdAt,
      updatedAt: chatSessionsTable.updatedAt,
    })
    .from(chatSessionsTable)
    .where(and(...conditions))
    .orderBy(desc(chatSessionsTable.updatedAt))
    .limit(limit)
    .offset(offset);

  const [countResult] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(chatSessionsTable)
    .where(and(...conditions));

  res.json({
    sessions,
    pagination: {
      page,
      limit,
      total: countResult?.count ?? 0,
      totalPages: Math.ceil((countResult?.count ?? 0) / limit),
    },
  });
});

router.get("/chat/sessions/:sessionId", async (req, res): Promise<void> => {
  const userId = req.userId!;
  const sessionId = parseInt(req.params.sessionId);

  if (isNaN(sessionId)) {
    res.status(400).json({ error: "Invalid session ID" });
    return;
  }

  const [session] = await db
    .select()
    .from(chatSessionsTable)
    .where(and(eq(chatSessionsTable.id, sessionId), eq(chatSessionsTable.userId, userId), eq(chatSessionsTable.isDeleted, false)));

  if (!session) {
    res.status(404).json({ error: "Chat session not found" });
    return;
  }

  const entitlements = await getUserEntitlements(userId);
  const chatTier = getChatTier(entitlements, await hasMemberAccessBypass(userId));
  const config = await getTierConfig(chatTier);
  const retentionCutoff = getRetentionFilter(config.sessionRetentionDays);

  if (retentionCutoff && session.createdAt < retentionCutoff) {
    res.status(404).json({ error: "Chat session has expired due to retention policy" });
    return;
  }

  const messages = await db
    .select()
    .from(chatMessagesTable)
    .where(eq(chatMessagesTable.sessionId, sessionId))
    .orderBy(asc(chatMessagesTable.createdAt));

  res.json({
    id: session.id,
    title: session.title,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    messages,
  });
});

router.delete("/chat/sessions/:sessionId", async (req, res): Promise<void> => {
  const userId = req.userId!;
  const sessionId = parseInt(req.params.sessionId);

  if (isNaN(sessionId)) {
    res.status(400).json({ error: "Invalid session ID" });
    return;
  }

  const [session] = await db
    .select()
    .from(chatSessionsTable)
    .where(and(eq(chatSessionsTable.id, sessionId), eq(chatSessionsTable.userId, userId), eq(chatSessionsTable.isDeleted, false)));

  if (!session) {
    res.status(404).json({ error: "Chat session not found" });
    return;
  }

  await db
    .update(chatSessionsTable)
    .set({ isDeleted: true })
    .where(eq(chatSessionsTable.id, sessionId));

  res.json({ success: true });
});

router.get("/chat/status", async (req, res): Promise<void> => {
  const userId = req.userId!;
  const entitlements = await getUserEntitlements(userId);
  const chatTier = getChatTier(entitlements, await hasMemberAccessBypass(userId));
  const config = await getTierConfig(chatTier);
  const usedToday = await getDailyUsage(userId);

  const tomorrow = new Date();
  tomorrow.setUTCHours(24, 0, 0, 0);

  res.json({
    tier: chatTier,
    dailyLimit: config.dailyLimit,
    messagesUsedToday: usedToday,
    messagesRemaining: Math.max(0, config.dailyLimit - usedToday),
    resetTime: tomorrow.toISOString(),
    maxOutputTokens: config.maxOutputTokens,
    historyDepth: config.historyDepth,
    sessionRetentionDays: config.sessionRetentionDays,
  });
});

router.get("/chat/prompts", async (req, res): Promise<void> => {
  const userId = req.userId!;
  const entitlements = await getUserEntitlements(userId);

  if (!entitlements.has("chat:custom")) {
    res.status(403).json({ error: "Saved prompts are only available for chat:custom tier" });
    return;
  }

  const prompts = await db
    .select()
    .from(chatPromptsTable)
    .where(eq(chatPromptsTable.userId, userId))
    .orderBy(desc(chatPromptsTable.updatedAt));

  res.json(prompts);
});

router.post("/chat/prompts", async (req, res): Promise<void> => {
  const userId = req.userId!;
  const entitlements = await getUserEntitlements(userId);

  if (!entitlements.has("chat:custom")) {
    res.status(403).json({ error: "Saved prompts are only available for chat:custom tier" });
    return;
  }

  const { title, content } = req.body as { title?: string; content?: string };

  if (!title || !content) {
    res.status(400).json({ error: "Title and content are required" });
    return;
  }

  const [countResult] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(chatPromptsTable)
    .where(eq(chatPromptsTable.userId, userId));

  if ((countResult?.count ?? 0) >= 20) {
    res.status(400).json({ error: "Maximum of 20 saved prompts reached" });
    return;
  }

  const [prompt] = await db
    .insert(chatPromptsTable)
    .values({ userId, title, content })
    .returning();

  res.status(201).json(prompt);
});

router.patch("/chat/prompts/:promptId", async (req, res): Promise<void> => {
  const userId = req.userId!;
  const promptId = parseInt(req.params.promptId);
  const entitlements = await getUserEntitlements(userId);

  if (!entitlements.has("chat:custom")) {
    res.status(403).json({ error: "Saved prompts are only available for chat:custom tier" });
    return;
  }

  if (isNaN(promptId)) {
    res.status(400).json({ error: "Invalid prompt ID" });
    return;
  }

  const [existing] = await db
    .select()
    .from(chatPromptsTable)
    .where(and(eq(chatPromptsTable.id, promptId), eq(chatPromptsTable.userId, userId)));

  if (!existing) {
    res.status(404).json({ error: "Prompt not found" });
    return;
  }

  const { title, content } = req.body as { title?: string; content?: string };
  const updates: Record<string, string> = {};
  if (title) updates.title = title;
  if (content) updates.content = content;

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "Nothing to update" });
    return;
  }

  const [updated] = await db
    .update(chatPromptsTable)
    .set(updates)
    .where(eq(chatPromptsTable.id, promptId))
    .returning();

  res.json(updated);
});

router.delete("/chat/prompts/:promptId", async (req, res): Promise<void> => {
  const userId = req.userId!;
  const promptId = parseInt(req.params.promptId);
  const entitlements = await getUserEntitlements(userId);

  if (!entitlements.has("chat:custom")) {
    res.status(403).json({ error: "Saved prompts are only available for chat:custom tier" });
    return;
  }

  if (isNaN(promptId)) {
    res.status(400).json({ error: "Invalid prompt ID" });
    return;
  }

  const [existing] = await db
    .select()
    .from(chatPromptsTable)
    .where(and(eq(chatPromptsTable.id, promptId), eq(chatPromptsTable.userId, userId)));

  if (!existing) {
    res.status(404).json({ error: "Prompt not found" });
    return;
  }

  await db.delete(chatPromptsTable).where(eq(chatPromptsTable.id, promptId));

  res.json({ success: true });
});

function generateTicketNumber(): string {
  const prefix = "BTS";
  const num = Math.floor(100000 + Math.random() * 900000);
  return `${prefix}-${num}`;
}

router.post("/chat/create-ticket", async (req, res): Promise<void> => {
  const userId = req.userId!;
  const entitlements = await getUserEntitlements(userId);
  const chatTier = getChatTier(entitlements, await hasMemberAccessBypass(userId));

  if (chatTier !== "chat:full" && chatTier !== "chat:custom") {
    res.status(403).json({ error: "Creating tickets from chat is only available for chat:full and chat:custom tiers" });
    return;
  }

  const { sessionId, subject } = req.body as { sessionId?: number; subject?: string };

  if (!sessionId || !subject) {
    res.status(400).json({ error: "sessionId and subject are required" });
    return;
  }

  const [session] = await db
    .select()
    .from(chatSessionsTable)
    .where(and(eq(chatSessionsTable.id, sessionId), eq(chatSessionsTable.userId, userId), eq(chatSessionsTable.isDeleted, false)));

  if (!session) {
    res.status(404).json({ error: "Chat session not found" });
    return;
  }

  const recentMessages = await db
    .select()
    .from(chatMessagesTable)
    .where(eq(chatMessagesTable.sessionId, sessionId))
    .orderBy(desc(chatMessagesTable.createdAt))
    .limit(5);

  const contextBody = recentMessages
    .reverse()
    .map((m) => `[${m.role}]: ${m.content}`)
    .join("\n\n");

  const [ticket] = await db
    .insert(ticketsTable)
    .values({
      ticketNumber: generateTicketNumber(),
      userId,
      category: "other",
      priority: "normal",
      status: "open",
      subject,
    })
    .returning();

  await db.insert(ticketMessagesTable).values({
    ticketId: ticket.id,
    senderType: "member",
    body: `[Created from AI Chat Session]\n\n${contextBody}`,
  });

  res.status(201).json(ticket);
});

export default router;
