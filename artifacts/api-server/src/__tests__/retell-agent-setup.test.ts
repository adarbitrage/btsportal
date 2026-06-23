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
      create: vi.fn().mockResolvedValue({ agent_id: "agent_new_clone" }),
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
// Non-LLM agent: forceRepoint override bypasses substantial-flow gate
// ---------------------------------------------------------------------------

describe("setupRetellAgentKb — forceRepoint override (substantial flow)", () => {
  it("repoints agent even when flow has transfer_call nodes when forceRepoint=true", async () => {
    process.env.NODE_ENV = "development";
    process.env.RETELL_API_KEY = "key_test";
    process.env.RETELL_AGENT_ID = "agent_abc";
    process.env.RETELL_FUNCTION_SECRET = "my-secret";
    process.env.RETELL_API_BASE_URL = "https://api.example.com";

    const mockClient = makeRetellClient({
      agentType: "conversation_flow",
      llmId: undefined as any,
      conversationFlowId: "cf_complex",
      conversationFlowNodes: [
        { type: "conversation" },
        { type: "transfer_call" },
        { type: "conversation" },
        { type: "end" },
      ],
      createdLlmId: "llm_forced123",
    });

    vi.doMock("retell-sdk", () => ({
      default: vi.fn(() => mockClient),
    }));

    const { setupRetellAgentKb } = await import("../lib/retell-agent-setup");
    const result = await setupRetellAgentKb({ forceRepoint: true });

    expect(result.skipped).toBe(false);
    expect(result.repointed).toBe(true);
    expect(result.llmId).toBe("llm_forced123");
    expect(result.agentResponseEngineType).toBe("conversation_flow");
    // Assessment was still run and is reported for traceability
    expect(result.conversationFlowAssessment).toMatch(/transfer_call/);

    expect(mockClient.llm.create).toHaveBeenCalledOnce();
    const createCall = mockClient.llm.create.mock.calls[0][0];
    expect(createCall.general_tools[0].name).toBe("search_knowledge_base");

    expect(mockClient.agent.update).toHaveBeenCalledOnce();
    expect(mockClient.agent.update.mock.calls[0][1].response_engine).toMatchObject({
      type: "retell-llm",
      llm_id: "llm_forced123",
    });
  });

  it("repoints agent even when flow has branch nodes when forceRepoint=true", async () => {
    process.env.NODE_ENV = "development";
    process.env.RETELL_API_KEY = "key_test";
    process.env.RETELL_AGENT_ID = "agent_abc";
    process.env.RETELL_FUNCTION_SECRET = "my-secret";
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
      createdLlmId: "llm_forced_branch",
    });

    vi.doMock("retell-sdk", () => ({
      default: vi.fn(() => mockClient),
    }));

    const { setupRetellAgentKb } = await import("../lib/retell-agent-setup");
    const result = await setupRetellAgentKb({ forceRepoint: true });

    expect(result.skipped).toBe(false);
    expect(result.repointed).toBe(true);
    expect(result.llmId).toBe("llm_forced_branch");
    expect(result.conversationFlowAssessment).toMatch(/branch/);
    expect(mockClient.agent.update).toHaveBeenCalledOnce();
  });

  it("repoints agent even when flow exceeds node-count threshold when forceRepoint=true", async () => {
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
      createdLlmId: "llm_forced_many",
    });

    vi.doMock("retell-sdk", () => ({
      default: vi.fn(() => mockClient),
    }));

    const { setupRetellAgentKb } = await import("../lib/retell-agent-setup");
    const result = await setupRetellAgentKb({ forceRepoint: true });

    expect(result.skipped).toBe(false);
    expect(result.repointed).toBe(true);
    expect(result.llmId).toBe("llm_forced_many");
    expect(result.conversationFlowAssessment).toMatch(/threshold/);
    expect(mockClient.agent.update).toHaveBeenCalledOnce();
    expect(mockClient.agent.update.mock.calls[0][1].response_engine).toMatchObject({
      type: "retell-llm",
      llm_id: "llm_forced_many",
    });
  });

  it("still skips the genuine skip paths even when forceRepoint=true (missing key)", async () => {
    process.env.RETELL_API_KEY = "";
    process.env.RETELL_AGENT_ID = "agent_abc";
    const { setupRetellAgentKb } = await import("../lib/retell-agent-setup");
    const result = await setupRetellAgentKb({ forceRepoint: true });
    expect(result.skipped).toBe(true);
    expect(result.reason).toMatch(/RETELL_API_KEY/);
  });

  it("still skips in production when RETELL_FUNCTION_SECRET is missing even with forceRepoint=true", async () => {
    process.env.NODE_ENV = "production";
    process.env.RETELL_API_KEY = "key_test";
    process.env.RETELL_AGENT_ID = "agent_abc";
    process.env.RETELL_FUNCTION_SECRET = "";
    const { setupRetellAgentKb } = await import("../lib/retell-agent-setup");
    const result = await setupRetellAgentKb({ forceRepoint: true });
    expect(result.skipped).toBe(true);
    expect(result.reason).toMatch(/RETELL_FUNCTION_SECRET/);
  });
});

// ---------------------------------------------------------------------------
// Non-LLM agent: Retell API engine-type constraint → create new agent fallback
// ---------------------------------------------------------------------------

describe("setupRetellAgentKb — engine-type change blocked (create new agent fallback)", () => {
  it("creates a new agent and returns newAgentId when agent.update rejects with engine-type error", async () => {
    process.env.NODE_ENV = "development";
    process.env.RETELL_API_KEY = "key_test";
    process.env.RETELL_AGENT_ID = "agent_abc";
    process.env.RETELL_FUNCTION_SECRET = "my-secret";
    process.env.RETELL_API_BASE_URL = "https://api.example.com";

    const mockClient = makeRetellClient({
      agentType: "conversation_flow",
      llmId: undefined as any,
      createdLlmId: "llm_for_new_agent",
    });
    // Make agent.update throw the Retell engine-type constraint error
    mockClient.agent.update.mockRejectedValue(
      new Error("400 Cannot update response engine to different response engine type"),
    );
    // Make agent.retrieve return voice_id so the clone can copy it
    mockClient.agent.retrieve.mockResolvedValue({
      response_engine: { type: "conversation_flow" },
      voice_id: "retell-Cimo",
      agent_name: "BTS Assistant",
    });
    mockClient.agent.create.mockResolvedValue({ agent_id: "agent_new_clone999" });

    vi.doMock("retell-sdk", () => ({
      default: vi.fn(() => mockClient),
    }));

    const { setupRetellAgentKb } = await import("../lib/retell-agent-setup");
    const result = await setupRetellAgentKb({ forceRepoint: true });

    expect(result.skipped).toBe(false);
    expect(result.repointed).toBe(false);
    expect(result.requiresAgentIdUpdate).toBe(true);
    expect(result.newAgentId).toBe("agent_new_clone999");
    expect(result.reason).toMatch(/agent_new_clone999/);
    expect(result.reason).toMatch(/RETELL_AGENT_ID/);
    expect(result.llmId).toBe("llm_for_new_agent");

    // Must NOT have updated the original agent
    expect(mockClient.agent.update).toHaveBeenCalledOnce();
    // Must have created a new agent
    expect(mockClient.agent.create).toHaveBeenCalledOnce();
    const createCall = mockClient.agent.create.mock.calls[0][0] as Record<string, unknown>;
    expect(createCall.voice_id).toBe("retell-Cimo");
    expect(createCall.agent_name).toBe("BTS Assistant");
    expect((createCall.response_engine as Record<string, unknown>).type).toBe("retell-llm");
    expect((createCall.response_engine as Record<string, unknown>).llm_id).toBe("llm_for_new_agent");
  });

  it("re-throws non-engine-type errors from agent.update", async () => {
    process.env.NODE_ENV = "development";
    process.env.RETELL_API_KEY = "key_test";
    process.env.RETELL_AGENT_ID = "agent_abc";
    process.env.RETELL_FUNCTION_SECRET = "my-secret";
    process.env.RETELL_API_BASE_URL = "https://api.example.com";

    const mockClient = makeRetellClient({
      agentType: "conversation_flow",
      llmId: undefined as any,
      createdLlmId: "llm_new",
    });
    mockClient.agent.update.mockRejectedValue(new Error("500 Internal Server Error"));

    vi.doMock("retell-sdk", () => ({
      default: vi.fn(() => mockClient),
    }));

    const { setupRetellAgentKb } = await import("../lib/retell-agent-setup");
    await expect(setupRetellAgentKb({ forceRepoint: true })).rejects.toThrow("500 Internal Server Error");
    expect(mockClient.agent.create).not.toHaveBeenCalled();
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

// ---------------------------------------------------------------------------
// Health interpretation — guards the admin-visible signal on System Health.
// Covers the unhealthy-vs-healthy reading of every RetellSetupResult shape so
// a silent regression to a broken agent can't slip through unflagged.
// ---------------------------------------------------------------------------

describe("interpretRetellSetupHealth", () => {
  const ranAt = "2026-06-23T00:00:00.000Z";

  it("returns unknown (no nag) when no result is cached yet", async () => {
    const { interpretRetellSetupHealth } = await import("../lib/retell-agent-setup");
    const v = interpretRetellSetupHealth(null);
    expect(v.status).toBe("unknown");
    expect(v.healthy).toBe(false);
    expect(v.needsAttention).toBe(false);
    expect(v.detail).toMatch(/not reported a result yet/i);
  });

  it("returns healthy when setup ran successfully (not skipped, no agent-id update)", async () => {
    const { interpretRetellSetupHealth } = await import("../lib/retell-agent-setup");
    const v = interpretRetellSetupHealth({
      skipped: false,
      reason: "Updated existing LLM with latest KB tool + prompt",
      ranAt,
    });
    expect(v.status).toBe("healthy");
    expect(v.healthy).toBe(true);
    expect(v.needsAttention).toBe(false);
  });

  it("returns not_configured (no nag) when credentials are absent", async () => {
    const { interpretRetellSetupHealth } = await import("../lib/retell-agent-setup");
    const v = interpretRetellSetupHealth({
      skipped: true,
      reason: "RETELL_API_KEY or RETELL_AGENT_ID not configured",
      ranAt,
    });
    expect(v.status).toBe("not_configured");
    expect(v.healthy).toBe(false);
    expect(v.needsAttention).toBe(false);
  });

  it("flags misconfigured when the agent id lacks the agent_ prefix", async () => {
    const { interpretRetellSetupHealth } = await import("../lib/retell-agent-setup");
    const v = interpretRetellSetupHealth({
      skipped: true,
      reason: 'RETELL_AGENT_ID must start with "agent_" (got "noprefix_abc…")',
      ranAt,
    });
    expect(v.status).toBe("misconfigured");
    expect(v.healthy).toBe(false);
    expect(v.needsAttention).toBe(true);
  });

  it("flags misconfigured when RETELL_FUNCTION_SECRET is missing in production", async () => {
    const { interpretRetellSetupHealth } = await import("../lib/retell-agent-setup");
    const v = interpretRetellSetupHealth({
      skipped: true,
      reason: "RETELL_FUNCTION_SECRET is required in production",
      ranAt,
    });
    expect(v.status).toBe("misconfigured");
    expect(v.needsAttention).toBe(true);
  });

  it("flags misconfigured when a substantial conversation flow blocked the repoint", async () => {
    const { interpretRetellSetupHealth } = await import("../lib/retell-agent-setup");
    const v = interpretRetellSetupHealth({
      skipped: true,
      reason:
        'Agent is on "conversation_flow" engine with substantial Conversation Flow logic — manual review required before auto-repoint.',
      agentResponseEngineType: "conversation_flow",
      conversationFlowAssessment: "Substantial flow: 2 node(s) including transfer_call nodes",
      ranAt,
    });
    expect(v.status).toBe("misconfigured");
    expect(v.needsAttention).toBe(true);
  });

  it("flags misconfigured when a manual re-run threw an error", async () => {
    const { interpretRetellSetupHealth } = await import("../lib/retell-agent-setup");
    const v = interpretRetellSetupHealth({
      skipped: true,
      reason: "Manual re-run threw an error: 404 agent not found",
      ranAt,
    });
    expect(v.status).toBe("misconfigured");
    expect(v.needsAttention).toBe(true);
  });

  it("flags misconfigured when a new agent was created and RETELL_AGENT_ID must be updated", async () => {
    const { interpretRetellSetupHealth } = await import("../lib/retell-agent-setup");
    const v = interpretRetellSetupHealth({
      skipped: false,
      reason:
        "Retell API blocked in-place engine-type change — created new agent agent_new999. Update RETELL_AGENT_ID.",
      requiresAgentIdUpdate: true,
      newAgentId: "agent_new999",
      ranAt,
    });
    // Setup "succeeded" but the live secret still points at the old agent.
    expect(v.status).toBe("misconfigured");
    expect(v.healthy).toBe(false);
    expect(v.needsAttention).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Live read-only re-check probe — must NEVER mutate the agent/LLM and must
// produce a RetellSetupResult that interpretRetellSetupHealth reads correctly.
// ---------------------------------------------------------------------------

describe("probeRetellAgentHealth — read-only live re-check", () => {
  it("reports not_configured (skip) without any Retell calls when creds are absent", async () => {
    process.env.RETELL_API_KEY = "";
    process.env.RETELL_AGENT_ID = "";
    const { probeRetellAgentHealth, interpretRetellSetupHealth } = await import(
      "../lib/retell-agent-setup"
    );
    const result = await probeRetellAgentHealth();
    expect(result.skipped).toBe(true);
    expect(result.reason).toMatch(/RETELL_API_KEY or RETELL_AGENT_ID not configured/);
    expect(interpretRetellSetupHealth(result).status).toBe("not_configured");
  });

  it("flags misconfigured when the agent id lacks the agent_ prefix", async () => {
    process.env.RETELL_API_KEY = "key_test";
    process.env.RETELL_AGENT_ID = "noprefix_abc";
    const { probeRetellAgentHealth, interpretRetellSetupHealth } = await import(
      "../lib/retell-agent-setup"
    );
    const result = await probeRetellAgentHealth();
    expect(result.skipped).toBe(true);
    expect(interpretRetellSetupHealth(result).needsAttention).toBe(true);
  });

  it("reports healthy (no mutations) when agent is on retell-llm with matching prompt+tool", async () => {
    process.env.NODE_ENV = "development";
    process.env.RETELL_API_KEY = "key_test";
    process.env.RETELL_AGENT_ID = "agent_abc";
    process.env.RETELL_FUNCTION_SECRET = "my-secret";
    process.env.RETELL_API_BASE_URL = "https://api.example.com";

    // Run setup once against an empty LLM so we can capture the exact desired
    // prompt + tool the module writes, then feed those back as the live state.
    const setupClient = makeRetellClient({ currentPrompt: "old", currentTools: [] });
    vi.doMock("retell-sdk", () => ({ default: vi.fn(() => setupClient) }));
    const mod = await import("../lib/retell-agent-setup");
    await mod.setupRetellAgentKb();
    const written = setupClient.llm.update.mock.calls[0][1];

    // Now the live agent reflects the desired config exactly.
    setupClient.llm.retrieve.mockResolvedValue({
      general_prompt: written.general_prompt,
      general_tools: written.general_tools,
    });
    setupClient.llm.update.mockClear();
    setupClient.agent.update.mockClear();
    setupClient.llm.create.mockClear();
    setupClient.agent.create.mockClear();

    const result = await mod.probeRetellAgentHealth();

    expect(result.skipped).toBe(false);
    expect(mod.interpretRetellSetupHealth(result).status).toBe("healthy");
    expect(result.reason).toMatch(/Live re-check/);
    // The probe must be strictly read-only.
    expect(setupClient.llm.update).not.toHaveBeenCalled();
    expect(setupClient.llm.create).not.toHaveBeenCalled();
    expect(setupClient.agent.update).not.toHaveBeenCalled();
    expect(setupClient.agent.create).not.toHaveBeenCalled();
  });

  it("flags misconfigured (no mutations) when the agent is NOT on retell-llm", async () => {
    process.env.NODE_ENV = "development";
    process.env.RETELL_API_KEY = "key_test";
    process.env.RETELL_AGENT_ID = "agent_abc";
    process.env.RETELL_FUNCTION_SECRET = "my-secret";
    process.env.RETELL_API_BASE_URL = "https://api.example.com";

    const mockClient = makeRetellClient({
      agentType: "conversation_flow",
      llmId: undefined as any,
      conversationFlowId: "cf_x",
    });
    vi.doMock("retell-sdk", () => ({ default: vi.fn(() => mockClient) }));

    const { probeRetellAgentHealth, interpretRetellSetupHealth } = await import(
      "../lib/retell-agent-setup"
    );
    const result = await probeRetellAgentHealth();

    expect(result.skipped).toBe(true);
    expect(result.agentResponseEngineType).toBe("conversation_flow");
    expect(interpretRetellSetupHealth(result).needsAttention).toBe(true);
    expect(mockClient.agent.update).not.toHaveBeenCalled();
    expect(mockClient.agent.create).not.toHaveBeenCalled();
    expect(mockClient.llm.update).not.toHaveBeenCalled();
    expect(mockClient.llm.create).not.toHaveBeenCalled();
  });

  it("flags misconfigured (no mutations) when on retell-llm but the KB tool/prompt has drifted", async () => {
    process.env.NODE_ENV = "development";
    process.env.RETELL_API_KEY = "key_test";
    process.env.RETELL_AGENT_ID = "agent_abc";
    process.env.RETELL_FUNCTION_SECRET = "my-secret";
    process.env.RETELL_API_BASE_URL = "https://api.example.com";

    // retell-llm agent whose LLM has the wrong prompt and no KB tool.
    const mockClient = makeRetellClient({
      agentType: "retell-llm",
      llmId: "llm_drift",
      currentPrompt: "stale prompt",
      currentTools: [],
    });
    vi.doMock("retell-sdk", () => ({ default: vi.fn(() => mockClient) }));

    const { probeRetellAgentHealth, interpretRetellSetupHealth } = await import(
      "../lib/retell-agent-setup"
    );
    const result = await probeRetellAgentHealth();

    expect(result.skipped).toBe(true);
    expect(result.reason).toMatch(/out of sync/);
    expect(interpretRetellSetupHealth(result).needsAttention).toBe(true);
    expect(mockClient.llm.update).not.toHaveBeenCalled();
    expect(mockClient.llm.create).not.toHaveBeenCalled();
  });

  it("flags misconfigured when a Retell call throws during the probe", async () => {
    process.env.NODE_ENV = "development";
    process.env.RETELL_API_KEY = "key_test";
    process.env.RETELL_AGENT_ID = "agent_abc";
    process.env.RETELL_FUNCTION_SECRET = "my-secret";
    process.env.RETELL_API_BASE_URL = "https://api.example.com";

    const mockClient = makeRetellClient();
    mockClient.agent.retrieve.mockRejectedValue(new Error("404 agent not found"));
    vi.doMock("retell-sdk", () => ({ default: vi.fn(() => mockClient) }));

    const { probeRetellAgentHealth, interpretRetellSetupHealth } = await import(
      "../lib/retell-agent-setup"
    );
    const result = await probeRetellAgentHealth();

    expect(result.skipped).toBe(true);
    expect(result.reason).toMatch(/Live re-check threw an error: 404 agent not found/);
    expect(interpretRetellSetupHealth(result).needsAttention).toBe(true);
  });
});
