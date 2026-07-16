import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Gauge, Save } from "lucide-react";
import { fetchRateLimits, updateRateLimits } from "@/lib/admin-api";
import { useToast } from "@/hooks/use-toast";

const TIER_LABELS: Record<string, string> = {
  chat: "All members",
};

const TIER_DESCRIPTIONS: Record<string, string> = {
  chat: "One global limit — applies to every member with AI Assistant access",
};

interface RateLimitForm {
  tier: string;
  dailyLimit: number;
  maxOutputTokens: number;
}

export default function RateLimits() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [formData, setFormData] = useState<RateLimitForm[]>([]);
  const [hasChanges, setHasChanges] = useState(false);

  const { data: limits, isLoading } = useQuery({
    queryKey: ["admin-rate-limits"],
    queryFn: fetchRateLimits,
  });

  useEffect(() => {
    if (limits) {
      setFormData(limits.map((l: any) => ({
        tier: l.tier,
        dailyLimit: l.dailyLimit,
        maxOutputTokens: l.maxOutputTokens,
      })));
      setHasChanges(false);
    }
  }, [limits]);

  const updateMutation = useMutation({
    mutationFn: updateRateLimits,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-rate-limits"] });
      setHasChanges(false);
      toast({ title: "Rate limits updated successfully" });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to update", description: err.message, variant: "destructive" });
    },
  });

  const updateField = (tier: string, field: "dailyLimit" | "maxOutputTokens", value: number) => {
    setFormData(prev => prev.map(l =>
      l.tier === tier ? { ...l, [field]: value } : l
    ));
    setHasChanges(true);
  };

  const handleSave = () => {
    updateMutation.mutate(formData);
  };

  const estimateCost = (dailyLimit: number, maxOutputTokens: number) => {
    const avgInputTokens = 500;
    const inputCostPer1k = 0.003;
    const outputCostPer1k = 0.015;
    const costPerMessage = (avgInputTokens / 1000) * inputCostPer1k + (maxOutputTokens / 1000) * outputCostPer1k;
    return (costPerMessage * dailyLimit).toFixed(2);
  };

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Rate Limit Configuration</h1>
            <p className="text-muted-foreground mt-1">Configure the global daily message limit and max output tokens for the AI Assistant.</p>
          </div>
          {hasChanges && (
            <Button onClick={handleSave} disabled={updateMutation.isPending}>
              <Save className="w-4 h-4 mr-1" />
              {updateMutation.isPending ? "Saving..." : "Save Changes"}
            </Button>
          )}
        </div>

        {isLoading ? (
          <div className="text-center py-12 text-muted-foreground">Loading rate limits...</div>
        ) : (
          <div className="grid grid-cols-1 gap-6">
            {formData.map((limit) => (
              <Card key={limit.tier}>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Gauge className="w-5 h-5" />
                    {TIER_LABELS[limit.tier] || limit.tier}
                  </CardTitle>
                  <p className="text-sm text-muted-foreground">{TIER_DESCRIPTIONS[limit.tier]}</p>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div>
                      <label className="text-sm font-medium mb-1 block">Daily Message Limit</label>
                      <Input
                        type="number"
                        min={1}
                        value={limit.dailyLimit}
                        onChange={(e) => updateField(limit.tier, "dailyLimit", parseInt(e.target.value) || 1)}
                      />
                      <p className="text-xs text-muted-foreground mt-1">Messages per user per day</p>
                    </div>
                    <div>
                      <label className="text-sm font-medium mb-1 block">Max Output Tokens</label>
                      <Input
                        type="number"
                        min={100}
                        step={100}
                        value={limit.maxOutputTokens}
                        onChange={(e) => updateField(limit.tier, "maxOutputTokens", parseInt(e.target.value) || 100)}
                      />
                      <p className="text-xs text-muted-foreground mt-1">Max tokens per AI response</p>
                    </div>
                    <div>
                      <label className="text-sm font-medium mb-1 block">Est. Max Daily Cost / User</label>
                      <div className="h-10 flex items-center">
                        <span className="text-lg font-semibold">${estimateCost(limit.dailyLimit, limit.maxOutputTokens)}</span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">Based on avg 500 input tokens</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground">
              Changes take effect immediately for new messages. Users who have already sent messages today will see updated limits on their next message. Rate limits reset daily at midnight UTC.
            </p>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
