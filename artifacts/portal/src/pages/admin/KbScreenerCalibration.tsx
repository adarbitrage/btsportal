import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Plus, Trash2, Sparkles, Gem, VolumeX } from "lucide-react";
import {
  listCalibration,
  listCalibrationCandidates,
  addCalibrationExample,
  updateCalibrationExample,
  deleteCalibrationExample,
  type CalibrationExample,
} from "@/lib/admin-api";
import { useToast } from "@/hooks/use-toast";

export default function KbScreenerCalibration() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const calQ = useQuery({ queryKey: ["screener-calibration"], queryFn: listCalibration });
  const candQ = useQuery({ queryKey: ["screener-cal-candidates"], queryFn: listCalibrationCandidates });

  const [label, setLabel] = useState<"gold" | "noise">("gold");
  const [memberPrompt, setMemberPrompt] = useState("");
  const [coachResponse, setCoachResponse] = useState("");
  const [valueType, setValueType] = useState<string>("");
  const [note, setNote] = useState("");

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["screener-calibration"] });
    qc.invalidateQueries({ queryKey: ["screener-cal-candidates"] });
  };

  const addM = useMutation({
    mutationFn: () =>
      addCalibrationExample({
        memberPrompt: memberPrompt.trim() || undefined,
        coachResponse: coachResponse.trim(),
        label,
        valueType: label === "gold" && valueType ? valueType : undefined,
        note: note.trim() || undefined,
      }),
    onSuccess: () => {
      setMemberPrompt("");
      setCoachResponse("");
      setNote("");
      setValueType("");
      invalidate();
      toast({ title: "Example added", description: "The calibration version was bumped." });
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const toggleM = useMutation({
    mutationFn: (v: { id: number; active: boolean }) => updateCalibrationExample(v.id, { active: v.active }),
    onSuccess: invalidate,
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const delM = useMutation({
    mutationFn: (id: number) => deleteCalibrationExample(id),
    onSuccess: () => {
      invalidate();
      toast({ title: "Deleted" });
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const examples = calQ.data?.examples ?? [];
  const candidates = candQ.data?.candidates ?? [];
  const valueTypes = calQ.data?.valueTypes ?? [];

  return (
    <AppLayout>
      <div className="mx-auto max-w-5xl space-y-6 p-4 md:p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-semibold">
              <Sparkles className="h-6 w-6 text-primary" /> Screener Calibration
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Teach the value screener what "good" looks like. GOLD examples are high-value coaching
              moments worth keeping; NOISE examples are chit-chat, logistics, or one-off situational
              answers to drop. These are fed to the screener as examples — the more you add, the
              sharper its judgement. The screener still works with none.
            </p>
          </div>
          <div className="shrink-0 space-y-1 text-right">
            <Badge variant="outline" className="font-mono text-xs">
              version {calQ.data?.version ?? "…"}
            </Badge>
            <div className="text-xs text-muted-foreground">
              {calQ.data?.goldCount ?? 0} gold · {calQ.data?.noiseCount ?? 0} noise active
            </div>
          </div>
        </div>

        {/* Add form */}
        <Card>
          <CardContent className="space-y-4 p-4">
            <div className="flex items-center gap-2">
              <Button
                variant={label === "gold" ? "default" : "outline"}
                size="sm"
                onClick={() => setLabel("gold")}
              >
                <Gem className="mr-1 h-4 w-4" /> Gold (keep)
              </Button>
              <Button
                variant={label === "noise" ? "default" : "outline"}
                size="sm"
                onClick={() => setLabel("noise")}
              >
                <VolumeX className="mr-1 h-4 w-4" /> Noise (drop)
              </Button>
              {label === "gold" && (
                <Select value={valueType} onValueChange={setValueType}>
                  <SelectTrigger className="ml-auto w-52">
                    <SelectValue placeholder="Value type (optional)" />
                  </SelectTrigger>
                  <SelectContent>
                    {valueTypes.map((vt) => (
                      <SelectItem key={vt} value={vt}>
                        {vt.replace(/_/g, " ")}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Member prompt (optional)</Label>
              <Textarea
                rows={2}
                value={memberPrompt}
                onChange={(e) => setMemberPrompt(e.target.value)}
                placeholder="e.g. How do I pick my first offer?"
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Coach response</Label>
              <Textarea
                rows={4}
                value={coachResponse}
                onChange={(e) => setCoachResponse(e.target.value)}
                placeholder="The coaching moment itself…"
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Note (optional, not sent to the AI)</Label>
              <Input value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
            <Button onClick={() => addM.mutate()} disabled={!coachResponse.trim() || addM.isPending}>
              {addM.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
              Add example
            </Button>
          </CardContent>
        </Card>

        {/* Flagged candidates */}
        {candidates.length > 0 && (
          <Card>
            <CardContent className="space-y-3 p-4">
              <h2 className="text-sm font-semibold">Flagged moments awaiting a call ({candidates.length})</h2>
              <p className="text-xs text-muted-foreground">
                The screener wasn't sure about these. Label one to both resolve it and teach the screener.
              </p>
              {candidates.map((c) => (
                <div key={c.id} className="rounded-lg border p-3">
                  {c.memberPrompt && <p className="mb-1 text-sm"><span className="text-muted-foreground">Q: </span>{c.memberPrompt}</p>}
                  <p className="text-sm"><span className="text-muted-foreground">A: </span>{c.coachResponse}</p>
                  <div className="mt-2 flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        addCalibrationExample({
                          memberPrompt: c.memberPrompt || undefined,
                          coachResponse: c.coachResponse,
                          label: "gold",
                          valueType: c.valueType || undefined,
                        })
                          .then(() => {
                            invalidate();
                            toast({ title: "Added as gold" });
                          })
                          .catch((e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }))
                      }
                    >
                      <Gem className="mr-1 h-3.5 w-3.5" /> Gold
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        addCalibrationExample({
                          memberPrompt: c.memberPrompt || undefined,
                          coachResponse: c.coachResponse,
                          label: "noise",
                        })
                          .then(() => {
                            invalidate();
                            toast({ title: "Added as noise" });
                          })
                          .catch((e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }))
                      }
                    >
                      <VolumeX className="mr-1 h-3.5 w-3.5" /> Noise
                    </Button>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {/* Existing examples */}
        <Card>
          <CardContent className="space-y-3 p-4">
            <h2 className="text-sm font-semibold">Calibration set ({examples.length})</h2>
            {calQ.isLoading ? (
              <div className="flex items-center justify-center p-6 text-muted-foreground">
                <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading…
              </div>
            ) : examples.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                No examples yet — the screener is running on the default rubric.
              </p>
            ) : (
              examples.map((ex: CalibrationExample) => (
                <div
                  key={ex.id}
                  className={`rounded-lg border p-3 ${ex.active ? "" : "opacity-50"}`}
                >
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    {ex.label === "gold" ? (
                      <Badge className="bg-emerald-600 hover:bg-emerald-600"><Gem className="mr-1 h-3 w-3" /> gold</Badge>
                    ) : (
                      <Badge variant="destructive"><VolumeX className="mr-1 h-3 w-3" /> noise</Badge>
                    )}
                    {ex.valueType && <Badge variant="secondary" className="text-xs">{ex.valueType.replace(/_/g, " ")}</Badge>}
                    {ex.sourceExchangeId && <Badge variant="outline" className="text-xs">from overrule</Badge>}
                    <div className="ml-auto flex items-center gap-3">
                      <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Switch
                          checked={ex.active}
                          onCheckedChange={(v) => toggleM.mutate({ id: ex.id, active: v })}
                        />
                        active
                      </label>
                      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => delM.mutate(ex.id)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </div>
                  {ex.memberPrompt && <p className="mb-1 text-sm"><span className="text-muted-foreground">Q: </span>{ex.memberPrompt}</p>}
                  <p className="text-sm"><span className="text-muted-foreground">A: </span>{ex.coachResponse}</p>
                  {ex.note && <p className="mt-1 text-xs italic text-muted-foreground">{ex.note}</p>}
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
