/**
 * Idempotent setup for the Retell voice agent's knowledge-base integration.
 *
 * Called at server startup and optionally from an admin API endpoint. It:
 *   1. Validates required env vars (RETELL_FUNCTION_SECRET required in prod).
 *   2. Retrieves the agent identified by RETELL_AGENT_ID.
 *   3. Finds the Retell LLM attached to that agent.
 *   4. Patches the LLM with a `search_knowledge_base` custom tool and a
 *      system prompt that forces KB lookup before every BTS-specific answer.
 *   5. Skips the patch only when the FULL tool contract (URL, method, auth
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

export interface RetellSetupResult {
  skipped: boolean;
  reason: string;
  llmId?: string;
  kbSearchUrl?: string;
  agentResponseEngineType?: string;
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

  // --- Retell API calls ---

  const client = new Retell({ apiKey });

  const agent = await client.agent.retrieve(agentId);

  const responseEngine = agent.response_engine as {
    type?: string;
    llm_id?: string;
  } | null;

  const agentResponseEngineType = responseEngine?.type ?? "unknown";

  if (!responseEngine || responseEngine.type !== "retell-llm") {
    return {
      skipped: true,
      reason: `Agent response_engine type is "${agentResponseEngineType}" — the agent must use a Retell LLM (retell-llm), not a conversation-flow or other engine type. Change the agent type in the Retell dashboard to enable KB wiring.`,
      agentResponseEngineType,
      ranAt: stamp(),
    };
  }

  const llmId = responseEngine.llm_id;
  if (!llmId) {
    return { skipped: true, reason: "Could not find llm_id on agent response_engine", agentResponseEngineType, ranAt: stamp() };
  }

  const currentLlm = await client.llm.retrieve(llmId);

  // --- build desired state ---

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
