import { useState, useMemo, useEffect, useCallback } from "react";
import { authFetch } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Copy, Check, Save, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const TRAFFIC_SOURCES = [
  { name: "Custom", utm_source: "", utm_medium: "", utm_campaign: "", utm_content: "", utm_term: "", macros: "" },
  { name: "Facebook Ads", utm_source: "facebook", utm_medium: "cpc", utm_campaign: "{{campaign.name}}", utm_content: "{{ad.name}}", utm_term: "{{adset.name}}", macros: "fbclid={{fbclid}}" },
  { name: "Google Ads", utm_source: "google", utm_medium: "cpc", utm_campaign: "{campaignid}", utm_content: "{creative}", utm_term: "{keyword}", macros: "gclid={gclid}&matchtype={matchtype}&network={network}" },
  { name: "TikTok Ads", utm_source: "tiktok", utm_medium: "cpc", utm_campaign: "__CAMPAIGN_NAME__", utm_content: "__AID_NAME__", utm_term: "", macros: "ttclid=__CLICKID__" },
  { name: "Native Ads (Taboola)", utm_source: "taboola", utm_medium: "native", utm_campaign: "{campaign_name}", utm_content: "{title}", utm_term: "{site}", macros: "click_id={click_id}" },
  { name: "Native Ads (Outbrain)", utm_source: "outbrain", utm_medium: "native", utm_campaign: "$campaign_name$", utm_content: "$title$", utm_term: "$publisher_name$", macros: "ob_click_id=$ob_click_id$" },
  { name: "Email", utm_source: "email", utm_medium: "email", utm_campaign: "", utm_content: "", utm_term: "", macros: "" },
  { name: "YouTube Ads", utm_source: "youtube", utm_medium: "video", utm_campaign: "{campaignid}", utm_content: "{creative}", utm_term: "", macros: "" },
];

interface Props {
  tool: any;
  userId?: number;
  memberName?: string;
  entitlements?: string[];
}

export default function TrackingUrlBuilder({ tool }: Props) {
  const { toast } = useToast();

  const [baseUrl, setBaseUrl] = useState("https://");
  const [selectedSource, setSelectedSource] = useState("Custom");
  const [utmSource, setUtmSource] = useState("");
  const [utmMedium, setUtmMedium] = useState("");
  const [utmCampaign, setUtmCampaign] = useState("");
  const [utmContent, setUtmContent] = useState("");
  const [utmTerm, setUtmTerm] = useState("");
  const [extraParams, setExtraParams] = useState("");
  const [affiliateNetwork, setAffiliateNetwork] = useState("");
  const [affiliateId, setAffiliateId] = useState("");
  const [copied, setCopied] = useState(false);
  const [savedUrls, setSavedUrls] = useState<{ name: string; url: string }[]>([]);

  const loadSavedUrls = useCallback(async () => {
    try {
      const res = await authFetch(`/tools/${tool.id}/data`);
      if (res.ok) {
        const items = await res.json();
        const urlsItem = items.find((d: any) => d.dataKey === "saved-urls");
        if (urlsItem?.dataValue?.urls) setSavedUrls(urlsItem.dataValue.urls);
      }
    } catch {}
  }, [tool.id]);

  useEffect(() => { loadSavedUrls(); }, [loadSavedUrls]);

  const handleSourceChange = (sourceName: string) => {
    setSelectedSource(sourceName);
    const source = TRAFFIC_SOURCES.find((s) => s.name === sourceName);
    if (source) {
      setUtmSource(source.utm_source);
      setUtmMedium(source.utm_medium);
      setUtmCampaign(source.utm_campaign);
      setUtmContent(source.utm_content);
      setUtmTerm(source.utm_term);
      setExtraParams(source.macros);
    }
  };

  const generatedUrl = useMemo(() => {
    if (!baseUrl || baseUrl === "https://") return "";
    try {
      const url = new URL(baseUrl);
      if (utmSource) url.searchParams.set("utm_source", utmSource);
      if (utmMedium) url.searchParams.set("utm_medium", utmMedium);
      if (utmCampaign) url.searchParams.set("utm_campaign", utmCampaign);
      if (utmContent) url.searchParams.set("utm_content", utmContent);
      if (utmTerm) url.searchParams.set("utm_term", utmTerm);
      if (affiliateNetwork) url.searchParams.set("aff_network", affiliateNetwork);
      if (affiliateId) url.searchParams.set("aff_id", affiliateId);
      let result = url.toString();
      if (extraParams) {
        result += (result.includes("?") ? "&" : "?") + extraParams;
      }
      return result;
    } catch {
      return "";
    }
  }, [baseUrl, utmSource, utmMedium, utmCampaign, utmContent, utmTerm, extraParams, affiliateNetwork, affiliateId]);

  const handleCopy = async () => {
    if (!generatedUrl) return;
    await navigator.clipboard.writeText(generatedUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast({ title: "URL copied to clipboard" });
  };

  const handleSave = async () => {
    if (!generatedUrl) return;
    const name = `${selectedSource} - ${utmCampaign || "Untitled"}`;
    const updated = [...savedUrls, { name, url: generatedUrl }];
    try {
      const res = await authFetch(`/tools/${tool.id}/data`, {
        method: "POST",
        body: JSON.stringify({ dataKey: "saved-urls", dataValue: { urls: updated } }),
      });
      if (!res.ok) throw new Error("Save failed");
      setSavedUrls(updated);
      toast({ title: "URL saved to library" });
    } catch {
      toast({ title: "Failed to save" });
    }
  };

  const handleDeleteSaved = async (index: number) => {
    const updated = savedUrls.filter((_, i) => i !== index);
    try {
      const res = await authFetch(`/tools/${tool.id}/data`, {
        method: "POST",
        body: JSON.stringify({ dataKey: "saved-urls", dataValue: { urls: updated } }),
      });
      if (!res.ok) throw new Error("Delete failed");
      setSavedUrls(updated);
      toast({ title: "URL removed" });
    } catch {
      toast({ title: "Failed to remove" });
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="border-b border-border/50">
          <CardTitle className="text-base">Build Tracking URL</CardTitle>
        </CardHeader>
        <CardContent className="pt-6 space-y-4">
          <div>
            <label className="text-sm font-medium text-foreground block mb-1.5">Base URL *</label>
            <Input
              placeholder="https://your-landing-page.com/offer"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
            />
          </div>

          <div>
            <label className="text-sm font-medium text-foreground block mb-1.5">Traffic Source Preset</label>
            <select
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={selectedSource}
              onChange={(e) => handleSourceChange(e.target.value)}
            >
              {TRAFFIC_SOURCES.map((s) => (
                <option key={s.name} value={s.name}>{s.name}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">utm_source</label>
              <Input value={utmSource} onChange={(e) => setUtmSource(e.target.value)} placeholder="e.g., facebook" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">utm_medium</label>
              <Input value={utmMedium} onChange={(e) => setUtmMedium(e.target.value)} placeholder="e.g., cpc" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">utm_campaign</label>
              <Input value={utmCampaign} onChange={(e) => setUtmCampaign(e.target.value)} placeholder="e.g., spring-sale" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">utm_content</label>
              <Input value={utmContent} onChange={(e) => setUtmContent(e.target.value)} placeholder="e.g., headline-v2" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">utm_term</label>
              <Input value={utmTerm} onChange={(e) => setUtmTerm(e.target.value)} placeholder="e.g., affiliate marketing" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Extra Params/Macros</label>
              <Input value={extraParams} onChange={(e) => setExtraParams(e.target.value)} placeholder="e.g., click_id={click_id}" />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Affiliate Network</label>
              <Input value={affiliateNetwork} onChange={(e) => setAffiliateNetwork(e.target.value)} placeholder="e.g., MaxBounty" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Affiliate ID</label>
              <Input value={affiliateId} onChange={(e) => setAffiliateId(e.target.value)} placeholder="e.g., 12345" />
            </div>
          </div>
        </CardContent>
      </Card>

      {generatedUrl && (
        <Card>
          <CardHeader className="border-b border-border/50">
            <CardTitle className="text-base">Generated URL</CardTitle>
          </CardHeader>
          <CardContent className="pt-4">
            <div className="bg-secondary/50 rounded-lg p-4 break-all">
              <code className="text-sm text-foreground">{generatedUrl}</code>
            </div>
            <div className="flex gap-2 mt-4">
              <Button onClick={handleCopy} variant="default">
                {copied ? <Check className="w-4 h-4 mr-2" /> : <Copy className="w-4 h-4 mr-2" />}
                {copied ? "Copied!" : "Copy URL"}
              </Button>
              <Button onClick={handleSave} variant="outline">
                <Save className="w-4 h-4 mr-2" />
                Save to Library
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {savedUrls.length > 0 && (
        <Card>
          <CardHeader className="border-b border-border/50">
            <CardTitle className="text-base">
              Saved URLs ({savedUrls.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-4">
            <div className="space-y-3">
              {savedUrls.map((item, i) => (
                <div key={i} className="flex items-start justify-between gap-3 p-3 rounded-lg bg-secondary/30 border border-border/30">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{item.name}</p>
                    <p className="text-xs text-muted-foreground truncate mt-0.5">{item.url}</p>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0"
                      onClick={async () => {
                        await navigator.clipboard.writeText(item.url);
                        toast({ title: "Copied" });
                      }}
                    >
                      <Copy className="w-3.5 h-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0 text-destructive"
                      onClick={() => handleDeleteSaved(i)}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
