import { useListTracks } from "@workspace/api-client-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  BookOpen,
  Clock,
  Lock,
  ArrowUpRight,
  GraduationCap,
  Rocket,
  Mail,
  BarChart3,
  Target,
  Compass,
  Megaphone,
  Trophy,
  ChevronRight,
  CheckCircle2,
  PlayCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatDuration } from "@/lib/utils";
import { Link } from "wouter";
import { supportLinkProps } from "@/config/support";

const entitlementLabels: Record<string, string> = {
  "content:frontend": "Front-End Content",
  "content:advanced": "Advanced Content",
};

const trackMeta: Record<number, { icon: any; color: string; gradient: string }> = {
  1: { icon: Compass, color: "text-blue-600", gradient: "from-blue-50 to-blue-100/50" },
  2: { icon: Megaphone, color: "text-violet-600", gradient: "from-violet-50 to-violet-100/50" },
  3: { icon: Target, color: "text-amber-600", gradient: "from-amber-50 to-amber-100/50" },
  4: { icon: BarChart3, color: "text-emerald-600", gradient: "from-emerald-50 to-emerald-100/50" },
  5: { icon: Rocket, color: "text-sky-600", gradient: "from-sky-50 to-sky-100/50" },
  6: { icon: Mail, color: "text-rose-600", gradient: "from-rose-50 to-rose-100/50" },
  7: { icon: BarChart3, color: "text-teal-600", gradient: "from-teal-50 to-teal-100/50" },
  8: { icon: Trophy, color: "text-orange-600", gradient: "from-orange-50 to-orange-100/50" },
};

export default function Training() {
  const { data: tracks, isLoading } = useListTracks();

  const totalLessons = tracks?.reduce((s, t) => s + (t.totalLessons || 0), 0) || 0;
  const completedLessons = tracks?.reduce((s, t) => {
    const completed = t.modules?.reduce(
      (ms: number, m: any) => ms + (m.completedLessons || 0),
      0
    ) || 0;
    return s + completed;
  }, 0) || 0;
  const totalMinutes = tracks?.reduce((s, t) => s + (t.estimatedMinutes || 0), 0) || 0;
  const overallProgress = totalLessons > 0 ? Math.round((completedLessons / totalLessons) * 100) : 0;

  const currentTrack = tracks?.find(t => !t.isLocked && t.progress > 0 && t.progress < 100);
  const nextTrack = tracks?.find(t => !t.isLocked && t.progress === 0);

  if (isLoading) {
    return (
      <AppLayout>
        <div className="max-w-5xl mx-auto animate-pulse space-y-6">
          <div className="h-10 w-48 bg-card rounded"></div>
          <div className="h-32 bg-card rounded-xl"></div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="h-64 bg-card rounded-xl"></div>
            <div className="h-64 bg-card rounded-xl"></div>
          </div>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="max-w-5xl mx-auto space-y-8">
        <div>
          <h1 className="text-3xl font-bold text-foreground mb-2">Training Library</h1>
          <p className="text-muted-foreground text-lg">Master the systems required to build, test, and scale your campaigns.</p>
        </div>

        <Card className="overflow-hidden border-border bg-gradient-to-r from-[#1a56db]/5 via-white to-[#2d8a4e]/5">
          <div className="p-6 md:p-8">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
              <div className="text-center">
                <div className="text-3xl font-bold text-foreground">{tracks?.length || 0}</div>
                <div className="text-sm text-muted-foreground mt-1">Tracks</div>
              </div>
              <div className="text-center">
                <div className="text-3xl font-bold text-foreground">{totalLessons}</div>
                <div className="text-sm text-muted-foreground mt-1">Lessons</div>
              </div>
              <div className="text-center">
                <div className="text-3xl font-bold text-foreground">{formatDuration(totalMinutes)}</div>
                <div className="text-sm text-muted-foreground mt-1">Total Content</div>
              </div>
              <div className="text-center">
                <div className="text-3xl font-bold text-primary">{overallProgress}%</div>
                <div className="text-sm text-muted-foreground mt-1">Complete</div>
              </div>
            </div>
            <div className="mt-6">
              <div className="flex justify-between text-xs font-medium mb-2">
                <span className="text-muted-foreground">Overall Progress</span>
                <span className="text-foreground">{completedLessons} / {totalLessons} lessons</span>
              </div>
              <Progress value={overallProgress} className="h-2.5" />
            </div>
          </div>
        </Card>

        {currentTrack && (
          <Card className="overflow-hidden border-primary/20 bg-primary/[0.02]">
            <div className="p-5 md:p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                  <PlayCircle className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <p className="text-xs font-semibold text-primary uppercase tracking-wider mb-0.5">Continue Where You Left Off</p>
                  <p className="text-base font-semibold text-foreground">{currentTrack.title}</p>
                  <p className="text-sm text-muted-foreground">{currentTrack.progress}% complete</p>
                </div>
              </div>
              <Link href={`/training/modules/${currentTrack.modules?.find((m: any) => m.progress < 100)?.id || currentTrack.modules?.[0]?.id}`}>
                <Button size="sm">
                  Continue <ChevronRight className="w-4 h-4 ml-1" />
                </Button>
              </Link>
            </div>
          </Card>
        )}

        <div className="space-y-5">
          {tracks?.map((track, index) => {
            const meta = trackMeta[track.id] || { icon: GraduationCap, color: "text-gray-600", gradient: "from-gray-50 to-gray-100/50" };
            const Icon = meta.icon;
            const isComplete = track.progress === 100;

            return (
              <Card
                key={track.id}
                className={`overflow-hidden border-border transition-all ${track.isLocked ? "opacity-75" : "hover:shadow-md hover:border-border/80"}`}
              >
                <div className={`bg-gradient-to-r ${meta.gradient} border-b border-border/30`}>
                  <div className="p-6 md:p-8 flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div className="flex items-start gap-4">
                      <div className={`w-12 h-12 rounded-xl bg-white shadow-sm flex items-center justify-center shrink-0 ${meta.color}`}>
                        {isComplete ? <CheckCircle2 className="w-6 h-6 text-green-500" /> : <Icon className="w-6 h-6" />}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <span className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Track {index + 1}</span>
                          {track.isLocked && (
                            <Badge variant="locked" className="flex items-center gap-1 text-xs">
                              <Lock className="w-3 h-3" /> Locked
                            </Badge>
                          )}
                          {isComplete && (
                            <Badge variant="outline" className="text-green-600 border-green-300 bg-green-50 text-xs">
                              Complete
                            </Badge>
                          )}
                        </div>
                        <h2 className="text-xl md:text-2xl font-bold text-foreground leading-tight">{track.title}</h2>
                        <p className="text-muted-foreground text-sm leading-relaxed mt-1.5 line-clamp-2">{track.description}</p>
                      </div>
                    </div>
                    <div className="flex gap-5 shrink-0 md:text-right pl-16 md:pl-0">
                      <div>
                        <div className="text-lg font-bold text-foreground">{track.totalModules}</div>
                        <div className="text-xs text-muted-foreground">Modules</div>
                      </div>
                      <div>
                        <div className="text-lg font-bold text-foreground">{track.totalLessons}</div>
                        <div className="text-xs text-muted-foreground">Lessons</div>
                      </div>
                      <div>
                        <div className="text-lg font-bold text-foreground">{formatDuration(track.estimatedMinutes)}</div>
                        <div className="text-xs text-muted-foreground">Time</div>
                      </div>
                    </div>
                  </div>
                </div>

                {track.isLocked && (
                  <div className="p-6">
                    <div className="bg-yellow-50/80 border border-yellow-200 rounded-lg p-4 flex items-center gap-3 mb-4">
                      <ArrowUpRight className="w-4 h-4 text-yellow-600 shrink-0" />
                      <span className="text-sm text-yellow-700">
                        Requires <strong>{entitlementLabels[track.requiredEntitlement] ?? track.requiredEntitlement}</strong> — upgrade your plan to unlock.
                      </span>
                    </div>
                    <div className="text-center py-4">
                      <Lock className="w-8 h-8 text-muted-foreground/30 mx-auto mb-2" />
                      <p className="text-sm text-muted-foreground mb-4">{track.totalLessons} lessons available after upgrading</p>
                      <a {...supportLinkProps}>
                        <Button variant="outline">Contact Support to Upgrade</Button>
                      </a>
                    </div>
                  </div>
                )}

                {!track.isLocked && (
                  <div className="p-6 md:p-8 pt-5 md:pt-5">
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-2 text-sm">
                        <span className="font-semibold text-foreground">{track.progress}%</span>
                        <span className="text-muted-foreground">complete</span>
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {track.modules?.reduce((s: number, m: any) => s + (m.completedLessons || 0), 0) || 0} / {track.totalLessons} lessons
                      </span>
                    </div>
                    <Progress value={track.progress} className="h-2 mb-5" />

                    <div className="rounded-xl border border-border/60 overflow-hidden divide-y divide-border/40">
                      {track.modules.map((module: any, mi: number) => {
                        const moduleComplete = module.completedLessons === module.totalLessons && module.totalLessons > 0;
                        return (
                          <Link key={module.id} href={`/training/modules/${module.id}`}>
                            <div className="p-4 flex items-center justify-between hover:bg-[#faf9f7] transition-colors cursor-pointer group">
                              <div className="flex items-center gap-3.5 min-w-0">
                                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold shrink-0 transition-colors ${
                                  moduleComplete
                                    ? "bg-green-100 text-green-600"
                                    : "bg-secondary text-muted-foreground group-hover:bg-primary group-hover:text-primary-foreground"
                                }`}>
                                  {moduleComplete ? <CheckCircle2 className="w-4 h-4" /> : mi + 1}
                                </div>
                                <div className="min-w-0">
                                  <h4 className="font-semibold text-foreground group-hover:text-primary transition-colors text-sm md:text-base truncate">
                                    {module.title}
                                  </h4>
                                  <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
                                    <span className="flex items-center gap-1">
                                      <BookOpen className="w-3 h-3" /> {module.totalLessons} lessons
                                    </span>
                                    <span>{module.completedLessons}/{module.totalLessons} done</span>
                                  </div>
                                </div>
                              </div>
                              <div className="flex items-center gap-3 shrink-0">
                                <div className="hidden sm:block w-24">
                                  <Progress value={module.progress} className="h-1.5" />
                                </div>
                                <span className="text-xs font-semibold text-muted-foreground w-8 text-right">{module.progress}%</span>
                                <ChevronRight className="w-4 h-4 text-muted-foreground/50 group-hover:text-primary transition-colors" />
                              </div>
                            </div>
                          </Link>
                        );
                      })}
                    </div>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      </div>
    </AppLayout>
  );
}
