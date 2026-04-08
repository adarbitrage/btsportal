import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const KB_DIR = path.join(__dirname, "../../knowledge-base");

let qaContent = "";
let glossaryContent = "";
let transcriptChunks: { title: string; content: string }[] = [];
let videoTranscriptChunks: { title: string; content: string }[] = [];

function loadKnowledgeBase() {
  if (qaContent) return;

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

  try {
    const raw = fs.readFileSync(path.join(KB_DIR, "coaching-transcripts.txt"), "utf-8");
    const sections = raw.split(/\n---\n/).filter((s) => s.trim().length > 100);
    transcriptChunks = sections.map((section) => {
      const titleMatch = section.match(/^##\s*(.+)/m);
      const title = titleMatch ? titleMatch[1].trim() : "Coaching Session";
      return { title, content: section.slice(0, 4000) };
    });
  } catch {
    transcriptChunks = [];
  }

  try {
    const raw = fs.readFileSync(path.join(KB_DIR, "video-transcripts.txt"), "utf-8");
    const sections = raw
      .split(/\n---\n/)
      .filter((s) => s.trim().length > 50 && /^Title:\s*.+/m.test(s));
    videoTranscriptChunks = sections.map((section) => {
      const titleMatch = section.match(/^Title:\s*(.+)/m);
      const title = titleMatch ? titleMatch[1].trim() : "Training Video";
      return { title, content: section.slice(0, 6000) };
    });
  } catch {
    videoTranscriptChunks = [];
  }
}

export function getSystemPrompt(): string {
  loadKnowledgeBase();
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
- Sasha Bobylev, Bruce Clark, Michael Wissbaum, Todd Rupp (live coaching calls)
- Robin Shepard (1:1 sessions)

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

function scoreChunks(
  chunks: { title: string; content: string }[],
  queryWords: string[],
): { title: string; content: string; score: number }[] {
  return chunks.map((chunk) => {
    const lower = (chunk.title + " " + chunk.content).toLowerCase();
    let score = 0;
    for (const word of queryWords) {
      let idx = 0;
      while ((idx = lower.indexOf(word, idx)) !== -1) {
        score++;
        idx += word.length;
      }
    }
    return { ...chunk, score };
  });
}

export function searchTranscripts(query: string, maxResults = 3): string {
  loadKnowledgeBase();

  const queryWords = query
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 2)
    .slice(0, 20);

  const coachingScored = scoreChunks(transcriptChunks, queryWords);
  const videoScored = scoreChunks(videoTranscriptChunks, queryWords);

  const allScored = [
    ...coachingScored.map((c) => ({ ...c, source: "coaching" as const })),
    ...videoScored.map((c) => ({ ...c, source: "video" as const })),
  ];

  allScored.sort((a, b) => b.score - a.score);
  const top = allScored.filter((s) => s.score > 0).slice(0, maxResults);

  if (top.length === 0) return "";

  return (
    "\n\n=== RELEVANT TRAINING CONTENT ===\n" +
    top
      .map(
        (t) =>
          `\n--- ${t.title} (${t.source === "video" ? "Training Video" : "Coaching Session"}) ---\n${t.content}`,
      )
      .join("\n")
  );
}
