/**
 * Idempotent setup for the Retell voice agent's knowledge-base integration.
 *
 * Called at server startup and optionally from an admin API endpoint. It:
 *   1. Validates required env vars (RETELL_FUNCTION_SECRET required in prod).
 *   2. Retrieves the agent identified by RETELL_AGENT_ID.
 *   3. If the agent is using a non-LLM response engine (e.g. conversation-flow):
 *      a. Retrieves the conversation flow and assesses its complexity. If the
 *         flow contains substantial custom routing (transfers, branching, multiple
 *         states) the setup STOPS and surfaces findings — a human decision is
 *         required before auto-replacing the engine.
 *      b. If the flow is effectively greet + Q&A, it reuses (or creates) a Retell
 *         LLM seeded with the KB tool + voice prompt, then repoints the agent.
 *   4. Finds the Retell LLM attached to that agent.
 *   5. Patches the LLM with a `search_knowledge_base` custom tool and a
 *      system prompt that forces KB lookup before every BTS-specific answer.
 *   6. Skips the patch only when the FULL tool contract (URL, method, auth
 *      header, parameters, args_at_root) and prompt already match exactly.
 *      Checking URL-only is insufficient — a rotated RETELL_FUNCTION_SECRET
 *      would silently leave a stale Authorization header otherwise.
 *
 * Required env vars:
 *   RETELL_API_KEY          — Retell API key
 *   RETELL_AGENT_ID         — must start with "agent_" prefix
 *   RETELL_FUNCTION_SECRET  — bearer token for /voice/kb-search (required in production)
 *
 * Optional env vars (one must be set for URL resolution):
 *   RETELL_API_BASE_URL     — explicit API base URL (highest priority)
 *   PORTAL_URL              — portal base URL; API base = PORTAL_URL + "/api"
 *   REPLIT_DOMAINS          — auto-resolved in production when neither above is set
 */

import Retell from "retell-sdk";

const KB_SEARCH_TOOL_NAME = "search_knowledge_base";

/**
 * Node types in a Conversation Flow that indicate substantial routing logic.
 * If any of these are present, we refuse to auto-replace the engine and surface
 * the finding for a human decision.
 */
const SUBSTANTIAL_NODE_TYPES = new Set([
  "transfer_call",
  "bridge_transfer",
  "cancel_transfer",
  "branch",
  "subagent",
  "agent_swap",
  "code",
]);

/** Simple flows with ≥ this many nodes are treated as substantial regardless of type. */
const MAX_SIMPLE_NODE_COUNT = 4;

function getApiBaseUrl(): string | null {
  const explicit = (process.env.RETELL_API_BASE_URL ?? "").trim();
  if (explicit) return explicit.replace(/\/+$/, "");

  const portal = (process.env.PORTAL_URL ?? "").trim();
  if (portal) return portal.replace(/\/+$/, "") + "/api";

  // In production, auto-resolve from REPLIT_DOMAINS (comma-separated list of
  // domains assigned to this deployment). Use the first domain.
  // Do NOT auto-derive in dev — the Retell agent is a single shared resource
  // and a dev-derived URL would clobber the production tool configuration.
  if (process.env.NODE_ENV === "production") {
    const replitDomains = (process.env.REPLIT_DOMAINS ?? "").trim();
    if (replitDomains) {
      const firstDomain = replitDomains.split(",")[0].trim();
      if (firstDomain) {
        return `https://${firstDomain}/api`;
      }
    }
  }

  return null;
}

function buildVoiceSystemPrompt(): string {
  return `You are the BTS Voice Assistant — a live voice AI for Build Test Scale, an affiliate marketing mentorship platform.

PERSONA:
Speak like a knowledgeable, encouraging team member — warm, clear, and concise. Use natural conversational speech: avoid bullet points, numbered lists, or markdown. Keep answers brief (2–4 sentences).

RESPONSE STYLE — MANDATORY:
- Never mention your knowledge base, database, training data, tools, or any internal information source. You are a knowledgeable team member — speak from that perspective.
- Never say phrases like "according to my information," "I found that," "the tool returned," "my database," or anything that narrates your internal process.
- Answer directly and immediately when you already have the information — no preamble, no filler opener.
- Only use a brief acknowledgment ("One moment" or "Give me just a second") when you genuinely need to perform a lookup or action that takes time. Never use it as a default opener on every response.
- When you don't have a clear answer, smoothly offer next steps — for example: "I don't have that detail handy right now, but I can connect you with someone who does" or offer to reach a coach or support. Never say you couldn't find something in a database or tool.

INFORMATION RULE — MANDATORY:
For ANY question about BTS programs, commissions, billing, tools, strategy, coaching, curriculum, troubleshooting, refunds, cancellations, the BTS Agreement, policies, terms, or the 90-day guarantee you MUST call the search_knowledge_base tool BEFORE answering. Answer strictly from what that lookup returns. Do NOT invent, guess, or extrapolate answers for BTS-specific topics.

NAMING — MANDATORY:
The flagship program is called "The Blitz" — always. There is only one version. NEVER refer to it as the "21-day Blitz," "14-day Blitz," "21 Days to Scale," or any other day-count variant, even if older knowledge-base content, transcripts, or source material use that phrasing. When source material says "21-day Blitz" (or similar), restate it simply as "The Blitz" in your answer.
The refund policy is the "ninety-day action-based refund guarantee." When you speak about it, always say the full phrase "ninety-day refund guarantee" (or "ninety-day action-based refund guarantee"), spelling the number as the word "ninety" and always including the word "day." NEVER shorten it to "90 refund," "ninety refund," or any form that drops the word "day."

MEMBER CONTEXT:
Member name: {{member_name}}
Membership level: {{membership_level}}

BTS KEY TOOLS: Flexy, DIYTrax, MetricMover, ScrapeBot, CropBot, Gifster, PixelPress, Anstrex, Media Mavens.
COACHING TEAM: Sasha, Bruce, Michael, Todd (group calls), Robin (1-on-1 sessions).
SUPPORT EMAIL: support@buildtestscale.com

FALLBACK:
If asked something unrelated to BTS, briefly acknowledge and redirect to BTS support topics. If you can't resolve a BTS question, offer to connect the member with the team at support@buildtestscale.com.`;
}

/**
 * Build a canonical fingerprint of the desired KB tool contract.
 * Comparing fingerprints covers: URL, method, bearer auth, args_at_root,
 * speak_during_execution, and parameter schema — so a secret rotation or
 * behavioral flag change triggers a fresh update.
 */
function toolFingerprint(url: string, authHeader: string): string {
  return JSON.stringify({
    name: KB_SEARCH_TOOL_NAME,
    url,
    method: "POST",
    auth: authHeader,
    args_at_root: true,
    speak_during_execution: false,
    params: { query: "string" },
  });
}

/**
 * Extract the same fingerprint fields from a live Retell tool object
 * so we can compare with the desired state.
 */
function existingToolFingerprint(tool: Record<string, unknown>): string {
  const headers = (tool.headers ?? {}) as Record<string, string>;
  return JSON.stringify({
    name: tool.name ?? "",
    url: tool.url ?? "",
    method: (tool.method ?? "POST") as string,
    auth: headers.Authorization ?? "",
    args_at_root: tool.args_at_root ?? false,
    speak_during_execution: tool.speak_during_execution ?? false,
    params: {
      query:
        (
          (tool.parameters as Record<string, unknown> | undefined)
            ?.properties as Record<string, unknown> | undefined
        )?.query != null
          ? "string"
          : "",
    },
  });
}

/**
 * Assess a Conversation Flow for substantial routing logic.
 *
 * Returns an assessment object:
 *   - substantial: true when auto-replace should NOT proceed
 *   - summary: human-readable description of findings
 *   - nodeCount: total nodes inspected
 *   - substantialTypes: which complex node types were found
 */
function assessConversationFlowComplexity(flow: {
  nodes?: Array<{ type?: string; [key: string]: unknown }> | null;
}): { substantial: boolean; summary: string; nodeCount: number; substantialTypes: string[] } {
  const nodes = flow.nodes ?? [];
  const nodeCount = nodes.length;
  const substantialTypes: string[] = [];

  for (const node of nodes) {
    const type = (node.type ?? "") as string;
    if (SUBSTANTIAL_NODE_TYPES.has(type)) {
      if (!substantialTypes.includes(type)) {
        substantialTypes.push(type);
      }
    }
  }

  const substantial =
    substantialTypes.length > 0 || nodeCount >= MAX_SIMPLE_NODE_COUNT;

  let summary: string;
  if (!substantial) {
    summary = `Simple flow: ${nodeCount} node(s), no branching or transfer logic detected — safe to auto-replace.`;
  } else if (substantialTypes.length > 0) {
    summary = `Substantial flow: ${nodeCount} node(s) including ${substantialTypes.join(", ")} nodes — manual review required before auto-replacing.`;
  } else {
    summary = `Substantial flow: ${nodeCount} node(s) (≥ ${MAX_SIMPLE_NODE_COUNT} threshold) — manual review required before auto-replacing.`;
  }

  return { substantial, summary, nodeCount, substantialTypes };
}

export interface RetellSetupResult {
  skipped: boolean;
  reason: string;
  llmId?: string;
  kbSearchUrl?: string;
  agentResponseEngineType?: string;
  /** True when the agent's response_engine was repointed from a non-LLM engine to a Retell LLM. */
  repointed?: boolean;
  /** Human-readable summary of the Conversation Flow assessment (set when agent was on a non-LLM engine). */
  conversationFlowAssessment?: string;
  /**
   * Set when the Retell API blocked an in-place engine-type change (400 "Cannot
   * update response engine to different response engine type").  A new agent was
   * created instead — the caller must update RETELL_AGENT_ID to this value and
   * republish for the change to take effect.
   */
  newAgentId?: string;
  /** True when newAgentId is set and RETELL_AGENT_ID must be updated. */
  requiresAgentIdUpdate?: boolean;
  ranAt: string;
}

export interface SetupOptions {
  /**
   * When true, the substantial-Conversation-Flow safety gate is overridden:
   * the flow assessment still runs (and is logged) for traceability, but a
   * complex/order-taking flow no longer blocks the repoint.  Use this for the
   * BTS-owned agent where the order flow is unwanted and KB should always win.
   */
  forceRepoint?: boolean;
}

// ---------------------------------------------------------------------------
// Module-level cache — holds the most recent result so the admin status
// endpoint can serve it instantly without forcing a re-run.
// ---------------------------------------------------------------------------

let _cachedResult: RetellSetupResult | null = null;

export function getCachedRetellSetupResult(): RetellSetupResult | null {
  return _cachedResult;
}

export function setCachedRetellSetupResult(result: RetellSetupResult): void {
  _cachedResult = result;
}

// ---------------------------------------------------------------------------
// Health interpretation — turns a RetellSetupResult into a single verdict the
// admin System Health page can surface. This is the guard against a silent
// regression: if RETELL_AGENT_ID is repointed to a broken agent (wrong engine,
// missing KB tool, bad prefix, etc.) the setup result lands in a skipped/error
// state and `interpretRetellSetupHealth` flags it as "misconfigured" so an
// on-call admin sees a warning instead of the voice assistant quietly giving
// wrong/empty answers.
// ---------------------------------------------------------------------------

export type RetellHealthStatus = "healthy" | "misconfigured" | "not_configured" | "unknown";

export interface RetellHealthVerdict {
  /**
   *  - healthy        — agent is correctly wired to the KB-connected retell-llm.
   *  - misconfigured  — agent is configured but broken; needs admin attention.
   *  - not_configured — Retell credentials are absent; voice is intentionally off.
   *  - unknown        — setup has not reported a result yet (server starting).
   */
  status: RetellHealthStatus;
  /** True only when status === "healthy". */
  healthy: boolean;
  /**
   * True when the voice agent is configured but broken — the alarming state
   * that should flip the System Health banner to degraded and page the admin.
   * Deliberately false for "not_configured" (voice off, normal in dev) and
   * "unknown" (still initializing) so those don't nag.
   */
  needsAttention: boolean;
  /** Human-readable explanation drawn from the setup result's reason. */
  detail: string;
}

/**
 * The one skip reason that means "voice is intentionally off" rather than
 * "configured but broken": no API key and/or no agent id. Everything else
 * (wrong agent_ prefix, missing function secret in prod, no base URL, a
 * substantial conversation-flow that blocked the repoint, a manual re-run that
 * threw) means someone tried to wire voice up and it is NOT correctly
 * configured — that should warn.
 */
const NOT_CONFIGURED_SKIP_REASON = /RETELL_API_KEY or RETELL_AGENT_ID not configured/i;

export function interpretRetellSetupHealth(
  result: RetellSetupResult | null,
): RetellHealthVerdict {
  if (!result) {
    return {
      status: "unknown",
      healthy: false,
      needsAttention: false,
      detail: "Retell voice setup has not reported a result yet since the server started.",
    };
  }

  if (!result.skipped) {
    // Setup ran successfully. But if the Retell API forced creation of a NEW
    // agent, the live RETELL_AGENT_ID secret still points at the old (broken)
    // agent until someone updates it and republishes — treat that as broken.
    if (result.requiresAgentIdUpdate) {
      return {
        status: "misconfigured",
        healthy: false,
        needsAttention: true,
        detail: result.reason,
      };
    }
    return {
      status: "healthy",
      healthy: true,
      needsAttention: false,
      detail: result.reason,
    };
  }

  // skipped === true — distinguish "voice off" from "configured but broken".
  if (NOT_CONFIGURED_SKIP_REASON.test(result.reason)) {
    return {
      status: "not_configured",
      healthy: false,
      needsAttention: false,
      detail: result.reason,
    };
  }

  return {
    status: "misconfigured",
    healthy: false,
    needsAttention: true,
    detail: result.reason,
  };
}

/**
 * Read-only live health probe for the Retell voice agent.
 *
 * Unlike `setupRetellAgentKb`, this NEVER mutates the agent or any LLM — it only
 * retrieves the agent and its LLM and compares them against the desired KB
 * contract. It produces a `RetellSetupResult` shaped so that
 * `interpretRetellSetupHealth` yields the right verdict:
 *
 *   - healthy        — agent is on retell-llm with the KB tool + correct prompt
 *                      (returned as `skipped: false` so the interpreter reads it
 *                      as a fresh successful verdict).
 *   - not_configured — credentials absent (same skip reason as setup).
 *   - misconfigured  — bad agent_ prefix, missing prod secret, no base URL,
 *                      wrong engine, drifted KB tool/prompt, or a thrown error.
 *
 * This lets the System Health card (and an on-demand "re-check" action) refresh
 * the cached verdict without a server restart and without touching the agent.
 */
export async function probeRetellAgentHealth(): Promise<RetellSetupResult> {
  const apiKey = (process.env.RETELL_API_KEY ?? "").trim();
  const agentId = (process.env.RETELL_AGENT_ID ?? "").trim();
  const functionSecret = (process.env.RETELL_FUNCTION_SECRET ?? "").trim();
  const isProduction = process.env.NODE_ENV === "production";

  const stamp = () => new Date().toISOString();

  // --- prerequisite validation (mirror setupRetellAgentKb so the verdict for a
  // misconfigured environment matches whether it was caught at startup or here). ---

  if (!apiKey || !agentId) {
    return { skipped: true, reason: "RETELL_API_KEY or RETELL_AGENT_ID not configured", ranAt: stamp() };
  }

  if (!agentId.startsWith("agent_")) {
    return {
      skipped: true,
      reason: `RETELL_AGENT_ID must start with "agent_" (got "${agentId.slice(0, 12)}…")`,
      ranAt: stamp(),
    };
  }

  if (isProduction && !functionSecret) {
    return {
      skipped: true,
      reason:
        "RETELL_FUNCTION_SECRET is required in production — set it to the shared bearer token for /voice/kb-search",
      ranAt: stamp(),
    };
  }

  const apiBaseUrl = getApiBaseUrl();
  if (!apiBaseUrl) {
    const envHint = isProduction
      ? "set RETELL_API_BASE_URL or PORTAL_URL (REPLIT_DOMAINS was also empty)"
      : "set RETELL_API_BASE_URL or PORTAL_URL (auto-resolution is disabled in dev)";
    return {
      skipped: true,
      reason: `No API base URL configured — ${envHint}`,
      ranAt: stamp(),
    };
  }

  const kbSearchUrl = `${apiBaseUrl}/voice/kb-search`;
  const desiredPrompt = buildVoiceSystemPrompt();
  const authHeader = functionSecret ? `Bearer ${functionSecret}` : "";
  const desiredFp = toolFingerprint(kbSearchUrl, authHeader);

  try {
    const client = new Retell({ apiKey });

    // Read-only retrieve — no update/create calls anywhere in this path.
    const agent = await client.agent.retrieve(agentId);

    const responseEngine = agent.response_engine as {
      type?: string;
      llm_id?: string;
      conversation_flow_id?: string;
    } | null;

    const agentResponseEngineType = responseEngine?.type ?? "unknown";

    if (!responseEngine || responseEngine.type !== "retell-llm") {
      return {
        skipped: true,
        reason:
          `Live re-check: agent is on the "${agentResponseEngineType}" engine, not the ` +
          `KB-connected retell-llm — voice answers won't use the knowledge base. ` +
          `Restart the server to auto-repoint, or review the agent in Retell.`,
        agentResponseEngineType,
        ranAt: stamp(),
      };
    }

    const llmId = responseEngine.llm_id;
    if (!llmId) {
      return {
        skipped: true,
        reason: "Live re-check: agent response_engine has no llm_id",
        agentResponseEngineType,
        ranAt: stamp(),
      };
    }

    const currentLlm = await client.llm.retrieve(llmId);
    const existingTools = (
      (currentLlm.general_tools ?? []) as unknown as Array<Record<string, unknown>>
    );
    const existingKbTool = existingTools.find((t) => t.name === KB_SEARCH_TOOL_NAME);

    const promptMatches = currentLlm.general_prompt === desiredPrompt;
    const toolMatches =
      existingKbTool != null && existingToolFingerprint(existingKbTool) === desiredFp;

    if (promptMatches && toolMatches) {
      return {
        skipped: false,
        reason: "Live re-check: agent is on retell-llm with the KB search tool and correct prompt",
        llmId,
        kbSearchUrl,
        agentResponseEngineType,
        ranAt: stamp(),
      };
    }

    const issues: string[] = [];
    if (!toolMatches) {
      issues.push(existingKbTool == null ? "KB search tool missing" : "KB search tool config drifted");
    }
    if (!promptMatches) issues.push("voice prompt drifted");

    return {
      skipped: true,
      reason:
        `Live re-check: agent LLM ${llmId} is out of sync — ${issues.join(", ")}. ` +
        `Restart the server to re-apply the KB config, or review the agent in Retell.`,
      llmId,
      kbSearchUrl,
      agentResponseEngineType,
      ranAt: stamp(),
    };
  } catch (err) {
    const msg = (err as Error)?.message ?? String(err);
    return {
      skipped: true,
      reason: `Live re-check threw an error: ${msg}`,
      ranAt: stamp(),
    };
  }
}

export async function setupRetellAgentKb(options: SetupOptions = {}): Promise<RetellSetupResult> {
  const { forceRepoint = false } = options;
  const apiKey = (process.env.RETELL_API_KEY ?? "").trim();
  const agentId = (process.env.RETELL_AGENT_ID ?? "").trim();
  const functionSecret = (process.env.RETELL_FUNCTION_SECRET ?? "").trim();
  const isProduction = process.env.NODE_ENV === "production";

  const stamp = () => new Date().toISOString();

  // --- prerequisite validation ---

  if (!apiKey || !agentId) {
    return { skipped: true, reason: "RETELL_API_KEY or RETELL_AGENT_ID not configured", ranAt: stamp() };
  }

  if (!agentId.startsWith("agent_")) {
    return {
      skipped: true,
      reason: `RETELL_AGENT_ID must start with "agent_" (got "${agentId.slice(0, 12)}…")`,
      ranAt: stamp(),
    };
  }

  if (isProduction && !functionSecret) {
    return {
      skipped: true,
      reason:
        "RETELL_FUNCTION_SECRET is required in production — set it to the shared bearer token for /voice/kb-search",
      ranAt: stamp(),
    };
  }

  if (!functionSecret) {
    console.warn(
      "[RetellSetup] RETELL_FUNCTION_SECRET is not set — KB tool will have no Authorization header (dev only)",
    );
  }

  const apiBaseUrl = getApiBaseUrl();
  if (!apiBaseUrl) {
    const envHint = isProduction
      ? "set RETELL_API_BASE_URL or PORTAL_URL (REPLIT_DOMAINS was also empty)"
      : "set RETELL_API_BASE_URL or PORTAL_URL (auto-resolution is disabled in dev)";
    return {
      skipped: true,
      reason: `No API base URL configured — ${envHint}`,
      ranAt: stamp(),
    };
  }

  const kbSearchUrl = `${apiBaseUrl}/voice/kb-search`;

  // --- build desired state (shared by both the repoint path and the LLM patch path) ---

  const desiredPrompt = buildVoiceSystemPrompt();

  const authHeader = functionSecret ? `Bearer ${functionSecret}` : "";
  const headers: Record<string, string> = functionSecret
    ? { Authorization: authHeader }
    : {};

  const desiredTool = {
    type: "custom" as const,
    name: KB_SEARCH_TOOL_NAME,
    description:
      "Search the BTS knowledge base for answers about programs, commissions, billing, tools, strategy, coaching, curriculum, troubleshooting, refunds, cancellations, the BTS Agreement, policies, terms, and the 90-day guarantee. MUST be called before answering any BTS-specific question.",
    url: kbSearchUrl,
    method: "POST" as const,
    args_at_root: true,
    speak_during_execution: false,
    speak_after_execution: true,
    headers,
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "The member's question or search phrase — use their exact words when possible.",
        },
      },
      required: ["query"],
    },
  };

  // --- Retell API calls ---

  const client = new Retell({ apiKey });

  const agent = await client.agent.retrieve(agentId);

  const responseEngine = agent.response_engine as {
    type?: string;
    llm_id?: string;
    conversation_flow_id?: string;
  } | null;

  const agentResponseEngineType = responseEngine?.type ?? "unknown";

  // ---------------------------------------------------------------------------
  // Non-LLM engine path: assess Conversation Flow then repoint if safe.
  //
  // Safety gate: retrieve the flow and assess for substantial custom routing.
  // If complex, surface findings and stop — a human must decide before we
  // replace the engine. If simple (greet + Q&A), create or reuse a Retell LLM
  // and repoint the agent.
  //
  // Idempotency: once repointed, subsequent runs see response_engine.type ===
  // "retell-llm" and fall through to the normal LLM patch path below.
  // ---------------------------------------------------------------------------

  if (!responseEngine || responseEngine.type !== "retell-llm") {
    console.log(
      `[RetellSetup] Agent is on "${agentResponseEngineType}" engine — assessing before repoint.`,
    );

    // Step 1: assess conversation flow complexity
    const conversationFlowId = responseEngine?.conversation_flow_id;
    let flowAssessment: ReturnType<typeof assessConversationFlowComplexity> = {
      substantial: false,
      summary: "No conversation_flow_id on response_engine — assuming simple (no flow to inspect).",
      nodeCount: 0,
      substantialTypes: [],
    };

    if (conversationFlowId) {
      try {
        const flow = await (client as unknown as {
          conversationFlow: {
            retrieve: (id: string) => Promise<{ nodes?: Array<{ type?: string }> | null }>;
          };
        }).conversationFlow.retrieve(conversationFlowId);

        flowAssessment = assessConversationFlowComplexity(flow as {
          nodes?: Array<{ type?: string; [key: string]: unknown }> | null;
        });
      } catch (err) {
        const msg = (err as Error)?.message ?? String(err);
        console.warn(`[RetellSetup] Could not retrieve conversation flow ${conversationFlowId}: ${msg}`);
        flowAssessment = {
          substantial: true,
          summary: `Could not retrieve conversation flow (${msg}) — refusing to auto-replace to stay safe.`,
          nodeCount: 0,
          substantialTypes: [],
        };
      }
    }

    console.log(`[RetellSetup] Flow assessment: ${flowAssessment.summary}`);

    if (flowAssessment.substantial) {
      if (!forceRepoint) {
        return {
          skipped: true,
          reason: `Agent is on "${agentResponseEngineType}" engine with substantial Conversation Flow logic — manual review required before auto-repoint. ${flowAssessment.summary}`,
          agentResponseEngineType,
          conversationFlowAssessment: flowAssessment.summary,
          ranAt: stamp(),
        };
      }
      // forceRepoint=true — override the gate and proceed.
      // The assessment is logged for traceability so the intent is auditable.
      console.log(
        `[RetellSetup] forceRepoint=true — overriding substantial-flow gate and repointing. Previous engine: "${agentResponseEngineType}". Flow: ${flowAssessment.summary}`,
      );
    }

    // Step 2: find or create a Retell LLM with the desired KB config.
    //
    // We list existing LLMs and look for one that already has our kb-search
    // tool URL — avoids creating orphan duplicates on interrupted reruns.

    const desiredFp = toolFingerprint(kbSearchUrl, authHeader);
    let targetLlmId: string | null = null;
    let existingLlmNeedsUpdate = false;

    try {
      const allLlms = await client.llm.list();
      const llmList = (Array.isArray(allLlms) ? allLlms : []) as Array<{
        llm_id: string;
        general_prompt?: string | null;
        general_tools?: unknown[] | null;
      }>;

      for (const llm of llmList) {
        const tools = (llm.general_tools ?? []) as Array<Record<string, unknown>>;
        // Match on BOTH name AND exact KB URL so we never reuse an unrelated
        // LLM that happens to have a same-named tool pointed at a different
        // environment or agent.
        const kbTool = tools.find(
          (t) => t.name === KB_SEARCH_TOOL_NAME && t.url === kbSearchUrl,
        );
        if (kbTool) {
          targetLlmId = llm.llm_id;
          const promptMatches = llm.general_prompt === desiredPrompt;
          const toolMatches = existingToolFingerprint(kbTool) === desiredFp;
          existingLlmNeedsUpdate = !promptMatches || !toolMatches;
          break;
        }
      }
    } catch (err) {
      console.warn("[RetellSetup] Could not list LLMs — will create a new one.", err);
    }

    if (targetLlmId && existingLlmNeedsUpdate) {
      // Reuse the existing LLM but update it to match desired state.
      const existingLlm = await client.llm.retrieve(targetLlmId);
      const existingTools = ((existingLlm.general_tools ?? []) as unknown as Array<Record<string, unknown>>);
      const otherTools = existingTools.filter((t) => t.name !== KB_SEARCH_TOOL_NAME);
      await client.llm.update(targetLlmId, {
        general_prompt: desiredPrompt,
        general_tools: [desiredTool, ...otherTools] as Parameters<typeof client.llm.update>[1]["general_tools"],
      });
      console.log(`[RetellSetup] Updated existing LLM ${targetLlmId} with latest KB tool + prompt.`);
    } else if (!targetLlmId) {
      // No matching LLM found — create a new one.
      const newLlm = await client.llm.create({
        general_prompt: desiredPrompt,
        general_tools: [desiredTool] as Parameters<typeof client.llm.create>[0]["general_tools"],
      });
      targetLlmId = (newLlm as unknown as { llm_id: string }).llm_id;
      console.log(`[RetellSetup] Created new Retell LLM ${targetLlmId}.`);
    }

    // Step 3: repoint the agent to the LLM.
    //
    // The Retell API blocks changing response_engine.type via agent.update
    // (400 "Cannot update response engine to different response engine type").
    // When that happens we fall back to creating a new agent that clones the
    // key voice/behavior settings from the original and uses the retell-llm
    // engine.  The new agent_id is returned so the caller can update
    // RETELL_AGENT_ID.
    try {
      await client.agent.update(agentId, {
        response_engine: {
          type: "retell-llm",
          llm_id: targetLlmId!,
        } as Parameters<typeof client.agent.update>[1]["response_engine"],
      });

      console.log(
        `[RetellSetup] Repointed agent ${agentId} from "${agentResponseEngineType}" to Retell LLM ${targetLlmId}.`,
      );

      return {
        skipped: false,
        reason: `Created/reused Retell LLM ${targetLlmId} and repointed agent from "${agentResponseEngineType}" engine — KB tool and prompt configured`,
        llmId: targetLlmId!,
        kbSearchUrl,
        agentResponseEngineType,
        repointed: true,
        conversationFlowAssessment: flowAssessment.summary,
        ranAt: stamp(),
      };
    } catch (updateErr) {
      const errMsg = (updateErr as Error)?.message ?? String(updateErr);
      const isEngineTypeErr = /different response engine type/i.test(errMsg);

      if (!isEngineTypeErr) {
        // Not the engine-type constraint — propagate so the caller sees it.
        throw updateErr;
      }

      // Retell API blocked engine-type change in place.
      // Create a new agent, cloning key voice/behavior settings from the
      // existing one, then point it at the KB LLM.
      console.warn(
        `[RetellSetup] agent.update blocked engine-type change (${errMsg}). Creating a new agent instead.`,
      );

      const existingAgent = agent as unknown as {
        voice_id?: string;
        agent_name?: string | null;
        language?: string | null;
        interruption_sensitivity?: number | null;
        ambient_sound?: string | null;
        enable_backchannel?: boolean;
      };

      const newAgentBody: Record<string, unknown> = {
        response_engine: { type: "retell-llm", llm_id: targetLlmId! },
        // voice_id is required for create; fall back to a known-good default
        // if the original value is missing (shouldn't happen in practice).
        voice_id: existingAgent.voice_id ?? "retell-Cimo",
      };
      if (existingAgent.agent_name) newAgentBody.agent_name = existingAgent.agent_name;
      if (existingAgent.language) newAgentBody.language = existingAgent.language;
      if (existingAgent.interruption_sensitivity != null) {
        newAgentBody.interruption_sensitivity = existingAgent.interruption_sensitivity;
      }
      if (existingAgent.ambient_sound) newAgentBody.ambient_sound = existingAgent.ambient_sound;
      if (existingAgent.enable_backchannel != null) {
        newAgentBody.enable_backchannel = existingAgent.enable_backchannel;
      }

      const newAgent = await (client.agent.create as unknown as (
        body: Record<string, unknown>,
      ) => Promise<{ agent_id: string }>)(newAgentBody);
      const newAgentId = newAgent.agent_id;

      console.log(
        `[RetellSetup] Created new agent ${newAgentId} with retell-llm engine. ` +
        `Update RETELL_AGENT_ID from "${agentId}" to "${newAgentId}" and republish to activate.`,
      );

      return {
        skipped: false,
        reason:
          `Retell API blocked in-place engine-type change — created new agent ${newAgentId} ` +
          `with retell-llm engine + KB tool. ` +
          `⚠️ Update RETELL_AGENT_ID to "${newAgentId}" and republish to activate.`,
        llmId: targetLlmId!,
        kbSearchUrl,
        agentResponseEngineType,
        repointed: false,
        newAgentId,
        requiresAgentIdUpdate: true,
        conversationFlowAssessment: flowAssessment.summary,
        ranAt: stamp(),
      };
    }
  }

  // ---------------------------------------------------------------------------
  // Agent is already on retell-llm — patch the existing LLM if needed.
  // ---------------------------------------------------------------------------

  const llmId = responseEngine.llm_id;
  if (!llmId) {
    return { skipped: true, reason: "Could not find llm_id on agent response_engine", agentResponseEngineType, ranAt: stamp() };
  }

  const currentLlm = await client.llm.retrieve(llmId);

  // --- full-contract idempotency check ---
  // Compare prompt AND the complete tool fingerprint (URL + method + auth
  // header + args_at_root + parameter schema).  URL-only comparison would
  // miss a rotated RETELL_FUNCTION_SECRET and leave a stale auth header.

  const existingTools = (
    (currentLlm.general_tools ?? []) as unknown as Array<Record<string, unknown>>
  );
  const existingKbTool = existingTools.find((t) => t.name === KB_SEARCH_TOOL_NAME);

  const promptMatches = currentLlm.general_prompt === desiredPrompt;
  const desiredFp = toolFingerprint(kbSearchUrl, authHeader);
  const toolMatches =
    existingKbTool != null && existingToolFingerprint(existingKbTool) === desiredFp;

  if (promptMatches && toolMatches) {
    return {
      skipped: true,
      reason: "LLM already has the KB search tool and correct prompt — no update needed",
      llmId,
      kbSearchUrl,
      agentResponseEngineType,
      ranAt: stamp(),
    };
  }

  const otherTools = existingTools.filter((t) => t.name !== KB_SEARCH_TOOL_NAME);
  const updatedTools = [desiredTool, ...otherTools];

  await client.llm.update(llmId, {
    general_prompt: desiredPrompt,
    general_tools: updatedTools as Parameters<typeof client.llm.update>[1]["general_tools"],
  });

  return {
    skipped: false,
    reason: `Updated LLM ${llmId} — prompt_changed=${!promptMatches} tool_changed=${!toolMatches}`,
    llmId,
    kbSearchUrl,
    agentResponseEngineType,
    ranAt: stamp(),
  };
}
