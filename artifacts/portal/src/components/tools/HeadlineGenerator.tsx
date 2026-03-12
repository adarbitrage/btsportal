import { useState, useEffect, useCallback } from "react";
import { authFetch } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sparkles, Copy, Heart, Check, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const STYLES = ["Direct Response", "Curiosity-Driven", "Benefit-Focused", "Question-Based", "Story-Based", "Urgency/Scarcity"];
const PLATFORMS = ["Facebook Ads", "Google Ads", "Native Ads", "Email Subject", "Landing Page", "YouTube", "TikTok"];
const TONES = ["Professional", "Conversational", "Bold & Aggressive", "Empathetic", "Humorous", "Authoritative"];

interface Props {
  tool: any;
  userId?: number;
  memberName?: string;
  entitlements?: string[];
}

export default function HeadlineGenerator({ tool }: Props) {
  const { toast } = useToast();

  const [productDescription, setProductDescription] = useState("");
  const [style, setStyle] = useState("Direct Response");
  const [platform, setPlatform] = useState("Facebook Ads");
  const [tone, setTone] = useState("Professional");
  const [count, setCount] = useState(5);
  const [headlines, setHeadlines] = useState<string[]>([]);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [savedIndexes, setSavedIndexes] = useState<Set<number>>(new Set());
  const [remainingToday, setRemainingToday] = useState<number | null>(null);
  const [dailyLimit, setDailyLimit] = useState<number | null>(null);
  const [generating, setGenerating] = useState(false);
  const [savedFavorites, setSavedFavorites] = useState<string[]>([]);

  const loadFavorites = useCallback(async () => {
    try {
      const res = await authFetch(`/tools/${tool.id}/data`);
      if (res.ok) {
        const items = await res.json();
        const fav = items.find((d: any) => d.dataKey === "favorites");
        if (fav?.dataValue?.headlines) setSavedFavorites(fav.dataValue.headlines);
      }
    } catch {}
  }, [tool.id]);

  useEffect(() => { loadFavorites(); }, [loadFavorites]);

  const handleGenerate = async () => {
    if (!productDescription.trim()) {
      toast({ title: "Please enter a product description" });
      return;
    }
    setGenerating(true);
    try {
      const res = await authFetch("/tools/headline-generator/generate", {
        method: "POST",
        body: JSON.stringify({ productDescription, style, platform, tone, count }),
      });
      if (res.status === 429) {
        toast({ title: "Daily limit reached", description: "Your generation limit resets at midnight." });
        return;
      }
      if (!res.ok) throw new Error("Generation failed");
      const result = await res.json();
      setHeadlines(result.headlines);
      setRemainingToday(result.remainingToday);
      setDailyLimit(result.dailyLimit);
      setSavedIndexes(new Set());
    } catch {
      toast({ title: "Generation failed", description: "Please try again." });
    } finally {
      setGenerating(false);
    }
  };

  const handleCopy = async (headline: string, index: number) => {
    await navigator.clipboard.writeText(headline);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 2000);
    toast({ title: "Copied to clipboard" });
  };

  const handleSaveToFavorites = async (headline: string, index: number) => {
    const updated = [...savedFavorites, headline];
    try {
      const res = await authFetch(`/tools/${tool.id}/data`, {
        method: "POST",
        body: JSON.stringify({ dataKey: "favorites", dataValue: { headlines: updated } }),
      });
      if (!res.ok) throw new Error("Save failed");
      setSavedFavorites(updated);
      setSavedIndexes((prev) => new Set(prev).add(index));
      toast({ title: "Saved to favorites" });
    } catch {
      toast({ title: "Failed to save" });
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="border-b border-border/50">
          <CardTitle className="text-base flex items-center justify-between">
            <span>Generate Headlines</span>
            {remainingToday !== null && dailyLimit !== null && (
              <Badge variant={remainingToday === 0 ? "secondary" : "outline"} className="text-xs">
                {remainingToday}/{dailyLimit} remaining today
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-6 space-y-4">
          <div>
            <label className="text-sm font-medium text-foreground block mb-1.5">
              Product/Offer Description *
            </label>
            <textarea
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[80px] resize-y"
              placeholder="Describe your product, offer, or niche... (e.g., 'A $47 e-book teaching beginners how to start affiliate marketing with Facebook ads')"
              value={productDescription}
              onChange={(e) => setProductDescription(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <label className="text-sm font-medium text-foreground block mb-1.5">Style</label>
              <select
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={style}
                onChange={(e) => setStyle(e.target.value)}
              >
                {STYLES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-sm font-medium text-foreground block mb-1.5">Platform</label>
              <select
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={platform}
                onChange={(e) => setPlatform(e.target.value)}
              >
                {PLATFORMS.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-sm font-medium text-foreground block mb-1.5">Tone</label>
              <select
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={tone}
                onChange={(e) => setTone(e.target.value)}
              >
                {TONES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-sm font-medium text-foreground block mb-1.5">Count</label>
              <select
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={count}
                onChange={(e) => setCount(parseInt(e.target.value))}
              >
                {[3, 5, 7, 10].map((c) => (
                  <option key={c} value={c}>{c} headlines</option>
                ))}
              </select>
            </div>
          </div>

          <Button
            onClick={handleGenerate}
            disabled={generating || !productDescription.trim()}
            className="w-full sm:w-auto"
          >
            {generating ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Generating...
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4 mr-2" />
                Generate Headlines
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {headlines.length > 0 && (
        <Card>
          <CardHeader className="border-b border-border/50">
            <CardTitle className="text-base">Generated Headlines</CardTitle>
          </CardHeader>
          <CardContent className="pt-4">
            <div className="space-y-2">
              {headlines.map((headline, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between gap-3 p-3 rounded-lg border border-border/50 hover:bg-secondary/30 transition-colors group"
                >
                  <p className="text-sm flex-1">{headline}</p>
                  <div className="flex gap-1 shrink-0">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0"
                      onClick={() => handleCopy(headline, i)}
                    >
                      {copiedIndex === i ? (
                        <Check className="w-3.5 h-3.5 text-green-500" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0"
                      onClick={() => handleSaveToFavorites(headline, i)}
                      disabled={savedIndexes.has(i)}
                    >
                      <Heart
                        className={`w-3.5 h-3.5 ${savedIndexes.has(i) ? "fill-red-500 text-red-500" : ""}`}
                      />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {savedFavorites.length > 0 && (
        <Card>
          <CardHeader className="border-b border-border/50">
            <CardTitle className="text-base flex items-center gap-2">
              <Heart className="w-4 h-4 text-red-500 fill-red-500" />
              Saved Favorites ({savedFavorites.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-4">
            <div className="space-y-2">
              {savedFavorites.map((headline, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between gap-3 p-3 rounded-lg bg-secondary/30 border border-border/30"
                >
                  <p className="text-sm flex-1">{headline}</p>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0"
                    onClick={() => handleCopy(headline, -1)}
                  >
                    <Copy className="w-3.5 h-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
