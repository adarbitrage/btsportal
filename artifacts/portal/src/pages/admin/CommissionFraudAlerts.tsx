import { useState, useEffect } from "react";
import { CommissionAdminLayout } from "@/components/layout/CommissionAdminLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AlertTriangle, ShieldAlert, TrendingDown, X, Pause, Ban } from "lucide-react";
import { commissionAdminApi, type FraudAlerts } from "@/lib/commission-admin-api";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";

export default function CommissionFraudAlerts() {
  const [alerts, setAlerts] = useState<FraudAlerts | null>(null);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  const load = async () => {
    try {
      setLoading(true);
      const data = await commissionAdminApi.getFraudAlerts();
      setAlerts(data);
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleRejectCommission = async (id: number) => {
    try {
      await commissionAdminApi.rejectCommission(id, "Rejected due to fraud flag");
      toast({ title: "Commission rejected" });
      load();
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  };

  const handlePauseAffiliate = async (id: number) => {
    try {
      await commissionAdminApi.updateAffiliate(id, { status: "paused" });
      toast({ title: "Affiliate paused" });
      load();
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  };

  const handleDismissFraudFlag = async (id: number) => {
    try {
      await commissionAdminApi.updateAffiliate(id, { fraudFlag: false, fraudReason: "" });
      toast({ title: "Fraud flag dismissed" });
      load();
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  };

  const formatCents = (cents: number) => `$${(cents / 100).toFixed(2)}`;

  const totalAlerts = alerts
    ? alerts.flaggedCommissions.length + alerts.flaggedAffiliates.length + alerts.highClickLowConversion.length
    : 0;

  return (
    <CommissionAdminLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Fraud Alerts</h1>
          <p className="text-muted-foreground mt-1">
            Review suspicious activity and flagged affiliates
            {totalAlerts > 0 && <Badge variant="warning" className="ml-2">{totalAlerts} alert(s)</Badge>}
          </p>
        </div>

        {loading ? (
          <div className="text-center py-12 text-muted-foreground">Loading fraud alerts...</div>
        ) : !alerts ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              Failed to load fraud alerts.
            </CardContent>
          </Card>
        ) : totalAlerts === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              <ShieldAlert className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p>No fraud alerts at this time. All clear!</p>
            </CardContent>
          </Card>
        ) : (
          <Tabs defaultValue="commissions">
            <TabsList>
              <TabsTrigger value="commissions">
                Flagged Commissions ({alerts.flaggedCommissions.length})
              </TabsTrigger>
              <TabsTrigger value="affiliates">
                Flagged Affiliates ({alerts.flaggedAffiliates.length})
              </TabsTrigger>
              <TabsTrigger value="suspicious">
                Suspicious Patterns ({alerts.highClickLowConversion.length})
              </TabsTrigger>
            </TabsList>

            <TabsContent value="commissions" className="space-y-3 mt-4">
              {alerts.flaggedCommissions.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4">No flagged commissions.</p>
              ) : (
                alerts.flaggedCommissions.map((c) => (
                  <Card key={c.id}>
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <AlertTriangle className="w-4 h-4 text-amber-500" />
                            <span className="font-medium text-foreground">Commission #{c.id}</span>
                            <Badge variant="warning">{c.fraudFlag}</Badge>
                            <Badge variant="secondary">{c.status}</Badge>
                          </div>
                          <p className="text-sm text-muted-foreground">
                            Affiliate: {c.affiliateName} ({c.affiliateEmail})
                          </p>
                          <p className="text-sm text-muted-foreground">
                            Customer: {c.customerEmail} · Product: {c.productName} · {formatCents(c.commissionAmount)}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {format(new Date(c.createdAt), "MMM d, yyyy h:mm a")}
                          </p>
                        </div>
                        <div className="flex gap-1">
                          {c.status === "pending" && (
                            <Button variant="outline" size="sm" onClick={() => handleRejectCommission(c.id)}>
                              <Ban className="w-3.5 h-3.5 mr-1" /> Reject
                            </Button>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))
              )}
            </TabsContent>

            <TabsContent value="affiliates" className="space-y-3 mt-4">
              {alerts.flaggedAffiliates.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4">No flagged affiliates.</p>
              ) : (
                alerts.flaggedAffiliates.map((a) => (
                  <Card key={a.id}>
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <ShieldAlert className="w-4 h-4 text-red-500" />
                            <span className="font-medium text-foreground">{a.name}</span>
                            <Badge variant="warning">Flagged</Badge>
                          </div>
                          <p className="text-sm text-muted-foreground">{a.email} · Code: {a.affiliateCode}</p>
                          {a.fraudReason && (
                            <p className="text-sm text-red-600">Reason: {a.fraudReason}</p>
                          )}
                          <p className="text-sm text-muted-foreground">
                            Clicks: {a.lifetimeClicks} · Conversions: {a.lifetimeConversions}
                          </p>
                        </div>
                        <div className="flex gap-1">
                          <Button variant="outline" size="sm" onClick={() => handleDismissFraudFlag(a.id)}>
                            <X className="w-3.5 h-3.5 mr-1" /> Dismiss
                          </Button>
                          <Button variant="outline" size="sm" onClick={() => handlePauseAffiliate(a.id)}>
                            <Pause className="w-3.5 h-3.5 mr-1" /> Pause
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))
              )}
            </TabsContent>

            <TabsContent value="suspicious" className="space-y-3 mt-4">
              {alerts.highClickLowConversion.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4">No suspicious patterns detected.</p>
              ) : (
                alerts.highClickLowConversion.map((a) => (
                  <Card key={a.id}>
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <TrendingDown className="w-4 h-4 text-amber-500" />
                            <span className="font-medium text-foreground">{a.name}</span>
                            <Badge variant="outline">{a.tier} tier</Badge>
                          </div>
                          <p className="text-sm text-muted-foreground">{a.email} · Code: {a.affiliateCode}</p>
                          <p className="text-sm text-amber-600">
                            High clicks ({a.lifetimeClicks}) with low conversion rate ({a.conversionRate}%)
                          </p>
                          <p className="text-sm text-muted-foreground">
                            Conversions: {a.lifetimeConversions}
                          </p>
                        </div>
                        <div className="flex gap-1">
                          <Button variant="outline" size="sm" onClick={() => handlePauseAffiliate(a.id)}>
                            <Pause className="w-3.5 h-3.5 mr-1" /> Pause
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))
              )}
            </TabsContent>
          </Tabs>
        )}
      </div>
    </CommissionAdminLayout>
  );
}
