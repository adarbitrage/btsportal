import { useListTracks } from "@workspace/api-client-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { BookOpen, Clock, Lock } from "lucide-react";
import { formatDuration } from "@/lib/utils";
import { Link } from "wouter";

export default function Training() {
  const { data: tracks, isLoading } = useListTracks();

  if (isLoading) {
    return (
      <AppLayout>
        <div className="animate-pulse space-y-6">
          <div className="h-10 w-48 bg-card rounded"></div>
          <div className="h-64 bg-card rounded-xl"></div>
          <div className="h-64 bg-card rounded-xl"></div>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="max-w-4xl mx-auto space-y-8">
        <div>
          <h1 className="text-3xl font-bold text-foreground mb-2">Training Library</h1>
          <p className="text-muted-foreground">Master the systems required to build, test, and scale your campaigns.</p>
        </div>

        <div className="space-y-6">
          {tracks?.map(track => (
            <Card key={track.id} className="overflow-hidden border-border transition-shadow hover:shadow-md">
              <div className="p-6 md:p-8">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-6">
                  <div>
                    <h2 className="text-2xl font-bold text-foreground mb-2">{track.title}</h2>
                    <p className="text-muted-foreground leading-relaxed">{track.description}</p>
                  </div>
                  <div className="flex gap-4 md:flex-col md:text-right shrink-0">
                    <div className="text-sm">
                      <span className="font-semibold text-foreground block">{track.totalModules}</span>
                      <span className="text-muted-foreground text-xs uppercase tracking-wider">Modules</span>
                    </div>
                    <div className="text-sm">
                      <span className="font-semibold text-foreground block">{formatDuration(track.estimatedMinutes)}</span>
                      <span className="text-muted-foreground text-xs uppercase tracking-wider">Time</span>
                    </div>
                  </div>
                </div>

                <div className="space-y-2 mb-6">
                  <div className="flex justify-between text-xs font-semibold">
                    <span className="text-muted-foreground uppercase tracking-widest">Track Progress</span>
                    <span className="text-primary">{track.progress}%</span>
                  </div>
                  <Progress value={track.progress} className="h-2" />
                </div>

                <div className="bg-[#faf9f7] rounded-xl border border-border/50 divide-y divide-border/50">
                  {track.modules.map(module => (
                    <Link key={module.id} href={`/training/modules/${module.id}`}>
                      <div className="p-4 flex items-center justify-between hover:bg-white transition-colors cursor-pointer group">
                        <div className="flex items-center gap-4">
                          <div className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center text-muted-foreground group-hover:bg-primary group-hover:text-primary-foreground transition-colors font-semibold text-sm">
                            {module.sortOrder}
                          </div>
                          <div>
                            <h4 className="font-semibold text-foreground group-hover:text-primary transition-colors">{module.title}</h4>
                            <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">
                              <span className="flex items-center gap-1"><BookOpen className="w-3 h-3" /> {module.totalLessons} lessons</span>
                            </div>
                          </div>
                        </div>
                        
                        <div className="flex items-center gap-4">
                          <span className="text-xs font-medium text-muted-foreground">{module.progress}%</span>
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            </Card>
          ))}
        </div>
      </div>
    </AppLayout>
  );
}
