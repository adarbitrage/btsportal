import {
  useListApps,
  useInstallApp,
  useRetryAppInstall,
  useUninstallApp,
  getAppSsoRedirect,
  useGetCurrentMember,
  useGetFlexyCredentials,
} from "@workspace/api-client-react";
import { useState } from "react";
import type { AppInstance, AppInstanceAppName } from "@workspace/api-client-react";
import type { UseQueryOptions } from "@tanstack/react-query";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  AppWindow,
  Lock,
  ExternalLink,
  Loader2,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  Trash2,
  Ban,
  Copy,
  Check,
} from "lucide-react";
import flexyLogo from "@assets/flexy-logo_1778710958688.jpg";
import diytraxLogo from "@assets/diytrax-logo_1778710958688.jpg";
import metricmoverLogo from "@assets/metricmover-logo_1778710958687.jpg";
import pixelpressLogo from "@assets/pixelpress-logo_1778710958686.jpg";
import gifsterLogo from "@assets/gifster-logo_1778710958687.png";
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

type AppInstanceWithDisabled = AppInstance & { disabled?: boolean };

type AppCatalogEntry = {
  name: AppInstanceAppName;
  title: string;
  category: string;
  tagline: string;
  description: string;
  highlights: string[];
  logo: string;
  logoBg: string;
  collapsible?: boolean;
  accent: {
    border: string;
    badgeBg: string;
    badgeText: string;
    badgeBorder: string;
  };
};

const APP_CATALOG: AppCatalogEntry[] = [
  {
    name: "flexy",
    title: "Flexy",
    category: "Drag & Drop Landing Pages",
    tagline: "Build a landing page in under an hour with no-code drag-and-drop.",
    description:
      "No code required — design and publish landing pages with a point-and-click editor. Skip the wait for developers and start testing offers fast.",
    highlights: [
      "Point-and-click editor for designing every section of a page",
      "80+ professionally designed templates ready to launch",
      "Customize global colors, fonts, and layout with a few clicks",
      "Fully responsive — pages scale automatically on phones and tablets",
    ],
    logo: flexyLogo,
    logoBg: "bg-white",
    collapsible: true,
    accent: {
      border: "border-red-300",
      badgeBg: "bg-red-50",
      badgeText: "text-red-800",
      badgeBorder: "border-red-200",
    },
  },
  {
    name: "diytrax",
    title: "Diytrax",
    category: "URL & Lander Rotator",
    tagline: "Stable, reliable URL rotation and campaign tracking.",
    description:
      "A URL rotator and tracker built specifically for the affiliate workflows used inside the Build Test Scale system. Stable, reliable, and free to use.",
    highlights: [
      "Run Direct Link, Landing Page, Multi-Path, or Multi-Option campaigns",
      "Track, test, and optimize across multiple traffic sources with on-the-fly control",
      "Detailed data on ads, keywords, pages, and offers tied to revenue",
      "Add or edit pages and offers on the fly — no coding required",
    ],
    logo: diytraxLogo,
    logoBg: "bg-white",
    collapsible: true,
    accent: {
      border: "border-neutral-300",
      badgeBg: "bg-neutral-100",
      badgeText: "text-neutral-800",
      badgeBorder: "border-neutral-200",
    },
  },
  {
    name: "metricmover",
    title: "MetricMover",
    category: "Lander Split Tester",
    tagline: "Run thousands of landing page split tests in minutes.",
    description:
      "Replace the painfully manual process of split testing landing page elements. Test headlines, hero shots, CTAs, and entire HTML blocks at scale to find what converts.",
    highlights: [
      "Spin up thousands of split tests in minutes",
      "Test one element at a time, or large chunks of HTML",
      "Cover headlines, sub-headlines, hero shots, lead paragraphs, layouts, and CTAs",
      "Seamlessly upload tests to Diytrax to rotate variations and find winners",
    ],
    logo: metricmoverLogo,
    logoBg: "bg-white",
    collapsible: true,
    accent: {
      border: "border-emerald-300",
      badgeBg: "bg-emerald-50",
      badgeText: "text-emerald-800",
      badgeBorder: "border-emerald-200",
    },
  },
  {
    name: "pixelpress",
    title: "PixelPress",
    category: "Bulk Banner Creator",
    tagline: "Bulk-create and split test banner ads at any size.",
    description:
      "Built for traffic operators who need to test variations fast. Quickly produce banner ad combinations across headlines, body copy, CTAs, and images — there's nothing else like it on the market.",
    highlights: [
      "Generate thousands of banner variations in minutes",
      "Split test layouts, headlines, images, CTAs, and anything else",
      "Optimize images automatically to target file sizes",
      "Output to single or multiple zip files based on file size",
      "Choose from a variety of template layouts to start fast",
    ],
    logo: pixelpressLogo,
    logoBg: "bg-white",
    collapsible: true,
    accent: {
      border: "border-yellow-300",
      badgeBg: "bg-yellow-50",
      badgeText: "text-yellow-900",
      badgeBorder: "border-yellow-200",
    },
  },
  {
    name: "gifster",
    title: "Gifster",
    category: "Ad Images, Automated",
    tagline: "Generate hundreds of ad-ready animated GIFs in a fraction of the time.",
    description:
      "Animated GIFs are crucial for ad CTRs at scale, but creating them manually is painful. Gifster automates the work — search YouTube, set durations, and download finished GIFs sized to match every banner.",
    highlights: [
      "Search YouTube for source videos on any topic",
      "Set GIF length anywhere from 1 to 5 seconds",
      "Match output dimensions to all PixelPress banner sizes",
      "Download finished GIFs ready to upload into PixelPress",
    ],
    logo: gifsterLogo,
    logoBg: "bg-white",
    collapsible: true,
    accent: {
      border: "border-fuchsia-300",
      badgeBg: "bg-fuchsia-50",
      badgeText: "text-fuchsia-800",
      badgeBorder: "border-fuchsia-200",
    },
  },
];

function StatusBadge({ status }: { status: AppInstance["status"] }) {
  if (status === "installed") {
    return (
      <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
        <CheckCircle2 className="w-3 h-3 mr-1" /> Installed
      </Badge>
    );
  }
  if (status === "installing") {
    return (
      <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">
        <Loader2 className="w-3 h-3 mr-1 animate-spin" /> Installing
      </Badge>
    );
  }
  if (status === "uninstalling") {
    return (
      <Badge variant="outline" className="bg-orange-50 text-orange-700 border-orange-200">
        <Loader2 className="w-3 h-3 mr-1 animate-spin" /> Uninstalling
      </Badge>
    );
  }
  if (status === "install_failed") {
    return (
      <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200">
        <AlertCircle className="w-3 h-3 mr-1" /> Install failed
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="bg-muted text-muted-foreground">
      Not installed
    </Badge>
  );
}

function FlexyCredentialsInline() {
  const { toast } = useToast();
  const { data, isLoading, error } = useGetFlexyCredentials();
  const [copied, setCopied] = useState(false);

  if (isLoading) {
    return (
      <div className="text-xs text-muted-foreground flex items-center gap-1.5">
        <Loader2 className="w-3 h-3 animate-spin" /> Loading login email…
      </div>
    );
  }

  if (error || !data?.email) {
    return null;
  }

  const email = data.email;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(email);
      setCopied(true);
      toast({ title: "Copied", description: "Login email copied to clipboard." });
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({
        title: "Copy failed",
        description: "Couldn't copy to your clipboard.",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-xs text-muted-foreground">Login email:</span>
        <span
          className="text-xs font-mono break-all text-foreground"
          data-testid="text-flexy-email"
        >
          {email}
        </span>
        <button
          type="button"
          onClick={handleCopy}
          className="inline-flex items-center text-xs text-primary hover:underline gap-1"
          data-testid="button-copy-flexy-email"
        >
          {copied ? (
            <><Check className="w-3 h-3" /> Copied</>
          ) : (
            <><Copy className="w-3 h-3" /> Copy</>
          )}
        </button>
      </div>
      <p className="text-[11px] text-muted-foreground/80 italic">
        First time? Use <span className="font-medium not-italic">Forgot password</span> on the Flexy login screen.
      </p>
    </div>
  );
}

type AppCardProps = {
  app: AppCatalogEntry;
  inst: AppInstanceWithDisabled | undefined;
  hasActiveMembership: boolean;
  openingApp: string | null;
  onOpen: (appName: AppInstanceAppName) => void;
  onInstall: (appName: AppInstanceAppName) => void;
  onRetry: (appName: AppInstanceAppName) => void;
  onUninstall: (appName: AppInstanceAppName, title: string) => void;
  installPendingFor: AppInstanceAppName | undefined;
  retryPendingFor: AppInstanceAppName | undefined;
  uninstallPendingFor: AppInstanceAppName | undefined;
  installIsPending: boolean;
};

function AppCard({
  app,
  inst,
  hasActiveMembership,
  openingApp,
  onOpen,
  onInstall,
  onRetry,
  onUninstall,
  installPendingFor,
  retryPendingFor,
  uninstallPendingFor,
  installIsPending,
}: AppCardProps) {
  const isDisabled = inst?.disabled ?? false;
  const status = inst?.status ?? "not_installed";
  const isRetrying = retryPendingFor === app.name;
  const isUninstalling = uninstallPendingFor === app.name;
  const isInstallingNow = installIsPending && installPendingFor === app.name;
  const [expanded, setExpanded] = useState(!app.collapsible);
  const showHighlights = !app.collapsible || expanded;

  return (
    <Card
      className={`border-2 ${app.accent.border} hover:shadow-lg transition-shadow overflow-hidden ${isDisabled ? "opacity-70" : ""}`}
      data-testid={`card-app-${app.name}`}
    >
      <CardContent className="p-0">
        <div className="flex flex-col md:flex-row">
          <div
            className={`${app.logoBg} flex items-center justify-center p-6 md:p-8 md:w-56 shrink-0 border-b md:border-b-0 md:border-r border-border`}
          >
            <img
              src={app.logo}
              alt={`${app.title} logo`}
              className="max-h-28 max-w-full object-contain"
            />
          </div>

          <div className="flex-1 p-5 flex flex-col">
            <div className="flex flex-wrap items-start justify-between gap-3 mb-2">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <h2 className="text-xl font-bold text-foreground">{app.title}</h2>
                  <Badge
                    variant="outline"
                    className={`${app.accent.badgeBg} ${app.accent.badgeText} ${app.accent.badgeBorder} text-[10px] font-bold tracking-wide uppercase`}
                  >
                    {app.category}
                  </Badge>
                </div>
                <p className="text-sm text-muted-foreground mt-1">{app.tagline}</p>
              </div>
              <div className="shrink-0">
                {isDisabled ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Badge
                        variant="outline"
                        className="bg-gray-100 text-gray-500 border-gray-200 cursor-default"
                      >
                        <Ban className="w-3 h-3 mr-1" /> Temporarily unavailable
                      </Badge>
                    </TooltipTrigger>
                    <TooltipContent>
                      This app has been temporarily disabled by an administrator. Please check back later.
                    </TooltipContent>
                  </Tooltip>
                ) : (
                  <StatusBadge status={status} />
                )}
              </div>
            </div>

            <p className="text-sm text-foreground/90 leading-relaxed mb-3">
              {app.description}
            </p>

            {showHighlights && (
              <ul className="space-y-1 mb-3">
                {app.highlights.map((h, i) => (
                  <li
                    key={i}
                    className="flex items-start gap-2 text-sm text-foreground/85"
                  >
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 mt-0.5 shrink-0" />
                    <span>{h}</span>
                  </li>
                ))}
              </ul>
            )}

            {isDisabled && (
              <p className="text-xs text-muted-foreground">
                This app is temporarily unavailable. Please check back later.
              </p>
            )}

            {!isDisabled && status === "install_failed" && (
              <p className="text-xs text-red-700 mb-2">
                {inst?.squidyError?.includes("agency token rejected")
                  ? "Setup couldn't complete due to a configuration issue. Please try again or contact support."
                  : "The app couldn't be created. You can try again."}
              </p>
            )}

            {!isDisabled && (
              <div className="mt-auto flex items-end justify-between gap-3 flex-wrap">
                <div className="min-w-0 flex-1 space-y-1">
                  {app.collapsible && (
                    <button
                      type="button"
                      onClick={() => setExpanded((v) => !v)}
                      className="text-xs font-medium text-primary hover:underline"
                      data-testid={`button-toggle-details-${app.name}`}
                    >
                      {expanded ? "Show less" : "Read more"}
                    </button>
                  )}
                  {inst?.domain && (
                    <p className="text-xs text-muted-foreground font-mono break-all">
                      {inst.domain}
                    </p>
                  )}
                  {app.name === "flexy" && status === "installed" && (
                    <FlexyCredentialsInline />
                  )}
                </div>
                <div className="flex items-center gap-2 flex-wrap justify-end">
                  {status === "not_installed" && (
                    <Button
                      size="sm"
                      disabled={installIsPending || !hasActiveMembership}
                      onClick={() => onInstall(app.name)}
                      data-testid={`button-install-${app.name}`}
                    >
                      {isInstallingNow ? (
                        <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Starting…</>
                      ) : (
                        "Install"
                      )}
                    </Button>
                  )}
                  {status === "installing" && (
                    <Button size="sm" disabled>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Installing…
                    </Button>
                  )}
                  {status === "uninstalling" && (
                    <Button size="sm" disabled variant="outline">
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Uninstalling…
                    </Button>
                  )}
                  {status === "installed" && inst?.domain && (
                    <>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={isUninstalling}
                        onClick={() => onUninstall(app.name, app.title)}
                        data-testid={`button-uninstall-${app.name}`}
                      >
                        {isUninstalling ? (
                          <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Uninstalling…</>
                        ) : (
                          <><Trash2 className="w-4 h-4 mr-2" /> Uninstall</>
                        )}
                      </Button>
                      <Button
                        size="sm"
                        disabled={openingApp === app.name || !hasActiveMembership}
                        onClick={() => onOpen(app.name)}
                        data-testid={`button-open-${app.name}`}
                      >
                        {openingApp === app.name ? (
                          <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Opening…</>
                        ) : (
                          <>Open <ExternalLink className="w-4 h-4 ml-2" /></>
                        )}
                      </Button>
                    </>
                  )}
                  {status === "install_failed" && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={isRetrying || !hasActiveMembership}
                      onClick={() => onRetry(app.name)}
                      data-testid={`button-retry-${app.name}`}
                    >
                      {isRetrying ? (
                        <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Retrying…</>
                      ) : (
                        <><RefreshCw className="w-4 h-4 mr-2" /> Retry</>
                      )}
                    </Button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

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

export default function Apps() {
  const { toast } = useToast();
  const { data: member } = useGetCurrentMember();
  const hasActiveMembership = (member?.entitlements ?? []).length > 0;
  const probe = useListApps();
  const hasInstalling = (probe.data ?? []).some((a) => a.status === "installing");
  const queryOpts = {
    refetchInterval: hasInstalling ? 15000 : false,
  } as UseQueryOptions<AppInstance[]>;
  const { data, isLoading, error, refetch } = useListApps({ query: queryOpts });

  const installMutation = useInstallApp({
    mutation: {
      onSuccess: () => {
        toast({ title: "Installation started", description: "We're setting up your instance. This usually takes a couple of minutes." });
        refetch();
      },
      onError: () => {
        toast({ title: "The app couldn't be created", description: "Please try again in a moment.", variant: "destructive" });
        refetch();
      },
    },
  });

  const retryMutation = useRetryAppInstall({
    mutation: {
      onSuccess: () => {
        toast({ title: "Retrying installation", description: "We've asked the app to retry the install." });
        refetch();
      },
      onError: () => {
        toast({ title: "The app couldn't be created", description: "Please try again in a moment.", variant: "destructive" });
        refetch();
      },
    },
  });

  const [openingApp, setOpeningApp] = useState<string | null>(null);

  const handleOpen = async (appName: AppInstanceAppName) => {
    setOpeningApp(appName);
    const popup = window.open("about:blank", "_blank");
    try {
      const { url } = await getAppSsoRedirect(appName);
      if (popup) {
        popup.location.href = url;
      } else {
        window.location.href = url;
      }
    } catch {
      if (popup) popup.close();
      toast({ title: "Couldn't open app", description: "Please try again in a moment.", variant: "destructive" });
    } finally {
      setOpeningApp(null);
    }
  };

  const uninstallMutation = useUninstallApp({
    mutation: {
      onSuccess: () => {
        toast({ title: "App uninstalled", description: "Your instance has been removed." });
        refetch();
      },
      onError: () => {
        toast({ title: "Uninstall failed", description: "Please try again in a moment.", variant: "destructive" });
      },
    },
  });

  const handleUninstall = (appName: AppInstanceAppName, title: string) => {
    if (confirm(`Uninstall ${title}? This removes your instance.`)) {
      uninstallMutation.mutate({ appName });
    }
  };

  const byName = new Map<string, AppInstanceWithDisabled>();
  ((data ?? []) as AppInstanceWithDisabled[]).forEach((i) => byName.set(i.appName, i));

  if (isLoading) {
    return (
      <AppLayout>
        <div className="space-y-6 max-w-6xl">
          <div className="animate-pulse space-y-5">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-56 bg-card rounded-xl border border-border" />
            ))}
          </div>
        </div>
      </AppLayout>
    );
  }

  if (error) {
    return (
      <AppLayout>
        <div className="text-center p-12 bg-white rounded-xl border border-border max-w-6xl">
          <h2 className="text-xl font-semibold">Could not load apps</h2>
          <p className="text-muted-foreground mt-2">Please refresh the page and try again.</p>
        </div>
      </AppLayout>
    );
  }

  const visibleApps = APP_CATALOG.filter((app) => byName.has(app.name));

  return (
    <AppLayout>
      <div className="space-y-6 max-w-6xl">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <AppWindow className="w-6 h-6 text-primary" />
            <h1 className="text-3xl font-bold">Apps</h1>
          </div>
          <p className="text-muted-foreground">
            A suite of proprietary tools — built specifically for the Build Test Scale
            system. These were developed in-house for our team and aren't available
            anywhere else in the marketplace. Used together, they give members a serious
            edge over the competition.
          </p>
        </div>

        <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-4">
          <p className="text-sm text-emerald-900">
            <strong>Welcome to over $3,000,000 in proprietary tools.</strong> Each app
            below was built to remove a specific bottleneck in the Build Test Scale
            workflow — from launching landing pages, to bulk-creating banner ads, to
            split testing at scale. Install the ones needed for the current workflow,
            and open them with one click.
          </p>
        </div>

        {!hasActiveMembership && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 flex items-start gap-3">
            <Lock className="w-5 h-5 text-amber-700 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-amber-900">An active membership is required</p>
              <p className="text-sm text-amber-800 mt-0.5">
                Apps can be installed and opened once a membership is active.
              </p>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 gap-5">
          {visibleApps.map((app) => (
            <AppCard
              key={app.name}
              app={app}
              inst={byName.get(app.name)}
              hasActiveMembership={hasActiveMembership}
              openingApp={openingApp}
              onOpen={handleOpen}
              onInstall={(name) => installMutation.mutate({ appName: name })}
              onRetry={(name) => retryMutation.mutate({ appName: name })}
              onUninstall={handleUninstall}
              installPendingFor={installMutation.variables?.appName}
              retryPendingFor={retryMutation.variables?.appName}
              uninstallPendingFor={uninstallMutation.variables?.appName}
              installIsPending={installMutation.isPending}
            />
          ))}
        </div>

        <div className="pt-4 space-y-4">
          <div>
            <h2 className="text-2xl font-bold text-foreground">Partner Tools</h2>
            <p className="text-muted-foreground text-sm mt-1">
              Third-party AI tools that BTS members get free access to. Register through
              the BTS link to claim your free account or credits.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-5">
            {PARTNER_TOOLS.map((tool) => (
              <PartnerToolCard key={tool.name} tool={tool} />
            ))}
          </div>
        </div>

        <div className="pt-4 space-y-4">
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
