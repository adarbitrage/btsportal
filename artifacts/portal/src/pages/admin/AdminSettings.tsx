import { useState, useEffect } from "react";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Settings, Save, Plus, Bell, Send, CheckCircle2, XCircle, AlertCircle, History, ShieldAlert, RotateCcw, Archive, ExternalLink, ChevronDown, ChevronRight, Gauge, LifeBuoy } from "lucide-react";
import { TICKETDESK_URL } from "@/config/support";
import { Badge } from "@/components/ui/badge";
import {
  adminPanelApi,
  type AiModerationThresholdConfigStatus,
  type AiModerationThresholdPreview,
  type AuthRateLimitAlertConfigStatus,
  type AuthRateLimitAlertTrafficPreview,
  type ChangeHistoryRetentionConfigStatus,
  type DigestAlerterTuningStatus,
  type DigestWatchdogState,
  type MachineMismatchAlertConfigStatus,
  type ModerationFailureAlertConfigStatus,
} from "@/lib/admin-panel-api";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";

export default function AdminSettings() {
  const [settings, setSettings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");
  const [newCategory, setNewCategory] = useState("general");
  const { toast } = useToast();

  const load = async () => {
    try {
      setLoading(true);
      const data = await adminPanelApi.getSettings();
      setSettings(data);
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const categories = [...new Set(settings.map(s => s.category))];
  if (categories.length === 0) categories.push("general");

  const handleSave = async (key: string, value: any) => {
    try {
      setSaving(key);
      await adminPanelApi.updateSetting(key, value);
      toast({ title: "Setting saved" });
      load();
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setSaving(null);
    }
  };

  const handleAdd = async () => {
    if (!newKey.trim() || !newValue.trim()) return;
    try {
      let parsedValue: any;
      try { parsedValue = JSON.parse(newValue); } catch { parsedValue = newValue; }
      await adminPanelApi.updateSetting(newKey, parsedValue, newCategory);
      setNewKey("");
      setNewValue("");
      toast({ title: "Setting added" });
      load();
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  };

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Settings className="w-6 h-6" /> System Settings
          </h1>
          <p className="text-muted-foreground mt-1">Configure system-wide settings</p>
        </div>

        <OnCallDestinationsCard />

        <PitchContentCard />

        <AuthRateLimitAlertConfigCard />

        <MachineMismatchAlertConfigCard />

        <DigestAlerterTuningCard />

        <ModerationFailureAlertConfigCard />

        <AiModerationThresholdConfigCard />

        <ChangeHistoryRetentionConfigCard />

        <LiveChatSupportCard />

        <Card>
          <CardHeader><CardTitle className="text-base">Add New Setting</CardTitle></CardHeader>
          <CardContent>
            <div className="flex gap-3">
              <Input value={newCategory} onChange={(e) => setNewCategory(e.target.value)} placeholder="Category" className="w-32" />
              <Input value={newKey} onChange={(e) => setNewKey(e.target.value)} placeholder="Setting key" className="w-48" />
              <Input value={newValue} onChange={(e) => setNewValue(e.target.value)} placeholder="Value (JSON or string)" className="flex-1" />
              <Button onClick={handleAdd} disabled={!newKey.trim() || !newValue.trim()}><Plus className="w-4 h-4 mr-1" />Add</Button>
            </div>
          </CardContent>
        </Card>

        {loading ? (
          <div className="p-8 text-center text-muted-foreground">Loading settings...</div>
        ) : settings.length === 0 ? (
          <Card><CardContent className="p-8 text-center text-muted-foreground">No settings configured yet. Add your first setting above.</CardContent></Card>
        ) : (
          <Tabs defaultValue={categories[0]} className="w-full">
            <TabsList>
              {categories.map(cat => (
                <TabsTrigger key={cat} value={cat} className="capitalize">{cat}</TabsTrigger>
              ))}
            </TabsList>
            {categories.map(cat => (
              <TabsContent key={cat} value={cat}>
                <Card>
                  <CardContent className="p-0">
                    <div className="divide-y">
                      {settings.filter(s => s.category === cat).map((setting) => (
                        <SettingRow key={setting.id} setting={setting} onSave={handleSave} saving={saving === setting.key} />
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>
            ))}
          </Tabs>
        )}
      </div>
    </AdminLayout>
  );
}

// Read-only surface for the resolved live-chat (TicketDesk) support
// destination. The same URL is consumed in two independent runtimes — the
// in-portal embed (the value this bundle resolved via VITE_TICKETDESK_URL /
// the shared default) and the backend health probe (LIVE_CHAT_EMBED_PROBE_URL
// / the shared default). Surfacing both, plus an in-sync indicator, lets a
// non-technical admin confirm at a glance that the chat members load and the
// destination System Health probes are the same — no code or env spelunking.
function LiveChatSupportCard() {
  const { toast } = useToast();
  const [probeUrl, setProbeUrl] = useState<string | null>(null);
  const [probeUrlSource, setProbeUrlSource] = useState<"env" | "default" | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const data = await adminPanelApi.getLiveChatSupportConfig();
        if (cancelled) return;
        setProbeUrl(data.probeUrl);
        setProbeUrlSource(data.probeUrlSource);
        setError(null);
      } catch (err: any) {
        if (cancelled) return;
        setError(err.message || "Failed to load live-chat support config");
        toast({ title: "Error", description: err.message, variant: "destructive" });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [toast]);

  const embedUrl = TICKETDESK_URL;
  // Compare on the normalised string so a trailing-slash difference doesn't
  // read as a mismatch.
  const normalise = (u: string) => u.trim().replace(/\/+$/, "");
  const inSync = probeUrl !== null && normalise(embedUrl) === normalise(probeUrl);

  return (
    <Card data-testid="card-live-chat-support">
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <LifeBuoy className="w-4 h-4" /> Live-chat support link
          {!loading && !error && probeUrl !== null && (
            inSync ? (
              <Badge
                variant="success"
                className="ml-2 font-normal"
                data-testid="live-chat-support-sync"
                title="The in-portal embed and the health probe resolve to the same URL."
              >
                in sync
              </Badge>
            ) : (
              <Badge
                variant="warning"
                className="ml-2 font-normal"
                data-testid="live-chat-support-sync"
                title="The in-portal embed and the health probe resolve to different URLs — members may load a different destination than the one System Health monitors."
              >
                mismatch
              </Badge>
            )
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground mb-4">
          The live-chat (TicketDesk) destination members load in the portal. This
          is the same URL the in-portal embed opens and the System Health probe
          monitors, so you can confirm both agree without reading any env vars.
          Read-only — managed via environment variables.
        </p>
        {loading ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : error ? (
          <div className="text-sm text-red-600" data-testid="live-chat-support-error">
            {error}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex justify-between items-center gap-4">
              <span className="text-sm text-muted-foreground">In-portal embed</span>
              <a
                href={embedUrl}
                target="_blank"
                rel="noreferrer"
                className="text-sm font-medium truncate max-w-[60%] text-right hover:underline inline-flex items-center gap-1"
                title={embedUrl}
                data-testid="live-chat-support-embed-url"
              >
                {embedUrl}
                <ExternalLink className="w-3 h-3 shrink-0" />
              </a>
            </div>
            <div className="flex justify-between items-center gap-4">
              <span className="text-sm text-muted-foreground">Health probe</span>
              <a
                href={probeUrl ?? "#"}
                target="_blank"
                rel="noreferrer"
                className="text-sm font-medium truncate max-w-[60%] text-right hover:underline inline-flex items-center gap-1"
                title={probeUrl ?? ""}
                data-testid="live-chat-support-probe-url"
              >
                {probeUrl}
                <ExternalLink className="w-3 h-3 shrink-0" />
              </a>
            </div>
            {!inSync && (
              <div
                className="text-xs text-red-600 pt-2 border-t"
                data-testid="live-chat-support-mismatch-note"
              >
                The in-portal embed and the health probe point to different URLs.
                Members may load a different destination than the one System Health
                monitors — line up <code>VITE_TICKETDESK_URL</code> and{" "}
                <code>LIVE_CHAT_EMBED_PROBE_URL</code>.
              </div>
            )}
            <div className="text-xs text-muted-foreground pt-2 border-t">
              Probe URL source:{" "}
              <span className="font-medium">
                {probeUrlSource === "env"
                  ? "LIVE_CHAT_EMBED_PROBE_URL env override"
                  : "shared default"}
              </span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

interface OnCallStatus {
  pagerdutyConfigured: boolean;
  pagerdutySource: "db" | "env" | null;
  opsAlertEmail: string | null;
  opsAlertEmailSource: "db" | "env" | null;
  slackConfigured: boolean;
  slackSource: "db" | "env" | null;
}

interface TestResult {
  channel: string;
  ok: boolean;
  skipped: boolean;
  reason?: string;
}

type OnCallField =
  | "pagerdutyIntegrationKey"
  | "opsAlertEmail"
  | "opsAlertSlackWebhookUrl";

interface ProbeResult {
  ok: boolean;
  skipped?: boolean;
  reason?: string;
}

interface OnCallHistoryEvent {
  id: number;
  createdAt: string;
  actionType: string;
  actorId: number | null;
  actorEmail: string | null;
  actorName: string | null;
  description: string;
  changedFields: OnCallField[];
  testResults: Array<{
    channel: "pagerduty" | "email" | "slack";
    ok: boolean;
    skipped: boolean;
    reason: string | null;
  }>;
}

function sourceLabel(source: "db" | "env" | null): string {
  if (source === "db") return "saved in admin";
  if (source === "env") return "from environment variable";
  return "not configured";
}

const FIELD_LABELS: Record<OnCallField, string> = {
  pagerdutyIntegrationKey: "PagerDuty key",
  opsAlertEmail: "Ops alert email",
  opsAlertSlackWebhookUrl: "Slack webhook",
};

const CHANNEL_LABELS: Record<"pagerduty" | "email" | "slack", string> = {
  pagerduty: "PagerDuty",
  email: "Email",
  slack: "Slack",
};

function formatHistoryTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function actorDisplay(event: OnCallHistoryEvent): string {
  if (event.actorName && event.actorEmail) return `${event.actorName} (${event.actorEmail})`;
  if (event.actorName) return event.actorName;
  if (event.actorEmail) return event.actorEmail;
  return "System";
}

function OnCallDestinationsCard() {
  const { toast } = useToast();
  const [status, setStatus] = useState<OnCallStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [pdInput, setPdInput] = useState("");
  const [emailInput, setEmailInput] = useState("");
  const [slackInput, setSlackInput] = useState("");
  const [savingField, setSavingField] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResults, setTestResults] = useState<TestResult[] | null>(null);
  // Per-field reachability check from the most recent save *or* re-test.
  // Cleared when the field is cleared (no value to verify) and overwritten
  // on each save / re-test so the green check / red cross always reflects
  // the latest probe.
  const [probes, setProbes] = useState<Partial<Record<OnCallField, ProbeResult>>>({});
  // Tracks which row is currently re-running its probe so the button can
  // show a spinner state and we can disable concurrent clicks on the same
  // row while in flight.
  const [retestingField, setRetestingField] = useState<OnCallField | null>(null);
  const [history, setHistory] = useState<OnCallHistoryEvent[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  // Per-field counter that the disclosure components watch; bumping it
  // re-fetches that field's probe history (only if the disclosure is open),
  // so a save flushes its own probe row into the visible list immediately.
  const [probeHistoryRefresh, setProbeHistoryRefresh] = useState<Record<OnCallField, number>>({
    pagerdutyIntegrationKey: 0,
    opsAlertEmail: 0,
    opsAlertSlackWebhookUrl: 0,
  });

  const load = async () => {
    try {
      setLoading(true);
      const data = await adminPanelApi.getOnCallDestinations();
      setStatus(data);
      // The email is non-secret so we hydrate the input with its current
      // value. PagerDuty key and Slack webhook URL are secrets — we only
      // show whether one is configured, never the value itself.
      setEmailInput(data.opsAlertEmail ?? "");
      setPdInput("");
      setSlackInput("");
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const loadHistory = async () => {
    try {
      setHistoryLoading(true);
      const data = await adminPanelApi.getOnCallDestinationsHistory();
      setHistory(data.events);
    } catch (err: any) {
      // History is informational — surface a toast but don't take down the
      // whole card if the log fetch fails (the configuration UI above is
      // still operable).
      toast({ title: "Couldn't load recent changes", description: err.message, variant: "destructive" });
    } finally {
      setHistoryLoading(false);
    }
  };

  useEffect(() => { load(); loadHistory(); }, []);

  const saveField = async (
    field: OnCallField,
    value: string | null,
  ) => {
    try {
      setSavingField(field);
      const data = await adminPanelApi.updateOnCallDestinations({ [field]: value });
      setStatus({
        pagerdutyConfigured: data.pagerdutyConfigured,
        pagerdutySource: data.pagerdutySource,
        opsAlertEmail: data.opsAlertEmail,
        opsAlertEmailSource: data.opsAlertEmailSource,
        slackConfigured: data.slackConfigured,
        slackSource: data.slackSource,
      });
      setEmailInput(data.opsAlertEmail ?? "");
      // Cleared rows have nothing to verify, so wipe any stale probe
      // result. Otherwise replace this field's probe with the fresh one.
      setProbes((prev) => {
        const next = { ...prev };
        const probeForField = data.probes?.[field];
        if (value === null) {
          delete next[field];
        } else if (probeForField) {
          next[field] = probeForField;
        }
        return next;
      });
      const probeResult = data.probes?.[field];
      if (value === null) {
        toast({ title: "Destination cleared" });
      } else if (probeResult && !probeResult.ok) {
        // Saving still succeeded — surface the reachability problem so the
        // admin notices it before the next real incident hits, but don't
        // make it look like the value wasn't stored.
        toast({
          title: "Saved, but verification failed",
          description: probeResult.reason
            ? `Destination test failed: ${probeResult.reason}`
            : "Destination test failed",
          variant: "destructive",
        });
      } else if (probeResult && probeResult.skipped) {
        toast({
          title: "Saved (verification skipped)",
          description: probeResult.reason ?? undefined,
        });
      } else {
        toast({ title: "Destination saved and verified" });
      }
      // Bump the per-field disclosure refresh key so any open "View recent
      // probes" panel pulls in the audit row this save just wrote.
      setProbeHistoryRefresh((prev) => ({ ...prev, [field]: prev[field] + 1 }));
      await loadHistory();
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setSavingField(null);
    }
  };

  const handleRetest = async (field: OnCallField) => {
    try {
      setRetestingField(field);
      const data = await adminPanelApi.probeOnCallDestination(field);
      // Replace this field's probe badge with the fresh result. Even when
      // the server reports `skipped: true` (e.g. the destination is no
      // longer configured) we surface it through the same badge so the
      // admin sees a consistent UI for "we ran a check; here's what
      // happened".
      setProbes((prev) => ({ ...prev, [field]: data.probe }));
      if (data.probe.skipped) {
        toast({
          title: "Re-test skipped",
          description: data.probe.reason ?? undefined,
        });
      } else if (data.probe.ok) {
        toast({ title: "Destination still reachable" });
      } else {
        toast({
          title: "Destination unreachable",
          description: data.probe.reason
            ? `Re-test failed: ${data.probe.reason}`
            : "Re-test failed",
          variant: "destructive",
        });
      }
      // The re-test is itself an audit row — refresh the timeline so the
      // admin sees their own click reflected immediately.
      await loadHistory();
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setRetestingField(null);
    }
  };

  const handleTest = async () => {
    try {
      setTesting(true);
      setTestResults(null);
      const data = await adminPanelApi.sendOnCallTestAlert();
      setTestResults(data.results);
      const failed = data.results.filter((r) => !r.ok);
      if (failed.length > 0) {
        toast({
          title: "Test alert had failures",
          description: failed.map((r) => `${r.channel}: ${r.reason ?? "failed"}`).join("; "),
          variant: "destructive",
        });
      } else {
        toast({ title: "Test alert dispatched" });
      }
      // The test alert is itself an audit row — refresh the history so the
      // admin sees their own click reflected in the timeline immediately.
      await loadHistory();
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setTesting(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Bell className="w-4 h-4" /> On-Call Notification Destinations
        </CardTitle>
        <p className="text-xs text-muted-foreground mt-1">
          Where the queue-fallback alerter sends "fire" / "all clear" notifications when the email or SMS queue starts bypassing Redis. Changes take effect immediately — no restart needed.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading || !status ? (
          <div className="p-4 text-center text-sm text-muted-foreground">Loading on-call destinations...</div>
        ) : (
          <>
            <OnCallSecretRow
              label="PagerDuty integration key"
              hint="Events API v2 routing key"
              configured={status.pagerdutyConfigured}
              source={status.pagerdutySource}
              inputType="password"
              placeholder={status.pagerdutyConfigured ? "•••••• (saved — enter a new key to replace)" : "PagerDuty integration key"}
              value={pdInput}
              onChange={setPdInput}
              saving={savingField === "pagerdutyIntegrationKey"}
              onSave={(v) => saveField("pagerdutyIntegrationKey", v)}
              onClear={status.pagerdutyConfigured ? () => saveField("pagerdutyIntegrationKey", null) : undefined}
              probe={probes.pagerdutyIntegrationKey}
              field="pagerdutyIntegrationKey"
              probeHistoryRefresh={probeHistoryRefresh.pagerdutyIntegrationKey}
              onRetest={status.pagerdutyConfigured ? () => handleRetest("pagerdutyIntegrationKey") : undefined}
              retesting={retestingField === "pagerdutyIntegrationKey"}
              retestTestId="oncall-retest-pagerduty"
            />
            <OnCallEmailRow
              configured={!!status.opsAlertEmail}
              source={status.opsAlertEmailSource}
              currentValue={status.opsAlertEmail}
              value={emailInput}
              onChange={setEmailInput}
              saving={savingField === "opsAlertEmail"}
              onSave={(v) => saveField("opsAlertEmail", v)}
              onClear={status.opsAlertEmail ? () => saveField("opsAlertEmail", null) : undefined}
              probe={probes.opsAlertEmail}
              probeHistoryRefresh={probeHistoryRefresh.opsAlertEmail}
              onRetest={status.opsAlertEmail ? () => handleRetest("opsAlertEmail") : undefined}
              retesting={retestingField === "opsAlertEmail"}
              retestTestId="oncall-retest-email"
            />
            <OnCallSecretRow
              label="Slack webhook URL"
              hint="Incoming webhook URL"
              configured={status.slackConfigured}
              source={status.slackSource}
              inputType="password"
              placeholder={status.slackConfigured ? "•••••• (saved — enter a new URL to replace)" : "https://hooks.slack.com/services/..."}
              value={slackInput}
              onChange={setSlackInput}
              saving={savingField === "opsAlertSlackWebhookUrl"}
              onSave={(v) => saveField("opsAlertSlackWebhookUrl", v)}
              onClear={status.slackConfigured ? () => saveField("opsAlertSlackWebhookUrl", null) : undefined}
              probe={probes.opsAlertSlackWebhookUrl}
              field="opsAlertSlackWebhookUrl"
              probeHistoryRefresh={probeHistoryRefresh.opsAlertSlackWebhookUrl}
              onRetest={status.slackConfigured ? () => handleRetest("opsAlertSlackWebhookUrl") : undefined}
              retesting={retestingField === "opsAlertSlackWebhookUrl"}
              retestTestId="oncall-retest-slack"
            />

            <div className="flex items-center justify-between border-t pt-4">
              <div>
                <p className="text-sm font-medium">Send test alert</p>
                <p className="text-xs text-muted-foreground">
                  Dispatches a synthetic fire + all-clear pair to every configured destination so you can verify routing.
                </p>
              </div>
              <Button onClick={handleTest} disabled={testing} variant="outline">
                <Send className="w-4 h-4 mr-1" />{testing ? "Sending..." : "Send test alert"}
              </Button>
            </div>

            {testResults && (
              <div className="border rounded-md divide-y bg-muted/20">
                {testResults.map((r) => (
                  <div key={r.channel} className="flex items-center gap-3 p-3 text-sm">
                    {r.skipped ? (
                      <AlertCircle className="w-4 h-4 text-muted-foreground" />
                    ) : r.ok ? (
                      <CheckCircle2 className="w-4 h-4 text-green-600" />
                    ) : (
                      <XCircle className="w-4 h-4 text-destructive" />
                    )}
                    <span className="capitalize font-medium w-24">{r.channel}</span>
                    <span className="text-muted-foreground">
                      {r.skipped
                        ? `Skipped (${r.reason ?? "not configured"})`
                        : r.ok
                          ? "Delivered fire + clear"
                          : `Failed: ${r.reason ?? "unknown error"}`}
                    </span>
                  </div>
                ))}
              </div>
            )}

            <OnCallHistorySection events={history} loading={historyLoading} />
          </>
        )}
      </CardContent>
    </Card>
  );
}

function ProbeBadge({ probe }: { probe: ProbeResult | undefined }) {
  if (!probe) return null;
  // We don't try to localize provider error strings here ("http_403",
  // "invalid_token", etc.) — admins reading this card already know the
  // shape of these messages from the provider's own dashboards, and a
  // wrapped translation layer would just add another place to drift.
  if (probe.skipped) {
    return (
      <div
        className="flex items-center gap-2 text-xs text-muted-foreground"
        data-testid="oncall-probe-skipped"
      >
        <AlertCircle className="w-3.5 h-3.5" />
        <span>
          Reachability check skipped{probe.reason ? ` (${probe.reason})` : ""}
        </span>
      </div>
    );
  }
  if (probe.ok) {
    return (
      <div
        className="flex items-center gap-2 text-xs text-green-700 dark:text-green-400"
        data-testid="oncall-probe-ok"
      >
        <CheckCircle2 className="w-3.5 h-3.5" />
        <span>Reachability check passed</span>
      </div>
    );
  }
  return (
    <div
      className="flex items-center gap-2 text-xs text-destructive"
      data-testid="oncall-probe-failed"
    >
      <XCircle className="w-3.5 h-3.5" />
      <span>
        Reachability check failed{probe.reason ? `: ${probe.reason}` : ""} (value
        was still saved)
      </span>
    </div>
  );
}

interface ProbeHistoryEntry {
  id: number;
  createdAt: string;
  ok: boolean;
  skipped: boolean;
  reason: string | null;
}

/**
 * Lazy-loaded "View recent probes" disclosure for a single destination row.
 * Fetches the last ~10 reachability probe outcomes for this channel from the
 * audit log on first expand. Subsequent expands re-use the cached data; when
 * the parent bumps `refreshKey` (e.g. after a save completes) and the panel
 * is currently open, we silently re-fetch so the new probe row rolls in
 * without the admin having to collapse and re-expand the disclosure.
 */
function RecentProbesDisclosure({
  field,
  refreshKey,
}: {
  field: OnCallField;
  // Bumping `refreshKey` from the parent (e.g. after a save completes)
  // triggers a refetch *only if* the disclosure is currently open — we don't
  // want to silently fetch for collapsed rows.
  refreshKey: number;
}) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [entries, setEntries] = useState<ProbeHistoryEntry[]>([]);

  const fetchProbes = async () => {
    try {
      setLoading(true);
      const data = await adminPanelApi.getOnCallDestinationProbes(field);
      setEntries(data.probes);
      setLoaded(true);
    } catch (err: any) {
      toast({ title: "Couldn't load recent probes", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  // Refresh on save, but only when expanded — collapsed rows stay stale until
  // the admin opens them, which avoids fanning out three audit-log reads on
  // every save just in case someone is looking.
  useEffect(() => {
    if (open && loaded) {
      fetchProbes();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  const handleToggle = () => {
    const next = !open;
    setOpen(next);
    if (next && !loaded && !loading) {
      fetchProbes();
    }
  };

  return (
    <div className="border-t pt-2">
      <button
        type="button"
        onClick={handleToggle}
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        aria-expanded={open}
        data-testid={`oncall-probes-toggle-${field}`}
      >
        {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        <span>View recent probes</span>
      </button>
      {open && (
        <div className="mt-2" data-testid={`oncall-probes-panel-${field}`}>
          {loading ? (
            <div className="text-xs text-muted-foreground py-2">Loading recent probes...</div>
          ) : entries.length === 0 ? (
            <div className="text-xs text-muted-foreground py-2">
              No probe history yet. Save this destination to record a probe outcome.
            </div>
          ) : (
            <div className="border rounded-md divide-y bg-background">
              {entries.map((entry) => (
                <ProbeHistoryRow key={entry.id} entry={entry} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ProbeHistoryRow({ entry }: { entry: ProbeHistoryEntry }) {
  const outcomeLabel = entry.skipped ? "skipped" : entry.ok ? "ok" : "failed";
  return (
    <div
      className="flex items-start gap-3 p-2 text-xs"
      data-testid={`oncall-probe-history-row-${outcomeLabel}`}
    >
      {entry.skipped ? (
        <AlertCircle className="w-3.5 h-3.5 mt-0.5 text-muted-foreground shrink-0" />
      ) : entry.ok ? (
        <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 text-green-600 shrink-0" />
      ) : (
        <XCircle className="w-3.5 h-3.5 mt-0.5 text-destructive shrink-0" />
      )}
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="font-medium capitalize">{outcomeLabel}</span>
          <span className="text-muted-foreground">{formatHistoryTimestamp(entry.createdAt)}</span>
        </div>
        {entry.reason && (
          <div className="text-muted-foreground break-words">{entry.reason}</div>
        )}
      </div>
    </div>
  );
}

function OnCallHistorySection({ events, loading }: { events: OnCallHistoryEvent[]; loading: boolean }) {
  return (
    <div className="border-t pt-4 space-y-2">
      <div>
        <p className="text-sm font-medium flex items-center gap-2">
          <History className="w-4 h-4" /> Recent changes
        </p>
        <p className="text-xs text-muted-foreground">
          Who last touched these destinations and what they did. Sourced from the audit log.
        </p>
      </div>
      {loading ? (
        <div className="p-3 text-center text-xs text-muted-foreground">Loading recent changes...</div>
      ) : events.length === 0 ? (
        <div className="p-3 text-center text-xs text-muted-foreground border rounded-md bg-muted/20">
          No changes recorded yet.
        </div>
      ) : (
        <div className="border rounded-md divide-y bg-muted/20">
          {events.map((event) => (
            <OnCallHistoryRow key={event.id} event={event} />
          ))}
        </div>
      )}
      {!loading && (
        <div className="flex justify-end pt-1">
          <a
            href="/admin/audit-log?entityType=oncall_destinations"
            className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
            data-testid="link-oncall-view-all-audit"
          >
            View all in Audit Log
            <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      )}
    </div>
  );
}

function OnCallHistoryRow({ event }: { event: OnCallHistoryEvent }) {
  const isTest = event.actionType === "send_test_alert";
  const isUpdate = event.actionType === "update_setting";
  return (
    <div className="p-3 text-sm space-y-1">
      <div className="flex items-start gap-3">
        {isTest ? (
          <Send className="w-4 h-4 mt-0.5 text-muted-foreground shrink-0" />
        ) : (
          <Save className="w-4 h-4 mt-0.5 text-muted-foreground shrink-0" />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-medium">
              {isTest ? "Sent test alert" : isUpdate ? "Updated destination" : event.actionType}
            </span>
            <span className="text-xs text-muted-foreground">
              by {actorDisplay(event)}
            </span>
          </div>
          <div className="text-xs text-muted-foreground">
            {formatHistoryTimestamp(event.createdAt)}
          </div>

          {isUpdate && event.changedFields.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {event.changedFields.map((f) => (
                <span
                  key={f}
                  className="text-xs px-2 py-0.5 rounded bg-background border text-foreground"
                >
                  {FIELD_LABELS[f]}
                </span>
              ))}
            </div>
          )}

          {isTest && event.testResults.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-2">
              {event.testResults.map((r) => (
                <span
                  key={r.channel}
                  className="text-xs px-2 py-0.5 rounded border inline-flex items-center gap-1 bg-background"
                  title={r.reason ?? undefined}
                >
                  {r.skipped ? (
                    <AlertCircle className="w-3 h-3 text-muted-foreground" />
                  ) : r.ok ? (
                    <CheckCircle2 className="w-3 h-3 text-green-600" />
                  ) : (
                    <XCircle className="w-3 h-3 text-destructive" />
                  )}
                  <span>{CHANNEL_LABELS[r.channel]}</span>
                  <span className="text-muted-foreground">
                    {r.skipped ? "skipped" : r.ok ? "ok" : "failed"}
                  </span>
                </span>
              ))}
            </div>
          )}

          {!isUpdate && !isTest && (
            <div className="text-xs text-muted-foreground mt-1">{event.description}</div>
          )}
        </div>
      </div>
    </div>
  );
}

function OnCallSecretRow({
  label,
  hint,
  configured,
  source,
  inputType,
  placeholder,
  value,
  onChange,
  saving,
  onSave,
  onClear,
  probe,
  field,
  probeHistoryRefresh,
  onRetest,
  retesting,
  retestTestId,
}: {
  label: string;
  hint: string;
  configured: boolean;
  source: "db" | "env" | null;
  inputType: "password" | "text";
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  saving: boolean;
  onSave: (v: string) => void;
  onClear?: () => void;
  probe?: ProbeResult;
  field: OnCallField;
  probeHistoryRefresh: number;
  onRetest?: () => void;
  retesting?: boolean;
  retestTestId?: string;
}) {
  return (
    <div className="border rounded-md p-3 space-y-2">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium">{label}</p>
          <p className="text-xs text-muted-foreground">{hint}</p>
        </div>
        <span
          className={`text-xs px-2 py-0.5 rounded ${
            configured
              ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300"
              : "bg-muted text-muted-foreground"
          }`}
        >
          {configured ? `Configured (${sourceLabel(source)})` : "Not configured"}
        </span>
      </div>
      <div className="flex gap-2">
        <Input
          type={inputType}
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="flex-1"
          autoComplete="off"
        />
        <Button size="sm" onClick={() => onSave(value)} disabled={saving || !value.trim()}>
          <Save className="w-4 h-4 mr-1" />{saving ? "Saving..." : "Save"}
        </Button>
        {onClear && (
          <Button size="sm" variant="outline" onClick={onClear} disabled={saving}>
            Clear
          </Button>
        )}
      </div>
      <ProbeBadgeRow
        probe={probe}
        onRetest={onRetest}
        retesting={!!retesting}
        retestTestId={retestTestId}
        field={field}
        probeHistoryRefresh={probeHistoryRefresh}
      />
    </div>
  );
}

function OnCallEmailRow({
  configured,
  source,
  currentValue,
  value,
  onChange,
  saving,
  onSave,
  onClear,
  probe,
  probeHistoryRefresh,
  onRetest,
  retesting,
  retestTestId,
}: {
  configured: boolean;
  source: "db" | "env" | null;
  currentValue: string | null;
  value: string;
  onChange: (v: string) => void;
  saving: boolean;
  onSave: (v: string) => void;
  onClear?: () => void;
  probe?: ProbeResult;
  probeHistoryRefresh: number;
  onRetest?: () => void;
  retesting?: boolean;
  retestTestId?: string;
}) {
  const dirty = value.trim() !== (currentValue ?? "").trim();
  return (
    <div className="border rounded-md p-3 space-y-2">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium">Ops alert email</p>
          <p className="text-xs text-muted-foreground">Sent via SendGrid (requires SENDGRID_API_KEY)</p>
        </div>
        <span
          className={`text-xs px-2 py-0.5 rounded ${
            configured
              ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300"
              : "bg-muted text-muted-foreground"
          }`}
        >
          {configured ? `Configured (${sourceLabel(source)})` : "Not configured"}
        </span>
      </div>
      <div className="flex gap-2">
        <Input
          type="email"
          placeholder="oncall@example.com"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="flex-1"
        />
        <Button size="sm" onClick={() => onSave(value.trim())} disabled={saving || !dirty || !value.trim()}>
          <Save className="w-4 h-4 mr-1" />{saving ? "Saving..." : "Save"}
        </Button>
        {onClear && (
          <Button size="sm" variant="outline" onClick={onClear} disabled={saving}>
            Clear
          </Button>
        )}
      </div>
      <ProbeBadgeRow
        probe={probe}
        onRetest={onRetest}
        retesting={!!retesting}
        retestTestId={retestTestId}
        field="opsAlertEmail"
        probeHistoryRefresh={probeHistoryRefresh}
      />
    </div>
  );
}

/**
 * Renders the per-row reachability badge alongside an optional Re-test
 * button, with the "View recent probes" disclosure rendered below. Split
 * out so both `OnCallSecretRow` and `OnCallEmailRow` get the same layout —
 * and so the button is still rendered when there's no probe yet (a
 * freshly-loaded card has no probe state but admins may still want to
 * verify the saved destination is reachable).
 */
function ProbeBadgeRow({
  probe,
  onRetest,
  retesting,
  retestTestId,
  field,
  probeHistoryRefresh,
}: {
  probe: ProbeResult | undefined;
  onRetest?: () => void;
  retesting: boolean;
  retestTestId?: string;
  field: OnCallField;
  probeHistoryRefresh: number;
}) {
  return (
    <div className="space-y-2">
      {(probe || onRetest) && (
        <div className="flex items-center justify-between gap-2 min-h-[20px]">
          <ProbeBadge probe={probe} />
          {onRetest && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-xs"
              onClick={onRetest}
              disabled={retesting}
              data-testid={retestTestId}
            >
              <RotateCcw className={`w-3.5 h-3.5 mr-1 ${retesting ? "animate-spin" : ""}`} />
              {retesting ? "Re-testing..." : "Re-test"}
            </Button>
          )}
        </div>
      )}
      <RecentProbesDisclosure field={field} refreshKey={probeHistoryRefresh} />
    </div>
  );
}

type AlertField = "threshold" | "windowMinutes" | "dominantIpRatio";

const ALERT_FIELD_LABELS: Record<AlertField, string> = {
  threshold: "Alert threshold",
  windowMinutes: "Window (minutes)",
  dominantIpRatio: "Dominant IP ratio",
};

const ALERT_FIELD_HINTS: Record<AlertField, string> = {
  threshold: "Number of auth rate-limit hits required in the window before the alert fires.",
  windowMinutes: "How many minutes of recent activity to consider when counting hits.",
  dominantIpRatio: "If a single source IP accounts for at least this fraction of hits (0–1), it is called out by name.",
};

function formatAlertValue(field: AlertField, value: number): string {
  if (field === "dominantIpRatio") return value.toFixed(2);
  return String(value);
}

/**
 * Pure mirror of `simulateWouldHaveFired` in
 * `artifacts/api-server/src/lib/auth-rate-limit-alert-traffic-preview.ts`.
 * Kept in this file (rather than a shared package) because the only consumer
 * is this card's draft-preview, and adding a workspace package round-trip
 * for ~30 lines of arithmetic would be more friction than duplication.
 *
 * The two implementations must stay in lock-step — there's a frontend test
 * that pins the exact transition behavior, and the server-side simulator
 * has its own. If you change one, change the other.
 */
function simulateWouldHaveFiredClient(
  eventTimestampsMs: number[],
  threshold: number,
  windowMinutes: number,
): { wouldHaveFiredCount: number; peakWindowHits: number } {
  if (
    !Array.isArray(eventTimestampsMs) ||
    eventTimestampsMs.length === 0 ||
    !Number.isFinite(threshold) ||
    threshold < 1 ||
    !Number.isFinite(windowMinutes) ||
    windowMinutes < 1
  ) {
    return { wouldHaveFiredCount: 0, peakWindowHits: 0 };
  }
  const windowMs = windowMinutes * 60 * 1000;
  const sorted = eventTimestampsMs.slice().sort((a, b) => a - b);
  let head = 0;
  let firingCount = 0;
  let isFiring = false;
  let peak = 0;
  for (let i = 0; i < sorted.length; i++) {
    const ts = sorted[i];
    const cutoff = ts - windowMs;
    while (head <= i && sorted[head] < cutoff) {
      head++;
      const inWindow = i - head;
      if (isFiring && inWindow < threshold) isFiring = false;
    }
    const count = i - head + 1;
    if (count > peak) peak = count;
    if (!isFiring && count >= threshold) {
      isFiring = true;
      firingCount++;
    }
  }
  return { wouldHaveFiredCount: firingCount, peakWindowHits: peak };
}

interface AlertConfigHistoryEvent {
  id: number;
  createdAt: string;
  actionType: string;
  actorId: number | null;
  actorEmail: string | null;
  actorName: string | null;
  description: string;
  changedFields: AlertField[];
  diff: Array<{ field: AlertField; from: number | null; to: number | null }>;
}

function alertConfigActorDisplay(event: AlertConfigHistoryEvent): string {
  if (event.actorName && event.actorEmail) return `${event.actorName} (${event.actorEmail})`;
  if (event.actorName) return event.actorName;
  if (event.actorEmail) return event.actorEmail;
  return "System";
}

type PitchBlockKey = "LAUNCHPAD_PITCH" | "MENTORSHIP_PITCH" | "MACHINE_PITCH" | "VIP_PITCH";

interface PitchContentValue {
  heading: string;
  line: string;
  buttonLabel: string;
  buttonUrl: string;
  thumbnailUrl?: string;
  thumbnailLinkUrl?: string;
}

const PITCH_BLOCK_LABELS: Record<PitchBlockKey, string> = {
  LAUNCHPAD_PITCH: "LaunchPad Pitch",
  MENTORSHIP_PITCH: "Mentorship Pitch",
  MACHINE_PITCH: "Machine Pitch",
  VIP_PITCH: "VIP Pitch",
};

const PITCH_BLOCK_ORDER: PitchBlockKey[] = [
  "LAUNCHPAD_PITCH",
  "MENTORSHIP_PITCH",
  "MACHINE_PITCH",
  "VIP_PITCH",
];

const EMPTY_PITCH_CONTENT: PitchContentValue = {
  heading: "",
  line: "",
  buttonLabel: "",
  buttonUrl: "",
  thumbnailUrl: "",
  thumbnailLinkUrl: "",
};

/**
 * Task #1715: editable content for the four tier-based upgrade pitch blocks
 * (LaunchPad/Mentorship/Machine/VIP) that the email pitch resolver stacks
 * into the `pitch_block_html` slot at send time based on the recipient's
 * product rank. Copy-only — which block(s) a given member sees is decided
 * server-side by `pitch-resolver.ts`'s rank matrix, not here.
 */
function PitchContentCard() {
  const { toast } = useToast();
  const [content, setContent] = useState<Record<PitchBlockKey, PitchContentValue> | null>(null);
  const [drafts, setDrafts] = useState<Record<PitchBlockKey, PitchContentValue>>({
    LAUNCHPAD_PITCH: EMPTY_PITCH_CONTENT,
    MENTORSHIP_PITCH: EMPTY_PITCH_CONTENT,
    MACHINE_PITCH: EMPTY_PITCH_CONTENT,
    VIP_PITCH: EMPTY_PITCH_CONTENT,
  });
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<PitchBlockKey | null>(null);

  const load = async () => {
    try {
      setLoading(true);
      const data = await adminPanelApi.getPitchContent();
      setContent(data);
      setDrafts(data);
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const updateDraft = (key: PitchBlockKey, field: keyof PitchContentValue, value: string) => {
    setDrafts((prev) => ({ ...prev, [key]: { ...prev[key], [field]: value } }));
  };

  const isDirty = (key: PitchBlockKey) => {
    if (!content) return false;
    const a = content[key];
    const b = drafts[key];
    return (
      a.heading !== b.heading ||
      a.line !== b.line ||
      a.buttonLabel !== b.buttonLabel ||
      a.buttonUrl !== b.buttonUrl ||
      (a.thumbnailUrl ?? "") !== (b.thumbnailUrl ?? "") ||
      (a.thumbnailLinkUrl ?? "") !== (b.thumbnailLinkUrl ?? "")
    );
  };

  const handleSave = async (key: PitchBlockKey) => {
    try {
      setSavingKey(key);
      const data = await adminPanelApi.updatePitchContent(key, drafts[key]);
      setContent(data);
      setDrafts(data);
      toast({ title: "Pitch content saved" });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setSavingKey(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Send className="w-4 h-4" /> Email Upgrade Pitches
        </CardTitle>
        <p className="text-xs text-muted-foreground mt-1">
          Content for the tier-based upgrade pitch shown at the bottom of lifecycle emails. Which block(s) a
          member sees depends on their current product tier — this only controls the copy and link for each
          block. Changes take effect on the next send, no deploy needed.
        </p>
      </CardHeader>
      <CardContent className="space-y-6">
        {loading || !content ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : (
          PITCH_BLOCK_ORDER.map((key) => (
            <div key={key} className="space-y-2 border rounded-md p-4">
              <h4 className="text-sm font-semibold">{PITCH_BLOCK_LABELS[key]}</h4>
              <div className="grid gap-2">
                <label className="text-xs text-muted-foreground">Heading</label>
                <Input
                  value={drafts[key].heading}
                  onChange={(e) => updateDraft(key, "heading", e.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <label className="text-xs text-muted-foreground">Body line</label>
                <Input
                  value={drafts[key].line}
                  onChange={(e) => updateDraft(key, "line", e.target.value)}
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <label className="text-xs text-muted-foreground">Button label</label>
                  <Input
                    value={drafts[key].buttonLabel}
                    onChange={(e) => updateDraft(key, "buttonLabel", e.target.value)}
                  />
                </div>
                <div className="grid gap-2">
                  <label className="text-xs text-muted-foreground">Button URL</label>
                  <Input
                    value={drafts[key].buttonUrl}
                    onChange={(e) => updateDraft(key, "buttonUrl", e.target.value)}
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 border-t pt-3 mt-1">
                <div className="grid gap-2">
                  <label className="text-xs text-muted-foreground">Thumbnail image URL (optional)</label>
                  <Input
                    placeholder="/images/pitch-thumbnails/example.gif"
                    value={drafts[key].thumbnailUrl ?? ""}
                    onChange={(e) => updateDraft(key, "thumbnailUrl", e.target.value)}
                  />
                </div>
                <div className="grid gap-2">
                  <label className="text-xs text-muted-foreground">Thumbnail click-through URL (optional)</label>
                  <Input
                    placeholder="https://portal.example.com/plans"
                    value={drafts[key].thumbnailLinkUrl ?? ""}
                    onChange={(e) => updateDraft(key, "thumbnailLinkUrl", e.target.value)}
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Optional video-style thumbnail rendered above the heading (both fields must be set together to
                appear). Drop compliant animated GIF files into the portal's{" "}
                <code className="bg-muted px-1 py-0.5 rounded">public/images/pitch-thumbnails/</code> folder before
                referencing them here — this field does not upload files. Requirements: (1) the first frame must be a
                complete, standalone thumbnail with the play button already baked into the image (Outlook desktop
                only ever renders frame one, so there is no way to "start paused" via markup); (2) keep the file
                under ~1MB — Gmail clips HTML past 102KB but images load separately, and file size still matters on
                mobile data; (3) use an absolute production URL (e.g. https://your-portal-domain/images/pitch-thumbnails/...),
                the same as the logo and coach photos — root-relative paths only resolve correctly once the portal
                URL setting is configured.
              </p>
              <div className="flex justify-end">
                <Button
                  size="sm"
                  disabled={!isDirty(key) || savingKey === key}
                  onClick={() => handleSave(key)}
                >
                  <Save className="w-3.5 h-3.5 mr-1.5" />
                  {savingKey === key ? "Saving..." : "Save"}
                </Button>
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

type MachineMismatchAlertField = "threshold" | "windowHours";

const MACHINE_MISMATCH_ALERT_FIELD_LABELS: Record<MachineMismatchAlertField, string> = {
  threshold: "Alert threshold",
  windowHours: "Window (hours)",
};

const MACHINE_MISMATCH_ALERT_FIELD_HINTS: Record<MachineMismatchAlertField, string> = {
  threshold: "Number of Machine orders with mismatched product details required in the window before the alert fires.",
  windowHours: "How many hours of recent Machine orders to consider when counting mismatches.",
};

/**
 * Settings card for the Machine order mismatch alert. Mirrors the
 * auth rate-limit card's per-field provenance + bounds-validated inputs +
 * reset-to-defaults UX, minus the traffic preview and history panels —
 * mismatches are rare and don't carry the same operational urgency, so
 * the simpler card stays inside one viewport. Sends `null` for fields on
 * reset so per-field provenance flips back to "default" rather than
 * leaving a row that just happens to match the default.
 */
function MachineMismatchAlertConfigCard() {
  const { toast } = useToast();
  const [status, setStatus] = useState<MachineMismatchAlertConfigStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<{ threshold: string; windowHours: string }>({
    threshold: "",
    windowHours: "",
  });
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<MachineMismatchAlertField, string>>>({});

  const hydrate = (s: MachineMismatchAlertConfigStatus) => {
    setStatus(s);
    setDraft({
      threshold: String(s.config.threshold),
      windowHours: String(s.config.windowHours),
    });
    setFieldErrors({});
  };

  const load = async () => {
    try {
      setLoading(true);
      const data = await adminPanelApi.getMachineMismatchAlertConfig();
      hydrate(data);
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const validateLocal = (): { ok: boolean; payload: { threshold: number; windowHours: number } } => {
    if (!status) return { ok: false, payload: { threshold: 0, windowHours: 0 } };
    const errors: Partial<Record<MachineMismatchAlertField, string>> = {};

    const thresholdNum = Number(draft.threshold);
    if (!Number.isFinite(thresholdNum) || !Number.isInteger(thresholdNum)) {
      errors.threshold = "Must be a whole number";
    } else if (thresholdNum < status.bounds.threshold.min || thresholdNum > status.bounds.threshold.max) {
      errors.threshold = `Must be between ${status.bounds.threshold.min} and ${status.bounds.threshold.max}`;
    }

    const windowNum = Number(draft.windowHours);
    if (!Number.isFinite(windowNum) || !Number.isInteger(windowNum)) {
      errors.windowHours = "Must be a whole number";
    } else if (windowNum < status.bounds.windowHours.min || windowNum > status.bounds.windowHours.max) {
      errors.windowHours = `Must be between ${status.bounds.windowHours.min} and ${status.bounds.windowHours.max} hours`;
    }

    setFieldErrors(errors);
    return {
      ok: Object.keys(errors).length === 0,
      payload: { threshold: thresholdNum, windowHours: windowNum },
    };
  };

  const handleSave = async () => {
    if (!status) return;
    const v = validateLocal();
    if (!v.ok) {
      toast({ title: "Fix the highlighted fields and try again", variant: "destructive" });
      return;
    }
    try {
      setSaving(true);
      const data = await adminPanelApi.updateMachineMismatchAlertConfig(v.payload);
      hydrate(data);
      if (data.changedFields.length === 0) {
        toast({ title: "No changes to save" });
      } else {
        toast({ title: "Alert thresholds saved" });
      }
    } catch (err: any) {
      if (err.fieldErrors && Array.isArray(err.fieldErrors)) {
        const next: Partial<Record<MachineMismatchAlertField, string>> = {};
        for (const e of err.fieldErrors as Array<{ field: string; message: string }>) {
          if (e.field === "threshold" || e.field === "windowHours") {
            next[e.field] = e.message;
          }
        }
        setFieldErrors(next);
      }
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleResetDefaults = async () => {
    if (!status) return;
    const anyCustomized = status.sources.threshold === "db" || status.sources.windowHours === "db";
    if (!anyCustomized) {
      setDraft({
        threshold: String(status.defaults.threshold),
        windowHours: String(status.defaults.windowHours),
      });
      setFieldErrors({});
      return;
    }
    try {
      setSaving(true);
      const data = await adminPanelApi.updateMachineMismatchAlertConfig({
        threshold: null,
        windowHours: null,
      });
      hydrate(data);
      setFieldErrors({});
      toast({ title: "Reset to defaults" });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <ShieldAlert className="w-4 h-4" /> Machine order mismatch alert
        </CardTitle>
        <p className="text-xs text-muted-foreground mt-1">
          Pages on-call when at least <em>threshold</em> Machine orders in the last <em>window</em> have product details that don't line up with the matched portal product. Changes take effect on the alerter's next poll.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading || !status ? (
          <div className="p-4 text-center text-sm text-muted-foreground">Loading alert thresholds...</div>
        ) : (
          <>
            {(["threshold", "windowHours"] as MachineMismatchAlertField[]).map((field) => (
              <div key={field} className="border rounded-md p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">{MACHINE_MISMATCH_ALERT_FIELD_LABELS[field]}</p>
                    <p className="text-xs text-muted-foreground">{MACHINE_MISMATCH_ALERT_FIELD_HINTS[field]}</p>
                  </div>
                  <span
                    className={`text-xs px-2 py-0.5 rounded ${
                      status.sources[field] === "db"
                        ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {status.sources[field] === "db" ? "Customized" : "Using default"}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    inputMode="numeric"
                    step={1}
                    min={status.bounds[field].min}
                    max={status.bounds[field].max}
                    value={draft[field]}
                    onChange={(e) => setDraft((prev) => ({ ...prev, [field]: e.target.value }))}
                    className="w-40"
                    data-testid={`machine-mismatch-alert-${field}-input`}
                    aria-invalid={!!fieldErrors[field]}
                  />
                  <span className="text-xs text-muted-foreground">
                    Range {status.bounds[field].min}–{status.bounds[field].max}. Current: {status.config[field]}. Default: {status.defaults[field]}.
                  </span>
                </div>
                {fieldErrors[field] && (
                  <p className="text-xs text-destructive" data-testid={`machine-mismatch-alert-${field}-error`}>{fieldErrors[field]}</p>
                )}
              </div>
            ))}

            <div className="flex items-center justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={handleResetDefaults}
                disabled={saving}
                data-testid="machine-mismatch-alert-reset-button"
              >
                <RotateCcw className="w-4 h-4 mr-1" /> Reset to defaults
              </Button>
              <Button
                type="button"
                onClick={handleSave}
                disabled={saving}
                data-testid="machine-mismatch-alert-save-button"
              >
                <Save className="w-4 h-4 mr-1" /> {saving ? "Saving..." : "Save"}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Settings card for the Machine order mismatch *digest watchdog* sensitivity.
 * The digest watchdog pages on-call when the daily reconciliation digest
 * quietly stops firing. Two knobs:
 *  - thresholdMultiplier: how many run-intervals stale the heartbeat must get
 *    before it pages (e.g. 2× a 24h interval = page after 48h of silence)
 *  - notificationThrottleMs: minimum gap between repeat pages per channel so
 *    a stuck digest can't re-page every poll
 *
 * The throttle is edited in minutes for readability and converted to ms on
 * the wire. `null` for either field on save resets it to its env/default.
 */
type DigestAlerterField = "thresholdMultiplier" | "notificationThrottleMs";

function digestSourceLabel(source: "db" | "env" | "default"): string {
  if (source === "db") return "Customized";
  if (source === "env") return "From env";
  return "Using default";
}

function formatAgeMs(ms: number): string {
  if (ms < 0) ms = 0;
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return "under a minute";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remMin = minutes % 60;
  if (hours < 24) return remMin > 0 ? `${hours}h ${remMin}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return remHours > 0 ? `${days}d ${remHours}h` : `${days}d`;
}

function DigestAlerterTuningCard() {
  const { toast } = useToast();
  const [status, setStatus] = useState<DigestAlerterTuningStatus | null>(null);
  const [watchdog, setWatchdog] = useState<DigestWatchdogState | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<{ thresholdMultiplier: string; throttleMinutes: string }>({
    thresholdMultiplier: "",
    throttleMinutes: "",
  });
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<DigestAlerterField, string>>>({});

  const hydrate = (s: DigestAlerterTuningStatus) => {
    setStatus(s);
    setDraft({
      thresholdMultiplier: String(s.config.thresholdMultiplier),
      throttleMinutes: String(s.config.notificationThrottleMs / 60000),
    });
    setFieldErrors({});
  };

  const load = async () => {
    try {
      setLoading(true);
      const [data, wd] = await Promise.all([
        adminPanelApi.getMachineMismatchDigestAlertConfig(),
        adminPanelApi.getMachineMismatchDigestWatchdogState().catch(() => null),
      ]);
      hydrate(data);
      setWatchdog(wd);
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  // Throttle bounds are stored in ms; surface the minute-equivalent for the UI.
  const throttleMinBounds = status
    ? {
        min: Math.ceil(status.bounds.notificationThrottleMs.min / 60000),
        max: Math.floor(status.bounds.notificationThrottleMs.max / 60000),
      }
    : { min: 0, max: 0 };

  const validateLocal = (): { ok: boolean; payload: { thresholdMultiplier: number; notificationThrottleMs: number } } => {
    if (!status) return { ok: false, payload: { thresholdMultiplier: 0, notificationThrottleMs: 0 } };
    const errors: Partial<Record<DigestAlerterField, string>> = {};

    const multiplierNum = Number(draft.thresholdMultiplier);
    const mBounds = status.bounds.thresholdMultiplier;
    if (!Number.isFinite(multiplierNum)) {
      errors.thresholdMultiplier = "Must be a number";
    } else if (multiplierNum < mBounds.min || multiplierNum > mBounds.max) {
      errors.thresholdMultiplier = `Must be between ${mBounds.min} and ${mBounds.max}`;
    }

    // Throttle is edited in minutes for readability but stored in ms; accept
    // fractional minutes (e.g. an env value of 90s shows as 1.5) so editing
    // the multiplier alone never gets blocked by an odd throttle value.
    const minutesNum = Number(draft.throttleMinutes);
    if (!Number.isFinite(minutesNum)) {
      errors.notificationThrottleMs = "Must be a number of minutes";
    } else if (minutesNum < throttleMinBounds.min || minutesNum > throttleMinBounds.max) {
      errors.notificationThrottleMs = `Must be between ${throttleMinBounds.min} and ${throttleMinBounds.max} minutes`;
    }

    setFieldErrors(errors);
    return {
      ok: Object.keys(errors).length === 0,
      payload: {
        thresholdMultiplier: multiplierNum,
        notificationThrottleMs: Math.round(minutesNum * 60000),
      },
    };
  };

  const handleSave = async () => {
    if (!status) return;
    const v = validateLocal();
    if (!v.ok) {
      toast({ title: "Fix the highlighted fields and try again", variant: "destructive" });
      return;
    }
    try {
      setSaving(true);
      const data = await adminPanelApi.updateMachineMismatchDigestAlertConfig(v.payload);
      hydrate(data);
      if (data.changedFields.length === 0) {
        toast({ title: "No changes to save" });
      } else {
        toast({ title: "Digest alert sensitivity saved" });
      }
    } catch (err: any) {
      if (err.fieldErrors && Array.isArray(err.fieldErrors)) {
        const next: Partial<Record<DigestAlerterField, string>> = {};
        for (const e of err.fieldErrors as Array<{ field: string; message: string }>) {
          if (e.field === "thresholdMultiplier" || e.field === "notificationThrottleMs") {
            next[e.field] = e.message;
          }
        }
        setFieldErrors(next);
      }
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleResetDefaults = async () => {
    if (!status) return;
    const anyCustomized = status.sources.thresholdMultiplier === "db" || status.sources.notificationThrottleMs === "db";
    if (!anyCustomized) {
      setDraft({
        thresholdMultiplier: String(status.defaults.thresholdMultiplier),
        throttleMinutes: String(status.defaults.notificationThrottleMs / 60000),
      });
      setFieldErrors({});
      return;
    }
    try {
      setSaving(true);
      const data = await adminPanelApi.updateMachineMismatchDigestAlertConfig({
        thresholdMultiplier: null,
        notificationThrottleMs: null,
      });
      hydrate(data);
      setFieldErrors({});
      toast({ title: "Reset to defaults" });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Gauge className="w-4 h-4" /> Machine mismatch digest watchdog
        </CardTitle>
        <p className="text-xs text-muted-foreground mt-1">
          Controls how sensitive the watchdog is that pages on-call when the daily Machine-order mismatch <em>digest</em> quietly stops firing. Changes take effect on the watchdog's next poll — no restart needed.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading || !status ? (
          <div className="p-4 text-center text-sm text-muted-foreground">Loading digest watchdog settings...</div>
        ) : (
          <>
            {watchdog && (() => {
              const wd = watchdog;
              const intervalHours = Math.max(1, Math.round(wd.status.intervalMs / (60 * 60 * 1000)));
              const reasons: string[] = [];
              if (wd.health.stale) reasons.push(`heartbeat older than ${wd.health.thresholdMultiplier}× interval`);
              if (wd.health.failed) reasons.push("most recent run failed");
              const reasonLabel = reasons.length > 0 ? reasons.join(" · ") : null;
              const stateLabel = !wd.enabled
                ? "Disabled"
                : wd.firing
                  ? "Firing"
                  : wd.health.alerting
                    ? "Unhealthy"
                    : "Healthy";
              const badgeClass = !wd.enabled
                ? "bg-muted text-muted-foreground"
                : wd.firing || wd.health.alerting
                  ? wd.health.failed
                    ? "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300"
                    : "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300"
                  : "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300";
              const panelClass = !wd.enabled
                ? "border-border"
                : wd.firing || wd.health.alerting
                  ? wd.health.failed
                    ? "border-red-500/40 bg-red-50 dark:bg-red-950/30"
                    : "border-amber-500/40 bg-amber-50 dark:bg-amber-950/30"
                  : "border-border";
              return (
                <div
                  className={`border rounded-md p-3 space-y-2 ${panelClass}`}
                  data-testid="digest-alerter-watchdog-status"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium">Current digest health</p>
                      <p className="text-xs text-muted-foreground">
                        Live read of what the watchdog sees right now — same decision it pages on.
                      </p>
                    </div>
                    <span
                      className={`text-xs px-2 py-0.5 rounded font-medium ${badgeClass}`}
                      data-testid="digest-alerter-watchdog-state-badge"
                    >
                      {stateLabel}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Currently paging</span>
                      <span className="font-medium text-right" data-testid="digest-alerter-watchdog-firing">
                        {wd.firing ? "Yes — on-call paged" : "No"}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Last run</span>
                      <span
                        className="font-medium text-right"
                        data-testid="digest-alerter-watchdog-last-run"
                        title={wd.status.lastRanAt ? new Date(wd.status.lastRanAt).toLocaleString() : undefined}
                      >
                        {wd.status.lastRanAt ? new Date(wd.status.lastRanAt).toLocaleString() : "Never"}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Heartbeat age</span>
                      <span className="font-medium text-right" data-testid="digest-alerter-watchdog-age">
                        {wd.enabled
                          ? `${formatAgeMs(wd.health.ageMs)} / ${formatAgeMs(wd.health.thresholdMultiplier * wd.status.intervalMs)} threshold`
                          : "—"}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Watch interval</span>
                      <span className="font-medium text-right">
                        {wd.enabled ? `every ${intervalHours}h` : "Disabled"}
                      </span>
                    </div>
                  </div>
                  {wd.enabled && reasonLabel && (
                    <p
                      className={`text-xs ${wd.health.failed ? "text-red-700 dark:text-red-300" : "text-amber-700 dark:text-amber-300"}`}
                      data-testid="digest-alerter-watchdog-reason"
                    >
                      Why unhealthy: {reasonLabel}
                    </p>
                  )}
                  {!wd.enabled && (
                    <p
                      className="text-xs text-muted-foreground"
                      data-testid="digest-alerter-watchdog-disabled-detail"
                    >
                      The digest job is disabled (run interval set to 0), so the watchdog has nothing to watch.
                    </p>
                  )}
                </div>
              );
            })()}

            <div className="border rounded-md p-3 space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Staleness threshold (× run interval)</p>
                  <p className="text-xs text-muted-foreground">
                    Page when the heartbeat is older than this many digest run-intervals. Lower = more sensitive.
                  </p>
                </div>
                <span
                  className={`text-xs px-2 py-0.5 rounded ${
                    status.sources.thresholdMultiplier === "db"
                      ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  {digestSourceLabel(status.sources.thresholdMultiplier)}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  inputMode="decimal"
                  step={0.5}
                  min={status.bounds.thresholdMultiplier.min}
                  max={status.bounds.thresholdMultiplier.max}
                  value={draft.thresholdMultiplier}
                  onChange={(e) => setDraft((prev) => ({ ...prev, thresholdMultiplier: e.target.value }))}
                  className="w-40"
                  data-testid="digest-alerter-threshold-multiplier-input"
                  aria-invalid={!!fieldErrors.thresholdMultiplier}
                />
                <span className="text-xs text-muted-foreground">
                  Range {status.bounds.thresholdMultiplier.min}–{status.bounds.thresholdMultiplier.max}. Current: {status.config.thresholdMultiplier}. Default: {status.defaults.thresholdMultiplier}.
                </span>
              </div>
              {fieldErrors.thresholdMultiplier && (
                <p className="text-xs text-destructive" data-testid="digest-alerter-threshold-multiplier-error">{fieldErrors.thresholdMultiplier}</p>
              )}
            </div>

            <div className="border rounded-md p-3 space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Re-page throttle (minutes)</p>
                  <p className="text-xs text-muted-foreground">
                    Minimum gap between repeat pages per channel while the digest stays unhealthy. 0 disables throttling.
                  </p>
                </div>
                <span
                  className={`text-xs px-2 py-0.5 rounded ${
                    status.sources.notificationThrottleMs === "db"
                      ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  {digestSourceLabel(status.sources.notificationThrottleMs)}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  inputMode="decimal"
                  step="any"
                  min={throttleMinBounds.min}
                  max={throttleMinBounds.max}
                  value={draft.throttleMinutes}
                  onChange={(e) => setDraft((prev) => ({ ...prev, throttleMinutes: e.target.value }))}
                  className="w-40"
                  data-testid="digest-alerter-throttle-minutes-input"
                  aria-invalid={!!fieldErrors.notificationThrottleMs}
                />
                <span className="text-xs text-muted-foreground">
                  Range {throttleMinBounds.min}–{throttleMinBounds.max} min. Current: {status.config.notificationThrottleMs / 60000} min. Default: {status.defaults.notificationThrottleMs / 60000} min.
                </span>
              </div>
              {fieldErrors.notificationThrottleMs && (
                <p className="text-xs text-destructive" data-testid="digest-alerter-throttle-minutes-error">{fieldErrors.notificationThrottleMs}</p>
              )}
            </div>

            <div className="flex items-center justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={handleResetDefaults}
                disabled={saving}
                data-testid="digest-alerter-reset-button"
              >
                <RotateCcw className="w-4 h-4 mr-1" /> Reset to defaults
              </Button>
              <Button
                type="button"
                onClick={handleSave}
                disabled={saving}
                data-testid="digest-alerter-save-button"
              >
                <Save className="w-4 h-4 mr-1" /> {saving ? "Saving..." : "Save"}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Settings card for the background moderation-job failure alert. Mirrors the
 * auth rate-limit and machine-mismatch cards so on-call only has to learn
 * one alert-tuning UX. Two knobs:
 *  - threshold: how many failures inside the window page on-call
 *  - windowMinutes: how long the rolling lookback is
 *
 * `null` for either field on save resets it to the shipped default, so the
 * "Reset to defaults" button can revert per-field provenance back to the
 * default badge without leaving a "Customized" row that happens to match
 * the default value.
 */
type ModerationFailureAlertField = "threshold" | "windowMinutes";

const MODERATION_FAILURE_ALERT_FIELD_LABELS: Record<ModerationFailureAlertField, string> = {
  threshold: "Failure threshold",
  windowMinutes: "Rolling window (minutes)",
};

const MODERATION_FAILURE_ALERT_FIELD_HINTS: Record<ModerationFailureAlertField, string> = {
  threshold: "Minimum total engine + persist failures inside the window required to page on-call.",
  windowMinutes: "How far back to count failures. Longer windows smooth over flaps; shorter windows page faster on a real outage.",
};

function ModerationFailureAlertConfigCard() {
  const { toast } = useToast();
  const [status, setStatus] = useState<ModerationFailureAlertConfigStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<{ threshold: string; windowMinutes: string }>({
    threshold: "",
    windowMinutes: "",
  });
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<ModerationFailureAlertField, string>>>({});
  const [history, setHistory] = useState<AlertConfigHistoryEvent[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);

  const hydrate = (s: ModerationFailureAlertConfigStatus) => {
    setStatus(s);
    setDraft({
      threshold: String(s.config.threshold),
      windowMinutes: String(s.config.windowMinutes),
    });
    setFieldErrors({});
  };

  const load = async () => {
    try {
      setLoading(true);
      const data = await adminPanelApi.getModerationFailureAlertConfig();
      hydrate(data);
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const loadHistory = async () => {
    try {
      setHistoryLoading(true);
      const data = await adminPanelApi.getModerationFailureAlertConfigHistory();
      setHistory(data.events);
    } catch (err: any) {
      toast({ title: "Couldn't load recent threshold edits", description: err.message, variant: "destructive" });
    } finally {
      setHistoryLoading(false);
    }
  };

  useEffect(() => { load(); loadHistory(); }, []);

  const validateLocal = (): { ok: boolean; payload: { threshold: number; windowMinutes: number } } => {
    if (!status) return { ok: false, payload: { threshold: 0, windowMinutes: 0 } };
    const errors: Partial<Record<ModerationFailureAlertField, string>> = {};
    const t = Number(draft.threshold);
    if (!Number.isFinite(t) || !Number.isInteger(t)) errors.threshold = "Must be a whole number";
    else if (t < status.bounds.threshold.min || t > status.bounds.threshold.max)
      errors.threshold = `Must be between ${status.bounds.threshold.min} and ${status.bounds.threshold.max}`;
    const w = Number(draft.windowMinutes);
    if (!Number.isFinite(w) || !Number.isInteger(w)) errors.windowMinutes = "Must be a whole number";
    else if (w < status.bounds.windowMinutes.min || w > status.bounds.windowMinutes.max)
      errors.windowMinutes = `Must be between ${status.bounds.windowMinutes.min} and ${status.bounds.windowMinutes.max} minutes`;
    setFieldErrors(errors);
    return { ok: Object.keys(errors).length === 0, payload: { threshold: t, windowMinutes: w } };
  };

  const isDirty = !!status && (
    Number(draft.threshold) !== status.config.threshold ||
    Number(draft.windowMinutes) !== status.config.windowMinutes
  );

  const handleSave = async () => {
    if (!status) return;
    const v = validateLocal();
    if (!v.ok) {
      toast({ title: "Fix the highlighted fields and try again", variant: "destructive" });
      return;
    }
    try {
      setSaving(true);
      const data = await adminPanelApi.updateModerationFailureAlertConfig(v.payload);
      hydrate(data);
      await loadHistory();
      toast({ title: data.changedFields.length === 0 ? "No changes to save" : "Alert thresholds saved" });
    } catch (err: any) {
      if (err.fieldErrors && Array.isArray(err.fieldErrors)) {
        const next: Partial<Record<ModerationFailureAlertField, string>> = {};
        for (const e of err.fieldErrors as Array<{ field: string; message: string }>) {
          if (e.field === "threshold" || e.field === "windowMinutes") next[e.field] = e.message;
        }
        setFieldErrors(next);
      }
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleResetDefaults = async () => {
    if (!status) return;
    const anyCustomized = status.sources.threshold === "db" || status.sources.windowMinutes === "db";
    if (!anyCustomized) {
      setDraft({
        threshold: String(status.defaults.threshold),
        windowMinutes: String(status.defaults.windowMinutes),
      });
      setFieldErrors({});
      return;
    }
    try {
      setSaving(true);
      const data = await adminPanelApi.updateModerationFailureAlertConfig({
        threshold: null,
        windowMinutes: null,
      });
      hydrate(data);
      await loadHistory();
      toast({ title: "Reset to defaults" });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <ShieldAlert className="w-4 h-4" /> Moderation job failure alert
        </CardTitle>
        <p className="text-xs text-muted-foreground mt-1">
          Pages on-call when the background moderation queue starts dropping jobs. The alert fires when at least <em>threshold</em> engine + persist failures land within the rolling <em>window</em>. Persist failures (DB write threw after a flag) and engine failures (evaluator threw) are counted together for the threshold but called out separately in the page body so on-call knows whether known-bad content is still publicly active.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading || !status ? (
          <div className="p-4 text-center text-sm text-muted-foreground">Loading alert thresholds...</div>
        ) : (
          <>
            {(["threshold", "windowMinutes"] as ModerationFailureAlertField[]).map((field) => {
              const value = draft[field];
              const current = status.config[field];
              const def = status.defaults[field];
              const source = status.sources[field];
              const bounds = status.bounds[field];
              const error = fieldErrors[field];
              return (
                <div key={field} className="border rounded-md p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium">{MODERATION_FAILURE_ALERT_FIELD_LABELS[field]}</p>
                      <p className="text-xs text-muted-foreground">{MODERATION_FAILURE_ALERT_FIELD_HINTS[field]}</p>
                    </div>
                    <span
                      className={`text-xs px-2 py-0.5 rounded ${
                        source === "db"
                          ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {source === "db" ? "Customized" : "Using default"}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      inputMode="numeric"
                      step={1}
                      min={bounds.min}
                      max={bounds.max}
                      value={value}
                      onChange={(e) => setDraft((prev) => ({ ...prev, [field]: e.target.value }))}
                      className="w-40"
                      data-testid={`moderation-failure-alert-${field}-input`}
                      aria-invalid={!!error}
                    />
                    <span className="text-xs text-muted-foreground">
                      Range {bounds.min}–{bounds.max}. Current: {current}. Default: {def}.
                    </span>
                  </div>
                  {error && (
                    <p className="text-xs text-destructive" data-testid={`moderation-failure-alert-${field}-error`}>{error}</p>
                  )}
                </div>
              );
            })}

            <div className="flex items-center justify-between border-t pt-4">
              <Button variant="outline" size="sm" onClick={handleResetDefaults} disabled={saving} data-testid="moderation-failure-alert-reset-defaults">
                <RotateCcw className="w-4 h-4 mr-1" /> Reset to defaults
              </Button>
              <Button onClick={handleSave} disabled={saving || !isDirty} data-testid="moderation-failure-alert-save">
                <Save className="w-4 h-4 mr-1" />{saving ? "Saving..." : "Save thresholds"}
              </Button>
            </div>

            <AlertConfigHistorySection
              events={history}
              loading={historyLoading}
              auditEntityType="moderation_failure_alert_config"
            />
          </>
        )}
      </CardContent>
    </Card>
  );
}

function AuthRateLimitAlertConfigCard() {
  const { toast } = useToast();
  const [status, setStatus] = useState<AuthRateLimitAlertConfigStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<{ threshold: string; windowMinutes: string; dominantIpRatio: string }>({
    threshold: "",
    windowMinutes: "",
    dominantIpRatio: "",
  });
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<AlertField, string>>>({});
  const [trafficPreview, setTrafficPreview] = useState<AuthRateLimitAlertTrafficPreview | null>(null);
  const [trafficLoading, setTrafficLoading] = useState(true);
  const [trafficError, setTrafficError] = useState<string | null>(null);
  const [history, setHistory] = useState<AlertConfigHistoryEvent[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);

  const hydrate = (s: AuthRateLimitAlertConfigStatus) => {
    setStatus(s);
    setDraft({
      threshold: String(s.config.threshold),
      windowMinutes: String(s.config.windowMinutes),
      dominantIpRatio: String(s.config.dominantIpRatio),
    });
    setFieldErrors({});
  };

  const load = async () => {
    try {
      setLoading(true);
      const data = await adminPanelApi.getAuthRateLimitAlertConfig();
      hydrate(data);
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  // Refreshes the recent-traffic snapshot. Called once on mount and again
  // after a successful save so the "would have fired" preview reflects any
  // hits that landed while the admin was on the page.
  const loadTraffic = async () => {
    try {
      setTrafficLoading(true);
      setTrafficError(null);
      const data = await adminPanelApi.getAuthRateLimitAlertTrafficPreview();
      setTrafficPreview(data);
    } catch (err: any) {
      setTrafficError(err?.message || "Failed to load traffic preview");
    } finally {
      setTrafficLoading(false);
    }
  };

  const loadHistory = async () => {
    try {
      setHistoryLoading(true);
      const data = await adminPanelApi.getAuthRateLimitAlertConfigHistory();
      setHistory(data.events);
    } catch (err: any) {
      // History is informational — surface a toast but don't take down the
      // whole card if the log fetch fails (the configuration UI above is
      // still operable).
      toast({ title: "Couldn't load recent threshold edits", description: err.message, variant: "destructive" });
    } finally {
      setHistoryLoading(false);
    }
  };

  useEffect(() => { load(); loadTraffic(); loadHistory(); }, []);

  const validateLocal = (): { ok: boolean; payload: { threshold: number; windowMinutes: number; dominantIpRatio: number } } => {
    if (!status) return { ok: false, payload: { threshold: 0, windowMinutes: 0, dominantIpRatio: 0 } };
    const errors: Partial<Record<AlertField, string>> = {};

    const thresholdNum = Number(draft.threshold);
    if (!Number.isFinite(thresholdNum) || !Number.isInteger(thresholdNum)) {
      errors.threshold = "Must be a whole number";
    } else if (thresholdNum < status.bounds.threshold.min || thresholdNum > status.bounds.threshold.max) {
      errors.threshold = `Must be between ${status.bounds.threshold.min} and ${status.bounds.threshold.max}`;
    }

    const windowNum = Number(draft.windowMinutes);
    if (!Number.isFinite(windowNum) || !Number.isInteger(windowNum)) {
      errors.windowMinutes = "Must be a whole number";
    } else if (windowNum < status.bounds.windowMinutes.min || windowNum > status.bounds.windowMinutes.max) {
      errors.windowMinutes = `Must be between ${status.bounds.windowMinutes.min} and ${status.bounds.windowMinutes.max} minutes`;
    }

    const ratioNum = Number(draft.dominantIpRatio);
    if (!Number.isFinite(ratioNum)) {
      errors.dominantIpRatio = "Must be a number";
    } else if (ratioNum < status.bounds.dominantIpRatio.min || ratioNum > status.bounds.dominantIpRatio.max) {
      errors.dominantIpRatio = `Must be between ${status.bounds.dominantIpRatio.min} and ${status.bounds.dominantIpRatio.max}`;
    }

    setFieldErrors(errors);
    return {
      ok: Object.keys(errors).length === 0,
      payload: { threshold: thresholdNum, windowMinutes: windowNum, dominantIpRatio: ratioNum },
    };
  };

  const isDirty = !!status && (
    Number(draft.threshold) !== status.config.threshold ||
    Number(draft.windowMinutes) !== status.config.windowMinutes ||
    Number(draft.dominantIpRatio) !== status.config.dominantIpRatio
  );

  const handleSave = async () => {
    if (!status) return;
    const v = validateLocal();
    if (!v.ok) {
      toast({ title: "Fix the highlighted fields and try again", variant: "destructive" });
      return;
    }
    try {
      setSaving(true);
      const data = await adminPanelApi.updateAuthRateLimitAlertConfig(v.payload);
      hydrate(data);
      if (data.changedFields.length === 0) {
        toast({ title: "No changes to save" });
      } else {
        toast({ title: "Alert thresholds saved" });
        // Refresh the traffic preview so any hits that landed while the
        // admin was tweaking thresholds get reflected in the "would have
        // fired" count next to the freshly-saved values.
        loadTraffic();
        // The save itself wrote a new audit row — refresh the timeline so
        // the admin sees their own change reflected immediately rather
        // than having to reload the page.
        await loadHistory();
      }
    } catch (err: any) {
      if (err.fieldErrors && Array.isArray(err.fieldErrors)) {
        const next: Partial<Record<AlertField, string>> = {};
        for (const e of err.fieldErrors as Array<{ field: string; message: string }>) {
          if (e.field === "threshold" || e.field === "windowMinutes" || e.field === "dominantIpRatio") {
            next[e.field] = e.message;
          }
        }
        setFieldErrors(next);
      }
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleResetDefaults = async () => {
    if (!status) return;
    // If nothing is customized there's nothing to reset — just clear the
    // local form and any field errors. Otherwise send `null` for every
    // field so the server deletes the rows and per-field provenance flips
    // back to "default" (a plain re-save of the defaults would leave the
    // rows in place and the source still showing as "Customized").
    const anyCustomized =
      status.sources.threshold === "db" ||
      status.sources.windowMinutes === "db" ||
      status.sources.dominantIpRatio === "db";
    if (!anyCustomized) {
      setDraft({
        threshold: String(status.defaults.threshold),
        windowMinutes: String(status.defaults.windowMinutes),
        dominantIpRatio: String(status.defaults.dominantIpRatio),
      });
      setFieldErrors({});
      return;
    }
    try {
      setSaving(true);
      const data = await adminPanelApi.updateAuthRateLimitAlertConfig({
        threshold: null,
        windowMinutes: null,
        dominantIpRatio: null,
      });
      hydrate(data);
      setFieldErrors({});
      toast({ title: "Reset to defaults" });
      // Reset is also an audit row — refresh so it shows up in the timeline.
      await loadHistory();
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <ShieldAlert className="w-4 h-4" /> Auth rate-limit burst alert
        </CardTitle>
        <p className="text-xs text-muted-foreground mt-1">
          Tunes the dashboard "Auth rate-limit burst" alert. The alert fires when at least <em>threshold</em> auth rate-limit hits land within the rolling <em>window</em>; the dominant-IP ratio controls when a single source IP is called out by name. Changes take effect on the next dashboard refresh.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading || !status ? (
          <div className="p-4 text-center text-sm text-muted-foreground">Loading alert thresholds...</div>
        ) : (
          <>
            <AlertConfigRow
              field="threshold"
              draftValue={draft.threshold}
              currentValue={status.config.threshold}
              defaultValue={status.defaults.threshold}
              source={status.sources.threshold}
              bounds={status.bounds.threshold}
              error={fieldErrors.threshold}
              inputProps={{ inputMode: "numeric", step: 1 }}
              onChange={(v) => setDraft((prev) => ({ ...prev, threshold: v }))}
            />
            <AlertConfigRow
              field="windowMinutes"
              draftValue={draft.windowMinutes}
              currentValue={status.config.windowMinutes}
              defaultValue={status.defaults.windowMinutes}
              source={status.sources.windowMinutes}
              bounds={status.bounds.windowMinutes}
              error={fieldErrors.windowMinutes}
              inputProps={{ inputMode: "numeric", step: 1 }}
              onChange={(v) => setDraft((prev) => ({ ...prev, windowMinutes: v }))}
            />
            <AlertConfigRow
              field="dominantIpRatio"
              draftValue={draft.dominantIpRatio}
              currentValue={status.config.dominantIpRatio}
              defaultValue={status.defaults.dominantIpRatio}
              source={status.sources.dominantIpRatio}
              bounds={status.bounds.dominantIpRatio}
              error={fieldErrors.dominantIpRatio}
              inputProps={{ inputMode: "decimal", step: 0.05 }}
              onChange={(v) => setDraft((prev) => ({ ...prev, dominantIpRatio: v }))}
            />

            <AlertTrafficPreviewPanel
              preview={trafficPreview}
              loading={trafficLoading}
              error={trafficError}
              draftThreshold={Number(draft.threshold)}
              draftWindowMinutes={Number(draft.windowMinutes)}
              savedThreshold={status.config.threshold}
              savedWindowMinutes={status.config.windowMinutes}
              onRetry={loadTraffic}
            />

            <div className="flex items-center justify-between border-t pt-4">
              <Button variant="outline" size="sm" onClick={handleResetDefaults} disabled={saving} data-testid="reset-alert-defaults">
                <RotateCcw className="w-4 h-4 mr-1" /> Reset to defaults
              </Button>
              <Button onClick={handleSave} disabled={saving || !isDirty} data-testid="save-alert-config">
                <Save className="w-4 h-4 mr-1" />{saving ? "Saving..." : "Save thresholds"}
              </Button>
            </div>

            <AlertConfigHistorySection
              events={history}
              loading={historyLoading}
              auditEntityType="auth_rate_limit_alert_config"
            />
          </>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * "Recent threshold edits" timeline for the auth rate-limit burst alert
 * card. Mirrors the on-call destinations history section so an admin
 * looking at either card sees the same shape of provenance information.
 * Falls back to a "no edits yet" placeholder so admins can confirm the
 * thresholds are still on the originally-shipped defaults at a glance.
 */
function AlertConfigHistorySection({
  events,
  loading,
  auditEntityType,
}: {
  events: AlertConfigHistoryEvent[];
  loading: boolean;
  auditEntityType: string;
}) {
  return (
    <div className="border-t pt-4 space-y-2">
      <div>
        <p className="text-sm font-medium flex items-center gap-2">
          <History className="w-4 h-4" /> Recent threshold edits
        </p>
        <p className="text-xs text-muted-foreground">
          Who last tuned these thresholds and what they changed. Sourced from the audit log.
        </p>
      </div>
      {loading ? (
        <div className="p-3 text-center text-xs text-muted-foreground" data-testid="alert-config-history-loading">
          Loading recent threshold edits...
        </div>
      ) : events.length === 0 ? (
        <div
          className="p-3 text-center text-xs text-muted-foreground border rounded-md bg-muted/20"
          data-testid="alert-config-history-empty"
        >
          No threshold edits recorded yet — still on the original defaults.
        </div>
      ) : (
        <div className="border rounded-md divide-y bg-muted/20" data-testid="alert-config-history-list">
          {events.map((event) => (
            <AlertConfigHistoryRow key={event.id} event={event} />
          ))}
        </div>
      )}
      {!loading && (
        <div className="flex justify-end pt-1">
          <a
            href={`/admin/audit-log?entityType=${encodeURIComponent(auditEntityType)}`}
            className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
            data-testid="link-alert-config-view-all-audit"
          >
            View all in Audit Log
            <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      )}
    </div>
  );
}

function AlertConfigHistoryRow({ event }: { event: AlertConfigHistoryEvent }) {
  return (
    <div className="p-3 text-sm space-y-1" data-testid={`alert-config-history-row-${event.id}`}>
      <div className="flex items-start gap-3">
        <Save className="w-4 h-4 mt-0.5 text-muted-foreground shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-medium">Updated thresholds</span>
            <span className="text-xs text-muted-foreground">by {alertConfigActorDisplay(event)}</span>
          </div>
          <div className="text-xs text-muted-foreground">{formatHistoryTimestamp(event.createdAt)}</div>

          {event.diff.length > 0 ? (
            <div className="mt-1 flex flex-wrap gap-1">
              {event.diff.map((d) => (
                <span
                  key={d.field}
                  className="text-xs px-2 py-0.5 rounded bg-background border text-foreground"
                  data-testid={`alert-config-history-change-${d.field}`}
                >
                  <span className="font-medium">{ALERT_FIELD_LABELS[d.field]}</span>
                  {d.from !== null && d.to !== null && (
                    <span className="text-muted-foreground">
                      {": "}
                      {formatAlertValue(d.field, d.from)} → {formatAlertValue(d.field, d.to)}
                    </span>
                  )}
                  {d.from === null && d.to !== null && (
                    <span className="text-muted-foreground">
                      {": set to "}
                      {formatAlertValue(d.field, d.to)}
                    </span>
                  )}
                  {d.from !== null && d.to === null && (
                    <span className="text-muted-foreground">
                      {": reset (was "}
                      {formatAlertValue(d.field, d.from)})
                    </span>
                  )}
                </span>
              ))}
            </div>
          ) : event.changedFields.length > 0 ? (
            <div className="mt-1 flex flex-wrap gap-1">
              {event.changedFields.map((f) => (
                <span
                  key={f}
                  className="text-xs px-2 py-0.5 rounded bg-background border text-foreground"
                >
                  {ALERT_FIELD_LABELS[f]}
                </span>
              ))}
            </div>
          ) : (
            <div className="text-xs text-muted-foreground mt-1">{event.description}</div>
          )}
        </div>
      </div>
    </div>
  );
}

function AlertConfigRow({
  field,
  draftValue,
  currentValue,
  defaultValue,
  source,
  bounds,
  error,
  inputProps,
  onChange,
}: {
  field: AlertField;
  draftValue: string;
  currentValue: number;
  defaultValue: number;
  source: "db" | "default";
  bounds: { min: number; max: number };
  error?: string;
  inputProps?: { inputMode?: "numeric" | "decimal"; step?: number };
  onChange: (v: string) => void;
}) {
  return (
    <div className="border rounded-md p-3 space-y-2">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium">{ALERT_FIELD_LABELS[field]}</p>
          <p className="text-xs text-muted-foreground">{ALERT_FIELD_HINTS[field]}</p>
        </div>
        <span
          className={`text-xs px-2 py-0.5 rounded ${
            source === "db"
              ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300"
              : "bg-muted text-muted-foreground"
          }`}
        >
          {source === "db" ? "Customized" : "Using default"}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <Input
          type="number"
          inputMode={inputProps?.inputMode}
          step={inputProps?.step}
          min={bounds.min}
          max={bounds.max}
          value={draftValue}
          onChange={(e) => onChange(e.target.value)}
          className="w-40"
          data-testid={`alert-${field}-input`}
          aria-invalid={!!error}
        />
        <span className="text-xs text-muted-foreground">
          Range {bounds.min}–{bounds.max}. Current: {formatAlertValue(field, currentValue)}. Default: {formatAlertValue(field, defaultValue)}.
        </span>
      </div>
      {error && (
        <p className="text-xs text-destructive" data-testid={`alert-${field}-error`}>{error}</p>
      )}
    </div>
  );
}

/**
 * Renders the recent-traffic snapshot below the alert threshold inputs so
 * admins can sanity-check their proposed values against real activity
 * instead of waiting for a real incident. Three pieces:
 *
 *   1. A headline number — "Would have fired N times in the last 7 days at
 *      the SAVED thresholds" — so a glance tells you whether the live alert
 *      is reasonable. We deliberately base this on the SAVED config (not
 *      the in-progress draft) so the number doesn't shift while typing
 *      makes the threshold input briefly invalid.
 *   2. A live "if you save this draft" line that updates as the admin types,
 *      so they can dial values up/down with immediate feedback.
 *   3. A per-day mini bar chart so admins can see whether traffic has been
 *      steady or spikey — a single high-spike day should suggest a HIGHER
 *      threshold than a flat-but-busy week with the same total.
 *
 * Warnings:
 *   - "Effectively disabled" when the draft threshold is more than 2× the
 *     largest single-window burst observed during the lookback. Above 2×
 *     it's basically certain the admin would never have seen the alert
 *     under recent traffic.
 *   - "Would fire constantly" when the simulated fire count exceeds 1/day
 *     on average — that's where notification fatigue starts to outweigh
 *     the signal value of any individual page.
 */
function AlertTrafficPreviewPanel({
  preview,
  loading,
  error,
  draftThreshold,
  draftWindowMinutes,
  savedThreshold,
  savedWindowMinutes,
  onRetry,
}: {
  preview: AuthRateLimitAlertTrafficPreview | null;
  loading: boolean;
  error: string | null;
  draftThreshold: number;
  draftWindowMinutes: number;
  savedThreshold: number;
  savedWindowMinutes: number;
  onRetry: () => void;
}) {
  if (loading) {
    return (
      <div
        className="border rounded-md p-3 text-sm text-muted-foreground"
        data-testid="alert-traffic-preview"
      >
        Loading recent traffic preview...
      </div>
    );
  }

  if (error || !preview) {
    return (
      <div
        className="border rounded-md p-3 text-sm space-y-2"
        data-testid="alert-traffic-preview"
      >
        <p className="text-destructive">
          Couldn't load the recent traffic preview{error ? `: ${error}` : "."}
        </p>
        <Button variant="outline" size="sm" onClick={onRetry} data-testid="alert-traffic-retry">
          Retry
        </Button>
      </div>
    );
  }

  const events = preview.eventTimestampsMs;
  const draftValid =
    Number.isFinite(draftThreshold) &&
    draftThreshold >= 1 &&
    Number.isFinite(draftWindowMinutes) &&
    draftWindowMinutes >= 1;

  // We always compute the SAVED-config preview so the headline is stable.
  // If the live values came back truncated the simulator returns zeros,
  // and we surface a "too much data" note instead.
  const saved = events
    ? simulateWouldHaveFiredClient(events, savedThreshold, savedWindowMinutes)
    : { wouldHaveFiredCount: 0, peakWindowHits: 0 };
  const draft = events && draftValid
    ? simulateWouldHaveFiredClient(events, draftThreshold, draftWindowMinutes)
    : null;

  const draftDiffersFromSaved =
    draftValid && (draftThreshold !== savedThreshold || draftWindowMinutes !== savedWindowMinutes);

  // Heuristics for the "you're way off" warnings. They're intentionally
  // conservative so a healthy value never triggers a scary banner.
  // - Disabled: peak burst we saw is less than half the threshold AND
  //   we saw enough traffic for that to be meaningful (totalHits > 0).
  // - Noisy: more than one fire per day on average.
  const lookbackDays = Math.max(1, preview.lookbackDays);
  const draftOrSaved = draft ?? saved;
  const draftThresholdOrSaved = draftValid ? draftThreshold : savedThreshold;
  const effectivelyDisabled =
    !preview.truncated &&
    preview.totalHits > 0 &&
    draftOrSaved.peakWindowHits > 0 &&
    draftThresholdOrSaved > draftOrSaved.peakWindowHits * 2;
  const wouldFireConstantly =
    !preview.truncated && draftOrSaved.wouldHaveFiredCount > lookbackDays;

  // Sparkline scaling: the tallest bar fills the row; everything else is a
  // proportional fraction. A floor of 1px keeps non-zero days visible.
  const maxBucket = preview.dailyBuckets.reduce((m, b) => Math.max(m, b.hits), 0);

  return (
    <div className="border rounded-md p-3 space-y-3" data-testid="alert-traffic-preview">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">Recent traffic</p>
        <span className="text-xs text-muted-foreground">
          Last {preview.lookbackDays} day{preview.lookbackDays === 1 ? "" : "s"} · {preview.totalHits} hit{preview.totalHits === 1 ? "" : "s"}
        </span>
      </div>

      {preview.truncated ? (
        <p className="text-xs text-muted-foreground" data-testid="alert-traffic-truncated">
          Too many auth rate-limit hits in the last {preview.lookbackDays} day{preview.lookbackDays === 1 ? "" : "s"} to preview live ({preview.totalHits.toLocaleString()} total). Save your changes and check back to see the recomputed counts.
        </p>
      ) : (
        <>
          <div className="text-xs space-y-1">
            <p data-testid="alert-traffic-saved-summary">
              At the saved thresholds (≥{savedThreshold} in {savedWindowMinutes} min), this alert would have fired{" "}
              <strong>{saved.wouldHaveFiredCount} time{saved.wouldHaveFiredCount === 1 ? "" : "s"}</strong> in the last {preview.lookbackDays} day{preview.lookbackDays === 1 ? "" : "s"}.
            </p>
            {draftDiffersFromSaved && draft && (
              <p className="text-muted-foreground" data-testid="alert-traffic-draft-summary">
                With your draft (≥{draftThreshold} in {draftWindowMinutes} min): would fire <strong>{draft.wouldHaveFiredCount} time{draft.wouldHaveFiredCount === 1 ? "" : "s"}</strong>.
              </p>
            )}
            <p className="text-muted-foreground">
              Peak {draftValid ? `(${draftWindowMinutes}-min)` : `(${savedWindowMinutes}-min)`} window held{" "}
              <strong>{draftOrSaved.peakWindowHits} hit{draftOrSaved.peakWindowHits === 1 ? "" : "s"}</strong>.
            </p>
          </div>

          {preview.dailyBuckets.length > 0 && (
            <div className="space-y-1" data-testid="alert-traffic-sparkline">
              <div className="flex items-end gap-0.5 h-10">
                {preview.dailyBuckets.map((b) => {
                  const heightPct = maxBucket > 0 ? (b.hits / maxBucket) * 100 : 0;
                  return (
                    <div
                      key={b.dayStart}
                      className="flex-1 bg-muted rounded-sm relative"
                      title={`${new Date(b.dayStart).toLocaleDateString(undefined, { month: "short", day: "numeric" })}: ${b.hits} hit${b.hits === 1 ? "" : "s"}`}
                    >
                      <div
                        className="absolute bottom-0 left-0 right-0 bg-primary rounded-sm"
                        style={{ height: b.hits === 0 ? "0%" : `${Math.max(heightPct, 6)}%` }}
                      />
                    </div>
                  );
                })}
              </div>
              <div className="flex justify-between text-[10px] text-muted-foreground">
                <span>
                  {new Date(preview.dailyBuckets[0].dayStart).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                </span>
                <span>
                  {new Date(preview.dailyBuckets[preview.dailyBuckets.length - 1].dayStart).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                </span>
              </div>
            </div>
          )}

          {effectivelyDisabled && (
            <div
              className="text-xs rounded-md p-2 bg-amber-50 border border-amber-200 text-amber-900 dark:bg-amber-950/30 dark:border-amber-900 dark:text-amber-200"
              data-testid="alert-traffic-warning-disabled"
            >
              Heads up: this threshold is more than twice the largest burst seen in the last {preview.lookbackDays} day{preview.lookbackDays === 1 ? "" : "s"} ({draftOrSaved.peakWindowHits} hit{draftOrSaved.peakWindowHits === 1 ? "" : "s"} in {draftValid ? draftWindowMinutes : savedWindowMinutes} min). The alert may be effectively disabled — consider lowering it.
            </div>
          )}
          {wouldFireConstantly && (
            <div
              className="text-xs rounded-md p-2 bg-amber-50 border border-amber-200 text-amber-900 dark:bg-amber-950/30 dark:border-amber-900 dark:text-amber-200"
              data-testid="alert-traffic-warning-noisy"
            >
              Heads up: this threshold would have fired {draftOrSaved.wouldHaveFiredCount} time{draftOrSaved.wouldHaveFiredCount === 1 ? "" : "s"} in the last {preview.lookbackDays} day{preview.lookbackDays === 1 ? "" : "s"} (more than once per day on average). Consider raising it to avoid notification fatigue.
            </div>
          )}
        </>
      )}
    </div>
  );
}

type RetentionField = "emailRetentionDays" | "phoneRetentionDays";

const RETENTION_FIELD_LABELS: Record<RetentionField, string> = {
  emailRetentionDays: "Email-change history retention (days)",
  phoneRetentionDays: "Phone-change history retention (days)",
};

const RETENTION_FIELD_HINTS: Record<RetentionField, string> = {
  emailRetentionDays:
    "How many days to keep email-change history rows before the cleanup job deletes them.",
  phoneRetentionDays:
    "How many days to keep phone-change history rows before the cleanup job deletes them.",
};

function ChangeHistoryRetentionConfigCard() {
  const { toast } = useToast();
  const [status, setStatus] = useState<ChangeHistoryRetentionConfigStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<{ emailRetentionDays: string; phoneRetentionDays: string }>({
    emailRetentionDays: "",
    phoneRetentionDays: "",
  });
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<RetentionField, string>>>({});

  const hydrate = (s: ChangeHistoryRetentionConfigStatus) => {
    setStatus(s);
    setDraft({
      emailRetentionDays: String(s.config.emailRetentionDays),
      phoneRetentionDays: String(s.config.phoneRetentionDays),
    });
    setFieldErrors({});
  };

  const load = async () => {
    try {
      setLoading(true);
      const data = await adminPanelApi.getChangeHistoryRetentionConfig();
      hydrate(data);
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const validateLocal = (): { ok: boolean; payload: { emailRetentionDays: number; phoneRetentionDays: number } } => {
    if (!status) return { ok: false, payload: { emailRetentionDays: 0, phoneRetentionDays: 0 } };
    const errors: Partial<Record<RetentionField, string>> = {};

    const emailNum = Number(draft.emailRetentionDays);
    if (!Number.isFinite(emailNum) || !Number.isInteger(emailNum)) {
      errors.emailRetentionDays = "Must be a whole number of days";
    } else if (
      emailNum < status.bounds.emailRetentionDays.min ||
      emailNum > status.bounds.emailRetentionDays.max
    ) {
      errors.emailRetentionDays = `Must be between ${status.bounds.emailRetentionDays.min} and ${status.bounds.emailRetentionDays.max} days`;
    }

    const phoneNum = Number(draft.phoneRetentionDays);
    if (!Number.isFinite(phoneNum) || !Number.isInteger(phoneNum)) {
      errors.phoneRetentionDays = "Must be a whole number of days";
    } else if (
      phoneNum < status.bounds.phoneRetentionDays.min ||
      phoneNum > status.bounds.phoneRetentionDays.max
    ) {
      errors.phoneRetentionDays = `Must be between ${status.bounds.phoneRetentionDays.min} and ${status.bounds.phoneRetentionDays.max} days`;
    }

    setFieldErrors(errors);
    return {
      ok: Object.keys(errors).length === 0,
      payload: { emailRetentionDays: emailNum, phoneRetentionDays: phoneNum },
    };
  };

  const isDirty = !!status && (
    Number(draft.emailRetentionDays) !== status.config.emailRetentionDays ||
    Number(draft.phoneRetentionDays) !== status.config.phoneRetentionDays
  );

  const handleSave = async () => {
    if (!status) return;
    const v = validateLocal();
    if (!v.ok) {
      toast({ title: "Fix the highlighted fields and try again", variant: "destructive" });
      return;
    }
    try {
      setSaving(true);
      const data = await adminPanelApi.updateChangeHistoryRetentionConfig(v.payload);
      hydrate(data);
      if (data.changedFields.length === 0) {
        toast({ title: "No changes to save" });
      } else {
        toast({ title: "Retention windows saved" });
      }
    } catch (err: any) {
      if (err.fieldErrors && Array.isArray(err.fieldErrors)) {
        const next: Partial<Record<RetentionField, string>> = {};
        for (const e of err.fieldErrors as Array<{ field: string; message: string }>) {
          if (e.field === "emailRetentionDays" || e.field === "phoneRetentionDays") {
            next[e.field] = e.message;
          }
        }
        setFieldErrors(next);
      }
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleResetDefaults = async () => {
    if (!status) return;
    // Same pattern as the auth rate-limit card: if nothing is customized
    // there's nothing to reset on the server — just refill the inputs
    // locally. Otherwise send `null` for every field so the server deletes
    // the rows and per-field provenance flips back to "default".
    const anyCustomized =
      status.sources.emailRetentionDays === "db" ||
      status.sources.phoneRetentionDays === "db";
    if (!anyCustomized) {
      setDraft({
        emailRetentionDays: String(status.defaults.emailRetentionDays),
        phoneRetentionDays: String(status.defaults.phoneRetentionDays),
      });
      setFieldErrors({});
      return;
    }
    try {
      setSaving(true);
      const data = await adminPanelApi.updateChangeHistoryRetentionConfig({
        emailRetentionDays: null,
        phoneRetentionDays: null,
      });
      hydrate(data);
      setFieldErrors({});
      toast({ title: "Reset to defaults" });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Archive className="w-4 h-4" /> Change-history retention
        </CardTitle>
        <p className="text-xs text-muted-foreground mt-1">
          Controls how long the cleanup jobs keep old email-change and phone-change history rows. Values are read by the cleanup jobs at runtime, so changes take effect on the next scheduled run (no restart needed). Compliance-strict deployments can lower these; support-heavy ones can raise them.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading || !status ? (
          <div className="p-4 text-center text-sm text-muted-foreground">Loading retention windows...</div>
        ) : (
          <>
            <RetentionConfigRow
              field="emailRetentionDays"
              draftValue={draft.emailRetentionDays}
              currentValue={status.config.emailRetentionDays}
              defaultValue={status.defaults.emailRetentionDays}
              source={status.sources.emailRetentionDays}
              bounds={status.bounds.emailRetentionDays}
              error={fieldErrors.emailRetentionDays}
              onChange={(v) => setDraft((prev) => ({ ...prev, emailRetentionDays: v }))}
            />
            <RetentionConfigRow
              field="phoneRetentionDays"
              draftValue={draft.phoneRetentionDays}
              currentValue={status.config.phoneRetentionDays}
              defaultValue={status.defaults.phoneRetentionDays}
              source={status.sources.phoneRetentionDays}
              bounds={status.bounds.phoneRetentionDays}
              error={fieldErrors.phoneRetentionDays}
              onChange={(v) => setDraft((prev) => ({ ...prev, phoneRetentionDays: v }))}
            />

            <div className="flex items-center justify-between border-t pt-4">
              <Button variant="outline" size="sm" onClick={handleResetDefaults} disabled={saving} data-testid="reset-retention-defaults">
                <RotateCcw className="w-4 h-4 mr-1" /> Reset to defaults
              </Button>
              <Button onClick={handleSave} disabled={saving || !isDirty} data-testid="save-retention-config">
                <Save className="w-4 h-4 mr-1" />{saving ? "Saving..." : "Save retention windows"}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function RetentionConfigRow({
  field,
  draftValue,
  currentValue,
  defaultValue,
  source,
  bounds,
  error,
  onChange,
}: {
  field: RetentionField;
  draftValue: string;
  currentValue: number;
  defaultValue: number;
  source: "db" | "default";
  bounds: { min: number; max: number };
  error?: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="border rounded-md p-3 space-y-2">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium">{RETENTION_FIELD_LABELS[field]}</p>
          <p className="text-xs text-muted-foreground">{RETENTION_FIELD_HINTS[field]}</p>
        </div>
        <span
          className={`text-xs px-2 py-0.5 rounded ${
            source === "db"
              ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300"
              : "bg-muted text-muted-foreground"
          }`}
        >
          {source === "db" ? "Customized" : "Using default"}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <Input
          type="number"
          inputMode="numeric"
          step={1}
          min={bounds.min}
          max={bounds.max}
          value={draftValue}
          onChange={(e) => onChange(e.target.value)}
          className="w-40"
          data-testid={`retention-${field}-input`}
          aria-invalid={!!error}
        />
        <span className="text-xs text-muted-foreground">
          Range {bounds.min}–{bounds.max} days. Current: {currentValue}. Default: {defaultValue}.
        </span>
      </div>
      {error && (
        <p className="text-xs text-destructive" data-testid={`retention-${field}-error`}>{error}</p>
      )}
    </div>
  );
}

const EXTREME_LOW_THRESHOLD = 0.1;
const EXTREME_HIGH_THRESHOLD = 0.9;

function isExtremeThreshold(value: number): boolean {
  return value < EXTREME_LOW_THRESHOLD || value > EXTREME_HIGH_THRESHOLD;
}

function describeExtreme(value: number): string {
  if (value <= 0) {
    return "A threshold of 0 will flag every post and comment, drowning moderators in noise.";
  }
  if (value >= 1) {
    return "A threshold of 1 effectively disables AI moderation — nothing will be auto-flagged for review.";
  }
  if (value < EXTREME_LOW_THRESHOLD) {
    return "Very low thresholds flag almost everything the classifier sees, which can overwhelm the moderation queue.";
  }
  return "Very high thresholds let almost everything through, so the AI classifier will rarely catch borderline content.";
}

function AiModerationThresholdConfigCard() {
  const { toast } = useToast();
  const [status, setStatus] = useState<AiModerationThresholdConfigStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<string>("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [preview, setPreview] = useState<AiModerationThresholdPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewReloadKey, setPreviewReloadKey] = useState(0);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingValue, setPendingValue] = useState<number | null>(null);

  const hydrate = (s: AiModerationThresholdConfigStatus) => {
    setStatus(s);
    setDraft(String(s.config.flagThreshold));
    setFieldError(null);
  };

  const load = async () => {
    try {
      setLoading(true);
      const data = await adminPanelApi.getAiModerationThresholdConfig();
      hydrate(data);
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  // Debounced preview: whenever the draft is a valid in-range number,
  // ask the server how many recent items would have been AI-flagged at
  // that value. Skip while we're still loading the base status.
  useEffect(() => {
    if (!status) return;
    const n = Number(draft);
    const { min, max } = status.bounds.flagThreshold;
    if (!Number.isFinite(n) || n < min || n > max) {
      setPreview(null);
      setPreviewError(null);
      setPreviewLoading(false);
      return;
    }
    let cancelled = false;
    setPreviewLoading(true);
    setPreviewError(null);
    const handle = window.setTimeout(async () => {
      try {
        const data = await adminPanelApi.getAiModerationThresholdPreview(n);
        if (!cancelled) setPreview(data);
      } catch (err: any) {
        if (!cancelled) setPreviewError(err?.message || "Failed to load preview");
      } finally {
        if (!cancelled) setPreviewLoading(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [draft, status, previewReloadKey]);

  const validateLocal = (): { ok: boolean; value: number } => {
    if (!status) return { ok: false, value: 0 };
    const n = Number(draft);
    if (!Number.isFinite(n)) {
      setFieldError("Must be a number between 0 and 1");
      return { ok: false, value: 0 };
    }
    const { min, max } = status.bounds.flagThreshold;
    if (n < min || n > max) {
      setFieldError(`Must be between ${min} and ${max}`);
      return { ok: false, value: n };
    }
    setFieldError(null);
    return { ok: true, value: n };
  };

  const isDirty = !!status && Number(draft) !== status.config.flagThreshold;
  const draftNum = Number(draft);
  const draftIsExtreme = Number.isFinite(draftNum) && isExtremeThreshold(draftNum);

  const persistValue = async (value: number) => {
    try {
      setSaving(true);
      const data = await adminPanelApi.updateAiModerationThresholdConfig({ flagThreshold: value });
      hydrate(data);
      toast({ title: data.changedFields.length === 0 ? "No changes to save" : "AI moderation threshold saved" });
    } catch (err: any) {
      if (err.fieldErrors && Array.isArray(err.fieldErrors)) {
        const ft = err.fieldErrors.find((e: any) => e.field === "flagThreshold");
        if (ft) setFieldError(ft.message);
      }
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async () => {
    if (!status) return;
    const v = validateLocal();
    if (!v.ok) {
      toast({ title: "Fix the highlighted field and try again", variant: "destructive" });
      return;
    }
    if (isExtremeThreshold(v.value)) {
      setPendingValue(v.value);
      setConfirmOpen(true);
      return;
    }
    await persistValue(v.value);
  };

  const handleConfirmSave = async () => {
    if (pendingValue === null) return;
    const value = pendingValue;
    setConfirmOpen(false);
    setPendingValue(null);
    await persistValue(value);
  };

  const handleResetDefaults = async () => {
    if (!status) return;
    if (status.sources.flagThreshold !== "db") {
      setDraft(String(status.defaults.flagThreshold));
      setFieldError(null);
      return;
    }
    try {
      setSaving(true);
      const data = await adminPanelApi.updateAiModerationThresholdConfig({ flagThreshold: null });
      hydrate(data);
      toast({ title: "Reset to default" });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <ShieldAlert className="w-4 h-4" /> AI moderation flag threshold
        </CardTitle>
        <p className="text-xs text-muted-foreground mt-1">
          The minimum AI classifier score (0–1) at which a post or comment gets sent to the moderation queue. Lower it to catch more borderline content; raise it to cut down on false positives. Takes effect on the next new post or comment — no redeploy needed.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading || !status ? (
          <div className="p-4 text-center text-sm text-muted-foreground">Loading threshold...</div>
        ) : (
          <>
            <div className="border rounded-md p-3 space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Flag threshold</p>
                  <p className="text-xs text-muted-foreground">Content is flagged when any classifier score (toxicity, spam, harassment, hate speech) exceeds this value.</p>
                </div>
                <span
                  className={`text-xs px-2 py-0.5 rounded ${
                    status.sources.flagThreshold === "db"
                      ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  {status.sources.flagThreshold === "db" ? "Customized" : "Using default"}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  inputMode="decimal"
                  step={0.05}
                  min={status.bounds.flagThreshold.min}
                  max={status.bounds.flagThreshold.max}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  className="w-40"
                  data-testid="ai-moderation-flag-threshold-input"
                  aria-invalid={!!fieldError}
                />
                <span className="text-xs text-muted-foreground">
                  Range {status.bounds.flagThreshold.min}–{status.bounds.flagThreshold.max}.
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                <span data-testid="ai-moderation-flag-threshold-current">
                  <span className="text-muted-foreground">Currently saved: </span>
                  <span className="font-semibold tabular-nums">{status.config.flagThreshold}</span>
                </span>
                <span data-testid="ai-moderation-flag-threshold-default">
                  <span className="text-muted-foreground">Shipped default: </span>
                  <span className="font-semibold tabular-nums">{status.defaults.flagThreshold}</span>
                </span>
              </div>
              {fieldError && (
                <p className="text-xs text-destructive" data-testid="ai-moderation-flag-threshold-error">{fieldError}</p>
              )}
              <div
                className="rounded-md border bg-muted/40 px-3 py-2 text-xs"
                data-testid="ai-moderation-flag-threshold-preview"
              >
                {previewError ? (
                  <div className="space-y-2">
                    <span className="block text-destructive">{previewError}</span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPreviewReloadKey((k) => k + 1)}
                      data-testid="ai-moderation-flag-threshold-preview-retry"
                    >
                      Retry
                    </Button>
                  </div>
                ) : previewLoading && !preview ? (
                  <span className="text-muted-foreground">Calculating preview…</span>
                ) : preview ? (
                  preview.sampleSize === 0 ? (
                    <span className="text-muted-foreground">
                      No moderation activity in the last {preview.sampleWindowDays} days to preview against.
                    </span>
                  ) : (
                    <>
                      <span>
                        At <span className="font-semibold tabular-nums">{preview.threshold}</span>,{" "}
                        <span className="font-semibold tabular-nums" data-testid="ai-moderation-flag-threshold-preview-would">
                          {preview.wouldBeFlaggedByAi}
                        </span>{" "}
                        of the last <span className="tabular-nums">{preview.sampleSize}</span> reviewed items would have been
                        AI-flagged (current threshold <span className="tabular-nums">{preview.currentThreshold}</span> flags{" "}
                        <span
                          className="font-semibold tabular-nums"
                          data-testid="ai-moderation-flag-threshold-preview-current"
                        >
                          {preview.currentlyFlaggedByAi}
                        </span>
                        ).
                      </span>
                      <span className="block text-muted-foreground mt-1">
                        Sample: moderation queue entries from the last {preview.sampleWindowDays} days. Wordlist hits are unaffected by this threshold.
                      </span>
                    </>
                  )
                ) : (
                  <span className="text-muted-foreground">Enter a value between {status.bounds.flagThreshold.min} and {status.bounds.flagThreshold.max} to preview impact.</span>
                )}
              </div>
              {draftIsExtreme && !fieldError && (
                <p
                  className="text-xs text-amber-700 dark:text-amber-400 flex items-start gap-1"
                  data-testid="ai-moderation-flag-threshold-extreme-warning"
                >
                  <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                  <span>{describeExtreme(draftNum)} You'll be asked to confirm before saving.</span>
                </p>
              )}
            </div>

            <div className="flex items-center justify-between border-t pt-4">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleResetDefaults}
                disabled={saving || status.sources.flagThreshold !== "db"}
                data-testid="ai-moderation-flag-threshold-reset"
              >
                <RotateCcw className="w-4 h-4 mr-1" /> Reset to default
              </Button>
              <Button
                onClick={handleSave}
                disabled={saving || !isDirty}
                data-testid="ai-moderation-flag-threshold-save"
              >
                <Save className="w-4 h-4 mr-1" /> {saving ? "Saving..." : "Save"}
              </Button>
            </div>
          </>
        )}
      </CardContent>
      <AlertDialog
        open={confirmOpen}
        onOpenChange={(open) => {
          setConfirmOpen(open);
          if (!open) setPendingValue(null);
        }}
      >
        <AlertDialogContent data-testid="ai-moderation-flag-threshold-confirm-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>Save an extreme threshold?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>
                  You're about to set the AI moderation flag threshold to{" "}
                  <span className="font-semibold tabular-nums">
                    {pendingValue ?? ""}
                  </span>
                  .
                </p>
                <p>{pendingValue !== null ? describeExtreme(pendingValue) : ""}</p>
                {preview && pendingValue !== null && preview.threshold === pendingValue && preview.sampleSize > 0 && (
                  <p className="text-muted-foreground">
                    Based on the last {preview.sampleWindowDays} days,{" "}
                    <span className="font-semibold tabular-nums">{preview.wouldBeFlaggedByAi}</span> of{" "}
                    <span className="tabular-nums">{preview.sampleSize}</span> reviewed items would have been AI-flagged
                    (vs <span className="tabular-nums">{preview.currentlyFlaggedByAi}</span> at the current threshold of{" "}
                    <span className="tabular-nums">{preview.currentThreshold}</span>).
                  </p>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="ai-moderation-flag-threshold-confirm-cancel">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmSave}
              data-testid="ai-moderation-flag-threshold-confirm-save"
            >
              Yes, save anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

function SettingRow({ setting, onSave, saving }: { setting: any; onSave: (key: string, value: any) => void; saving: boolean }) {
  const [value, setValue] = useState(typeof setting.value === "string" ? setting.value : JSON.stringify(setting.value));
  const [edited, setEdited] = useState(false);

  const handleChange = (v: string) => {
    setValue(v);
    setEdited(true);
  };

  const handleSave = () => {
    let parsedValue: any;
    try { parsedValue = JSON.parse(value); } catch { parsedValue = value; }
    onSave(setting.key, parsedValue);
    setEdited(false);
  };

  return (
    <div className="flex items-center gap-4 p-4">
      <div className="w-48 shrink-0">
        <p className="text-sm font-medium">{setting.key}</p>
        {setting.description && <p className="text-xs text-muted-foreground">{setting.description}</p>}
      </div>
      <Input value={value} onChange={(e) => handleChange(e.target.value)} className="flex-1" />
      <Button size="sm" onClick={handleSave} disabled={!edited || saving}>
        <Save className="w-4 h-4 mr-1" />{saving ? "Saving..." : "Save"}
      </Button>
    </div>
  );
}
