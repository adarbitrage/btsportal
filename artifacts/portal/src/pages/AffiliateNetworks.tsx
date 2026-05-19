import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Network, Star, CheckCircle2 } from "lucide-react";
import { Link } from "wouter";
import { useListAffiliateNetworks } from "@workspace/api-client-react";
import type { AffiliateNetwork } from "@workspace/api-client-react";

function getLogoSrc(network: AffiliateNetwork): string | null {
  if (!network.logoUrl) return null;
  if (network.logoUrl.startsWith("http://") || network.logoUrl.startsWith("https://")) {
    return network.logoUrl;
  }
  return `${import.meta.env.BASE_URL}api${network.logoUrl}`;
}

function NetworkCard({ network }: { network: AffiliateNetwork }) {
  const hasLinks = Boolean(network.registerUrl || network.loginUrl);
  const logoSrc = getLogoSrc(network);

  const isInternalHref = (href: string) =>
    !href.startsWith("http://") && !href.startsWith("https://");

  return (
    <Card
      className={`border-2 ${network.accentBorder} hover:shadow-lg transition-shadow overflow-hidden`}
      data-testid={`card-network-${network.slug}`}
    >
      <CardContent className="p-0">
        <div className="flex flex-col md:flex-row">
          <div
            className={`${network.logoBg} flex items-center justify-center p-6 md:p-8 md:w-56 shrink-0 border-b md:border-b-0 md:border-r border-border`}
          >
            {logoSrc ? (
              <img
                src={logoSrc}
                alt={`${network.name} logo`}
                className="max-h-24 max-w-full object-contain"
              />
            ) : (
              <div className="w-24 h-24 flex items-center justify-center rounded-lg bg-muted">
                <Network className="w-10 h-10 text-muted-foreground" />
              </div>
            )}
          </div>

          <div className="flex-1 p-5 flex flex-col">
            <div className="flex flex-wrap items-start justify-between gap-3 mb-2">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <h2 className="text-xl font-bold text-foreground">{network.name}</h2>
                  {network.recommendedForBeginners && (
                    <Badge className="bg-emerald-700 hover:bg-emerald-700 text-white text-[10px] font-bold tracking-wide uppercase">
                      <Star className="w-3 h-3 mr-1" /> Recommended for Beginners
                    </Badge>
                  )}
                </div>
                <p className="text-sm text-muted-foreground mt-1">{network.tagline}</p>
              </div>
              <Badge
                variant="outline"
                className={`${network.accentBadgeBg} ${network.accentBadgeText} ${network.accentBadgeBorder} shrink-0`}
              >
                {network.approvalLabel}
              </Badge>
            </div>

            <p className="text-sm text-foreground/90 leading-relaxed mb-3">
              {network.description}
            </p>

            <ul className="space-y-1 mb-3">
              {network.highlights.map((h, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-foreground/85">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 mt-0.5 shrink-0" />
                  <span>{h}</span>
                </li>
              ))}
            </ul>

            <div className="mt-auto flex items-end justify-between gap-3 flex-wrap">
              <div className="min-w-0 flex-1">
                <p className="text-xs text-muted-foreground">
                  <span className="font-semibold text-foreground">Publishers:</span>{" "}
                  {network.publishers}
                </p>
                {!hasLinks && !network.extraCtaLabel && (
                  <p className="text-[11px] text-muted-foreground/70 italic mt-0.5">
                    Register and log-in links coming soon.
                  </p>
                )}
              </div>
              <div className="flex gap-2 shrink-0">
                {network.extraCtaLabel && network.extraCtaHref && (
                  isInternalHref(network.extraCtaHref) ? (
                    <Button
                      asChild
                      size="sm"
                      className={network.extraCtaStyle === "emerald" ? "bg-emerald-600 hover:bg-emerald-700 text-white" : ""}
                      data-testid={`button-extra-cta-${network.slug}`}
                    >
                      <Link href={network.extraCtaHref}>{network.extraCtaLabel}</Link>
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      asChild
                      className={network.extraCtaStyle === "emerald" ? "bg-emerald-600 hover:bg-emerald-700 text-white" : ""}
                      data-testid={`button-extra-cta-${network.slug}`}
                    >
                      <a href={network.extraCtaHref} target="_blank" rel="noreferrer">
                        {network.extraCtaLabel}
                      </a>
                    </Button>
                  )
                )}
                {network.registerUrl ? (
                  <Button
                    size="sm"
                    asChild
                    data-testid={`button-register-${network.slug}`}
                  >
                    <a href={network.registerUrl} target="_blank" rel="noreferrer">
                      Register
                    </a>
                  </Button>
                ) : (
                  <Button size="sm" disabled>
                    Register
                  </Button>
                )}
                {network.loginUrl ? (
                  <Button
                    size="sm"
                    variant="outline"
                    asChild
                    data-testid={`button-login-${network.slug}`}
                  >
                    <a href={network.loginUrl} target="_blank" rel="noreferrer">
                      Log in
                    </a>
                  </Button>
                ) : (
                  <Button size="sm" variant="outline" disabled>
                    Log in
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function NetworkCardSkeleton() {
  return (
    <Card className="border-2 border-border overflow-hidden">
      <CardContent className="p-0">
        <div className="flex flex-col md:flex-row">
          <div className="flex items-center justify-center p-6 md:p-8 md:w-56 shrink-0 border-b md:border-b-0 md:border-r border-border">
            <Skeleton className="w-24 h-16" />
          </div>
          <div className="flex-1 p-5 flex flex-col gap-3">
            <div className="flex justify-between items-start">
              <Skeleton className="h-6 w-40" />
              <Skeleton className="h-5 w-28" />
            </div>
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
            <Skeleton className="h-4 w-4/6" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function AffiliateNetworks() {
  const { data: networks, isLoading, isError } = useListAffiliateNetworks();

  return (
    <AppLayout>
      <div className="space-y-6 max-w-6xl">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Network className="w-6 h-6 text-primary" />
            <h1 className="text-3xl font-bold">Affiliate Networks</h1>
          </div>
          <p className="text-muted-foreground">
            An affiliate network is where you'll find the product you promote and get
            your unique tracking link — think of it like choosing which store you're
            going to sell products for. These are the four networks supported inside the
            Build Test Scale system.
          </p>
        </div>

        <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-4">
          <p className="text-sm text-emerald-900">
            <strong>How to choose:</strong> If you're brand new, start with{" "}
            <strong>Media Mavens</strong>. It's our own in-house network, built
            specifically for this system, and gives you several advantages out of the
            gate. If you want to explore other options, <strong>ClickBank</strong> is the
            next easiest entry point. <strong>Affiliati</strong> and{" "}
            <strong>MaxWeb</strong> both require an application and approval, so factor
            in a short wait time and note that both also require proof of revenue from
            previous affiliate campaigns — please check with a coach before applying to
            either.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-5">
          {isLoading && (
            <>
              <NetworkCardSkeleton />
              <NetworkCardSkeleton />
              <NetworkCardSkeleton />
              <NetworkCardSkeleton />
            </>
          )}
          {isError && (
            <div className="text-center py-12 text-muted-foreground">
              <Network className="w-10 h-10 mx-auto mb-3 opacity-40" />
              <p>Failed to load affiliate networks. Please try refreshing the page.</p>
            </div>
          )}
          {!isLoading && !isError && networks && networks.length === 0 && (
            <div className="text-center py-12 text-muted-foreground">
              <Network className="w-10 h-10 mx-auto mb-3 opacity-40" />
              <p>No affiliate networks available at this time.</p>
            </div>
          )}
          {networks?.map((n) => (
            <NetworkCard key={n.slug} network={n} />
          ))}
        </div>
      </div>
    </AppLayout>
  );
}
