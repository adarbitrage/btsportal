/**
 * Tests for retell-agent-setup.ts
 *
 * Covers:
 * - Production base-URL auto-resolution (REPLIT_DOMAINS fallback)
 * - All loud-skip paths (missing keys, wrong id prefix, missing secret in prod,
 *   no base URL)
 * - Module-level cache (get/set)
 * - Idempotency check (no update when prompt+tool already match)
 * - Full patch path (update when mismatch)
 * - Non-LLM agent (simple conversation-flow): creates/reuses LLM + repoints
 * - Non-LLM agent (substantial conversation-flow): stops and surfaces findings
 * - LLM reuse: finds existing LLM by KB tool URL instead of creating new one
 * - Idempotency after repoint: second run sees retell-llm and just patches LLM
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// We'll snapshot and restore env in each test.
const originalEnv = { ...process.env };

beforeEach(() => {
  process.env = { ...originalEnv };
  vi.resetModules();
});

afterEach(() => {
  process.env = { ...originalEnv };
  vi.resetModules();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRetellClient(overrides: {
  agentType?: string;
  llmId?: string;
  conversationFlowId?: string;
  conversationFlowNodes?: Array<{ type: string }>;
  conversationFlowError?: string;
  currentPrompt?: string;
  currentTools?: unknown[];
  createdLlmId?: string;
  existingLlms?: Array<{ llm_id: string; general_prompt?: string; general_tools?: unknown[] }>;
} = {}) {
  const {
    agentType = "retell-llm",
    llmId = "llm_test123",
    conversationFlowId,
    conversationFlowNodes = [],
    conversationFlowError,
    currentPrompt = "old prompt",
    currentTools = [],
    createdLlmId = "llm_new456",
    existingLlms = [],
  } = overrides;

  const agentRetrieveResult: Record<string, unknown> = {
    response_engine: { type: agentType, ...(llmId ? { llm_id: llmId } : {}), ...(conversationFlowId ? { conversation_flow_id: conversationFlowId } : {}) },
  };

  const conversationFlowRetrieve = conversationFlowError
    ? vi.fn().mockRejectedValue(new Error(conversationFlowError))
    : vi.fn().mockResolvedValue({ nodes: conversationFlowNodes });

  return {
    agent: {
      retrieve: vi.fn().mockResolvedValue(agentRetrieveResult),
      update: vi.fn().mockResolvedValue({}),
    },
    llm: {
      retrieve: vi.fn().mockResolvedValue({
        general_prompt: currentPrompt,
        general_tools: currentTools,
      }),
      update: vi.fn().mockResolvedValue({}),
      create: vi.fn().mockResolvedValue({ llm_id: createdLlmId }),
      list: vi.fn().mockResolvedValue(existingLlms),
    },
    conversationFlow: {
      retrieve: conversationFlowRetrieve,
    },
  };
}

// ---------------------------------------------------------------------------
// Cache tests (pure, no Retell calls needed)
// ---------------------------------------------------------------------------

describe("getCachedRetellSetupResult / setCachedRetellSetupResult", () => {
  it("returns null before any result is cached", async () => {
    const { getCachedRetellSetupResult } = await import("../lib/retell-agent-setup");
    expect(getCachedRetellSetupResult()).toBeNull();
  });

  it("returns the cached result after set", async () => {
    const { getCachedRetellSetupResult, setCachedRetellSetupResult } = await import("../lib/retell-agent-setup");
    const sample = { skipped: true, reason: "test", ranAt: new Date().toISOString() };
    setCachedRetellSetupResult(sample);
    expect(getCachedRetellSetupResult()).toEqual(sample);
  });
});

// ---------------------------------------------------------------------------
// Skip paths
// ---------------------------------------------------------------------------

describe("setupRetellAgentKb — skip paths", () => {
  it("skips when RETELL_API_KEY is missing", async () => {
    process.env.RETELL_API_KEY = "";
    process.env.RETELL_AGENT_ID = "agent_abc";
    const { setupRetellAgentKb } = await import("../lib/retell-agent-setup");
    const result = await setupRetellAgentKb();
    expect(result.skipped).toBe(true);
    expect(result.reason).toMatch(/RETELL_API_KEY/);
  });

  it("skips when RETELL_AGENT_ID is missing", async () => {
    process.env.RETELL_API_KEY = "key_test";
    process.env.RETELL_AGENT_ID = "";
    const { setupRetellAgentKb } = await import("../lib/retell-agent-setup");
    const result = await setupRetellAgentKb();
    expect(result.skipped).toBe(true);
    expect(result.reason).toMatch(/RETELL_AGENT_ID/);
  });

  it("skips when RETELL_AGENT_ID lacks the agent_ prefix", async () => {
    process.env.RETELL_API_KEY = "key_test";
    process.env.RETELL_AGENT_ID = "noprefix_abc";
    const { setupRetellAgentKb } = await import("../lib/retell-agent-setup");
    const result = await setupRetellAgentKb();
    expect(result.skipped).toBe(true);
    expect(result.reason).toMatch(/agent_/);
  });

  it("skips in production when RETELL_FUNCTION_SECRET is missing", async () => {
    process.env.NODE_ENV = "production";
    process.env.RETELL_API_KEY = "key_test";
    process.env.RETELL_AGENT_ID = "agent_abc";
    process.env.RETELL_FUNCTION_SECRET = "";
    const { setupRetellAgentKb } = await import("../lib/retell-agent-setup");
    const result = await setupRetellAgentKb();
    expect(result.skipped).toBe(true);
    expect(result.reason).toMatch(/RETELL_FUNCTION_SECRET/);
  });

  it("skips in dev when no base URL is configured and REPLIT_DOMAINS is set (auto-derive disabled in dev)", async () => {
    process.env.NODE_ENV = "development";
    process.env.RETELL_API_KEY = "key_test";
    process.env.RETELL_AGENT_ID = "agent_abc";
    process.env.RETELL_FUNCTION_SECRET = "secret";
    delete process.env.RETELL_API_BASE_URL;
    delete process.env.PORTAL_URL;
    process.env.REPLIT_DOMAINS = "my-app.replit.app";
    const { setupRetellAgentKb } = await import("../lib/retell-agent-setup");
    const result = await setupRetellAgentKb();
    expect(result.skipped).toBe(true);
    expect(result.reason).toMatch(/auto-resolution is disabled in dev/);
  });

  it("skips when no base URL is available (no REPLIT_DOMAINS in prod either)", async () => {
    process.env.NODE_ENV = "production";
    process.env.RETELL_API_KEY = "key_test";
    process.env.RETELL_AGENT_ID = "agent_abc";
    process.env.RETELL_FUNCTION_SECRET = "secret";
    delete process.env.RETELL_API_BASE_URL;
    delete process.env.PORTAL_URL;
    process.env.REPLIT_DOMAINS = "";
    const { setupRetellAgentKb } = await import("../lib/retell-agent-setup");
    const result = await setupRetellAgentKb();
    expect(result.skipped).toBe(true);
    expect(result.reason).toMatch(/REPLIT_DOMAINS was also empty/);
  });
});

// ---------------------------------------------------------------------------
// Production base-URL auto-resolution via REPLIT_DOMAINS
// ---------------------------------------------------------------------------

describe("setupRetellAgentKb — production REPLIT_DOMAINS auto-resolution", () => {
  it("derives the kb-search URL from the first REPLIT_DOMAINS entry in production", async () => {
    process.env.NODE_ENV = "production";
    process.env.RETELL_API_KEY = "key_prod";
    process.env.RETELL_AGENT_ID = "agent_prod123";
    process.env.RETELL_FUNCTION_SECRET = "s3cr3t";
    delete process.env.RETELL_API_BASE_URL;
    delete process.env.PORTAL_URL;
    process.env.REPLIT_DOMAINS = "my-portal.replit.app,secondary.replit.app";

    const mockClient = makeRetellClient();

    vi.doMock("retell-sdk", () => ({
      default: vi.fn(() => mockClient),
    }));

    const { setupRetellAgentKb } = await import("../lib/retell-agent-setup");
    const result = await setupRetellAgentKb();

    expect(result.skipped).toBe(false);
    expect(result.kbSearchUrl).toBe("https://my-portal.replit.app/api/voice/kb-search");
  });

  it("uses RETELL_API_BASE_URL over REPLIT_DOMAINS when both are set", async () => {
    process.env.NODE_ENV = "production";
    process.env.RETELL_API_KEY = "key_prod";
    process.env.RETELL_AGENT_ID = "agent_prod123";
    process.env.RETELL_FUNCTION_SECRET = "s3cr3t";
    process.env.RETELL_API_BASE_URL = "https://explicit.example.com/api";
    process.env.REPLIT_DOMAINS = "should-not-be-used.replit.app";

    const mockClient = makeRetellClient();

    vi.doMock("retell-sdk", () => ({
      default: vi.fn(() => mockClient),
    }));

    const { setupRetellAgentKb } = await import("../lib/retell-agent-setup");
    const result = await setupRetellAgentKb();

    expect(result.kbSearchUrl).toBe("https://explicit.example.com/api/voice/kb-search");
  });

  it("uses PORTAL_URL over REPLIT_DOMAINS when PORTAL_URL is set", async () => {
    process.env.NODE_ENV = "production";
    process.env.RETELL_API_KEY = "key_prod";
    process.env.RETELL_AGENT_ID = "agent_prod123";
    process.env.RETELL_FUNCTION_SECRET = "s3cr3t";
    delete process.env.RETELL_API_BASE_URL;
    process.env.PORTAL_URL = "https://portal.buildtestscale.com";
    process.env.REPLIT_DOMAINS = "should-not-be-used.replit.app";

    const mockClient = makeRetellClient();

    vi.doMock("retell-sdk", () => ({
      default: vi.fn(() => mockClient),
    }));

    const { setupRetellAgentKb } = await import("../lib/retell-agent-setup");
    const result = await setupRetellAgentKb();

    expect(result.kbSearchUrl).toBe("https://portal.buildtestscale.com/api/voice/kb-search");
  });
});

// ---------------------------------------------------------------------------
// Non-LLM agent: conversation flow complexity gate
// ---------------------------------------------------------------------------

describe("setupRetellAgentKb — conversation flow complexity gate", () => {
  it("stops with a clear message when the flow has transfer_call nodes", async () => {
    process.env.NODE_ENV = "development";
    process.env.RETELL_API_KEY = "key_test";
    process.env.RETELL_AGENT_ID = "agent_abc";
    process.env.RETELL_FUNCTION_SECRET = "";
    process.env.RETELL_API_BASE_URL = "https://api.example.com";

    const mockClient = makeRetellClient({
      agentType: "conversation_flow",
      llmId: undefined as any,
      conversationFlowId: "cf_complex",
      conversationFlowNodes: [
        { type: "conversation" },
        { type: "transfer_call" },
      ],
    });

    vi.doMock("retell-sdk", () => ({
      default: vi.fn(() => mockClient),
    }));

    const { setupRetellAgentKb } = await import("../lib/retell-agent-setup");
    const result = await setupRetellAgentKb();

    expect(result.skipped).toBe(true);
    expect(result.reason).toMatch(/substantial/i);
    expect(result.reason).toMatch(/manual review/i);
    expect(result.conversationFlowAssessment).toMatch(/transfer_call/);
    expect(mockClient.llm.create).not.toHaveBeenCalled();
    expect(mockClient.agent.update).not.toHaveBeenCalled();
  });

  it("stops when the flow has branch nodes (conditional routing)", async () => {
    process.env.NODE_ENV = "development";
    process.env.RETELL_API_KEY = "key_test";
    process.env.RETELL_AGENT_ID = "agent_abc";
    process.env.RETELL_FUNCTION_SECRET = "";
    process.env.RETELL_API_BASE_URL = "https://api.example.com";

    const mockClient = makeRetellClient({
      agentType: "conversation_flow",
      llmId: undefined as any,
      conversationFlowId: "cf_branch",
      conversationFlowNodes: [
        { type: "conversation" },
        { type: "branch" },
        { type: "conversation" },
      ],
    });

    vi.doMock("retell-sdk", () => ({
      default: vi.fn(() => mockClient),
    }));

    const { setupRetellAgentKb } = await import("../lib/retell-agent-setup");
    const result = await setupRetellAgentKb();

    expect(result.skipped).toBe(true);
    expect(result.conversationFlowAssessment).toMatch(/branch/);
    expect(mockClient.agent.update).not.toHaveBeenCalled();
  });

  it("stops when the flow has too many nodes (≥ 4 threshold)", async () => {
    process.env.NODE_ENV = "development";
    process.env.RETELL_API_KEY = "key_test";
    process.env.RETELL_AGENT_ID = "agent_abc";
    process.env.RETELL_FUNCTION_SECRET = "";
    process.env.RETELL_API_BASE_URL = "https://api.example.com";

    const mockClient = makeRetellClient({
      agentType: "conversation_flow",
      llmId: undefined as any,
      conversationFlowId: "cf_many",
      conversationFlowNodes: [
        { type: "conversation" },
        { type: "conversation" },
        { type: "conversation" },
        { type: "conversation" },
      ],
    });

    vi.doMock("retell-sdk", () => ({
      default: vi.fn(() => mockClient),
    }));

    const { setupRetellAgentKb } = await import("../lib/retell-agent-setup");
    const result = await setupRetellAgentKb();

    expect(result.skipped).toBe(true);
    expect(result.conversationFlowAssessment).toMatch(/threshold/);
    expect(mockClient.agent.update).not.toHaveBeenCalled();
  });

  it("stops and surfaces findings when conversation flow retrieval fails (fail-closed)", async () => {
    process.env.NODE_ENV = "development";
    process.env.RETELL_API_KEY = "key_test";
    process.env.RETELL_AGENT_ID = "agent_abc";
    process.env.RETELL_FUNCTION_SECRET = "";
    process.env.RETELL_API_BASE_URL = "https://api.example.com";

    const mockClient = makeRetellClient({
      agentType: "conversation_flow",
      llmId: undefined as any,
      conversationFlowId: "cf_unreachable",
      conversationFlowError: "API timeout",
    });

    vi.doMock("retell-sdk", () => ({
      default: vi.fn(() => mockClient),
    }));

    const { setupRetellAgentKb } = await import("../lib/retell-agent-setup");
    const result = await setupRetellAgentKb();

    expect(result.skipped).toBe(true);
    expect(result.conversationFlowAssessment).toMatch(/API timeout/);
    expect(result.reason).toMatch(/manual review/i);
    expect(mockClient.agent.update).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Non-LLM agent: repoint after simple flow assessment
// ---------------------------------------------------------------------------

describe("setupRetellAgentKb — non-LLM agent repoint (simple flow)", () => {
  it("creates a Retell LLM and repoints the agent when flow is simple (no flow ID)", async () => {
    process.env.NODE_ENV = "development";
    process.env.RETELL_API_KEY = "key_test";
    process.env.RETELL_AGENT_ID = "agent_abc";
    process.env.RETELL_FUNCTION_SECRET = "";
    process.env.RETELL_API_BASE_URL = "https://api.example.com";

    const mockClient = makeRetellClient({
      agentType: "conversation_flow",
      llmId: undefined as any,
      createdLlmId: "llm_new456",
    });

    vi.doMock("retell-sdk", () => ({
      default: vi.fn(() => mockClient),
    }));

    const { setupRetellAgentKb } = await import("../lib/retell-agent-setup");
    const result = await setupRetellAgentKb();

    expect(result.skipped).toBe(false);
    expect(result.repointed).toBe(true);
    expect(result.llmId).toBe("llm_new456");
    expect(result.agentResponseEngineType).toBe("conversation_flow");
    expect(result.reason).toMatch(/conversation_flow/);
    expect(result.reason).toMatch(/llm_new456/);

    expect(mockClient.llm.create).toHaveBeenCalledOnce();
    const createCall = mockClient.llm.create.mock.calls[0][0];
    expect(typeof createCall.general_prompt).toBe("string");
    expect(createCall.general_prompt).toContain("search_knowledge_base");
    expect(Array.isArray(createCall.general_tools)).toBe(true);
    expect(createCall.general_tools[0].name).toBe("search_knowledge_base");

    expect(mockClient.agent.update).toHaveBeenCalledOnce();
    const agentUpdateCall = mockClient.agent.update.mock.calls[0];
    expect(agentUpdateCall[0]).toBe("agent_abc");
    expect(agentUpdateCall[1].response_engine).toMatchObject({
      type: "retell-llm",
      llm_id: "llm_new456",
    });

    expect(mockClient.llm.update).not.toHaveBeenCalled();
  });

  it("creates an LLM and repoints when flow has < 4 simple nodes and no special types", async () => {
    process.env.NODE_ENV = "development";
    process.env.RETELL_API_KEY = "key_test";
    process.env.RETELL_AGENT_ID = "agent_abc";
    process.env.RETELL_FUNCTION_SECRET = "my-secret";
    process.env.RETELL_API_BASE_URL = "https://api.example.com";

    const mockClient = makeRetellClient({
      agentType: "conversation_flow",
      llmId: undefined as any,
      conversationFlowId: "cf_simple",
      conversationFlowNodes: [{ type: "conversation" }, { type: "end" }],
      createdLlmId: "llm_simple789",
    });

    vi.doMock("retell-sdk", () => ({
      default: vi.fn(() => mockClient),
    }));

    const { setupRetellAgentKb } = await import("../lib/retell-agent-setup");
    const result = await setupRetellAgentKb();

    expect(result.skipped).toBe(false);
    expect(result.repointed).toBe(true);
    expect(result.llmId).toBe("llm_simple789");
    expect(result.conversationFlowAssessment).toMatch(/safe to auto-replace/);
    expect(mockClient.conversationFlow.retrieve).toHaveBeenCalledWith("cf_simple");
    expect(mockClient.llm.create).toHaveBeenCalledOnce();
    expect(mockClient.agent.update).toHaveBeenCalledOnce();
  });

  it("sets the correct kb-search URL and auth header on the created LLM tool", async () => {
    process.env.NODE_ENV = "development";
    process.env.RETELL_API_KEY = "key_test";
    process.env.RETELL_AGENT_ID = "agent_abc";
    process.env.RETELL_FUNCTION_SECRET = "my-secret";
    process.env.RETELL_API_BASE_URL = "https://api.example.com";

    const mockClient = makeRetellClient({
      agentType: "conversation_flow",
      llmId: undefined as any,
      createdLlmId: "llm_new789",
    });

    vi.doMock("retell-sdk", () => ({
      default: vi.fn(() => mockClient),
    }));

    const { setupRetellAgentKb } = await import("../lib/retell-agent-setup");
    const result = await setupRetellAgentKb();

    expect(result.kbSearchUrl).toBe("https://api.example.com/voice/kb-search");

    const createCall = mockClient.llm.create.mock.calls[0][0];
    const kbTool = createCall.general_tools[0];
    expect(kbTool.url).toBe("https://api.example.com/voice/kb-search");
    expect(kbTool.headers?.Authorization).toBe("Bearer my-secret");
  });
});

// ---------------------------------------------------------------------------
// LLM reuse: find existing LLM by KB tool presence
// ---------------------------------------------------------------------------

describe("setupRetellAgentKb — LLM reuse (non-LLM agent)", () => {
  it("reuses an existing LLM with matching fingerprint instead of creating new one", async () => {
    process.env.NODE_ENV = "development";
    process.env.RETELL_API_KEY = "key_test";
    process.env.RETELL_AGENT_ID = "agent_abc";
    process.env.RETELL_FUNCTION_SECRET = "my-secret";
    process.env.RETELL_API_BASE_URL = "https://api.example.com";

    // We need to simulate an existing LLM that already has the correct fingerprint.
    // To do that we must know the exact desired tool shape. We build it here to match.
    const kbUrl = "https://api.example.com/voice/kb-search";
    const existingLlms = [
      {
        llm_id: "llm_existing999",
        general_prompt: "old prompt", // mismatched prompt → needs update
        general_tools: [
          {
            type: "custom",
            name: "search_knowledge_base",
            url: kbUrl,
            method: "POST",
            args_at_root: true,
            headers: { Authorization: "Bearer my-secret" },
            parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
          },
        ],
      },
    ];

    const mockClient = makeRetellClient({
      agentType: "conversation_flow",
      llmId: undefined as any,
      createdLlmId: "llm_should_not_be_created",
      existingLlms,
      currentPrompt: "old prompt",
      currentTools: existingLlms[0].general_tools,
    });
    // Make llm.retrieve return the existing LLM's data
    mockClient.llm.retrieve.mockResolvedValue({
      general_prompt: "old prompt",
      general_tools: existingLlms[0].general_tools,
    });

    vi.doMock("retell-sdk", () => ({
      default: vi.fn(() => mockClient),
    }));

    const { setupRetellAgentKb } = await import("../lib/retell-agent-setup");
    const result = await setupRetellAgentKb();

    expect(result.skipped).toBe(false);
    expect(result.repointed).toBe(true);
    expect(result.llmId).toBe("llm_existing999");

    // Must NOT have created a new LLM
    expect(mockClient.llm.create).not.toHaveBeenCalled();
    // Must have updated the existing LLM (prompt mismatch)
    expect(mockClient.llm.update).toHaveBeenCalledOnce();
    expect(mockClient.llm.update.mock.calls[0][0]).toBe("llm_existing999");
    // Must have repointed agent to the reused LLM
    expect(mockClient.agent.update).toHaveBeenCalledOnce();
    expect(mockClient.agent.update.mock.calls[0][1].response_engine).toMatchObject({
      type: "retell-llm",
      llm_id: "llm_existing999",
    });
  });

  it("ignores LLMs with search_knowledge_base pointed at a different URL and creates a new one", async () => {
    process.env.NODE_ENV = "development";
    process.env.RETELL_API_KEY = "key_test";
    process.env.RETELL_AGENT_ID = "agent_abc";
    process.env.RETELL_FUNCTION_SECRET = "my-secret";
    process.env.RETELL_API_BASE_URL = "https://api.example.com";

    // LLM with same tool name but different URL (another environment/agent)
    const unrelatedLlms = [
      {
        llm_id: "llm_other_env",
        general_prompt: "some prompt",
        general_tools: [
          {
            type: "custom",
            name: "search_knowledge_base",
            url: "https://different-env.example.com/api/voice/kb-search",
            method: "POST",
            args_at_root: true,
            headers: { Authorization: "Bearer my-secret" },
            parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
          },
        ],
      },
    ];

    const mockClient = makeRetellClient({
      agentType: "conversation_flow",
      llmId: undefined as any,
      createdLlmId: "llm_newly_created",
      existingLlms: unrelatedLlms,
    });

    vi.doMock("retell-sdk", () => ({
      default: vi.fn(() => mockClient),
    }));

    const { setupRetellAgentKb } = await import("../lib/retell-agent-setup");
    const result = await setupRetellAgentKb();

    expect(result.skipped).toBe(false);
    expect(result.repointed).toBe(true);
    expect(result.llmId).toBe("llm_newly_created");

    // Must NOT have reused the unrelated LLM
    expect(mockClient.llm.create).toHaveBeenCalledOnce();
    expect(mockClient.llm.update).not.toHaveBeenCalled();
    // Unrelated LLM must NOT have been updated or repointed to
    const agentUpdateCall = mockClient.agent.update.mock.calls[0];
    expect(agentUpdateCall[1].response_engine.llm_id).toBe("llm_newly_created");
    expect(agentUpdateCall[1].response_engine.llm_id).not.toBe("llm_other_env");
  });

  it("creates a new LLM when llm.list() fails (defensive fallback)", async () => {
    process.env.NODE_ENV = "development";
    process.env.RETELL_API_KEY = "key_test";
    process.env.RETELL_AGENT_ID = "agent_abc";
    process.env.RETELL_FUNCTION_SECRET = "";
    process.env.RETELL_API_BASE_URL = "https://api.example.com";

    const mockClient = makeRetellClient({
      agentType: "conversation_flow",
      llmId: undefined as any,
      createdLlmId: "llm_fallback",
    });
    mockClient.llm.list.mockRejectedValue(new Error("list failed"));

    vi.doMock("retell-sdk", () => ({
      default: vi.fn(() => mockClient),
    }));

    const { setupRetellAgentKb } = await import("../lib/retell-agent-setup");
    const result = await setupRetellAgentKb();

    expect(result.skipped).toBe(false);
    expect(result.repointed).toBe(true);
    expect(result.llmId).toBe("llm_fallback");
    expect(mockClient.llm.create).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// Idempotency after repoint
// ---------------------------------------------------------------------------

describe("setupRetellAgentKb — idempotency after repoint", () => {
  it("second run sees retell-llm and only patches LLM if needed, then goes fully idempotent", async () => {
    process.env.NODE_ENV = "development";
    process.env.RETELL_API_KEY = "key_test";
    process.env.RETELL_AGENT_ID = "agent_abc";
    process.env.RETELL_FUNCTION_SECRET = "my-secret";
    process.env.RETELL_API_BASE_URL = "https://api.example.com";

    // Simulate agent already repointed to retell-llm
    const mockClient = makeRetellClient({
      agentType: "retell-llm",
      llmId: "llm_new456",
      currentPrompt: "old",
      currentTools: [],
    });

    vi.doMock("retell-sdk", () => ({
      default: vi.fn(() => mockClient),
    }));

    const { setupRetellAgentKb } = await import("../lib/retell-agent-setup");

    // First call — patches the existing LLM (prompt/tool mismatch)
    const first = await setupRetellAgentKb();
    expect(first.skipped).toBe(false);
    expect(first.repointed).toBeFalsy();
    expect(mockClient.llm.update).toHaveBeenCalledOnce();
    expect(mockClient.llm.create).not.toHaveBeenCalled();
    expect(mockClient.agent.update).not.toHaveBeenCalled();

    // Simulate LLM now has the correct config
    const updateCall = mockClient.llm.update.mock.calls[0][1];
    mockClient.llm.retrieve.mockResolvedValue({
      general_prompt: updateCall.general_prompt,
      general_tools: updateCall.general_tools,
    });
    mockClient.llm.update.mockClear();

    // Second call — fully idempotent, no API writes
    const second = await setupRetellAgentKb();
    expect(second.skipped).toBe(true);
    expect(second.reason).toMatch(/no update needed/);
    expect(mockClient.llm.update).not.toHaveBeenCalled();
    expect(mockClient.llm.create).not.toHaveBeenCalled();
    expect(mockClient.agent.update).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Idempotency (retell-llm agent, no update when already patched)
// ---------------------------------------------------------------------------

describe("setupRetellAgentKb — idempotency (no update when already patched)", () => {
  it("skips the update when prompt and tool fingerprint already match", async () => {
    process.env.NODE_ENV = "development";
    process.env.RETELL_API_KEY = "key_test";
    process.env.RETELL_AGENT_ID = "agent_abc";
    process.env.RETELL_FUNCTION_SECRET = "my-secret";
    process.env.RETELL_API_BASE_URL = "https://api.example.com";

    const mockClient = makeRetellClient();

    vi.doMock("retell-sdk", () => ({
      default: vi.fn(() => mockClient),
    }));

    const { setupRetellAgentKb } = await import("../lib/retell-agent-setup");

    // First run patches.
    const first = await setupRetellAgentKb();
    expect(first.skipped).toBe(false);
    expect(mockClient.llm.update).toHaveBeenCalledOnce();

    // Grab what was written so we can simulate the LLM already having it.
    const updateCall = mockClient.llm.update.mock.calls[0][1];
    mockClient.llm.retrieve.mockResolvedValue({
      general_prompt: updateCall.general_prompt,
      general_tools: updateCall.general_tools,
    });
    mockClient.llm.update.mockClear();

    // Second run should be idempotent.
    const second = await setupRetellAgentKb();
    expect(second.skipped).toBe(true);
    expect(second.reason).toMatch(/no update needed/);
    expect(mockClient.llm.update).not.toHaveBeenCalled();
  });
});
