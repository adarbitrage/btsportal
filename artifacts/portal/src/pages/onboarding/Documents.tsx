import { OnboardingLayout } from "@/components/onboarding/OnboardingLayout";
import { useAuth } from "@/lib/auth";
import {
  useGetLegalDocuments,
  useGetOnboardingState,
  useSignDocument,
  usePatchOnboardingStep,
} from "@workspace/api-client-react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useState, useRef, useCallback, useEffect, type UIEvent } from "react";

export default function OnboardingDocuments() {
  const { refreshAuth } = useAuth();
  const { data: documents, isLoading: docsLoading } = useGetLegalDocuments();
  const { data: onboardingState, isLoading: stateLoading } = useGetOnboardingState();
  const signDocument = useSignDocument();
  const patchOnboarding = usePatchOnboardingStep();
  const [, navigate] = useLocation();

  const [scrolledTerms, setScrolledTerms] = useState(false);
  const [agreedTerms, setAgreedTerms] = useState(false);
  const [signature, setSignature] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const termsContainerRef = useRef<HTMLDivElement>(null);

  const isAtBottom = (el: HTMLDivElement) => {
    return el.scrollTop + el.clientHeight >= el.scrollHeight - 8;
  };

  const handleScroll = useCallback(
    (setScrolled: (v: boolean) => void) =>
      (e: UIEvent<HTMLDivElement>) => {
        if (isAtBottom(e.currentTarget)) {
          setScrolled(true);
        }
      },
    []
  );

  // If the rendered content already fits without needing to scroll
  // (or the user lands at the bottom for any reason), mark as scrolled.
  // Also re-check whenever the container's content size changes
  // (e.g. async font/image load expands the document after initial render),
  // so a "short" doc that grows tall correctly relocks the checkbox.
  useEffect(() => {
    const check = () => {
      if (termsContainerRef.current) {
        setScrolledTerms(isAtBottom(termsContainerRef.current));
      }
    };
    const t = window.setTimeout(check, 0);
    window.addEventListener("resize", check);

    const observers: ResizeObserver[] = [];
    if (typeof ResizeObserver !== "undefined") {
      const el = termsContainerRef.current;
      if (el) {
        const ro = new ResizeObserver(check);
        ro.observe(el);
        if (el.firstElementChild) ro.observe(el.firstElementChild);
        observers.push(ro);
      }
    }

    return () => {
      window.clearTimeout(t);
      window.removeEventListener("resize", check);
      for (const ro of observers) ro.disconnect();
    };
  }, [documents]);

  // Mentee/Membership Agreement is no longer signed in-portal — it is
  // executed and stored elsewhere. Onboarding only requires Terms of Service.
  const alreadySigned =
    onboardingState?.signedDocuments &&
    onboardingState.signedDocuments.some((d) => d.documentType === "terms_of_service");

  if (docsLoading || stateLoading) {
    return (
      <OnboardingLayout currentStep={2} onBack={() => navigate("/onboarding/welcome")}>
        <div className="flex items-center justify-center h-64">
          <div className="animate-pulse text-muted-foreground">Loading documents...</div>
        </div>
      </OnboardingLayout>
    );
  }

  if (alreadySigned) {
    const handleContinue = async () => {
      setSubmitting(true);
      try {
        await patchOnboarding.mutateAsync({ data: { step: 2 } });
        await refreshAuth();
        navigate("/onboarding/profile");
      } catch (err: any) {
        if (err?.message?.includes("Cannot complete step") || err?.response?.data?.error?.includes("Cannot complete step")) {
          navigate("/onboarding/profile");
        }
      } finally {
        setSubmitting(false);
      }
    };

    return (
      <OnboardingLayout currentStep={2} onBack={() => navigate("/onboarding/welcome")}>
        <Card>
          <CardContent className="p-8 text-center">
            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-green-600" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
              </svg>
            </div>
            <h3 className="text-xl font-bold text-foreground mb-2">Documents Already Signed</h3>
            <p className="text-muted-foreground mb-2">
              You signed the required documents on{" "}
              {new Date(onboardingState.signedDocuments[0].signedAt).toLocaleDateString()}.
            </p>
            <Button onClick={handleContinue} disabled={submitting} className="mt-4">
              {submitting ? "Continuing..." : "Continue to Profile Setup"}
            </Button>
          </CardContent>
        </Card>
      </OnboardingLayout>
    );
  }

  const terms = documents?.find((d) => d.type === "terms_of_service");

  const today = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const canSubmit = agreedTerms && signature.trim().length >= 2 && !submitting;

  const handleSubmit = async () => {
    setError("");
    setSubmitting(true);
    try {
      if (terms) {
        await signDocument.mutateAsync({
          data: {
            documentType: terms.type,
            documentVersion: terms.version,
            signature: signature.trim(),
          },
        });
      }

      await patchOnboarding.mutateAsync({ data: { step: 2 } });
      await refreshAuth();
      navigate("/onboarding/profile");
    } catch (err: any) {
      setError(err?.message || "Failed to sign documents. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <OnboardingLayout currentStep={2} onBack={() => navigate("/onboarding/welcome")}>
      <div className="space-y-6">
        <div className="text-center mb-2">
          <h2 className="text-2xl font-bold text-foreground mb-2">Review &amp; Sign Terms of Service</h2>
          <p className="text-muted-foreground">
            Please read the Terms of Service carefully. You must scroll to the bottom before you can agree.
          </p>
        </div>

        {terms && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">{terms.title}</CardTitle>
            </CardHeader>
            <CardContent>
              <div
                ref={termsContainerRef}
                onScroll={handleScroll(setScrolledTerms)}
                className="max-h-64 overflow-y-auto border border-border rounded-lg p-4 bg-secondary/30 text-sm leading-relaxed prose prose-sm max-w-none"
              >
                <div dangerouslySetInnerHTML={{ __html: markdownToHtml(terms.content) }} />
              </div>
              <label className="flex items-center gap-3 mt-4">
                <input
                  type="checkbox"
                  checked={agreedTerms}
                  onChange={(e) => setAgreedTerms(e.target.checked)}
                  disabled={!scrolledTerms}
                  className="w-4 h-4 rounded border-gray-300 text-primary focus:ring-primary disabled:opacity-50"
                />
                <span className={`text-sm ${!scrolledTerms ? "text-muted-foreground/50" : "text-foreground"}`}>
                  I have read and agree to the Terms of Service
                  {!scrolledTerms && " (scroll to bottom to enable)"}
                </span>
              </label>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardContent className="p-6">
            <h3 className="font-semibold text-foreground mb-4">Electronic Signature</h3>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="text-sm font-medium text-muted-foreground block mb-1.5">
                  Type Your Full Name
                </label>
                <input
                  type="text"
                  value={signature}
                  onChange={(e) => setSignature(e.target.value)}
                  placeholder="Your full legal name"
                  className="w-full px-3 py-2 border border-border rounded-lg text-lg font-serif italic focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                />
              </div>
              <div>
                <label className="text-sm font-medium text-muted-foreground block mb-1.5">
                  Date
                </label>
                <input
                  type="text"
                  value={today}
                  readOnly
                  className="w-full px-3 py-2 border border-border rounded-lg bg-secondary/50 text-muted-foreground"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {error && (
          <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
            {error}
          </div>
        )}

        <div className="flex justify-center">
          <Button
            size="lg"
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="px-12"
          >
            {submitting ? "Signing..." : "Sign & Continue"}
          </Button>
        </div>
      </div>
    </OnboardingLayout>
  );
}

function markdownToHtml(md: string): string {
  return md
    .replace(/^### (.*$)/gm, "<h3>$1</h3>")
    .replace(/^## (.*$)/gm, "<h2>$1</h2>")
    .replace(/^# (.*$)/gm, "<h1>$1</h1>")
    .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.*?)\*/g, "<em>$1</em>")
    .replace(/^- (.*$)/gm, "<li>$1</li>")
    .replace(/(<li>.*<\/li>)/s, "<ul>$1</ul>")
    .replace(/\n\n/g, "<br/><br/>")
    .replace(/\n/g, "<br/>");
}
