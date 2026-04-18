import {
  useListApps,
  useInstallApp,
  useRetryAppInstall,
  useUninstallApp,
  getAppSsoRedirect,
  useGetCurrentMember,
  getFlexyCredentials,
} from "@workspace/api-client-react";
import { useEffect, useState } from "react";
import type { AppInstance, AppInstanceAppName } from "@workspace/api-client-react";
import type { UseQueryOptions } from "@tanstack/react-query";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { ComponentType } from "react";
import {
  Lock,
  ExternalLink,
  Loader2,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  Trash2,
  Ban,
  Mail,
} from "lucide-react";
import { FlexyIcon } from "@/components/icons/FlexyIcon";
import { MetricMoverIcon } from "@/components/icons/MetricMoverIcon";
import { PixelPressIcon } from "@/components/icons/PixelPressIcon";
import { GifsterIcon } from "@/components/icons/GifsterIcon";
import { NoEscapeIcon } from "@/components/icons/NoEscapeIcon";
import { DiytraxIcon } from "@/components/icons/DiytraxIcon";

type AppInstanceWithDisabled = AppInstance & { disabled?: boolean };

type AppCatalogEntry = {
  name: AppInstanceAppName;
  title: string;
  tagline: string;
  icon: ComponentType<{ className?: string }>;
  accent: string;
};

const APP_CATALOG: AppCatalogEntry[] = [
  { name: "diytrax", title: "Diytrax", tagline: "DIY tracking & analytics", icon: DiytraxIcon, accent: "bg-white border border-border" },
  { name: "pixelpress", title: "PixelPress", tagline: "Drag-and-drop landing pages", icon: PixelPressIcon, accent: "bg-white border border-border" },
  { name: "gifster", title: "Gifster", tagline: "Animated GIF creator", icon: GifsterIcon, accent: "bg-white border border-border" },
  { name: "metricmover", title: "MetricMover", tagline: "Move metrics that matter", icon: MetricMoverIcon, accent: "bg-white border border-border" },
  { name: "noescape", title: "NoEscape", tagline: "Conversion-locking funnels", icon: NoEscapeIcon, accent: "bg-white border border-border" },
  { name: "flexy", title: "Flexy", tagline: "Your white-labeled CRM & marketing platform", icon: FlexyIcon, accent: "bg-white border border-border" },
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

  const byName = new Map<string, AppInstanceWithDisabled>();
  ((data ?? []) as AppInstanceWithDisabled[]).forEach((i) => byName.set(i.appName, i));

  if (isLoading) {
    return (
      <AppLayout>
        <div className="animate-pulse grid grid-cols-1 md:grid-cols-2 gap-4">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-44 bg-card rounded-xl" />
          ))}
        </div>
      </AppLayout>
    );
  }

  if (error) {
    return (
      <AppLayout>
        <div className="text-center p-12 bg-white rounded-xl border border-border">
          <h2 className="text-xl font-semibold">Could not load apps</h2>
          <p className="text-muted-foreground mt-2">Please refresh the page and try again.</p>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold">Apps</h1>
          <p className="text-muted-foreground mt-1">
            Install and manage your member apps.
          </p>
        </div>

        {!hasActiveMembership && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 flex items-start gap-3">
            <Lock className="w-5 h-5 text-amber-700 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-amber-900">An active membership is required</p>
              <p className="text-sm text-amber-800 mt-0.5">
                You'll be able to install and open apps once your membership is active.
              </p>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {APP_CATALOG.filter((app) => byName.has(app.name)).map((app) => {
            const inst = byName.get(app.name);
            const isDisabled = inst?.disabled ?? false;
            const status = inst?.status ?? "not_installed";
            const isRetrying = retryMutation.isPending && retryMutation.variables?.appName === app.name;
            const isUninstalling = uninstallMutation.isPending && uninstallMutation.variables?.appName === app.name;
            const Icon = app.icon;

            return (
              <Card key={app.name} className={`border-border ${isDisabled ? "opacity-70" : ""}`}>
                <CardContent className="p-6">
                  <div className="flex items-start gap-4">
                    <div className={`w-12 h-12 rounded-lg flex items-center justify-center ${isDisabled ? "bg-muted text-muted-foreground" : app.accent}`}>
                      <Icon className="w-6 h-6" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <h3 className="text-lg font-semibold">{app.title}</h3>
                          <p className="text-sm text-muted-foreground">{app.tagline}</p>
                        </div>
                        <div className="flex flex-col items-end gap-1">
                          {isDisabled ? (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Badge variant="outline" className="bg-gray-100 text-gray-500 border-gray-200 cursor-default">
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

                      {inst?.domain && (
                        <p className="text-xs text-muted-foreground mt-3 font-mono break-all">
                          {inst.domain}
                        </p>
                      )}

                      {isDisabled && (
                        <p className="text-xs text-muted-foreground mt-2">
                          This app is temporarily unavailable. Please check back later.
                        </p>
                      )}

                      {!isDisabled && status === "install_failed" && (
                        <p className="text-xs text-red-700 mt-2">
                          {inst?.squidyError?.includes("agency token rejected")
                            ? "Setup couldn't complete due to a configuration issue. Please try again or contact support."
                            : "The app couldn't be created. You can try again."}
                        </p>
                      )}

                      {!isDisabled && (
                        <div className="mt-4 flex gap-2">
                          {status === "not_installed" && (
                            <Button
                              size="sm"
                              disabled={installMutation.isPending || !hasActiveMembership}
                              onClick={() => installMutation.mutate({ appName: app.name })}
                              data-testid={`button-install-${app.name}`}
                            >
                              {installMutation.isPending && installMutation.variables?.appName === app.name ? (
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
                                disabled={openingApp === app.name || !hasActiveMembership}
                                onClick={() => handleOpen(app.name)}
                                data-testid={`button-open-${app.name}`}
                              >
                                {openingApp === app.name ? (
                                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Opening…</>
                                ) : (
                                  <>Open <ExternalLink className="w-4 h-4 ml-2" /></>
                                )}
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={isUninstalling}
                                onClick={() => {
                                  if (confirm(`Uninstall ${app.title}? This removes your instance.`)) {
                                    uninstallMutation.mutate({ appName: app.name });
                                  }
                                }}
                                data-testid={`button-uninstall-${app.name}`}
                              >
                                {isUninstalling ? (
                                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Uninstalling…</>
                                ) : (
                                  <><Trash2 className="w-4 h-4 mr-2" /> Uninstall</>
                                )}
                              </Button>
                            </>
                          )}
                          {status === "install_failed" && (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={isRetrying || !hasActiveMembership}
                              onClick={() => retryMutation.mutate({ appName: app.name })}
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
                      )}

                      {!isDisabled && app.name === "flexy" && status === "installed" && (
                        <FlexyCredentialsPanel />
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </AppLayout>
  );
}

function FlexyCredentialsPanel() {
  const { toast } = useToast();
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await getFlexyCredentials();
        if (cancelled) return;
        setEmail(data.email ?? null);
      } catch {
        if (!cancelled) {
          toast({ title: "Could not load Flexy login email", variant: "destructive" });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="mt-4 rounded-lg border border-border bg-muted/40 p-3 space-y-2">
      <div className="text-xs font-medium text-muted-foreground">Flexy login</div>
      <div className="flex items-center gap-2 text-sm">
        <span className="text-muted-foreground w-16">Email</span>
        <span className="font-mono break-all" data-testid="text-flexy-email">
          {email ?? "—"}
        </span>
      </div>
      <div className="flex items-start gap-2 text-xs text-muted-foreground">
        <Mail className="w-4 h-4 mt-0.5 shrink-0" />
        <span>
          Check your inbox for an activation email from Flexy to set your password.
          If you've forgotten it, use the "Forgot password" link on the Flexy login page.
        </span>
      </div>
    </div>
  );
}
