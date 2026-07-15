import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { act } from "@testing-library/react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";

import { ticketDeskSectionForRoute, TicketDeskSectionSync } from "@/App";

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ user: null, loading: true }),
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@workspace/api-client-react", () => ({
  useGetCurrentMember: () => ({ data: undefined }),
}));

// ── mapping function unit tests ───────────────────────────────────────────────

describe("ticketDeskSectionForRoute — route→section mapping", () => {
  it.each([
    ["/compliance", "compliance"],
    ["/compliance/submit", "compliance"],
    ["/compliance/anything/nested", "compliance"],
  ])("maps %s → %q", (path, expected) => {
    expect(ticketDeskSectionForRoute(path)).toBe(expected);
  });

  it.each([
    ["/concierge", "concierge"],
    ["/concierge/submit", "concierge"],
    ["/concierge/book-va-call", "concierge"],
    ["/concierge/anything/nested", "concierge"],
  ])("maps %s → %q", (path, expected) => {
    expect(ticketDeskSectionForRoute(path)).toBe(expected);
  });

  it.each([
    ["/dashboard"],
    ["/"],
    ["/coaching/sessions"],
    ["/compliancefoo"],
    ["/conciergeabc"],
    ["/login"],
    ["/admin/members"],
    ["/va-calls/book"],
  ])("returns null for %s (default inbox)", (path) => {
    expect(ticketDeskSectionForRoute(path)).toBeNull();
  });
});

// ── seam behavior tests ───────────────────────────────────────────────────────
// Tests mount the real TicketDeskSectionSync component exported from App.tsx
// (not a duplicate helper) and observe window.TicketDeskChat side-effects.

type TicketDeskConfig = Record<string, unknown>;

function renderSync(path: string, ticketDeskChat: TicketDeskConfig) {
  const { hook, navigate } = memoryLocation({ path });
  (window as unknown as Record<string, unknown>).TicketDeskChat = ticketDeskChat;
  const utils = render(
    <Router hook={hook}>
      <TicketDeskSectionSync />
    </Router>,
  );
  return { ...utils, navigate };
}

beforeEach(() => {
  delete (window as unknown as Record<string, unknown>).TicketDeskChat;
});

afterEach(() => {
  cleanup();
  delete (window as unknown as Record<string, unknown>).TicketDeskChat;
});

describe("TicketDeskSectionSync seam — boot-config write", () => {
  it("writes section='compliance' onto boot config when landing on /compliance", () => {
    const config: TicketDeskConfig = { workspaceId: "ws1", apiBase: "https://example.com/api" };
    renderSync("/compliance", config);
    expect(config.section).toBe("compliance");
  });

  it("writes section='concierge' onto boot config when landing on /concierge/submit", () => {
    const config: TicketDeskConfig = { workspaceId: "ws1", apiBase: "https://example.com/api" };
    renderSync("/concierge/submit", config);
    expect(config.section).toBe("concierge");
  });

  it("writes section=null onto boot config for a non-section route", () => {
    const config: TicketDeskConfig = { section: "compliance" };
    renderSync("/dashboard", config);
    expect(config.section).toBeNull();
  });

  it("mutates the existing boot-config object (does not replace it)", () => {
    const config: TicketDeskConfig = { workspaceId: "ws1" };
    (window as unknown as Record<string, unknown>).TicketDeskChat = config;
    renderSync("/compliance", config);
    expect((window as unknown as { TicketDeskChat: unknown }).TicketDeskChat).toBe(config);
  });
});

describe("TicketDeskSectionSync seam — setSection API call", () => {
  it("calls setSection('compliance') when the API is available and route is /compliance", () => {
    const setSection = vi.fn();
    renderSync("/compliance", { setSection });
    expect(setSection).toHaveBeenCalledWith("compliance");
  });

  it("calls setSection('concierge') for /concierge/book-va-call", () => {
    const setSection = vi.fn();
    renderSync("/concierge/book-va-call", { setSection });
    expect(setSection).toHaveBeenCalledWith("concierge");
  });

  it("calls setSection(null) for a non-section route", () => {
    const setSection = vi.fn();
    renderSync("/dashboard", { setSection });
    expect(setSection).toHaveBeenCalledWith(null);
  });

  it("does not throw when setSection is not yet available (late widget load — boot object present but no API)", () => {
    const config: TicketDeskConfig = { workspaceId: "ws1" };
    expect(() => renderSync("/compliance", config)).not.toThrow();
    expect(config.section).toBe("compliance");
  });

  it("does not throw when window.TicketDeskChat is absent (widget not yet loaded at all)", () => {
    // Do NOT call renderSync — that always sets window.TicketDeskChat.
    // Render directly with TicketDeskChat deleted to test the truly-absent path.
    delete (window as unknown as Record<string, unknown>).TicketDeskChat;
    const { hook } = memoryLocation({ path: "/compliance" });
    expect(() =>
      render(
        <Router hook={hook}>
          <TicketDeskSectionSync />
        </Router>,
      ),
    ).not.toThrow();
    expect((window as unknown as Record<string, unknown>).TicketDeskChat).toBeUndefined();
  });
});

describe("TicketDeskSectionSync seam — route navigation updates", () => {
  it("updates section and calls setSection on every route change", () => {
    const setSection = vi.fn();
    const { navigate } = renderSync("/dashboard", { setSection });

    act(() => {
      navigate("/compliance");
    });
    expect(setSection).toHaveBeenLastCalledWith("compliance");

    act(() => {
      navigate("/concierge/submit");
    });
    expect(setSection).toHaveBeenLastCalledWith("concierge");

    act(() => {
      navigate("/dashboard");
    });
    expect(setSection).toHaveBeenLastCalledWith(null);
  });

  it("updates the boot-config section property on navigation", () => {
    const config: TicketDeskConfig = { section: null };
    const { navigate } = renderSync("/dashboard", config);
    expect(config.section).toBeNull();

    act(() => {
      navigate("/compliance");
    });
    expect(config.section).toBe("compliance");

    act(() => {
      navigate("/dashboard");
    });
    expect(config.section).toBeNull();
  });
});
