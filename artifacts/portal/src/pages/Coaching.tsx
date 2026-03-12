import { useState } from "react";
import { useListCoachingCalls, useListCoaches } from "@workspace/api-client-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar, Clock, Users, Video, Lock } from "lucide-react";
import { format } from "date-fns";

const entitlementLabels: Record<string, string> = {
  "coaching:group": "Group Coaching",
  "coaching:mastermind": "Mastermind",
  "coaching:one_on_one:monthly": "Monthly 1-on-1",
  "coaching:one_on_one:weekly": "Weekly 1-on-1",
};

export default function Coaching() {
  const [tab, setTab] = useState<'upcoming' | 'past' | 'coaches'>('upcoming');
  const { data: calls, isLoading: callsLoading } = useListCoachingCalls({ upcoming: tab === 'upcoming' });
  const { data: coaches, isLoading: coachesLoading } = useListCoaches();

  return (
    <AppLayout>
      <div className="space-y-8">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-foreground mb-2">Coaching Calls</h1>
            <p className="text-muted-foreground">Live sessions with your BTS coaches. Access depends on your active products.</p>
          </div>
          
          <div className="flex bg-card border border-border p-1 rounded-lg shadow-sm">
            {(['upcoming', 'past', 'coaches'] as const).map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-6 py-2 text-sm font-semibold rounded-md uppercase tracking-wider transition-all ${
                  tab === t 
                    ? 'bg-primary text-primary-foreground shadow' 
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {t.replace('_', ' ')}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
          <div className="xl:col-span-2 space-y-6">
            <h2 className="text-xl font-bold text-foreground border-b border-border pb-3">
              {tab === 'coaches' ? 'Your Coaches' : 'Schedule'}
            </h2>
            
            {tab !== 'coaches' && callsLoading ? (
              <div className="animate-pulse space-y-4"><div className="h-48 bg-card rounded-xl"></div></div>
            ) : tab !== 'coaches' ? (
              <div className="space-y-4">
                {calls?.map(call => (
                  <Card key={call.id} className={`overflow-hidden hover:shadow-md transition-shadow ${!call.isAccessible ? 'opacity-75' : ''}`}>
                    <div className="flex flex-col sm:flex-row">
                      <div className="bg-secondary/30 p-6 flex flex-col items-center justify-center sm:w-40 border-b sm:border-b-0 sm:border-r border-border shrink-0">
                        <span className="text-sm font-bold text-muted-foreground uppercase tracking-widest">{format(new Date(call.scheduledAt), 'MMM')}</span>
                        <span className="text-4xl font-bold text-foreground my-1">{format(new Date(call.scheduledAt), 'dd')}</span>
                        <span className="text-sm text-muted-foreground">{format(new Date(call.scheduledAt), 'EEEE')}</span>
                      </div>
                      <div className="p-6 flex-1 flex flex-col justify-between">
                        <div>
                          <div className="flex justify-between items-start mb-2">
                            <div className="flex gap-3 items-center mb-1">
                              <Badge variant="secondary" className="bg-primary/10 text-primary uppercase text-[10px] tracking-widest">{call.callType.replace('_', ' ')}</Badge>
                              <span className="flex items-center gap-1 text-xs font-medium text-muted-foreground"><Clock className="w-3 h-3" /> {format(new Date(call.scheduledAt), 'h:mm a')}</span>
                            </div>
                            {call.isAccessible ? (
                              <Badge variant="success">{entitlementLabels[call.requiredEntitlement] ?? call.requiredEntitlement}</Badge>
                            ) : (
                              <Badge variant="locked" className="flex items-center gap-1">
                                <Lock className="w-3 h-3" />
                                {entitlementLabels[call.requiredEntitlement] ?? "Locked"}
                              </Badge>
                            )}
                          </div>
                          <h3 className="text-xl font-bold text-foreground mb-2">{call.title}</h3>
                          <div className="flex items-center gap-2 mb-4">
                            <div className="w-6 h-6 rounded-full bg-secondary flex items-center justify-center text-[10px] font-bold text-muted-foreground">
                              {call.coachName.charAt(0)}
                            </div>
                            <span className="text-sm font-medium text-muted-foreground">With {call.coachName}</span>
                          </div>
                        </div>
                        <div className="flex items-center justify-between mt-4 pt-4 border-t border-border/50">
                          <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                            <Users className="w-4 h-4" /> {call.registeredCount} registered
                          </span>
                          {call.isAccessible ? (
                            <Button>
                              <Video className="w-4 h-4 mr-2" />
                              {tab === 'upcoming' ? 'Register' : call.recordingUrl ? 'Watch Replay' : 'Details'}
                            </Button>
                          ) : (
                            <Button variant="outline" disabled>
                              <Lock className="w-4 h-4 mr-2" />
                              Upgrade to Access
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            ) : null}

            {tab === 'coaches' && !coachesLoading && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                {coaches?.map(coach => (
                  <Card key={coach.id}>
                    <CardContent className="p-6 text-center">
                      <div className="w-20 h-20 rounded-full bg-primary/10 mx-auto mb-4 flex items-center justify-center text-2xl font-bold text-primary">
                        {coach.name.split(' ').map(n=>n[0]).join('')}
                      </div>
                      <h3 className="text-lg font-bold text-foreground">{coach.name}</h3>
                      <p className="text-xs font-bold tracking-widest text-muted-foreground uppercase mt-1 mb-4">{coach.specialties}</p>
                      <div className="bg-secondary/50 rounded-lg p-3 text-sm text-left mb-4 border border-border/50">
                        <span className="font-semibold block mb-1">Hosts:</span>
                        <span className="text-muted-foreground">{coach.callTypes.join(', ').replace(/_/g, ' ')}</span>
                      </div>
                      <Button variant="outline" className="w-full">View Profile</Button>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-6">
            <Card className="bg-gradient-to-b from-primary/5 to-transparent border-primary/20">
              <CardContent className="p-6">
                <h3 className="font-bold text-lg mb-2">Have a question?</h3>
                <p className="text-sm text-muted-foreground mb-4">Submit it before the Q&A call so the coaches can prepare.</p>
                <Button className="w-full">Submit Question</Button>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
