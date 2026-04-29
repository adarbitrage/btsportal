import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  Crown,
  Check,
  X as XIcon,
  Sparkles,
  ArrowLeft,
  Loader2,
  PartyPopper,
  Star,
  ArrowUpRight,
} from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  useGetCurrentMember,
  useListPlans,
  useStartMemberCheckout,
  getGetCurrentMemberQueryKey,
  getGetMemberEntitlementsQueryKey,
  getGetMemberProductsQueryKey,
  type Plan,
  type StartMemberCheckoutResponse,
} from "@workspace/api-client-react";
import { cn } from "@/lib/utils";
import { getProductDisplayName } from "@/components/layout/sidebar-nav";
import { PRODUCT_RANK } from "@/lib/upgrade-plans";

const COMPARISON_FEATURES: Array<{ key: string; label: string }> = [
  { key: "software:base", label: "BTS app suite & compliance review" },
  { key: "software:expanded", label: "Expanded software access" },
  { key: "coaching:group", label: "Group coaching calls" },
  { key: "coaching:mastermind", label: "Mastermind coaching" },
  { key: "coaching:one_on_one:monthly", label: "Monthly 1-on-1 coaching" },
  { key: "coaching:one_on_one:weekly", label: "Weekly 1-on-1 coaching" },
  { key: "community:access", label: "Member community" },
  { key: "commissions:entry", label: "Affiliate commissions" },
  { key: "support:unlimited", label: "Unlimited support" },
  { key: "support:vip", label: "VIP support" },
  { key: "access:lifetime", label: "Lifetime access" },
];

function extractErrorMessage(error: unknown): string {
  // The generated client throws ApiError on non-2xx responses with the parsed
  // JSON body on `.data` (see lib/api-client-react/src/custom-fetch.ts). We
  // surface the server-provided `error` string when present and fall back to
  // a generic message rather than letting the user see "[object Object]".
  if (typeof error === "object" && error !== null) {
    const maybeData = (error as { data?: unknown }).data;
    if (typeof maybeData === "object" && maybeData !== null) {
      const msg = (maybeData as { error?: unknown }).error;
      if (typeof msg === "string" && msg.trim()) return msg;
    }
  }
  return "We couldn't start checkout. Please try again or contact support.";
}

function useQueryParam(name: string): string | null {
  const [location] = useLocation();
  return useMemo(() => {
    const queryStart = location.indexOf("?");
    const search = queryStart >= 0
      ? location.slice(queryStart)
      : typeof window !== "undefined" ? window.location.search : "";
    if (!search) return null;
    return new URLSearchParams(search).get(name);
  }, [location, name]);
}

export default function Plans() {
  const { data: member } = useGetCurrentMember();
  const { data: plansData, isLoading: plansLoading, isError: plansError } = useListPlans();
  const plans: Plan[] = useMemo(
    () => (plansData ? [...plansData].sort((a, b) => a.rank - b.rank) : []),
    [plansData],
  );
  const currentSlug = member?.sourceProduct ?? "free";
  const currentRank = PRODUCT_RANK[currentSlug] ?? 0;
  const highlightSlug = useQueryParam("highlight");
  const upgradedFlag = useQueryParam("upgraded");
  const highlightedRef = useRef<HTMLDivElement | null>(null);
  const queryClient = useQueryClient();

  // Per-card pending state so we can disable just the button being clicked
  // (the cart redirect is async and the user could otherwise mash other cards
  // while waiting for the redirect to fire).
  const [pendingSlug, setPendingSlug] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const checkoutMutation = useStartMemberCheckout({
    mutation: {
      onError: (error: unknown) => {
        setPendingSlug(null);
        setErrorMessage(extractErrorMessage(error));
      },
    },
  });

  useEffect(() => {
    if (highlightSlug && highlightedRef.current) {
      highlightedRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [highlightSlug, plans.length]);

  // When the cart bounces a successful buyer back here with `?upgraded=1`,
  // refetch member-scoped data so the dashboard / sidebar / current-tier
  // badge reflect the new entitlements as soon as the webhook lands. The
  // webhook is what actually grants access — this just re-pulls it.
  useEffect(() => {
    if (!upgradedFlag) return;
    queryClient.invalidateQueries({ queryKey: getGetCurrentMemberQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetMemberEntitlementsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetMemberProductsQueryKey() });
  }, [upgradedFlag, queryClient]);

  const handleUpgrade = (planSlug: string) => {
    setErrorMessage(null);
    setPendingSlug(planSlug);
    checkoutMutation.mutate(
      { data: { planSlug, returnPath: "/plans?upgraded=1" } },
      {
        onSuccess: (resp: StartMemberCheckoutResponse) => {
          // Full-page navigation (not in-app routing) — we're leaving the SPA
          // for the cart provider's hosted checkout and need the browser to
          // actually load that origin.
          window.location.href = resp.checkoutUrl;
        },
      },
    );
  };

  return (
    <AppLayout>
      <div className="space-y-8" data-testid="plans-page">
        <div>
          <Link href="/dashboard">
            <Button
              variant="ghost"
              size="sm"
              className="mb-4 -ml-2"
              data-testid="plans-back-button"
            >
              <ArrowLeft className="w-4 h-4 mr-1" />
              Back to dashboard
            </Button>
          </Link>
          <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Sparkles className="w-6 h-6 text-primary" />
                <h1 className="text-2xl sm:text-3xl font-bold text-foreground">
                  Upgrade your BTS membership
                </h1>
              </div>
              <p className="text-muted-foreground max-w-2xl">
                Compare what's included at each tier and pick the level that fits where
                you're going. Upgrades unlock new training, coaching, software, and
                commissions.
              </p>
            </div>
            <div className="text-sm text-muted-foreground" data-testid="plans-current-tier">
              Current plan:{" "}
              <span className="font-semibold text-foreground">
                {plans.find((p) => p.slug === currentSlug)?.name ??
                  getProductDisplayName(currentSlug)}
              </span>
            </div>
          </div>
        </div>

        {upgradedFlag && (
          <div
            className="rounded-xl border border-primary/40 bg-primary/5 p-4 flex items-start gap-3"
            data-testid="plans-upgrade-success-banner"
            role="status"
          >
            <PartyPopper className="w-5 h-5 text-primary mt-0.5 shrink-0" />
            <div className="text-sm text-foreground">
              <p className="font-semibold">Thanks for upgrading!</p>
              <p className="text-muted-foreground">
                We're confirming your purchase with our payment provider. Your new
                tier and features will appear here within a minute or two — feel
                free to refresh if you don't see them yet.
              </p>
            </div>
          </div>
        )}

        {errorMessage && (
          <div
            className="rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm text-foreground"
            data-testid="plans-checkout-error-banner"
            role="alert"
          >
            {errorMessage}
          </div>
        )}

        {plansLoading ? (
          <div
            className="flex items-center justify-center py-16 text-muted-foreground"
            data-testid="plans-loading"
          >
            <Loader2 className="w-5 h-5 mr-2 animate-spin" />
            Loading plans…
          </div>
        ) : plansError || plans.length === 0 ? (
          <div
            className="border border-border/60 bg-secondary/40 rounded-xl p-6 text-sm text-muted-foreground text-center"
            data-testid="plans-error"
          >
            We couldn't load the upgrade plans right now. Please refresh, or{" "}
            <Link
              href="/support/contact"
              className="text-primary font-medium hover:underline"
            >
              reach out to support
            </Link>
            .
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {plans.map((plan) => {
                const isCurrent = plan.slug === currentSlug;
                const isHighlighted = highlightSlug === plan.slug;
                const isLowerTier = (PRODUCT_RANK[plan.slug] ?? 0) < currentRank;
                return (
                  <Card
                    key={plan.slug}
                    ref={isHighlighted ? highlightedRef : undefined}
                    className={cn(
                      "relative flex flex-col transition-all",
                      isHighlighted &&
                        "ring-2 ring-primary ring-offset-2 shadow-lg",
                      plan.recommended && !isHighlighted && "border-primary/40 shadow-md",
                      isLowerTier && "opacity-60",
                    )}
                    data-testid={`plan-card-${plan.slug}`}
                    data-highlighted={isHighlighted ? "true" : undefined}
                  >
                    {plan.recommended && !isCurrent && (
                      <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                        <Badge className="bg-primary text-primary-foreground gap-1">
                          <Star className="w-3 h-3" />
                          Most popular
                        </Badge>
                      </div>
                    )}
                    {isCurrent && (
                      <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                        <Badge variant="secondary" className="gap-1">
                          <Check className="w-3 h-3" />
                          Your current plan
                        </Badge>
                      </div>
                    )}
                    <CardHeader className="pb-3">
                      <div className="flex items-center gap-2 mb-1">
                        <Crown className="w-4 h-4 text-primary" />
                        <h3 className="font-bold text-lg text-foreground">{plan.name}</h3>
                      </div>
                      <p className="text-sm text-muted-foreground">{plan.tagline}</p>
                      <div className="mt-3 flex items-baseline gap-2">
                        <span className="text-xl font-bold text-foreground">
                          {plan.priceDisplay ?? "Talk to us"}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {plan.durationLabel}
                        </span>
                      </div>
                    </CardHeader>
                    <CardContent className="flex-1 flex flex-col">
                      <ul className="space-y-2 mb-5 flex-1">
                        {plan.highlights.map((h) => (
                          <li key={h} className="flex items-start gap-2 text-sm text-foreground">
                            <Check className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                            <span>{h}</span>
                          </li>
                        ))}
                      </ul>
                      <Button
                        variant={plan.recommended ? "default" : "outline"}
                        className="w-full"
                        disabled={
                          isCurrent || isLowerTier || pendingSlug !== null
                        }
                        data-testid={`plan-cta-${plan.slug}`}
                        onClick={() => handleUpgrade(plan.slug)}
                      >
                        {pendingSlug === plan.slug ? (
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        ) : isCurrent || isLowerTier ? (
                          <Check className="w-4 h-4 mr-2" />
                        ) : (
                          <ArrowUpRight className="w-4 h-4 mr-2" />
                        )}
                        {isCurrent
                          ? "You're on this plan"
                          : isLowerTier
                            ? "Lower than current"
                            : pendingSlug === plan.slug
                              ? "Opening checkout…"
                              : `Upgrade to ${plan.name.replace("BTS ", "")}`}
                      </Button>
                    </CardContent>
                  </Card>
                );
              })}
            </div>

            <Card data-testid="plans-comparison">
              <CardHeader className="pb-3 border-b border-border/50">
                <h2 className="font-semibold text-foreground">Feature comparison</h2>
                <p className="text-sm text-muted-foreground">
                  See exactly what's included at each tier.
                </p>
              </CardHeader>
              <CardContent className="p-0 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-secondary/40 text-muted-foreground">
                    <tr>
                      <th className="text-left p-3 font-medium">Feature</th>
                      {plans.map((p) => (
                        <th
                          key={p.slug}
                          className="text-center p-3 font-medium whitespace-nowrap"
                        >
                          {p.name.replace("BTS ", "").replace(" Mentorship", "")}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {COMPARISON_FEATURES.map((feature) => (
                      <tr key={feature.key} className="border-t border-border/40">
                        <td className="p-3 text-foreground">{feature.label}</td>
                        {plans.map((p) => {
                          const has = p.entitlements.includes(feature.key);
                          return (
                            <td key={p.slug} className="p-3 text-center">
                              {has ? (
                                <Check className="w-4 h-4 text-primary inline" />
                              ) : (
                                <XIcon className="w-4 h-4 text-muted-foreground/40 inline" />
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          </>
        )}

        <div className="bg-secondary/40 border border-border/60 rounded-xl p-5 text-center">
          <p className="text-sm text-muted-foreground">
            Have a question about which plan is right for you?{" "}
            <Link
              href="/support/contact"
              className="text-primary font-medium hover:underline"
              data-testid="plans-contact-support"
            >
              Reach out to support
            </Link>{" "}
            and the team will help.
          </p>
        </div>
      </div>
    </AppLayout>
  );
}
