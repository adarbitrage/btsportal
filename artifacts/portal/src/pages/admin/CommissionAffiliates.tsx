import { useState, useEffect } from "react";
import { CommissionAdminLayout } from "@/components/layout/CommissionAdminLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Pause, Play, Pencil, FileText, Users, Search } from "lucide-react";
import { commissionAdminApi, type Affiliate } from "@/lib/commission-admin-api";
import { useToast } from "@/hooks/use-toast";

export default function CommissionAffiliates() {
  const [affiliates, setAffiliates] = useState<Affiliate[]>([]);
  const [filtered, setFiltered] = useState<Affiliate[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [editDialog, setEditDialog] = useState<Affiliate | null>(null);
  const [editForm, setEditForm] = useState({ tier: "", status: "" });
  const [taxDialog, setTaxDialog] = useState<Affiliate | null>(null);
  const { toast } = useToast();

  const load = async () => {
    try {
      setLoading(true);
      const data = await commissionAdminApi.getAffiliates();
      setAffiliates(data.affiliates);
      setFiltered(data.affiliates);
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  useEffect(() => {
    if (!search.trim()) {
      setFiltered(affiliates);
    } else {
      const q = search.toLowerCase();
      setFiltered(affiliates.filter(a =>
        a.name.toLowerCase().includes(q) ||
        a.email.toLowerCase().includes(q) ||
        a.affiliateCode.toLowerCase().includes(q)
      ));
    }
  }, [search, affiliates]);

  const handleToggleStatus = async (aff: Affiliate) => {
    const newStatus = aff.status === "active" ? "paused" : "active";
    try {
      await commissionAdminApi.updateAffiliate(aff.id, { status: newStatus });
      toast({ title: `Affiliate ${newStatus === "active" ? "activated" : "paused"}` });
      load();
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  };

  const handleEditSave = async () => {
    if (!editDialog) return;
    try {
      await commissionAdminApi.updateAffiliate(editDialog.id, {
        tier: editForm.tier,
        status: editForm.status,
      });
      toast({ title: "Affiliate updated" });
      setEditDialog(null);
      load();
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  };

  const formatCents = (cents: number) => `$${(cents / 100).toFixed(2)}`;

  const TIER_COLORS: Record<string, string> = {
    entry: "bg-gray-100 text-gray-700",
    mid: "bg-blue-100 text-blue-700",
    premium: "bg-purple-100 text-purple-700",
    top: "bg-amber-100 text-amber-700",
  };

  return (
    <CommissionAdminLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Affiliates</h1>
          <p className="text-muted-foreground mt-1">Manage affiliate profiles and tiers</p>
        </div>

        <div className="flex items-center gap-4">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="Search affiliates..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <span className="text-sm text-muted-foreground">{filtered.length} affiliate(s)</span>
        </div>

        {loading ? (
          <div className="text-center py-12 text-muted-foreground">Loading affiliates...</div>
        ) : filtered.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              <Users className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p>No affiliates found.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-3 px-4 font-medium text-muted-foreground">Affiliate</th>
                  <th className="text-center py-3 px-4 font-medium text-muted-foreground">Tier</th>
                  <th className="text-right py-3 px-4 font-medium text-muted-foreground">Total Earned</th>
                  <th className="text-right py-3 px-4 font-medium text-muted-foreground">Pending</th>
                  <th className="text-right py-3 px-4 font-medium text-muted-foreground">Approved</th>
                  <th className="text-center py-3 px-4 font-medium text-muted-foreground">Status</th>
                  <th className="text-center py-3 px-4 font-medium text-muted-foreground">Tax Form</th>
                  <th className="text-right py-3 px-4 font-medium text-muted-foreground">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((aff) => (
                  <tr key={aff.id} className="border-b border-border/50 hover:bg-secondary/30">
                    <td className="py-3 px-4">
                      <div>
                        <p className="font-medium text-foreground">{aff.name}</p>
                        <p className="text-xs text-muted-foreground">{aff.email}</p>
                        <p className="text-xs text-muted-foreground">Code: {aff.affiliateCode}</p>
                      </div>
                    </td>
                    <td className="py-3 px-4 text-center">
                      <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${TIER_COLORS[aff.tier] || "bg-gray-100 text-gray-700"}`}>
                        {aff.tier}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right font-medium">{formatCents(aff.totalEarnings)}</td>
                    <td className="py-3 px-4 text-right text-muted-foreground">{formatCents(aff.pendingBalance)}</td>
                    <td className="py-3 px-4 text-right text-muted-foreground">{formatCents(aff.approvedBalance)}</td>
                    <td className="py-3 px-4 text-center">
                      <Badge variant={aff.status === "active" ? "default" : "secondary"}>
                        {aff.status}
                      </Badge>
                      {aff.fraudFlag && (
                        <Badge variant="warning" className="ml-1 text-[10px]">Flagged</Badge>
                      )}
                    </td>
                    <td className="py-3 px-4 text-center">
                      {aff.taxFormSubmitted ? (
                        <Button variant="ghost" size="sm" onClick={() => setTaxDialog(aff)} title="View tax form">
                          <FileText className="w-4 h-4 text-green-600" />
                        </Button>
                      ) : (
                        <span className="text-xs text-muted-foreground">Not submitted</span>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleToggleStatus(aff)}
                          title={aff.status === "active" ? "Pause" : "Unpause"}
                        >
                          {aff.status === "active" ? (
                            <Pause className="w-4 h-4 text-amber-600" />
                          ) : (
                            <Play className="w-4 h-4 text-green-600" />
                          )}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setEditDialog(aff);
                            setEditForm({ tier: aff.tier, status: aff.status });
                          }}
                          title="Edit"
                        >
                          <Pencil className="w-4 h-4" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Dialog open={!!editDialog} onOpenChange={() => setEditDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Affiliate</DialogTitle>
          </DialogHeader>
          {editDialog && (
            <div className="space-y-4 pt-2">
              <p className="text-sm text-muted-foreground">{editDialog.name} ({editDialog.email})</p>
              <div>
                <Label>Tier</Label>
                <Select value={editForm.tier} onValueChange={(v) => setEditForm(f => ({ ...f, tier: v }))}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="entry">Entry</SelectItem>
                    <SelectItem value="mid">Mid</SelectItem>
                    <SelectItem value="premium">Premium</SelectItem>
                    <SelectItem value="top">Top</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Status</Label>
                <Select value={editForm.status} onValueChange={(v) => setEditForm(f => ({ ...f, status: v }))}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="paused">Paused</SelectItem>
                    <SelectItem value="suspended">Suspended</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button className="w-full" onClick={handleEditSave}>Save Changes</Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!taxDialog} onOpenChange={() => setTaxDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Tax Form Status</DialogTitle>
          </DialogHeader>
          {taxDialog && (
            <div className="space-y-2 pt-2">
              <p className="text-sm"><strong>Affiliate:</strong> {taxDialog.name}</p>
              <p className="text-sm"><strong>Email:</strong> {taxDialog.email}</p>
              <p className="text-sm">
                <strong>Tax Form:</strong>{" "}
                <Badge variant="default">Submitted</Badge>
              </p>
              <p className="text-xs text-muted-foreground mt-2">
                Tax form was submitted by the affiliate. Review in your records.
              </p>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </CommissionAdminLayout>
  );
}
