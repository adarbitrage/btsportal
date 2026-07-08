import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Map as MapIcon, Plus, Upload, X, Sparkles, EyeOff, RotateCcw, Merge, ImageIcon, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const API_BASE = `${import.meta.env.BASE_URL}api/admin/knowledgebase/nav`;
const STORAGE_BASE = `${import.meta.env.BASE_URL}api/storage`;

async function api<T = unknown>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...options.headers },
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: "Request failed" }));
    throw new Error(typeof data.error === "string" ? data.error : `Request failed with status ${res.status}`);
  }
  return (await res.json()) as T;
}

async function uploadScreenshot(file: File): Promise<string> {
  const metaRes = await fetch(`${STORAGE_BASE}/uploads/request-url`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: file.name, size: file.size, contentType: file.type }),
  });
  if (!metaRes.ok) throw new Error("Could not get an upload URL");
  const meta = (await metaRes.json()) as { uploadURL: string; objectPath: string };
  const put = await fetch(meta.uploadURL, { method: "PUT", body: file, headers: { "Content-Type": file.type } });
  if (!put.ok) throw new Error(`Upload of ${file.name} failed`);
  return meta.objectPath;
}

interface NavAppInfo {
  slug: string;
  label: string;
  tier: number;
  suggestedAreas: string[];
  coveredAreas: string[];
}

interface NavGapFlag {
  id: number;
  app: string;
  area: string;
  status: "open" | "dismissed" | "resolved";
  tier: number;
  topicNodes: string[];
  topicCount: number;
  lastEvidence: string | null;
  lastSeenAt: string | null;
}

interface StagingNavDoc {
  id: number;
  title: string;
  status: string;
  navApp: string | null;
  navArea: string | null;
  navScreenshots: string[] | null;
  updateKind: string | null;
  targetLiveDocId: number | null;
  createdAt: string;
}

interface LiveNavDoc {
  id: number;
  title: string;
  navApp: string | null;
  navArea: string | null;
  lastVerified: string | null;
  updatedAt: string;
}

/** Days after which a live walkthrough's verified date is highlighted as stale. */
const STALE_DAYS = 180;

function verifiedAgeDays(lastVerified: string | null): number {
  if (!lastVerified) return Number.POSITIVE_INFINITY;
  return (Date.now() - new Date(lastVerified).getTime()) / 86_400_000;
}

const STATUS_BADGE: Record<string, string> = {
  needs_review: "bg-amber-500/15 text-amber-600 border-amber-500/30",
  approved: "bg-emerald-500/15 text-emerald-600 border-emerald-500/30",
  pending_review: "bg-sky-500/15 text-sky-600 border-sky-500/30",
};

export default function NavigationDocs() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [showClosed, setShowClosed] = useState(false);
  const [draftOpen, setDraftOpen] = useState(false);
  const [draftApp, setDraftApp] = useState("");
  const [draftArea, setDraftArea] = useState("");
  const [draftNotes, setDraftNotes] = useState("");
  const [draftTargetId, setDraftTargetId] = useState<string>("none");
  const [files, setFiles] = useState<File[]>([]);
  const [drafting, setDrafting] = useState(false);
  const [mergeSource, setMergeSource] = useState<NavGapFlag | null>(null);
  const [mergeTargetId, setMergeTargetId] = useState<string>("");

  const appsQuery = useQuery({
    queryKey: ["nav-apps"],
    queryFn: () => api<{ apps: NavAppInfo[] }>("/apps"),
  });
  const docsQuery = useQuery({
    queryKey: ["nav-docs"],
    queryFn: () => api<{ staging: StagingNavDoc[]; live: LiveNavDoc[] }>("/docs"),
  });
  const gapsQuery = useQuery({
    queryKey: ["nav-gaps", showClosed],
    queryFn: () => api<{ flags: NavGapFlag[] }>(`/gaps${showClosed ? "?includeClosed=1" : ""}`),
  });

  const apps = appsQuery.data?.apps ?? [];
  const appLabel = useMemo(() => new Map(apps.map((a) => [a.slug, a.label])), [apps]);
  const flags = gapsQuery.data?.flags ?? [];
  // Group per app; server already sorts (app ASC, lastVerified ASC NULLS FIRST)
  // so within each group the oldest / never-verified docs come first.
  const liveByApp = useMemo(() => {
    const groups = new Map<string, LiveNavDoc[]>();
    for (const doc of docsQuery.data?.live ?? []) {
      const key = doc.navApp ?? "unassigned";
      const list = groups.get(key) ?? [];
      list.push(doc);
      groups.set(key, list);
    }
    return [...groups.entries()];
  }, [docsQuery.data?.live]);
  const selectedApp = apps.find((a) => a.slug === draftApp) ?? null;

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ["nav-apps"] });
    queryClient.invalidateQueries({ queryKey: ["nav-docs"] });
    queryClient.invalidateQueries({ queryKey: ["nav-gaps"] });
  };

  const dismissMutation = useMutation({
    mutationFn: (id: number) => api(`/gaps/${id}/dismiss`, { method: "POST" }),
    onSuccess: () => {
      toast({ title: "Gap dismissed", description: "It will stay dismissed even if the topic keeps coming up." });
      invalidateAll();
    },
    onError: (err: Error) => toast({ title: "Dismiss failed", description: err.message, variant: "destructive" }),
  });

  const reopenMutation = useMutation({
    mutationFn: (id: number) => api(`/gaps/${id}/reopen`, { method: "POST" }),
    onSuccess: () => {
      toast({ title: "Gap re-opened" });
      invalidateAll();
    },
    onError: (err: Error) => toast({ title: "Re-open failed", description: err.message, variant: "destructive" }),
  });

  const mergeMutation = useMutation({
    mutationFn: (input: { sourceId: number; targetId: number }) =>
      api("/gaps/merge", { method: "POST", body: JSON.stringify(input) }),
    onSuccess: () => {
      toast({ title: "Gaps merged" });
      setMergeSource(null);
      setMergeTargetId("");
      invalidateAll();
    },
    onError: (err: Error) => toast({ title: "Merge failed", description: err.message, variant: "destructive" }),
  });

  const openDraftDialog = (app?: string, area?: string) => {
    setDraftApp(app ?? "");
    setDraftArea(area ?? "");
    setDraftNotes("");
    setDraftTargetId("none");
    setFiles([]);
    setDraftOpen(true);
  };

  const submitDraft = async () => {
    if (!draftApp) {
      toast({ title: "Pick an app first", variant: "destructive" });
      return;
    }
    if (files.length === 0) {
      toast({ title: "Add at least one screenshot", variant: "destructive" });
      return;
    }
    setDrafting(true);
    try {
      const screenshotPaths: string[] = [];
      for (const file of files) {
        screenshotPaths.push(await uploadScreenshot(file));
      }
      await api("/draft", {
        method: "POST",
        body: JSON.stringify({
          app: draftApp,
          area: draftArea || undefined,
          notes: draftNotes || undefined,
          screenshotPaths,
          ...(draftTargetId !== "none" ? { targetLiveDocId: Number(draftTargetId) } : {}),
        }),
      });
      toast({
        title: "Draft created",
        description: "The walkthrough draft is waiting in Document Review — nothing goes live without your approval.",
      });
      setDraftOpen(false);
      invalidateAll();
    } catch (err) {
      toast({
        title: "Drafting failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setDrafting(false);
    }
  };

  const mergeCandidates = mergeSource
    ? flags.filter((f) => f.app === mergeSource.app && f.id !== mergeSource.id && f.status === "open")
    : [];

  const staging = docsQuery.data?.staging ?? [];
  const live = docsQuery.data?.live ?? [];

  return (
    <AppLayout>
      <div className="p-6 space-y-6 max-w-6xl">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <MapIcon className="h-6 w-6" /> Navigation Docs
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              Upload screenshots of an app and let the AI draft a step-by-step walkthrough. Drafts always land in
              Document Review — you approve and push them live.
            </p>
          </div>
          <Button onClick={() => openDraftDialog()} data-testid="button-new-nav-doc">
            <Plus className="h-4 w-4 mr-2" /> New walkthrough draft
          </Button>
        </div>

        {/* ── Navigation gaps ─────────────────────────────────────────── */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold flex items-center gap-2">
                <Sparkles className="h-4 w-4" /> Suggested walkthroughs
                <Badge variant="secondary">{flags.filter((f) => f.status === "open").length} open</Badge>
              </h2>
              <Button variant="ghost" size="sm" onClick={() => setShowClosed((v) => !v)} data-testid="button-toggle-closed-gaps">
                {showClosed ? "Hide dismissed/resolved" : "Show dismissed/resolved"}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground mb-3">
              Flagged automatically when call transcripts mention members doing things inside these apps and no
              published walkthrough covers it yet. Advisory only — dismissing never blocks anything.
            </p>
            {flags.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4">No navigation gaps flagged right now.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>App</TableHead>
                    <TableHead>Area</TableHead>
                    <TableHead>Topics</TableHead>
                    <TableHead>Evidence</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {flags.map((flag) => (
                    <TableRow key={flag.id} data-testid={`row-nav-gap-${flag.id}`}>
                      <TableCell className="font-medium">
                        {appLabel.get(flag.app) ?? flag.app}
                        {flag.tier === 1 && <Badge variant="outline" className="ml-2 text-[10px]">core</Badge>}
                      </TableCell>
                      <TableCell>{flag.area}</TableCell>
                      <TableCell>
                        <span title={(flag.topicNodes ?? []).join(", ")}>{flag.topicCount}</span>
                      </TableCell>
                      <TableCell className="max-w-[280px]">
                        <span className="text-xs text-muted-foreground line-clamp-2">{flag.lastEvidence ?? "—"}</span>
                      </TableCell>
                      <TableCell>
                        <Badge variant={flag.status === "open" ? "default" : "secondary"}>{flag.status}</Badge>
                      </TableCell>
                      <TableCell className="text-right space-x-1 whitespace-nowrap">
                        {flag.status === "open" ? (
                          <>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => openDraftDialog(flag.app, flag.area === "general" ? "" : flag.area)}
                              data-testid={`button-draft-from-gap-${flag.id}`}
                            >
                              <Plus className="h-3.5 w-3.5 mr-1" /> Draft
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => { setMergeSource(flag); setMergeTargetId(""); }}
                              title="Merge into another area"
                              data-testid={`button-merge-gap-${flag.id}`}
                            >
                              <Merge className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => dismissMutation.mutate(flag.id)}
                              title="Dismiss (sticky)"
                              data-testid={`button-dismiss-gap-${flag.id}`}
                            >
                              <EyeOff className="h-3.5 w-3.5" />
                            </Button>
                          </>
                        ) : (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => reopenMutation.mutate(flag.id)}
                            title="Re-open"
                            data-testid={`button-reopen-gap-${flag.id}`}
                          >
                            <RotateCcw className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* ── Drafts in review + published docs ───────────────────────── */}
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardContent className="pt-6">
              <h2 className="font-semibold mb-3">In review ({staging.length})</h2>
              {staging.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4">No navigation drafts waiting for review.</p>
              ) : (
                <div className="space-y-2">
                  {staging.map((doc) => (
                    <div key={doc.id} className="flex items-start justify-between gap-3 border rounded-md p-3" data-testid={`row-nav-staging-${doc.id}`}>
                      <div className="min-w-0">
                        <p className="font-medium text-sm truncate">{doc.title}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {appLabel.get(doc.navApp ?? "") ?? doc.navApp} · {doc.navArea ?? "general"}
                          {doc.updateKind === "update" && " · revision"}
                          {Array.isArray(doc.navScreenshots) && doc.navScreenshots.length > 0 && (
                            <span className="inline-flex items-center gap-1 ml-2"><ImageIcon className="h-3 w-3" />{doc.navScreenshots.length}</span>
                          )}
                        </p>
                      </div>
                      <Badge variant="outline" className={STATUS_BADGE[doc.status] ?? ""}>{doc.status.replace("_", " ")}</Badge>
                    </div>
                  ))}
                  <p className="text-xs text-muted-foreground pt-1">
                    Approve and push these on the <span className="font-medium">Document Review</span> page.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <h2 className="font-semibold mb-3">Published walkthroughs ({live.length})</h2>
              <p className="text-xs text-muted-foreground mb-3">
                Grouped by app, oldest verified first — stale docs surface at the top of each app.
              </p>
              {live.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4">No navigation docs are live yet.</p>
              ) : (
                <div className="space-y-4">
                  {liveByApp.map(([appSlug, docs]) => (
                    <div key={appSlug} data-testid={`group-nav-live-${appSlug}`}>
                      <p className="text-xs font-semibold uppercase text-muted-foreground mb-1.5">
                        {appLabel.get(appSlug) ?? appSlug}
                      </p>
                      <div className="space-y-2">
                        {docs.map((doc) => (
                          <div key={doc.id} className="flex items-start justify-between gap-3 border rounded-md p-3" data-testid={`row-nav-live-${doc.id}`}>
                            <div className="min-w-0">
                              <p className="font-medium text-sm truncate">{doc.title}</p>
                              <p className="text-xs text-muted-foreground mt-0.5">
                                {doc.navArea ?? "general"} ·{" "}
                                <span className={verifiedAgeDays(doc.lastVerified) > STALE_DAYS ? "text-amber-600 font-medium" : ""} data-testid={`text-nav-verified-${doc.id}`}>
                                  {doc.lastVerified
                                    ? `verified ${new Date(doc.lastVerified).toLocaleDateString()}`
                                    : "never verified"}
                                </span>
                              </p>
                            </div>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                openDraftDialog(doc.navApp ?? "", doc.navArea === "general" ? "" : (doc.navArea ?? ""));
                                setDraftTargetId(String(doc.id));
                              }}
                              data-testid={`button-revise-live-${doc.id}`}
                            >
                              Revise
                            </Button>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* ── App coverage ────────────────────────────────────────────── */}
        <Card>
          <CardContent className="pt-6">
            <h2 className="font-semibold mb-3">App coverage</h2>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {apps.map((app) => (
                <div key={app.slug} className="border rounded-md p-3" data-testid={`card-nav-app-${app.slug}`}>
                  <div className="flex items-center justify-between">
                    <p className="font-medium text-sm">{app.label}</p>
                    {app.tier === 1 && <Badge variant="outline" className="text-[10px]">core</Badge>}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {app.coveredAreas.length > 0
                      ? `Covered: ${app.coveredAreas.join(", ")}`
                      : "No walkthroughs published yet"}
                  </p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── Draft dialog ───────────────────────────────────────────────── */}
      <Dialog open={draftOpen} onOpenChange={(open) => !drafting && setDraftOpen(open)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>New walkthrough draft</DialogTitle>
            <DialogDescription>
              Upload screenshots in the order a member would see them. The AI drafts the walkthrough; you review it
              before anything goes live.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>App</Label>
              <Select value={draftApp} onValueChange={(v) => { setDraftApp(v); setDraftTargetId("none"); }}>
                <SelectTrigger data-testid="select-draft-app"><SelectValue placeholder="Pick an app" /></SelectTrigger>
                <SelectContent>
                  {apps.map((app) => (
                    <SelectItem key={app.slug} value={app.slug}>{app.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Area / task</Label>
              <Input
                value={draftArea}
                onChange={(e) => setDraftArea(e.target.value)}
                placeholder={selectedApp?.suggestedAreas[0] ? `e.g. ${selectedApp.suggestedAreas.slice(0, 2).join(", ")}` : "e.g. campaign setup"}
                data-testid="input-draft-area"
              />
              {selectedApp && selectedApp.suggestedAreas.length > 0 && (
                <div className="flex flex-wrap gap-1 pt-1">
                  {selectedApp.suggestedAreas.map((area) => (
                    <button
                      key={area}
                      type="button"
                      className="text-xs px-2 py-0.5 rounded-full border hover:bg-accent"
                      onClick={() => setDraftArea(area)}
                    >
                      {area}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {live.filter((d) => d.navApp === draftApp).length > 0 && (
              <div className="space-y-1.5">
                <Label>Revise an existing walkthrough (optional)</Label>
                <Select value={draftTargetId} onValueChange={setDraftTargetId}>
                  <SelectTrigger data-testid="select-draft-target"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No — create a new doc</SelectItem>
                    {live.filter((d) => d.navApp === draftApp).map((d) => (
                      <SelectItem key={d.id} value={String(d.id)}>{d.title}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-1.5">
              <Label>Screenshots (in order, up to 8)</Label>
              <div className="flex items-center gap-2">
                <Button asChild variant="outline" size="sm">
                  <label className="cursor-pointer">
                    <Upload className="h-4 w-4 mr-2" /> Add screenshots
                    <input
                      type="file"
                      accept="image/*"
                      multiple
                      className="hidden"
                      data-testid="input-draft-screenshots"
                      onChange={(e) => {
                        const picked = Array.from(e.target.files ?? []);
                        setFiles((prev) => [...prev, ...picked].slice(0, 8));
                        e.target.value = "";
                      }}
                    />
                  </label>
                </Button>
                <span className="text-xs text-muted-foreground">{files.length} selected</span>
              </div>
              {files.length > 0 && (
                <ul className="space-y-1 pt-1">
                  {files.map((file, i) => (
                    <li key={`${file.name}-${i}`} className="flex items-center justify-between text-xs border rounded px-2 py-1">
                      <span className="truncate">{i + 1}. {file.name}</span>
                      <button type="button" onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))} aria-label="Remove">
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>Notes for the AI (optional)</Label>
              <Textarea
                value={draftNotes}
                onChange={(e) => setDraftNotes(e.target.value)}
                placeholder="Anything the screenshots don't show — exact button names, gotchas, prerequisites…"
                rows={3}
                data-testid="input-draft-notes"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDraftOpen(false)} disabled={drafting}>Cancel</Button>
            <Button onClick={submitDraft} disabled={drafting} data-testid="button-submit-draft">
              {drafting ? (<><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Drafting…</>) : "Upload & draft"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Merge dialog ───────────────────────────────────────────────── */}
      <Dialog open={!!mergeSource} onOpenChange={(open) => !open && setMergeSource(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Merge gap</DialogTitle>
            <DialogDescription>
              Fold "{mergeSource?.area}" ({appLabel.get(mergeSource?.app ?? "") ?? mergeSource?.app}) into another open
              area for the same app. Topic counts combine; this row is removed.
            </DialogDescription>
          </DialogHeader>
          {mergeCandidates.length === 0 ? (
            <p className="text-sm text-muted-foreground">No other open gaps for this app to merge into.</p>
          ) : (
            <Select value={mergeTargetId} onValueChange={setMergeTargetId}>
              <SelectTrigger data-testid="select-merge-target"><SelectValue placeholder="Merge into…" /></SelectTrigger>
              <SelectContent>
                {mergeCandidates.map((f) => (
                  <SelectItem key={f.id} value={String(f.id)}>{f.area} ({f.topicCount} topics)</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setMergeSource(null)}>Cancel</Button>
            <Button
              disabled={!mergeTargetId || mergeMutation.isPending}
              onClick={() => mergeSource && mergeMutation.mutate({ sourceId: mergeSource.id, targetId: Number(mergeTargetId) })}
              data-testid="button-confirm-merge"
            >
              Merge
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
