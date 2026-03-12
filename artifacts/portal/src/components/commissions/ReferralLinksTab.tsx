import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Copy, Check, Pencil, Lock, MousePointerClick, ShoppingCart, DollarSign, TrendingUp } from "lucide-react";
import { useAffiliateProfile, useReferralLinks, useUpdateVanityCode, useCheckVanityCode } from "@/lib/commission-api";
import { useToast } from "@/hooks/use-toast";

export function ReferralLinksTab() {
  const { data: profile, isLoading: profileLoading } = useAffiliateProfile();
  const { data: links, isLoading: linksLoading } = useReferralLinks();
  const updateVanityCode = useUpdateVanityCode();
  const checkVanityCode = useCheckVanityCode();
  const { toast } = useToast();

  const [showCodeModal, setShowCodeModal] = useState(false);
  const [vanityCode, setVanityCode] = useState("");
  const [codeAvailable, setCodeAvailable] = useState<boolean | null>(null);
  const [copiedId, setCopiedId] = useState<number | null>(null);

  const isLoading = profileLoading || linksLoading;

  if (isLoading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-32 bg-card rounded-xl animate-pulse" />
        ))}
      </div>
    );
  }

  const accessibleLinks = links?.filter((l) => l.isAccessible) ?? [];
  const lockedLinks = links?.filter((l) => !l.isAccessible) ?? [];

  const handleCopy = async (text: string, id: number) => {
    await navigator.clipboard.writeText(text);
    setCopiedId(id);
    toast({ title: "Copied!", description: "Referral link copied to clipboard." });
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleCheckCode = async (code: string) => {
    if (code.length < 3) {
      setCodeAvailable(null);
      return;
    }
    try {
      const result = await checkVanityCode.mutateAsync(code);
      setCodeAvailable(result.available);
    } catch {
      setCodeAvailable(null);
    }
  };

  const handleSaveCode = async () => {
    try {
      await updateVanityCode.mutateAsync(vanityCode);
      toast({ title: "Updated!", description: "Your vanity code has been updated." });
      setShowCodeModal(false);
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  };

  const displayCode = profile?.customCode || profile?.affiliateCode || "---";

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
                Your Affiliate Code
              </p>
              <p className="text-2xl font-bold text-foreground font-mono">{displayCode}</p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setVanityCode(profile?.customCode || "");
                setCodeAvailable(null);
                setShowCodeModal(true);
              }}
            >
              <Pencil className="w-4 h-4 mr-2" />
              Edit Code
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-4">
        {accessibleLinks.map((link) => (
          <Card key={link.id} className="hover:shadow-md transition-shadow">
            <CardContent className="p-6">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h3 className="font-semibold text-foreground">{link.productName}</h3>
                  <p className="text-xs text-muted-foreground font-mono mt-1 truncate max-w-md">
                    {link.linkUrl}
                  </p>
                </div>
                <Button
                  variant={copiedId === link.id ? "default" : "outline"}
                  size="sm"
                  onClick={() => handleCopy(link.linkUrl, link.id)}
                >
                  {copiedId === link.id ? (
                    <Check className="w-4 h-4 mr-1" />
                  ) : (
                    <Copy className="w-4 h-4 mr-1" />
                  )}
                  {copiedId === link.id ? "Copied" : "Copy Link"}
                </Button>
              </div>

              <div className="grid grid-cols-4 gap-4">
                <MiniStat
                  icon={MousePointerClick}
                  label="Clicks (30d)"
                  value={link.clickCount.toString()}
                />
                <MiniStat
                  icon={ShoppingCart}
                  label="Sales (30d)"
                  value={link.salesCount.toString()}
                />
                <MiniStat
                  icon={DollarSign}
                  label="Revenue (30d)"
                  value={`$${link.revenue.toFixed(2)}`}
                />
                <MiniStat
                  icon={TrendingUp}
                  label="Conv. Rate"
                  value={`${link.conversionRate.toFixed(1)}%`}
                />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {lockedLinks.length > 0 && (
        <div className="mt-8">
          <div className="flex items-center gap-2 mb-4">
            <Lock className="w-4 h-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
              Higher Tier Products
            </h3>
          </div>
          <div className="space-y-3 opacity-60">
            {lockedLinks.map((link) => (
              <Card key={link.id} className="border-dashed">
                <CardContent className="p-4 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Lock className="w-4 h-4 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">{link.productName}</span>
                  </div>
                  <Badge variant="outline" className="text-xs">
                    Upgrade to Unlock
                  </Badge>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      <Dialog open={showCodeModal} onOpenChange={setShowCodeModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Set Custom Affiliate Code</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <p className="text-sm text-muted-foreground">
              Choose a vanity code for your referral links. Must be 3–20 characters,
              alphanumeric and hyphens only.
            </p>
            <Input
              value={vanityCode}
              onChange={(e) => {
                const val = e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "");
                setVanityCode(val);
                handleCheckCode(val);
              }}
              placeholder="e.g., marcus-wins"
              maxLength={20}
            />
            {vanityCode.length >= 3 && codeAvailable !== null && (
              <p className={`text-sm ${codeAvailable ? "text-green-600" : "text-red-600"}`}>
                {codeAvailable ? "✓ This code is available!" : "✗ This code is already taken."}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCodeModal(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSaveCode}
              disabled={
                vanityCode.length < 3 || codeAvailable === false || updateVanityCode.isPending
              }
            >
              {updateVanityCode.isPending ? "Saving..." : "Save Code"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function MiniStat({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof MousePointerClick;
  label: string;
  value: string;
}) {
  return (
    <div className="text-center p-3 bg-secondary/50 rounded-lg">
      <Icon className="w-4 h-4 text-muted-foreground mx-auto mb-1" />
      <p className="text-lg font-bold text-foreground">{value}</p>
      <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</p>
    </div>
  );
}
