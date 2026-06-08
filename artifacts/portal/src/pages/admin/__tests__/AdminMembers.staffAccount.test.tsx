import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";

vi.mock("@/components/layout/AdminLayout", () => ({
  AdminLayout: ({ children }: { children: ReactNode }) => (
    <div data-testid="admin-layout-stub">{children}</div>
  ),
}));

const getMembers = vi.fn();
const getMemberExternalSources = vi.fn();
const createStaffAccount = vi.fn();
vi.mock("@/lib/admin-panel-api", () => ({
  adminPanelApi: {
    getMembers: (...args: unknown[]) => getMembers(...args),
    getMemberExternalSources: (...args: unknown[]) =>
      getMemberExternalSources(...args),
    createStaffAccount: (...args: unknown[]) => createStaffAccount(...args),
    createMember: vi.fn(),
    exportData: vi.fn(),
  },
  saveBlobAsFile: vi.fn(),
}));

const toast = vi.fn();
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast }),
}));

// The current admin viewing the page; role is overridden per-test via
// `currentRole` so we can exercise both the super_admin (button shown)
// and non-super_admin (button hidden) paths against the real permission
// matrix from @workspace/auth.
let currentRole = "super_admin";
vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ user: { id: 99, role: currentRole } }),
}));

const navigate = vi.fn();
vi.mock("wouter", () => ({
  useLocation: () => ["/admin/members", navigate],
  Link: ({ children, href, ...rest }: { children: ReactNode; href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import AdminMembers from "@/pages/admin/AdminMembers";

const emptyMembersResponse = {
  members: [],
  pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
};

beforeEach(() => {
  currentRole = "super_admin";
  getMembers.mockReset();
  getMemberExternalSources.mockReset();
  createStaffAccount.mockReset();
  toast.mockReset();
  navigate.mockReset();
  getMembers.mockResolvedValue(emptyMembersResponse);
  getMemberExternalSources.mockResolvedValue({ sources: [] });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("AdminMembers — staff-account creation flow", () => {
  it("shows the Create Staff Account button and opens the dialog for a super_admin", async () => {
    render(<AdminMembers />);

    const button = await screen.findByTestId("button-add-staff");
    expect(button).toHaveTextContent("Create Staff Account");

    await userEvent.click(button);

    const dialog = await screen.findByTestId("dialog-add-staff");
    expect(dialog).toHaveTextContent("Create a staff account");
    expect(within(dialog).getByTestId("input-new-staff-name")).toBeInTheDocument();
    expect(within(dialog).getByTestId("input-new-staff-email")).toBeInTheDocument();
    expect(within(dialog).getByTestId("select-new-staff-role")).toBeInTheDocument();
  });

  it("hides the Create Staff Account button for non-super_admin roles", async () => {
    currentRole = "support_agent";

    render(<AdminMembers />);

    // Wait for the initial member load to resolve so we don't assert
    // against a still-mounting component.
    await waitFor(() => expect(getMembers).toHaveBeenCalled());

    expect(screen.queryByTestId("button-add-staff")).not.toBeInTheDocument();
  });

  it("shows the one-time temporary password and copy control after a successful create", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    createStaffAccount.mockResolvedValue({
      id: 7,
      email: "newstaff@example.com",
      name: "New Staff",
      role: "support_agent",
      temporaryPassword: "Temp-Pass-1234",
    });

    render(<AdminMembers />);

    await userEvent.click(await screen.findByTestId("button-add-staff"));

    const dialog = await screen.findByTestId("dialog-add-staff");
    await userEvent.type(
      within(dialog).getByTestId("input-new-staff-name"),
      "New Staff",
    );
    await userEvent.type(
      within(dialog).getByTestId("input-new-staff-email"),
      "newstaff@example.com",
    );

    await userEvent.click(within(dialog).getByTestId("button-confirm-add-staff"));

    await waitFor(() =>
      expect(createStaffAccount).toHaveBeenCalledWith({
        email: "newstaff@example.com",
        name: "New Staff",
        role: "support_agent",
      }),
    );

    // The credentials dialog surfaces the one-time temporary password.
    const credentials = await screen.findByTestId("dialog-staff-credentials");
    expect(credentials).toHaveTextContent("Staff account created");
    expect(within(credentials).getByTestId("text-staff-temp-password")).toHaveTextContent(
      "Temp-Pass-1234",
    );

    // The copy control writes the temporary password to the clipboard.
    await userEvent.click(
      within(credentials).getByTestId("button-copy-staff-password"),
    );
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith("Temp-Pass-1234"),
    );
  });
});
