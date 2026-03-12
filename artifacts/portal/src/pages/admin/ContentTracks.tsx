import { useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Plus,
  MoreVertical,
  GripVertical,
  ChevronDown,
  ChevronRight,
  Archive,
  Copy,
  Pencil,
  Trash2,
  BookOpen,
  FileText,
  ArrowRight,
  CheckSquare,
  FolderInput,
} from "lucide-react";
import { Link, useLocation } from "wouter";
import {
  useAdminListTracks,
  useAdminCreateTrack,
  useAdminUpdateTrack,
  useAdminDuplicateTrack,
  useAdminCreateModule,
  useAdminUpdateModule,
  useAdminDeleteModule,
  useAdminCreateLesson,
  useAdminBulkPublishLessons,
  useAdminBulkMoveLessons,
  type AdminTrack,
  type AdminModule,
} from "@/lib/admin-api";
import { Textarea } from "@/components/ui/textarea";

interface TrackFormData {
  title: string;
  description: string;
  requiredEntitlement: string;
}

interface ModuleFormData {
  title: string;
  description: string;
}

interface LessonStub {
  id: number;
  title: string;
  status: "draft" | "published";
  sortOrder: number;
  contentType: string;
  durationMinutes: number;
}

export default function ContentTracks() {
  const { data: tracks, isLoading } = useAdminListTracks();
  const createTrack = useAdminCreateTrack();
  const updateTrack = useAdminUpdateTrack();
  const duplicateTrack = useAdminDuplicateTrack();
  const createModule = useAdminCreateModule();
  const updateModule = useAdminUpdateModule();
  const deleteModule = useAdminDeleteModule();
  const createLesson = useAdminCreateLesson();
  const bulkPublish = useAdminBulkPublishLessons();
  const bulkMove = useAdminBulkMoveLessons();
  const [, navigate] = useLocation();

  const [expandedTracks, setExpandedTracks] = useState<Set<number>>(new Set());
  const [expandedModules, setExpandedModules] = useState<Set<number>>(new Set());
  const [selectedLessons, setSelectedLessons] = useState<Set<number>>(new Set());

  const [trackDialogOpen, setTrackDialogOpen] = useState(false);
  const [editingTrack, setEditingTrack] = useState<AdminTrack | null>(null);
  const [trackForm, setTrackForm] = useState<TrackFormData>({ title: "", description: "", requiredEntitlement: "" });

  const [moduleDialogOpen, setModuleDialogOpen] = useState(false);
  const [editingModule, setEditingModule] = useState<AdminModule | null>(null);
  const [moduleTrackId, setModuleTrackId] = useState<number>(0);
  const [moduleForm, setModuleForm] = useState<ModuleFormData>({ title: "", description: "" });

  const [archiveDialogOpen, setArchiveDialogOpen] = useState(false);
  const [archiveTarget, setArchiveTarget] = useState<AdminTrack | null>(null);

  const [deleteModuleDialogOpen, setDeleteModuleDialogOpen] = useState(false);
  const [deleteModuleTarget, setDeleteModuleTarget] = useState<AdminModule | null>(null);

  const [moveModuleDialogOpen, setMoveModuleDialogOpen] = useState(false);
  const [moveModuleTarget, setMoveModuleTarget] = useState<AdminModule | null>(null);
  const [moveModuleTargetTrackId, setMoveModuleTargetTrackId] = useState<string>("");

  const [lessonDialogOpen, setLessonDialogOpen] = useState(false);
  const [lessonModuleId, setLessonModuleId] = useState<number>(0);
  const [lessonTitle, setLessonTitle] = useState("");
  const [lessonContentType, setLessonContentType] = useState("video_text");

  const [bulkMoveDialogOpen, setBulkMoveDialogOpen] = useState(false);
  const [bulkMoveTargetModule, setBulkMoveTargetModule] = useState<string>("");

  const toggleTrack = (id: number) => {
    setExpandedTracks((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleModule = (id: number) => {
    setExpandedModules((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleLessonSelection = (lessonId: number) => {
    setSelectedLessons((prev) => {
      const next = new Set(prev);
      next.has(lessonId) ? next.delete(lessonId) : next.add(lessonId);
      return next;
    });
  };

  const openTrackDialog = (track?: AdminTrack) => {
    if (track) {
      setEditingTrack(track);
      setTrackForm({ title: track.title, description: track.description, requiredEntitlement: track.requiredEntitlement || "" });
    } else {
      setEditingTrack(null);
      setTrackForm({ title: "", description: "", requiredEntitlement: "" });
    }
    setTrackDialogOpen(true);
  };

  const handleSaveTrack = () => {
    const data = {
      title: trackForm.title,
      description: trackForm.description,
      requiredEntitlement: trackForm.requiredEntitlement || undefined,
    };
    if (editingTrack) {
      updateTrack.mutate({ id: editingTrack.id, ...data }, { onSuccess: () => setTrackDialogOpen(false) });
    } else {
      createTrack.mutate(data, { onSuccess: () => setTrackDialogOpen(false) });
    }
  };

  const openModuleDialog = (trackId: number, mod?: AdminModule) => {
    setModuleTrackId(trackId);
    if (mod) {
      setEditingModule(mod);
      setModuleForm({ title: mod.title, description: mod.description });
    } else {
      setEditingModule(null);
      setModuleForm({ title: "", description: "" });
    }
    setModuleDialogOpen(true);
  };

  const handleSaveModule = () => {
    if (editingModule) {
      updateModule.mutate({ id: editingModule.id, ...moduleForm }, { onSuccess: () => setModuleDialogOpen(false) });
    } else {
      createModule.mutate({ trackId: moduleTrackId, ...moduleForm }, { onSuccess: () => setModuleDialogOpen(false) });
    }
  };

  const handleArchiveTrack = () => {
    if (!archiveTarget) return;
    updateTrack.mutate(
      { id: archiveTarget.id, status: archiveTarget.status === "archived" ? "active" : "archived" },
      { onSuccess: () => { setArchiveDialogOpen(false); setArchiveTarget(null); } }
    );
  };

  const handleDeleteModule = () => {
    if (!deleteModuleTarget) return;
    deleteModule.mutate(deleteModuleTarget.id, {
      onSuccess: () => { setDeleteModuleDialogOpen(false); setDeleteModuleTarget(null); },
    });
  };

  const handleMoveModule = () => {
    if (!moveModuleTarget || !moveModuleTargetTrackId) return;
    updateModule.mutate(
      { id: moveModuleTarget.id, trackId: parseInt(moveModuleTargetTrackId) },
      { onSuccess: () => { setMoveModuleDialogOpen(false); setMoveModuleTarget(null); } }
    );
  };

  const handleCreateLesson = () => {
    if (!lessonTitle.trim()) return;
    createLesson.mutate(
      { moduleId: lessonModuleId, title: lessonTitle, contentType: lessonContentType },
      {
        onSuccess: (lesson) => {
          setLessonDialogOpen(false);
          setLessonTitle("");
          navigate(`/admin/content/lessons/${lesson.id}/edit`);
        },
      }
    );
  };

  const handleBulkPublish = () => {
    if (selectedLessons.size === 0) return;
    bulkPublish.mutate({ lessonIds: Array.from(selectedLessons) }, {
      onSuccess: () => setSelectedLessons(new Set()),
    });
  };

  const handleBulkMove = () => {
    if (selectedLessons.size === 0 || !bulkMoveTargetModule) return;
    bulkMove.mutate(
      { lessonIds: Array.from(selectedLessons), targetModuleId: parseInt(bulkMoveTargetModule) },
      { onSuccess: () => { setSelectedLessons(new Set()); setBulkMoveDialogOpen(false); } }
    );
  };

  const allModules = tracks?.flatMap((t) => t.modules.map((m) => ({ ...m, trackTitle: t.title }))) ?? [];

  if (isLoading) {
    return (
      <AppLayout>
        <div className="animate-pulse space-y-4">
          <div className="h-10 w-64 bg-card rounded" />
          <div className="h-48 bg-card rounded-xl" />
          <div className="h-48 bg-card rounded-xl" />
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Content Management</h1>
            <p className="text-sm text-muted-foreground mt-1">Manage training tracks, modules, and lessons</p>
          </div>
          <Button onClick={() => openTrackDialog()}>
            <Plus className="w-4 h-4 mr-2" /> New Track
          </Button>
        </div>

        {selectedLessons.size > 0 && (
          <Card className="p-4 border-primary/30 bg-primary/5">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">
                <CheckSquare className="w-4 h-4 inline mr-2" />
                {selectedLessons.size} lesson{selectedLessons.size > 1 ? "s" : ""} selected
              </span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={handleBulkPublish} disabled={bulkPublish.isPending}>
                  Publish Selected
                </Button>
                <Button variant="outline" size="sm" onClick={() => setBulkMoveDialogOpen(true)}>
                  <FolderInput className="w-4 h-4 mr-1" /> Move to Module
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setSelectedLessons(new Set())}>
                  Clear
                </Button>
              </div>
            </div>
          </Card>
        )}

        <div className="space-y-4">
          {tracks?.map((track) => (
            <Card key={track.id} className={`overflow-hidden ${track.status === "archived" ? "opacity-60" : ""}`}>
              <div className="p-4">
                <div className="flex items-center gap-3">
                  <button type="button" className="text-muted-foreground hover:text-foreground p-0.5 cursor-grab">
                    <GripVertical className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => toggleTrack(track.id)}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    {expandedTracks.has(track.id) ? (
                      <ChevronDown className="w-5 h-5" />
                    ) : (
                      <ChevronRight className="w-5 h-5" />
                    )}
                  </button>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-foreground">{track.title}</h3>
                      {track.status === "archived" && <Badge variant="secondary">Archived</Badge>}
                      {track.requiredEntitlement && (
                        <Badge variant="outline" className="text-xs">{track.requiredEntitlement}</Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {track.totalModules} modules · {track.totalLessons} lessons
                    </p>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                        <MoreVertical className="w-4 h-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => openTrackDialog(track)}>
                        <Pencil className="w-4 h-4 mr-2" /> Edit Track
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => openModuleDialog(track.id)}>
                        <Plus className="w-4 h-4 mr-2" /> Add Module
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => duplicateTrack.mutate(track.id)}>
                        <Copy className="w-4 h-4 mr-2" /> Duplicate
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onClick={() => { setArchiveTarget(track); setArchiveDialogOpen(true); }}
                        className="text-destructive"
                      >
                        <Archive className="w-4 h-4 mr-2" />
                        {track.status === "archived" ? "Unarchive" : "Archive"}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>

              {expandedTracks.has(track.id) && (
                <div className="border-t border-border">
                  {track.modules.length === 0 ? (
                    <div className="p-6 text-center text-sm text-muted-foreground">
                      No modules yet.{" "}
                      <button type="button" className="text-primary font-medium" onClick={() => openModuleDialog(track.id)}>
                        Create the first module
                      </button>
                    </div>
                  ) : (
                    <div className="divide-y divide-border/50">
                      {track.modules.map((mod) => (
                        <div key={mod.id}>
                          <div className="px-6 py-3 flex items-center gap-3 bg-secondary/20">
                            <button type="button" className="text-muted-foreground hover:text-foreground p-0.5 cursor-grab">
                              <GripVertical className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => toggleModule(mod.id)}
                              className="text-muted-foreground hover:text-foreground"
                            >
                              {expandedModules.has(mod.id) ? (
                                <ChevronDown className="w-4 h-4" />
                              ) : (
                                <ChevronRight className="w-4 h-4" />
                              )}
                            </button>
                            <BookOpen className="w-4 h-4 text-muted-foreground" />
                            <div className="flex-1 min-w-0">
                              <span className="text-sm font-medium text-foreground">{mod.title}</span>
                              <span className="text-xs text-muted-foreground ml-2">{mod.totalLessons} lessons</span>
                            </div>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
                                  <MoreVertical className="w-3.5 h-3.5" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem onClick={() => openModuleDialog(track.id, mod)}>
                                  <Pencil className="w-4 h-4 mr-2" /> Edit Module
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => { setLessonModuleId(mod.id); setLessonDialogOpen(true); }}>
                                  <Plus className="w-4 h-4 mr-2" /> Add Lesson
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => { setMoveModuleTarget(mod); setMoveModuleTargetTrackId(""); setMoveModuleDialogOpen(true); }}>
                                  <ArrowRight className="w-4 h-4 mr-2" /> Move to Track
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  onClick={() => { setDeleteModuleTarget(mod); setDeleteModuleDialogOpen(true); }}
                                  className="text-destructive"
                                >
                                  <Trash2 className="w-4 h-4 mr-2" /> Delete
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>

                          {expandedModules.has(mod.id) && (
                            <div className="bg-white">
                              {(mod as any).lessons?.length > 0 ? (
                                (mod as any).lessons.map((lesson: LessonStub) => (
                                  <div
                                    key={lesson.id}
                                    className="px-10 py-2.5 flex items-center gap-3 hover:bg-secondary/30 transition-colors group"
                                  >
                                    <Checkbox
                                      checked={selectedLessons.has(lesson.id)}
                                      onCheckedChange={() => toggleLessonSelection(lesson.id)}
                                    />
                                    <button type="button" className="text-muted-foreground p-0.5 cursor-grab opacity-0 group-hover:opacity-100 transition-opacity">
                                      <GripVertical className="w-3.5 h-3.5" />
                                    </button>
                                    <FileText className="w-4 h-4 text-muted-foreground" />
                                    <Link href={`/admin/content/lessons/${lesson.id}/edit`}>
                                      <span className="text-sm text-foreground hover:text-primary cursor-pointer flex-1">
                                        {lesson.title}
                                      </span>
                                    </Link>
                                    <Badge variant={lesson.status === "published" ? "default" : "secondary"} className="text-[10px]">
                                      {lesson.status}
                                    </Badge>
                                  </div>
                                ))
                              ) : (
                                <div className="px-10 py-4 text-sm text-muted-foreground">
                                  No lessons yet.{" "}
                                  <button
                                    type="button"
                                    className="text-primary font-medium"
                                    onClick={() => { setLessonModuleId(mod.id); setLessonDialogOpen(true); }}
                                  >
                                    Add first lesson
                                  </button>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="p-3 border-t border-border/50 bg-secondary/10">
                    <Button variant="ghost" size="sm" className="text-xs" onClick={() => openModuleDialog(track.id)}>
                      <Plus className="w-3.5 h-3.5 mr-1" /> Add Module
                    </Button>
                  </div>
                </div>
              )}
            </Card>
          ))}

          {(!tracks || tracks.length === 0) && (
            <Card className="p-12 text-center">
              <BookOpen className="w-12 h-12 text-muted-foreground/30 mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-foreground mb-2">No tracks yet</h3>
              <p className="text-sm text-muted-foreground mb-4">Create your first training track to get started.</p>
              <Button onClick={() => openTrackDialog()}>
                <Plus className="w-4 h-4 mr-2" /> Create Track
              </Button>
            </Card>
          )}
        </div>
      </div>

      <Dialog open={trackDialogOpen} onOpenChange={setTrackDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingTrack ? "Edit Track" : "Create Track"}</DialogTitle>
            <DialogDescription>
              {editingTrack ? "Update the track details." : "Create a new training track."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium text-foreground">Title</label>
              <Input
                value={trackForm.title}
                onChange={(e) => setTrackForm((f) => ({ ...f, title: e.target.value }))}
                placeholder="e.g., Getting Started"
              />
            </div>
            <div>
              <label className="text-sm font-medium text-foreground">Description</label>
              <Textarea
                value={trackForm.description}
                onChange={(e) => setTrackForm((f) => ({ ...f, description: e.target.value }))}
                placeholder="Describe what this track covers..."
                rows={3}
              />
            </div>
            <div>
              <label className="text-sm font-medium text-foreground">Required Entitlement (optional)</label>
              <Input
                value={trackForm.requiredEntitlement}
                onChange={(e) => setTrackForm((f) => ({ ...f, requiredEntitlement: e.target.value }))}
                placeholder="e.g., content:advanced"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTrackDialogOpen(false)}>Cancel</Button>
            <Button
              onClick={handleSaveTrack}
              disabled={!trackForm.title.trim() || createTrack.isPending || updateTrack.isPending}
            >
              {createTrack.isPending || updateTrack.isPending ? "Saving..." : editingTrack ? "Update" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={moduleDialogOpen} onOpenChange={setModuleDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingModule ? "Edit Module" : "Create Module"}</DialogTitle>
            <DialogDescription>
              {editingModule ? "Update the module details." : "Create a new module within this track."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium text-foreground">Title</label>
              <Input
                value={moduleForm.title}
                onChange={(e) => setModuleForm((f) => ({ ...f, title: e.target.value }))}
                placeholder="e.g., Introduction to Basics"
              />
            </div>
            <div>
              <label className="text-sm font-medium text-foreground">Description</label>
              <Textarea
                value={moduleForm.description}
                onChange={(e) => setModuleForm((f) => ({ ...f, description: e.target.value }))}
                placeholder="Describe what this module covers..."
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setModuleDialogOpen(false)}>Cancel</Button>
            <Button
              onClick={handleSaveModule}
              disabled={!moduleForm.title.trim() || createModule.isPending || updateModule.isPending}
            >
              {createModule.isPending || updateModule.isPending ? "Saving..." : editingModule ? "Update" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={archiveDialogOpen} onOpenChange={setArchiveDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{archiveTarget?.status === "archived" ? "Unarchive" : "Archive"} Track</DialogTitle>
            <DialogDescription>
              {archiveTarget?.status === "archived"
                ? "This will make the track visible to members again."
                : "This will hide the track from members. Existing progress will be preserved."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setArchiveDialogOpen(false)}>Cancel</Button>
            <Button variant={archiveTarget?.status === "archived" ? "default" : "outline"} onClick={handleArchiveTrack}>
              {archiveTarget?.status === "archived" ? "Unarchive" : "Archive"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteModuleDialogOpen} onOpenChange={setDeleteModuleDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Module</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete "{deleteModuleTarget?.title}"? This will also remove all lessons within it. Member progress will be lost.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteModuleDialogOpen(false)}>Cancel</Button>
            <Button variant="default" onClick={handleDeleteModule} disabled={deleteModule.isPending}>
              {deleteModule.isPending ? "Deleting..." : "Delete Module"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={moveModuleDialogOpen} onOpenChange={setMoveModuleDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Move Module to Track</DialogTitle>
            <DialogDescription>
              Select a destination track for "{moveModuleTarget?.title}".
            </DialogDescription>
          </DialogHeader>
          <Select value={moveModuleTargetTrackId} onValueChange={setMoveModuleTargetTrackId}>
            <SelectTrigger>
              <SelectValue placeholder="Select track..." />
            </SelectTrigger>
            <SelectContent>
              {tracks
                ?.filter((t) => t.id !== moveModuleTarget?.trackId)
                .map((t) => (
                  <SelectItem key={t.id} value={String(t.id)}>
                    {t.title}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMoveModuleDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleMoveModule} disabled={!moveModuleTargetTrackId || updateModule.isPending}>
              {updateModule.isPending ? "Moving..." : "Move Module"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={lessonDialogOpen} onOpenChange={setLessonDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Lesson</DialogTitle>
            <DialogDescription>Add a new lesson to this module.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium text-foreground">Title</label>
              <Input
                value={lessonTitle}
                onChange={(e) => setLessonTitle(e.target.value)}
                placeholder="e.g., Setting Up Your First Campaign"
              />
            </div>
            <div>
              <label className="text-sm font-medium text-foreground">Content Type</label>
              <Select value={lessonContentType} onValueChange={setLessonContentType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="video_text">Video + Text</SelectItem>
                  <SelectItem value="video_only">Video Only</SelectItem>
                  <SelectItem value="text_only">Text Only</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLessonDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleCreateLesson} disabled={!lessonTitle.trim() || createLesson.isPending}>
              {createLesson.isPending ? "Creating..." : "Create & Edit"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={bulkMoveDialogOpen} onOpenChange={setBulkMoveDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Move {selectedLessons.size} Lessons</DialogTitle>
            <DialogDescription>Select the destination module for the selected lessons.</DialogDescription>
          </DialogHeader>
          <Select value={bulkMoveTargetModule} onValueChange={setBulkMoveTargetModule}>
            <SelectTrigger>
              <SelectValue placeholder="Select module..." />
            </SelectTrigger>
            <SelectContent>
              {allModules.map((m) => (
                <SelectItem key={m.id} value={String(m.id)}>
                  {m.trackTitle} → {m.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkMoveDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleBulkMove} disabled={!bulkMoveTargetModule || bulkMove.isPending}>
              {bulkMove.isPending ? "Moving..." : "Move Lessons"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
