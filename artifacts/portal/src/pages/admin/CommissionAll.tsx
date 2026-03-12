import { useState, useEffect } from "react";
import { CommissionAdminLayout } from "@/components/layout/CommissionAdminLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Check, X, RotateCcw, MessageSquare, ChevronLeft, ChevronRight } from "lucide-react";
import { commissionAdminApi, type Commission } from "@/lib/commission-admin-api";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";

const STATUS_COLORS: Record<string, "default" | "secondary" | "warning" | "outline"> = {
  pending: "secondary",
  approved: "default",
  paid: "default",
  rejected: "warning",
  reversed: "outline",
  in_payout: "default",
};

export default function CommissionAll() {
  const [commissions, setCommissions] = useState<Commission[]>([]);
  const [pagination, setPagination] = useState({ page: 1, totalPages: 1, total: 0 });
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [loading, setLoading] = useState(true);
  const [actionDialog, setActionDialog] = useState<{ type: "reject" | "reverse" | "notes"; commission: Commission } | null>(null);
  const [reason, setReason] = useState("");
  const { toast } = useToast();

  const load = async (page = 1) => {
    try {
      setLoading(true);
      const data = await commissionAdminApi.getCommissions({
        page,
        status: statusFilter === "all" ? undefined : statusFilter,
      });
      setCommissions(data.commissions);
      setPagination(data.pagination);
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(1); }, [statusFilter]);

  const handleApprove = async (id: number) => {
    try {
      await commissionAdminApi.approveCommission(id);
      toast({ title: "Commission approved" });
      load(pagination.page);
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  };

  const handleReject = async () => {
    if (!actionDialog || actionDialog.type !== "reject") return;
    try {
      await commissionAdminApi.rejectCommission(actionDialog.commission.id, reason);
      toast({ title: "Commission rejected" });
      setActionDialog(null);
      setReason("");
      load(pagination.page);
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  };

  const handleReverse = async () => {
    if (!actionDialog || actionDialog.type !== "reverse") return;
    try {
      await commissionAdminApi.reverseCommission(actionDialog.commission.id, reason);
      toast({ title: "Commission reversed" });
      setActionDialog(null);
      setReason("");
      load(pagination.page);
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  };

  const formatCents = (cents: number) => `$${(cents / 100).toFixed(2)}`;

  return (
    <CommissionAdminLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">All Commissions</h1>
          <p className="text-muted-foreground mt-1">View and manage all commission records</p>
        </div>

        <div className="flex items-center gap-4">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-48">
              <SelectValue placeholder="Filter by status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="approved">Approved</SelectItem>
              <SelectItem value="paid">Paid</SelectItem>
              <SelectItem value="rejected">Rejected</SelectItem>
              <SelectItem value="reversed">Reversed</SelectItem>
              <SelectItem value="in_payout">In Payout</SelectItem>
            </SelectContent>
          </Select>
          <span className="text-sm text-muted-foreground">{pagination.total} total records</span>
        </div>

        {loading ? (
          <div className="text-center py-12 text-muted-foreground">Loading commissions...</div>
        ) : commissions.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              No commissions found.
            </CardContent>
          </Card>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-3 px-4 font-medium text-muted-foreground">Affiliate</th>
                    <th className="text-left py-3 px-4 font-medium text-muted-foreground">Customer</th>
                    <th className="text-left py-3 px-4 font-medium text-muted-foreground">Product</th>
                    <th className="text-right py-3 px-4 font-medium text-muted-foreground">Sale</th>
                    <th className="text-right py-3 px-4 font-medium text-muted-foreground">Commission</th>
                    <th className="text-center py-3 px-4 font-medium text-muted-foreground">Status</th>
                    <th className="text-left py-3 px-4 font-medium text-muted-foreground">Date</th>
                    <th className="text-right py-3 px-4 font-medium text-muted-foreground">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {commissions.map((c) => (
                    <tr key={c.id} className="border-b border-border/50 hover:bg-secondary/30">
                      <td className="py-3 px-4">
                        <div>
                          <p className="font-medium text-foreground">{c.affiliateName}</p>
                          <p className="text-xs text-muted-foreground">{c.affiliateEmail}</p>
                        </div>
                      </td>
                      <td className="py-3 px-4 text-muted-foreground">{c.customerEmail}</td>
                      <td className="py-3 px-4 text-muted-foreground">{c.productName}</td>
                      <td className="py-3 px-4 text-right font-medium">{formatCents(c.saleAmount)}</td>
                      <td className="py-3 px-4 text-right font-medium text-green-600">{formatCents(c.commissionAmount)}</td>
                      <td className="py-3 px-4 text-center">
                        <Badge variant={STATUS_COLORS[c.status] || "secondary"}>
                          {c.status}
                        </Badge>
                        {c.fraudFlag && (
                          <Badge variant="warning" className="ml-1 text-[10px]">Fraud</Badge>
                        )}
                      </td>
                      <td className="py-3 px-4 text-muted-foreground">
                        {format(new Date(c.createdAt), "MMM d, yyyy")}
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex items-center justify-end gap-1">
                          {c.status === "pending" && (
                            <>
                              <Button variant="ghost" size="sm" onClick={() => handleApprove(c.id)} title="Approve">
                                <Check className="w-4 h-4 text-green-600" />
                              </Button>
                              <Button variant="ghost" size="sm" onClick={() => { setActionDialog({ type: "reject", commission: c }); setReason(""); }} title="Reject">
                                <X className="w-4 h-4 text-red-600" />
                              </Button>
                            </>
                          )}
                          {(c.status === "pending" || c.status === "approved") && (
                            <Button variant="ghost" size="sm" onClick={() => { setActionDialog({ type: "reverse", commission: c }); setReason(""); }} title="Reverse">
                              <RotateCcw className="w-4 h-4 text-amber-600" />
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">
                Page {pagination.page} of {pagination.totalPages}
              </span>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={pagination.page <= 1}
                  onClick={() => load(pagination.page - 1)}
                >
                  <ChevronLeft className="w-4 h-4 mr-1" /> Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={pagination.page >= pagination.totalPages}
                  onClick={() => load(pagination.page + 1)}
                >
                  Next <ChevronRight className="w-4 h-4 ml-1" />
                </Button>
              </div>
            </div>
          </>
        )}
      </div>

      <Dialog open={!!actionDialog} onOpenChange={() => setActionDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {actionDialog?.type === "reject" ? "Reject Commission" : "Reverse Commission"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div>
              <Label>Reason</Label>
              <Textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={`Reason for ${actionDialog?.type === "reject" ? "rejection" : "reversal"}...`}
                rows={3}
              />
            </div>
            <Button
              className="w-full"
              variant="default"
              onClick={actionDialog?.type === "reject" ? handleReject : handleReverse}
            >
              {actionDialog?.type === "reject" ? "Reject Commission" : "Reverse Commission"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </CommissionAdminLayout>
  );
}
