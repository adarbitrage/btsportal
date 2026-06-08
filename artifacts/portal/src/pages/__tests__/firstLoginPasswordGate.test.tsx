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

import { ProtectedRoute, PasswordChangeRoute } from "@/App";
import { AdminRoute } from "@/components/auth/AdminRoute";

const Target = () => <div data-testid="target-content" />;

const flaggedUser = {
  id: 1,
  email: "staff@example.com",
  name: "New Staffer",
  role: "admin",
  onboardingComplete: true,
  onboardingStep: 5,
  mustChangePassword: true,
};

const clearedUser = {
  ...flaggedUser,
  mustChangePassword: false,
};

beforeEach(() => {
  authStateMock.mockReset();
  memberMock.mockReset();
  memberMock.mockReturnValue({ data: { role: "admin" }, isLoading: false });
});

describe("first-login password gate — route guards", () => {
  it("ProtectedRoute redirects a flagged user to /change-password and does not render the target", () => {
    authStateMock.mockReturnValue({ user: flaggedUser, loading: false });

    const { getByTestId, queryByTestId } = render(
      <ProtectedRoute component={Target} />,
    );

    expect(getByTestId("redirect")).toHaveAttribute("data-to", "/change-password");
    expect(queryByTestId("target-content")).toBeNull();
  });

  it("AdminRoute redirects a flagged user to /change-password and does not render the target", () => {
    authStateMock.mockReturnValue({ user: flaggedUser, loading: false });

    const { getByTestId, queryByTestId } = render(
      <AdminRoute component={Target} />,
    );

    expect(getByTestId("redirect")).toHaveAttribute("data-to", "/change-password");
    expect(queryByTestId("target-content")).toBeNull();
  });

  it("ProtectedRoute renders the target once the flag is cleared", () => {
    authStateMock.mockReturnValue({ user: clearedUser, loading: false });

    const { getByTestId, queryByTestId } = render(
      <ProtectedRoute component={Target} />,
    );

    expect(getByTestId("target-content")).toBeInTheDocument();
    expect(queryByTestId("redirect")).toBeNull();
  });
});

describe("first-login password gate — /change-password reachability", () => {
  it("PasswordChangeRoute renders the change-password screen while the flag is set", () => {
    authStateMock.mockReturnValue({ user: flaggedUser, loading: false });

    const { getByTestId, queryByTestId } = render(
      <PasswordChangeRoute component={Target} />,
    );

    expect(getByTestId("target-content")).toBeInTheDocument();
    expect(queryByTestId("redirect")).toBeNull();
  });

  it("PasswordChangeRoute redirects to / when the flag is not set", () => {
    authStateMock.mockReturnValue({ user: clearedUser, loading: false });

    const { getByTestId, queryByTestId } = render(
      <PasswordChangeRoute component={Target} />,
    );

    expect(getByTestId("redirect")).toHaveAttribute("data-to", "/");
    expect(queryByTestId("target-content")).toBeNull();
  });

  it("PasswordChangeRoute redirects to /login when there is no signed-in user", () => {
    authStateMock.mockReturnValue({ user: null, loading: false });

    const { getByTestId, queryByTestId } = render(
      <PasswordChangeRoute component={Target} />,
    );

    expect(getByTestId("redirect")).toHaveAttribute("data-to", "/login");
    expect(queryByTestId("target-content")).toBeNull();
  });
});
