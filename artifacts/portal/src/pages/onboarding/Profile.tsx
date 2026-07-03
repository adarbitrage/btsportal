import { OnboardingLayout } from "@/components/onboarding/OnboardingLayout";
import { useAuth } from "@/lib/auth";
import {
  useGetCurrentMember,
  usePatchMemberProfile,
  usePatchOnboardingStep,
} from "@workspace/api-client-react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useState, useEffect } from "react";

const EXPERIENCE_LEVELS = [
  { value: "complete_beginner", label: "Complete Beginner", desc: "I've never done affiliate marketing" },
  { value: "some_experience", label: "Some Experience", desc: "I've tried a few campaigns but haven't been consistent" },
  { value: "intermediate", label: "Intermediate", desc: "I've generated some revenue but want to scale" },
  { value: "advanced", label: "Advanced", desc: "I have a running business and want to optimize" },
];

const PRIMARY_GOALS = [
  { value: "first_sale", label: "Make My First Sale", desc: "I want to get my first affiliate commission" },
  { value: "replace_income", label: "Replace My Income", desc: "I want to transition to full-time affiliate marketing" },
  { value: "scale_business", label: "Scale My Business", desc: "I already have revenue and want to grow it significantly" },
  { value: "diversify", label: "Diversify Income", desc: "I want to add affiliate marketing as an additional income stream" },
];

export default function OnboardingProfile() {
  const { user, refreshAuth } = useAuth();
  const { data: member, isLoading } = useGetCurrentMember();
  const patchProfile = usePatchMemberProfile();
  const patchOnboarding = usePatchOnboardingStep();
  const [, navigate] = useLocation();

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [timezone, setTimezone] = useState("");
  const [experienceLevel, setExperienceLevel] = useState("");
  const [primaryGoal, setPrimaryGoal] = useState("");
  const [smsOptIn, setSmsOptIn] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (member) {
      setName(member.name || "");
      setPhone(member.phone || "");
      setTimezone(member.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone);
      setExperienceLevel(member.experienceLevel || "");
      setPrimaryGoal(member.primaryGoal || "");
      setSmsOptIn(member.smsOptIn || false);
    }
  }, [member]);

  const canSubmit = name.trim() && experienceLevel && primaryGoal && !submitting;

  const handleSubmit = async () => {
    setError("");
    setSubmitting(true);
    try {
      await patchProfile.mutateAsync({
        data: {
          name: name.trim(),
          phone: phone.trim() || null,
          timezone,
          experienceLevel,
          primaryGoal,
          smsOptIn,
        },
      });
      await patchOnboarding.mutateAsync({ data: { step: 2 } });
      await refreshAuth();
      navigate("/onboarding/book-kickoff");
    } catch (err: any) {
      setError(err?.message || "Failed to save profile. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <OnboardingLayout currentStep={2} onBack={() => navigate("/onboarding/welcome")}>
        <div className="flex items-center justify-center h-64">
          <div className="animate-pulse text-muted-foreground">Loading...</div>
        </div>
      </OnboardingLayout>
    );
  }

  return (
    <OnboardingLayout currentStep={2} onBack={() => navigate("/onboarding/welcome")}>
      <div className="space-y-6">
        <div className="text-center mb-2">
          <h2 className="text-2xl font-bold text-foreground mb-2">Set Up Your Profile</h2>
          <p className="text-muted-foreground">
            Help us personalize your experience by telling us a bit about yourself.
          </p>
        </div>

        <Card>
          <CardContent className="p-6 space-y-5">
            <h3 className="font-semibold text-foreground">Basic Information</h3>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="text-sm font-medium text-muted-foreground block mb-1.5">Full Name</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                />
              </div>
              <div>
                <label className="text-sm font-medium text-muted-foreground block mb-1.5">Phone (optional)</label>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+1 (555) 000-0000"
                  className="w-full px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                />
              </div>
            </div>

            <div>
              <label className="text-sm font-medium text-muted-foreground block mb-1.5">Timezone</label>
              <select
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                className="w-full px-3 py-2 border border-border rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
              >
                {Intl.supportedValuesOf("timeZone").map((tz) => (
                  <option key={tz} value={tz}>
                    {tz.replace(/_/g, " ")}
                  </option>
                ))}
              </select>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6 space-y-4">
            <h3 className="font-semibold text-foreground">Experience Level</h3>
            <div className="grid gap-3">
              {EXPERIENCE_LEVELS.map((level) => (
                <label
                  key={level.value}
                  className={`flex items-start gap-3 p-4 rounded-lg border cursor-pointer transition-all ${
                    experienceLevel === level.value
                      ? "border-primary bg-primary/5 ring-1 ring-primary"
                      : "border-border hover:border-primary/40 hover:bg-secondary/50"
                  }`}
                >
                  <input
                    type="radio"
                    name="experienceLevel"
                    value={level.value}
                    checked={experienceLevel === level.value}
                    onChange={() => setExperienceLevel(level.value)}
                    className="mt-0.5 w-4 h-4 text-primary focus:ring-primary"
                  />
                  <div>
                    <p className="font-medium text-foreground text-sm">{level.label}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{level.desc}</p>
                  </div>
                </label>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6 space-y-4">
            <h3 className="font-semibold text-foreground">Primary Goal</h3>
            <div className="grid gap-3">
              {PRIMARY_GOALS.map((goal) => (
                <label
                  key={goal.value}
                  className={`flex items-start gap-3 p-4 rounded-lg border cursor-pointer transition-all ${
                    primaryGoal === goal.value
                      ? "border-primary bg-primary/5 ring-1 ring-primary"
                      : "border-border hover:border-primary/40 hover:bg-secondary/50"
                  }`}
                >
                  <input
                    type="radio"
                    name="primaryGoal"
                    value={goal.value}
                    checked={primaryGoal === goal.value}
                    onChange={() => setPrimaryGoal(goal.value)}
                    className="mt-0.5 w-4 h-4 text-primary focus:ring-primary"
                  />
                  <div>
                    <p className="font-medium text-foreground text-sm">{goal.label}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{goal.desc}</p>
                  </div>
                </label>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={smsOptIn}
                onChange={(e) => setSmsOptIn(e.target.checked)}
                className="mt-0.5 w-4 h-4 rounded border-gray-300 text-primary focus:ring-primary"
              />
              <div>
                <p className="font-medium text-foreground text-sm">SMS Notifications</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Receive text message notifications about coaching calls, new content, and important
                  updates. Message and data rates may apply. You can opt out at any time.
                </p>
              </div>
            </label>
          </CardContent>
        </Card>

        {error && (
          <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
            {error}
          </div>
        )}

        <div className="flex justify-center">
          <Button size="lg" onClick={handleSubmit} disabled={!canSubmit} className="px-12">
            {submitting ? "Saving..." : "Save & Continue"}
          </Button>
        </div>
      </div>
    </OnboardingLayout>
  );
}
