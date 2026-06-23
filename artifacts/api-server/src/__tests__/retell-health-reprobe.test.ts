/**
 * Tests for retell-health-reprobe.ts
 *
 * Guards the passive background re-probe that keeps the cached Voice Assistant
 * health verdict fresh:
 * - runRetellHealthReprobe() writes a fresh result into the module-level cache.
 * - When RETELL_API_KEY / RETELL_AGENT_ID are absent the probe short-circuits to
 *   a "not_configured" verdict WITHOUT instantiating/hitting the Retell SDK.
 * - RETELL_HEALTH_REPROBE_INTERVAL_SECONDS overrides the default interval used by
 *   startRetellHealthReprobeJob().
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const originalEnv = { ...process.env };

// Mirrors the makeRetellClient helper in retell-agent-setup.test.ts: a stub
// retell-sdk client whose agent/llm methods are vi.fn()s so the probe can run
// end-to-end without touching the real Retell API.
function makeRetellClient(overrides: {
  agentType?: string;
  llmId?: string;
  conversationFlowId?: string;
  currentPrompt?: string;
  currentTools?: unknown[];
} = {}) {
  const {
    agentType = "retell-llm",
    llmId = "llm_test123",
    conversationFlowId,
    currentPrompt = "old prompt",
    currentTools = [],
  } = overrides;

  const agentRetrieveResult: Record<string, unknown> = {
    response_engine: {
      type: agentType,
      ...(llmId ? { llm_id: llmId } : {}),
      ...(conversationFlowId ? { conversation_flow_id: conversationFlowId } : {}),
    },
  };

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
      create: vi.fn().mockResolvedValue({ llm_id: "llm_new456" }),
      list: vi.fn().mockResolvedValue([]),
    },
    conversationFlow: {
      retrieve: vi.fn().mockResolvedValue({ nodes: [] }),
    },
  };
}

beforeEach(() => {
  process.env = { ...originalEnv };
  vi.resetModules();
});

afterEach(() => {
  process.env = { ...originalEnv };
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("runRetellHealthReprobe", () => {
  it("writes a fresh result into the cache (setCachedRetellSetupResult)", async () => {
    // Voice intentionally off → probe short-circuits, no Retell SDK needed.
    process.env.RETELL_API_KEY = "";
    process.env.RETELL_AGENT_ID = "";

    const { getCachedRetellSetupResult, setCachedRetellSetupResult } = await import(
      "../lib/retell-agent-setup"
    );

    // Seed a stale sentinel so we can prove the re-probe replaced it.
    const stale = { skipped: true, reason: "stale-sentinel", ranAt: "2000-01-01T00:00:00.000Z" };
    setCachedRetellSetupResult(stale);
    expect(getCachedRetellSetupResult()).toEqual(stale);

    const { runRetellHealthReprobe } = await import("../lib/retell-health-reprobe");
    await runRetellHealthReprobe();

    const cached = getCachedRetellSetupResult();
    expect(cached).not.toBeNull();
    expect(cached).not.toEqual(stale);
    expect(cached!.reason).not.toBe("stale-sentinel");
    // A fresh result always carries a timestamp newer than the stale sentinel.
    expect(cached!.ranAt).toBeTruthy();
    expect(cached!.ranAt).not.toBe(stale.ranAt);
  });

  it("short-circuits to a 'not_configured' verdict without hitting the Retell API when keys are absent", async () => {
    delete process.env.RETELL_API_KEY;
    delete process.env.RETELL_AGENT_ID;

    // Spy on the Retell SDK constructor; it must never be invoked.
    const retellCtor = vi.fn(() => ({}));
    vi.doMock("retell-sdk", () => ({
      default: retellCtor,
    }));

    const { getCachedRetellSetupResult, interpretRetellSetupHealth } = await import(
      "../lib/retell-agent-setup"
    );
    const { runRetellHealthReprobe } = await import("../lib/retell-health-reprobe");

    await runRetellHealthReprobe();

    expect(retellCtor).not.toHaveBeenCalled();

    const verdict = interpretRetellSetupHealth(getCachedRetellSetupResult());
    expect(verdict.status).toBe("not_configured");
    expect(verdict.needsAttention).toBe(false);
    expect(verdict.healthy).toBe(false);
  });
});

describe("runRetellHealthReprobe — configured agent (Retell API exercised)", () => {
  it("caches a 'healthy' verdict when voice IS configured and the agent is correctly wired", async () => {
    process.env.NODE_ENV = "development";
    process.env.RETELL_API_KEY = "key_test";
    process.env.RETELL_AGENT_ID = "agent_abc";
    process.env.RETELL_FUNCTION_SECRET = "my-secret";
    process.env.RETELL_API_BASE_URL = "https://api.example.com";

    // Run setup once against an empty LLM so we capture the exact desired
    // prompt + tool the module writes, then feed those back as the live agent
    // state so the probe sees a perfectly-wired agent.
    const client = makeRetellClient({ currentPrompt: "old", currentTools: [] });
    vi.doMock("retell-sdk", () => ({ default: vi.fn(() => client) }));

    const { setupRetellAgentKb, getCachedRetellSetupResult, interpretRetellSetupHealth } =
      await import("../lib/retell-agent-setup");
    await setupRetellAgentKb();
    const written = client.llm.update.mock.calls[0][1];

    // Live agent now reflects the desired config exactly.
    client.llm.retrieve.mockResolvedValue({
      general_prompt: written.general_prompt,
      general_tools: written.general_tools,
    });
    client.llm.update.mockClear();
    client.llm.create.mockClear();
    client.agent.update.mockClear();
    client.agent.create.mockClear();

    const { runRetellHealthReprobe } = await import("../lib/retell-health-reprobe");
    await runRetellHealthReprobe();

    const verdict = interpretRetellSetupHealth(getCachedRetellSetupResult());
    expect(verdict.status).toBe("healthy");
    expect(verdict.healthy).toBe(true);
    expect(verdict.needsAttention).toBe(false);

    // The background re-probe is strictly read-only — it must never mutate.
    expect(client.llm.update).not.toHaveBeenCalled();
    expect(client.llm.create).not.toHaveBeenCalled();
    expect(client.agent.update).not.toHaveBeenCalled();
    expect(client.agent.create).not.toHaveBeenCalled();
  });

  it("caches a 'misconfigured' / needsAttention verdict when the wired agent is on the wrong engine", async () => {
    process.env.NODE_ENV = "development";
    process.env.RETELL_API_KEY = "key_test";
    process.env.RETELL_AGENT_ID = "agent_abc";
    process.env.RETELL_FUNCTION_SECRET = "my-secret";
    process.env.RETELL_API_BASE_URL = "https://api.example.com";

    // Voice IS configured, but the agent is on a conversation_flow engine — so
    // its answers bypass the knowledge base. The probe must catch this.
    const client = makeRetellClient({
      agentType: "conversation_flow",
      llmId: undefined,
      conversationFlowId: "cf_x",
    });
    vi.doMock("retell-sdk", () => ({ default: vi.fn(() => client) }));

    const { getCachedRetellSetupResult, interpretRetellSetupHealth } = await import(
      "../lib/retell-agent-setup"
    );
    const { runRetellHealthReprobe } = await import("../lib/retell-health-reprobe");
    await runRetellHealthReprobe();

    const result = getCachedRetellSetupResult();
    expect(client.agent.retrieve).toHaveBeenCalled();
    expect(result!.agentResponseEngineType).toBe("conversation_flow");
    const verdict = interpretRetellSetupHealth(result);
    expect(verdict.status).toBe("misconfigured");
    expect(verdict.needsAttention).toBe(true);
    expect(verdict.healthy).toBe(false);

    // Still strictly read-only even on the unhappy path.
    expect(client.agent.update).not.toHaveBeenCalled();
    expect(client.agent.create).not.toHaveBeenCalled();
    expect(client.llm.update).not.toHaveBeenCalled();
    expect(client.llm.create).not.toHaveBeenCalled();
  });

  it("caches a 'misconfigured' / needsAttention verdict when a Retell API call throws", async () => {
    process.env.NODE_ENV = "development";
    process.env.RETELL_API_KEY = "key_test";
    process.env.RETELL_AGENT_ID = "agent_abc";
    process.env.RETELL_FUNCTION_SECRET = "my-secret";
    process.env.RETELL_API_BASE_URL = "https://api.example.com";

    const client = makeRetellClient();
    client.agent.retrieve.mockRejectedValue(new Error("404 agent not found"));
    vi.doMock("retell-sdk", () => ({ default: vi.fn(() => client) }));

    const { getCachedRetellSetupResult, interpretRetellSetupHealth } = await import(
      "../lib/retell-agent-setup"
    );
    const { runRetellHealthReprobe } = await import("../lib/retell-health-reprobe");
    await runRetellHealthReprobe();

    const result = getCachedRetellSetupResult();
    expect(result!.reason).toMatch(/Live re-check threw an error: 404 agent not found/);
    const verdict = interpretRetellSetupHealth(result);
    expect(verdict.status).toBe("misconfigured");
    expect(verdict.needsAttention).toBe(true);
  });
});

describe("startRetellHealthReprobeJob — interval configuration", () => {
  it("uses the default 10-minute interval when RETELL_HEALTH_REPROBE_INTERVAL_SECONDS is unset", async () => {
    delete process.env.RETELL_HEALTH_REPROBE_INTERVAL_SECONDS;

    const setIntervalSpy = vi
      .spyOn(globalThis, "setInterval")
      .mockReturnValue({ unref: vi.fn() } as unknown as ReturnType<typeof setInterval>);

    const { startRetellHealthReprobeJob, stopRetellHealthReprobeJob } = await import(
      "../lib/retell-health-reprobe"
    );

    startRetellHealthReprobeJob();
    try {
      expect(setIntervalSpy).toHaveBeenCalledOnce();
      expect(setIntervalSpy.mock.calls[0][1]).toBe(10 * 60 * 1000);
    } finally {
      stopRetellHealthReprobeJob();
    }
  });

  it("overrides the interval from RETELL_HEALTH_REPROBE_INTERVAL_SECONDS", async () => {
    process.env.RETELL_HEALTH_REPROBE_INTERVAL_SECONDS = "42";

    const setIntervalSpy = vi
      .spyOn(globalThis, "setInterval")
      .mockReturnValue({ unref: vi.fn() } as unknown as ReturnType<typeof setInterval>);

    const { startRetellHealthReprobeJob, stopRetellHealthReprobeJob } = await import(
      "../lib/retell-health-reprobe"
    );

    startRetellHealthReprobeJob();
    try {
      expect(setIntervalSpy).toHaveBeenCalledOnce();
      expect(setIntervalSpy.mock.calls[0][1]).toBe(42 * 1000);
    } finally {
      stopRetellHealthReprobeJob();
    }
  });

  it("falls back to the default interval when the override is non-numeric or non-positive", async () => {
    process.env.RETELL_HEALTH_REPROBE_INTERVAL_SECONDS = "not-a-number";

    const setIntervalSpy = vi
      .spyOn(globalThis, "setInterval")
      .mockReturnValue({ unref: vi.fn() } as unknown as ReturnType<typeof setInterval>);

    const { startRetellHealthReprobeJob, stopRetellHealthReprobeJob } = await import(
      "../lib/retell-health-reprobe"
    );

    startRetellHealthReprobeJob();
    try {
      expect(setIntervalSpy.mock.calls[0][1]).toBe(10 * 60 * 1000);
    } finally {
      stopRetellHealthReprobeJob();
    }
  });
});
