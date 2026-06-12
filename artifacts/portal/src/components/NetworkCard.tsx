import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Network, Star, CheckCircle2, Loader2 } from "lucide-react";
import { Link } from "wouter";
import { useToast } from "@/hooks/use-toast";

const API_BASE = `${import.meta.env.BASE_URL}api`;

export interface NetworkCardData {
  slug: string;
  name: string;
  tagline: string;
  description: string;
  logoUrl?: string | null;
  logoBg: string;
  highlights: string[];
  publishers: string;
  approvalLabel: string;
  recommendedForBeginners: boolean;
  accentBorder: string;
  accentBadgeBg: string;
  accentBadgeText: string;
  accentBadgeBorder: string;
  registerUrl?: string | null;
  loginUrl?: string | null;
  extraCtaLabel?: string | null;
  extraCtaHref?: string | null;
  extraCtaStyle: string;
}

function getLogoSrc(logoUrl: string | null | undefined): string | null {
  if (!logoUrl) return null;
  if (logoUrl.startsWith("http://") || logoUrl.startsWith("https://")) {
    return logoUrl;
  }
  return `${import.meta.env.BASE_URL}api${logoUrl}`;
}

const isInternalHref = (href: string) =>
  !href.startsWith("http://") && !href.startsWith("https://");

export interface NetworkCardProps {
  network: NetworkCardData;
  testIdPrefix?: string;
  disableLinks?: boolean;
}

function MediaMavensLoginButton({ slug }: { slug: string }) {
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  async function handleLogin() {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/affiliate/tapfiliate-sso`, {
        credentials: "include",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const msg =
          res.status === 503
            ? "Log in is temporarily unavailable. Please contact an administrator."
            : (data.error as string) || "Failed to start login. Please try again.";
        toast({ title: "Login unavailable", description: msg, variant: "destructive" });
        return;
      }
      const { url } = await res.json();
      window.open(url, "_blank", "noopener");
    } catch {
      toast({
        title: "Login unavailable",
        description: "Could not connect to the server. Please try again.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <Button
      size="sm"
      variant="outline"
      disabled={loading}
      onClick={handleLogin}
      data-testid={`button-login-${slug}`}
    >
      {loading ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : null}
      Log in
    </Button>
  );
}

export function NetworkCard({
  network,
  testIdPrefix = "card-network",
  disableLinks = false,
}: NetworkCardProps) {
  const isMediaMavens = network.slug === "media-mavens";
  const hasLinks = isMediaMavens
    ? true
    : Boolean(network.registerUrl || network.loginUrl);
  const logoSrc = getLogoSrc(network.logoUrl);

  return (
    <Card
      className={`border-2 ${network.accentBorder} hover:shadow-lg transition-shadow overflow-hidden`}
      data-testid={`${testIdPrefix}-${network.slug || "preview"}`}
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
                  <h2 className="text-xl font-bold text-foreground">{network.name || "Untitled network"}</h2>
                  {network.recommendedForBeginners && (
                    <Badge className="bg-emerald-700 hover:bg-emerald-700 text-white text-[10px] font-bold tracking-wide uppercase">
                      <Star className="w-3 h-3 mr-1" /> Recommended for Beginners
                    </Badge>
                  )}
                </div>
                {network.tagline && (
                  <p className="text-sm text-muted-foreground mt-1">{network.tagline}</p>
                )}
              </div>
              {network.approvalLabel && (
                <Badge
                  variant="outline"
                  className={`${network.accentBadgeBg} ${network.accentBadgeText} ${network.accentBadgeBorder} shrink-0`}
                >
                  {network.approvalLabel}
                </Badge>
              )}
            </div>

            {network.description && (
              <p className="text-sm text-foreground/90 leading-relaxed mb-3">
                {network.description}
              </p>
            )}

            {network.highlights.length > 0 && (
              <ul className="space-y-1 mb-3">
                {network.highlights.map((h, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-foreground/85">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 mt-0.5 shrink-0" />
                    <span>{h}</span>
                  </li>
                ))}
              </ul>
            )}

            <div className="mt-auto flex items-end justify-between gap-3 flex-wrap">
              <div className="min-w-0 flex-1">
                {network.publishers && (
                  <p className="text-xs text-muted-foreground">
                    <span className="font-semibold text-foreground">Publishers:</span>{" "}
                    {network.publishers}
                  </p>
                )}
                {!hasLinks && !network.extraCtaLabel && (
                  <p className="text-[11px] text-muted-foreground/70 italic mt-0.5">
                    Register and log-in links coming soon.
                  </p>
                )}
              </div>
              <div className="flex gap-2 shrink-0">
                {network.extraCtaLabel && network.extraCtaHref && (
                  disableLinks ? (
                    <Button
                      size="sm"
                      type="button"
                      className={network.extraCtaStyle === "emerald" ? "bg-emerald-600 hover:bg-emerald-700 text-white" : ""}
                      data-testid={`button-extra-cta-${network.slug || "preview"}`}
                    >
                      {network.extraCtaLabel}
                    </Button>
                  ) : isInternalHref(network.extraCtaHref) ? (
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

                {isMediaMavens ? (
                  disableLinks ? (
                    <Button size="sm" variant="outline" disabled type="button">
                      Log in
                    </Button>
                  ) : (
                    <MediaMavensLoginButton slug={network.slug} />
                  )
                ) : (
                  <>
                    {network.registerUrl && !disableLinks ? (
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
                      <Button size="sm" disabled type="button">
                        Register
                      </Button>
                    )}
                    {network.loginUrl && !disableLinks ? (
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
                      <Button size="sm" variant="outline" disabled type="button">
                        Log in
                      </Button>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
