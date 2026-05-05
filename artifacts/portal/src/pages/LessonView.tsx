import { useState, useCallback } from "react";
import { useParams, Link } from "wouter";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { ArrowLeft, Clock, Download, Lock, CheckCircle2, ChevronLeft, ChevronRight } from "lucide-react";
import { VideoEmbed } from "@/components/admin/VideoEmbed";
// @ts-ignore - hooks exist in generated API but may have type resolution issues across workspace
import { useGetLesson, useGetModule, useMarkLessonComplete, getGetLessonQueryKey, getGetModuleQueryKey, getListTracksQueryKey } from "@workspace/api-client-react";
import type { LessonActionItem } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { TipTapContentRenderer } from "@/components/admin/TipTapRenderer";
import { formatDuration } from "@/lib/utils";

export default function LessonView() {
  const { id } = useParams();
  const lessonId = parseInt(id || "0", 10);
  const { data: lesson, isLoading } = useGetLesson(lessonId);
  const markComplete = useMarkLessonComplete();
  const queryClient = useQueryClient();
  const [checkedItems, setCheckedItems] = useState<Set<string>>(new Set());

  const lessonData = lesson as any;
  const moduleId = lessonData?.moduleId;
  // @ts-ignore - generated types may not match exactly
  const { data: moduleData } = useGetModule(moduleId || 0, moduleId ? undefined : { query: { enabled: false } });

  const toggleActionItem = useCallback((itemId: string) => {
    setCheckedItems((prev) => {
      const next = new Set(prev);
      next.has(itemId) ? next.delete(itemId) : next.add(itemId);
      return next;
    });
  }, []);

  const handleMarkComplete = () => {
    markComplete.mutate(
      { data: { lessonId } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetLessonQueryKey(lessonId) });
          if (moduleId) {
            queryClient.invalidateQueries({ queryKey: getGetModuleQueryKey(moduleId) });
          }
          queryClient.invalidateQueries({ queryKey: getListTracksQueryKey() });
        },
      }
    );
  };

  if (isLoading) {
    return (
      <AppLayout>
        <div className="max-w-3xl mx-auto animate-pulse space-y-4">
          <div className="h-8 w-48 bg-card rounded" />
          <div className="h-96 bg-card rounded-xl" />
        </div>
      </AppLayout>
    );
  }

  if (!lesson) {
    return (
      <AppLayout>
        <div className="max-w-3xl mx-auto text-center py-12">
          <h2 className="text-lg font-semibold">Lesson not found</h2>
          <Link href="/training">
            <Button variant="outline" className="mt-4">Back to Training</Button>
          </Link>
        </div>
      </AppLayout>
    );
  }

  const showVideo = (lessonData.contentType === "video_text" || lessonData.contentType === "video_only") && lessonData.videoUrl;
  const showText = (lessonData.contentType === "video_text" || lessonData.contentType === "text_only") && lessonData.content;
  const resources = lessonData.resources || [];
  const actionItems: LessonActionItem[] = lessonData.actionItems || [];

  const moduleLessons = (moduleData as any)?.lessons || [];
  const currentIndex = moduleLessons.findIndex((l: any) => l.id === lessonId);
  const prevLesson = currentIndex > 0 ? moduleLessons[currentIndex - 1] : null;
  const nextLesson = currentIndex >= 0 && currentIndex < moduleLessons.length - 1 ? moduleLessons[currentIndex + 1] : null;
  const totalInModule = moduleLessons.length;
  const lessonNumber = currentIndex >= 0 ? currentIndex + 1 : null;

  return (
    <AppLayout>
      <div className="max-w-3xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <Link href={moduleId ? `/training/modules/${moduleId}` : "/training"}>
            <Button variant="ghost" className="pl-0 hover:bg-transparent hover:text-primary -ml-2 text-muted-foreground">
              <ArrowLeft className="w-4 h-4 mr-2" /> Back to Module
            </Button>
          </Link>
          {lessonNumber && totalInModule > 0 && (
            <span className="text-xs font-medium text-muted-foreground bg-secondary px-3 py-1.5 rounded-full">
              Lesson {lessonNumber} of {totalInModule}
            </span>
          )}
        </div>

        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-foreground mb-3">{lessonData.title}</h1>
          <div className="flex items-center gap-4 text-sm text-muted-foreground flex-wrap">
            {lessonData.durationMinutes > 0 && (
              <span className="flex items-center gap-1">
                <Clock className="w-4 h-4" /> {formatDuration(lessonData.durationMinutes)}
              </span>
            )}
            {lessonData.isCompleted && (
              <Badge variant="outline" className="text-green-600 border-green-300 bg-green-50">
                <CheckCircle2 className="w-3 h-3 mr-1" /> Completed
              </Badge>
            )}
          </div>
        </div>

        {totalInModule > 0 && (
          <div>
            <div className="flex justify-between text-xs text-muted-foreground mb-1.5">
              <span>Module progress</span>
              <span>{moduleLessons.filter((l: any) => l.isCompleted).length}/{totalInModule}</span>
            </div>
            <Progress value={Math.round((moduleLessons.filter((l: any) => l.isCompleted).length / totalInModule) * 100)} className="h-1.5" />
          </div>
        )}

        {showVideo && (
          <VideoEmbed url={lessonData.videoUrl} className="rounded-xl overflow-hidden shadow-sm" />
        )}

        {showText && (
          <Card className="p-6 md:p-8">
            <div className="prose prose-sm max-w-none prose-headings:text-foreground prose-p:text-foreground/80 prose-a:text-primary prose-strong:text-foreground prose-blockquote:border-primary/30 prose-code:bg-secondary prose-code:px-1 prose-code:py-0.5 prose-code:rounded">
              <TipTapContentRenderer content={lessonData.content} />
            </div>
          </Card>
        )}

        {resources.length > 0 && (
          <Card className="p-6">
            <h3 className="font-semibold text-foreground mb-4">Downloadable Resources</h3>
            <div className="space-y-3">
              {resources.map((resource: any) => {
                const isLocked = resource.requiredEntitlement && !lessonData.entitlements?.includes(resource.requiredEntitlement);
                return (
                  <div
                    key={resource.id}
                    className={`flex items-center gap-3 p-3 rounded-lg border ${
                      isLocked ? "bg-secondary/20 border-border/50 opacity-60" : "bg-secondary/30 border-border/50 hover:bg-secondary/50"
                    } transition-colors`}
                  >
                    <span className="text-lg shrink-0">📎</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">{resource.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {resource.size ? `${(resource.size / 1024).toFixed(1)} KB` : ""}
                        {resource.type ? ` · ${resource.type.split("/").pop()?.toUpperCase()}` : ""}
                      </p>
                    </div>
                    {isLocked ? (
                      <Badge variant="outline" className="text-xs shrink-0">
                        <Lock className="w-3 h-3 mr-1" /> Upgrade
                      </Badge>
                    ) : (
                      <a href={resource.url} download={resource.name} target="_blank" rel="noopener noreferrer">
                        <Button variant="outline" size="sm" className="shrink-0">
                          <Download className="w-3.5 h-3.5 mr-1" /> Download
                        </Button>
                      </a>
                    )}
                  </div>
                );
              })}
            </div>
          </Card>
        )}

        {actionItems.length > 0 && (
          <Card className="p-6">
            <h3 className="font-semibold text-foreground mb-4">Action Items</h3>
            <p className="text-xs text-muted-foreground mb-3">Complete these items to get the most out of this lesson.</p>
            <div className="space-y-2">
              {actionItems.map((item) => (
                <label
                  key={item.id}
                  className="flex items-start gap-3 p-3 rounded-lg hover:bg-secondary/30 cursor-pointer transition-colors"
                >
                  <Checkbox
                    checked={checkedItems.has(item.id)}
                    onCheckedChange={() => toggleActionItem(item.id)}
                    className="mt-0.5"
                  />
                  <span className={`text-sm ${checkedItems.has(item.id) ? "line-through text-muted-foreground" : "text-foreground"}`}>
                    {item.text}
                  </span>
                </label>
              ))}
            </div>
            <div className="mt-4 pt-3 border-t border-border">
              <p className="text-xs text-muted-foreground">
                {checkedItems.size}/{actionItems.length} completed
              </p>
            </div>
          </Card>
        )}

        {!lessonData.isCompleted && !lessonData.isLocked && (
          <div className="flex justify-center pt-2">
            <Button size="lg" onClick={handleMarkComplete} disabled={markComplete.isPending} className="px-8">
              <CheckCircle2 className="w-5 h-5 mr-2" />
              {markComplete.isPending ? "Marking Complete..." : "Mark as Complete"}
            </Button>
          </div>
        )}

        {(prevLesson || nextLesson) && (
          <Card className="overflow-hidden mt-4">
            <div className={`grid ${prevLesson && nextLesson ? 'grid-cols-2 divide-x divide-border/50' : 'grid-cols-1'}`}>
              {prevLesson && (
                <Link href={`/training/lessons/${prevLesson.id}`}>
                  <div className="p-4 md:p-5 hover:bg-[#faf9f7] transition-colors cursor-pointer group">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                      <ChevronLeft className="w-3 h-3" /> Previous Lesson
                    </div>
                    <p className="font-medium text-foreground group-hover:text-primary transition-colors text-sm truncate">
                      {prevLesson.title}
                    </p>
                  </div>
                </Link>
              )}
              {nextLesson && (
                <Link href={`/training/lessons/${nextLesson.id}`}>
                  <div className={`p-4 md:p-5 hover:bg-[#faf9f7] transition-colors cursor-pointer group ${!prevLesson ? '' : 'text-right'}`}>
                    <div className={`flex items-center gap-2 text-xs text-muted-foreground mb-1 ${!prevLesson ? '' : 'justify-end'}`}>
                      Next Lesson <ChevronRight className="w-3 h-3" />
                    </div>
                    <p className="font-medium text-foreground group-hover:text-primary transition-colors text-sm truncate">
                      {nextLesson.title}
                    </p>
                  </div>
                </Link>
              )}
            </div>
          </Card>
        )}
      </div>
    </AppLayout>
  );
}
