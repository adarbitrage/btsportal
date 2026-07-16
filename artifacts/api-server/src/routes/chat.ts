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
import { retrieveSurfaceAware, type RetrievalTurn } from "../lib/kb-retrieval";
import { logUnansweredQuestion } from "../lib/content-gap-radar";
import { CITABLE_KB_CATEGORIES } from "../lib/kb-taxonomy";

const router: IRouter = Router();

interface ChatConfig {
  dailyLimit: number;
  maxOutputTokens: number;
  historyDepth: number;
  sessionRetentionDays: number | null;
  knowledgebaseCategories: string[];
}

// Chat access is binary (architecture doc §3.8): any chat entitlement — or the
// member-access bypass for admins/coaches — grants the full, identical
// experience. There are no member-visible tiers.
export function hasChatAccess(entitlements: Set<string>, bypass = false): boolean {
  return (
    entitlements.has("chat:custom") ||
    entitlements.has("chat:full") ||
    entitlements.has("chat:basic") ||
    bypass
  );
}

// The single row in chat_rate_limits that holds the global (abuse-protection)
// daily limit + output-token cap. Not a member-visible tier.
export const GLOBAL_CHAT_LIMIT_KEY = "chat";

const CHAT_DEFAULTS: ChatConfig = {
  dailyLimit: 100,
  maxOutputTokens: 4000,
  historyDepth: 30,
  sessionRetentionDays: null,
  knowledgebaseCategories: [...CITABLE_KB_CATEGORIES],
};

async function getChatConfig(): Promise<ChatConfig> {
  try {
    const [dbConfig] = await db
      .select()
      .from(chatRateLimitsTable)
      .where(eq(chatRateLimitsTable.tier, GLOBAL_CHAT_LIMIT_KEY))
      .limit(1);

    if (dbConfig) {
      return {
        ...CHAT_DEFAULTS,
        dailyLimit: dbConfig.dailyLimit,
        maxOutputTokens: dbConfig.maxOutputTokens,
      };
    }
  } catch {
  }

  return CHAT_DEFAULTS;
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

async function tryIncrementDailyUsage(userId: number, dailyLimit: number): Promise<{ allowed: boolean; count: number }> {
  const today = getTodayDate();
  const result = await db.execute(
    sql`INSERT INTO chat_daily_usage (user_id, usage_date, message_count, chat_tier)
        VALUES (${userId}, ${today}, 1, ${GLOBAL_CHAT_LIMIT_KEY})
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

/**
 * Text chat assistant KB retrieval. Thin wrapper over the shared surface-aware
 * retrieval path (lib/kb-retrieval.ts); kept as a stable export (used by the
 * chat route + retrieval guard tests). Pass `history` (prior turns, excluding
 * the current message) so short follow-ups resolve against their referent.
 */
export async function searchKnowledgebase(
  query: string,
  categories: string[],
  history?: RetrievalTurn[],
): Promise<Array<{ title: string; content: string; category: string }>> {
  const result = await retrieveSurfaceAware(query, {
    surface: "chat",
    categories,
    limit: 6,
    history,
  });
  return result.docs.map((d) => ({ title: d.title, content: d.content, category: d.category }));
}

/**
 * Assemble the retrieved KB docs into the prompt context block injected into
 * the model's system prompt. Deliberately includes the ENTIRE content of every
 * doc — chat is the deep assistant, so no truncation happens here (voice's
 * 400-char trim lives in searchKnowledgebaseForVoice and is voice-only).
 * Exported for the full-content injection regression test.
 */
export function buildRagContext(
  docs: Array<{ title: string; content: string; category: string }>,
): string {
  return docs.map((r) => `[${r.category}] ${r.title}:\n${r.content}`).join("\n\n---\n\n");
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

  if (!hasChatAccess(entitlements, await hasMemberAccessBypass(userId))) {
    res.status(403).json({ error: "You do not have access to the AI chat assistant. Please upgrade your plan." });
    return;
  }

  const config = await getChatConfig();

  const usageResult = await tryIncrementDailyUsage(userId, config.dailyLimit);
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

  // Prior turns only (drop the just-inserted current message) so a short
  // follow-up ("is it free?") resolves against the previous question.
  const priorTurns: RetrievalTurn[] = orderedHistory
    .slice(0, -1)
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

  // Retrieve directly (rather than via the searchKnowledgebase wrapper) so we get
  // the surface-aware "confident" signal: docs can come back from the loose
  // word-OR fallback without clearing the confidence bar. We treat only a
  // confident match as a verified answer (Rule 12); a non-confident result feeds
  // the graceful no-answer + handoff path instead of being presented as fact.
  const retrieval = await retrieveSurfaceAware(message, {
    surface: "chat",
    categories: config.knowledgebaseCategories,
    limit: 6,
    history: priorTurns,
  });
  const ragResults = retrieval.docs.map((d) => ({ title: d.title, content: d.content, category: d.category }));

  const [user] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, userId));

  let systemPrompt = await getActiveSystemPrompt();

  systemPrompt = systemPrompt
    .replace(/\{\{member_name\}\}/g, user?.name ?? "Member")
    // Legacy placeholder kept for backward compat with custom DB prompts —
    // tiers no longer exist, everyone gets the same experience.
    .replace(/\{\{chat_tier\}\}/g, "standard")
    .replace(/\{\{daily_limit\}\}/g, String(config.dailyLimit));

  if (retrieval.confident && ragResults.length > 0) {
    systemPrompt += `\n\n## Relevant Knowledge Base Articles\n\n${buildRagContext(ragResults)}`;
  } else {
    systemPrompt += `\n\n## Knowledge Base Search Result\n\nNo confident match — the knowledge base has no verified answer for this query. You must not fabricate an answer based on general affiliate marketing knowledge, and you must not stitch one together from loosely-related snippets. Follow Rule 12: tell the member you don't have a verified answer to that yet, then route them — conceptual or strategy questions to a live coaching call, and account, billing, or technical questions to a support ticket ([SUGGEST_TICKET]) or support@buildtestscale.com.`;

    // Content-Gap Radar: the assistant has no verified answer for this question.
    // Log it (privacy-scrubbed) so authoring can follow real demand. Best-effort,
    // fire-and-forget — never block or break the member's turn.
    void logUnansweredQuestion({
      surface: "chat",
      question: message,
      topScore: retrieval.topScore,
      topSemanticScore: retrieval.topSemanticScore,
      nearMisses: retrieval.docs.map((d) => ({ id: d.id, title: d.title, rank: d.rank })),
    });
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

  const config = await getChatConfig();
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

  const config = await getChatConfig();
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
  const hasAccess = hasChatAccess(entitlements, await hasMemberAccessBypass(userId));
  const config = await getChatConfig();
  const usedToday = await getDailyUsage(userId);

  const tomorrow = new Date();
  tomorrow.setUTCHours(24, 0, 0, 0);

  res.json({
    hasAccess,
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

  if (!hasChatAccess(entitlements, await hasMemberAccessBypass(userId))) {
    res.status(403).json({ error: "You do not have access to the AI chat assistant." });
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

  if (!hasChatAccess(entitlements, await hasMemberAccessBypass(userId))) {
    res.status(403).json({ error: "You do not have access to the AI chat assistant." });
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

  if (!hasChatAccess(entitlements, await hasMemberAccessBypass(userId))) {
    res.status(403).json({ error: "You do not have access to the AI chat assistant." });
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

  if (!hasChatAccess(entitlements, await hasMemberAccessBypass(userId))) {
    res.status(403).json({ error: "You do not have access to the AI chat assistant." });
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

  if (!hasChatAccess(entitlements, await hasMemberAccessBypass(userId))) {
    res.status(403).json({ error: "You do not have access to the AI chat assistant." });
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
