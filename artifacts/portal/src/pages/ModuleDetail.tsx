import { useGetModule, useMarkLessonComplete } from "@workspace/api-client-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { PlayCircle, CheckCircle2, Lock, ArrowLeft, Clock, BookOpen, ChevronRight } from "lucide-react";
import { Link, useParams } from "wouter";
import { formatDuration } from "@/lib/utils";
import { useQueryClient } from "@tanstack/react-query";
import { getGetModuleQueryKey } from "@workspace/api-client-react";

export default function ModuleDetail() {
  const { id } = useParams();
  const moduleId = parseInt(id || "1", 10);
  const { data: moduleData, isLoading } = useGetModule(moduleId);
  const markComplete = useMarkLessonComplete();
  const queryClient = useQueryClient();

  if (isLoading) {
    return (
      <AppLayout>
        <div className="max-w-4xl mx-auto animate-pulse space-y-6">
          <div className="h-8 w-32 bg-card rounded" />
          <div className="h-24 bg-card rounded-xl" />
          <div className="space-y-3">
            <div className="h-20 bg-card rounded-xl" />
            <div className="h-20 bg-card rounded-xl" />
            <div className="h-20 bg-card rounded-xl" />
          </div>
        </div>
      </AppLayout>
    );
  }

  if (!moduleData) return <AppLayout><div className="text-center py-12 text-muted-foreground">Module not found</div></AppLayout>;

  const handleMarkComplete = (lessonId: number) => {
    markComplete.mutate({ data: { lessonId } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetModuleQueryKey(moduleId) });
      }
    });
  };

  const lessons = (moduleData as any).lessons || [];
  const totalLessons = lessons.length;
  const completedLessons = lessons.filter((l: any) => l.isCompleted).length;
  const progress = totalLessons > 0 ? Math.round((completedLessons / totalLessons) * 100) : 0;
  const nextLesson = lessons.find((l: any) => !l.isCompleted && !l.isLocked);

  return (
    <AppLayout>
      <div className="max-w-4xl mx-auto space-y-6">
        <Link href="/training">
          <Button variant="ghost" className="pl-0 hover:bg-transparent hover:text-primary -ml-2 text-muted-foreground">
            <ArrowLeft className="w-4 h-4 mr-2" /> Back to Library
          </Button>
        </Link>

        <Card className="overflow-hidden border-border">
          <div className="p-6 md:p-8">
            <p className="text-xs font-bold text-primary tracking-widest uppercase mb-2">Module {moduleData.sortOrder}</p>
            <h1 className="text-2xl md:text-3xl font-bold text-foreground mb-2">{moduleData.title}</h1>
            <p className="text-muted-foreground leading-relaxed mb-6">{moduleData.description}</p>

            <div className="flex flex-wrap items-center gap-6 mb-5 text-sm">
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <BookOpen className="w-4 h-4" />
                <span>{totalLessons} lessons</span>
              </div>
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <CheckCircle2 className="w-4 h-4" />
                <span>{completedLessons} completed</span>
              </div>
            </div>

            <div className="flex items-center justify-between mb-2 text-xs">
              <span className="text-muted-foreground font-medium">Module Progress</span>
              <span className="font-semibold text-foreground">{progress}%</span>
            </div>
            <Progress value={progress} className="h-2" />

            {nextLesson && (
              <div className="mt-5 pt-5 border-t border-border/50">
                <Link href={`/training/lessons/${nextLesson.id}`}>
                  <Button size="sm">
                    <PlayCircle className="w-4 h-4 mr-2" />
                    {completedLessons > 0 ? "Continue Next Lesson" : "Start First Lesson"}
                    <ChevronRight className="w-4 h-4 ml-1" />
                  </Button>
                </Link>
              </div>
            )}

            {progress === 100 && (
              <div className="mt-5 pt-5 border-t border-border/50 flex items-center gap-3 text-green-600">
                <CheckCircle2 className="w-5 h-5" />
                <span className="font-semibold text-sm">Module complete — great work!</span>
              </div>
            )}
          </div>
        </Card>

        <div className="space-y-3">
          {lessons.map((lesson: any, index: number) => {
            const isLocked = lesson.isLocked;
            const isDone = lesson.isCompleted;

            return (
              <Card
                key={lesson.id}
                className={`overflow-hidden transition-all ${
                  isLocked ? "opacity-60 bg-secondary/20" : isDone ? "border-green-200/60 bg-green-50/20" : "hover:shadow-md hover:border-border/80"
                }`}
              >
                <div className="p-4 md:p-5">
                  <div className="flex items-start gap-4">
                    <div className="shrink-0 mt-0.5">
                      {isLocked ? (
                        <div className="w-9 h-9 rounded-full bg-secondary flex items-center justify-center">
                          <Lock className="w-4 h-4 text-muted-foreground" />
                        </div>
                      ) : isDone ? (
                        <div className="w-9 h-9 rounded-full bg-green-100 flex items-center justify-center">
                          <CheckCircle2 className="w-5 h-5 text-green-500" />
                        </div>
                      ) : (
                        <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center">
                          <span className="text-sm font-bold text-primary">{index + 1}</span>
                        </div>
                      )}
                    </div>

                    <div className="flex-1 min-w-0">
                      <h3 className={`font-semibold mb-1 ${isLocked ? "text-muted-foreground" : "text-foreground"}`}>
                        {isLocked ? (
                          <span>{lesson.title}</span>
                        ) : (
                          <Link href={`/training/lessons/${lesson.id}`} className="hover:text-primary transition-colors">
                            {lesson.title}
                          </Link>
                        )}
                      </h3>
                      {lesson.description && (
                        <p className="text-sm text-muted-foreground leading-relaxed line-clamp-2 mb-2">{lesson.description}</p>
                      )}
                      <div className="flex items-center gap-4 text-xs text-muted-foreground">
                        {lesson.durationMinutes > 0 && (
                          <span className="flex items-center gap-1">
                            <Clock className="w-3 h-3" /> {formatDuration(lesson.durationMinutes)}
                          </span>
                        )}
                        {isLocked && (
                          <span className="text-orange-600 bg-orange-50 px-2 py-0.5 rounded border border-orange-100 text-xs font-medium">
                            Upgrade Required
                          </span>
                        )}
                        {isDone && (
                          <span className="text-green-600 font-medium">Completed</span>
                        )}
                      </div>
                    </div>

                    {!isLocked && (
                      <div className="shrink-0 flex items-center gap-2">
                        {!isDone && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-xs text-muted-foreground hover:text-foreground hidden sm:inline-flex"
                            onClick={() => handleMarkComplete(lesson.id)}
                            disabled={markComplete.isPending}
                          >
                            <CheckCircle2 className="w-3.5 h-3.5 mr-1" /> Done
                          </Button>
                        )}
                        <Link href={`/training/lessons/${lesson.id}`}>
                          <Button variant={isDone ? "ghost" : "outline"} size="sm">
                            {isDone ? "Review" : "Start"}
                            <ChevronRight className="w-3.5 h-3.5 ml-1" />
                          </Button>
                        </Link>
                      </div>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      </div>
    </AppLayout>
  );
}
