import { useGetModule, useMarkLessonComplete } from "@workspace/api-client-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PlayCircle, CheckCircle2, Lock, ArrowLeft, Clock } from "lucide-react";
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

  if (isLoading) return <AppLayout><div className="animate-pulse h-96 bg-card rounded-xl" /></AppLayout>;
  if (!moduleData) return <AppLayout><div>Not found</div></AppLayout>;

  const handleMarkComplete = (lessonId: number) => {
    markComplete.mutate({ data: { lessonId } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetModuleQueryKey(moduleId) });
      }
    });
  };

  return (
    <AppLayout>
      <div className="max-w-4xl mx-auto space-y-6">
        <Link href="/training">
          <Button variant="ghost" className="pl-0 hover:bg-transparent hover:text-primary -ml-2 text-muted-foreground">
            <ArrowLeft className="w-4 h-4 mr-2" /> Back to Library
          </Button>
        </Link>

        <div>
          <p className="text-sm font-bold text-primary tracking-widest uppercase mb-2">Module {moduleData.sortOrder}</p>
          <h1 className="text-3xl font-bold text-foreground mb-3">{moduleData.title}</h1>
          <p className="text-lg text-muted-foreground leading-relaxed">{moduleData.description}</p>
        </div>

        <div className="space-y-4 pt-6">
          {moduleData.lessons.map((lesson) => (
            <Card key={lesson.id} className={`overflow-hidden transition-all ${lesson.isLocked ? 'opacity-75 bg-secondary/30' : 'hover:shadow-md border-border'}`}>
              <div className="p-6">
                <div className="flex items-start justify-between gap-6">
                  <div className="flex gap-4">
                    <div className="shrink-0 mt-1">
                      {lesson.isLocked ? (
                        <Lock className="w-6 h-6 text-muted-foreground" />
                      ) : lesson.isCompleted ? (
                        <CheckCircle2 className="w-6 h-6 text-green-500" />
                      ) : (
                        <PlayCircle className="w-6 h-6 text-primary" />
                      )}
                    </div>
                    <div>
                      <h3 className={`text-xl font-semibold mb-2 ${lesson.isLocked ? 'text-muted-foreground' : 'text-foreground'}`}>
                        {lesson.sortOrder}. {lesson.title}
                      </h3>
                      <p className="text-muted-foreground text-sm leading-relaxed mb-4">
                        {lesson.description}
                      </p>
                      <div className="flex items-center gap-4 text-xs font-medium text-muted-foreground">
                        <span className="flex items-center gap-1"><Clock className="w-3.5 h-3.5" /> {formatDuration(lesson.durationMinutes)}</span>
                        {lesson.isLocked && (
                          <span className="text-orange-600 bg-orange-50 px-2 py-0.5 rounded border border-orange-100 uppercase tracking-wide">
                            Upgrade Required
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  
                  {!lesson.isLocked && (
                    <div className="shrink-0">
                      {lesson.isCompleted ? (
                        <Button variant="secondary" className="bg-green-50 text-green-700 hover:bg-green-100 border border-green-200 cursor-default" disabled>
                          <CheckCircle2 className="w-4 h-4 mr-2" /> Completed
                        </Button>
                      ) : (
                        <Button 
                          onClick={() => handleMarkComplete(lesson.id)}
                          isLoading={markComplete.isPending}
                        >
                          Mark Complete
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      </div>
    </AppLayout>
  );
}
