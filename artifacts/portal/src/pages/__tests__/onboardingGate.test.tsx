import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import type { ReactNode } from "react";

// The route guards call <Redirect to="..." /> when they bounce a user. We
// replace it with a marker node so the test can read *where* the guard tried
// to send the user without needing a real router. Anything else from wouter is
// stubbed loosely so importing App.tsx (which pulls in the whole route tree)
// doesn't blow up.
vi.mock("wouter", () => ({
  Redirect: ({ to }: { to: string }) => (
    <div data-testid="redirect" data-to={to} />
  ),
  useLocation: () => ["/", vi.fn()],
  Switch: ({ children }: { children: ReactNode }) => <>{children}</>,
  Route: () => null,
  Router: ({ children }: { children: ReactNode }) => <>{children}</>,
  Link: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

const authStateMock = vi.fn();
vi.mock("@/lib/auth", () => ({
  useAuth: () => authStateMock(),
  AuthProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

const memberMock = vi.fn<() => { data: unknown; isLoading: boolean }>(() => ({
  data: undefined,
  isLoading: false,
}));
vi.mock("@workspace/api-client-react", () => ({
  useGetCurrentMember: () => memberMock(),
}));

import { ProtectedRoute, OnboardingRoute } from "@/App";

const Target = () => <div data-testid="target-content" />;

// Password is already set (mustChangePassword=false) but onboarding is not yet
// finished — this is the staffer who just cleared the first-login gate.
const onboardingUser = {
  id: 1,
  email: "staff@example.com",
  name: "New Staffer",
  role: "admin",
  onboardingComplete: false,
  onboardingStep: 3,
  mustChangePassword: false,
};

const completedUser = {
  ...onboardingUser,
  onboardingComplete: true,
  onboardingStep: 5,
};

beforeEach(() => {
  authStateMock.mockReset();
  memberMock.mockReset();
  memberMock.mockReturnValue({ data: { role: "admin" }, isLoading: false });
});

describe("onboarding gate — ProtectedRoute sends an incomplete user into the step flow", () => {
  it("redirects to the onboarding step matching onboardingStep and does not render the target", () => {
    authStateMock.mockReturnValue({ user: onboardingUser, loading: false });

    const { getByTestId, queryByTestId } = render(
      <ProtectedRoute component={Target} />,
    );

    // onboardingStep=3 -> STEP_ROUTES[2] -> /onboarding/profile
    expect(getByTestId("redirect")).toHaveAttribute(
      "data-to",
      "/onboarding/profile",
    );
    expect(queryByTestId("target-content")).toBeNull();
  });

  it("falls back to the first step when onboardingStep is missing", () => {
    authStateMock.mockReturnValue({
      user: { ...onboardingUser, onboardingStep: undefined },
      loading: false,
    });

    const { getByTestId, queryByTestId } = render(
      <ProtectedRoute component={Target} />,
    );

    expect(getByTestId("redirect")).toHaveAttribute(
      "data-to",
      "/onboarding/welcome",
    );
    expect(queryByTestId("target-content")).toBeNull();
  });

  it("renders the target once onboarding is complete", () => {
    authStateMock.mockReturnValue({ user: completedUser, loading: false });

    const { getByTestId, queryByTestId } = render(
      <ProtectedRoute component={Target} />,
    );

    expect(getByTestId("target-content")).toBeInTheDocument();
    expect(queryByTestId("redirect")).toBeNull();
  });
});

describe("onboarding gate — OnboardingRoute keeps users on their current step", () => {
  it("redirects a user who already finished onboarding back to /", () => {
    authStateMock.mockReturnValue({ user: completedUser, loading: false });

    const { getByTestId, queryByTestId } = render(
      <OnboardingRoute component={Target} step={3} />,
    );

    expect(getByTestId("redirect")).toHaveAttribute("data-to", "/");
    expect(queryByTestId("target-content")).toBeNull();
  });

  it("redirects to the current step when a later step is requested", () => {
    authStateMock.mockReturnValue({ user: onboardingUser, loading: false });

    // User is on step 3 but tries to open step 5 (quick-start).
    const { getByTestId, queryByTestId } = render(
      <OnboardingRoute component={Target} step={5} />,
    );

    expect(getByTestId("redirect")).toHaveAttribute(
      "data-to",
      "/onboarding/profile",
    );
    expect(queryByTestId("target-content")).toBeNull();
  });

  it("renders the requested step when it is the user's current step", () => {
    authStateMock.mockReturnValue({ user: onboardingUser, loading: false });

    const { getByTestId, queryByTestId } = render(
      <OnboardingRoute component={Target} step={3} />,
    );

    expect(getByTestId("target-content")).toBeInTheDocument();
    expect(queryByTestId("redirect")).toBeNull();
  });

  it("redirects to /login when there is no signed-in user", () => {
    authStateMock.mockReturnValue({ user: null, loading: false });

    const { getByTestId, queryByTestId } = render(
      <OnboardingRoute component={Target} step={1} />,
    );

    expect(getByTestId("redirect")).toHaveAttribute("data-to", "/login");
    expect(queryByTestId("target-content")).toBeNull();
  });
});
