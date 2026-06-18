import { useState } from "react";
import { PackCoachingAdminLayout } from "@/components/layout/PackCoachingAdminLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Pencil } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  useAdminCoaches,
  useUpdateCoach,
  type AdminCoach,
} from "@/lib/coaches-admin-api";

interface CoachForm {
  id?: number;
  name: string;
  specialties: string;
  bio: string;
  photoUrl: string;
}

const EMPTY_FORM: CoachForm = {
  name: "",
  specialties: "",
  bio: "",
  photoUrl: "",
};

function coachInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export default function CoachProfiles() {
  const { toast } = useToast();
  const { data, isLoading } = useAdminCoaches();
  const updateMutation = useUpdateCoach();

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<CoachForm>(EMPTY_FORM);

  const coaches = data?.coaches ?? [];

  function openEdit(coach: AdminCoach) {
    setForm({
      id: coach.id,
      name: coach.name,
      specialties: coach.specialties,
      bio: coach.bio,
      photoUrl: coach.photoUrl ?? "",
    });
    setOpen(true);
  }

  async function handleSave() {
    if (!form.id) return;
    if (!form.name.trim()) {
      toast({ title: "Name is required", variant: "destructive" });
      return;
    }
    if (!form.specialties.trim()) {
      toast({ title: "Specialty is required", variant: "destructive" });
      return;
    }
    if (!form.bio.trim()) {
      toast({ title: "Bio is required", variant: "destructive" });
      return;
    }
    const photoUrl = form.photoUrl.trim();
    if (photoUrl && !/^https?:\/\//i.test(photoUrl)) {
      toast({
        title: "Photo URL must start with http:// or https://",
        variant: "destructive",
      });
      return;
    }

    try {
      await updateMutation.mutateAsync({
        id: form.id,
        name: form.name.trim(),
        specialties: form.specialties.trim(),
        bio: form.bio.trim(),
        photoUrl: photoUrl || null,
      });
      toast({ title: "Coach updated" });
      setOpen(false);
    } catch (err) {
      toast({
        title: "Could not save coach",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    }
  }

  return (
    <PackCoachingAdminLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Coach Profiles</h1>
          <p className="text-muted-foreground">
            Edit the name, specialty, photo, and bio members see in the "Your
            Coaches" section on the Coaching page.
          </p>
        </div>

        {isLoading ? (
          <div className="animate-pulse space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-24 bg-card rounded-xl" />
            ))}
          </div>
        ) : coaches.length === 0 ? (
          <Card>
            <CardContent className="p-12 text-center text-muted-foreground">
              No coaches found yet.
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {coaches.map((coach) => (
              <Card key={coach.id} data-testid={`coach-${coach.id}`}>
                <CardContent className="p-5 flex items-start gap-4">
                  {coach.photoUrl ? (
                    <img
                      src={coach.photoUrl}
                      alt={coach.name}
                      data-testid={`coach-photo-${coach.id}`}
                      className="w-14 h-14 rounded-full object-cover shrink-0"
                    />
                  ) : (
                    <div
                      data-testid={`coach-initials-${coach.id}`}
                      className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center text-lg font-bold text-primary shrink-0"
                    >
                      {coachInitials(coach.name)}
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <h3 className="font-semibold text-foreground">{coach.name}</h3>
                    <p
                      data-testid={`coach-specialty-${coach.id}`}
                      className="text-xs font-medium text-primary mt-0.5"
                    >
                      {coach.specialties}
                    </p>
                    <p className="text-sm text-muted-foreground line-clamp-2 mt-1">
                      {coach.bio}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => openEdit(coach)}
                    data-testid={`edit-coach-${coach.id}`}
                  >
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
            <DialogTitle>Edit Coach</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label className="text-xs">Name *</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                maxLength={120}
                data-testid="coach-name"
              />
            </div>
            <div>
              <Label className="text-xs">Specialty *</Label>
              <Input
                value={form.specialties}
                onChange={(e) => setForm({ ...form, specialties: e.target.value })}
                maxLength={200}
                placeholder="e.g. Paid Traffic & Funnels"
                data-testid="coach-specialty"
              />
            </div>
            <div>
              <Label className="text-xs">Photo URL</Label>
              <Input
                value={form.photoUrl}
                onChange={(e) => setForm({ ...form, photoUrl: e.target.value })}
                placeholder="https://…"
                maxLength={2048}
                data-testid="coach-photo-url"
              />
              {form.photoUrl.trim() && (
                <img
                  src={form.photoUrl.trim()}
                  alt="Preview"
                  className="w-16 h-16 rounded-full object-cover mt-2 border border-border/60"
                  onError={(e) => {
                    (e.currentTarget as HTMLImageElement).style.display = "none";
                  }}
                />
              )}
            </div>
            <div>
              <Label className="text-xs">Bio *</Label>
              <Textarea
                value={form.bio}
                onChange={(e) => setForm({ ...form, bio: e.target.value })}
                rows={4}
                maxLength={2000}
                data-testid="coach-bio"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={updateMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={updateMutation.isPending}
              data-testid="save-coach"
            >
              {updateMutation.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PackCoachingAdminLayout>
  );
}
