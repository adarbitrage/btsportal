import { getParam } from "../lib/params";
import { Router, type IRouter } from "express";
import { db, toolsTable, toolCategoriesTable, toolUserDataTable, toolUsageLogTable, toolDailyUsageTable } from "@workspace/db";
import { eq, and, sql, desc } from "drizzle-orm";
import { getUserEntitlements, hasMemberAccessBypass } from "../lib/entitlements";

const router: IRouter = Router();

// Coaches and admins get the full software tier regardless of purchased products
// (mirrors the frontend Sidebar/EntitlementRoute bypass). Augmenting the set
// here keeps every downstream access/tier check in this router working unchanged
// without granting these keys in getUserEntitlements.
async function getToolEntitlements(userId: number): Promise<Set<string>> {
  const entitlements = await getUserEntitlements(userId);
  if (await hasMemberAccessBypass(userId)) {
    entitlements.add("software:base");
    entitlements.add("software:expanded");
  }
  return entitlements;
}

async function verifyToolAccess(toolId: number, entitlements: Set<string>): Promise<{ allowed: boolean; tool?: any }> {
  if (isNaN(toolId) || toolId < 1) return { allowed: false };
  const [tool] = await db.select({ requiredEntitlement: toolsTable.requiredEntitlement, status: toolsTable.status }).from(toolsTable).where(eq(toolsTable.id, toolId));
  if (!tool || tool.status !== "active") return { allowed: false };
  if (!entitlements.has(tool.requiredEntitlement)) return { allowed: false };
  return { allowed: true, tool };
}

function resolveAccess(
  toolEntitlement: string,
  userEntitlements: Set<string>
): "granted" | "locked" | "hidden" {
  if (userEntitlements.has(toolEntitlement)) return "granted";
  if (toolEntitlement === "software:expanded" && userEntitlements.has("software:base")) return "locked";
  return "hidden";
}

router.get("/tools", async (req, res): Promise<void> => {
  const userId = req.userId!;
  const entitlements = await getToolEntitlements(userId);

  if (!entitlements.has("software:base") && !entitlements.has("software:expanded")) {
    res.status(403).json({ error: "Software entitlement required" });
    return;
  }

  const categories = await db.select().from(toolCategoriesTable).orderBy(toolCategoriesTable.sortOrder);

  const tools = await db
    .select({
      id: toolsTable.id,
      slug: toolsTable.slug,
      name: toolsTable.name,
      shortDescription: toolsTable.shortDescription,
      type: toolsTable.type,
      categoryId: toolsTable.categoryId,
      categoryName: toolCategoriesTable.name,
      categorySlug: toolCategoriesTable.slug,
      requiredEntitlement: toolsTable.requiredEntitlement,
      icon: toolsTable.icon,
      status: toolsTable.status,
      isFeatured: toolsTable.isFeatured,
      badge: toolsTable.badge,
      totalLaunches: toolsTable.totalLaunches,
      sortOrder: toolsTable.sortOrder,
    })
    .from(toolsTable)
    .innerJoin(toolCategoriesTable, eq(toolsTable.categoryId, toolCategoriesTable.id))
    .orderBy(toolsTable.sortOrder);

  const toolsWithAccess = tools
    .filter((t) => t.status === "active" || t.status === "coming_soon")
    .map((t) => ({
      ...t,
      isFeatured: t.isFeatured === 1,
      access: t.status === "coming_soon" ? "hidden" as const : resolveAccess(t.requiredEntitlement, entitlements),
    }));

  res.json({ tools: toolsWithAccess, categories });
});

router.get("/tools/:slug", async (req, res): Promise<void> => {
  const userId = req.userId!;
  const slug = getParam(req.params.slug);
  const entitlements = await getToolEntitlements(userId);

  if (!entitlements.has("software:base") && !entitlements.has("software:expanded")) {
    res.status(403).json({ error: "Software entitlement required" });
    return;
  }

  const [tool] = await db
    .select({
      id: toolsTable.id,
      slug: toolsTable.slug,
      name: toolsTable.name,
      shortDescription: toolsTable.shortDescription,
      longDescription: toolsTable.longDescription,
      type: toolsTable.type,
      categoryId: toolsTable.categoryId,
      categoryName: toolCategoriesTable.name,
      requiredEntitlement: toolsTable.requiredEntitlement,
      config: toolsTable.config,
      icon: toolsTable.icon,
      status: toolsTable.status,
      isFeatured: toolsTable.isFeatured,
      badge: toolsTable.badge,
      totalLaunches: toolsTable.totalLaunches,
      helpDocUrl: toolsTable.helpDocUrl,
      videoTutorialUrl: toolsTable.videoTutorialUrl,
    })
    .from(toolsTable)
    .innerJoin(toolCategoriesTable, eq(toolsTable.categoryId, toolCategoriesTable.id))
    .where(eq(toolsTable.slug, slug));

  if (!tool || tool.status === "inactive") {
    res.status(404).json({ error: "Tool not found" });
    return;
  }

  const access = tool.status === "coming_soon" ? "hidden" as const : resolveAccess(tool.requiredEntitlement, entitlements);

  if (access === "locked" || access === "hidden") {
    res.json({
      id: tool.id,
      slug: tool.slug,
      name: tool.name,
      shortDescription: tool.shortDescription,
      longDescription: tool.longDescription,
      type: tool.type,
      categoryId: tool.categoryId,
      categoryName: tool.categoryName,
      requiredEntitlement: tool.requiredEntitlement,
      icon: tool.icon,
      status: tool.status,
      isFeatured: tool.isFeatured === 1,
      badge: tool.badge,
      totalLaunches: tool.totalLaunches,
      helpDocUrl: tool.helpDocUrl,
      videoTutorialUrl: tool.videoTutorialUrl,
      config: null,
      access,
      userEntitlements: Array.from(entitlements),
    });
    return;
  }

  res.json({
    ...tool,
    isFeatured: tool.isFeatured === 1,
    access,
    userEntitlements: Array.from(entitlements),
  });
});

router.get("/tools/:toolId/data", async (req, res): Promise<void> => {
  const userId = req.userId!;
  const toolId = parseInt(req.params.toolId);
  const entitlements = await getToolEntitlements(userId);
  const { allowed } = await verifyToolAccess(toolId, entitlements);
  if (!allowed) {
    res.status(403).json({ error: "Access denied to this tool" });
    return;
  }

  const data = await db
    .select()
    .from(toolUserDataTable)
    .where(and(eq(toolUserDataTable.userId, userId), eq(toolUserDataTable.toolId, toolId)));

  res.json(data.map((d) => ({
    id: d.id,
    toolId: d.toolId,
    dataKey: d.dataKey,
    dataValue: d.dataValue,
    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString(),
  })));
});

router.post("/tools/:toolId/data", async (req, res): Promise<void> => {
  const userId = req.userId!;
  const toolId = parseInt(req.params.toolId);
  const { dataKey, dataValue } = req.body;
  if (!dataKey || dataValue === undefined) {
    res.status(400).json({ error: "dataKey and dataValue are required" });
    return;
  }
  const entitlements = await getToolEntitlements(userId);
  const { allowed } = await verifyToolAccess(toolId, entitlements);
  if (!allowed) {
    res.status(403).json({ error: "Access denied to this tool" });
    return;
  }

  const [result] = await db
    .insert(toolUserDataTable)
    .values({ userId, toolId, dataKey, dataValue: JSON.stringify(dataValue) })
    .onConflictDoUpdate({
      target: [toolUserDataTable.userId, toolUserDataTable.toolId, toolUserDataTable.dataKey],
      set: { dataValue: JSON.stringify(dataValue), updatedAt: new Date() },
    })
    .returning();

  res.status(201).json({
    id: result.id,
    toolId: result.toolId,
    dataKey: result.dataKey,
    dataValue: result.dataValue,
    createdAt: result.createdAt.toISOString(),
    updatedAt: result.updatedAt.toISOString(),
  });
});

router.put("/tools/:toolId/data/:dataKey", async (req, res): Promise<void> => {
  const userId = req.userId!;
  const toolId = parseInt(req.params.toolId);
  const dataKey = getParam(req.params.dataKey);
  const { dataValue } = req.body;
  if (dataValue === undefined) {
    res.status(400).json({ error: "dataValue is required" });
    return;
  }
  const entitlements = await getToolEntitlements(userId);
  const { allowed } = await verifyToolAccess(toolId, entitlements);
  if (!allowed) {
    res.status(403).json({ error: "Access denied to this tool" });
    return;
  }

  const [result] = await db
    .update(toolUserDataTable)
    .set({ dataValue: JSON.stringify(dataValue), updatedAt: new Date() })
    .where(
      and(
        eq(toolUserDataTable.userId, userId),
        eq(toolUserDataTable.toolId, toolId),
        eq(toolUserDataTable.dataKey, dataKey)
      )
    )
    .returning();

  if (!result) {
    res.status(404).json({ error: "Data not found" });
    return;
  }

  res.json({
    id: result.id,
    toolId: result.toolId,
    dataKey: result.dataKey,
    dataValue: result.dataValue,
    createdAt: result.createdAt.toISOString(),
    updatedAt: result.updatedAt.toISOString(),
  });
});

router.delete("/tools/:toolId/data/:dataKey", async (req, res): Promise<void> => {
  const userId = req.userId!;
  const toolId = parseInt(req.params.toolId);
  const dataKey = getParam(req.params.dataKey);
  const entitlements = await getToolEntitlements(userId);
  const { allowed } = await verifyToolAccess(toolId, entitlements);
  if (!allowed) {
    res.status(403).json({ error: "Access denied to this tool" });
    return;
  }

  await db
    .delete(toolUserDataTable)
    .where(
      and(
        eq(toolUserDataTable.userId, userId),
        eq(toolUserDataTable.toolId, toolId),
        eq(toolUserDataTable.dataKey, dataKey)
      )
    );

  res.status(204).send();
});

router.post("/tools/:toolId/usage", async (req, res): Promise<void> => {
  const userId = req.userId!;
  const toolId = parseInt(req.params.toolId);
  const { action, metadata } = req.body;
  if (!action || typeof action !== "string") {
    res.status(400).json({ error: "action is required" });
    return;
  }
  const entitlements = await getToolEntitlements(userId);
  const { allowed } = await verifyToolAccess(toolId, entitlements);
  if (!allowed) {
    res.status(403).json({ error: "Access denied to this tool" });
    return;
  }

  const tier = entitlements.has("software:expanded") ? "expanded" : entitlements.has("software:base") ? "base" : "none";

  await db.insert(toolUsageLogTable).values({
    userId,
    toolId,
    action,
    entitlementTier: tier,
    metadata: metadata ? JSON.stringify(metadata) : null,
  });

  if (action === "open") {
    await db
      .update(toolsTable)
      .set({ totalLaunches: sql`${toolsTable.totalLaunches} + 1` })
      .where(eq(toolsTable.id, toolId));
  }

  res.status(201).json({ success: true });
});

function getResetTime(): string {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);
  return tomorrow.toISOString();
}

async function checkDailyLimit(userId: number, toolId: number, limit: number): Promise<{ allowed: boolean; remaining: number; resetTime: string }> {
  const today = new Date().toISOString().split("T")[0];

  const [existing] = await db
    .select()
    .from(toolDailyUsageTable)
    .where(
      and(
        eq(toolDailyUsageTable.userId, userId),
        eq(toolDailyUsageTable.toolId, toolId),
        eq(toolDailyUsageTable.usageDate, today)
      )
    );

  const used = existing?.generationCount ?? 0;
  const remaining = Math.max(0, limit - used);

  return {
    allowed: used < limit,
    remaining,
    resetTime: getResetTime(),
  };
}

async function claimDailyUsage(userId: number, toolId: number, limit: number): Promise<{ allowed: boolean; remaining: number; resetTime: string }> {
  const today = new Date().toISOString().split("T")[0];

  const result = await db.execute(sql`
    INSERT INTO tool_daily_usage (user_id, tool_id, usage_date, generation_count)
    VALUES (${userId}, ${toolId}, ${today}, 1)
    ON CONFLICT (user_id, tool_id, usage_date)
    DO UPDATE SET generation_count = tool_daily_usage.generation_count + 1
    WHERE tool_daily_usage.generation_count < ${limit}
    RETURNING generation_count
  `);

  const rows = result.rows as any[];
  if (!rows || rows.length === 0) {
    return { allowed: false, remaining: 0, resetTime: getResetTime() };
  }

  const newCount = rows[0].generation_count;
  return {
    allowed: true,
    remaining: Math.max(0, limit - newCount),
    resetTime: getResetTime(),
  };
}

async function verifyToolBySlug(slug: string, entitlements: Set<string>): Promise<{ allowed: boolean; tool?: typeof toolsTable.$inferSelect; reason?: string }> {
  const [tool] = await db.select().from(toolsTable).where(eq(toolsTable.slug, slug));
  if (!tool) return { allowed: false, reason: "Tool not found" };
  if (tool.status !== "active") return { allowed: false, reason: "Tool not available" };
  if (!entitlements.has(tool.requiredEntitlement)) return { allowed: false, reason: "Insufficient entitlement" };
  return { allowed: true, tool };
}

router.post("/tools/headline-generator/generate", async (req, res): Promise<void> => {
  const userId = req.userId!;
  const entitlements = await getToolEntitlements(userId);

  const access = await verifyToolBySlug("headline-generator", entitlements);
  if (!access.allowed || !access.tool) {
    res.status(403).json({ error: access.reason || "Access denied" });
    return;
  }

  const tool = access.tool;
  const config = tool.config as any;
  const dailyLimit = entitlements.has("software:expanded")
    ? (config?.limits?.expanded ?? 25)
    : (config?.limits?.base ?? 5);

  const limitCheck = await checkDailyLimit(userId, tool.id, dailyLimit);
  if (!limitCheck.allowed) {
    res.status(429).json({
      error: "Daily generation limit reached",
      remainingToday: 0,
      dailyLimit,
      resetTime: limitCheck.resetTime,
    });
    return;
  }

  const { productDescription, style, platform, tone, count } = req.body;
  const headlineCount = Math.min(count || 5, 10);

  try {
    const { anthropic } = await import("@workspace/integrations-anthropic-ai");

    const systemPrompt = `You are an expert direct-response copywriter specializing in affiliate marketing headlines. Generate exactly ${headlineCount} unique, high-converting headlines.

Rules:
- Each headline should be attention-grabbing and create curiosity
- Use proven headline formulas (numbers, questions, how-to, urgency)
- Keep headlines under 80 characters when possible
- Tailor headlines for the specified platform and tone
- Return ONLY the headlines, one per line, numbered 1-${headlineCount}`;

    const userPrompt = `Product/Offer: ${productDescription}
${style ? `Style: ${style}` : ""}
${platform ? `Platform: ${platform}` : ""}
${tone ? `Tone: ${tone}` : ""}

Generate ${headlineCount} headlines:`;

    const message = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 8192,
      messages: [{ role: "user", content: userPrompt }],
      system: systemPrompt,
    });

    const content = message.content[0];
    const text = content.type === "text" ? content.text : "";

    const headlines = text
      .split("\n")
      .map((line: string) => line.replace(/^\d+[\.\)]\s*/, "").trim())
      .filter((line: string) => line.length > 0)
      .slice(0, headlineCount);

    const usageClaim = await claimDailyUsage(userId, tool.id, dailyLimit);

    const inputTokens = message.usage?.input_tokens ?? 0;
    const outputTokens = message.usage?.output_tokens ?? 0;
    const totalTokens = inputTokens + outputTokens;
    const estimatedCostCents = Math.ceil((inputTokens * 0.025 + outputTokens * 0.125) / 100);
    const genTier = entitlements.has("software:expanded") ? "expanded" : "base";

    await db.insert(toolUsageLogTable).values({
      userId,
      toolId: tool.id,
      action: "generate",
      entitlementTier: genTier,
      aiTokensUsed: totalTokens,
      aiCostCents: estimatedCostCents,
      metadata: JSON.stringify({ count: headlines.length }),
    });

    res.json({
      headlines,
      remainingToday: usageClaim.remaining,
      dailyLimit,
    });
  } catch (error: any) {
    console.error("Headline generation error:", error);
    res.status(500).json({ error: "Failed to generate headlines" });
  }
});

router.post("/tools/campaign-calculator/analyze", async (req, res): Promise<void> => {
  const userId = req.userId!;
  const entitlements = await getToolEntitlements(userId);

  const access = await verifyToolBySlug("campaign-calculator", entitlements);
  if (!access.allowed || !access.tool) {
    res.status(403).json({ error: access.reason || "Access denied" });
    return;
  }

  if (!entitlements.has("software:expanded")) {
    res.status(403).json({ error: "Expanded software entitlement required for AI analysis" });
    return;
  }

  const tool = access.tool;
  const config = tool.config as any;
  const dailyLimit = config?.limits?.expanded ?? 15;

  const limitCheck = await checkDailyLimit(userId, tool.id, dailyLimit);
  if (!limitCheck.allowed) {
    res.status(429).json({
      error: "Daily analysis limit reached",
      remainingToday: 0,
      dailyLimit,
      resetTime: limitCheck.resetTime,
    });
    return;
  }

  const { dailyBudget, cpc, landingPageCtr, offerPayout, conversionRate, dailyClicks, dailyLeads, dailyConversions, dailyRevenue, dailyProfit } = req.body;

  try {
    const { anthropic } = await import("@workspace/integrations-anthropic-ai");

    const prompt = `Analyze these affiliate marketing campaign numbers and provide actionable insights:

Campaign Metrics:
- Daily Budget: $${dailyBudget}
- Cost Per Click: $${cpc}
- Landing Page CTR: ${landingPageCtr}%
- Offer Payout: $${offerPayout}
- Conversion Rate: ${conversionRate}%

Calculated Results:
- Daily Clicks: ${dailyClicks || Math.round(dailyBudget / cpc)}
- Daily Leads: ${dailyLeads || Math.round((dailyBudget / cpc) * (landingPageCtr / 100))}
- Daily Conversions: ${dailyConversions || ((dailyBudget / cpc) * (landingPageCtr / 100) * (conversionRate / 100)).toFixed(1)}
- Daily Revenue: $${dailyRevenue || ((dailyBudget / cpc) * (landingPageCtr / 100) * (conversionRate / 100) * offerPayout).toFixed(2)}
- Daily Profit: $${dailyProfit || (((dailyBudget / cpc) * (landingPageCtr / 100) * (conversionRate / 100) * offerPayout) - dailyBudget).toFixed(2)}

Provide a brief (3-4 paragraph) analysis covering:
1. Overall campaign health and ROI assessment
2. Key metrics that need improvement and specific targets
3. Actionable recommendations to improve profitability`;

    const message = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 8192,
      messages: [{ role: "user", content: prompt }],
    });

    const content = message.content[0];
    const analysis = content.type === "text" ? content.text : "";

    const usageClaim = await claimDailyUsage(userId, tool.id, dailyLimit);

    const aInputTokens = message.usage?.input_tokens ?? 0;
    const aOutputTokens = message.usage?.output_tokens ?? 0;
    const aTotalTokens = aInputTokens + aOutputTokens;
    const aEstimatedCostCents = Math.ceil((aInputTokens * 0.025 + aOutputTokens * 0.125) / 100);

    await db.insert(toolUsageLogTable).values({
      userId,
      toolId: tool.id,
      action: "analyze",
      entitlementTier: "expanded",
      aiTokensUsed: aTotalTokens,
      aiCostCents: aEstimatedCostCents,
    });

    res.json({
      analysis,
      remainingToday: usageClaim.remaining,
      dailyLimit,
    });
  } catch (error: any) {
    console.error("Campaign analysis error:", error);
    res.status(500).json({ error: "Failed to analyze campaign" });
  }
});

export default router;
