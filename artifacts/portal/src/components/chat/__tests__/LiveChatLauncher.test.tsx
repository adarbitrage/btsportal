import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, fireEvent, act } from "@testing-library/react";

const TICKETDESK_URL = "https://tickets.buildtestscale.com/";

// ---------------------------------------------------------------------------
// Mocks shared by the AuthenticatedChatWidget gating tests below.
//
// AuthenticatedChatWidget lives in App.tsx and decides *whether* the launcher
// renders (authenticated + onboarded members only) and *whether* it stacks
// above the AI ChatWidget (only when the member holds the chat:ai
// entitlement). We mock the data sources it reads but keep the real
// LiveChatLauncher so we exercise the actual button + URL + positioning.
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

// The AI ChatWidget is a heavy component with its own data hooks; stub it so we
// can focus on the live-chat launcher's presence and stacking.
vi.mock("@/components/chat/ChatWidget", () => ({
  ChatWidget: () => <div data-testid="ai-chat-widget" />,
}));

import { LiveChatLauncher } from "@/components/chat/LiveChatLauncher";
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
});

describe("LiveChatLauncher — component", () => {
  it("renders a bottom-right launcher button", () => {
    const { getByRole } = render(<LiveChatLauncher />);
    const button = getByRole("button", { name: /open live chat support/i });
    expect(button).toBeInTheDocument();
    expect(button.className).toContain("fixed");
    expect(button.className).toContain("right-6");
    expect(button.className).toContain("bottom-6");
  });

  it("opens an embedded panel pointing at the TicketDesk URL when clicked", () => {
    const { getByRole, getByTitle } = render(<LiveChatLauncher />);
    fireEvent.click(getByRole("button", { name: /open live chat support/i }));
    const iframe = getByTitle("Live Chat Support");
    expect(iframe.tagName).toBe("IFRAME");
    expect(iframe).toHaveAttribute("src", TICKETDESK_URL);
  });

  it("opens the TicketDesk URL in a new tab from the external-link control", () => {
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    const { getByRole, getByTitle } = render(<LiveChatLauncher />);
    fireEvent.click(getByRole("button", { name: /open live chat support/i }));
    fireEvent.click(getByTitle("Open in new tab"));
    expect(openSpy).toHaveBeenCalledWith(
      TICKETDESK_URL,
      "_blank",
      "noopener,noreferrer",
    );
    openSpy.mockRestore();
  });

  it("sits at the default height when not stacked", () => {
    const { getByRole } = render(<LiveChatLauncher stacked={false} />);
    const button = getByRole("button", { name: /open live chat support/i });
    expect(button.className).toContain("bottom-6");
    expect(button.className).not.toContain("bottom-24");
  });

  it("lifts above the AI ChatWidget when stacked", () => {
    const { getByRole } = render(<LiveChatLauncher stacked />);
    const button = getByRole("button", { name: /open live chat support/i });
    expect(button.className).toContain("bottom-24");
    expect(button.className).not.toContain("bottom-6");
  });
});

// ---------------------------------------------------------------------------
// Load-failure fallback.
//
// The embedded panel gives TicketDesk an 8s window to load before flipping to
// the "couldn't load here / Open Live Chat" fallback (it also flips immediately
// on an iframe `error` event). That fallback is the only thing standing between
// a member and a dead blank panel if TicketDesk ever starts refusing to be
// framed (X-Frame-Options / CSP frame-ancestors), so it must keep rendering and
// its escape-hatch button must keep opening the real URL in a new tab. The
// matching e2e spec asserts TicketDesk is *currently* embeddable; these tests
// assert the portal degrades gracefully if that ever changes.
// ---------------------------------------------------------------------------
describe("LiveChatLauncher — load-failure fallback", () => {
  const openPanel = (getByRole: ReturnType<typeof render>["getByRole"]) => {
    fireEvent.click(getByRole("button", { name: /open live chat support/i }));
  };

  it("shows the fallback when the iframe never loads within the 8s timeout", () => {
    vi.useFakeTimers();
    try {
      const { getByRole, getByText, getByTitle, queryByText, queryByTitle } =
        render(<LiveChatLauncher />);
      openPanel(getByRole);
      // Before the timeout elapses the panel is still trying to load (the live
      // iframe and the loading spinner are present, no fallback yet).
      expect(getByTitle("Live Chat Support")).toBeInTheDocument();
      expect(queryByText(/couldn't load here/i)).toBeNull();

      act(() => {
        vi.advanceTimersByTime(8000);
      });

      expect(getByText(/couldn't load here/i)).toBeInTheDocument();
      expect(
        getByRole("button", { name: /^open live chat$/i }),
      ).toBeInTheDocument();
      // The dead iframe is unmounted so the member isn't staring at a blank frame.
      expect(queryByTitle("Live Chat Support")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("opens the TicketDesk URL in a new tab from the fallback button", () => {
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    vi.useFakeTimers();
    try {
      const { getByRole } = render(<LiveChatLauncher />);
      openPanel(getByRole);
      act(() => {
        vi.advanceTimersByTime(8000);
      });
      fireEvent.click(getByRole("button", { name: /^open live chat$/i }));
      expect(openSpy).toHaveBeenCalledWith(
        TICKETDESK_URL,
        "_blank",
        "noopener,noreferrer",
      );
    } finally {
      vi.useRealTimers();
      openSpy.mockRestore();
    }
  });

  it("does not show the fallback when the iframe loads before the timeout", () => {
    vi.useFakeTimers();
    try {
      const { getByRole, getByTitle, queryByText } = render(<LiveChatLauncher />);
      openPanel(getByRole);
      fireEvent.load(getByTitle("Live Chat Support"));
      act(() => {
        vi.advanceTimersByTime(8000);
      });
      expect(queryByText(/couldn't load here/i)).toBeNull();
      expect(getByTitle("Live Chat Support")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("AuthenticatedChatWidget — launcher gating", () => {
  it("renders the live-chat launcher for an authenticated, onboarded member", () => {
    const { getByRole } = render(<AuthenticatedChatWidget />);
    expect(
      getByRole("button", { name: /open live chat support/i }),
    ).toBeInTheDocument();
  });

  it("does not stack the launcher for a member without the chat:ai entitlement", () => {
    memberMock.mockImplementation(() => ({ data: { entitlements: [] } }));
    const { getByRole } = render(<AuthenticatedChatWidget />);
    const button = getByRole("button", { name: /open live chat support/i });
    expect(button.className).toContain("bottom-6");
    expect(button.className).not.toContain("bottom-24");
  });

  it("stacks the launcher above the AI ChatWidget only with the chat:ai entitlement", () => {
    memberMock.mockImplementation(() => ({ data: { entitlements: ["chat:ai"] } }));
    const { getByRole, getByTestId } = render(<AuthenticatedChatWidget />);
    const button = getByRole("button", { name: /open live chat support/i });
    expect(getByTestId("ai-chat-widget")).toBeInTheDocument();
    expect(button.className).toContain("bottom-24");
    expect(button.className).not.toContain("bottom-6");
  });

  it("renders nothing while auth is still loading", () => {
    authStateMock.mockImplementation(() => ({
      user: null,
      loading: true,
      logout: vi.fn(),
    }));
    const { container } = render(<AuthenticatedChatWidget />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing for a signed-out visitor", () => {
    authStateMock.mockImplementation(() => ({
      user: null,
      loading: false,
      logout: vi.fn(),
    }));
    const { container } = render(<AuthenticatedChatWidget />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing for a member who has not finished onboarding", () => {
    authStateMock.mockImplementation(() => ({
      user: { id: 1, role: "member", onboardingComplete: false, onboardingStep: 2 },
      loading: false,
      logout: vi.fn(),
    }));
    const { container } = render(<AuthenticatedChatWidget />);
    expect(container.firstChild).toBeNull();
  });

  it("hides the launcher on auth/onboarding routes", () => {
    locationMock.mockImplementation(() => "/onboarding/profile");
    const { container } = render(<AuthenticatedChatWidget />);
    expect(container.firstChild).toBeNull();
  });
});
