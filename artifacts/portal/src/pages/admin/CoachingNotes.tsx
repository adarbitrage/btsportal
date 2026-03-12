import { useState, useEffect } from "react";
import { CoachingAdminLayout } from "@/components/layout/CoachingAdminLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  useCoachingSessions,
  useCoachingSession,
  coachingAdminApi,
  type CoachingSessionItem,
  type ActionItem,
} from "@/lib/coaching-admin-api";
import { useQueryClient } from "@tanstack/react-query";
import { FileEdit, Save, Plus, Trash2, Check, Clock } from "lucide-react";
import { useSearch } from "wouter";

export default function CoachingNotes() {
  const searchString = useSearch();
  const params = new URLSearchParams(searchString);
  const initialSessionId = params.get("sessionId");
  const [selectedSessionId, setSelectedSessionId] = useState<number>(initialSessionId ? Number(initialSessionId) : 0);
  const { data: sessions } = useCoachingSessions();
  const { data: session } = useCoachingSession(selectedSessionId);
  const [coachNotes, setCoachNotes] = useState("");
  const [memberNotes, setMemberNotes] = useState("");
  const [newItemText, setNewItemText] = useState("");
  const [newItemDue, setNewItemDue] = useState("");
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();
  const qc = useQueryClient();

  useEffect(() => {
    if (session) {
      setCoachNotes(session.coachNotes || "");
      setMemberNotes(session.memberNotes || "");
    }
  }, [session]);

  const handleSaveNotes = async () => {
    if (!selectedSessionId) return;
    setSaving(true);
    try {
      await coachingAdminApi.updateSession(selectedSessionId, { coachNotes, memberNotes });
      qc.invalidateQueries({ queryKey: ["/admin/coaching/sessions"] });
      toast({ title: "Notes saved" });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleAddActionItem = async () => {
    if (!newItemText.trim()) return;
    try {
      await coachingAdminApi.createActionItem(selectedSessionId, {
        text: newItemText.trim(),
        dueDate: newItemDue || undefined,
      });
      setNewItemText("");
      setNewItemDue("");
      qc.invalidateQueries({ queryKey: ["/admin/coaching/sessions", selectedSessionId] });
      toast({ title: "Action item added" });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  };

  const handleCompleteItem = async (id: number) => {
    try {
      await coachingAdminApi.completeActionItem(id);
      qc.invalidateQueries({ queryKey: ["/admin/coaching/sessions", selectedSessionId] });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  };

  const handleDeleteItem = async (id: number) => {
    try {
      await coachingAdminApi.deleteActionItem(id);
      qc.invalidateQueries({ queryKey: ["/admin/coaching/sessions", selectedSessionId] });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  };

  const completedSessions = sessions?.filter(s => s.status === "completed" || s.coachNotes || s.memberNotes) || [];

  return (
    <CoachingAdminLayout>
      <div className="space-y-8">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Session Notes</h1>
          <p className="text-muted-foreground mt-1">Add coach notes, member notes, and action items for sessions</p>
        </div>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-4">
              <Label>Select Session</Label>
              <Select
                value={selectedSessionId ? String(selectedSessionId) : ""}
                onValueChange={(v) => setSelectedSessionId(Number(v))}
              >
                <SelectTrigger className="w-96">
                  <SelectValue placeholder="Choose a session..." />
                </SelectTrigger>
                <SelectContent>
                  {sessions?.map(s => (
                    <SelectItem key={s.id} value={String(s.id)}>
                      {new Date(s.scheduledAt).toLocaleDateString()} — {s.memberName} with {s.coachName}
                      {!s.coachNotes && s.status === "completed" ? " ⚠️" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {selectedSessionId > 0 && session && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <FileEdit className="w-4 h-4" />
                    Session Details
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-xs text-muted-foreground">Member</p>
                      <p className="font-medium text-sm">{session.memberName}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Coach</p>
                      <p className="font-medium text-sm">{session.coachName}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Date</p>
                      <p className="font-medium text-sm">
                        {new Date(session.scheduledAt).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Status</p>
                      <Badge variant="outline" className="text-xs">{session.status.replace("_", " ")}</Badge>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Coach Notes (Private)</CardTitle>
                </CardHeader>
                <CardContent>
                  <Textarea
                    placeholder="Private notes visible only to admins and the coach..."
                    rows={6}
                    value={coachNotes}
                    onChange={(e) => setCoachNotes(e.target.value)}
                  />
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Member Notes (Shared)</CardTitle>
                </CardHeader>
                <CardContent>
                  <Textarea
                    placeholder="Notes shared with the member after the session..."
                    rows={6}
                    value={memberNotes}
                    onChange={(e) => setMemberNotes(e.target.value)}
                  />
                </CardContent>
              </Card>

              <Button onClick={handleSaveNotes} disabled={saving} className="w-full">
                <Save className="w-4 h-4 mr-2" />
                {saving ? "Saving..." : "Save Notes"}
              </Button>
            </div>

            <div>
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Action Items</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {session.actionItems?.length > 0 && (
                    <div className="space-y-2">
                      {session.actionItems.map(item => (
                        <div key={item.id} className="flex items-start gap-3 p-3 rounded-lg border">
                          <Checkbox
                            checked={!!item.completedAt}
                            onCheckedChange={() => !item.completedAt && handleCompleteItem(item.id)}
                            disabled={!!item.completedAt}
                          />
                          <div className="flex-1 min-w-0">
                            <p className={`text-sm ${item.completedAt ? "line-through text-muted-foreground" : ""}`}>
                              {item.text}
                            </p>
                            {item.dueDate && (
                              <div className="flex items-center gap-1 mt-1">
                                <Clock className="w-3 h-3 text-muted-foreground" />
                                <span className="text-xs text-muted-foreground">
                                  Due {new Date(item.dueDate + "T00:00:00").toLocaleDateString()}
                                </span>
                              </div>
                            )}
                            {item.completedAt && (
                              <div className="flex items-center gap-1 mt-1">
                                <Check className="w-3 h-3 text-green-600" />
                                <span className="text-xs text-green-600">
                                  Completed {new Date(item.completedAt).toLocaleDateString()}
                                </span>
                              </div>
                            )}
                          </div>
                          <Button variant="ghost" size="sm" onClick={() => handleDeleteItem(item.id)}>
                            <Trash2 className="w-4 h-4 text-destructive" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="border-t pt-4">
                    <p className="text-sm font-medium mb-3">Add Action Item</p>
                    <div className="space-y-3">
                      <Input
                        placeholder="What needs to be done..."
                        value={newItemText}
                        onChange={(e) => setNewItemText(e.target.value)}
                      />
                      <div className="flex items-center gap-3">
                        <Input
                          type="date"
                          className="w-48"
                          value={newItemDue}
                          onChange={(e) => setNewItemDue(e.target.value)}
                        />
                        <Button onClick={handleAddActionItem} disabled={!newItemText.trim()} size="sm">
                          <Plus className="w-4 h-4 mr-1" />
                          Add
                        </Button>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        )}

        {selectedSessionId === 0 && (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              Select a session above to manage notes and action items.
            </CardContent>
          </Card>
        )}
      </div>
    </CoachingAdminLayout>
  );
}
