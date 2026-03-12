import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, Link, useLocation } from "wouter";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  ArrowLeft,
  Save,
  Eye,
  Clock,
  History,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import { RichTextEditor } from "@/components/admin/RichTextEditor";
import { VideoEmbed } from "@/components/admin/VideoEmbed";
import { ResourceUpload } from "@/components/admin/ResourceUpload";
import { ActionItemsEditor } from "@/components/admin/ActionItemsEditor";
import { VersionHistory } from "@/components/admin/VersionHistory";
import { TipTapContentRenderer } from "@/components/admin/TipTapRenderer";
import {
  useAdminGetLesson,
  useAdminSaveLesson,
  type AdminLesson,
  type LessonResource,
  type ActionItem,
} from "@/lib/admin-api";

export default function LessonEditor() {
  const { id } = useParams();
  const lessonId = parseInt(id || "0", 10);
  const { data: lesson, isLoading } = useAdminGetLesson(lessonId);
  const saveMutation = useAdminSaveLesson();
  const [, navigate] = useLocation();

  const [title, setTitle] = useState("");
  const [contentType, setContentType] = useState<"video_text" | "video_only" | "text_only">("video_text");
  const [videoUrl, setVideoUrl] = useState("");
  const [content, setContent] = useState<any>(null);
  const [status, setStatus] = useState<"draft" | "published">("draft");
  const [sortOrder, setSortOrder] = useState(1);
  const [durationMinutes, setDurationMinutes] = useState(0);
  const [resources, setResources] = useState<LessonResource[]>([]);
  const [actionItems, setActionItems] = useState<ActionItem[]>([]);
  const [hasChanges, setHasChanges] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const autosaveTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (lesson) {
      setTitle(lesson.title);
      setContentType(lesson.contentType);
      setVideoUrl(lesson.videoUrl || "");
      setContent(lesson.content);
      setStatus(lesson.status);
      setSortOrder(lesson.sortOrder);
      setDurationMinutes(lesson.durationMinutes);
      setResources(lesson.resources || []);
      setActionItems(lesson.actionItems || []);
      setHasChanges(false);
    }
  }, [lesson]);

  const markChanged = useCallback(() => {
    setHasChanges(true);
  }, []);

  const saveLesson = useCallback(() => {
    if (!lessonId) return;
    saveMutation.mutate(
      {
        id: lessonId,
        title,
        contentType,
        videoUrl: videoUrl || null,
        content,
        status,
        sortOrder,
        durationMinutes,
        resources,
        actionItems,
      },
      {
        onSuccess: () => {
          setHasChanges(false);
          setLastSaved(new Date());
        },
      }
    );
  }, [lessonId, title, contentType, videoUrl, content, status, sortOrder, durationMinutes, resources, actionItems, saveMutation]);

  useEffect(() => {
    if (autosaveTimerRef.current) {
      clearInterval(autosaveTimerRef.current);
    }
    autosaveTimerRef.current = setInterval(() => {
      if (hasChanges && !saveMutation.isPending) {
        saveLesson();
      }
    }, 30000);
    return () => {
      if (autosaveTimerRef.current) clearInterval(autosaveTimerRef.current);
    };
  }, [hasChanges, saveLesson, saveMutation.isPending]);

  if (isLoading) {
    return (
      <AppLayout>
        <div className="animate-pulse space-y-4">
          <div className="h-8 w-48 bg-card rounded" />
          <div className="h-96 bg-card rounded-xl" />
        </div>
      </AppLayout>
    );
  }

  if (!lesson && !isLoading) {
    return (
      <AppLayout>
        <div className="text-center py-12">
          <AlertCircle className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
          <h2 className="text-lg font-semibold">Lesson not found</h2>
          <Link href="/admin/content/tracks">
            <Button variant="outline" className="mt-4">Back to Content</Button>
          </Link>
        </div>
      </AppLayout>
    );
  }

  const showVideo = contentType === "video_text" || contentType === "video_only";
  const showText = contentType === "video_text" || contentType === "text_only";

  return (
    <AppLayout>
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/admin/content/tracks">
              <Button variant="ghost" size="sm" className="text-muted-foreground">
                <ArrowLeft className="w-4 h-4 mr-1" /> Back
              </Button>
            </Link>
            <div className="flex items-center gap-2">
              {hasChanges ? (
                <Badge variant="outline" className="text-yellow-600 border-yellow-300 bg-yellow-50">
                  <AlertCircle className="w-3 h-3 mr-1" /> Unsaved changes
                </Badge>
              ) : lastSaved ? (
                <Badge variant="outline" className="text-green-600 border-green-300 bg-green-50">
                  <CheckCircle2 className="w-3 h-3 mr-1" /> Saved {lastSaved.toLocaleTimeString()}
                </Badge>
              ) : null}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setShowPreview(!showPreview)}>
              <Eye className="w-4 h-4 mr-1" /> {showPreview ? "Edit" : "Preview"}
            </Button>
            <Sheet>
              <SheetTrigger asChild>
                <Button variant="outline" size="sm">
                  <History className="w-4 h-4 mr-1" /> Versions
                </Button>
              </SheetTrigger>
              <SheetContent>
                <SheetHeader>
                  <SheetTitle>Version History</SheetTitle>
                </SheetHeader>
                <VersionHistory lessonId={lessonId} />
              </SheetContent>
            </Sheet>
            <Button onClick={saveLesson} disabled={saveMutation.isPending || !hasChanges}>
              <Save className="w-4 h-4 mr-1" /> {saveMutation.isPending ? "Saving..." : "Save"}
            </Button>
          </div>
        </div>

        {showPreview ? (
          <LessonPreview
            title={title}
            contentType={contentType}
            videoUrl={videoUrl}
            content={content}
            resources={resources}
            actionItems={actionItems}
            durationMinutes={durationMinutes}
          />
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-6">
              <Card className="p-6 space-y-4">
                <div>
                  <label className="text-sm font-medium text-foreground mb-1.5 block">Lesson Title</label>
                  <Input
                    value={title}
                    onChange={(e) => { setTitle(e.target.value); markChanged(); }}
                    placeholder="Enter lesson title..."
                    className="text-lg font-semibold"
                  />
                </div>

                <div>
                  <label className="text-sm font-medium text-foreground mb-1.5 block">Content Type</label>
                  <Select
                    value={contentType}
                    onValueChange={(v) => { setContentType(v as any); markChanged(); }}
                  >
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
              </Card>

              {showVideo && (
                <Card className="p-6 space-y-4">
                  <h3 className="font-semibold text-foreground">Video</h3>
                  <Input
                    value={videoUrl}
                    onChange={(e) => { setVideoUrl(e.target.value); markChanged(); }}
                    placeholder="Paste YouTube, Vimeo, or Wistia URL..."
                  />
                  <VideoEmbed url={videoUrl} />
                </Card>
              )}

              {showText && (
                <Card className="p-6 space-y-4">
                  <h3 className="font-semibold text-foreground">Lesson Content</h3>
                  <RichTextEditor
                    content={content}
                    onChange={(json) => { setContent(json); markChanged(); }}
                    placeholder="Start writing your lesson content..."
                  />
                </Card>
              )}

              <Card className="p-6 space-y-4">
                <h3 className="font-semibold text-foreground">Resources</h3>
                <ResourceUpload
                  resources={resources}
                  onChange={(r) => { setResources(r); markChanged(); }}
                />
              </Card>

              <Card className="p-6 space-y-4">
                <h3 className="font-semibold text-foreground">Action Items</h3>
                <p className="text-xs text-muted-foreground">Add checklist items for members to complete after this lesson.</p>
                <ActionItemsEditor
                  items={actionItems}
                  onChange={(items) => { setActionItems(items); markChanged(); }}
                />
              </Card>
            </div>

            <div className="space-y-6">
              <Card className="p-6 space-y-4">
                <h3 className="font-semibold text-foreground">Settings</h3>

                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-foreground">Published</p>
                    <p className="text-xs text-muted-foreground">Make visible to members</p>
                  </div>
                  <Switch
                    checked={status === "published"}
                    onCheckedChange={(checked) => { setStatus(checked ? "published" : "draft"); markChanged(); }}
                  />
                </div>

                <div>
                  <label className="text-sm font-medium text-foreground mb-1.5 block">Sort Order</label>
                  <Input
                    type="number"
                    value={sortOrder}
                    onChange={(e) => { setSortOrder(parseInt(e.target.value) || 0); markChanged(); }}
                    min={1}
                  />
                </div>

                <div>
                  <label className="text-sm font-medium text-foreground mb-1.5 block">
                    <Clock className="w-3.5 h-3.5 inline mr-1" /> Estimated Time (minutes)
                  </label>
                  <Input
                    type="number"
                    value={durationMinutes}
                    onChange={(e) => { setDurationMinutes(parseInt(e.target.value) || 0); markChanged(); }}
                    min={0}
                  />
                </div>
              </Card>

              <Card className="p-6">
                <h3 className="font-semibold text-foreground mb-3">Status</h3>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Status</span>
                    <Badge variant={status === "published" ? "default" : "secondary"}>{status}</Badge>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Content Type</span>
                    <span className="text-foreground">{contentType.replace(/_/g, " ")}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Resources</span>
                    <span className="text-foreground">{resources.length} files</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Action Items</span>
                    <span className="text-foreground">{actionItems.length} items</span>
                  </div>
                </div>
              </Card>
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  );
}

function LessonPreview({
  title,
  contentType,
  videoUrl,
  content,
  resources,
  actionItems,
  durationMinutes,
}: {
  title: string;
  contentType: string;
  videoUrl: string;
  content: any;
  resources: LessonResource[];
  actionItems: ActionItem[];
  durationMinutes: number;
}) {
  const showVideo = contentType === "video_text" || contentType === "video_only";
  const showText = contentType === "video_text" || contentType === "text_only";

  return (
    <Card className="max-w-3xl mx-auto overflow-hidden">
      <div className="p-8 space-y-6">
        <div className="border-b border-border pb-6">
          <Badge variant="outline" className="mb-3 text-xs">Preview Mode</Badge>
          <h1 className="text-3xl font-bold text-foreground">{title || "Untitled Lesson"}</h1>
          {durationMinutes > 0 && (
            <p className="text-sm text-muted-foreground mt-2 flex items-center gap-1">
              <Clock className="w-4 h-4" /> {durationMinutes} min
            </p>
          )}
        </div>

        {showVideo && videoUrl && (
          <VideoEmbed url={videoUrl} className="rounded-xl overflow-hidden" />
        )}

        {showText && content && (
          <div className="prose prose-sm max-w-none">
            <TipTapContentRenderer content={content} />
          </div>
        )}

        {resources.length > 0 && (
          <div className="border-t border-border pt-6">
            <h3 className="font-semibold text-foreground mb-3">Resources</h3>
            <div className="space-y-2">
              {resources.map((r) => (
                <div key={r.id} className="flex items-center gap-3 p-3 bg-secondary/30 rounded-lg">
                  <span className="text-lg">📎</span>
                  <div className="flex-1">
                    <p className="text-sm font-medium">{r.name}</p>
                    <p className="text-xs text-muted-foreground">{(r.size / 1024).toFixed(1)} KB</p>
                  </div>
                  <Button variant="outline" size="sm">Download</Button>
                </div>
              ))}
            </div>
          </div>
        )}

        {actionItems.length > 0 && (
          <div className="border-t border-border pt-6">
            <h3 className="font-semibold text-foreground mb-3">Action Items</h3>
            <div className="space-y-2">
              {actionItems.map((item) => (
                <label key={item.id} className="flex items-center gap-3 p-2 rounded hover:bg-secondary/30 cursor-pointer">
                  <input type="checkbox" className="w-4 h-4 rounded border-2" />
                  <span className="text-sm">{item.text}</span>
                </label>
              ))}
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}

export { TipTapContentRenderer } from "@/components/admin/TipTapRenderer";
