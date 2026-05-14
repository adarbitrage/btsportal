import { useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Wrench, CheckCircle2, Copy, Check } from "lucide-react";
import scrapebotLogo from "@assets/scrapebot-new-logo-resources-image-250x222_1778795701373.jpg";
import cropbotLogo from "@assets/cropbot-new-logo-resources-image-250x222_1778795879400.jpg";
import affiliateCmoLogo from "@assets/affiliatecmo-logo-250x222_1778796180683.png";
import freeAdCopyLogo from "@assets/freeadcopy-logo-250x222_1778796182562.png";
import anstrexLogo from "@assets/anstrex-logo-250x222_1778797055591.jpg";

type PartnerTool = {
  name: string;
  category: string;
  tagline: string;
  description: string;
  highlights: string[];
  logo: string;
  logoBg?: string;
  collapsible?: boolean;
  perk?: string;
  couponCode?: string;
  credentials?: { user: string; password: string };
  registerUrl?: string;
  loginUrl?: string;
};

const PARTNER_TOOLS: PartnerTool[] = [
  {
    name: "Affiliate CMO",
    category: "AI Advertorial Builder",
    tagline: "AI-powered advertorials that connect with your customer's deepest emotions.",
    description:
      "Get high-converting copy that connects with your ideal customer's deepest emotions — without spending weeks on research or testing hundreds of failed variations.",
    highlights: [
      "Deep avatar research and psychology brief builder",
      "Advertorial generator with custom copy control",
      "Headline laboratory for split-test winners",
      "Banner ad factory for paid traffic creative",
    ],
    logo: affiliateCmoLogo,
    collapsible: true,
    perk: "FREE for life with the coupon code below.",
    couponCode: "LIFETIME100",
    registerUrl: "https://app.affiliatecmo.com/login",
    loginUrl: "https://app.affiliatecmo.com/login",
  },
  {
    name: "FreeAdCopy™",
    category: "AI Ad Copy Generator",
    tagline: "100% free AI copy-generator built to outperform your best ads.",
    description:
      "Powered by GPT-4 combined with 25+ years of copywriting experience and over $1.2 billion in sales — one of the most powerful AI copy-generators on the market.",
    highlights: [
      "1,000 credits applied instantly when you register through the BTS link",
      "Generate ad copy variations in seconds across angles and offers",
      "Built-in copywriting frameworks proven across billions in spend",
    ],
    logo: freeAdCopyLogo,
    logoBg: "bg-white",
    collapsible: true,
    perk: "1,000 credits applied instantly — completely FREE for BTS members.",
    registerUrl: "https://www.freeadcopy.com/signup?bonusCode=0VLP2B3X",
    loginUrl: "https://www.freeadcopy.com/?loginpopup=true#",
  },
  {
    name: "Anstrex",
    category: "Competitive Intelligence",
    tagline: "Spy on the world's top advertisers and reverse-engineer their winning campaigns.",
    description:
      "Improve your ROI by unlocking your competitors' marketing strategies across native, push, popup, display, and dropshipping channels. Anstrex is the multi-network ad spy tool affiliate marketers use to find proven angles, headlines, and landing pages without burning test budget.",
    highlights: [
      "Spy on native ads across Taboola, Outbrain, Revcontent, MGID, and more",
      "Push, popup, and display ad libraries with advanced search filters",
      "Download competitor landing pages and Shopify dropship product research",
    ],
    logo: anstrexLogo,
    collapsible: true,
    perk: "BTS members get FREE access — copy the shared login below:",
    credentials: {
      user: "support@buildtestscale.com",
      password: "JesusLives3838!",
    },
    loginUrl: "https://app.anstrex.com/login",
  },
];

type ChromeExtension = {
  name: string;
  category: string;
  tagline: string;
  description: string;
  highlights: string[];
  logo: string;
  downloadUrl: string;
  collapsible?: boolean;
};

const CHROME_EXTENSIONS: ChromeExtension[] = [
  {
    name: "ScrapeBot™",
    category: "Google/Bing Image Scraper",
    tagline: "Scrape Google, Bing, and DuckDuckGo Images straight from your browser.",
    description:
      "A Chrome Extension built to scrape Google, Bing, and DuckDuckGo Images. Use it daily to locate and download all the images you need for banner ads and advertorial pages. No Photoshop required when you pair ScrapeBot™ with CropBot™ and PixelPress™.",
    highlights: [
      "One-click image scraping across Google, Bing, and DuckDuckGo",
      "Bulk-download images for banner ads and advertorial pages",
      "Built to feed directly into the CropBot™ and PixelPress™ workflow",
    ],
    logo: scrapebotLogo,
    downloadUrl:
      "https://chromewebstore.google.com/detail/scrapebot-207/beongpingjcjghpgfcngccpkpmhgldjm",
    collapsible: true,
  },
  {
    name: "CropBot™",
    category: "Image Cropper & Resizer",
    tagline: "Crop and resize the images you gather with ScrapeBot™ in seconds.",
    description:
      "A Chrome Extension built to crop and resize the images you gather with ScrapeBot™. In most cases, images downloaded from Google won't have ideal dimensions and need resizing. ScrapeBot™, CropBot™, and PixelPress™ make banner creation a breeze.",
    highlights: [
      "Resize images downloaded from Google to ad-ready dimensions",
      "Crop and adjust without leaving the browser",
      "Pairs with ScrapeBot™ and PixelPress™ for end-to-end banner creation",
    ],
    logo: cropbotLogo,
    downloadUrl:
      "https://chrome.google.com/webstore/detail/cropbot-201/kkabdjjmpkogggbjoenafjejhkalkjdd",
    collapsible: true,
  },
];

function PartnerToolCard({ tool }: { tool: PartnerTool }) {
  const { toast } = useToast();
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(!tool.collapsible);
  const showHighlights = !tool.collapsible || expanded;

  const copy = async (key: string, value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedKey(key);
      toast({ title: "Copied", description: `${label} copied to clipboard.` });
      setTimeout(() => setCopiedKey((k) => (k === key ? null : k)), 2000);
    } catch {
      toast({
        title: "Copy failed",
        description: "Couldn't copy to your clipboard.",
        variant: "destructive",
      });
    }
  };

  return (
    <Card className="border-border/60 shadow-sm overflow-hidden">
      <CardContent className="p-0">
        <div className="flex flex-col md:flex-row">
          <div
            className={`${tool.logoBg ?? "bg-white"} flex items-center justify-center p-6 md:p-8 md:w-56 shrink-0 border-b md:border-b-0 md:border-r border-border`}
          >
            <img
              src={tool.logo}
              alt={`${tool.name} logo`}
              className="max-h-28 max-w-full object-contain"
            />
          </div>

          <div className="flex-1 p-5 flex flex-col">
            <div className="mb-2">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <h2 className="text-xl font-bold text-foreground">{tool.name}</h2>
                <Badge
                  variant="outline"
                  className="bg-muted text-muted-foreground border-border text-[10px] font-bold tracking-wide uppercase"
                >
                  {tool.category}
                </Badge>
                <Badge
                  variant="outline"
                  className="bg-emerald-50 text-emerald-800 border-emerald-200 text-[10px] font-bold tracking-wide uppercase"
                >
                  Free for BTS Members
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground mt-1">{tool.tagline}</p>
            </div>

            <p className="text-sm text-foreground/90 leading-relaxed mb-3">
              {tool.description}
            </p>

            {showHighlights && (
              <ul className="space-y-1 mb-4">
                {tool.highlights.map((h, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-foreground/85">
                    <CheckCircle2 className="w-4 h-4 text-emerald-700 mt-0.5 shrink-0" />
                    <span>{h}</span>
                  </li>
                ))}
              </ul>
            )}

            <div className="mt-auto flex items-end justify-between gap-3 flex-wrap">
              <div className="min-w-0 flex-1 text-xs text-muted-foreground space-y-1">
                {tool.collapsible && (
                  <button
                    type="button"
                    onClick={() => setExpanded((v) => !v)}
                    className="text-xs font-medium text-primary hover:underline"
                    data-testid={`button-toggle-details-${tool.name}`}
                  >
                    {expanded ? "Show less" : "Read more"}
                  </button>
                )}
                {tool.perk && (
                  <p className="flex flex-wrap items-center gap-1.5">
                    <span>{tool.perk}</span>
                    {tool.couponCode && (
                      <button
                        type="button"
                        onClick={() => copy("coupon", tool.couponCode!, "Coupon code")}
                        className="inline-flex items-center gap-1 font-mono bg-muted border border-border rounded px-1.5 py-0.5 text-foreground hover:border-foreground/40"
                      >
                        {tool.couponCode}
                        {copiedKey === "coupon" ? (
                          <><Check className="w-3 h-3" /> Copied</>
                        ) : (
                          <><Copy className="w-3 h-3" /></>
                        )}
                      </button>
                    )}
                    {tool.credentials && (
                      <>
                        <button
                          type="button"
                          onClick={() => copy("user", tool.credentials!.user, "Username")}
                          className="inline-flex items-center gap-1 font-mono bg-muted border border-border rounded px-1.5 py-0.5 text-foreground hover:border-foreground/40"
                        >
                          <span className="text-muted-foreground">user:</span>
                          {tool.credentials.user}
                          {copiedKey === "user" ? (
                            <><Check className="w-3 h-3" /> Copied</>
                          ) : (
                            <><Copy className="w-3 h-3" /></>
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() => copy("pw", tool.credentials!.password, "Password")}
                          className="inline-flex items-center gap-1 font-mono bg-muted border border-border rounded px-1.5 py-0.5 text-foreground hover:border-foreground/40"
                        >
                          <span className="text-muted-foreground">pass:</span>
                          {tool.credentials.password}
                          {copiedKey === "pw" ? (
                            <><Check className="w-3 h-3" /> Copied</>
                          ) : (
                            <><Copy className="w-3 h-3" /></>
                          )}
                        </button>
                      </>
                    )}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2 flex-wrap justify-end">
                {tool.registerUrl && (
                  <Button asChild size="sm">
                    <a href={tool.registerUrl} target="_blank" rel="noopener noreferrer">
                      Register
                    </a>
                  </Button>
                )}
                {tool.loginUrl && (
                  <Button asChild size="sm" variant={tool.registerUrl ? "outline" : "default"}>
                    <a href={tool.loginUrl} target="_blank" rel="noopener noreferrer">
                      Log In
                    </a>
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

function ExtensionCard({ ext }: { ext: ChromeExtension }) {
  const [expanded, setExpanded] = useState(!ext.collapsible);
  const showHighlights = !ext.collapsible || expanded;

  return (
    <Card className="border-border/60 shadow-sm overflow-hidden">
      <CardContent className="p-0">
        <div className="flex flex-col md:flex-row">
          <div className="bg-white flex items-center justify-center p-6 md:p-8 md:w-56 shrink-0 border-b md:border-b-0 md:border-r border-border">
            <img
              src={ext.logo}
              alt={`${ext.name} logo`}
              className="max-h-28 max-w-full object-contain"
            />
          </div>

          <div className="flex-1 p-5 flex flex-col">
            <div className="mb-2">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <h2 className="text-xl font-bold text-foreground">{ext.name}</h2>
                <Badge
                  variant="outline"
                  className="bg-muted text-muted-foreground border-border text-[10px] font-bold tracking-wide uppercase"
                >
                  {ext.category}
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground mt-1">{ext.tagline}</p>
            </div>

            <p className="text-sm text-foreground/90 leading-relaxed mb-3">
              {ext.description}
            </p>

            {showHighlights && (
              <ul className="space-y-1 mb-4">
                {ext.highlights.map((h, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-foreground/85">
                    <CheckCircle2 className="w-4 h-4 text-emerald-700 mt-0.5 shrink-0" />
                    <span>{h}</span>
                  </li>
                ))}
              </ul>
            )}

            <div className="mt-auto flex items-end justify-between gap-3 flex-wrap">
              <div className="min-w-0 flex-1">
                {ext.collapsible && (
                  <button
                    type="button"
                    onClick={() => setExpanded((v) => !v)}
                    className="text-xs font-medium text-primary hover:underline"
                    data-testid={`button-toggle-details-${ext.name}`}
                  >
                    {expanded ? "Show less" : "Read more"}
                  </button>
                )}
              </div>
              <div className="flex items-center gap-2 flex-wrap justify-end">
                <Button asChild size="sm">
                  <a href={ext.downloadUrl} target="_blank" rel="noopener noreferrer">
                    Download Extension
                  </a>
                </Button>
                <Button size="sm" variant="outline" disabled>
                  Watch Training (coming soon)
                </Button>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function PartnerTools() {
  return (
    <AppLayout>
      <div className="space-y-6 max-w-6xl">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Wrench className="w-6 h-6 text-primary" />
            <h1 className="text-3xl font-bold">Tools</h1>
          </div>
          <p className="text-muted-foreground">
            Third-party partner tools and Chrome extensions BTS members get free
            access to. Register through the BTS links below to claim your
            perks.
          </p>
        </div>

        <div className="space-y-4">
          <div>
            <h2 className="text-2xl font-bold text-foreground">Partner Tools</h2>
            <p className="text-muted-foreground text-sm mt-1">
              Third-party tools that BTS members get free access to. Register through
              the BTS link to claim your free account or credits.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-5">
            {PARTNER_TOOLS.map((tool) => (
              <PartnerToolCard key={tool.name} tool={tool} />
            ))}
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <h2 className="text-2xl font-bold text-foreground">Chrome Extensions</h2>
            <p className="text-muted-foreground text-sm mt-1">
              Browser extensions built to speed up the day-to-day workflow of finding,
              cropping, and shipping ad creative. Install once and use them across every
              campaign.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-5">
            {CHROME_EXTENSIONS.map((ext) => (
              <ExtensionCard key={ext.name} ext={ext} />
            ))}
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
