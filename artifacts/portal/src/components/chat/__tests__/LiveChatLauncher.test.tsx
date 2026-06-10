import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, act } from "@testing-library/react";

import {
  TICKETDESK_WIDGET_SCRIPT_URL,
  TICKETDESK_WIDGET_WORKSPACE_ID,
  TICKETDESK_WIDGET_API_URL,
} from "@/config/support";

// ---------------------------------------------------------------------------
// Mocks shared by the AuthenticatedChatWidget gating tests below.
// ---------------------------------------------------------------------------
const authStateMock = vi.fn(() => ({
  user: { id: 1, role: "member", onboardingComplete: true, onboardingStep: 5 },
  loading: false,
  logout: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useAuth: () => authStateMock(),
}));

const memberMock = vi.fn<() => { data: { entitlements: string[] } | undefined }>(
  () => ({ data: { entitlements: [] } }),
);
vi.mock("@workspace/api-client-react", () => ({
  useGetCurrentMember: () => memberMock(),
}));

const locationMock = vi.fn<() => string>(() => "/dashboard");
vi.mock("wouter", () => ({
  useLocation: () => [locationMock(), vi.fn()],
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock("@/components/chat/ChatWidget", () => ({
  ChatWidget: () => <div data-testid="ai-chat-widget" />,
}));

import { LiveChatLauncher, WIDGET_SCRIPT_ID, WIDGET_STACKED_STYLE_ID } from "@/components/chat/LiveChatLauncher";
import { AuthenticatedChatWidget } from "@/App";

beforeEach(() => {
  authStateMock.mockReset();
  authStateMock.mockImplementation(() => ({
    user: { id: 1, role: "member", onboardingComplete: true, onboardingStep: 5 },
    loading: false,
    logout: vi.fn(),
  }));
  memberMock.mockReset();
  memberMock.mockImplementation(() => ({ data: { entitlements: [] } }));
  locationMock.mockReset();
  locationMock.mockImplementation(() => "/dashboard");
  // Clean up any lingering DOM elements from previous tests.
  document.getElementById(WIDGET_SCRIPT_ID)?.remove();
  document.getElementById(WIDGET_STACKED_STYLE_ID)?.remove();
});

afterEach(() => {
  document.getElementById(WIDGET_SCRIPT_ID)?.remove();
  document.getElementById(WIDGET_STACKED_STYLE_ID)?.remove();
});

describe("LiveChatLauncher — script injection", () => {
  it("injects the widget script tag into document.head on mount", () => {
    render(<LiveChatLauncher />);
    const script = document.getElementById(WIDGET_SCRIPT_ID) as HTMLScriptElement | null;
    expect(script).not.toBeNull();
    expect(script!.tagName).toBe("SCRIPT");
    expect(script!.src).toContain(TICKETDESK_WIDGET_SCRIPT_URL);
    expect(script!.async).toBe(true);
  });

  it("sets the correct data-workspace attribute", () => {
    render(<LiveChatLauncher />);
    const script = document.getElementById(WIDGET_SCRIPT_ID)!;
    expect(script.getAttribute("data-workspace")).toBe(TICKETDESK_WIDGET_WORKSPACE_ID);
  });

  it("sets the correct data-api attribute", () => {
    render(<LiveChatLauncher />);
    const script = document.getElementById(WIDGET_SCRIPT_ID)!;
    expect(script.getAttribute("data-api")).toBe(TICKETDESK_WIDGET_API_URL);
  });

  it("removes the widget script tag from document.head on unmount", () => {
    const { unmount } = render(<LiveChatLauncher />);
    expect(document.getElementById(WIDGET_SCRIPT_ID)).not.toBeNull();
    unmount();
    expect(document.getElementById(WIDGET_SCRIPT_ID)).toBeNull();
  });

  it("renders no DOM output (returns null)", () => {
    const { container } = render(<LiveChatLauncher />);
    expect(container.firstChild).toBeNull();
  });
});

describe("LiveChatLauncher — stacking offset", () => {
  it("does not inject the stacked style when stacked=false", () => {
    render(<LiveChatLauncher stacked={false} />);
    expect(document.getElementById(WIDGET_STACKED_STYLE_ID)).toBeNull();
  });

  it("injects the stacked style when stacked=true", () => {
    render(<LiveChatLauncher stacked />);
    const style = document.getElementById(WIDGET_STACKED_STYLE_ID) as HTMLStyleElement | null;
    expect(style).not.toBeNull();
    expect(style!.textContent).toContain("bottom: 96px");
  });

  it("removes the stacked style on unmount when stacked=true", () => {
    const { unmount } = render(<LiveChatLauncher stacked />);
    expect(document.getElementById(WIDGET_STACKED_STYLE_ID)).not.toBeNull();
    unmount();
    expect(document.getElementById(WIDGET_STACKED_STYLE_ID)).toBeNull();
  });

  it("injects style when stacked changes from false to true", () => {
    const { rerender } = render(<LiveChatLauncher stacked={false} />);
    expect(document.getElementById(WIDGET_STACKED_STYLE_ID)).toBeNull();
    act(() => {
      rerender(<LiveChatLauncher stacked={true} />);
    });
    expect(document.getElementById(WIDGET_STACKED_STYLE_ID)).not.toBeNull();
  });

  it("removes style when stacked changes from true to false", () => {
    const { rerender } = render(<LiveChatLauncher stacked={true} />);
    expect(document.getElementById(WIDGET_STACKED_STYLE_ID)).not.toBeNull();
    act(() => {
      rerender(<LiveChatLauncher stacked={false} />);
    });
    expect(document.getElementById(WIDGET_STACKED_STYLE_ID)).toBeNull();
  });
});

describe("AuthenticatedChatWidget — launcher gating", () => {
  it("injects the widget script for an authenticated, onboarded member", () => {
    render(<AuthenticatedChatWidget />);
    expect(document.getElementById(WIDGET_SCRIPT_ID)).not.toBeNull();
  });

  it("does not inject the stacked style for a member without the chat:ai entitlement", () => {
    memberMock.mockImplementation(() => ({ data: { entitlements: [] } }));
    render(<AuthenticatedChatWidget />);
    expect(document.getElementById(WIDGET_STACKED_STYLE_ID)).toBeNull();
  });

  it("injects the stacked style only when the member holds the chat:ai entitlement", () => {
    memberMock.mockImplementation(() => ({ data: { entitlements: ["chat:ai"] } }));
    const { getByTestId } = render(<AuthenticatedChatWidget />);
    expect(getByTestId("ai-chat-widget")).toBeInTheDocument();
    expect(document.getElementById(WIDGET_STACKED_STYLE_ID)).not.toBeNull();
    const style = document.getElementById(WIDGET_STACKED_STYLE_ID) as HTMLStyleElement;
    expect(style.textContent).toContain("96px");
  });

  it("renders nothing while auth is still loading", () => {
    authStateMock.mockImplementation(() => ({
      user: null,
      loading: true,
      logout: vi.fn(),
    }));
    const { container } = render(<AuthenticatedChatWidget />);
    expect(container.firstChild).toBeNull();
    expect(document.getElementById(WIDGET_SCRIPT_ID)).toBeNull();
  });

  it("renders nothing for a signed-out visitor", () => {
    authStateMock.mockImplementation(() => ({
      user: null,
      loading: false,
      logout: vi.fn(),
    }));
    const { container } = render(<AuthenticatedChatWidget />);
    expect(container.firstChild).toBeNull();
    expect(document.getElementById(WIDGET_SCRIPT_ID)).toBeNull();
  });

  it("renders nothing for a member who has not finished onboarding", () => {
    authStateMock.mockImplementation(() => ({
      user: { id: 1, role: "member", onboardingComplete: false, onboardingStep: 2 },
      loading: false,
      logout: vi.fn(),
    }));
    const { container } = render(<AuthenticatedChatWidget />);
    expect(container.firstChild).toBeNull();
    expect(document.getElementById(WIDGET_SCRIPT_ID)).toBeNull();
  });

  it("does not inject the widget script on auth/onboarding routes", () => {
    locationMock.mockImplementation(() => "/onboarding/profile");
    render(<AuthenticatedChatWidget />);
    expect(document.getElementById(WIDGET_SCRIPT_ID)).toBeNull();
  });
});
