import { useEffect, useRef, useState } from "react";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
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
import type { ComponentType } from "react";
import {
  AppWindow,
  Copy,
  KeyRound,
  Loader2,
  Mail,
  MessageSquare,
  Search,
  User as UserIcon,
} from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { FlexyIcon } from "@/components/icons/FlexyIcon";
import { MetricMoverIcon } from "@/components/icons/MetricMoverIcon";
import { PixelPressIcon } from "@/components/icons/PixelPressIcon";
import { GifsterIcon } from "@/components/icons/GifsterIcon";
import { NoEscapeIcon } from "@/components/icons/NoEscapeIcon";
import { DiytraxIcon } from "@/components/icons/DiytraxIcon";
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

type MemberSearchResult = {
  id: number;
  name: string;
  email: string;
  role: string;
};

type FlexyLookup = {
  member: {
    id: number;
    name: string;
    email: string;
    hasPhone: boolean;
    smsOptIn: boolean;
  };
  flexy: {
    status: string;
    email: string | null;
    locationId: string | null;
    hasStaffUser: boolean;
    updatedAt: string | null;
  };
};

type NotifyChannelStatus = "sent" | "skipped" | "failed";
type RegenerateResponse = {
  email: string;
  newPassword: string;
  notifications: {
    email: { requested: boolean; status: NotifyChannelStatus; reason?: string };
    sms: { requested: boolean; status: NotifyChannelStatus; reason?: string };
  };
};

async function searchMembers(query: string): Promise<MemberSearchResult[]> {
  const qs = new URLSearchParams({ q: query });
  const res = await fetch(`/api/admin/search?${qs.toString()}`, { credentials: "include" });
  if (!res.ok) throw new Error("Member search failed");
  const data = (await res.json()) as { members?: MemberSearchResult[] };
  return data.members ?? [];
}

async function fetchFlexyLookup(userId: number): Promise<FlexyLookup> {
  const res = await fetch(`/api/admin/apps/flexy/lookup/${userId}`, { credentials: "include" });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? "Failed to look up Flexy details");
  }
  return res.json();
}

async function regenerateFlexyPassword(
  userId: number,
  notify: { notifyEmail: boolean; notifySms: boolean },
): Promise<RegenerateResponse> {
  const res = await fetch(`/api/admin/apps/flexy/regenerate-password/${userId}`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(notify),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? "Failed to regenerate password");
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

        <FlexyLookupCard />


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

function FlexyStatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; className: string }> = {
    installed: { label: "Installed", className: "bg-green-50 text-green-700 border-green-200" },
    installing: { label: "Installing", className: "bg-blue-50 text-blue-700 border-blue-200" },
    uninstalling: { label: "Uninstalling", className: "bg-orange-50 text-orange-700 border-orange-200" },
    install_failed: { label: "Install failed", className: "bg-red-50 text-red-700 border-red-200" },
    not_installed: { label: "Not installed", className: "bg-muted text-muted-foreground" },
  };
  const entry = map[status] ?? { label: status, className: "bg-muted text-muted-foreground" };
  return (
    <Badge variant="outline" className={`text-xs ${entry.className}`}>
      {entry.label}
    </Badge>
  );
}

function FlexyLookupCard() {
  const { toast } = useToast();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MemberSearchResult[]>([]);
  const [showResults, setShowResults] = useState(false);
  const [searching, setSearching] = useState(false);
  const [selectedMember, setSelectedMember] = useState<MemberSearchResult | null>(null);
  const [lookup, setLookup] = useState<FlexyLookup | null>(null);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [regenerating, setRegenerating] = useState(false);
  const [newPassword, setNewPassword] = useState<string | null>(null);
  const [confirmingRegen, setConfirmingRegen] = useState(false);
  const [notifyEmail, setNotifyEmail] = useState(true);
  const [notifySms, setNotifySms] = useState(false);
  const [lastNotifications, setLastNotifications] = useState<RegenerateResponse["notifications"] | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowResults(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (query.trim().length < 2) {
      setResults([]);
      setShowResults(false);
      return;
    }
    setSearching(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const members = await searchMembers(query.trim());
        setResults(members);
        setShowResults(true);
      } catch (err) {
        toast({
          title: "Search failed",
          description: err instanceof Error ? err.message : "Could not search members",
          variant: "destructive",
        });
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, toast]);

  const selectMember = async (member: MemberSearchResult) => {
    setSelectedMember(member);
    setQuery(`${member.name} (${member.email})`);
    setShowResults(false);
    setLookup(null);
    setNewPassword(null);
    setLookupError(null);
    setLastNotifications(null);
    setNotifyEmail(true);
    setNotifySms(false);
    setLookupLoading(true);
    try {
      const result = await fetchFlexyLookup(member.id);
      setLookup(result);
    } catch (err) {
      setLookupError(err instanceof Error ? err.message : "Lookup failed");
    } finally {
      setLookupLoading(false);
    }
  };

  const clearSelection = () => {
    setSelectedMember(null);
    setLookup(null);
    setLookupError(null);
    setNewPassword(null);
    setLastNotifications(null);
    setNotifyEmail(true);
    setNotifySms(false);
    setQuery("");
  };

  const handleRegenerate = async () => {
    if (!selectedMember) return;
    setConfirmingRegen(false);
    setRegenerating(true);
    setNewPassword(null);
    setLastNotifications(null);
    try {
      const result = await regenerateFlexyPassword(selectedMember.id, {
        notifyEmail,
        notifySms,
      });
      setNewPassword(result.newPassword);
      setLastNotifications(result.notifications);

      const sentParts: string[] = [];
      const failedParts: string[] = [];
      if (result.notifications.email.requested) {
        if (result.notifications.email.status === "sent") sentParts.push("email");
        else failedParts.push(`email (${result.notifications.email.reason ?? result.notifications.email.status})`);
      }
      if (result.notifications.sms.requested) {
        if (result.notifications.sms.status === "sent") sentParts.push("SMS");
        else failedParts.push(`SMS (${result.notifications.sms.reason ?? result.notifications.sms.status})`);
      }

      if (failedParts.length > 0) {
        toast({
          title: "Password regenerated, notifications partially delivered",
          description: `${sentParts.length > 0 ? `Sent via ${sentParts.join(" + ")}. ` : ""}Could not send: ${failedParts.join(", ")}.`,
          variant: "destructive",
        });
      } else if (sentParts.length > 0) {
        toast({
          title: "Password regenerated and sent",
          description: `New credentials sent to member via ${sentParts.join(" + ")}.`,
        });
      } else {
        toast({
          title: "Password regenerated",
          description: "Share the new password with the member, then close this panel.",
        });
      }
    } catch (err) {
      toast({
        title: "Regenerate failed",
        description: err instanceof Error ? err.message : "Could not regenerate password",
        variant: "destructive",
      });
    } finally {
      setRegenerating(false);
    }
  };

  const copyToClipboard = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: `${label} copied` });
    } catch {
      toast({ title: "Copy failed", variant: "destructive" });
    }
  };

  const flexyStatus = lookup?.flexy.status ?? "not_installed";
  const canRegenerate =
    !!lookup &&
    flexyStatus === "installed" &&
    lookup.flexy.hasStaffUser &&
    !!lookup.flexy.email;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <KeyRound className="w-4 h-4" /> Flexy login lookup
        </CardTitle>
        <CardDescription>
          Look up a member's Flexy login email and regenerate their password if SSO is failing for them.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div ref={containerRef} className="relative">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                if (selectedMember) setSelectedMember(null);
              }}
              onFocus={() => {
                if (results.length > 0) setShowResults(true);
              }}
              placeholder="Search members by name or email..."
              className="pl-10"
              data-testid="input-flexy-member-search"
            />
          </div>
          {showResults && (
            <div className="absolute top-full left-0 right-0 mt-1 bg-white border rounded-lg shadow-lg z-20 max-h-72 overflow-y-auto">
              {searching ? (
                <div className="p-4 text-sm text-muted-foreground text-center">Searching...</div>
              ) : results.length === 0 ? (
                <div className="p-4 text-sm text-muted-foreground text-center">No members found</div>
              ) : (
                results.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => selectMember(m)}
                    className="w-full flex items-center gap-3 px-3 py-2 hover:bg-muted/50 text-left transition-colors"
                    data-testid={`button-select-member-${m.id}`}
                  >
                    <UserIcon className="w-4 h-4 text-muted-foreground shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">{m.name}</p>
                      <p className="text-xs text-muted-foreground truncate">{m.email}</p>
                    </div>
                    <Badge variant="outline" className="text-[10px] shrink-0">{m.role}</Badge>
                  </button>
                ))
              )}
            </div>
          )}
        </div>

        {selectedMember && (
          <div className="border rounded-lg p-4 space-y-3 bg-muted/30">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">{selectedMember.name}</p>
                <p className="text-xs text-muted-foreground truncate">{selectedMember.email}</p>
              </div>
              <Button variant="ghost" size="sm" onClick={clearSelection}>Clear</Button>
            </div>

            {lookupLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="w-4 h-4 animate-spin" /> Looking up Flexy details...
              </div>
            ) : lookupError ? (
              <p className="text-sm text-red-700">{lookupError}</p>
            ) : lookup ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">Status:</span>
                  <FlexyStatusBadge status={flexyStatus} />
                </div>

                {lookup.flexy.email ? (
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">Flexy login email</p>
                    <div className="flex items-center gap-2">
                      <code className="text-sm font-mono bg-white border rounded px-2 py-1 flex-1 truncate" data-testid="text-flexy-email">
                        {lookup.flexy.email}
                      </code>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => copyToClipboard(lookup.flexy.email!, "Email")}
                        data-testid="button-copy-flexy-email"
                      >
                        <Copy className="w-3 h-3" />
                      </Button>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    This member does not have a Flexy login on record.
                    {flexyStatus === "not_installed" && " They have not installed Flexy yet."}
                  </p>
                )}

                {newPassword && (
                  <div className="space-y-1 border-t pt-3">
                    <p className="text-xs text-muted-foreground">New password (shown once)</p>
                    <div className="flex items-center gap-2">
                      <code className="text-sm font-mono bg-white border rounded px-2 py-1 flex-1 truncate" data-testid="text-flexy-new-password">
                        {newPassword}
                      </code>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => copyToClipboard(newPassword, "Password")}
                        data-testid="button-copy-flexy-password"
                      >
                        <Copy className="w-3 h-3" />
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Share this with the member securely. It will not be shown again.
                    </p>
                    {lastNotifications && (
                      <div className="mt-2 space-y-1" data-testid="flexy-notification-summary">
                        {lastNotifications.email.requested && (
                          <p className="text-xs">
                            <Mail className="w-3 h-3 inline mr-1" />
                            Email to member:{" "}
                            <span
                              className={
                                lastNotifications.email.status === "sent"
                                  ? "text-green-700 font-medium"
                                  : "text-red-700 font-medium"
                              }
                            >
                              {lastNotifications.email.status === "sent"
                                ? "sent"
                                : `${lastNotifications.email.status}${lastNotifications.email.reason ? ` (${lastNotifications.email.reason})` : ""}`}
                            </span>
                          </p>
                        )}
                        {lastNotifications.sms.requested && (
                          <p className="text-xs">
                            <MessageSquare className="w-3 h-3 inline mr-1" />
                            SMS to member:{" "}
                            <span
                              className={
                                lastNotifications.sms.status === "sent"
                                  ? "text-green-700 font-medium"
                                  : "text-red-700 font-medium"
                              }
                            >
                              {lastNotifications.sms.status === "sent"
                                ? "sent"
                                : `${lastNotifications.sms.status}${lastNotifications.sms.reason ? ` (${lastNotifications.sms.reason})` : ""}`}
                            </span>
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                )}

                <div className="space-y-3 border-t pt-3">
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-muted-foreground">After regenerating, also send the new password to the member:</p>
                    <div className="flex items-center gap-2">
                      <Checkbox
                        id="notify-flexy-email"
                        checked={notifyEmail}
                        onCheckedChange={(v) => setNotifyEmail(v === true)}
                        disabled={!canRegenerate || regenerating}
                        data-testid="checkbox-notify-flexy-email"
                      />
                      <label htmlFor="notify-flexy-email" className="text-sm flex items-center gap-1 cursor-pointer">
                        <Mail className="w-3.5 h-3.5" />
                        Email new password to {lookup.member.email}
                      </label>
                    </div>
                    <div className="flex items-center gap-2">
                      <Checkbox
                        id="notify-flexy-sms"
                        checked={notifySms}
                        onCheckedChange={(v) => setNotifySms(v === true)}
                        disabled={!canRegenerate || regenerating || !lookup.member.hasPhone || !lookup.member.smsOptIn}
                        data-testid="checkbox-notify-flexy-sms"
                      />
                      <label htmlFor="notify-flexy-sms" className={`text-sm flex items-center gap-1 ${(!lookup.member.hasPhone || !lookup.member.smsOptIn) ? "text-muted-foreground" : "cursor-pointer"}`}>
                        <MessageSquare className="w-3.5 h-3.5" />
                        Text new password via SMS
                        {!lookup.member.hasPhone && (
                          <span className="text-xs text-muted-foreground">(no phone on file)</span>
                        )}
                        {lookup.member.hasPhone && !lookup.member.smsOptIn && (
                          <span className="text-xs text-muted-foreground">(member not opted in to SMS)</span>
                        )}
                      </label>
                    </div>
                  </div>

                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!canRegenerate || regenerating}
                    onClick={() => setConfirmingRegen(true)}
                    data-testid="button-regenerate-flexy-password"
                  >
                    {regenerating ? (
                      <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Regenerating...</>
                    ) : (
                      <><KeyRound className="w-4 h-4 mr-2" /> Regenerate password</>
                    )}
                  </Button>
                  {!canRegenerate && (
                    <p className="text-xs text-muted-foreground mt-2">
                      Regenerate is available once Flexy is installed for this member.
                    </p>
                  )}
                </div>
              </div>
            ) : null}
          </div>
        )}
      </CardContent>

      <Dialog open={confirmingRegen} onOpenChange={(open) => { if (!open) setConfirmingRegen(false); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Regenerate Flexy password?</DialogTitle>
            <DialogDescription>
              This will replace this member's Flexy password immediately. Their existing password will stop working.
            </DialogDescription>
          </DialogHeader>
          <div className="text-sm space-y-2 py-2">
            {(notifyEmail || notifySms) ? (
              <>
                <p>The new password will be sent to the member via:</p>
                <ul className="list-disc ml-5 space-y-1">
                  {notifyEmail && <li>Email to <strong>{lookup?.member.email}</strong></li>}
                  {notifySms && <li>SMS to their phone on file</li>}
                </ul>
              </>
            ) : (
              <p>No notification will be sent. You will need to share the new password with the member yourself before closing this panel.</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmingRegen(false)}>Cancel</Button>
            <Button onClick={handleRegenerate} disabled={regenerating} data-testid="button-confirm-regenerate-flexy">
              {regenerating ? "Regenerating..." : "Regenerate"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
