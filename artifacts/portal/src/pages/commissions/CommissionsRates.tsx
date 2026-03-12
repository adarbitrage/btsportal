import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowLeft, Lock, Crown } from "lucide-react";
import { Link } from "wouter";
import { useCommissionRates, useCommissionSummary } from "@/lib/commission-api";
import { cn } from "@/lib/utils";

const TIER_LABELS: Record<string, string> = {
  entry: "Entry",
  mid: "Mid",
  premium: "Premium",
  top: "Top",
};

const TIER_DESCRIPTIONS: Record<string, string> = {
  entry: "3-Month Mentorship",
  mid: "6-Month Mentorship",
  premium: "1-Year Mentorship",
  top: "Lifetime Mentorship",
};

const TIER_ORDER = ["entry", "mid", "premium", "top"];

export default function CommissionsRates() {
  const { data: rates, isLoading: ratesLoading, error: ratesError } = useCommissionRates();
  const { data: summary, isLoading: summaryLoading } = useCommissionSummary();

  const isLoading = ratesLoading || summaryLoading;

  if (isLoading) {
    return (
      <AppLayout>
        <div className="space-y-4">
          <div className="h-20 bg-card rounded-xl animate-pulse" />
          <div className="h-96 bg-card rounded-xl animate-pulse" />
        </div>
      </AppLayout>
    );
  }

  if (ratesError || !rates) {
    return (
      <AppLayout>
        <div className="text-center p-12 bg-white rounded-xl border border-border">
          <h2 className="text-xl font-semibold text-foreground">Could not load rate table</h2>
          <p className="text-muted-foreground mt-2">Please try refreshing the page.</p>
        </div>
      </AppLayout>
    );
  }

  const currentTier = summary?.tierSlug || "entry";
  const currentTierIndex = TIER_ORDER.indexOf(currentTier);

  return (
    <AppLayout>
      <div className="space-y-8">
        <div className="flex items-center gap-4">
          <Link href="/commissions">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to Commissions
            </Button>
          </Link>
        </div>

        <div className="bg-white rounded-2xl border border-border p-8 shadow-sm">
          <h1 className="text-3xl font-bold text-foreground mb-2">Commission Rate Table</h1>
          <p className="text-muted-foreground">
            Your commission rates based on your current tier. Higher tiers unlock better rates.
          </p>
        </div>

        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-[200px]">Product</TableHead>
                  {TIER_ORDER.map((tier, idx) => {
                    const isCurrentTier = tier === currentTier;
                    const isLocked = idx > currentTierIndex;
                    return (
                      <TableHead
                        key={tier}
                        className={cn(
                          "text-center min-w-[120px]",
                          isCurrentTier && "bg-primary/5",
                          isLocked && "opacity-50"
                        )}
                      >
                        <div className="flex flex-col items-center gap-1">
                          <div className="flex items-center gap-1">
                            {isCurrentTier && <Crown className="w-3 h-3 text-primary" />}
                            {isLocked && <Lock className="w-3 h-3" />}
                            <span className="font-semibold">{TIER_LABELS[tier]}</span>
                          </div>
                          <span className="text-[10px] text-muted-foreground font-normal">
                            {TIER_DESCRIPTIONS[tier]}
                          </span>
                          {isCurrentTier && (
                            <Badge className="text-[9px] px-1.5 py-0">Current</Badge>
                          )}
                        </div>
                      </TableHead>
                    );
                  })}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rates.map((rate) => (
                  <TableRow key={rate.productId}>
                    <TableCell className="font-medium">{rate.productName}</TableCell>
                    {TIER_ORDER.map((tier, idx) => {
                      const isCurrentTier = tier === currentTier;
                      const isLocked = idx > currentTierIndex;
                      const value = rate[tier as keyof typeof rate] as number | null;
                      return (
                        <TableCell
                          key={tier}
                          className={cn(
                            "text-center",
                            isCurrentTier && "bg-primary/5 font-bold text-primary",
                            isLocked && "opacity-40"
                          )}
                        >
                          {value !== null ? (
                            rate.rateType === "percentage" ? `${value}%` : `$${value}`
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                      );
                    })}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {currentTierIndex < TIER_ORDER.length - 1 && (
          <Card className="bg-gradient-to-r from-primary/5 to-primary/10 border-primary/20">
            <CardContent className="p-6 flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-foreground mb-1">
                  Upgrade to {TIER_LABELS[TIER_ORDER[currentTierIndex + 1]]} Tier
                </h3>
                <p className="text-sm text-muted-foreground">
                  Unlock higher commission rates and earn more on every referral.
                </p>
              </div>
              <Button>View Upgrade Options</Button>
            </CardContent>
          </Card>
        )}
      </div>
    </AppLayout>
  );
}
