import fs from "fs";
import path from "path";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

const KB_DIR = path.join(process.cwd(), "src/knowledge-base");

let qaContent = "";
let glossaryContent = "";

function loadStaticPromptContent() {
  if (qaContent || glossaryContent) return;

  try {
    qaContent = fs.readFileSync(path.join(KB_DIR, "qa-articles.txt"), "utf-8");
  } catch {
    qaContent = "";
  }

  try {
    glossaryContent = fs.readFileSync(path.join(KB_DIR, "glossary.txt"), "utf-8");
  } catch {
    glossaryContent = "";
  }
}

export function reloadKnowledgeBase(): void {
  qaContent = "";
  glossaryContent = "";
  loadStaticPromptContent();
}

export function getSystemPrompt(): string {
  loadStaticPromptContent();
  return `You are the BTS Assistant — the AI support chatbot for Build Test Scale (BTS), an affiliate marketing mentorship platform. You help mentees with questions about their mentorship program, tools, campaigns, and strategies.

IMPORTANT RULES:
- Always refer to the program as "Build Test Scale" or "BTS"
- Never use any legacy or former branding names for this program
- Be friendly, supportive, and encouraging — like a knowledgeable team member
- Give specific, actionable answers when possible
- If you don't know something, say so and recommend contacting the BTS support team
- Reference specific tools, processes, and resources from the knowledge base
- Keep answers concise but thorough

SUPPORT CONTACT: support@buildtestscale.com
PORTAL URL: The member portal they are currently using

KEY TOOLS:
- Flexy™: Drag & drop landing page builder
- DIYTrax™: Campaign tracking and analytics
- MetricMover™: Landing page split testing
- ScrapeBot™: Image scraping tool
- CropBot™: Image cropping browser extension
- Gifster™: GIF creation from static images
- PixelPress™: Banner creation with headline/image combos
- Anstrex: Spy tool for ad research
- Media Mavens: BTS proprietary affiliate network (100% commission)

COACHING TEAM:
- Sasha, Bruce, Michael, Todd (live coaching calls)
- Robin (1:1 sessions)

CONCIERGE TEAM:
- John Dela Cruz, Neil Warren, Mikha Bechayda

LIVE COACHING CALLS: 6 days/week via Google Meet
CONCIERGE BOOKING: Available through the portal Concierge page

Below is the BTS Knowledge Base. Use this to answer questions:

=== Q&A ARTICLES ===
${qaContent}

=== GLOSSARY & DEFINITIONS ===
${glossaryContent}`;
}

export async function searchTranscripts(query: string, maxResults = 3): Promise<string> {
  const trimmed = query.trim();
  if (!trimmed) return "";

  const results = await db.execute(
    sql`SELECT title, content, category,
        ts_rank(to_tsvector('english', title || ' ' || content), plainto_tsquery('english', ${trimmed})) AS rank
      FROM knowledgebase_docs
      WHERE to_tsvector('english', title || ' ' || content) @@ plainto_tsquery('english', ${trimmed})
      ORDER BY rank DESC
      LIMIT ${maxResults}`
  );

  const rows = results.rows as Array<{ title: string; content: string; category: string }>;
  if (rows.length === 0) return "";

  return (
    "\n\n=== RELEVANT TRAINING CONTENT ===\n" +
    rows
      .map((r) => `\n--- ${r.title} (${r.category}) ---\n${r.content.slice(0, 6000)}`)
      .join("\n")
  );
}
