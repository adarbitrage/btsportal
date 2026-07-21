import { db, chatSessionsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { getAnthropicClient } from "@workspace/integrations-anthropic-ai";

/**
 * AI-generated chat session titles (ChatGPT/Claude-style).
 *
 * A brand-new session is created instantly with a truncated-first-message
 * title so the UI is never blank; after the first assistant reply is stored,
 * the chat route fires generateAndApplySessionTitle fire-and-forget to replace
 * it with a short conceptual title. Failure is loud-logged and harmless — the
 * truncated title simply remains.
 */

const TITLE_MODEL = "claude-haiku-4-5";
const MAX_TITLE_LENGTH = 80;

const TITLE_SYSTEM_PROMPT =
  "You generate short conversation titles. Given the first user message and assistant reply of a conversation, " +
  "output ONLY a concise 3-7 word Title Case title capturing the topic (e.g. \"Tax Deduction Question\"). " +
  "No quotes, no trailing punctuation, no filler like \"Help with\" or \"Question about\", no explanation — just the title.";

/**
 * Normalize the model output into a usable title, or null when the output is
 * empty/garbage (caller keeps the existing truncated title in that case).
 * Exported for unit tests.
 */
export function sanitizeGeneratedTitle(raw: string): string | null {
  // First non-empty line only — models sometimes add commentary.
  const firstLine = raw
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  if (!firstLine) return null;

  let title = firstLine
    // Strip common prefixes like "Title:" and surrounding quotes.
    .replace(/^title\s*:\s*/i, "")
    // Strip filler lead-ins the prompt forbids but models sometimes emit.
    .replace(/^(help with|question about|questions about|asking about|inquiry about)\s+/i, "")
    .replace(/^["'\u201c\u201d\u2018\u2019`]+/, "")
    .replace(/["'\u201c\u201d\u2018\u2019`]+$/, "")
    // Trailing punctuation (keep internal punctuation intact).
    .replace(/[.!?:;,]+$/, "")
    .trim();

  if (!title) return null;

  const words = title.split(/\s+/);
  // Strict prompt asks for 3-7 words; tolerate 2-10 so a good-but-slightly-off
  // answer isn't discarded, but reject one-word or rambling outputs.
  if (words.length < 2 || words.length > 10) return null;

  if (title.length > MAX_TITLE_LENGTH) {
    title = title.slice(0, MAX_TITLE_LENGTH).trim();
  }

  return title;
}

/** Anthropic-call seam, injectable for tests (no real network calls). */
export type TitleModelCall = (userMessage: string, assistantReply: string) => Promise<string>;

async function callTitleModel(userMessage: string, assistantReply: string): Promise<string> {
  const response = await getAnthropicClient().messages.create({
    model: TITLE_MODEL,
    max_tokens: 60,
    system: TITLE_SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `First user message:\n${userMessage.slice(0, 2000)}\n\nFirst assistant reply:\n${assistantReply.slice(0, 2000)}`,
      },
    ],
  });
  const block = response.content.find((b) => b.type === "text");
  return block && block.type === "text" ? block.text : "";
}

/**
 * Generate a conceptual title for a just-created session and persist it.
 * Fully fire-and-forget: never throws, never blocks the SSE stream. On any
 * failure (LLM error, empty/garbage output) it logs loudly and leaves the
 * truncated-first-message title in place.
 */
export async function generateAndApplySessionTitle(
  sessionId: number,
  userMessage: string,
  assistantReply: string,
  modelCall: TitleModelCall = callTitleModel,
): Promise<void> {
  try {
    const raw = await modelCall(userMessage, assistantReply);
    const title = sanitizeGeneratedTitle(raw);
    if (!title) {
      console.error(
        `[chat-session-title] Unusable title output for session ${sessionId} (raw=${JSON.stringify(raw?.slice(0, 200))}); keeping truncated title`,
      );
      return;
    }
    await db.update(chatSessionsTable).set({ title }).where(eq(chatSessionsTable.id, sessionId));
  } catch (err) {
    console.error(`[chat-session-title] Title generation failed for session ${sessionId}; keeping truncated title:`, err);
  }
}
