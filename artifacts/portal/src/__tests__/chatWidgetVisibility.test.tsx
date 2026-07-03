import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { act } from "@testing-library/react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";

// The AI ChatWidget is suppressed on auth/onboarding screens.
// This is driven by `isChatWidgetHiddenRoute` (the single source of truth for
// which routes hide the widget) and applied in `AuthenticatedChatWidget`, which
// returns null on those routes.
// These tests pin both layers so a future refactor of the route list can't
// silently bring the widget back on login/onboarding.

const authStateMock = vi.fn<() => { user: unknown; loading: boolean }>();
vi.mock("@/lib/auth", () => ({
  useAuth: () => authStateMock(),
  AuthProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

const memberMock = vi.fn<() => { data: unknown }>(() => ({ data: undefined }));
vi.mock("@workspace/api-client-react", () => ({
  useGetCurrentMember: () => memberMock(),
}));

vi.mock("@/components/chat/ChatWidget", () => ({
  ChatWidget: () => <div data-testid="chat-widget" />,
}));

import { isChatWidgetHiddenRoute, AuthenticatedChatWidget } from "@/App";

const completedUser = {
  id: 1,
  email: "member@example.com",
  name: "Member",
  role: "member",
  onboardingComplete: true,
  onboardingStep: 5,
  mustChangePassword: false,
};

beforeEach(() => {
  authStateMock.mockReset();
  memberMock.mockReset();
  authStateMock.mockReturnValue({ user: completedUser, loading: false });
  memberMock.mockReturnValue({ data: { entitlements: [] } });
});

afterEach(() => {
  cleanup();
});

function renderAt(path: string) {
  const { hook, navigate } = memoryLocation({ path });
  const utils = render(
    <Router hook={hook}>
      <AuthenticatedChatWidget />
    </Router>,
  );
  return { ...utils, navigate };
}

describe("isChatWidgetHiddenRoute — route list that suppresses the chat widget", () => {
  it.each([
    ["/login"],
    ["/forgot-password"],
    ["/reset-password"],
    ["/onboarding/welcome"],
    ["/onboarding/profile"],
  ])("returns true for %s", (path) => {
    expect(isChatWidgetHiddenRoute(path)).toBe(true);
  });

  it("returns false for a normal authenticated route", () => {
    expect(isChatWidgetHiddenRoute("/dashboard")).toBe(false);
  });
});

describe("AuthenticatedChatWidget — does not render on auth/onboarding routes", () => {
  it.each([
    ["/login"],
    ["/forgot-password"],
    ["/reset-password"],
    ["/onboarding/welcome"],
  ])("renders nothing on %s", (path) => {
    const { queryByTestId } = renderAt(path);
    expect(queryByTestId("chat-widget")).toBeNull();
  });

  it("renders the AI chat widget on a normal authenticated route", () => {
    const { queryByTestId } = renderAt("/dashboard");
    expect(queryByTestId("chat-widget")).not.toBeNull();
  });

  it("removes the widget when navigating from a normal route to a hidden route", () => {
    const { queryByTestId, navigate } = renderAt("/dashboard");
    expect(queryByTestId("chat-widget")).not.toBeNull();

    act(() => {
      navigate("/onboarding/profile");
    });
    expect(queryByTestId("chat-widget")).toBeNull();
  });

  it("restores the widget when navigating from a hidden route to a normal route", () => {
    const { queryByTestId, navigate } = renderAt("/login");
    expect(queryByTestId("chat-widget")).toBeNull();

    act(() => {
      navigate("/dashboard");
    });
    expect(queryByTestId("chat-widget")).not.toBeNull();
  });
});
