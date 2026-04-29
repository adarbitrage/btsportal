import { useState, useEffect } from "react";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Settings, Save, Plus, Bell, Send, CheckCircle2, XCircle, AlertCircle } from "lucide-react";
import { adminPanelApi } from "@/lib/admin-panel-api";
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

function sourceLabel(source: "db" | "env" | null): string {
  if (source === "db") return "saved in admin";
  if (source === "env") return "from environment variable";
  return "not configured";
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

  useEffect(() => { load(); }, []);

  const saveField = async (
    field: "pagerdutyIntegrationKey" | "opsAlertEmail" | "opsAlertSlackWebhookUrl",
    value: string | null,
  ) => {
    try {
      setSavingField(field);
      await adminPanelApi.updateOnCallDestinations({ [field]: value });
      toast({ title: value === null ? "Destination cleared" : "Destination saved" });
      await load();
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setSavingField(null);
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
          </>
        )}
      </CardContent>
    </Card>
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
}: {
  configured: boolean;
  source: "db" | "env" | null;
  currentValue: string | null;
  value: string;
  onChange: (v: string) => void;
  saving: boolean;
  onSave: (v: string) => void;
  onClear?: () => void;
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
    </div>
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
