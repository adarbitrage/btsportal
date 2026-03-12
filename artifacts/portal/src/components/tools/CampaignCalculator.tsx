import { useState } from "react";
import { authFetch } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { TrendingUp, TrendingDown, Minus, Brain, Loader2, Download, Save } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface Props {
  tool: any;
  userId?: number;
  memberName?: string;
  entitlements?: string[];
}

export default function CampaignCalculator({ tool, entitlements = [] }: Props) {
  const { toast } = useToast();
  const hasExpanded = entitlements.includes("software:expanded");

  const [dailyBudget, setDailyBudget] = useState(50);
  const [cpc, setCpc] = useState(0.5);
  const [landingPageCtr, setLandingPageCtr] = useState(15);
  const [offerPayout, setOfferPayout] = useState(30);
  const [conversionRate, setConversionRate] = useState(3);
  const [aiAnalysis, setAiAnalysis] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [saving, setSaving] = useState(false);

  const dailyClicks = cpc > 0 ? Math.round(dailyBudget / cpc) : 0;
  const dailyLeads = Math.round(dailyClicks * (landingPageCtr / 100));
  const dailyConversions = dailyLeads * (conversionRate / 100);
  const dailyRevenue = dailyConversions * offerPayout;
  const dailyProfit = dailyRevenue - dailyBudget;
  const roi = dailyBudget > 0 ? ((dailyProfit / dailyBudget) * 100) : 0;

  const breakevenCtr = cpc > 0 && conversionRate > 0 && offerPayout > 0
    ? (100 / ((offerPayout * conversionRate / 100) / cpc)) : 0;
  const breakevenConvRate = landingPageCtr > 0 && offerPayout > 0
    ? (100 * cpc / (offerPayout * (landingPageCtr / 100))) : 0;
  const breakevenPayout = dailyClicks > 0 && landingPageCtr > 0 && conversionRate > 0
    ? (dailyBudget / (dailyClicks * (landingPageCtr / 100) * (conversionRate / 100))) : 0;

  const monthlyProfit = dailyProfit * 30;
  const monthlyRevenue = dailyRevenue * 30;
  const monthlySpend = dailyBudget * 30;

  const isProfitable = dailyProfit > 0;
  const isBreakeven = Math.abs(dailyProfit) < 0.01;

  const handleAnalyze = async () => {
    setAnalyzing(true);
    try {
      const res = await authFetch("/tools/campaign-calculator/analyze", {
        method: "POST",
        body: JSON.stringify({
          dailyBudget, cpc, landingPageCtr, offerPayout, conversionRate,
          dailyClicks, dailyLeads, dailyConversions, dailyRevenue, dailyProfit,
        }),
      });
      if (res.status === 429) {
        toast({ title: "Daily analysis limit reached" });
        return;
      }
      if (res.status === 403) {
        toast({ title: "Expanded tier required for AI analysis" });
        return;
      }
      if (!res.ok) throw new Error("Analysis failed");
      const result = await res.json();
      setAiAnalysis(result.analysis);
    } catch {
      toast({ title: "Analysis failed" });
    } finally {
      setAnalyzing(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await authFetch(`/tools/${tool.id}/data`, {
        method: "POST",
        body: JSON.stringify({
          dataKey: `calculation-${Date.now()}`,
          dataValue: {
            inputs: { dailyBudget, cpc, landingPageCtr, offerPayout, conversionRate },
            results: { dailyClicks, dailyLeads, dailyConversions, dailyRevenue, dailyProfit, roi },
            savedAt: new Date().toISOString(),
          },
        }),
      });
      if (!res.ok) throw new Error("Save failed");
      toast({ title: "Calculation saved" });
    } catch {
      toast({ title: "Failed to save" });
    } finally {
      setSaving(false);
    }
  };

  const handleExport = () => {
    const csv = [
      "Metric,Value",
      `Daily Budget,$${dailyBudget}`,
      `CPC,$${cpc}`,
      `Landing Page CTR,${landingPageCtr}%`,
      `Offer Payout,$${offerPayout}`,
      `Conversion Rate,${conversionRate}%`,
      `Daily Clicks,${dailyClicks}`,
      `Daily Leads,${dailyLeads}`,
      `Daily Conversions,${dailyConversions.toFixed(1)}`,
      `Daily Revenue,$${dailyRevenue.toFixed(2)}`,
      `Daily Profit,$${dailyProfit.toFixed(2)}`,
      `ROI,${roi.toFixed(1)}%`,
      `Monthly Revenue,$${monthlyRevenue.toFixed(2)}`,
      `Monthly Profit,$${monthlyProfit.toFixed(2)}`,
    ].join("\n");

    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "campaign-calculator.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="border-b border-border/50">
          <CardTitle className="text-base">Campaign Inputs</CardTitle>
        </CardHeader>
        <CardContent className="pt-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            <NumberInput label="Daily Budget ($)" value={dailyBudget} onChange={setDailyBudget} min={1} step={10} />
            <NumberInput label="Cost Per Click ($)" value={cpc} onChange={setCpc} min={0.01} step={0.05} />
            <NumberInput label="Landing Page CTR (%)" value={landingPageCtr} onChange={setLandingPageCtr} min={0.1} step={1} />
            <NumberInput label="Offer Payout ($)" value={offerPayout} onChange={setOfferPayout} min={1} step={5} />
            <NumberInput label="Conversion Rate (%)" value={conversionRate} onChange={setConversionRate} min={0.1} step={0.5} />
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <MetricCard label="Daily Clicks" value={dailyClicks.toString()} />
        <MetricCard label="Daily Leads" value={dailyLeads.toString()} />
        <MetricCard label="Daily Conversions" value={dailyConversions.toFixed(1)} />
        <MetricCard label="Daily Revenue" value={`$${dailyRevenue.toFixed(2)}`} />
        <MetricCard
          label="Daily Profit"
          value={`$${dailyProfit.toFixed(2)}`}
          color={isProfitable ? "text-green-600" : isBreakeven ? "text-yellow-600" : "text-red-600"}
          icon={isProfitable ? TrendingUp : isBreakeven ? Minus : TrendingDown}
        />
        <MetricCard
          label="ROI"
          value={`${roi.toFixed(1)}%`}
          color={isProfitable ? "text-green-600" : isBreakeven ? "text-yellow-600" : "text-red-600"}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader className="border-b border-border/50">
            <CardTitle className="text-base">Breakeven Analysis</CardTitle>
          </CardHeader>
          <CardContent className="pt-4 space-y-3">
            <div className="flex justify-between items-center py-2 border-b border-border/30">
              <span className="text-sm text-muted-foreground">Breakeven LP CTR</span>
              <span className="text-sm font-semibold">{breakevenCtr.toFixed(1)}%</span>
            </div>
            <div className="flex justify-between items-center py-2 border-b border-border/30">
              <span className="text-sm text-muted-foreground">Breakeven Conv. Rate</span>
              <span className="text-sm font-semibold">{breakevenConvRate.toFixed(2)}%</span>
            </div>
            <div className="flex justify-between items-center py-2">
              <span className="text-sm text-muted-foreground">Breakeven Payout</span>
              <span className="text-sm font-semibold">${breakevenPayout.toFixed(2)}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="border-b border-border/50">
            <CardTitle className="text-base">Monthly Projections</CardTitle>
          </CardHeader>
          <CardContent className="pt-4 space-y-3">
            <div className="flex justify-between items-center py-2 border-b border-border/30">
              <span className="text-sm text-muted-foreground">Monthly Ad Spend</span>
              <span className="text-sm font-semibold">${monthlySpend.toFixed(2)}</span>
            </div>
            <div className="flex justify-between items-center py-2 border-b border-border/30">
              <span className="text-sm text-muted-foreground">Monthly Revenue</span>
              <span className="text-sm font-semibold">${monthlyRevenue.toFixed(2)}</span>
            </div>
            <div className="flex justify-between items-center py-2">
              <span className="text-sm text-muted-foreground">Monthly Profit</span>
              <span className={`text-sm font-bold ${monthlyProfit >= 0 ? "text-green-600" : "text-red-600"}`}>
                ${monthlyProfit.toFixed(2)}
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="flex gap-3 flex-wrap">
        {hasExpanded ? (
          <Button onClick={handleAnalyze} disabled={analyzing} variant="outline">
            {analyzing ? (
              <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Analyzing...</>
            ) : (
              <><Brain className="w-4 h-4 mr-2" />AI Analysis</>
            )}
          </Button>
        ) : (
          <Button variant="outline" disabled>
            <Brain className="w-4 h-4 mr-2" />
            AI Analysis (Expanded Tier)
          </Button>
        )}
        <Button variant="outline" onClick={handleSave} disabled={saving}>
          <Save className="w-4 h-4 mr-2" />Save
        </Button>
        <Button variant="outline" onClick={handleExport}>
          <Download className="w-4 h-4 mr-2" />Export CSV
        </Button>
      </div>

      {aiAnalysis && (
        <Card>
          <CardHeader className="border-b border-border/50">
            <CardTitle className="text-base flex items-center gap-2">
              <Brain className="w-4 h-4 text-primary" />
              AI Campaign Analysis
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-4">
            <div className="prose prose-sm max-w-none text-foreground whitespace-pre-wrap">
              {aiAnalysis}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function NumberInput({
  label, value, onChange, min, step,
}: {
  label: string; value: number; onChange: (v: number) => void; min: number; step: number;
}) {
  return (
    <div>
      <label className="text-sm font-medium text-foreground block mb-1.5">{label}</label>
      <input
        type="number"
        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
        min={min}
        step={step}
      />
    </div>
  );
}

function MetricCard({
  label, value, color, icon: Icon,
}: {
  label: string; value: string; color?: string; icon?: any;
}) {
  return (
    <Card>
      <CardContent className="p-4 text-center">
        <p className="text-[10px] font-bold tracking-widest text-muted-foreground uppercase mb-1">{label}</p>
        <div className="flex items-center justify-center gap-1">
          {Icon && <Icon className={`w-4 h-4 ${color || ""}`} />}
          <p className={`text-xl font-bold ${color || "text-foreground"}`}>{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}
