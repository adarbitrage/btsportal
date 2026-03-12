import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Settings, Save, Plus, Trash2, Key, MapPin, Shield, Tag } from "lucide-react";
import { fetchGhlConfig, updateGhlConfig } from "@/lib/admin-api";
import { useToast } from "@/hooks/use-toast";

interface MappingEntry {
  key: string;
  value: string;
}

function MappingEditor({
  label,
  description,
  keyLabel,
  valueLabel,
  entries,
  onChange,
}: {
  label: string;
  description: string;
  keyLabel: string;
  valueLabel: string;
  entries: MappingEntry[];
  onChange: (entries: MappingEntry[]) => void;
}) {
  const addEntry = () => onChange([...entries, { key: "", value: "" }]);
  const removeEntry = (index: number) => onChange(entries.filter((_, i) => i !== index));
  const updateEntry = (index: number, field: "key" | "value", val: string) => {
    const updated = [...entries];
    updated[index] = { ...updated[index], [field]: val };
    onChange(updated);
  };

  return (
    <div className="space-y-3">
      <div>
        <Label className="text-sm font-medium">{label}</Label>
        <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
      </div>
      {entries.map((entry, i) => (
        <div key={i} className="flex gap-2 items-center">
          <Input
            placeholder={keyLabel}
            value={entry.key}
            onChange={(e) => updateEntry(i, "key", e.target.value)}
            className="flex-1"
          />
          <Input
            placeholder={valueLabel}
            value={entry.value}
            onChange={(e) => updateEntry(i, "value", e.target.value)}
            className="flex-1"
          />
          <Button variant="ghost" size="sm" onClick={() => removeEntry(i)}>
            <Trash2 className="w-4 h-4 text-red-500" />
          </Button>
        </div>
      ))}
      <Button variant="outline" size="sm" onClick={addEntry}>
        <Plus className="w-3.5 h-3.5 mr-1" />
        Add Entry
      </Button>
    </div>
  );
}

function objectToEntries(obj: Record<string, string> | null | undefined): MappingEntry[] {
  if (!obj || typeof obj !== "object") return [];
  return Object.entries(obj).map(([key, value]) => ({ key, value: String(value) }));
}

function entriesToObject(entries: MappingEntry[]): Record<string, string> {
  const obj: Record<string, string> = {};
  for (const e of entries) {
    if (e.key.trim()) obj[e.key.trim()] = e.value;
  }
  return obj;
}

export default function GhlConfig() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: config, isLoading } = useQuery({
    queryKey: ["ghl-config"],
    queryFn: fetchGhlConfig,
  });

  const [apiKey, setApiKey] = useState("");
  const [locationId, setLocationId] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [tagPrefix, setTagPrefix] = useState("BTS:");
  const [syncEnabled, setSyncEnabled] = useState(false);
  const [pipelineEntries, setPipelineEntries] = useState<MappingEntry[]>([]);
  const [fieldEntries, setFieldEntries] = useState<MappingEntry[]>([]);

  useEffect(() => {
    if (config) {
      setApiKey(config.apiKey || "");
      setLocationId(config.locationId || "");
      setWebhookSecret(config.webhookSecret || "");
      setTagPrefix(config.tagPrefix || "BTS:");
      setSyncEnabled(config.syncEnabled || false);
      setPipelineEntries(objectToEntries(config.pipelineStageMapping));
      setFieldEntries(objectToEntries(config.customFieldMapping));
    }
  }, [config]);

  const saveMutation = useMutation({
    mutationFn: updateGhlConfig,
    onSuccess: () => {
      toast({ title: "Configuration saved" });
      queryClient.invalidateQueries({ queryKey: ["ghl-config"] });
      queryClient.invalidateQueries({ queryKey: ["ghl-status"] });
    },
    onError: (err: Error) => {
      toast({ title: "Save failed", description: err.message, variant: "destructive" });
    },
  });

  const handleSave = () => {
    saveMutation.mutate({
      apiKey,
      locationId,
      webhookSecret,
      tagPrefix,
      syncEnabled,
      pipelineStageMapping: entriesToObject(pipelineEntries),
      customFieldMapping: entriesToObject(fieldEntries),
    });
  };

  if (isLoading) {
    return (
      <AppLayout>
        <div className="text-center py-16 text-muted-foreground">Loading configuration...</div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="space-y-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">GHL Configuration</h1>
            <p className="text-muted-foreground mt-1">Configure GoHighLevel API connection and sync settings.</p>
          </div>
          <Button onClick={handleSave} disabled={saveMutation.isPending}>
            <Save className="w-4 h-4 mr-2" />
            {saveMutation.isPending ? "Saving..." : "Save Changes"}
          </Button>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Settings className="w-5 h-5" />
              Global Settings
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex items-center justify-between p-4 bg-secondary/30 rounded-lg border">
              <div>
                <Label className="text-sm font-medium">Sync Enabled</Label>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Master kill switch for all GHL sync operations. Disabling stops all outbound syncs.
                </p>
              </div>
              <Switch checked={syncEnabled} onCheckedChange={setSyncEnabled} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Key className="w-5 h-5" />
              API Connection
            </CardTitle>
            <CardDescription>
              GoHighLevel API credentials for authentication.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="apiKey">API Key</Label>
              <Input
                id="apiKey"
                type="password"
                placeholder="Enter GHL API key..."
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="locationId" className="flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5" />
                Location ID
              </Label>
              <Input
                id="locationId"
                placeholder="Enter GHL Location ID..."
                value={locationId}
                onChange={(e) => setLocationId(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="webhookSecret" className="flex items-center gap-1.5">
                <Shield className="w-3.5 h-3.5" />
                Webhook Secret
              </Label>
              <Input
                id="webhookSecret"
                type="password"
                placeholder="Enter webhook verification secret..."
                value={webhookSecret}
                onChange={(e) => setWebhookSecret(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="tagPrefix" className="flex items-center gap-1.5">
                <Tag className="w-3.5 h-3.5" />
                Tag Prefix
              </Label>
              <Input
                id="tagPrefix"
                placeholder="e.g., BTS:"
                value={tagPrefix}
                onChange={(e) => setTagPrefix(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">Prefix added to tags synced to GHL contacts (e.g., "BTS:Diamond")</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Pipeline & Stage Mapping</CardTitle>
            <CardDescription>
              Map portal products/tiers to GHL pipeline stages. Keys are portal product slugs, values are GHL stage IDs.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <MappingEditor
              label="Pipeline Stage Mappings"
              description="Map product slugs to GHL pipeline stage IDs."
              keyLabel="Product slug (e.g., diamond)"
              valueLabel="GHL stage ID"
              entries={pipelineEntries}
              onChange={setPipelineEntries}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Custom Field Mapping</CardTitle>
            <CardDescription>
              Map portal user fields to GHL custom field keys. Keys are portal field names, values are GHL custom field IDs.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <MappingEditor
              label="Custom Field Mappings"
              description="Map portal fields to GHL custom field keys."
              keyLabel="Portal field (e.g., timezone)"
              valueLabel="GHL field key"
              entries={fieldEntries}
              onChange={setFieldEntries}
            />
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
