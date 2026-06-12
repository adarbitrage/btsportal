import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";

// The coach mentee detail page has a "Send Message" button that starts (or
// continues) a DM thread with the mentee and then navigates to that thread at
// `/coach/messages/:threadId`. This test pins that wiring: clicking the button
// must call the start-thread mutation with the mentee's userId, and on success
// must navigate to the new thread. A future refactor that drops the userId or
// changes the navigation target would break the coach->mentee messaging entry
// point silently, so we lock it here.
//
// We follow the page-test mocking pattern used elsewhere in the portal: stub
// AppLayout, wouter (params + navigation), the DM hook (useStartThread), and
// the mentee detail query (useGetCoachMenteeDetail).

const mockNavigate = vi.fn();
vi.mock("wouter", () => ({
  useParams: () => ({ userId: "42" }),
  useLocation: () => ["/coach/mentees/42", mockNavigate],
  Link: ({ children, href, ...rest }: { children: ReactNode; href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock("@/components/layout/AppLayout", () => ({
  AppLayout: ({ children }: { children: ReactNode }) => (
    <div data-testid="app-layout-stub">{children}</div>
  ),
}));

vi.mock("@/components/coaching/StatusPill", () => ({
  StatusPill: ({ status }: { status: string }) => (
    <span data-testid="status-pill">{status}</span>
  ),
}));

const startThreadMutate = vi.fn();
let startThreadPending = false;
vi.mock("@/hooks/use-dm", () => ({
  useStartThread: () => ({ mutate: startThreadMutate, isPending: startThreadPending }),
}));

const useGetCoachMenteeDetail = vi.fn();
vi.mock("@workspace/api-client-react", () => ({
  useGetCoachMenteeDetail: (...args: unknown[]) => useGetCoachMenteeDetail(...args),
}));

const baseMentee = {
  name: "Jane Mentee",
  email: "jane@example.com",
  tier_name: "Pro",
  status: "active",
  joined_at: "2025-01-15T00:00:00.000Z",
  last_active_at: "2025-06-01T00:00:00.000Z",
  blitz_completion_pct: 50,
  daily_streak: 3,
  current_section: { id: 5, name: "Build your offer" },
  phase_breakdown: [
    {
      key: "intro",
      label: "Intro",
      completed_sections: 1,
      total_sections: 2,
      completion_pct: 50,
    },
  ],
  section_completion: [
    {
      section_id: 1,
      step: "Step 1",
      name: "Welcome",
      completed: true,
      completed_at: "2025-02-01T00:00:00.000Z",
    },
    {
      section_id: 2,
      step: "Step 2",
      name: "Setup",
      completed: false,
      completed_at: null,
    },
  ],
  recent_events: [],
};

import MenteeDetail from "@/pages/coaching/MenteeDetail";

beforeEach(() => {
  mockNavigate.mockReset();
  startThreadMutate.mockReset();
  startThreadPending = false;
  useGetCoachMenteeDetail.mockReset().mockReturnValue({
    data: baseMentee,
    isLoading: false,
    isError: false,
  });
});

describe("MenteeDetail — Send Message button", () => {
  it("starts a DM thread with the mentee's userId and navigates to the new thread", async () => {
    startThreadMutate.mockImplementation(
      (recipientId: number, opts?: { onSuccess?: (thread: { id: number }) => void }) => {
        opts?.onSuccess?.({ id: 99 });
      },
    );

    render(<MenteeDetail />);

    await userEvent.click(await screen.findByRole("button", { name: /send message/i }));

    expect(startThreadMutate).toHaveBeenCalledTimes(1);
    expect(startThreadMutate.mock.calls[0][0]).toBe(42);

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith("/coach/messages/99");
    });
  });

  it("does not navigate when the start-thread mutation has not succeeded yet", async () => {
    startThreadMutate.mockImplementation(() => {
      // pending: no onSuccess fired
    });

    render(<MenteeDetail />);

    await userEvent.click(await screen.findByRole("button", { name: /send message/i }));

    expect(startThreadMutate).toHaveBeenCalledTimes(1);
    expect(startThreadMutate.mock.calls[0][0]).toBe(42);
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});
