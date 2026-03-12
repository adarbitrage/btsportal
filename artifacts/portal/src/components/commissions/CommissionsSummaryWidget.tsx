import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DollarSign, Users, Wallet, ArrowRight } from "lucide-react";
import { Link } from "wouter";
import { useCommissionSummary } from "@/lib/commission-api";

export function CommissionsSummaryWidget() {
  const { data, isLoading, error } = useCommissionSummary();

  if (isLoading) {
    return (
      <Card className="animate-pulse">
        <CardContent className="p-6">
          <div className="h-32 bg-secondary rounded" />
        </CardContent>
      </Card>
    );
  }

  if (error || !data) return null;

  return (
    <Card>
      <CardHeader className="pb-4 border-b border-border/50">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-foreground font-semibold">
            <DollarSign className="w-5 h-5 text-primary" />
            Commission Summary
          </div>
          <Badge variant="outline" className="text-xs capitalize">
            {data.tierLabel}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="pt-4 space-y-4">
        <div className="grid grid-cols-3 gap-3">
          <div className="text-center p-3 bg-secondary/50 rounded-lg">
            <DollarSign className="w-4 h-4 text-green-500 mx-auto mb-1" />
            <p className="text-lg font-bold text-foreground">
              ${data.earningsThisMonth.toFixed(0)}
            </p>
            <p className="text-[10px] text-muted-foreground uppercase">This Month</p>
          </div>
          <div className="text-center p-3 bg-secondary/50 rounded-lg">
            <Users className="w-4 h-4 text-blue-500 mx-auto mb-1" />
            <p className="text-lg font-bold text-foreground">{data.totalReferrals}</p>
            <p className="text-[10px] text-muted-foreground uppercase">Referrals</p>
          </div>
          <div className="text-center p-3 bg-secondary/50 rounded-lg">
            <Wallet className="w-4 h-4 text-primary mx-auto mb-1" />
            <p className="text-lg font-bold text-foreground">
              ${data.availableForPayout.toFixed(0)}
            </p>
            <p className="text-[10px] text-muted-foreground uppercase">Available</p>
          </div>
        </div>
        <Link href="/commissions">
          <Button variant="ghost" className="w-full text-primary hover:text-primary/80">
            View Commission Dashboard
            <ArrowRight className="w-4 h-4 ml-2" />
          </Button>
        </Link>
      </CardContent>
    </Card>
  );
}
