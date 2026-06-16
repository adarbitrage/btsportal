import { useState, useMemo } from "react";
import { CoachingAdminLayout } from "@/components/layout/CoachingAdminLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useCoachingCoaches, useCoachingCoach, coachingAdminApi, type AvailabilityOverride } from "@/lib/coaching-admin-api";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, Pencil, CalendarOff, CalendarPlus } from "lucide-react";

export default function CoachingOverrides() {
  const [selectedCoachId, setSelectedCoachId] = useState<number>(0);
  const { data: coaches } = useCoachingCoaches();
  const { data: coach } = useCoachingCoach(selectedCoachId);
  const [editOverride, setEditOverride] = useState<Partial<AvailabilityOverride> | null>(null);
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();
  const qc = useQueryClient();

  const enabledCoaches = useMemo(() => coaches?.filter(c => c.oneOnOneEnabled) || [], [coaches]);

  const isEditing = editOverride != null && editOverride.id != null;

  const handleAdd = () => {
    setEditOverride({
      coachId: selectedCoachId,
      overrideDate: new Date().toISOString().split("T")[0],
      overrideType: "blocked",
      startTime: null,
      endTime: null,
      sessionDurationMinutes: null,
      bufferMinutes: null,
      reason: "",
    });
  };

  const handleEdit = (override: AvailabilityOverride) => {
    setEditOverride({ ...override });
  };

  const handleSave = async () => {
    if (!editOverride) return;
    setSaving(true);
    try {
      if (editOverride.id != null) {
        await coachingAdminApi.updateOverride(editOverride.id, editOverride);
        toast({ title: "Override updated" });
      } else {
        await coachingAdminApi.createOverride(editOverride as Omit<AvailabilityOverride, "id">);
        toast({ title: "Override added" });
      }
      qc.invalidateQueries({ queryKey: ["/admin/coaching/coaches", selectedCoachId] });
      setEditOverride(null);
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await coachingAdminApi.deleteOverride(id);
      qc.invalidateQueries({ queryKey: ["/admin/coaching/coaches", selectedCoachId] });
      toast({ title: "Override removed" });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  };

  return (
    <CoachingAdminLayout>
      <div className="space-y-8">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Availability Overrides</h1>
          <p className="text-muted-foreground mt-1">Block dates for holidays/vacations or add extra availability</p>
        </div>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-4">
              <Label>Select Coach</Label>
              <Select
                value={selectedCoachId ? String(selectedCoachId) : ""}
                onValueChange={(v) => setSelectedCoachId(Number(v))}
              >
                <SelectTrigger className="w-64">
                  <SelectValue placeholder="Choose a coach..." />
                </SelectTrigger>
                <SelectContent>
                  {enabledCoaches.map(c => (
                    <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedCoachId > 0 && (
                <Button onClick={handleAdd} className="ml-auto">
                  <Plus className="w-4 h-4 mr-2" />
                  Add Override
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        {selectedCoachId > 0 && coach && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Upcoming Overrides</CardTitle>
            </CardHeader>
            <CardContent>
              {!coach.overrides?.length ? (
                <p className="text-sm text-muted-foreground py-4 text-center">No upcoming overrides</p>
              ) : (
                <div className="space-y-3">
                  {coach.overrides.map(override => (
                    <div key={override.id} className="flex items-center gap-4 p-4 rounded-lg border">
                      <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${override.overrideType === "blocked" ? "bg-red-50" : "bg-green-50"}`}>
                        {override.overrideType === "blocked" ? (
                          <CalendarOff className="w-5 h-5 text-red-600" />
                        ) : (
                          <CalendarPlus className="w-5 h-5 text-green-600" />
                        )}
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <p className="font-medium text-sm">
                            {new Date(override.overrideDate + "T00:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
                          </p>
                          <Badge variant={override.overrideType === "blocked" ? "warning" : "default"}>
                            {override.overrideType === "blocked" ? "Blocked" : "Extra Availability"}
                          </Badge>
                        </div>
                        {(override.startTime || override.endTime) && (
                          <p className="text-sm text-muted-foreground">{override.startTime} – {override.endTime}</p>
                        )}
                        {override.overrideType === "extra" && (override.sessionDurationMinutes || override.bufferMinutes != null) && (
                          <p className="text-sm text-muted-foreground">
                            {override.sessionDurationMinutes ? `${override.sessionDurationMinutes}-min sessions` : "Default-length sessions"}
                            {override.bufferMinutes != null ? `, ${override.bufferMinutes}-min buffer` : ""}
                          </p>
                        )}
                        {override.reason && (
                          <p className="text-sm text-muted-foreground mt-1">{override.reason}</p>
                        )}
                      </div>
                      <Button variant="ghost" size="sm" onClick={() => handleEdit(override)}>
                        <Pencil className="w-4 h-4" />
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => handleDelete(override.id)}>
                        <Trash2 className="w-4 h-4 text-destructive" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {selectedCoachId === 0 && (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              Select a coach above to manage their availability overrides.
            </CardContent>
          </Card>
        )}
      </div>

      <Dialog open={!!editOverride} onOpenChange={() => setEditOverride(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{isEditing ? "Edit Override" : "Add Override"}</DialogTitle>
          </DialogHeader>
          {editOverride && (
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>Override Type</Label>
                <Select value={editOverride.overrideType || "blocked"} onValueChange={(v) => setEditOverride({ ...editOverride, overrideType: v, ...(v === "blocked" ? { startTime: null, endTime: null, sessionDurationMinutes: null, bufferMinutes: null } : {}) })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="blocked">Blocked (Holiday/Vacation)</SelectItem>
                    <SelectItem value="extra">Extra Availability</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Date</Label>
                <Input type="date" value={editOverride.overrideDate || ""} onChange={(e) => setEditOverride({ ...editOverride, overrideDate: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Start Time (optional)</Label>
                  <Input type="time" value={editOverride.startTime || ""} onChange={(e) => setEditOverride({ ...editOverride, startTime: e.target.value || null })} />
                  <p className="text-xs text-muted-foreground">Leave blank for whole day</p>
                </div>
                <div className="space-y-2">
                  <Label>End Time (optional)</Label>
                  <Input type="time" value={editOverride.endTime || ""} onChange={(e) => setEditOverride({ ...editOverride, endTime: e.target.value || null })} />
                </div>
              </div>
              {editOverride.overrideType === "extra" && (
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Session Length (min, optional)</Label>
                    <Input
                      type="number"
                      min={15}
                      max={180}
                      placeholder="Default"
                      value={editOverride.sessionDurationMinutes ?? ""}
                      onChange={(e) => setEditOverride({ ...editOverride, sessionDurationMinutes: e.target.value === "" ? null : Number(e.target.value) })}
                    />
                    <p className="text-xs text-muted-foreground">Blank = use the coach's normal schedule</p>
                  </div>
                  <div className="space-y-2">
                    <Label>Buffer (min, optional)</Label>
                    <Input
                      type="number"
                      min={0}
                      max={60}
                      placeholder="Default"
                      value={editOverride.bufferMinutes ?? ""}
                      onChange={(e) => setEditOverride({ ...editOverride, bufferMinutes: e.target.value === "" ? null : Number(e.target.value) })}
                    />
                    <p className="text-xs text-muted-foreground">Gap between back-to-back calls</p>
                  </div>
                </div>
              )}
              <div className="space-y-2">
                <Label>Reason (optional)</Label>
                <Input placeholder="e.g., Public holiday, Vacation" value={editOverride.reason || ""} onChange={(e) => setEditOverride({ ...editOverride, reason: e.target.value })} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOverride(null)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving}>{saving ? "Saving..." : isEditing ? "Save Changes" : "Add Override"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </CoachingAdminLayout>
  );
}
