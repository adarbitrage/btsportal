import { useState } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Separator } from "@/components/ui/separator";
import { CreditCard, Calendar, Upload, CheckCircle2, Clock, XCircle, AlertCircle } from "lucide-react";
import { usePayoutInfo, useUpdatePayoutSettings } from "@/lib/commission-api";
import { useToast } from "@/hooks/use-toast";

const payoutStatusConfig: Record<string, { icon: typeof Clock; className: string; label: string }> = {
  processing: { icon: Clock, className: "text-amber-500", label: "Processing" },
  completed: { icon: CheckCircle2, className: "text-green-500", label: "Completed" },
  failed: { icon: XCircle, className: "text-red-500", label: "Failed" },
};

export function PayoutsTab() {
  const { data, isLoading } = usePayoutInfo();
  const updateSettings = useUpdatePayoutSettings();
  const { toast } = useToast();

  const [paypalEmail, setPaypalEmail] = useState("");
  const [threshold, setThreshold] = useState("");
  const [taxFormType, setTaxFormType] = useState("");
  const [settingsLoaded, setSettingsLoaded] = useState(false);

  if (!settingsLoaded && data) {
    setPaypalEmail(data.paypalEmail || "");
    setThreshold(data.payoutThreshold?.toString() || "50");
    setTaxFormType(data.taxFormType || "");
    setSettingsLoaded(true);
  }

  if (isLoading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-32 bg-card rounded-xl animate-pulse" />
        ))}
      </div>
    );
  }

  const handleSaveSettings = async () => {
    try {
      await updateSettings.mutateAsync({
        paypalEmail,
        payoutThreshold: parseFloat(threshold) || 50,
        taxFormType: taxFormType || undefined,
      });
      toast({ title: "Saved!", description: "Your payout settings have been updated." });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardContent className="p-6 flex items-center gap-4">
            <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
              <CreditCard className="w-6 h-6 text-primary" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">
                Current Payout Method
              </p>
              <p className="text-lg font-bold text-foreground capitalize">
                {data?.currentMethod || "Not Set"}
              </p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6 flex items-center gap-4">
            <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
              <Calendar className="w-6 h-6 text-primary" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">
                Next Payout Date
              </p>
              <p className="text-lg font-bold text-foreground">
                {data?.nextPayoutDate
                  ? new Date(data.nextPayoutDate).toLocaleDateString("en-US", {
                      month: "long",
                      day: "numeric",
                      year: "numeric",
                    })
                  : "TBD"}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {data?.history && data.history.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <p className="text-sm font-semibold text-muted-foreground">Payout History</p>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-center">Commissions</TableHead>
                  <TableHead>Method</TableHead>
                  <TableHead className="text-center">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.history.map((payout) => {
                  const status = payoutStatusConfig[payout.status] || payoutStatusConfig.processing;
                  const StatusIcon = status.icon;
                  return (
                    <TableRow key={payout.id}>
                      <TableCell className="text-sm">
                        {new Date(payout.date).toLocaleDateString()}
                      </TableCell>
                      <TableCell className="text-sm text-right font-medium">
                        ${payout.amount.toFixed(2)}
                      </TableCell>
                      <TableCell className="text-sm text-center">{payout.commissionCount}</TableCell>
                      <TableCell className="text-sm capitalize">{payout.method}</TableCell>
                      <TableCell className="text-center">
                        <div className="flex items-center justify-center gap-1">
                          <StatusIcon className={`w-4 h-4 ${status.className}`} />
                          <span className={`text-xs ${status.className}`}>{status.label}</span>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2">
          <p className="text-sm font-semibold text-muted-foreground">Payout Settings</p>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="paypal-email">PayPal Email</Label>
            <Input
              id="paypal-email"
              type="email"
              value={paypalEmail}
              onChange={(e) => setPaypalEmail(e.target.value)}
              placeholder="your-email@example.com"
            />
            <p className="text-xs text-muted-foreground">
              Payouts will be sent to this PayPal address.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="threshold">Minimum Payout Threshold</Label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
              <Input
                id="threshold"
                type="number"
                min="10"
                step="5"
                value={threshold}
                onChange={(e) => setThreshold(e.target.value)}
                className="pl-7"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              You will receive a payout once your balance exceeds this amount.
            </p>
          </div>

          <Separator />

          <div className="space-y-2">
            <Label>Tax Form</Label>
            <div className="flex items-center gap-4">
              <Select value={taxFormType} onValueChange={setTaxFormType}>
                <SelectTrigger className="w-48">
                  <SelectValue placeholder="Select form type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="w9">W-9 (US Resident)</SelectItem>
                  <SelectItem value="w8ben">W-8BEN (Non-US)</SelectItem>
                </SelectContent>
              </Select>
              {data?.taxFormSubmitted ? (
                <Badge className="bg-green-50 text-green-700 border-green-200">
                  <CheckCircle2 className="w-3 h-3 mr-1" /> Submitted
                </Badge>
              ) : (
                <Badge variant="outline" className="text-amber-600 border-amber-200">
                  <AlertCircle className="w-3 h-3 mr-1" /> Not Submitted
                </Badge>
              )}
            </div>
            <div className="mt-3">
              <Button variant="outline" size="sm" className="text-sm">
                <Upload className="w-4 h-4 mr-2" />
                Upload Tax Form
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              A valid tax form is required before payouts can be processed.
            </p>
          </div>

          <Button onClick={handleSaveSettings} disabled={updateSettings.isPending}>
            {updateSettings.isPending ? "Saving..." : "Save Settings"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
