import { useState, useEffect } from "react";
import { CommissionAdminLayout } from "@/components/layout/CommissionAdminLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DollarSign, Users, TrendingUp, Clock, Play, Wallet, Download, CalendarDays } from "lucide-react";
import { commissionAdminApi } from "@/lib/commission-admin-api";
import { useToast } from "@/hooks/use-toast";

export default function CommissionOverview() {
  const [stats, setStats] = useState<{
    totalCommissions: number;
    totalSales: number;
    activeAffiliates: number;
    pending: number;
    approved: number;
    paid: number;
    rejected: number;
    reversed: number;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const { toast } = useToast();

  const load = async () => {
    try {
      setLoading(true);
      const [affData, ...statusResults] = await Promise.all([
        commissionAdminApi.getAffiliates(),
        commissionAdminApi.getCommissions({ page: 1 }),
        commissionAdminApi.getCommissions({ page: 1, status: "pending" }),
        commissionAdminApi.getCommissions({ page: 1, status: "approved" }),
        commissionAdminApi.getCommissions({ page: 1, status: "paid" }),
        commissionAdminApi.getCommissions({ page: 1, status: "rejected" }),
        commissionAdminApi.getCommissions({ page: 1, status: "reversed" }),
      ]);

      const [allData, pendingData, approvedData, paidData, rejectedData, reversedData] = statusResults;
      const totalSales = allData.commissions.reduce((s, c) => s + c.saleAmount, 0);
      const activeAffiliates = affData.affiliates.filter(a => a.status === "active").length;

      setStats({
        totalCommissions: allData.pagination.total,
        totalSales,
        activeAffiliates,
        pending: pendingData.pagination.total,
        approved: approvedData.pagination.total,
        paid: paidData.pagination.total,
        rejected: rejectedData.pagination.total,
        reversed: reversedData.pagination.total,
      });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleRunApproval = async () => {
    setActionLoading("approval");
    try {
      const result = await commissionAdminApi.runApproval();
      toast({ title: "Approval Job Complete", description: `${result.approved} commission(s) auto-approved` });
      load();
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setActionLoading(null);
    }
  };

  const handleGeneratePayouts = async () => {
    setActionLoading("payouts");
    try {
      const result = await commissionAdminApi.generatePayouts();
      toast({ title: "Payouts Generated", description: `${result.payoutsGenerated} payout(s) created` });
      load();
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setActionLoading(null);
    }
  };

  const handleExportCsv = async () => {
    setActionLoading("export");
    try {
      await commissionAdminApi.exportCsv();
      toast({ title: "CSV Exported" });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setActionLoading(null);
    }
  };

  const nextPayoutDate = (() => {
    const now = new Date();
    const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    return next.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  })();

  const statCards = stats ? [
    { label: "Total Commissions", value: stats.totalCommissions, icon: DollarSign, color: "text-blue-600" },
    { label: "Total Sales Volume", value: `$${(stats.totalSales / 100).toLocaleString()}`, icon: TrendingUp, color: "text-green-600" },
    { label: "Active Affiliates", value: stats.activeAffiliates, icon: Users, color: "text-purple-600" },
    { label: "Pending Approval", value: stats.pending, icon: Clock, color: "text-amber-600" },
  ] : [];

  return (
    <CommissionAdminLayout>
      <div className="space-y-8">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Commission Overview</h1>
          <p className="text-muted-foreground mt-1">Manage affiliate commissions and payouts</p>
        </div>

        {loading ? (
          <div className="text-center py-12 text-muted-foreground">Loading overview...</div>
        ) : stats && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {statCards.map((card) => (
                <Card key={card.label}>
                  <CardContent className="p-6">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm text-muted-foreground">{card.label}</span>
                      <card.icon className={`w-5 h-5 ${card.color}`} />
                    </div>
                    <p className="text-2xl font-bold text-foreground">{card.value}</p>
                  </CardContent>
                </Card>
              ))}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card>
                <CardContent className="p-6">
                  <h3 className="font-semibold text-foreground mb-4">Status Breakdown</h3>
                  <div className="space-y-3">
                    {[
                      { label: "Pending", value: stats.pending, variant: "secondary" as const },
                      { label: "Approved", value: stats.approved, variant: "default" as const },
                      { label: "Paid", value: stats.paid, variant: "default" as const },
                      { label: "Rejected", value: stats.rejected, variant: "warning" as const },
                      { label: "Reversed", value: stats.reversed, variant: "outline" as const },
                    ].map((item) => (
                      <div key={item.label} className="flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">{item.label}</span>
                        <Badge variant={item.variant}>{item.value}</Badge>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="p-6">
                  <h3 className="font-semibold text-foreground mb-4">Quick Actions</h3>
                  <div className="space-y-3">
                    <Button
                      className="w-full justify-start"
                      variant="outline"
                      onClick={handleRunApproval}
                      disabled={actionLoading === "approval"}
                    >
                      <Play className="w-4 h-4 mr-2" />
                      {actionLoading === "approval" ? "Running..." : "Run Approval Job"}
                    </Button>
                    <Button
                      className="w-full justify-start"
                      variant="outline"
                      onClick={handleGeneratePayouts}
                      disabled={actionLoading === "payouts"}
                    >
                      <Wallet className="w-4 h-4 mr-2" />
                      {actionLoading === "payouts" ? "Generating..." : "Generate Payouts"}
                    </Button>
                    <Button
                      className="w-full justify-start"
                      variant="outline"
                      onClick={handleExportCsv}
                      disabled={actionLoading === "export"}
                    >
                      <Download className="w-4 h-4 mr-2" />
                      {actionLoading === "export" ? "Exporting..." : "Export CSV"}
                    </Button>
                  </div>
                  <div className="mt-4 pt-4 border-t border-border">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <CalendarDays className="w-4 h-4" />
                      <span>Next payout run: <strong className="text-foreground">{nextPayoutDate}</strong></span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </>
        )}
      </div>
    </CommissionAdminLayout>
  );
}
