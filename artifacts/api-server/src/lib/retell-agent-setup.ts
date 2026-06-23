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

KNOWLEDGE BASE RULE — MANDATORY:
For ANY question about BTS programs, commissions, billing, tools, strategy, coaching, curriculum, or troubleshooting you MUST call the search_knowledge_base tool BEFORE answering. Answer strictly from the content the tool returns. If the tool returns no relevant information, say so and offer to connect the member to support instead of guessing.

Do NOT invent, guess, or extrapolate answers for BTS-specific topics.

MEMBER CONTEXT:
Member name: {{member_name}}
Membership level: {{membership_level}}

BTS KEY TOOLS: Flexy, DIYTrax, MetricMover, ScrapeBot, CropBot, Gifster, PixelPress, Anstrex, Media Mavens.
COACHING TEAM: Sasha, Bruce, Michael, Todd (group calls), Robin (1-on-1 sessions).
SUPPORT EMAIL: support@buildtestscale.com

FALLBACK:
If asked something unrelated to BTS, briefly acknowledge and redirect to BTS support topics. For unresolved BTS issues, direct to support@buildtestscale.com.`;
}

/**
 * Build a canonical fingerprint of the desired KB tool contract.
 * Comparing fingerprints covers: URL, method, bearer auth, args_at_root,
 * and parameter schema — so a secret rotation triggers a fresh update.
 */
function toolFingerprint(url: string, authHeader: string): string {
  return JSON.stringify({
    name: KB_SEARCH_TOOL_NAME,
    url,
    method: "POST",
    auth: authHeader,
    args_at_root: true,
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
  ranAt: string;
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

export async function setupRetellAgentKb(): Promise<RetellSetupResult> {
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
      "Search the BTS knowledge base for answers about programs, commissions, billing, tools, strategy, coaching, curriculum, and troubleshooting. MUST be called before answering any BTS-specific question.",
    url: kbSearchUrl,
    method: "POST" as const,
    args_at_root: true,
    speak_during_execution: true,
    execution_message_description: "Let me look that up for you in a moment.",
    execution_message_type: "static_text" as const,
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
      return {
        skipped: true,
        reason: `Agent is on "${agentResponseEngineType}" engine with substantial Conversation Flow logic — manual review required before auto-repoint. ${flowAssessment.summary}`,
        agentResponseEngineType,
        conversationFlowAssessment: flowAssessment.summary,
        ranAt: stamp(),
      };
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
