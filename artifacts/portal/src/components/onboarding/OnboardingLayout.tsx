import { useAuth } from "@/lib/auth";
import { useLocation } from "wouter";

// Per-tier step-name arrays (Task #1640). MUST be kept in lockstep with
// FULL_STEP_NAMES / LAUNCHPAD_STEP_NAMES in
// artifacts/api-server/src/lib/onboarding-steps.ts — the frontend and
// api-server are separate packages with no shared step-contract module, so
// this is a deliberate, documented duplication rather than an import.
export type OnboardingStepName =
  | "welcome"
  | "profile"
  | "kickoff_booked"
  | "partner_call_booked"
  | "pillars_watched"
  | "partner_call_completed";

const FULL_STEP_NAMES: readonly OnboardingStepName[] = [
  "welcome",
  "profile",
  "kickoff_booked",
  "partner_call_booked",
  "pillars_watched",
  "partner_call_completed",
];

const LAUNCHPAD_STEP_NAMES: readonly OnboardingStepName[] = [
  "welcome",
  "profile",
  "kickoff_booked",
  "pillars_watched",
];

const STEP_META: Record<OnboardingStepName, { label: string; path: string }> = {
  welcome: { label: "Welcome", path: "/onboarding/welcome" },
  profile: { label: "Profile", path: "/onboarding/profile" },
  kickoff_booked: { label: "Book Kickoff", path: "/onboarding/book-kickoff" },
  partner_call_booked: { label: "Book Partner Call", path: "/onboarding/book-partner-call" },
  pillars_watched: { label: "7 Pillars", path: "/onboarding/pillars" },
  partner_call_completed: { label: "First Call", path: "/onboarding/partner-call-pending" },
};

// "none" and unset/unknown variants fall back to "full" — every existing
// member predates this column (default "full" server-side), and any brand
// new render before the auth payload settles should not crash the stepper.
export function getStepNamesForVariant(
  variant: string | null | undefined,
): readonly OnboardingStepName[] {
  return variant === "launchpad" ? LAUNCHPAD_STEP_NAMES : FULL_STEP_NAMES;
}

// Shared 1-indexed step -> route lookup so any onboarding page can forward-
// navigate a member to wherever the server says they currently are (e.g.
// after a booking confirmation advances onboardingStep server-side). Must be
// given the member's variant since the same step NUMBER maps to a different
// page for launchpad vs full members past step 3.
export function getOnboardingRouteForStep(step: number, variant?: string | null): string {
  const names = getStepNamesForVariant(variant);
  const name = names[step - 1] ?? names[0];
  return STEP_META[name].path;
}

export function OnboardingLayout({
  children,
  stepName,
  onBack,
}: {
  children: React.ReactNode;
  stepName: OnboardingStepName;
  onBack?: () => void;
}) {
  const { user } = useAuth();
  const [, navigate] = useLocation();

  const stepNames = getStepNamesForVariant(user?.onboardingVariant);
  const STEPS = stepNames.map((name) => STEP_META[name]);
  const currentStep = stepNames.indexOf(stepName) + 1 || 1;

  return (
    <div className="min-h-screen bg-[#faf9f7] flex flex-col">
      <header className="bg-white border-b border-border/50 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <img
            src={`${import.meta.env.BASE_URL}images/bts-logo.png`}
            alt="Build Test Scale"
            className="h-10 w-10 object-contain"
          />
          <div>
            <h1 className="font-bold text-sm tracking-tight text-foreground leading-tight">BUILD TEST SCALE™</h1>
            <p className="text-[10px] text-muted-foreground tracking-widest uppercase">Member Setup</p>
          </div>
        </div>
        {user && (
          <p className="text-sm text-muted-foreground">
            {user.name}
          </p>
        )}
      </header>

      <div className="w-full max-w-3xl mx-auto px-6 pt-8 pb-4">
        <p className="text-center text-xs font-semibold tracking-widest uppercase text-primary mb-4" data-testid="onboarding-step-indicator">
          Step {currentStep} of {STEPS.length}
        </p>
        <div className="flex items-center justify-between mb-2">
          {STEPS.map((step, index) => {
            const stepNum = index + 1;
            const isComplete = stepNum < currentStep;
            const isCurrent = stepNum === currentStep;
            const isAccessible = stepNum <= (user?.onboardingStep || 1);

            return (
              <div key={step.label} className="flex items-center flex-1 last:flex-none">
                <div className="flex flex-col items-center">
                  <div
                    className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold transition-all ${
                      isComplete
                        ? "bg-green-500 text-white"
                        : isCurrent
                        ? "bg-primary text-white ring-4 ring-primary/20"
                        : "bg-gray-200 text-gray-500"
                    } ${isAccessible && !isCurrent ? "cursor-pointer hover:ring-2 hover:ring-primary/30" : ""}`}
                    onClick={() => {
                      if (isAccessible && !isCurrent) {
                        navigate(STEPS[index].path);
                      }
                    }}
                  >
                    {isComplete ? (
                      <svg className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                    ) : (
                      stepNum
                    )}
                  </div>
                  <span className={`text-[10px] mt-1.5 font-medium whitespace-nowrap ${isCurrent ? "text-primary" : isComplete ? "text-green-600" : "text-muted-foreground"}`}>
                    {step.label}
                  </span>
                </div>
                {index < STEPS.length - 1 && (
                  <div className={`flex-1 h-0.5 mx-2 mt-[-14px] ${isComplete ? "bg-green-500" : "bg-gray-200"}`} />
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex-1 w-full max-w-3xl mx-auto px-6 pb-12">
        {onBack && currentStep > 1 && (
          <button
            onClick={onBack}
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-4 transition-colors"
          >
            <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clipRule="evenodd" />
            </svg>
            Back
          </button>
        )}
        {children}
      </div>
    </div>
  );
}
