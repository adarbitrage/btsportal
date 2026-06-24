import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// ── RetellWebClient mock ─────────────────────────────────────────────────────
// Capture the handlers registered via `.on()` so tests can fire them directly.
const registeredHandlers: Record<string, (...args: unknown[]) => void> = {};

const mockRetellInstance = {
  on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
    registeredHandlers[event] = handler;
  }),
  startCall: vi.fn().mockResolvedValue(undefined),
  stopCall: vi.fn(),
  mute: vi.fn(),
  unmute: vi.fn(),
};

vi.mock("retell-client-js-sdk", () => ({
  RetellWebClient: vi.fn().mockImplementation(() => mockRetellInstance),
}));

// ── voice-api mock ────────────────────────────────────────────────────────────
const mockMutateAsync = vi.fn();

vi.mock("@/lib/voice-api", () => ({
  useVoiceStatus: () => ({
    data: {
      has_access: true,
      daily_cap_seconds: 600,
      seconds_used_today: 0,
      seconds_remaining: 600,
    },
    isLoading: false,
  }),
  useStartWebCall: () => ({
    mutateAsync: mockMutateAsync,
    isPending: false,
  }),
}));

import { VoiceCall } from "@/components/voice/VoiceCall";

// ── helpers ──────────────────────────────────────────────────────────────────

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function renderVoiceCall(queryClient: QueryClient) {
  return render(
    <QueryClientProvider client={queryClient}>
      <VoiceCall />
    </QueryClientProvider>,
  );
}

async function startCallFlow(queryClient: QueryClient) {
  const user = userEvent.setup({ delay: null });
  renderVoiceCall(queryClient);

  // Stub out getUserMedia (not available in jsdom).
  Object.defineProperty(navigator, "mediaDevices", {
    value: { getUserMedia: vi.fn().mockResolvedValue({}) },
    writable: true,
    configurable: true,
  });

  // Stub out startWebCall to return a fake token.
  mockMutateAsync.mockResolvedValueOnce({
    access_token: "test-token",
    call_id: "call-123",
  });

  await user.click(screen.getByRole("button", { name: /start call/i }));

  // Wait for the component to start the call; event handlers get registered.
  await waitFor(() => {
    expect(mockRetellInstance.on).toHaveBeenCalledWith("call_started", expect.any(Function));
  });

  // Fire call_started so the component enters the "active" state and reveals
  // the End Call button.
  await act(async () => {
    registeredHandlers["call_started"]?.();
  });

  await screen.findByRole("button", { name: /end call/i });
  return user;
}

// ── tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  Object.keys(registeredHandlers).forEach((k) => delete registeredHandlers[k]);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("VoiceCall — call-history invalidation on call end", () => {
  it("invalidates ['voice','calls'] immediately when the provider fires call_ended", async () => {
    const queryClient = makeQueryClient();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    await startCallFlow(queryClient);

    await act(async () => {
      registeredHandlers["call_ended"]?.();
    });

    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: ["voice", "calls"] }),
    );
  });

  it("also invalidates ['voice','status'] on call_ended (regression: existing behaviour preserved)", async () => {
    const queryClient = makeQueryClient();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    await startCallFlow(queryClient);

    await act(async () => {
      registeredHandlers["call_ended"]?.();
    });

    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: ["voice", "status"] }),
    );
  });

  it("invalidates ['voice','calls'] when the member clicks End Call", async () => {
    const queryClient = makeQueryClient();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const user = await startCallFlow(queryClient);

    await user.click(screen.getByRole("button", { name: /end call/i }));

    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: ["voice", "calls"] }),
    );
  });

  it("also invalidates ['voice','status'] when End Call is clicked (regression)", async () => {
    const queryClient = makeQueryClient();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const user = await startCallFlow(queryClient);

    await user.click(screen.getByRole("button", { name: /end call/i }));

    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: ["voice", "status"] }),
    );
  });

  it("schedules additional ['voice','calls'] invalidations after call_ended to cover webhook lag", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const queryClient = makeQueryClient();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    await startCallFlow(queryClient);

    await act(async () => {
      registeredHandlers["call_ended"]?.();
    });

    const callsKeyCallsBefore = invalidateSpy.mock.calls.filter(
      (c) => JSON.stringify((c[0] as any)?.queryKey) === JSON.stringify(["voice", "calls"]),
    ).length;

    // Advance past the retry delays (3 s, 8 s, 18 s).
    await act(async () => {
      vi.advanceTimersByTime(20_000);
    });

    const callsKeyCallsAfter = invalidateSpy.mock.calls.filter(
      (c) => JSON.stringify((c[0] as any)?.queryKey) === JSON.stringify(["voice", "calls"]),
    ).length;

    // Expect the 1 immediate + 3 delayed = at least 4 total.
    expect(callsKeyCallsAfter).toBeGreaterThanOrEqual(callsKeyCallsBefore + 3);
  });

  it("clears pending retry timers when a new call starts (quick redial)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const queryClient = makeQueryClient();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    await startCallFlow(queryClient);

    // End the first call — schedules retry invalidations at 3s/8s/18s.
    await act(async () => {
      registeredHandlers["call_ended"]?.();
    });

    // Reset the spy so we only count invalidations from this point forward.
    invalidateSpy.mockClear();

    // Immediately start another call (quick redial) before any retry fires.
    Object.defineProperty(navigator, "mediaDevices", {
      value: { getUserMedia: vi.fn().mockResolvedValue({}) },
      writable: true,
      configurable: true,
    });
    mockMutateAsync.mockResolvedValueOnce({
      access_token: "redial-token",
      call_id: "call-redial",
    });

    const user = userEvent.setup({ delay: null });
    await user.click(screen.getByRole("button", { name: /start call/i }));

    // Advance past all the first-call retry delays.
    await act(async () => {
      vi.advanceTimersByTime(20_000);
    });

    // None of the previous call's retries should have fired — only any
    // invalidations that the new startCall itself triggered (status only).
    const callsKeyInvalidations = invalidateSpy.mock.calls.filter(
      (c) => JSON.stringify((c[0] as any)?.queryKey) === JSON.stringify(["voice", "calls"]),
    );
    expect(callsKeyInvalidations).toHaveLength(0);
  });

  it("clears retry timers when the component unmounts so no stale invalidations fire", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const queryClient = makeQueryClient();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { unmount } = render(
      <QueryClientProvider client={queryClient}>
        <VoiceCall />
      </QueryClientProvider>,
    );

    Object.defineProperty(navigator, "mediaDevices", {
      value: { getUserMedia: vi.fn().mockResolvedValue({}) },
      writable: true,
      configurable: true,
    });
    mockMutateAsync.mockResolvedValueOnce({
      access_token: "test-token",
      call_id: "call-456",
    });

    const user = userEvent.setup({ delay: null });
    await user.click(screen.getByRole("button", { name: /start call/i }));
    await waitFor(() =>
      expect(mockRetellInstance.on).toHaveBeenCalledWith("call_started", expect.any(Function)),
    );
    await act(async () => {
      registeredHandlers["call_started"]?.();
    });
    await act(async () => {
      registeredHandlers["call_ended"]?.();
    });

    const countAfterEnd = invalidateSpy.mock.calls.filter(
      (c) => JSON.stringify((c[0] as any)?.queryKey) === JSON.stringify(["voice", "calls"]),
    ).length;

    unmount();

    await act(async () => {
      vi.advanceTimersByTime(20_000);
    });

    // No additional invalidations after unmount.
    const countAfterUnmount = invalidateSpy.mock.calls.filter(
      (c) => JSON.stringify((c[0] as any)?.queryKey) === JSON.stringify(["voice", "calls"]),
    ).length;

    expect(countAfterUnmount).toBe(countAfterEnd);
  });
});
