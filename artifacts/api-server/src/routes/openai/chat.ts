import { getParam } from "../../lib/params";
import { Router, Request, Response } from "express";
import { db } from "@workspace/db";
import { conversations, messages } from "@workspace/db";
import { eq, desc, asc, and } from "drizzle-orm";
import { openai } from "@workspace/integrations-openai-ai-server";
import { getSystemPrompt, searchTranscripts } from "./knowledge-base.js";

const router = Router();

async function getOwnedConversation(conversationId: number, userId: number) {
  if (isNaN(conversationId) || conversationId <= 0) return null;
  const [conv] = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.id, conversationId), eq(conversations.userId, userId)))
    .limit(1);
  return conv || null;
}

router.get("/conversations", async (req: Request, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

    const result = await db
      .select()
      .from(conversations)
      .where(eq(conversations.userId, userId))
      .orderBy(desc(conversations.updatedAt));

    res.json(result);
  } catch (err) {
    console.error("[AI Chat] List conversations error:", err);
    res.status(500).json({ error: "Failed to load conversations" });
  }
});

router.post("/conversations", async (req: Request, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

    const title = typeof req.body.title === "string" ? req.body.title.slice(0, 100) : "New Chat";
    const [conv] = await db
      .insert(conversations)
      .values({ userId, title })
      .returning();

    res.json(conv);
  } catch (err) {
    console.error("[AI Chat] Create conversation error:", err);
    res.status(500).json({ error: "Failed to create conversation" });
  }
});

router.delete("/conversations/:id", async (req: Request, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

    const id = parseInt(getParam(req.params.id));
    const conv = await getOwnedConversation(id, userId);
    if (!conv) { res.status(404).json({ error: "Conversation not found" }); return; }

    await db.delete(messages).where(eq(messages.conversationId, id));
    await db.delete(conversations).where(eq(conversations.id, id));

    res.json({ success: true });
  } catch (err) {
    console.error("[AI Chat] Delete conversation error:", err);
    res.status(500).json({ error: "Failed to delete conversation" });
  }
});

router.get("/conversations/:id/messages", async (req: Request, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

    const id = parseInt(getParam(req.params.id));
    const conv = await getOwnedConversation(id, userId);
    if (!conv) { res.status(404).json({ error: "Conversation not found" }); return; }

    const result = await db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, id))
      .orderBy(asc(messages.createdAt));

    res.json(result);
  } catch (err) {
    console.error("[AI Chat] Get messages error:", err);
    res.status(500).json({ error: "Failed to load messages" });
  }
});

router.post("/conversations/:id/messages", async (req: Request, res: Response) => {
  const userId = req.userId;
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const conversationId = parseInt(getParam(req.params.id));
  const conv = await getOwnedConversation(conversationId, userId);
  if (!conv) { res.status(404).json({ error: "Conversation not found" }); return; }

  const { content } = req.body;
  if (!content || typeof content !== "string" || content.trim().length === 0) {
    res.status(400).json({ error: "Message content is required" });
    return;
  }

  const trimmedContent = content.trim().slice(0, 10000);

  try {
    await db
      .insert(messages)
      .values({ conversationId, role: "user", content: trimmedContent });

    const history = await db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, conversationId))
      .orderBy(asc(messages.createdAt));

    const transcriptContext = await searchTranscripts(trimmedContent);
    const systemPrompt = getSystemPrompt() + transcriptContext;

    const recentHistory = history.slice(-20);

    const chatMessages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
      { role: "system", content: systemPrompt },
      ...recentHistory.map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      })),
    ];

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    let fullResponse = "";

    const stream = await openai.chat.completions.create({
      model: "gpt-4o",
      max_tokens: 4096,
      messages: chatMessages,
      stream: true,
    });

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) {
        fullResponse += delta;
        res.write(`data: ${JSON.stringify({ content: delta })}\n\n`);
      }
    }

    await db.insert(messages).values({
      conversationId,
      role: "assistant",
      content: fullResponse,
    });

    await db
      .update(conversations)
      .set({ updatedAt: new Date() })
      .where(eq(conversations.id, conversationId));

    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
  } catch (error: any) {
    console.error("[AI Chat] Streaming error:", error);
    res.write(`data: ${JSON.stringify({ error: "An error occurred while generating a response. Please try again." })}\n\n`);
  }

  res.end();
});

export default router;
