/**
 * Tests for retell-agent-setup.ts
 *
 * Covers:
 * - Production base-URL auto-resolution (REPLIT_DOMAINS fallback)
 * - All loud-skip paths (missing keys, wrong id prefix, missing secret in prod,
 *   no base URL, wrong agent type)
 * - Module-level cache (get/set)
 * - Idempotency check (no update when prompt+tool already match)
 * - Full patch path (update when mismatch)
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
  currentPrompt?: string;
  currentTools?: unknown[];
} = {}) {
  const {
    agentType = "retell-llm",
    llmId = "llm_test123",
    currentPrompt = "old prompt",
    currentTools = [],
  } = overrides;

  return {
    agent: {
      retrieve: vi.fn().mockResolvedValue({
        response_engine: llmId
          ? { type: agentType, llm_id: llmId }
          : { type: agentType },
      }),
    },
    llm: {
      retrieve: vi.fn().mockResolvedValue({
        general_prompt: currentPrompt,
        general_tools: currentTools,
      }),
      update: vi.fn().mockResolvedValue({}),
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
// Agent type check
// ---------------------------------------------------------------------------

describe("setupRetellAgentKb — agent type check", () => {
  it("skips and explains clearly when the agent is not a retell-llm type", async () => {
    process.env.NODE_ENV = "development";
    process.env.RETELL_API_KEY = "key_test";
    process.env.RETELL_AGENT_ID = "agent_abc";
    process.env.RETELL_FUNCTION_SECRET = "";
    process.env.RETELL_API_BASE_URL = "https://api.example.com";

    const mockClient = makeRetellClient({ agentType: "conversation_flow", llmId: undefined as any });

    vi.doMock("retell-sdk", () => ({
      default: vi.fn(() => mockClient),
    }));

    const { setupRetellAgentKb } = await import("../lib/retell-agent-setup");
    const result = await setupRetellAgentKb();

    expect(result.skipped).toBe(true);
    expect(result.reason).toMatch(/conversation_flow/);
    expect(result.reason).toMatch(/retell-llm/);
    expect(result.agentResponseEngineType).toBe("conversation_flow");
  });
});

// ---------------------------------------------------------------------------
// Idempotency
// ---------------------------------------------------------------------------

describe("setupRetellAgentKb — idempotency (no update when already patched)", () => {
  it("skips the update when prompt and tool fingerprint already match", async () => {
    process.env.NODE_ENV = "development";
    process.env.RETELL_API_KEY = "key_test";
    process.env.RETELL_AGENT_ID = "agent_abc";
    process.env.RETELL_FUNCTION_SECRET = "my-secret";
    process.env.RETELL_API_BASE_URL = "https://api.example.com";

    // We need to know the exact desired prompt to simulate a match.
    // Import fresh to get buildVoiceSystemPrompt indirectly via a first run.
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
