import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ExternalLink, LogIn, Network, Star, CheckCircle2 } from "lucide-react";
import mediaMavensLogo from "@assets/mediamavens-logo_1778609315487.png";
import clickbankLogo from "@assets/clickbank-logo_1778609315487.jpg";
import maxwebLogo from "@assets/maxweb-logo_1778609315486.jpeg";
import affiliatiLogo from "@assets/affiliati-logo_1778609315486.png";

type AffiliateNetwork = {
  slug: string;
  name: string;
  logo: string;
  logoBg: string;
  tagline: string;
  description: string;
  highlights: string[];
  publishers: string;
  approval: "Instant signup" | "Approval + proof of revenue";
  recommendedForBeginners?: boolean;
  accent: {
    border: string;
    badgeBg: string;
    badgeText: string;
    badgeBorder: string;
  };
  registerUrl: string | null;
  loginUrl: string | null;
};

const NETWORKS: AffiliateNetwork[] = [
  {
    slug: "media-mavens",
    name: "Media Mavens",
    logo: mediaMavensLogo,
    logoBg: "bg-white",
    tagline: "Our own in-house curated network — designed specifically for this system.",
    description:
      "If you're brand new, start here. Media Mavens is our in-house network, built specifically for the Build Test Scale system, which gives you several real advantages over public marketplaces right from the start. Simple to sign up — no approval required.",
    highlights: [
      "Higher commissions than comparable products on other networks",
      "No chargebacks — if a customer returns a product, you keep your commission",
      "Pre-made advertorials (landing pages) for many products — meaning less work to get started",
      "Works with all three ad publishers (Caterpillar, Grasshopper, Crane)",
    ],
    publishers: "Caterpillar, Grasshopper, Crane",
    approval: "Instant signup",
    recommendedForBeginners: true,
    accent: {
      border: "border-emerald-300",
      badgeBg: "bg-emerald-50",
      badgeText: "text-emerald-800",
      badgeBorder: "border-emerald-200",
    },
    registerUrl: null,
    loginUrl: null,
  },
  {
    slug: "clickbank",
    name: "ClickBank",
    logo: clickbankLogo,
    logoBg: "bg-white",
    tagline: "A large public marketplace with thousands of products to promote.",
    description:
      "The next easiest entry point after Media Mavens. ClickBank is a large public marketplace — simple to sign up, no approval required. You'll create your own landing pages using the product's video as your source material.",
    highlights: [
      "Instant signup — no approval required",
      "Thousands of products across many verticals",
      "Works with Caterpillar and Grasshopper publishers",
      "Requires building your own jump pages from scratch",
    ],
    publishers: "Caterpillar, Grasshopper",
    approval: "Instant signup",
    accent: {
      border: "border-amber-300",
      badgeBg: "bg-amber-50",
      badgeText: "text-amber-800",
      badgeBorder: "border-amber-200",
    },
    registerUrl: null,
    loginUrl: null,
  },
  {
    slug: "affiliati",
    name: "Affiliati",
    logo: affiliatiLogo,
    logoBg: "bg-white",
    tagline: "A curated network with many strong offers.",
    description:
      "Affiliati is a curated network with many strong offers. It requires account approval and proof of revenue generated from previous affiliate campaigns before you can get started. Please check with a coach before attempting to apply for an Affiliati account.",
    highlights: [
      "Requires account approval and proof of revenue from previous affiliate campaigns",
      "Check with a coach before applying",
      "Pre-made advertorials available for select products — ready to use immediately",
      "Works with Caterpillar and Grasshopper publishers",
    ],
    publishers: "Caterpillar, Grasshopper",
    approval: "Approval + proof of revenue",
    accent: {
      border: "border-violet-300",
      badgeBg: "bg-violet-50",
      badgeText: "text-violet-800",
      badgeBorder: "border-violet-200",
    },
    registerUrl: null,
    loginUrl: null,
  },
  {
    slug: "maxweb",
    name: "MaxWeb",
    logo: maxwebLogo,
    logoBg: "bg-black",
    tagline: "A curated network with quality offers.",
    description:
      "MaxWeb is a curated network with quality offers. It requires account approval and proof of revenue generated from previous affiliate campaigns before you can get started. Please check with a coach before attempting to apply for a MaxWeb account.",
    highlights: [
      "Requires account approval and proof of revenue from previous affiliate campaigns",
      "Check with a coach before applying",
      "Dedicated Account Representative listed on your MaxWeb Dashboard once approved",
      "Works with Caterpillar and Grasshopper publishers",
    ],
    publishers: "Caterpillar, Grasshopper",
    approval: "Approval + proof of revenue",
    accent: {
      border: "border-orange-300",
      badgeBg: "bg-orange-50",
      badgeText: "text-orange-800",
      badgeBorder: "border-orange-200",
    },
    registerUrl: null,
    loginUrl: null,
  },
];

function NetworkCard({ network }: { network: AffiliateNetwork }) {
  const hasLinks = Boolean(network.registerUrl || network.loginUrl);
  return (
    <Card
      className={`border-2 ${network.accent.border} hover:shadow-lg transition-shadow overflow-hidden`}
      data-testid={`card-network-${network.slug}`}
    >
      <CardContent className="p-0">
        <div className="flex flex-col md:flex-row">
          <div
            className={`${network.logoBg} flex items-center justify-center p-6 md:p-8 md:w-56 shrink-0 border-b md:border-b-0 md:border-r border-border`}
          >
            <img
              src={network.logo}
              alt={`${network.name} logo`}
              className="max-h-24 max-w-full object-contain"
            />
          </div>

          <div className="flex-1 p-6">
            <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
              <div>
                <div className="flex items-center gap-2 flex-wrap">
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
                className={`${network.accent.badgeBg} ${network.accent.badgeText} ${network.accent.badgeBorder}`}
              >
                {network.approval}
              </Badge>
            </div>

            <p className="text-sm text-foreground/90 leading-relaxed mb-4">
              {network.description}
            </p>

            <ul className="space-y-1.5 mb-4">
              {network.highlights.map((h, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-foreground/85">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 mt-0.5 shrink-0" />
                  <span>{h}</span>
                </li>
              ))}
            </ul>

            <div className="flex items-center justify-between flex-wrap gap-3 pt-3 border-t border-border">
              <p className="text-xs text-muted-foreground">
                <span className="font-semibold text-foreground">Publishers:</span>{" "}
                {network.publishers}
              </p>
              <div className="flex gap-2">
                {network.registerUrl ? (
                  <Button
                    size="sm"
                    asChild
                    data-testid={`button-register-${network.slug}`}
                  >
                    <a href={network.registerUrl} target="_blank" rel="noreferrer">
                      Register <ExternalLink className="w-4 h-4 ml-1.5" />
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
                      <LogIn className="w-4 h-4 mr-1.5" /> Log in
                    </a>
                  </Button>
                ) : (
                  <Button size="sm" variant="outline" disabled>
                    <LogIn className="w-4 h-4 mr-1.5" /> Log in
                  </Button>
                )}
              </div>
            </div>
            {!hasLinks && (
              <p className="text-[11px] text-muted-foreground/70 mt-2 italic">
                Register and log-in links coming soon.
              </p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function AffiliateNetworks() {
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
          {NETWORKS.map((n) => (
            <NetworkCard key={n.slug} network={n} />
          ))}
        </div>
      </div>
    </AppLayout>
  );
}
