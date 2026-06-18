import { Router, type Request, type Response } from "express";
import { db, usersTable, voiceCallsTable, voiceDailyUsageTable, knowledgebaseDocsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { isAdminRole } from "@workspace/auth";
import Retell from "retell-sdk";
import { hasEntitlement } from "../lib/entitlements";
import { buildMemberVoiceContext } from "../lib/voice-context";
import crypto from "crypto";

const router = Router();

const RETELL_API_KEY = process.env.RETELL_API_KEY ?? "";
const RETELL_AGENT_ID = process.env.RETELL_AGENT_ID ?? "";
const RETELL_FUNCTION_SECRET = process.env.RETELL_FUNCTION_SECRET ?? "";
const VOICE_DAILY_SECONDS_CAP = parseInt(process.env.VOICE_DAILY_SECONDS_CAP ?? "1800", 10);

const ALL_KB_CATEGORIES = ["faq", "platform_guide", "marketing", "compliance", "advanced_strategy", "troubleshooting", "strategy", "curriculum", "sop", "glossary", "coaching"];

function getTodayDate(): string {
  return new Date().toISOString().split("T")[0];
}

async function getDailySecondsUsed(userId: number): Promise<number> {
  const today = getTodayDate();
  const [row] = await db
    .select({ secondsUsed: voiceDailyUsageTable.secondsUsed })
    .from(voiceDailyUsageTable)
    .where(
      sql`${voiceDailyUsageTable.userId} = ${userId} AND ${voiceDailyUsageTable.usageDate} = ${today}`
    )
    .limit(1);
  return row?.secondsUsed ?? 0;
}

async function getIsAdmin(userId: number): Promise<boolean> {
  const [user] = await db
    .select({ role: usersTable.role })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);
  return !!(user && isAdminRole(user.role));
}

async function searchKnowledgebaseForVoice(query: string): Promise<string> {
  const categoriesArray = `{${ALL_KB_CATEGORIES.join(",")}}`;

  const primaryResults = await db.execute(
    sql`SELECT title, content, category,
        ts_rank(to_tsvector('english', title || ' ' || content), websearch_to_tsquery('english', ${query})) as rank
      FROM knowledgebase_docs
      WHERE to_tsvector('english', title || ' ' || content) @@ websearch_to_tsquery('english', ${query})
        AND category = ANY(${categoriesArray}::text[])
      ORDER BY rank DESC
      LIMIT 4`
  );

  let rows = primaryResults.rows as any[];

  if (rows.length < 2) {
    const orQuery = query.trim().split(/\s+/).filter(Boolean).join(" | ");
    const fallbackResults = await db.execute(
      sql`SELECT title, content, category,
          ts_rank(to_tsvector('english', title || ' ' || content), to_tsquery('english', ${orQuery})) as rank
        FROM knowledgebase_docs
        WHERE to_tsvector('english', title || ' ' || content) @@ to_tsquery('english', ${orQuery})
          AND category = ANY(${categoriesArray}::text[])
        ORDER BY rank DESC
        LIMIT 4`
    );
    const seen = new Set(rows.map((r: any) => r.title));
    for (const r of fallbackResults.rows as any[]) {
      if (!seen.has(r.title)) rows.push(r);
    }
  }

  if (rows.length === 0) return "No relevant information found.";

  return rows
    .slice(0, 4)
    .map((r: any) => `${r.title}: ${(r.content as string).slice(0, 400)}`)
    .join("\n\n");
}

router.get("/voice/status", async (req: Request, res: Response): Promise<void> => {
  const userId = req.userId!;

  const isAdmin = await getIsAdmin(userId);
  const hasAccess = isAdmin || (await hasEntitlement(userId, "voice:access"));
  const secondsUsedToday = await getDailySecondsUsed(userId);
  const secondsRemaining = Math.max(0, VOICE_DAILY_SECONDS_CAP - secondsUsedToday);

  res.json({
    has_access: hasAccess,
    daily_cap_seconds: VOICE_DAILY_SECONDS_CAP,
    seconds_used_today: secondsUsedToday,
    seconds_remaining: secondsRemaining,
  });
});

router.post("/voice/web-call", async (req: Request, res: Response): Promise<void> => {
  const userId = req.userId!;

  if (!RETELL_API_KEY || !RETELL_AGENT_ID) {
    console.error("[Voice] RETELL_API_KEY or RETELL_AGENT_ID not configured");
    res.status(500).json({ error: "Voice assistant is not configured" });
    return;
  }

  const isAdmin = await getIsAdmin(userId);
  const hasAccess = isAdmin || (await hasEntitlement(userId, "voice:access"));

  if (!hasAccess) {
    res.status(403).json({ error: "voice_access_required", message: "Voice assistant requires a higher membership level." });
    return;
  }

  const secondsUsedToday = await getDailySecondsUsed(userId);
  if (!isAdmin && secondsUsedToday >= VOICE_DAILY_SECONDS_CAP) {
    res.status(403).json({ error: "voice_cap_reached", message: "You have reached your daily voice usage limit." });
    return;
  }

  try {
    const client = new Retell({ apiKey: RETELL_API_KEY });
    const dynamicVariables = await buildMemberVoiceContext(userId);

    const webCall = await client.call.createWebCall({
      agent_id: RETELL_AGENT_ID,
      retell_llm_dynamic_variables: dynamicVariables,
      metadata: { bts_user_id: userId },
    });

    await db.insert(voiceCallsTable).values({
      userId,
      retellCallId: webCall.call_id,
      status: webCall.call_status,
      startedAt: new Date(),
    });

    res.json({
      access_token: webCall.access_token,
      call_id: webCall.call_id,
    });
  } catch (err: any) {
    console.error("[Voice] Failed to create web call:", err);
    res.status(500).json({ error: "Failed to start voice call. Please try again." });
  }
});

router.post("/voice/kb-search", async (req: Request, res: Response): Promise<void> => {
  const authHeader = req.headers.authorization ?? "";
  const provided = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

  if (process.env.NODE_ENV === "production") {
    if (!RETELL_FUNCTION_SECRET) {
      console.error("[Voice KB] RETELL_FUNCTION_SECRET not configured — rejecting");
      res.status(503).json({ error: "KB search not configured" });
      return;
    }
    const secretBuf = Buffer.from(RETELL_FUNCTION_SECRET);
    const providedBuf = Buffer.from(provided);
    let valid = false;
    if (secretBuf.length === providedBuf.length) {
      valid = crypto.timingSafeEqual(secretBuf, providedBuf);
    }
    if (!valid) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
  } else {
    if (RETELL_FUNCTION_SECRET && provided !== RETELL_FUNCTION_SECRET) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
  }

  const { query } = req.body as { query?: string };
  if (!query || typeof query !== "string" || !query.trim()) {
    res.status(400).json({ error: "query is required" });
    return;
  }

  try {
    const results = await searchKnowledgebaseForVoice(query.trim());
    res.json({ results });
  } catch (err) {
    console.error("[Voice KB] Search error:", err);
    res.status(500).json({ error: "Search failed" });
  }
});

export default router;
