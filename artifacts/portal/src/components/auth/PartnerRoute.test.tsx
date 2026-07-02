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

import { PartnerRoute } from "./PartnerRoute";

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

describe("PartnerRoute", () => {
  it("redirects to /login when there is no authenticated user", () => {
    setAuth(null);
    setMember(null);

    render(<PartnerRoute component={ProtectedComponent} />);

    expect(screen.getByTestId("redirect")).toHaveAttribute("data-to", "/login");
    expect(screen.queryByTestId("protected-component")).toBeNull();
  });

  it("redirects regular members to /", () => {
    setAuth({ role: "free_member" });
    setMember({ role: "free_member" });

    render(<PartnerRoute component={ProtectedComponent} />);

    expect(screen.getByTestId("redirect")).toHaveAttribute("data-to", "/");
    expect(screen.queryByTestId("protected-component")).toBeNull();
  });

  it("redirects a coach (no partner or admin access) to /", () => {
    setAuth({ role: "coach" });
    setMember({ role: "coach" });

    render(<PartnerRoute component={ProtectedComponent} />);

    expect(screen.getByTestId("redirect")).toHaveAttribute("data-to", "/");
    expect(screen.queryByTestId("protected-component")).toBeNull();
  });

  it("renders the protected component when the auth user is a partner", () => {
    setAuth({ role: "partner" });
    setMember({ role: "free_member" });

    render(<PartnerRoute component={ProtectedComponent} />);

    expect(screen.getByTestId("protected-component")).toBeInTheDocument();
    expect(screen.queryByTestId("redirect")).toBeNull();
  });

  it("renders the protected component when the member profile is a partner", () => {
    setAuth({ role: "free_member" });
    setMember({ role: "partner" });

    render(<PartnerRoute component={ProtectedComponent} />);

    expect(screen.getByTestId("protected-component")).toBeInTheDocument();
    expect(screen.queryByTestId("redirect")).toBeNull();
  });

  it("renders the protected component for an admin with partners:view", () => {
    setAuth({ role: "super_admin" });
    setMember({ role: "free_member" });

    render(<PartnerRoute component={ProtectedComponent} />);

    expect(screen.getByTestId("protected-component")).toBeInTheDocument();
    expect(screen.queryByTestId("redirect")).toBeNull();
  });

  it("redirects an admin role that lacks partners:view to /", () => {
    // content_manager is an admin role but does not have partners:view.
    setAuth({ role: "content_manager" });
    setMember({ role: "free_member" });

    render(<PartnerRoute component={ProtectedComponent} />);

    expect(screen.getByTestId("redirect")).toHaveAttribute("data-to", "/");
    expect(screen.queryByTestId("protected-component")).toBeNull();
  });

  it("shows the loading spinner while auth is still loading", () => {
    setAuth(null, true);
    setMember(null);

    render(<PartnerRoute component={ProtectedComponent} />);

    expect(screen.getByText("Loading...")).toBeInTheDocument();
    expect(screen.queryByTestId("protected-component")).toBeNull();
    expect(screen.queryByTestId("redirect")).toBeNull();
  });

  it("shows the loading spinner while the member profile is still loading", () => {
    setAuth({ role: "partner" });
    setMember(null, true);

    render(<PartnerRoute component={ProtectedComponent} />);

    expect(screen.getByText("Loading...")).toBeInTheDocument();
    expect(screen.queryByTestId("protected-component")).toBeNull();
  });
});
