import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";

// Regression coverage for the 7-Pillars onboarding-step exception in
// ContentAccessRoute (Task #1624 renumbered onboarding from 7 to 6 steps;
// "Watch the 7 Pillars" moved from step 6 to step 5). A member sitting on
// that exact step must be able to open /core-training/7-pillars from the
// onboarding CTA without being bounced back into onboarding.

const authStateMock = vi.fn<() => { user: unknown; loading: boolean }>();
vi.mock("@/lib/auth", () => ({
  useAuth: () => authStateMock(),
  AuthProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

const memberMock = vi.fn<() => { data: unknown; isLoading: boolean }>();
vi.mock("@workspace/api-client-react", () => ({
  useGetCurrentMember: () => memberMock(),
}));

const contentAccessMock = vi.fn<
  () => { accessiblePageKeys: Set<string>; isLoading: boolean; isError: boolean }
>();
vi.mock("@/hooks/use-content-access", () => ({
  useContentAccess: () => contentAccessMock(),
}));

import { ContentAccessRoute } from "@/App";

function TestPage() {
  return <div data-testid="seven-pillars-page">7 Pillars content</div>;
}

function makeUser(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    email: "member@example.com",
    name: "Member",
    role: "member",
    onboardingComplete: false,
    onboardingStep: 5,
    mustChangePassword: false,
    ...overrides,
  };
}

beforeEach(() => {
  authStateMock.mockReset();
  memberMock.mockReset();
  contentAccessMock.mockReset();
  memberMock.mockReturnValue({ data: { entitlements: [] }, isLoading: false });
  contentAccessMock.mockReturnValue({
    accessiblePageKeys: new Set(["seven-pillars"]),
    isLoading: false,
    isError: false,
  });
});

afterEach(() => {
  cleanup();
});

function renderRoute(path = "/core-training/7-pillars") {
  const { hook } = memoryLocation({ path });
  return render(
    <Router hook={hook}>
      <ContentAccessRoute component={TestPage} pageKey="seven-pillars" />
    </Router>,
  );
}

describe("ContentAccessRoute — 7 Pillars onboarding-step exception (step 5)", () => {
  it("lets a member sitting exactly on onboarding step 5 open the 7 Pillars page", () => {
    authStateMock.mockReturnValue({ user: makeUser({ onboardingStep: 5, onboardingComplete: false }), loading: false });
    renderRoute();
    expect(screen.getByTestId("seven-pillars-page")).toBeInTheDocument();
  });

  it("redirects a member on an earlier onboarding step back into onboarding", () => {
    authStateMock.mockReturnValue({ user: makeUser({ onboardingStep: 3, onboardingComplete: false }), loading: false });
    renderRoute();
    expect(screen.queryByTestId("seven-pillars-page")).not.toBeInTheDocument();
  });

  it("does not apply the exception once onboarding is complete (normal content-access gating applies instead)", () => {
    authStateMock.mockReturnValue({ user: makeUser({ onboardingStep: 6, onboardingComplete: true }), loading: false });
    renderRoute();
    expect(screen.getByTestId("seven-pillars-page")).toBeInTheDocument();
  });
});
