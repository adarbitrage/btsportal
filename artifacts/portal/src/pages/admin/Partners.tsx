import { useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Plus, Pencil, RefreshCw, Ban } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  useAdminPartners,
  useCreatePartner,
  useUpdatePartner,
  useMemberPartnerAssignments,
  useReassignPartner,
  useEndPartnerAssignment,
  type AdminPartner,
  type PartnerInput,
} from "@/lib/partners-admin-api";

interface PartnerForm {
  displayName: string;
  bio: string;
  photoUrl: string;
  isActive: boolean;
  maxDailyCalls: string;
}

const EMPTY_FORM: PartnerForm = {
  displayName: "",
  bio: "",
  photoUrl: "",
  isActive: true,
  maxDailyCalls: "0",
};

export default function Partners() {
  const { toast } = useToast();
  const { data, isLoading } = useAdminPartners();
  const createPartner = useCreatePartner();
  const updatePartner = useUpdatePartner();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<PartnerForm>(EMPTY_FORM);

  const [memberIdInput, setMemberIdInput] = useState("");
  const [activeMemberId, setActiveMemberId] = useState<number | null>(null);
  const [reassignPartnerId, setReassignPartnerId] = useState<string>("");
  const [reassignReason, setReassignReason] = useState("");

  const { data: historyData, isLoading: historyLoading } =
    useMemberPartnerAssignments(activeMemberId);
  const reassignMutation = useReassignPartner();
  const endMutation = useEndPartnerAssignment();

  function openCreate() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  }

  function openEdit(partner: AdminPartner) {
    setEditingId(partner.id);
    setForm({
      displayName: partner.displayName,
      bio: partner.bio,
      photoUrl: partner.photoUrl ?? "",
      isActive: partner.isActive,
      maxDailyCalls: String(partner.maxDailyCalls),
    });
    setDialogOpen(true);
  }

  async function handleSave() {
    const input: PartnerInput = {
      displayName: form.displayName,
      bio: form.bio,
      photoUrl: form.photoUrl || null,
      isActive: form.isActive,
      maxDailyCalls: Number(form.maxDailyCalls) || 0,
    };
    try {
      if (editingId) {
        await updatePartner.mutateAsync({ id: editingId, input });
        toast({ title: "Partner updated" });
      } else {
        await createPartner.mutateAsync(input);
        toast({ title: "Partner created" });
      }
      setDialogOpen(false);
    } catch (err) {
      toast({
        title: "Save failed",
        description: err instanceof Error ? err.message : "Please try again",
        variant: "destructive",
      });
    }
  }

  function handleLookupMember() {
    const id = parseInt(memberIdInput, 10);
    if (!Number.isInteger(id) || id <= 0) {
      toast({ title: "Enter a valid member id", variant: "destructive" });
      return;
    }
    setActiveMemberId(id);
  }

  async function handleReassign() {
    if (!activeMemberId) return;
    if (!reassignReason.trim()) {
      toast({ title: "A reason is required", variant: "destructive" });
      return;
    }
    try {
      await reassignMutation.mutateAsync({
        memberId: activeMemberId,
        partnerId: reassignPartnerId ? Number(reassignPartnerId) : undefined,
        reason: reassignReason.trim(),
      });
      toast({ title: "Partner reassigned" });
      setReassignReason("");
      setReassignPartnerId("");
    } catch (err) {
      toast({
        title: "Reassignment failed",
        description: err instanceof Error ? err.message : "Please try again",
        variant: "destructive",
      });
    }
  }

  async function handleEnd() {
    if (!activeMemberId) return;
    try {
      await endMutation.mutateAsync({
        memberId: activeMemberId,
        reason: reassignReason.trim() || "Ended by admin",
      });
      toast({ title: "Assignment ended" });
    } catch (err) {
      toast({
        title: "Failed to end assignment",
        description: err instanceof Error ? err.message : "Please try again",
        variant: "destructive",
      });
    }
  }

  const partners = data?.partners ?? [];

  return (
    <AppLayout>
      <div className="space-y-6" data-testid="page-admin-partners">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-foreground">Accountability Partners</h1>
            <p className="text-sm text-muted-foreground">
              Partners are auto-assigned round-robin to any member on a 3-Month+ plan.
            </p>
          </div>
          <Button onClick={openCreate} data-testid="button-add-partner">
            <Plus className="mr-2 h-4 w-4" /> Add Partner
          </Button>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Partners</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
            {!isLoading && partners.length === 0 && (
              <p className="text-sm text-muted-foreground">No partners yet.</p>
            )}
            {partners.map((partner) => (
              <div
                key={partner.id}
                className="flex items-center justify-between rounded-lg border border-border/60 p-3"
                data-testid={`row-partner-${partner.id}`}
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-foreground">{partner.displayName}</span>
                    {!partner.isActive && <Badge variant="secondary">Inactive</Badge>}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {partner.activeAssignmentCount} active assignment
                    {partner.activeAssignmentCount === 1 ? "" : "s"}
                    {partner.maxDailyCalls > 0
                      ? ` · max ${partner.maxDailyCalls} calls/day`
                      : ""}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => openEdit(partner)}
                  data-testid={`button-edit-partner-${partner.id}`}
                >
                  <Pencil className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Member Reassignment</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <Label htmlFor="member-id">Member ID</Label>
                <Input
                  id="member-id"
                  value={memberIdInput}
                  onChange={(e) => setMemberIdInput(e.target.value)}
                  placeholder="e.g. 1042"
                  data-testid="input-member-id"
                />
              </div>
              <Button onClick={handleLookupMember} data-testid="button-lookup-member">
                Look up
              </Button>
            </div>

            {activeMemberId && (
              <div className="space-y-4 border-t border-border/60 pt-4">
                <div>
                  <p className="text-sm font-medium text-foreground">
                    Assignment history — member {activeMemberId}
                  </p>
                  {historyLoading && (
                    <p className="text-sm text-muted-foreground">Loading…</p>
                  )}
                  {!historyLoading && (historyData?.history ?? []).length === 0 && (
                    <p className="text-sm text-muted-foreground">No assignments yet.</p>
                  )}
                  <div className="space-y-2 mt-2">
                    {(historyData?.history ?? []).map((item) => (
                      <div
                        key={item.id}
                        className="flex items-center justify-between rounded-lg border border-border/60 p-2 text-sm"
                        data-testid={`row-assignment-history-${item.id}`}
                      >
                        <span>{item.partnerDisplayName}</span>
                        <Badge
                          variant={item.status === "active" ? "default" : "secondary"}
                        >
                          {item.status}
                        </Badge>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <Label htmlFor="reassign-partner">New partner (optional)</Label>
                    <select
                      id="reassign-partner"
                      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      value={reassignPartnerId}
                      onChange={(e) => setReassignPartnerId(e.target.value)}
                      data-testid="select-reassign-partner"
                    >
                      <option value="">Round robin (auto-pick)</option>
                      {partners
                        .filter((p) => p.isActive)
                        .map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.displayName}
                          </option>
                        ))}
                    </select>
                  </div>
                  <div>
                    <Label htmlFor="reassign-reason">Reason</Label>
                    <Input
                      id="reassign-reason"
                      value={reassignReason}
                      onChange={(e) => setReassignReason(e.target.value)}
                      placeholder="Why is this member being reassigned?"
                      data-testid="input-reassign-reason"
                    />
                  </div>
                </div>

                <div className="flex gap-2">
                  <Button
                    onClick={handleReassign}
                    disabled={reassignMutation.isPending}
                    data-testid="button-reassign"
                  >
                    <RefreshCw className="mr-2 h-4 w-4" /> Reassign
                  </Button>
                  <Button
                    variant="outline"
                    onClick={handleEnd}
                    disabled={endMutation.isPending}
                    data-testid="button-end-assignment"
                  >
                    <Ban className="mr-2 h-4 w-4" /> End assignment
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent data-testid="dialog-partner-form">
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit Partner" : "Add Partner"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="partner-name">Display name</Label>
              <Input
                id="partner-name"
                value={form.displayName}
                onChange={(e) => setForm({ ...form, displayName: e.target.value })}
                data-testid="input-partner-name"
              />
            </div>
            <div>
              <Label htmlFor="partner-bio">Bio</Label>
              <Textarea
                id="partner-bio"
                value={form.bio}
                onChange={(e) => setForm({ ...form, bio: e.target.value })}
                data-testid="input-partner-bio"
              />
            </div>
            <div>
              <Label htmlFor="partner-photo">Photo URL</Label>
              <Input
                id="partner-photo"
                value={form.photoUrl}
                onChange={(e) => setForm({ ...form, photoUrl: e.target.value })}
                data-testid="input-partner-photo"
              />
            </div>
            <div>
              <Label htmlFor="partner-max-calls">Max daily calls (0 = unlimited)</Label>
              <Input
                id="partner-max-calls"
                type="number"
                min={0}
                value={form.maxDailyCalls}
                onChange={(e) => setForm({ ...form, maxDailyCalls: e.target.value })}
                data-testid="input-partner-max-calls"
              />
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="partner-active">Active (eligible for round robin)</Label>
              <Switch
                id="partner-active"
                checked={form.isActive}
                onCheckedChange={(checked) => setForm({ ...form, isActive: checked })}
                data-testid="switch-partner-active"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={createPartner.isPending || updatePartner.isPending}
              data-testid="button-save-partner"
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
