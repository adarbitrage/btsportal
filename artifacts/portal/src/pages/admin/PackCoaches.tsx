import { useState } from "react";
import { PackCoachingAdminLayout } from "@/components/layout/PackCoachingAdminLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Plus, Pencil } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { resolveCoachPhotoUrl } from "@/lib/coaches-admin-api";
import {
  useAdminPackCoaches,
  useCreatePackCoach,
  useUpdatePackCoach,
  type PackCoach,
} from "@/lib/session-coaching-admin-api";

interface CoachForm {
  id?: number;
  name: string;
  ghlCalendarId: string;
  ghlLocationId: string;
  bio: string;
  photoUrl: string;
  sortOrder: string;
  isActive: boolean;
}

const EMPTY_FORM: CoachForm = {
  name: "",
  ghlCalendarId: "",
  ghlLocationId: "",
  bio: "",
  photoUrl: "",
  sortOrder: "0",
  isActive: true,
};

export default function PackCoaches() {
  const { toast } = useToast();
  const { data: coaches, isLoading } = useAdminPackCoaches();
  const createMutation = useCreatePackCoach();
  const updateMutation = useUpdatePackCoach();

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<CoachForm>(EMPTY_FORM);

  function openNew() {
    setForm(EMPTY_FORM);
    setOpen(true);
  }

  function openEdit(coach: PackCoach) {
    setForm({
      id: coach.id,
      name: coach.name,
      ghlCalendarId: coach.ghlCalendarId,
      ghlLocationId: coach.ghlLocationId,
      bio: coach.bio ?? "",
      photoUrl: coach.photoUrl ?? "",
      sortOrder: String(coach.sortOrder),
      isActive: coach.isActive,
    });
    setOpen(true);
  }

  async function handleSave() {
    if (!form.name.trim()) {
      toast({ title: "Name is required", variant: "destructive" });
      return;
    }
    if (!form.ghlCalendarId.trim()) {
      toast({ title: "GHL calendar id is required", variant: "destructive" });
      return;
    }
    const sortOrder = parseInt(form.sortOrder, 10);
    try {
      if (form.id) {
        await updateMutation.mutateAsync({
          id: form.id,
          name: form.name.trim(),
          ghlCalendarId: form.ghlCalendarId.trim(),
          ghlLocationId: form.ghlLocationId.trim() || undefined,
          bio: form.bio.trim() || null,
          photoUrl: form.photoUrl.trim() || null,
          sortOrder: Number.isInteger(sortOrder) ? sortOrder : 0,
          isActive: form.isActive,
        });
        toast({ title: "Coach updated" });
      } else {
        await createMutation.mutateAsync({
          name: form.name.trim(),
          ghlCalendarId: form.ghlCalendarId.trim(),
          ghlLocationId: form.ghlLocationId.trim() || undefined,
          bio: form.bio.trim() || null,
          photoUrl: form.photoUrl.trim() || null,
          sortOrder: Number.isInteger(sortOrder) ? sortOrder : 0,
          isActive: form.isActive,
        });
        toast({ title: "Coach added" });
      }
      setOpen(false);
    } catch (err) {
      toast({
        title: "Could not save coach",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    }
  }

  const isMutating = createMutation.isPending || updateMutation.isPending;

  return (
    <PackCoachingAdminLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Coaches</h1>
            <p className="text-muted-foreground">Manage the Private Coaching roster.</p>
          </div>
          <Button onClick={openNew} data-testid="add-coach">
            <Plus className="w-4 h-4 mr-2" />
            Add Coach
          </Button>
        </div>

        {isLoading ? (
          <div className="animate-pulse space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-20 bg-card rounded-xl" />
            ))}
          </div>
        ) : (coaches?.length ?? 0) === 0 ? (
          <Card>
            <CardContent className="p-12 text-center text-muted-foreground">
              No coaches yet. Add your first coach to start taking bookings.
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {(coaches ?? []).map((coach) => (
              <Card key={coach.id} data-testid={`coach-${coach.id}`}>
                <CardContent className="p-5 flex items-start gap-4">
                  {coach.photoUrl ? (
                    <img
                      src={resolveCoachPhotoUrl(coach.photoUrl) ?? undefined}
                      alt={coach.name}
                      className="w-12 h-12 rounded-full object-cover"
                    />
                  ) : (
                    <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center text-lg font-bold text-primary">
                      {coach.name
                        .split(/\s+/)
                        .map((p) => p[0])
                        .join("")
                        .slice(0, 2)
                        .toUpperCase()}
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-foreground">{coach.name}</h3>
                      {coach.isActive ? (
                        <Badge variant="secondary">Active</Badge>
                      ) : (
                        <Badge variant="outline">Inactive</Badge>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground line-clamp-2 mt-0.5">
                      {coach.bio || "No bio yet"}
                    </p>
                    <p className="text-xs text-muted-foreground/70 mt-1 truncate">
                      Calendar: {coach.ghlCalendarId}
                    </p>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => openEdit(coach)}>
                    <Pencil className="w-4 h-4" />
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{form.id ? "Edit Coach" : "Add Coach"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label className="text-xs">Name *</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                data-testid="coach-name"
              />
            </div>
            <div>
              <Label className="text-xs">GHL Calendar ID *</Label>
              <Input
                value={form.ghlCalendarId}
                onChange={(e) => setForm({ ...form, ghlCalendarId: e.target.value })}
                data-testid="coach-calendar"
              />
            </div>
            <div>
              <Label className="text-xs">GHL Location ID (optional)</Label>
              <Input
                value={form.ghlLocationId}
                onChange={(e) => setForm({ ...form, ghlLocationId: e.target.value })}
                placeholder="Defaults to coaching location"
              />
            </div>
            <div>
              <Label className="text-xs">Bio</Label>
              <Textarea
                value={form.bio}
                onChange={(e) => setForm({ ...form, bio: e.target.value })}
                rows={3}
              />
            </div>
            <div>
              <Label className="text-xs">Photo URL</Label>
              <Input
                value={form.photoUrl}
                onChange={(e) => setForm({ ...form, photoUrl: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-xs">Sort Order</Label>
                <Input
                  type="number"
                  value={form.sortOrder}
                  onChange={(e) => setForm({ ...form, sortOrder: e.target.value })}
                />
              </div>
              <label className="flex items-end gap-2 text-sm pb-2">
                <input
                  type="checkbox"
                  checked={form.isActive}
                  onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
                  className="w-4 h-4"
                />
                Active
              </label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={isMutating}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={isMutating} data-testid="save-coach">
              {isMutating ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PackCoachingAdminLayout>
  );
}
