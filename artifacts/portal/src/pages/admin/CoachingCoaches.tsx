import { useState } from "react";
import { CoachingAdminLayout } from "@/components/layout/CoachingAdminLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useCoachingCoaches, coachingAdminApi, type CoachDetail } from "@/lib/coaching-admin-api";
import { useQueryClient } from "@tanstack/react-query";
import { Users, Video, Clock, Globe, Settings, ChevronRight } from "lucide-react";
import { Link } from "wouter";

const TIMEZONES = [
  "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles",
  "America/Phoenix", "America/Anchorage", "Pacific/Honolulu", "Europe/London",
  "Europe/Paris", "Asia/Tokyo", "Australia/Sydney",
];

export default function CoachingCoaches() {
  const { data: coaches, isLoading } = useCoachingCoaches();
  const [editCoach, setEditCoach] = useState<CoachDetail | null>(null);
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();
  const qc = useQueryClient();

  const handleToggle = async (coach: CoachDetail) => {
    try {
      await coachingAdminApi.updateCoach(coach.id, { oneOnOneEnabled: !coach.oneOnOneEnabled });
      qc.invalidateQueries({ queryKey: ["/admin/coaching/coaches"] });
      toast({ title: `${coach.name} ${coach.oneOnOneEnabled ? "disabled" : "enabled"} for 1-on-1 sessions` });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  };

  const handleSave = async () => {
    if (!editCoach) return;
    setSaving(true);
    try {
      await coachingAdminApi.updateCoach(editCoach.id, {
        meetLink: editCoach.meetLink,
        timezone: editCoach.timezone,
        maxDailySessions: editCoach.maxDailySessions,
      });
      qc.invalidateQueries({ queryKey: ["/admin/coaching/coaches"] });
      toast({ title: "Coach settings updated" });
      setEditCoach(null);
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const enabledCount = coaches?.filter(c => c.oneOnOneEnabled).length || 0;

  return (
    <CoachingAdminLayout>
      <div className="space-y-8">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Coach Management</h1>
          <p className="text-muted-foreground mt-1">Configure coaches for 1-on-1 sessions</p>
        </div>

        <div className="grid grid-cols-3 gap-4">
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center">
                  <Users className="w-5 h-5 text-blue-600" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{coaches?.length || 0}</p>
                  <p className="text-sm text-muted-foreground">Total Coaches</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-green-50 flex items-center justify-center">
                  <Video className="w-5 h-5 text-green-600" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{enabledCount}</p>
                  <p className="text-sm text-muted-foreground">1-on-1 Enabled</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-amber-50 flex items-center justify-center">
                  <Clock className="w-5 h-5 text-amber-600" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{(coaches?.length || 0) - enabledCount}</p>
                  <p className="text-sm text-muted-foreground">Disabled</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>All Coaches</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <p className="text-muted-foreground text-sm py-8 text-center">Loading coaches...</p>
            ) : !coaches?.length ? (
              <p className="text-muted-foreground text-sm py-8 text-center">No coaches found</p>
            ) : (
              <div className="space-y-3">
                {coaches.map((coach) => (
                  <div key={coach.id} className="flex items-center gap-4 p-4 rounded-lg border bg-card hover:bg-secondary/30 transition-colors">
                    <div className="w-10 h-10 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-sm shrink-0">
                      {coach.name.split(" ").map(n => n[0]).join("")}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-foreground">{coach.name}</p>
                      <p className="text-sm text-muted-foreground truncate">{coach.specialties}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={coach.oneOnOneEnabled ? "default" : "secondary"}>
                        {coach.oneOnOneEnabled ? "1-on-1 Enabled" : "Disabled"}
                      </Badge>
                      {coach.timezone && (
                        <Badge variant="outline" className="gap-1">
                          <Globe className="w-3 h-3" />
                          {coach.timezone.split("/")[1]?.replace("_", " ")}
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={coach.oneOnOneEnabled}
                        onCheckedChange={() => handleToggle(coach)}
                      />
                      <Button variant="ghost" size="sm" onClick={() => setEditCoach(coach)}>
                        <Settings className="w-4 h-4" />
                      </Button>
                      <Link href={`/admin/coaching/availability?coachId=${coach.id}`}>
                        <Button variant="ghost" size="sm">
                          <ChevronRight className="w-4 h-4" />
                        </Button>
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={!!editCoach} onOpenChange={() => setEditCoach(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Configure {editCoach?.name}</DialogTitle>
          </DialogHeader>
          {editCoach && (
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>Google Meet Link</Label>
                <Input
                  placeholder="https://meet.google.com/..."
                  value={editCoach.meetLink || ""}
                  onChange={(e) => setEditCoach({ ...editCoach, meetLink: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Timezone</Label>
                <Select value={editCoach.timezone} onValueChange={(v) => setEditCoach({ ...editCoach, timezone: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {TIMEZONES.map(tz => (
                      <SelectItem key={tz} value={tz}>{tz.replace("_", " ")}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Max Daily Sessions</Label>
                <Input
                  type="number"
                  min={1}
                  max={20}
                  value={editCoach.maxDailySessions}
                  onChange={(e) => setEditCoach({ ...editCoach, maxDailySessions: Number(e.target.value) })}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditCoach(null)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </CoachingAdminLayout>
  );
}
