import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// Task #1708: on the onboarding Profile step, the SMS-checked/phone-empty
// conflict must actively guide the member to the phone field instead of just
// silently disabling "Save & Continue" (which is invisible on mobile, where
// the phone field is scrolled off-screen). The button stays enabled when
// this is the only blocker; tapping it (or checking the SMS box while the
// phone is empty) smooth-scrolls the phone field into view, focuses it, and
// shows the inline error instead of navigating forward.

const navigate = vi.fn();
vi.mock("wouter", () => ({
  useLocation: () => ["/onboarding/profile", navigate],
}));

const refreshAuth = vi.fn();
vi.mock("@/lib/auth", () => ({
  useAuth: () => ({
    user: { name: "Test Member", onboardingStep: 1, onboardingVariant: "full" },
    refreshAuth,
  }),
}));

// The mocked member object must be a STABLE reference across renders — the
// real component's `useEffect(() => {...}, [member])` re-syncs local state
// from `member` whenever the dependency changes. A fresh literal on every
// call would make the effect refire on each re-render and clobber whatever
// the member just typed/toggled, which doesn't reflect how the real
// generated query hook behaves (it returns a cached, stable object).
const memberData = {
  name: "Test Member",
  phone: "",
  timezone: "America/New_York",
  experienceLevel: "intermediate",
  primaryGoal: "scale_business",
  smsOptIn: false,
};

const patchProfileMutateAsync = vi.fn();
const patchOnboardingMutateAsync = vi.fn();
vi.mock("@workspace/api-client-react", () => ({
  useGetCurrentMember: () => ({
    data: memberData,
    isLoading: false,
  }),
  usePatchMemberProfile: () => ({ mutateAsync: patchProfileMutateAsync }),
  usePatchOnboardingStep: () => ({ mutateAsync: patchOnboardingMutateAsync }),
}));

import OnboardingProfile from "@/pages/onboarding/Profile";

beforeEach(() => {
  navigate.mockReset();
  refreshAuth.mockReset();
  patchProfileMutateAsync.mockReset();
  patchOnboardingMutateAsync.mockReset();
});

describe("Profile step — SMS/phone conflict mobile guidance", () => {
  it("checking SMS with an empty phone scrolls the phone field into view and focuses it", () => {
    render(<OnboardingProfile />);

    const phoneInput = screen.getByPlaceholderText("+1 (555) 000-0000") as HTMLInputElement;
    const scrollSpy = vi.spyOn(phoneInput, "scrollIntoView");

    const smsCheckbox = screen.getByRole("checkbox");
    fireEvent.click(smsCheckbox);

    expect(scrollSpy).toHaveBeenCalledWith(
      expect.objectContaining({ behavior: "smooth", block: "center" }),
    );
    expect(phoneInput).toHaveFocus();
  });

  it("tapping Save & Continue with the conflict scrolls/focuses the phone field, shows the inline error, and does not navigate", async () => {
    render(<OnboardingProfile />);

    const phoneInput = screen.getByPlaceholderText("+1 (555) 000-0000") as HTMLInputElement;
    const scrollSpy = vi.spyOn(phoneInput, "scrollIntoView");

    fireEvent.click(screen.getByRole("checkbox"));
    scrollSpy.mockClear();

    const saveButton = screen.getByRole("button", { name: /save & continue/i });
    expect(saveButton).not.toBeDisabled();

    fireEvent.click(saveButton);

    expect(scrollSpy).toHaveBeenCalledWith(
      expect.objectContaining({ behavior: "smooth", block: "center" }),
    );
    expect(phoneInput).toHaveFocus();
    expect(
      screen.getByText(
        "Add a phone number to receive text reminders — or uncheck SMS notifications",
      ),
    ).toBeInTheDocument();

    await waitFor(() => {
      expect(patchProfileMutateAsync).not.toHaveBeenCalled();
    });
    expect(navigate).not.toHaveBeenCalled();
  });

  it("proceeds and navigates forward once a phone number is entered", async () => {
    patchProfileMutateAsync.mockResolvedValue({});
    patchOnboardingMutateAsync.mockResolvedValue({ currentStep: 2 });

    render(<OnboardingProfile />);

    fireEvent.click(screen.getByRole("checkbox"));
    const phoneInput = screen.getByPlaceholderText("+1 (555) 000-0000") as HTMLInputElement;
    fireEvent.change(phoneInput, { target: { value: "5551234567" } });

    const saveButton = screen.getByRole("button", { name: /save & continue/i });
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(patchProfileMutateAsync).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(navigate).toHaveBeenCalled();
    });
  });
});
