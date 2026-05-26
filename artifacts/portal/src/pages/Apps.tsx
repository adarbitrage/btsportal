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
  Chrome,
} from "lucide-react";
import flexyLogo from "@assets/flexy-logo_1778710958688.jpg";
import diytraxLogo from "@assets/diytrax-logo_1778710958688.jpg";
import metricmoverLogo from "@assets/metricmover-logo_1778710958687.jpg";
import pixelpressLogo from "@assets/pixelpress-logo_1778710958686.jpg";
import gifsterLogo from "@assets/gifster-logo_1778710958687.png";
import scrapebotLogo from "@assets/scrapebot-new-logo-resources-image-250x222_1778795701373.jpg";
import cropbotLogo from "@assets/cropbot-new-logo-resources-image-250x222_1778795879400.jpg";
import { VidalyticsDialog } from "@/components/VidalyticsDialog";

type AppInstanceWithDisabled = AppInstance & { disabled?: boolean };

type AppCatalogEntry = {
  name: AppInstanceAppName | string;
  title: string;
  category: string;
  tagline: string;
  description: string;
  highlights: string[];
  logo: string;
  logoBg: string;
  collapsible?: boolean;
  overviewVideoUrl?: string;
  overviewVideoPoster?: string;
  appType?: "installable" | "chrome-extension";
  externalUrl?: string;
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
    overviewVideoUrl: `${import.meta.env.BASE_URL}videos/flexy.mp4`,
    overviewVideoPoster: `${import.meta.env.BASE_URL}video-posters/flexy.jpg`,
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
    overviewVideoUrl: `${import.meta.env.BASE_URL}videos/diytrax.mp4`,
    overviewVideoPoster: `${import.meta.env.BASE_URL}video-posters/diytrax.jpg`,
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
    overviewVideoUrl: `${import.meta.env.BASE_URL}videos/metricmover.mp4`,
    overviewVideoPoster: `${import.meta.env.BASE_URL}video-posters/metricmover.jpg`,
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
    overviewVideoUrl: `${import.meta.env.BASE_URL}videos/pixelpress.mp4`,
    overviewVideoPoster: `${import.meta.env.BASE_URL}video-posters/pixelpress.jpg`,
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
    overviewVideoUrl: `${import.meta.env.BASE_URL}videos/gifster.mp4`,
    overviewVideoPoster: `${import.meta.env.BASE_URL}video-posters/gifster.jpg`,
    accent: {
      border: "border-fuchsia-300",
      badgeBg: "bg-fuchsia-50",
      badgeText: "text-fuchsia-800",
      badgeBorder: "border-fuchsia-200",
    },
  },
  {
    name: "scrapebot",
    title: "ScrapeBot",
    category: "Google/Bing Image Scraper",
    tagline: "Scrape Google, Bing & DuckDuckGo images straight from your browser.",
    description:
      "A Chrome extension built for the BTS workflow — quickly locate and download images for banner ads and advertorial pages. Paired with CropBot and PixelPress, it replaces Photoshop entirely.",
    highlights: [
      "Scrape images from Google, Bing, and DuckDuckGo with one click",
      "Bulk-select and download exactly what you need",
      "Built to feed directly into CropBot and PixelPress",
      "Used daily by the BTS team for banner and advertorial creation",
    ],
    logo: scrapebotLogo,
    logoBg: "bg-white",
    collapsible: true,
    overviewVideoUrl: `${import.meta.env.BASE_URL}videos/scrapebot.mp4`,
    overviewVideoPoster: `${import.meta.env.BASE_URL}video-posters/scrapebot.jpg`,
    appType: "chrome-extension",
    externalUrl: "https://chromewebstore.google.com/detail/scrapebot-207/beongpingjcjghpgfcngccpkpmhgldjm",
    accent: {
      border: "border-blue-300",
      badgeBg: "bg-blue-50",
      badgeText: "text-blue-800",
      badgeBorder: "border-blue-200",
    },
  },
  {
    name: "cropbot",
    title: "CropBot",
    category: "Image Cropper & Resizer",
    tagline: "Crop and resize the images you grab with ScrapeBot — right in your browser.",
    description:
      "A Chrome extension that handles the cropping and resizing step after scraping. Images pulled from Google rarely match your target dimensions — CropBot fixes that in seconds, no Photoshop required.",
    highlights: [
      "Crop and resize images to any target dimension in seconds",
      "Match the exact sizes used by PixelPress banner templates",
      "Works hand-in-hand with ScrapeBot and PixelPress",
      "No design software needed — runs entirely inside Chrome",
    ],
    logo: cropbotLogo,
    logoBg: "bg-white",
    collapsible: true,
    overviewVideoUrl: `${import.meta.env.BASE_URL}videos/cropbot.mp4`,
    overviewVideoPoster: `${import.meta.env.BASE_URL}video-posters/cropbot.jpg`,
    appType: "chrome-extension",
    externalUrl: "https://chrome.google.com/webstore/detail/cropbot-201/kkabdjjmpkogggbjoenafjejhkalkjdd",
    accent: {
      border: "border-orange-300",
      badgeBg: "bg-orange-50",
      badgeText: "text-orange-800",
      badgeBorder: "border-orange-200",
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
  return (
    <p className="text-[11px] text-muted-foreground/80 italic">
      First time? Login using the email in your BTS account and click{" "}
      <span className="font-medium not-italic">Forgot password</span>
    </p>
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
                ) : app.appType === "chrome-extension" ? (
                  <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">
                    <Chrome className="w-3 h-3 mr-1" /> Chrome Extension
                  </Badge>
                ) : (
                  <StatusBadge status={status} />
                )}
              </div>
            </div>

            <p className="text-sm text-foreground/90 leading-relaxed mb-3">
              {app.description}
            </p>

            {app.overviewVideoUrl && (
              <div className="mb-3">
                <VidalyticsDialog
                  videoUrl={app.overviewVideoUrl}
                  posterUrl={app.overviewVideoPoster}
                  title={`${app.title} — Overview`}
                  triggerLabel={`Watch ${app.title} overview`}
                  variant="thumbnail"
                />
              </div>
            )}

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
                  {app.name === "flexy" && status === "installed" && (
                    <FlexyCredentialsInline />
                  )}
                </div>
                <div className="flex items-center gap-2 flex-wrap justify-end">
                  {app.appType === "chrome-extension" && app.externalUrl ? (
                    <Button
                      asChild
                      size="sm"
                      data-testid={`button-add-chrome-${app.name}`}
                    >
                      <a href={app.externalUrl} target="_blank" rel="noopener noreferrer">
                        <Chrome className="w-4 h-4 mr-2" /> Add to Chrome
                      </a>
                    </Button>
                  ) : (
                    <>
                      {status === "not_installed" && (
                        <Button
                          size="sm"
                          disabled={installIsPending || !hasActiveMembership}
                          onClick={() => onInstall(app.name as AppInstanceAppName)}
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
                      {status === "installed" && inst?.domain && (
                        <Button
                          size="sm"
                          disabled={openingApp === app.name || !hasActiveMembership}
                          onClick={() => onOpen(app.name as AppInstanceAppName)}
                          data-testid={`button-open-${app.name}`}
                        >
                          {openingApp === app.name ? (
                            <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Opening…</>
                          ) : (
                            <>Open</>
                          )}
                        </Button>
                      )}
                      {status === "install_failed" && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={isRetrying || !hasActiveMembership}
                          onClick={() => onRetry(app.name as AppInstanceAppName)}
                          data-testid={`button-retry-${app.name}`}
                        >
                          {isRetrying ? (
                            <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Retrying…</>
                          ) : (
                            <><RefreshCw className="w-4 h-4 mr-2" /> Retry</>
                          )}
                        </Button>
                      )}
                    </>
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

  const visibleApps = APP_CATALOG.filter(
    (app) => app.appType === "chrome-extension" || byName.has(app.name),
  );

  return (
    <AppLayout>
      <div className="space-y-6 max-w-6xl">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <AppWindow className="w-6 h-6 text-primary" />
            <h1 className="text-3xl font-bold">Apps</h1>
          </div>
          <p className="text-muted-foreground">
            Over $3,000,000 in proprietary tools, built in-house for the Build
            Test Scale system and not available anywhere else. Each app removes a
            specific bottleneck in the workflow — from launching landing pages, to
            bulk-creating banner ads, to split testing at scale. Install the ones
            needed for the current workflow and open them with one click.
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
      </div>
    </AppLayout>
  );
}

