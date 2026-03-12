import { useState, useEffect } from "react";
import { CommissionAdminLayout } from "@/components/layout/CommissionAdminLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Check, Wallet, ExternalLink } from "lucide-react";
import { commissionAdminApi, type CommissionPayout } from "@/lib/commission-admin-api";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";

const STATUS_COLORS: Record<string, "default" | "secondary" | "warning" | "outline"> = {
  pending: "secondary",
  processing: "default",
  paid: "default",
  failed: "warning",
};

export default function CommissionPayouts() {
  const [payouts, setPayouts] = useState<CommissionPayout[]>([]);
  const [loading, setLoading] = useState(true);
  const [markPaidDialog, setMarkPaidDialog] = useState<CommissionPayout | null>(null);
  const [txId, setTxId] = useState("");
  const [notes, setNotes] = useState("");
  const { toast } = useToast();

  const load = async () => {
    try {
      setLoading(true);
      const data = await commissionAdminApi.getPayouts();
      setPayouts(data.payouts);
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleMarkPaid = async () => {
    if (!markPaidDialog) return;
    try {
      await commissionAdminApi.markPayoutPaid(markPaidDialog.id, txId, notes || undefined);
      toast({ title: "Payout marked as paid" });
      setMarkPaidDialog(null);
      setTxId("");
      setNotes("");
      load();
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  };

  const formatCents = (cents: number) => `$${(cents / 100).toFixed(2)}`;

  return (
    <CommissionAdminLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Payouts</h1>
          <p className="text-muted-foreground mt-1">Manage payout batches and track payment status</p>
        </div>

        {loading ? (
          <div className="text-center py-12 text-muted-foreground">Loading payouts...</div>
        ) : payouts.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              <Wallet className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p>No payouts generated yet. Use the Overview page to generate payouts.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {payouts.map((payout) => (
              <Card key={payout.id}>
                <CardContent className="p-6">
                  <div className="flex items-start justify-between">
                    <div className="space-y-1">
                      <div className="flex items-center gap-3">
                        <h3 className="font-semibold text-foreground">Payout #{payout.id}</h3>
                        <Badge variant={STATUS_COLORS[payout.status] || "secondary"}>
                          {payout.status}
                        </Badge>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {payout.affiliateName} ({payout.affiliateEmail})
                      </p>
                      <div className="flex items-center gap-4 text-sm text-muted-foreground mt-2">
                        <span>Amount: <strong className="text-foreground">{formatCents(payout.amount)}</strong></span>
                        <span>{payout.commissionCount} commission(s)</span>
                        <span>Generated: {format(new Date(payout.generatedAt), "MMM d, yyyy")}</span>
                      </div>
                      {payout.paypalEmail && (
                        <p className="text-sm text-muted-foreground">PayPal: {payout.paypalEmail}</p>
                      )}
                      {payout.paypalTransactionId && (
                        <p className="text-sm text-muted-foreground flex items-center gap-1">
                          <ExternalLink className="w-3 h-3" />
                          TX: {payout.paypalTransactionId}
                        </p>
                      )}
                      {payout.paidAt && (
                        <p className="text-sm text-green-600">
                          Paid: {format(new Date(payout.paidAt), "MMM d, yyyy h:mm a")}
                        </p>
                      )}
                      {payout.notes && (
                        <p className="text-sm text-muted-foreground italic">Notes: {payout.notes}</p>
                      )}
                    </div>
                    <div className="flex gap-2">
                      {payout.status === "pending" && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => { setMarkPaidDialog(payout); setTxId(""); setNotes(""); }}
                        >
                          <Check className="w-4 h-4 mr-1" /> Mark Paid
                        </Button>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      <Dialog open={!!markPaidDialog} onOpenChange={() => setMarkPaidDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mark Payout as Paid</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            {markPaidDialog && (
              <p className="text-sm text-muted-foreground">
                Payout #{markPaidDialog.id} — {formatCents(markPaidDialog.amount)} to {markPaidDialog.affiliateName}
              </p>
            )}
            <div>
              <Label>PayPal Transaction ID</Label>
              <Input
                value={txId}
                onChange={(e) => setTxId(e.target.value)}
                placeholder="e.g. 7XJ12345ABC"
              />
            </div>
            <div>
              <Label>Notes (optional)</Label>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Any additional notes..."
                rows={2}
              />
            </div>
            <Button className="w-full" onClick={handleMarkPaid}>
              Confirm Payment
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </CommissionAdminLayout>
  );
}
