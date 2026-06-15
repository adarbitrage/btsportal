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
import { useCoachingCoaches, useCoachingCoach, coachingAdminApi, type AvailabilitySlot } from "@/lib/coaching-admin-api";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, Calendar } from "lucide-react";
import { useSearch } from "wouter";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export default function CoachingAvailability() {
  const searchString = useSearch();
  const params = new URLSearchParams(searchString);
  const initialCoachId = params.get("coachId");
  const [selectedCoachId, setSelectedCoachId] = useState<number>(initialCoachId ? Number(initialCoachId) : 0);
  const { data: coaches } = useCoachingCoaches();
  const { data: coach } = useCoachingCoach(selectedCoachId);
  const [editSlot, setEditSlot] = useState<Partial<AvailabilitySlot> | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();
  const qc = useQueryClient();

  const enabledCoaches = useMemo(() => coaches?.filter(c => c.oneOnOneEnabled) || [], [coaches]);

  const handleAddSlot = () => {
    setIsNew(true);
    setEditSlot({
      coachId: selectedCoachId,
      dayOfWeek: 1,
      startTime: "09:00",
      endTime: "17:00",
      sessionDurationMinutes: 60,
      bufferMinutes: 15,
    });
  };

  const handleSaveSlot = async () => {
    if (!editSlot) return;
    setSaving(true);
    try {
      if (isNew) {
        await coachingAdminApi.createAvailability(editSlot as Omit<AvailabilitySlot, "id">);
        toast({ title: "Availability slot added" });
      } else {
        await coachingAdminApi.updateAvailability(editSlot.id!, editSlot);
        toast({ title: "Availability slot updated" });
      }
      qc.invalidateQueries({ queryKey: ["/admin/coaching/coaches", selectedCoachId] });
      setEditSlot(null);
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteSlot = async (id: number) => {
    try {
      await coachingAdminApi.deleteAvailability(id);
      qc.invalidateQueries({ queryKey: ["/admin/coaching/coaches", selectedCoachId] });
      toast({ title: "Slot deleted" });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  };

  const slotsByDay = useMemo(() => {
    const grouped: Record<number, AvailabilitySlot[]> = {};
    coach?.availability?.forEach(slot => {
      if (!grouped[slot.dayOfWeek]) grouped[slot.dayOfWeek] = [];
      grouped[slot.dayOfWeek].push(slot);
    });
    return grouped;
  }, [coach?.availability]);

  return (
    <CoachingAdminLayout>
      <div className="space-y-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-foreground">Weekly Availability</h1>
            <p className="text-muted-foreground mt-1">Manage recurring availability windows for coaches</p>
          </div>
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
                <Button onClick={handleAddSlot} className="ml-auto">
                  <Plus className="w-4 h-4 mr-2" />
                  Add Time Window
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        {selectedCoachId > 0 && coach && (
          <div className="grid gap-4">
            {DAYS.map((dayName, dayIndex) => {
              const daySlots = slotsByDay[dayIndex] || [];
              return (
                <Card key={dayIndex}>
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base font-medium flex items-center gap-2">
                        <Calendar className="w-4 h-4 text-muted-foreground" />
                        {dayName}
                      </CardTitle>
                      {daySlots.length > 0 && (
                        <Badge variant="secondary">{daySlots.length} window{daySlots.length > 1 ? "s" : ""}</Badge>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent>
                    {daySlots.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No availability set</p>
                    ) : (
                      <div className="space-y-2">
                        {daySlots.map(slot => (
                          <div key={slot.id} className="flex items-center gap-4 p-3 rounded-lg bg-secondary/50">
                            <div className="flex-1">
                              <span className="font-medium text-sm">{slot.startTime} – {slot.endTime}</span>
                              <span className="text-muted-foreground text-sm ml-4">
                                {slot.sessionDurationMinutes}min sessions · {slot.bufferMinutes}min buffer
                              </span>
                            </div>
                            <Button variant="ghost" size="sm" onClick={() => { setIsNew(false); setEditSlot(slot); }}>
                              <Pencil className="w-4 h-4" />
                            </Button>
                            <Button variant="ghost" size="sm" onClick={() => handleDeleteSlot(slot.id)}>
                              <Trash2 className="w-4 h-4 text-destructive" />
                            </Button>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        {selectedCoachId === 0 && (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              Select a coach above to manage their weekly availability schedule.
            </CardContent>
          </Card>
        )}
      </div>

      <Dialog open={!!editSlot} onOpenChange={() => setEditSlot(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{isNew ? "Add" : "Edit"} Availability Window</DialogTitle>
          </DialogHeader>
          {editSlot && (
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>Day of Week</Label>
                <Select value={String(editSlot.dayOfWeek)} onValueChange={(v) => setEditSlot({ ...editSlot, dayOfWeek: Number(v) })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {DAYS.map((d, i) => <SelectItem key={i} value={String(i)}>{d}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Start Time</Label>
                  <Input type="time" value={editSlot.startTime || ""} onChange={(e) => setEditSlot({ ...editSlot, startTime: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label>End Time</Label>
                  <Input type="time" value={editSlot.endTime || ""} onChange={(e) => setEditSlot({ ...editSlot, endTime: e.target.value })} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Session Duration (min)</Label>
                  <Input type="number" min={15} max={180} value={editSlot.sessionDurationMinutes ?? 60} onChange={(e) => setEditSlot({ ...editSlot, sessionDurationMinutes: Number(e.target.value) })} />
                </div>
                <div className="space-y-2">
                  <Label>Buffer Between (min)</Label>
                  <Input type="number" min={0} max={60} value={editSlot.bufferMinutes ?? 15} onChange={(e) => setEditSlot({ ...editSlot, bufferMinutes: Number(e.target.value) })} />
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditSlot(null)}>Cancel</Button>
            <Button onClick={handleSaveSlot} disabled={saving}>{saving ? "Saving..." : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </CoachingAdminLayout>
  );
}
