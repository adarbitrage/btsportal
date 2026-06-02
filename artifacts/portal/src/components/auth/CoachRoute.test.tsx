import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const useAuthMock = vi.fn();
const useGetCurrentMemberMock = vi.fn();
const redirectMock = vi.fn(({ to }: { to: string }) => (
  <div data-testid="redirect" data-to={to} />
));

vi.mock("@/lib/auth", () => ({
  useAuth: () => useAuthMock(),
}));

vi.mock("@workspace/api-client-react", () => ({
  useGetCurrentMember: () => useGetCurrentMemberMock(),
}));

vi.mock("wouter", () => ({
  Redirect: (props: { to: string }) => redirectMock(props),
}));

import { CoachRoute } from "./CoachRoute";

const ProtectedComponent = () => (
  <div data-testid="protected-component">protected</div>
);

beforeEach(() => {
  useAuthMock.mockReset();
  useGetCurrentMemberMock.mockReset();
  redirectMock.mockClear();
});

function setAuth(user: { role?: string } | null, loading = false) {
  useAuthMock.mockReturnValue({ user, loading });
}

function setMember(member: { role?: string } | null, isLoading = false) {
  useGetCurrentMemberMock.mockReturnValue({ data: member, isLoading });
}

describe("CoachRoute", () => {
  it("redirects to /login when there is no authenticated user", () => {
    setAuth(null);
    setMember(null);

    render(<CoachRoute component={ProtectedComponent} />);

    expect(screen.getByTestId("redirect")).toHaveAttribute("data-to", "/login");
    expect(screen.queryByTestId("protected-component")).toBeNull();
  });

  it("redirects regular members to /", () => {
    setAuth({ role: "free_member" });
    setMember({ role: "free_member" });

    render(<CoachRoute component={ProtectedComponent} />);

    expect(screen.getByTestId("redirect")).toHaveAttribute("data-to", "/");
    expect(screen.queryByTestId("protected-component")).toBeNull();
  });

  it("renders the protected component when the auth user is a coach", () => {
    setAuth({ role: "coach" });
    setMember({ role: "free_member" });

    render(<CoachRoute component={ProtectedComponent} />);

    expect(screen.getByTestId("protected-component")).toBeInTheDocument();
    expect(screen.queryByTestId("redirect")).toBeNull();
  });

  it("renders the protected component when the member profile is a coach", () => {
    setAuth({ role: "free_member" });
    setMember({ role: "coach" });

    render(<CoachRoute component={ProtectedComponent} />);

    expect(screen.getByTestId("protected-component")).toBeInTheDocument();
    expect(screen.queryByTestId("redirect")).toBeNull();
  });

  it("renders the protected component for an admin with coaching:view permission", () => {
    setAuth({ role: "super_admin" });
    setMember({ role: "free_member" });

    render(<CoachRoute component={ProtectedComponent} />);

    expect(screen.getByTestId("protected-component")).toBeInTheDocument();
    expect(screen.queryByTestId("redirect")).toBeNull();
  });

  it("renders the protected component when only the member profile is an admin with coaching:view", () => {
    setAuth({ role: "free_member" });
    setMember({ role: "admin" });

    render(<CoachRoute component={ProtectedComponent} />);

    expect(screen.getByTestId("protected-component")).toBeInTheDocument();
    expect(screen.queryByTestId("redirect")).toBeNull();
  });

  it("redirects an admin role that lacks coaching:view to /", () => {
    // support_agent is an admin role but does not have coaching:view.
    setAuth({ role: "support_agent" });
    setMember({ role: "free_member" });

    render(<CoachRoute component={ProtectedComponent} />);

    expect(screen.getByTestId("redirect")).toHaveAttribute("data-to", "/");
    expect(screen.queryByTestId("protected-component")).toBeNull();
  });

  it("shows the loading spinner while auth is still loading", () => {
    setAuth(null, true);
    setMember(null);

    render(<CoachRoute component={ProtectedComponent} />);

    expect(screen.getByText("Loading...")).toBeInTheDocument();
    expect(screen.queryByTestId("protected-component")).toBeNull();
    expect(screen.queryByTestId("redirect")).toBeNull();
  });

  it("shows the loading spinner while the member profile is still loading", () => {
    setAuth({ role: "coach" });
    setMember(null, true);

    render(<CoachRoute component={ProtectedComponent} />);

    expect(screen.getByText("Loading...")).toBeInTheDocument();
    expect(screen.queryByTestId("protected-component")).toBeNull();
  });
});
