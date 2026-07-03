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

import {
  ProtectedRoute,
  OnboardingRoute,
  EntitlementRoute,
  GuestRoute,
  PasswordChangeRoute,
} from "@/App";

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

    // onboardingStep=3 -> STEP_ROUTES[2] -> /onboarding/book-kickoff
    expect(getByTestId("redirect")).toHaveAttribute(
      "data-to",
      "/onboarding/book-kickoff",
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
      <OnboardingRoute component={Target} step={2} />,
    );

    expect(getByTestId("redirect")).toHaveAttribute("data-to", "/");
    expect(queryByTestId("target-content")).toBeNull();
  });

  it("redirects to the current step when a later step is requested", () => {
    authStateMock.mockReturnValue({ user: onboardingUser, loading: false });

    // User is on step 3 (book-kickoff) but tries to open step 5 (pillars).
    const { getByTestId, queryByTestId } = render(
      <OnboardingRoute component={Target} step={4} />,
    );

    expect(getByTestId("redirect")).toHaveAttribute(
      "data-to",
      "/onboarding/book-kickoff",
    );
    expect(queryByTestId("target-content")).toBeNull();
  });

  it("renders the requested step when it is the user's current step", () => {
    authStateMock.mockReturnValue({ user: onboardingUser, loading: false });

    const { getByTestId, queryByTestId } = render(
      <OnboardingRoute component={Target} step={2} />,
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

describe("onboarding gate — EntitlementRoute runs the first-login and onboarding guards before the entitlement check", () => {
  it("redirects a mustChangePassword user to /change-password (before any entitlement check)", () => {
    authStateMock.mockReturnValue({
      user: { ...completedUser, mustChangePassword: true },
      loading: false,
    });
    // Member has the entitlement, but the first-login gate must win.
    memberMock.mockReturnValue({
      data: { role: "admin", entitlements: ["community:access"] },
      isLoading: false,
    });

    const { getByTestId, queryByTestId } = render(
      <EntitlementRoute component={Target} entitlement="community:access" />,
    );

    expect(getByTestId("redirect")).toHaveAttribute(
      "data-to",
      "/change-password",
    );
    expect(queryByTestId("target-content")).toBeNull();
  });

  it("redirects an onboarding-incomplete user into their step before the entitlement check runs", () => {
    authStateMock.mockReturnValue({ user: onboardingUser, loading: false });
    // Member has the entitlement, but onboarding must complete first.
    memberMock.mockReturnValue({
      data: { role: "admin", entitlements: ["community:access"] },
      isLoading: false,
    });

    const { getByTestId, queryByTestId } = render(
      <EntitlementRoute component={Target} entitlement="community:access" />,
    );

    // onboardingStep=3 -> STEP_ROUTES[2] -> /onboarding/book-kickoff, NOT "/"
    expect(getByTestId("redirect")).toHaveAttribute(
      "data-to",
      "/onboarding/book-kickoff",
    );
    expect(queryByTestId("target-content")).toBeNull();
  });

  it("redirects a fully-onboarded member without the required entitlement to /", () => {
    // A regular member (no admin role on either source) without the entitlement.
    authStateMock.mockReturnValue({
      user: { ...completedUser, role: "member" },
      loading: false,
    });
    memberMock.mockReturnValue({
      data: { role: "member", entitlements: [] },
      isLoading: false,
    });

    const { getByTestId, queryByTestId } = render(
      <EntitlementRoute component={Target} entitlement="community:access" />,
    );

    expect(getByTestId("redirect")).toHaveAttribute("data-to", "/");
    expect(queryByTestId("target-content")).toBeNull();
  });

  it("renders the target for an admin even without the entitlement (staff bypass via auth role)", () => {
    // super_admin/admin staff often have no purchased products (empty
    // entitlements) but must still reach every gated member page.
    authStateMock.mockReturnValue({
      user: { ...completedUser, role: "super_admin" },
      loading: false,
    });
    memberMock.mockReturnValue({
      data: { role: "member", entitlements: [] },
      isLoading: false,
    });

    const { getByTestId, queryByTestId } = render(
      <EntitlementRoute component={Target} entitlement="coaching:one_on_one:*" />,
    );

    expect(getByTestId("target-content")).toBeInTheDocument();
    expect(queryByTestId("redirect")).toBeNull();
  });

  it("renders the target when the admin role comes from the member source (staff bypass via member role)", () => {
    authStateMock.mockReturnValue({
      user: { ...completedUser, role: "member" },
      loading: false,
    });
    memberMock.mockReturnValue({
      data: { role: "super_admin", entitlements: [] },
      isLoading: false,
    });

    const { getByTestId, queryByTestId } = render(
      <EntitlementRoute component={Target} entitlement="community:access" />,
    );

    expect(getByTestId("target-content")).toBeInTheDocument();
    expect(queryByTestId("redirect")).toBeNull();
  });

  it("renders the target for a fully-onboarded user who has the entitlement", () => {
    authStateMock.mockReturnValue({ user: completedUser, loading: false });
    memberMock.mockReturnValue({
      data: { role: "admin", entitlements: ["community:access"] },
      isLoading: false,
    });

    const { getByTestId, queryByTestId } = render(
      <EntitlementRoute component={Target} entitlement="community:access" />,
    );

    expect(getByTestId("target-content")).toBeInTheDocument();
    expect(queryByTestId("redirect")).toBeNull();
  });

  it("matches a wildcard entitlement against a specific granted scope", () => {
    authStateMock.mockReturnValue({ user: completedUser, loading: false });
    memberMock.mockReturnValue({
      data: { role: "admin", entitlements: ["coaching:one_on_one:gold"] },
      isLoading: false,
    });

    const { getByTestId, queryByTestId } = render(
      <EntitlementRoute component={Target} entitlement="coaching:one_on_one:*" />,
    );

    expect(getByTestId("target-content")).toBeInTheDocument();
    expect(queryByTestId("redirect")).toBeNull();
  });
});

// While auth (and, for EntitlementRoute, the member query) is still resolving,
// every guard must hold on the loading spinner: it must NOT render the gated
// target page (which would briefly expose gated content) and must NOT fire a
// <Redirect> (which would bounce a user who is actually allowed in). These
// tests pin that "neither target nor redirect while loading" contract.
describe("route guards block the page while auth/entitlement data is still loading", () => {
  it("ProtectedRoute renders neither the target nor a redirect while loading", () => {
    // A *complete* user is supplied so that, if the loading branch were ever
    // skipped, the target would render — proving the loading branch wins.
    authStateMock.mockReturnValue({ user: completedUser, loading: true });

    const { queryByTestId } = render(<ProtectedRoute component={Target} />);

    expect(queryByTestId("target-content")).toBeNull();
    expect(queryByTestId("redirect")).toBeNull();
  });

  it("OnboardingRoute renders neither the target nor a redirect while loading", () => {
    authStateMock.mockReturnValue({ user: onboardingUser, loading: true });

    const { queryByTestId } = render(
      <OnboardingRoute component={Target} step={3} />,
    );

    expect(queryByTestId("target-content")).toBeNull();
    expect(queryByTestId("redirect")).toBeNull();
  });

  it("EntitlementRoute renders neither the target nor a redirect while auth is loading", () => {
    authStateMock.mockReturnValue({ user: completedUser, loading: true });
    // Member is fully resolved with the entitlement; only auth is still loading.
    memberMock.mockReturnValue({
      data: { role: "admin", entitlements: ["community:access"] },
      isLoading: false,
    });

    const { queryByTestId } = render(
      <EntitlementRoute component={Target} entitlement="community:access" />,
    );

    expect(queryByTestId("target-content")).toBeNull();
    expect(queryByTestId("redirect")).toBeNull();
  });

  it("EntitlementRoute stays in the loading state while the member query is loading (even after auth resolves)", () => {
    // Auth has resolved to a fully-onboarded user, but the member/entitlement
    // query is still in flight — the guard must wait rather than evaluate the
    // entitlement against undefined data and bounce the user to "/".
    authStateMock.mockReturnValue({ user: completedUser, loading: false });
    memberMock.mockReturnValue({ data: undefined, isLoading: true });

    const { queryByTestId } = render(
      <EntitlementRoute component={Target} entitlement="community:access" />,
    );

    expect(queryByTestId("target-content")).toBeNull();
    expect(queryByTestId("redirect")).toBeNull();
  });

  it("GuestRoute renders neither the target nor a redirect while loading", () => {
    // A signed-in, fully-onboarded user is supplied: if the loading branch were
    // skipped, GuestRoute would fire a <Redirect to="/"> and flash a bounce.
    // Holding on loading means neither the login screen nor a redirect shows.
    authStateMock.mockReturnValue({ user: completedUser, loading: true });

    const { queryByTestId } = render(<GuestRoute component={Target} />);

    expect(queryByTestId("target-content")).toBeNull();
    expect(queryByTestId("redirect")).toBeNull();
  });

  it("PasswordChangeRoute renders neither the target nor a redirect while loading", () => {
    // A user who still must change their password is supplied: if the loading
    // branch were skipped, the forced change-password screen would render before
    // auth settles. Holding on loading shows neither the screen nor a redirect.
    authStateMock.mockReturnValue({
      user: { ...completedUser, mustChangePassword: true },
      loading: true,
    });

    const { queryByTestId } = render(
      <PasswordChangeRoute component={Target} />,
    );

    expect(queryByTestId("target-content")).toBeNull();
    expect(queryByTestId("redirect")).toBeNull();
  });
});

// GuestRoute fronts the login / register / forgot-password screens. A signed-out
// visitor must reach the screen; an already-signed-in visitor must be bounced to
// wherever they belong (the first-login gate, their onboarding step, or the
// dashboard) so they can't re-open the auth screens once authenticated.
describe("GuestRoute — lets signed-out users in and bounces signed-in users to where they belong", () => {
  it("renders the target (login/register/etc.) for a signed-out visitor", () => {
    authStateMock.mockReturnValue({ user: null, loading: false });

    const { getByTestId, queryByTestId } = render(
      <GuestRoute component={Target} />,
    );

    expect(getByTestId("target-content")).toBeInTheDocument();
    expect(queryByTestId("redirect")).toBeNull();
  });

  it("redirects a signed-in mustChangePassword user to /change-password", () => {
    authStateMock.mockReturnValue({
      user: { ...completedUser, mustChangePassword: true },
      loading: false,
    });

    const { getByTestId, queryByTestId } = render(
      <GuestRoute component={Target} />,
    );

    expect(getByTestId("redirect")).toHaveAttribute(
      "data-to",
      "/change-password",
    );
    expect(queryByTestId("target-content")).toBeNull();
  });

  it("redirects a signed-in onboarding-incomplete user into their current step", () => {
    authStateMock.mockReturnValue({ user: onboardingUser, loading: false });

    const { getByTestId, queryByTestId } = render(
      <GuestRoute component={Target} />,
    );

    // onboardingStep=3 -> STEP_ROUTES[2] -> /onboarding/book-kickoff
    expect(getByTestId("redirect")).toHaveAttribute(
      "data-to",
      "/onboarding/book-kickoff",
    );
    expect(queryByTestId("target-content")).toBeNull();
  });

  it("falls back to the first onboarding step when onboardingStep is missing", () => {
    authStateMock.mockReturnValue({
      user: { ...onboardingUser, onboardingStep: undefined },
      loading: false,
    });

    const { getByTestId, queryByTestId } = render(
      <GuestRoute component={Target} />,
    );

    expect(getByTestId("redirect")).toHaveAttribute(
      "data-to",
      "/onboarding/welcome",
    );
    expect(queryByTestId("target-content")).toBeNull();
  });

  it("redirects a fully-onboarded signed-in user to /", () => {
    authStateMock.mockReturnValue({ user: completedUser, loading: false });

    const { getByTestId, queryByTestId } = render(
      <GuestRoute component={Target} />,
    );

    expect(getByTestId("redirect")).toHaveAttribute("data-to", "/");
    expect(queryByTestId("target-content")).toBeNull();
  });
});

// PasswordChangeRoute gates the forced first-login change-password screen. Only a
// signed-in user who still carries the temporary password (mustChangePassword)
// may reach it; everyone else is bounced so the screen can't be opened outside
// the intended flow.
describe("PasswordChangeRoute — only a mustChangePassword user reaches the forced screen", () => {
  it("renders the change-password screen for a mustChangePassword user", () => {
    authStateMock.mockReturnValue({
      user: { ...completedUser, mustChangePassword: true },
      loading: false,
    });

    const { getByTestId, queryByTestId } = render(
      <PasswordChangeRoute component={Target} />,
    );

    expect(getByTestId("target-content")).toBeInTheDocument();
    expect(queryByTestId("redirect")).toBeNull();
  });

  it("redirects to /login when there is no signed-in user", () => {
    authStateMock.mockReturnValue({ user: null, loading: false });

    const { getByTestId, queryByTestId } = render(
      <PasswordChangeRoute component={Target} />,
    );

    expect(getByTestId("redirect")).toHaveAttribute("data-to", "/login");
    expect(queryByTestId("target-content")).toBeNull();
  });

  it("redirects to / when the user's password is already set", () => {
    authStateMock.mockReturnValue({ user: completedUser, loading: false });

    const { getByTestId, queryByTestId } = render(
      <PasswordChangeRoute component={Target} />,
    );

    expect(getByTestId("redirect")).toHaveAttribute("data-to", "/");
    expect(queryByTestId("target-content")).toBeNull();
  });
});
