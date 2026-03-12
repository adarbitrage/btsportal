import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DollarSign, TrendingUp, Clock, Wallet, Users, MousePointerClick, ArrowUpRight, ArrowDownRight } from "lucide-react";
import { useCommissionSummary } from "@/lib/commission-api";
import { ReferralLinksTab } from "@/components/commissions/ReferralLinksTab";
import { EarningsTab } from "@/components/commissions/EarningsTab";
import { PayoutsTab } from "@/components/commissions/PayoutsTab";
import { LeaderboardTab } from "@/components/commissions/LeaderboardTab";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";

export default function CommissionsDashboard() {
  const { data: summary, isLoading, error } = useCommissionSummary();

  if (isLoading) {
    return (
      <AppLayout>
        <div className="space-y-6">
          <div className="h-20 bg-card rounded-xl animate-pulse" />
          <div className="grid grid-cols-3 md:grid-cols-6 gap-4">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className="h-28 bg-card rounded-xl animate-pulse" />
            ))}
          </div>
          <div className="h-96 bg-card rounded-xl animate-pulse" />
        </div>
      </AppLayout>
    );
  }

  if (error || !summary) {
    return (
      <AppLayout>
        <div className="text-center p-12 bg-white rounded-xl border border-border">
          <h2 className="text-xl font-semibold text-foreground">Could not load commission data</h2>
          <p className="text-muted-foreground mt-2">Please try refreshing the page.</p>
        </div>
      </AppLayout>
    );
  }

  const changeIsPositive = summary.earningsThisMonthChange >= 0;

  return (
    <AppLayout>
      <div className="space-y-8">
        <div className="bg-white rounded-2xl border border-border p-8 shadow-sm flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <h1 className="text-3xl font-bold text-foreground">Commissions</h1>
              <Badge variant="outline" className="capitalize text-sm">
                {summary.tierLabel}
              </Badge>
            </div>
            <p className="text-muted-foreground">
              Track your referral earnings, manage links, and view performance.
            </p>
          </div>
          <div className="flex gap-3">
            <Link href="/commissions/rates">
              <Button variant="outline" size="sm">View Rate Table</Button>
            </Link>
            <Link href="/commissions/resources">
              <Button variant="outline" size="sm">Promo Resources</Button>
            </Link>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
          <StatCard
            icon={DollarSign}
            label="Earnings This Month"
            value={`$${summary.earningsThisMonth.toFixed(2)}`}
            change={summary.earningsThisMonthChange}
            changeIsPositive={changeIsPositive}
          />
          <StatCard
            icon={Clock}
            label="Pending"
            value={`$${summary.pendingAmount.toFixed(2)}`}
          />
          <StatCard
            icon={Wallet}
            label="Available for Payout"
            value={`$${summary.availableForPayout.toFixed(2)}`}
          />
          <StatCard
            icon={TrendingUp}
            label="Total Earned"
            value={`$${summary.totalEarnedAllTime.toFixed(2)}`}
          />
          <StatCard
            icon={Users}
            label="Total Referrals"
            value={summary.totalReferrals.toString()}
          />
          <StatCard
            icon={MousePointerClick}
            label="Clicks This Month"
            value={summary.totalClicksThisMonth.toString()}
          />
        </div>

        <Tabs defaultValue="referral-links" className="w-full">
          <TabsList className="w-full justify-start border-b bg-transparent p-0 h-auto rounded-none">
            <TabsTrigger
              value="referral-links"
              className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none px-6 py-3"
            >
              Referral Links
            </TabsTrigger>
            <TabsTrigger
              value="earnings"
              className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none px-6 py-3"
            >
              Earnings
            </TabsTrigger>
            <TabsTrigger
              value="payouts"
              className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none px-6 py-3"
            >
              Payouts
            </TabsTrigger>
            <TabsTrigger
              value="leaderboard"
              className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none px-6 py-3"
            >
              Leaderboard
            </TabsTrigger>
          </TabsList>
          <div className="mt-6">
            <TabsContent value="referral-links">
              <ReferralLinksTab />
            </TabsContent>
            <TabsContent value="earnings">
              <EarningsTab />
            </TabsContent>
            <TabsContent value="payouts">
              <PayoutsTab />
            </TabsContent>
            <TabsContent value="leaderboard">
              <LeaderboardTab />
            </TabsContent>
          </div>
        </Tabs>
      </div>
    </AppLayout>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  change,
  changeIsPositive,
}: {
  icon: typeof DollarSign;
  label: string;
  value: string;
  change?: number;
  changeIsPositive?: boolean;
}) {
  return (
    <Card className="border-t-4 border-t-primary rounded-t-sm">
      <CardContent className="p-4 text-center">
        <Icon className="w-5 h-5 text-muted-foreground mx-auto mb-2 opacity-80" />
        <p className="text-[9px] font-bold tracking-widest text-muted-foreground uppercase mb-1">
          {label}
        </p>
        <h3 className="text-xl font-bold text-primary mb-1">{value}</h3>
        {change !== undefined && (
          <div className="flex items-center justify-center gap-1">
            {changeIsPositive ? (
              <ArrowUpRight className="w-3 h-3 text-green-500" />
            ) : (
              <ArrowDownRight className="w-3 h-3 text-red-500" />
            )}
            <span
              className={`text-xs font-medium ${
                changeIsPositive ? "text-green-500" : "text-red-500"
              }`}
            >
              {Math.abs(change).toFixed(1)}%
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
