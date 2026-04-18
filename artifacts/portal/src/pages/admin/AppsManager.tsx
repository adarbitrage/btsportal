import { useState } from "react";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { LucideIcon } from "lucide-react";
import {
  Activity,
  Image as ImageIcon,
  Film,
  BarChart3,
  Lock,
  AppWindow,
} from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

type AppSetting = {
  appName: string;
  enabled: boolean;
  visible: boolean;
  updatedAt: string | null;
  updatedByEmail: string | null;
};

type AppPatch = { enabled?: boolean; visible?: boolean };

type AppCatalogEntry = {
  name: string;
  title: string;
  tagline: string;
  icon: LucideIcon;
  accent: string;
};

const APP_CATALOG: AppCatalogEntry[] = [
  { name: "diytrax", title: "Diytrax", tagline: "DIY tracking & analytics", icon: Activity, accent: "bg-blue-50 text-blue-700" },
  { name: "pixelpress", title: "PixelPress", tagline: "Drag-and-drop landing pages", icon: ImageIcon, accent: "bg-purple-50 text-purple-700" },
  { name: "gifster", title: "Gifster", tagline: "Animated GIF creator", icon: Film, accent: "bg-pink-50 text-pink-700" },
  { name: "metricmover", title: "MetricMover", tagline: "Move metrics that matter", icon: BarChart3, accent: "bg-green-50 text-green-700" },
  { name: "noescape", title: "NoEscape", tagline: "Conversion-locking funnels", icon: Lock, accent: "bg-amber-50 text-amber-700" },
];

async function fetchAppStatuses(): Promise<AppSetting[]> {
  const res = await fetch("/api/admin/apps-manager", { credentials: "include" });
  if (!res.ok) throw new Error("Failed to fetch app statuses");
  return res.json();
}

async function updateAppStatus(appName: string, patch: AppPatch): Promise<AppSetting> {
  const res = await fetch(`/api/admin/apps-manager/${appName}`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? "Failed to update app status");
  }
  return res.json();
}

function formatDate(iso: string | null): string {
  if (!iso) return "Never";
  return new Date(iso).toLocaleString();
}

export default function AppsManager() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: statuses = [], isLoading } = useQuery<AppSetting[]>({
    queryKey: ["admin", "apps-manager"],
    queryFn: fetchAppStatuses,
  });

  type PendingAction =
    | { kind: "disable"; appName: string; title: string }
    | { kind: "hide"; appName: string; title: string };

  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);

  const mutation = useMutation({
    mutationFn: ({ appName, patch }: { appName: string; patch: AppPatch }) =>
      updateAppStatus(appName, patch),
    onSuccess: (updated, variables) => {
      queryClient.setQueryData<AppSetting[]>(["admin", "apps-manager"], (prev) =>
        (prev ?? []).map((s) => (s.appName === updated.appName ? updated : s)),
      );
      if ("enabled" in variables.patch) {
        toast({
          title: updated.enabled ? "App enabled" : "App disabled",
          description: `${updated.appName} is now ${updated.enabled ? "available" : "unavailable"} to members.`,
        });
      } else if ("visible" in variables.patch) {
        toast({
          title: updated.visible ? "App shown" : "App hidden",
          description: `${updated.appName} is now ${updated.visible ? "visible" : "hidden"} on the member apps page.`,
        });
      }
      setPendingAction(null);
    },
    onError: (err: Error) => {
      toast({ title: "Failed to update", description: err.message, variant: "destructive" });
      setPendingAction(null);
    },
  });

  const settingByName = new Map(statuses.map((s) => [s.appName, s]));

  const handleEnabledToggle = (appName: string, title: string, currentEnabled: boolean) => {
    if (currentEnabled) {
      setPendingAction({ kind: "disable", appName, title });
    } else {
      mutation.mutate({ appName, patch: { enabled: true } });
    }
  };

  const handleVisibleToggle = (appName: string, title: string, currentVisible: boolean) => {
    if (currentVisible) {
      setPendingAction({ kind: "hide", appName, title });
    } else {
      mutation.mutate({ appName, patch: { visible: true } });
    }
  };

  const confirmPending = () => {
    if (!pendingAction) return;
    if (pendingAction.kind === "disable") {
      mutation.mutate({ appName: pendingAction.appName, patch: { enabled: false } });
    } else {
      mutation.mutate({ appName: pendingAction.appName, patch: { visible: false } });
    }
  };

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <AppWindow className="w-6 h-6" /> Apps Manager
          </h1>
          <p className="text-muted-foreground mt-1">
            Control each app globally. <strong>Show</strong> controls whether the app appears on the member apps page at all. <strong>Enabled</strong> controls whether members can install, open, retry, or uninstall it. Existing installs are always preserved.
          </p>
        </div>

        {isLoading ? (
          <div className="p-8 text-center text-muted-foreground">Loading app statuses...</div>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Apps</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="divide-y">
                {APP_CATALOG.map((app) => {
                  const setting = settingByName.get(app.name);
                  const enabled = setting?.enabled ?? true;
                  const visible = setting?.visible ?? true;
                  const Icon = app.icon;
                  const rowBusy = mutation.isPending && pendingAction?.appName === app.name;

                  return (
                    <div key={app.name} className="flex items-center gap-4 p-5">
                      <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${app.accent}`}>
                        <Icon className="w-5 h-5" />
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium">{app.title}</span>
                          {visible ? (
                            <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200 text-xs">Shown</Badge>
                          ) : (
                            <Badge variant="outline" className="bg-gray-100 text-gray-600 border-gray-200 text-xs">Hidden</Badge>
                          )}
                          {enabled ? (
                            <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200 text-xs">Enabled</Badge>
                          ) : (
                            <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200 text-xs">Disabled</Badge>
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground">{app.tagline}</p>
                        <p className="text-xs text-muted-foreground mt-1">
                          Last changed: {formatDate(setting?.updatedAt ?? null)}
                          {setting?.updatedByEmail ? ` by ${setting.updatedByEmail}` : ""}
                        </p>
                      </div>

                      <div className="flex items-center gap-6 shrink-0">
                        <div className="flex flex-col items-center gap-1">
                          <span className="text-xs text-muted-foreground">Show</span>
                          <Switch
                            checked={visible}
                            disabled={rowBusy || mutation.isPending}
                            onCheckedChange={() => handleVisibleToggle(app.name, app.title, visible)}
                            aria-label={`${visible ? "Hide" : "Show"} ${app.title} on member apps page`}
                          />
                        </div>
                        <div className="flex flex-col items-center gap-1">
                          <span className="text-xs text-muted-foreground">Enabled</span>
                          <Switch
                            checked={enabled}
                            disabled={rowBusy || mutation.isPending}
                            onCheckedChange={() => handleEnabledToggle(app.name, app.title, enabled)}
                            aria-label={`${enabled ? "Disable" : "Enable"} ${app.title}`}
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      <Dialog open={!!pendingAction} onOpenChange={(open) => { if (!open) setPendingAction(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {pendingAction?.kind === "hide" ? `Hide ${pendingAction?.title}?` : `Disable ${pendingAction?.title}?`}
            </DialogTitle>
            <DialogDescription>
              {pendingAction?.kind === "hide"
                ? "This app will be removed from the member apps page entirely until it is shown again. Existing installs are preserved."
                : "Members will no longer be able to install, open, retry, or uninstall this app until it is re-enabled. Existing installs are preserved and will resume working once the app is re-enabled."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingAction(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirmPending} disabled={mutation.isPending}>
              {mutation.isPending
                ? pendingAction?.kind === "hide" ? "Hiding..." : "Disabling..."
                : pendingAction?.kind === "hide" ? "Hide App" : "Disable App"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
