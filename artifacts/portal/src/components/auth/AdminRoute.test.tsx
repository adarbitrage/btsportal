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

vi.mock("@/pages/AccessDenied", () => ({
  default: ({ permission }: { permission?: string }) => (
    <div data-testid="access-denied" data-permission={permission ?? ""} />
  ),
}));

import { AdminRoute } from "./AdminRoute";

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

describe("AdminRoute", () => {
  it("redirects to /login when there is no authenticated user", () => {
    setAuth(null);
    setMember(null);

    render(<AdminRoute component={ProtectedComponent} />);

    expect(screen.getByTestId("redirect")).toHaveAttribute("data-to", "/login");
    expect(screen.queryByTestId("protected-component")).toBeNull();
  });

  it("renders the protected component when only the auth user is admin", () => {
    setAuth({ role: "super_admin" });
    setMember({ role: "free_member" });

    render(<AdminRoute component={ProtectedComponent} />);

    expect(screen.getByTestId("protected-component")).toBeInTheDocument();
    expect(screen.queryByTestId("redirect")).toBeNull();
  });

  it("renders the protected component when only the member profile is admin", () => {
    setAuth({ role: "free_member" });
    setMember({ role: "admin" });

    render(<AdminRoute component={ProtectedComponent} />);

    expect(screen.getByTestId("protected-component")).toBeInTheDocument();
    expect(screen.queryByTestId("redirect")).toBeNull();
  });

  it("redirects to / when neither the auth user nor the member profile is admin", () => {
    setAuth({ role: "free_member" });
    setMember({ role: "free_member" });

    render(<AdminRoute component={ProtectedComponent} />);

    expect(screen.getByTestId("redirect")).toHaveAttribute("data-to", "/");
    expect(screen.queryByTestId("protected-component")).toBeNull();
  });

  it("redirects to / when the member profile has not loaded a role yet but auth is not admin", () => {
    setAuth({ role: "free_member" });
    setMember({});

    render(<AdminRoute component={ProtectedComponent} />);

    expect(screen.getByTestId("redirect")).toHaveAttribute("data-to", "/");
  });

  it("redirects a partner-role user to / (partner is not an admin role)", () => {
    setAuth({ role: "partner" });
    setMember({ role: "free_member" });

    render(<AdminRoute component={ProtectedComponent} />);

    expect(screen.getByTestId("redirect")).toHaveAttribute("data-to", "/");
    expect(screen.queryByTestId("protected-component")).toBeNull();
  });

  it("checks the required permission against the resolved admin role from the auth user", () => {
    // super_admin (auth) has every permission. member-only role would be a
    // non-admin, so this proves the guard uses the auth role for the
    // permission check, not just the member profile.
    setAuth({ role: "super_admin" });
    setMember({ role: "free_member" });

    render(
      <AdminRoute component={ProtectedComponent} permission="audit:view" />,
    );

    expect(screen.getByTestId("protected-component")).toBeInTheDocument();
    expect(screen.queryByTestId("access-denied")).toBeNull();
  });

  it("checks the required permission against the resolved admin role from the member profile", () => {
    setAuth({ role: "free_member" });
    setMember({ role: "super_admin" });

    render(
      <AdminRoute component={ProtectedComponent} permission="audit:view" />,
    );

    expect(screen.getByTestId("protected-component")).toBeInTheDocument();
    expect(screen.queryByTestId("access-denied")).toBeNull();
  });

  it("shows AccessDenied when the resolved admin role does not have the required permission", () => {
    // support_agent is an admin role but doesn't include revenue:view.
    setAuth({ role: "support_agent" });
    setMember({ role: "free_member" });

    render(
      <AdminRoute component={ProtectedComponent} permission="revenue:view" />,
    );

    const denied = screen.getByTestId("access-denied");
    expect(denied).toBeInTheDocument();
    expect(denied).toHaveAttribute("data-permission", "revenue:view");
    expect(screen.queryByTestId("protected-component")).toBeNull();
  });

  it("shows the loading spinner while auth is still loading", () => {
    setAuth(null, true);
    setMember(null);

    render(<AdminRoute component={ProtectedComponent} />);

    expect(screen.getByText("Loading...")).toBeInTheDocument();
    expect(screen.queryByTestId("protected-component")).toBeNull();
    expect(screen.queryByTestId("redirect")).toBeNull();
  });

  it("shows the loading spinner while the member profile is still loading", () => {
    setAuth({ role: "admin" });
    setMember(null, true);

    render(<AdminRoute component={ProtectedComponent} />);

    expect(screen.getByText("Loading...")).toBeInTheDocument();
    expect(screen.queryByTestId("protected-component")).toBeNull();
  });
});
