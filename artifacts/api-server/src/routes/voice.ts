import { Router, type Request, type Response } from "express";
import { db, usersTable, voiceCallsTable, voiceDailyUsageTable, knowledgebaseDocsTable } from "@workspace/db";
import { eq, sql, and, desc } from "drizzle-orm";
import { isAdminRole } from "@workspace/auth";
import Retell from "retell-sdk";
import { hasEntitlement, hasMemberAccessBypass } from "../lib/entitlements";
import { buildMemberVoiceContext } from "../lib/voice-context";
import { requirePermission } from "../middleware/rbac";
import { csvEscape } from "../lib/csv";
import { logAdminAction } from "../lib/audit-log";
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
        AND audience <> 'admin'
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
          AND audience <> 'admin'
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
  const hasAccess = isAdmin || (await hasMemberAccessBypass(userId)) || (await hasEntitlement(userId, "voice:access"));
  const secondsUsedToday = await getDailySecondsUsed(userId);
  const secondsRemaining = Math.max(0, VOICE_DAILY_SECONDS_CAP - secondsUsedToday);

  res.json({
    has_access: hasAccess,
    daily_cap_seconds: VOICE_DAILY_SECONDS_CAP,
    seconds_used_today: secondsUsedToday,
    seconds_remaining: secondsRemaining,
  });
});

type VoiceCallsRange = "7d" | "30d" | "all";

function parseVoiceCallsRange(value: unknown): VoiceCallsRange {
  const str = Array.isArray(value) ? value[0] : value;
  return str === "7d" || str === "30d" ? str : "all";
}

// Accepts an exact calendar date in YYYY-MM-DD form and rejects anything else
// (including real-looking-but-invalid dates like 2026-02-30). Returns the
// normalized YYYY-MM-DD string or null when the input is missing/invalid.
function parseCallsDate(value: unknown): string | null {
  const str = Array.isArray(value) ? value[0] : value;
  if (typeof str !== "string") return null;
  const trimmed = str.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
  const d = new Date(`${trimmed}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return null;
  // Guard against overflow (e.g. 2026-02-30 -> 2026-03-02).
  if (d.toISOString().split("T")[0] !== trimmed) return null;
  return trimmed;
}

router.get("/voice/calls", async (req: Request, res: Response): Promise<void> => {
  const userId = req.userId!;

  const rawLimit = parseInt(String(req.query.limit ?? "10"), 10);
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 50) : 10;
  const rawOffset = parseInt(String(req.query.offset ?? "0"), 10);
  const offset = Number.isFinite(rawOffset) && rawOffset > 0 ? rawOffset : 0;

  const qRaw = Array.isArray(req.query.q) ? req.query.q[0] : req.query.q;
  const q = typeof qRaw === "string" ? qRaw.trim().slice(0, 200) : "";
  const range = parseVoiceCallsRange(req.query.range);

  // Optional explicit custom range. When either bound is supplied it takes
  // precedence over the preset `range` selector so the two never double-filter.
  const fromDate = parseCallsDate(req.query.from);
  const toDate = parseCallsDate(req.query.to);
  const hasCustomRange = fromDate !== null || toDate !== null;

  try {
    const conditions = [eq(voiceCallsTable.userId, userId), sql`${voiceCallsTable.endedAt} IS NOT NULL`];

    if (q) {
      const pattern = `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
      conditions.push(
        sql`(${voiceCallsTable.summary} ILIKE ${pattern} OR ${voiceCallsTable.transcript} ILIKE ${pattern})`
      );
    }

    if (hasCustomRange) {
      if (fromDate !== null) {
        conditions.push(sql`${voiceCallsTable.startedAt} >= ${fromDate}::date`);
      }
      if (toDate !== null) {
        // Inclusive end-of-day: anything started before the next calendar day.
        conditions.push(sql`${voiceCallsTable.startedAt} < (${toDate}::date + interval '1 day')`);
      }
    } else if (range !== "all") {
      const days = range === "7d" ? 7 : 30;
      conditions.push(sql`${voiceCallsTable.startedAt} >= NOW() - ${`${days} days`}::interval`);
    }

    const rows = await db
      .select({
        id: voiceCallsTable.id,
        status: voiceCallsTable.status,
        startedAt: voiceCallsTable.startedAt,
        endedAt: voiceCallsTable.endedAt,
        durationSeconds: voiceCallsTable.durationSeconds,
        summary: voiceCallsTable.summary,
        transcript: voiceCallsTable.transcript,
        disconnectReason: voiceCallsTable.disconnectReason,
      })
      .from(voiceCallsTable)
      .where(and(...conditions))
      .orderBy(desc(voiceCallsTable.startedAt))
      .limit(limit + 1)
      .offset(offset);

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;

    res.json({
      calls: page.map((c) => ({
        id: c.id,
        status: c.status,
        started_at: c.startedAt instanceof Date ? c.startedAt.toISOString() : c.startedAt,
        ended_at: c.endedAt instanceof Date ? c.endedAt.toISOString() : c.endedAt,
        duration_seconds: c.durationSeconds,
        summary: c.summary,
        transcript: c.transcript,
        disconnect_reason: c.disconnectReason,
      })),
      limit,
      offset,
      has_more: hasMore,
    });
  } catch (err) {
    console.error("[Voice] Failed to fetch call history:", err);
    res.status(500).json({ error: "Failed to load call history." });
  }
});

router.post("/voice/web-call", async (req: Request, res: Response): Promise<void> => {
  const userId = req.userId!;

  if (!RETELL_API_KEY || !RETELL_AGENT_ID) {
    console.error("[Voice] RETELL_API_KEY or RETELL_AGENT_ID not configured");
    res.status(500).json({ error: "Voice assistant is not configured" });
    return;
  }

  const isAdmin = await getIsAdmin(userId);
  const hasAccess = isAdmin || (await hasMemberAccessBypass(userId)) || (await hasEntitlement(userId, "voice:access"));

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

// ---------------------------------------------------------------------------
// Admin voice usage dashboard
//
// These routes power the admin-only "Voice Usage" page, letting admins track
// member voice minutes, identify heavy users, monitor cost, and audit calls.
// Gated on `system:view` (same permission as System Health) so super_admin and
// admin can see it. Usage seconds come from the authoritative
// `voice_daily_usage` table; call rows / transcripts / summaries come from
// `voice_calls`.
// ---------------------------------------------------------------------------

// Roll-up window helpers. "Today" is the single current usage_date; "week" is
// the trailing 7 days (today inclusive); "month" is the trailing 30 days.
function addDaysToDate(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T00:00:00.000Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split("T")[0];
}

type UsagePeriod = "today" | "week" | "month";

function periodStartDate(period: UsagePeriod): string {
  const today = getTodayDate();
  if (period === "today") return today;
  if (period === "week") return addDaysToDate(today, -6);
  return addDaysToDate(today, -29);
}

function parseUsagePeriod(value: unknown): UsagePeriod {
  const str = Array.isArray(value) ? value[0] : value;
  return str === "today" || str === "week" ? str : str === "month" ? "month" : "month";
}

function parsePositiveInt(value: unknown, fallback: number, max: number): number {
  const str = Array.isArray(value) ? value[0] : value;
  const n = parseInt(typeof str === "string" ? str : String(str ?? ""), 10);
  if (!Number.isInteger(n) || n < 1) return fallback;
  return Math.min(n, max);
}

router.get(
  "/admin/voice/usage",
  requirePermission("system:view"),
  async (req: Request, res: Response): Promise<void> => {
    const today = getTodayDate();
    const weekStart = addDaysToDate(today, -6);
    const monthStart = addDaysToDate(today, -29);

    const period = parseUsagePeriod(req.query.period);
    const limit = parsePositiveInt(req.query.limit, 20, 100);
    const periodStart = periodStartDate(period);

    // Aggregate seconds from the authoritative daily-usage table across the
    // three rolling windows in a single scan.
    const secondsResult = await db.execute(
      sql`SELECT
          COALESCE(SUM(CASE WHEN usage_date = ${today} THEN seconds_used ELSE 0 END), 0)::bigint AS today_seconds,
          COALESCE(SUM(CASE WHEN usage_date >= ${weekStart} THEN seconds_used ELSE 0 END), 0)::bigint AS week_seconds,
          COALESCE(SUM(seconds_used), 0)::bigint AS month_seconds
        FROM voice_daily_usage
        WHERE usage_date >= ${monthStart}`
    );

    // Call counts come from voice_calls (every started call), bucketed by the
    // call's start date so they line up with the seconds windows above.
    const callsResult = await db.execute(
      sql`SELECT
          COUNT(*) FILTER (WHERE started_at::date = ${today}::date) AS today_calls,
          COUNT(*) FILTER (WHERE started_at::date >= ${weekStart}::date) AS week_calls,
          COUNT(*) AS month_calls
        FROM voice_calls
        WHERE started_at::date >= ${monthStart}::date`
    );

    const topResult = await db.execute(
      sql`SELECT
          u.id AS user_id,
          u.name AS name,
          u.email AS email,
          SUM(v.seconds_used)::int AS seconds_used,
          (
            SELECT COUNT(*)::int FROM voice_calls c
            WHERE c.user_id = u.id AND c.started_at::date >= ${periodStart}::date
          ) AS call_count
        FROM voice_daily_usage v
        JOIN users u ON u.id = v.user_id
        WHERE v.usage_date >= ${periodStart}
        GROUP BY u.id, u.name, u.email
        ORDER BY seconds_used DESC, u.id ASC
        LIMIT ${limit}`
    );

    const sRow = (secondsResult.rows[0] ?? {}) as Record<string, unknown>;
    const cRow = (callsResult.rows[0] ?? {}) as Record<string, unknown>;
    const num = (v: unknown): number => Number(v ?? 0) || 0;

    res.json({
      totals: {
        today: { seconds: num(sRow.today_seconds), calls: num(cRow.today_calls) },
        week: { seconds: num(sRow.week_seconds), calls: num(cRow.week_calls) },
        month: { seconds: num(sRow.month_seconds), calls: num(cRow.month_calls) },
      },
      dailyCapSeconds: VOICE_DAILY_SECONDS_CAP,
      topMembers: {
        period,
        members: (topResult.rows as Record<string, unknown>[]).map((r) => ({
          userId: num(r.user_id),
          name: (r.name as string) ?? "",
          email: (r.email as string) ?? "",
          secondsUsed: num(r.seconds_used),
          callCount: num(r.call_count),
        })),
      },
    });
  }
);

router.get(
  "/admin/voice/calls",
  requirePermission("system:view"),
  async (req: Request, res: Response): Promise<void> => {
    const page = parsePositiveInt(req.query.page, 1, 1_000_000);
    const limit = parsePositiveInt(req.query.limit, 25, 100);
    const offset = (page - 1) * limit;

    const userIdRaw = Array.isArray(req.query.userId) ? req.query.userId[0] : req.query.userId;
    const userId = userIdRaw != null ? parseInt(String(userIdRaw), 10) : NaN;
    const hasUserFilter = Number.isInteger(userId) && userId > 0;

    const qRaw = Array.isArray(req.query.q) ? req.query.q[0] : req.query.q;
    const q = typeof qRaw === "string" ? qRaw.trim().slice(0, 200) : "";
    const hasSearch = q.length > 0;
    const pattern = hasSearch ? `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%` : "";

    const filters = [];
    if (hasUserFilter) {
      filters.push(sql`c.user_id = ${userId}`);
    }
    if (hasSearch) {
      filters.push(sql`(u.name ILIKE ${pattern} OR u.email ILIKE ${pattern})`);
    }
    const whereClause =
      filters.length > 0
        ? sql`WHERE ${sql.join(filters, sql` AND `)}`
        : sql``;

    const rowsResult = await db.execute(
      sql`SELECT
          c.id AS id,
          c.user_id AS user_id,
          u.name AS name,
          u.email AS email,
          c.status AS status,
          c.started_at AS started_at,
          c.ended_at AS ended_at,
          c.duration_seconds AS duration_seconds,
          c.disconnect_reason AS disconnect_reason,
          (c.transcript IS NOT NULL AND c.transcript <> '') AS has_transcript,
          (c.summary IS NOT NULL AND c.summary <> '') AS has_summary
        FROM voice_calls c
        JOIN users u ON u.id = c.user_id
        ${whereClause}
        ORDER BY c.started_at DESC
        LIMIT ${limit} OFFSET ${offset}`
    );

    const countResult = await db.execute(
      sql`SELECT COUNT(*)::int AS total FROM voice_calls c JOIN users u ON u.id = c.user_id ${whereClause}`
    );
    const total = Number((countResult.rows[0] as Record<string, unknown>)?.total ?? 0) || 0;

    res.json({
      calls: (rowsResult.rows as Record<string, unknown>[]).map((r) => ({
        id: Number(r.id),
        userId: Number(r.user_id),
        name: (r.name as string) ?? "",
        email: (r.email as string) ?? "",
        status: (r.status as string) ?? "",
        startedAt: r.started_at,
        endedAt: r.ended_at,
        durationSeconds: r.duration_seconds == null ? null : Number(r.duration_seconds),
        disconnectReason: (r.disconnect_reason as string | null) ?? null,
        hasTranscript: Boolean(r.has_transcript),
        hasSummary: Boolean(r.has_summary),
      })),
      total,
      page,
      limit,
    });
  }
);

// Streaming CSV export of the (optionally member-filtered) call log. Mirrors
// the `/admin/voice/calls` read endpoint's filtering and ordering so the CSV
// matches exactly what the admin sees in the table before clicking Export.
// Streams row-by-row (text/csv) following the same pattern as the audit-log /
// external-orders exports so large logs don't buffer in memory.
router.get(
  "/admin/voice/calls/export",
  requirePermission("system:view"),
  async (req: Request, res: Response): Promise<void> => {
    const format = parseExportFormat(req.query.format);
    const userIdRaw = Array.isArray(req.query.userId) ? req.query.userId[0] : req.query.userId;
    const userId = userIdRaw != null ? parseInt(String(userIdRaw), 10) : NaN;
    const hasUserFilter = Number.isInteger(userId) && userId > 0;

    // Mirror the read endpoint's `q` name/email search so the exported file
    // matches exactly what the admin sees in the table after searching.
    const qRaw = Array.isArray(req.query.q) ? req.query.q[0] : req.query.q;
    const q = typeof qRaw === "string" ? qRaw.trim().slice(0, 200) : "";
    const hasSearch = q.length > 0;
    const pattern = hasSearch ? `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%` : "";

    const filters = [];
    if (hasUserFilter) {
      filters.push(sql`c.user_id = ${userId}`);
    }
    if (hasSearch) {
      filters.push(sql`(u.name ILIKE ${pattern} OR u.email ILIKE ${pattern})`);
    }
    const whereClause =
      filters.length > 0 ? sql`WHERE ${sql.join(filters, sql` AND `)}` : sql``;

    try {
      const result = await db.execute(
        sql`SELECT
            c.id AS id,
            c.user_id AS user_id,
            u.name AS name,
            u.email AS email,
            c.status AS status,
            c.started_at AS started_at,
            c.ended_at AS ended_at,
            c.duration_seconds AS duration_seconds,
            c.disconnect_reason AS disconnect_reason,
            (c.transcript IS NOT NULL AND c.transcript <> '') AS has_transcript,
            (c.summary IS NOT NULL AND c.summary <> '') AS has_summary
          FROM voice_calls c
          JOIN users u ON u.id = c.user_id
          ${whereClause}
          ORDER BY c.started_at DESC
          LIMIT ${VOICE_EXPORT_HARD_CAP}`
      );

      const rows = (result.rows as Record<string, unknown>[]).map((r) => ({
        id: Number(r.id ?? 0) || 0,
        user_id: Number(r.user_id ?? 0) || 0,
        name: (r.name as string) ?? "",
        email: (r.email as string) ?? "",
        status: (r.status as string) ?? "",
        started_at: toIso(r.started_at),
        ended_at: toIso(r.ended_at),
        duration_seconds: r.duration_seconds == null ? null : Number(r.duration_seconds),
        disconnect_reason: (r.disconnect_reason as string | null) ?? null,
        has_transcript: Boolean(r.has_transcript),
        has_summary: Boolean(r.has_summary),
      }));

      const filterDesc = [
        hasUserFilter ? `member ${userId}` : null,
        hasSearch ? `search "${q}"` : null,
      ]
        .filter(Boolean)
        .join(", ");
      await logAdminAction(
        req,
        "export_data",
        "voice_calls",
        hasUserFilter ? String(userId) : undefined,
        filterDesc
          ? `Exported ${rows.length} voice call rows (${filterDesc})`
          : `Exported ${rows.length} voice call rows`,
      );

      const filename = hasUserFilter ? `voice-calls-member-${userId}-export` : "voice-calls-export";
      if (format === "json") {
        res.setHeader("Content-Type", "application/json");
        res.setHeader("Content-Disposition", `attachment; filename=${filename}.json`);
        res.json(rows);
        return;
      }

      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename=${filename}.csv`);
      res.write(
        "id,user_id,member,email,status,started_at,ended_at,duration_seconds,disconnect_reason,has_transcript,has_summary\n",
      );

      for (const r of rows) {
        res.write(
          [
            r.id,
            r.user_id,
            r.name,
            r.email,
            r.status,
            r.started_at,
            r.ended_at,
            r.duration_seconds == null ? "" : String(r.duration_seconds),
            r.disconnect_reason ?? "",
            r.has_transcript ? "true" : "false",
            r.has_summary ? "true" : "false",
          ]
            .map(csvEscape)
            .join(",") + "\n",
        );
      }

      res.end();
    } catch (error) {
      console.error("[Voice] Calls export error:", error);
      if (!res.headersSent) {
        res.status(500).json({ error: "Failed to export voice calls" });
      } else {
        res.end();
      }
    }
  }
);

router.get(
  "/admin/voice/calls/:id",
  requirePermission("system:view"),
  async (req: Request, res: Response): Promise<void> => {
    const id = parseInt(String(req.params.id), 10);
    if (!Number.isInteger(id) || id < 1) {
      res.status(400).json({ error: "Invalid call id" });
      return;
    }

    const [row] = await db
      .select({
        id: voiceCallsTable.id,
        userId: voiceCallsTable.userId,
        name: usersTable.name,
        email: usersTable.email,
        retellCallId: voiceCallsTable.retellCallId,
        status: voiceCallsTable.status,
        startedAt: voiceCallsTable.startedAt,
        endedAt: voiceCallsTable.endedAt,
        durationSeconds: voiceCallsTable.durationSeconds,
        transcript: voiceCallsTable.transcript,
        summary: voiceCallsTable.summary,
        disconnectReason: voiceCallsTable.disconnectReason,
      })
      .from(voiceCallsTable)
      .innerJoin(usersTable, eq(usersTable.id, voiceCallsTable.userId))
      .where(eq(voiceCallsTable.id, id))
      .limit(1);

    if (!row) {
      res.status(404).json({ error: "Call not found" });
      return;
    }

    res.json({ call: row });
  }
);

// ---------------------------------------------------------------------------
// Admin voice usage exports
//
// Stream the Voice Usage page's two datasets — the per-member usage roll-up
// and the call list — as CSV (default) or JSON so admins can reconcile cost
// or billing in a spreadsheet. Mirrors the existing /admin/export/* pattern:
// gated on the same `system:view` permission as the page, honours the same
// `period` (usage) / `userId` (calls) filters, sets a Content-Disposition
// attachment header, and logs an audit event. A hard cap keeps a single
// download bounded.
// ---------------------------------------------------------------------------

const VOICE_EXPORT_HARD_CAP = 50_000;

function parseExportFormat(value: unknown): "csv" | "json" {
  const str = Array.isArray(value) ? value[0] : value;
  return str === "json" ? "json" : "csv";
}

function toIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (value == null) return "";
  return String(value);
}

router.get(
  "/admin/voice/usage/export",
  requirePermission("system:view"),
  async (req: Request, res: Response): Promise<void> => {
    const period = parseUsagePeriod(req.query.period);
    const format = parseExportFormat(req.query.format);
    const periodStart = periodStartDate(period);

    try {
      const result = await db.execute(
        sql`SELECT
            u.id AS user_id,
            u.name AS name,
            u.email AS email,
            SUM(v.seconds_used)::int AS seconds_used,
            (
              SELECT COUNT(*)::int FROM voice_calls c
              WHERE c.user_id = u.id AND c.started_at::date >= ${periodStart}::date
            ) AS call_count
          FROM voice_daily_usage v
          JOIN users u ON u.id = v.user_id
          WHERE v.usage_date >= ${periodStart}
          GROUP BY u.id, u.name, u.email
          ORDER BY seconds_used DESC, u.id ASC
          LIMIT ${VOICE_EXPORT_HARD_CAP}`
      );

      const rows = (result.rows as Record<string, unknown>[]).map((r) => {
        const seconds = Number(r.seconds_used ?? 0) || 0;
        return {
          user_id: Number(r.user_id ?? 0) || 0,
          name: (r.name as string) ?? "",
          email: (r.email as string) ?? "",
          seconds_used: seconds,
          minutes_used: Math.round((seconds / 60) * 100) / 100,
          call_count: Number(r.call_count ?? 0) || 0,
        };
      });

      await logAdminAction(
        req,
        "export_data",
        "voice_usage",
        undefined,
        `Exported ${rows.length} voice usage rows (period=${period})`,
      );

      const filename = `voice-usage-${period}`;
      if (format === "json") {
        res.setHeader("Content-Type", "application/json");
        res.setHeader("Content-Disposition", `attachment; filename=${filename}.json`);
        res.json(rows);
        return;
      }

      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename=${filename}.csv`);
      res.write("user_id,name,email,seconds_used,minutes_used,call_count\n");
      for (const row of rows) {
        res.write(
          [
            row.user_id,
            row.name,
            row.email,
            row.seconds_used,
            row.minutes_used,
            row.call_count,
          ]
            .map(csvEscape)
            .join(",") + "\n",
        );
      }
      res.end();
    } catch (err) {
      console.error("[Voice] Usage export error:", err);
      if (!res.headersSent) {
        res.status(500).json({ error: "Failed to export voice usage" });
      } else {
        res.end();
      }
    }
  },
);

export default router;
