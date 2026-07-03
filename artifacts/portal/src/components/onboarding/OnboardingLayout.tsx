import { useAuth } from "@/lib/auth";
import { useLocation } from "wouter";

const STEPS = [
  { label: "Welcome", path: "/onboarding/welcome" },
  { label: "Profile", path: "/onboarding/profile" },
  { label: "Book Kickoff", path: "/onboarding/book-kickoff" },
  { label: "Book Partner Call", path: "/onboarding/book-partner-call" },
  { label: "7 Pillars", path: "/onboarding/pillars" },
  { label: "First Call", path: "/onboarding/partner-call-pending" },
];

// Shared 1-indexed step -> route lookup so any onboarding page can forward-
// navigate a member to wherever the server says they currently are (e.g.
// after a booking confirmation advances onboardingStep server-side). Kept
// here since this file already owns the canonical step list used by the
// stepper UI — a second hardcoded copy would drift from it.
export const ONBOARDING_STEP_ROUTES = STEPS.map((s) => s.path);

export function getOnboardingRouteForStep(step: number): string {
  return ONBOARDING_STEP_ROUTES[step - 1] ?? ONBOARDING_STEP_ROUTES[0];
}

export function OnboardingLayout({
  children,
  currentStep,
  onBack,
}: {
  children: React.ReactNode;
  currentStep: number;
  onBack?: () => void;
}) {
  const { user } = useAuth();
  const [, navigate] = useLocation();

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
            <h1 className="font-bold text-sm tracking-tight text-foreground leading-tight">BUILD TEST SCALE</h1>
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
