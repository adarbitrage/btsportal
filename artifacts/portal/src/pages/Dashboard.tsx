import { useGetDashboard, useGetCurrentMember } from "@workspace/api-client-react";
import { useVaultStats } from "@/lib/vault-api";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { BookOpen, Clock, Flame, Ticket as TicketIcon, Calendar, PlayCircle, MessageSquare, Video, ShieldCheck, Wrench, FolderOpen, Heart, ChevronRight } from "lucide-react";
import { format } from "date-fns";
import { Link } from "wouter";
import { CommissionsSummaryWidget } from "@/components/commissions/CommissionsSummaryWidget";
import { WinsSummaryWidget } from "@/components/wins/WinsSummaryWidget";
import { CoachingDashboardWidget } from "@/components/coaching/CoachingDashboardWidget";

export default function Dashboard() {
  const { data: dashboard, isLoading, error } = useGetDashboard();
  const { data: member } = useGetCurrentMember();
  const memberEntitlements = new Set(member?.entitlements ?? []);
  const hasCommissions = Array.from(memberEntitlements).some((e: string) => e.startsWith("commissions:"));
  const { data: vaultStats } = useVaultStats();

  if (isLoading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center h-64">
          <div className="animate-pulse space-y-4 w-full">
            <div className="h-32 bg-card rounded-xl"></div>
            <div className="grid grid-cols-4 gap-4">
              {[1, 2, 3, 4].map(i => <div key={i} className="h-24 bg-card rounded-xl"></div>)}
            </div>
          </div>
        </div>
      </AppLayout>
    );
  }

  if (error || !dashboard) {
    return (
      <AppLayout>
        <div className="text-center p-12 bg-white rounded-xl border border-border">
          <h2 className="text-xl font-semibold text-foreground">Could not load dashboard</h2>
          <p className="text-muted-foreground mt-2">Please try refreshing the page.</p>
        </div>
      </AppLayout>
    );
  }

  const ticketLimitText = dashboard.ticketLimit === -1 ? "Unlimited" : `${dashboard.ticketLimit}/month`;

  return (
    <AppLayout>
      <div className="space-y-8">
        <div className="bg-white rounded-2xl border border-border p-8 shadow-sm flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <h1 className="text-3xl font-bold text-foreground">Welcome back, {dashboard.memberName}.</h1>
              <Badge variant={dashboard.highestProductSlug as any}>{dashboard.highestProductName}</Badge>
            </div>
            <p className="text-muted-foreground">
              Member since {format(new Date(dashboard.memberSince), 'MMMM yyyy')} <span className="mx-2 opacity-50">•</span> Day {dashboard.daysSinceJoined} in the program
            </p>
            {dashboard.ownedProducts && dashboard.ownedProducts.length > 1 && (
              <div className="flex items-center gap-2 mt-2">
                <span className="text-xs text-muted-foreground">Products:</span>
                {dashboard.ownedProducts.map(slug => (
                  <Badge key={slug} variant={slug as any} className="text-[9px] px-2 py-0">{slug}</Badge>
                ))}
              </div>
            )}
          </div>
          {dashboard.nextLesson && (
            <Link href={`/training/modules/${dashboard.nextLesson.moduleName}`}>
              <Button size="lg" className="shadow-lg shadow-primary/20">
                <PlayCircle className="w-5 h-5 mr-2" />
                RESUME TRAINING
              </Button>
            </Link>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard 
            title="LESSONS COMPLETED" 
            value={dashboard.lessonsCompleted.toString()} 
            subtext={`of ${dashboard.totalLessons} accessible`}
            icon={BookOpen}
          />
          <StatCard 
            title="HOURS LEARNED" 
            value={dashboard.hoursLearned.toString()} 
            subtext="+2.5 this week"
            icon={Clock}
          />
          <StatCard 
            title="CURRENT STREAK" 
            value={`${dashboard.currentStreak} Days`} 
            subtext="Personal best: 14"
            icon={Flame}
            valueColor="text-primary"
          />
          <StatCard 
            title="TICKETS OPEN" 
            value={dashboard.openTickets.toString()} 
            subtext={`Limit: ${ticketLimitText}`}
            icon={TicketIcon}
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 space-y-8">
            <Card>
              <CardHeader className="pb-4 flex flex-row items-center justify-between border-b border-border/50">
                <div className="flex items-center gap-2 text-foreground font-semibold">
                  <BookOpen className="w-5 h-5 text-primary" />
                  Training Progress
                </div>
                <span className="text-sm font-bold text-primary">{dashboard.overallProgress}% COMPLETE</span>
              </CardHeader>
              <CardContent className="pt-6">
                <Progress value={dashboard.overallProgress} className="h-3 mb-6" />
                
                {dashboard.nextLesson && (
                  <div className="bg-secondary/50 rounded-xl p-5 border border-border/50">
                    <p className="text-xs font-bold text-primary tracking-widest uppercase mb-2">Up Next</p>
                    <h3 className="text-xl font-bold text-foreground mb-1">{dashboard.nextLesson.moduleName}</h3>
                    <p className="text-muted-foreground mb-4">{dashboard.nextLesson.lessonTitle}</p>
                    <Link href={`/training/modules/1`}>
                      <Button variant="outline" className="w-full sm:w-auto bg-white">
                        Continue Learning
                      </Button>
                    </Link>
                  </div>
                )}
              </CardContent>
            </Card>

            {dashboard.entitlements && dashboard.entitlements.length > 0 && (
              <Card>
                <CardHeader className="pb-4 border-b border-border/50">
                  <div className="flex items-center gap-2 text-foreground font-semibold">
                    <ShieldCheck className="w-5 h-5 text-primary" />
                    Your Access
                  </div>
                </CardHeader>
                <CardContent className="pt-4">
                  <div className="flex flex-wrap gap-2">
                    {dashboard.entitlements.map(ent => (
                      <span key={ent} className="text-[10px] font-mono bg-primary/5 text-primary border border-primary/10 px-2 py-1 rounded">
                        {ent}
                      </span>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {dashboard.recentAnnouncements.length > 0 && (
              <div>
                <h3 className="text-lg font-bold mb-4 text-foreground flex items-center gap-2">
                  <MessageSquare className="w-5 h-5 text-muted-foreground" />
                  Recent Announcements
                </h3>
                <div className="space-y-4">
                  {dashboard.recentAnnouncements.map(announcement => (
                    <Card key={announcement.id} className="bg-[#faf9f7] border-border/60 hover:shadow-md transition-shadow">
                      <CardContent className="p-5">
                        <div className="flex justify-between items-start mb-2">
                          <h4 className="font-bold text-foreground">{announcement.title}</h4>
                          <span className="text-xs text-muted-foreground">{format(new Date(announcement.createdAt), 'MMM d')}</span>
                        </div>
                        <p className="text-sm text-muted-foreground leading-relaxed">{announcement.body}</p>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="space-y-8">
            {(Array.from(memberEntitlements).some((e: string) => e.startsWith("coaching:one_on_one:"))) && (
              <CoachingDashboardWidget />
            )}
            {hasCommissions && <CommissionsSummaryWidget />}
            {dashboard.recentTools && dashboard.recentTools.length > 0 && (
              <Card>
                <CardHeader className="pb-4 border-b border-border/50">
                  <div className="flex items-center gap-2 text-foreground font-semibold">
                    <Wrench className="w-5 h-5 text-primary" />
                    Software & Tools
                  </div>
                </CardHeader>
                <CardContent className="pt-0 px-0">
                  <div className="divide-y divide-border">
                    {dashboard.recentTools.map((tool: any) => (
                      <Link key={tool.id} href={`/tools/${tool.slug}`}>
                        <div className="p-4 hover:bg-secondary/50 transition-colors cursor-pointer">
                          <h4 className="font-semibold text-sm text-foreground">{tool.name}</h4>
                          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{tool.shortDescription}</p>
                        </div>
                      </Link>
                    ))}
                  </div>
                  <div className="p-4 border-t border-border">
                    <Link href="/tools">
                      <Button variant="ghost" className="w-full text-primary hover:text-primary/80">View All Tools</Button>
                    </Link>
                  </div>
                </CardContent>
              </Card>
            )}

            <WinsSummaryWidget />

            <Card>
              <CardHeader className="pb-4 border-b border-border/50">
                <div className="flex items-center gap-2 text-foreground font-semibold">
                  <Video className="w-5 h-5 text-primary" />
                  Upcoming Calls
                </div>
              </CardHeader>
              <CardContent className="pt-0 px-0">
                {dashboard.upcomingCalls.length > 0 ? (
                  <div className="divide-y divide-border">
                    {dashboard.upcomingCalls.slice(0,3).map(call => (
                      <div key={call.id} className="p-5 hover:bg-secondary/50 transition-colors">
                        <div className="flex justify-between items-start mb-1">
                          <h4 className="font-semibold text-sm text-foreground">{call.title}</h4>
                          <Badge variant="outline" className="text-[10px] bg-white">{call.callType.replace('_', ' ')}</Badge>
                        </div>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground mt-2">
                          <Calendar className="w-3.5 h-3.5" />
                          <span>{format(new Date(call.scheduledAt), 'MMM d, h:mm a')}</span>
                        </div>
                        <div className="flex items-center justify-between mt-3">
                          <div className="flex items-center gap-2">
                            <div className="w-5 h-5 rounded-full bg-primary/10 flex items-center justify-center text-[8px] font-bold text-primary">
                              {call.coachName.charAt(0)}
                            </div>
                            <span className="text-xs text-muted-foreground">Coach {call.coachName.split(' ')[0]}</span>
                          </div>
                          {call.isAccessible ? (
                            <Button size="sm" variant="default" className="h-7 text-xs px-3">RSVP</Button>
                          ) : (
                            <Badge variant="locked" className="text-[10px]">Locked</Badge>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="p-6 text-center text-sm text-muted-foreground">No upcoming calls scheduled.</div>
                )}
                <div className="p-4 border-t border-border">
                  <Link href="/coaching">
                    <Button variant="ghost" className="w-full text-primary hover:text-primary/80">View Full Schedule</Button>
                  </Link>
                </div>
              </CardContent>
            </Card>

            {vaultStats && (
              <Card>
                <CardHeader className="pb-4 border-b border-border/50">
                  <div className="flex items-center gap-2 text-foreground font-semibold">
                    <FolderOpen className="w-5 h-5 text-primary" />
                    Resource Vault
                  </div>
                </CardHeader>
                <CardContent className="pt-0 px-0">
                  <div className="p-5 flex items-center justify-between border-b border-border/50">
                    <div>
                      <p className="text-2xl font-bold text-primary">{vaultStats.totalResources}</p>
                      <p className="text-xs text-muted-foreground">Total Resources</p>
                    </div>
                    <div className="text-right">
                      <div className="flex items-center gap-1 justify-end">
                        <Heart className="w-4 h-4 text-red-400" />
                        <p className="text-2xl font-bold text-foreground">{vaultStats.favoriteCount}</p>
                      </div>
                      <p className="text-xs text-muted-foreground">Favorites</p>
                    </div>
                  </div>
                  {vaultStats.recentResources?.length > 0 && (
                    <div className="divide-y divide-border">
                      {vaultStats.recentResources.slice(0, 3).map((resource: any) => (
                        <Link key={resource.id} href={`/resources/${resource.collectionSlug}/${resource.id}`}>
                          <div className="p-4 hover:bg-secondary/50 transition-colors cursor-pointer flex items-center justify-between">
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium text-foreground truncate">{resource.title}</p>
                              <p className="text-[11px] text-muted-foreground capitalize">{resource.type}</p>
                            </div>
                            <ChevronRight className="w-4 h-4 text-muted-foreground/40 shrink-0" />
                          </div>
                        </Link>
                      ))}
                    </div>
                  )}
                  <div className="p-4 border-t border-border">
                    <Link href="/resources">
                      <Button variant="ghost" className="w-full text-primary hover:text-primary/80">Browse All Resources</Button>
                    </Link>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>
    </AppLayout>
  );
}

function StatCard({ title, value, subtext, icon: Icon, valueColor = "text-primary" }: { title: string, value: string, subtext: string, icon: any, valueColor?: string }) {
  return (
    <Card className="border-t-4 border-t-primary rounded-t-sm">
      <CardContent className="p-6 flex flex-col items-center text-center">
        <Icon className="w-6 h-6 text-muted-foreground mb-3 opacity-80" />
        <p className="text-[10px] font-bold tracking-widest text-muted-foreground uppercase mb-1">{title}</p>
        <h3 className={`text-4xl font-bold mb-2 ${valueColor}`}>{value}</h3>
        <p className="text-xs text-muted-foreground">{subtext}</p>
      </CardContent>
    </Card>
  );
}
