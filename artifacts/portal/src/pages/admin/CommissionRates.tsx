import { useState, useEffect } from "react";
import { CommissionAdminLayout } from "@/components/layout/CommissionAdminLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PlusCircle, Pencil, Trash2, Percent } from "lucide-react";
import { commissionAdminApi, type CommissionRate } from "@/lib/commission-admin-api";
import { useToast } from "@/hooks/use-toast";

const TIERS = ["entry", "mid", "premium", "top"];

export default function CommissionRates() {
  const [rates, setRates] = useState<CommissionRate[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<CommissionRate | null>(null);
  const [form, setForm] = useState({ tier: "entry", productId: "", ratePercent: "", flatBonus: "" });
  const { toast } = useToast();

  const load = async () => {
    try {
      setLoading(true);
      const data = await commissionAdminApi.getRates();
      setRates(data.rates);
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const openCreate = () => {
    setEditing(null);
    setForm({ tier: "entry", productId: "", ratePercent: "", flatBonus: "" });
    setDialogOpen(true);
  };

  const openEdit = (rate: CommissionRate) => {
    setEditing(rate);
    setForm({
      tier: rate.tier,
      productId: String(rate.productId),
      ratePercent: rate.ratePercent,
      flatBonus: String(rate.flatBonus || 0),
    });
    setDialogOpen(true);
  };

  const handleSubmit = async () => {
    const rateVal = parseFloat(form.ratePercent);
    const flatVal = parseInt(form.flatBonus) || 0;

    if (isNaN(rateVal) || rateVal < 0 || rateVal > 100) {
      toast({ title: "Invalid rate", description: "Rate must be between 0 and 100" });
      return;
    }
    if (flatVal < 0) {
      toast({ title: "Invalid bonus", description: "Flat bonus cannot be negative" });
      return;
    }

    try {
      if (editing) {
        await commissionAdminApi.updateRate(editing.id, {
          ratePercent: rateVal,
          flatBonus: flatVal,
        });
        toast({ title: "Rate updated" });
      } else {
        if (!form.productId || isNaN(parseInt(form.productId))) {
          toast({ title: "Error", description: "A valid Product ID is required" });
          return;
        }
        await commissionAdminApi.createRate({
          tier: form.tier,
          productId: parseInt(form.productId),
          ratePercent: rateVal,
          flatBonus: flatVal,
        });
        toast({ title: "Rate created" });
      }
      setDialogOpen(false);
      load();
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Delete this rate entry?")) return;
    try {
      await commissionAdminApi.deleteRate(id);
      toast({ title: "Rate deleted" });
      load();
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  };

  const groupedByTier = TIERS.map(tier => ({
    tier,
    rates: rates.filter(r => r.tier === tier),
  }));

  const TIER_LABELS: Record<string, string> = {
    entry: "Entry Tier",
    mid: "Mid Tier",
    premium: "Premium Tier",
    top: "Top Tier",
  };

  return (
    <CommissionAdminLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Commission Rates</h1>
            <p className="text-muted-foreground mt-1">Configure commission rates per tier and product</p>
          </div>
          <Button onClick={openCreate}>
            <PlusCircle className="w-4 h-4 mr-2" />
            Add Rate
          </Button>
        </div>

        {loading ? (
          <div className="text-center py-12 text-muted-foreground">Loading rates...</div>
        ) : rates.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              <Percent className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p>No commission rates configured. Add your first rate to get started.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-6">
            {groupedByTier.map(({ tier, rates: tierRates }) => (
              tierRates.length > 0 && (
                <Card key={tier}>
                  <CardContent className="p-6">
                    <h3 className="font-semibold text-foreground mb-4 capitalize">{TIER_LABELS[tier] || tier}</h3>
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border">
                          <th className="text-left py-2 px-3 font-medium text-muted-foreground">Product</th>
                          <th className="text-right py-2 px-3 font-medium text-muted-foreground">Rate %</th>
                          <th className="text-right py-2 px-3 font-medium text-muted-foreground">Flat Bonus</th>
                          <th className="text-right py-2 px-3 font-medium text-muted-foreground">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {tierRates.map((rate) => (
                          <tr key={rate.id} className="border-b border-border/50">
                            <td className="py-2 px-3 text-foreground">{rate.productName || `Product #${rate.productId}`}</td>
                            <td className="py-2 px-3 text-right font-medium">{rate.ratePercent}%</td>
                            <td className="py-2 px-3 text-right text-muted-foreground">
                              {rate.flatBonus ? `$${(rate.flatBonus / 100).toFixed(2)}` : "—"}
                            </td>
                            <td className="py-2 px-3">
                              <div className="flex items-center justify-end gap-1">
                                <Button variant="ghost" size="sm" onClick={() => openEdit(rate)}>
                                  <Pencil className="w-3.5 h-3.5" />
                                </Button>
                                <Button variant="ghost" size="sm" onClick={() => handleDelete(rate.id)}>
                                  <Trash2 className="w-3.5 h-3.5 text-destructive" />
                                </Button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </CardContent>
                </Card>
              )
            ))}
          </div>
        )}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Rate" : "Add Commission Rate"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            {!editing && (
              <>
                <div>
                  <Label>Tier</Label>
                  <Select value={form.tier} onValueChange={(v) => setForm(f => ({ ...f, tier: v }))}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TIERS.map(t => (
                        <SelectItem key={t} value={t}>{TIER_LABELS[t] || t}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Product ID</Label>
                  <Input
                    type="number"
                    value={form.productId}
                    onChange={(e) => setForm(f => ({ ...f, productId: e.target.value }))}
                    placeholder="Product ID"
                  />
                </div>
              </>
            )}
            <div>
              <Label>Rate Percent (%)</Label>
              <Input
                type="number"
                step="0.01"
                value={form.ratePercent}
                onChange={(e) => setForm(f => ({ ...f, ratePercent: e.target.value }))}
                placeholder="e.g. 20"
              />
            </div>
            <div>
              <Label>Flat Bonus (cents)</Label>
              <Input
                type="number"
                value={form.flatBonus}
                onChange={(e) => setForm(f => ({ ...f, flatBonus: e.target.value }))}
                placeholder="e.g. 500 = $5.00"
              />
            </div>
            <Button className="w-full" onClick={handleSubmit}>
              {editing ? "Update Rate" : "Create Rate"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </CommissionAdminLayout>
  );
}
