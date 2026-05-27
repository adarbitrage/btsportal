import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ShieldBan, ShieldCheck, Loader2 } from "lucide-react";
import { useAdminBanUser, useAdminUnbanUser } from "@/lib/admin-api";
import { useToast } from "@/hooks/use-toast";

interface BanControlsProps {
  userId: number;
  isBanned: boolean;
  userName: string;
}

export function BanControls({ userId, isBanned, userName }: BanControlsProps) {
  const [banOpen, setBanOpen] = useState(false);
  const [unbanOpen, setUnbanOpen] = useState(false);
  const [clearStrikes, setClearStrikes] = useState(false);
  const { toast } = useToast();

  const banMutation = useAdminBanUser();
  const unbanMutation = useAdminUnbanUser();

  const handleBan = async () => {
    try {
      await banMutation.mutateAsync(userId);
      toast({ title: `${userName} has been banned from posting` });
      setBanOpen(false);
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  };

  const handleUnban = async () => {
    try {
      await unbanMutation.mutateAsync({ userId, clearStrikes });
      toast({
        title: clearStrikes
          ? `${userName} has been unbanned and all strikes cleared`
          : `${userName} has been unbanned`,
      });
      setUnbanOpen(false);
      setClearStrikes(false);
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  };

  if (isBanned) {
    return (
      <>
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5 border-green-200 text-green-700 hover:bg-green-50"
          onClick={() => setUnbanOpen(true)}
        >
          <ShieldCheck className="w-4 h-4" />
          Unban
        </Button>

        <Dialog open={unbanOpen} onOpenChange={(open) => { setUnbanOpen(open); if (!open) setClearStrikes(false); }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Unban {userName}?</DialogTitle>
              <DialogDescription>
                This will restore {userName}&apos;s ability to post in the community.
              </DialogDescription>
            </DialogHeader>
            <div className="flex items-start gap-3 py-2">
              <Checkbox
                id="clear-strikes"
                checked={clearStrikes}
                onCheckedChange={(v) => setClearStrikes(!!v)}
              />
              <Label htmlFor="clear-strikes" className="text-sm leading-snug cursor-pointer">
                Also clear all prior strikes
                <p className="text-xs text-muted-foreground mt-0.5 font-normal">
                  Without this, their next rejection will immediately re-ban them.
                </p>
              </Label>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => { setUnbanOpen(false); setClearStrikes(false); }}>
                Cancel
              </Button>
              <Button
                onClick={handleUnban}
                disabled={unbanMutation.isPending}
                className="gap-1.5"
              >
                {unbanMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                Confirm Unban
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </>
    );
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="gap-1.5 border-red-200 text-red-700 hover:bg-red-50"
        onClick={() => setBanOpen(true)}
      >
        <ShieldBan className="w-4 h-4" />
        Ban
      </Button>

      <Dialog open={banOpen} onOpenChange={setBanOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Ban {userName} from posting?</DialogTitle>
            <DialogDescription>
              This will immediately block {userName} from submitting any community posts or comments.
              You can unban them at any time from this page.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBanOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleBan}
              disabled={banMutation.isPending}
              className="gap-1.5"
            >
              {banMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
              Confirm Ban
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
