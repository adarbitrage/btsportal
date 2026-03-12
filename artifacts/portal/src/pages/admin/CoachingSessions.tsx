import { useState, useMemo } from "react";
import { CoachingAdminLayout } from "@/components/layout/CoachingAdminLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { useCoachingCoaches, useCoachingSessions, coachingAdminApi, type CoachingSessionItem } from "@/lib/coaching-admin-api";
import { useQueryClient } from "@tanstack/react-query";
import { Calendar, Clock, AlertTriangle, FileText, RotateCcw, ExternalLink } from "lucide-react";
import { Link } from "wouter";

const STATUS_COLORS: Record<string, string> = {
  scheduled: "bg-blue-50 text-blue-700 border-blue-200",
  completed: "bg-green-50 text-green-700 border-green-200",
  cancelled: "bg-gray-50 text-gray-700 border-gray-200",
  no_show: "bg-red-50 text-red-700 border-red-200",
  credit_returned: "bg-amber-50 text-amber-700 border-amber-200",
};

export default function CoachingSessions() {
  const [tab, setTab] = useState("all");
  const [statusFilter, setStatusFilter] = useState("");
  const [coachFilter, setCoachFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: coaches } = useCoachingCoaches();

  const queryParams = useMemo(() => {
    if (tab === "upcoming") return { status: "scheduled" };
    if (tab === "needs-notes") return { needsNotes: true };
    if (tab === "no-show") return { noShow: true };
    return {
      ...(statusFilter && { status: statusFilter }),
      ...(coachFilter && { coachId: Number(coachFilter) }),
      ...(dateFrom && { dateFrom }),
      ...(dateTo && { dateTo }),
    };
  }, [tab, statusFilter, coachFilter, dateFrom, dateTo]);

  const { data: sessions, isLoading } = useCoachingSessions(queryParams);

  const handleReturnCredit = async (id: number) => {
    try {
      await coachingAdminApi.returnCredit(id);
      qc.invalidateQueries({ queryKey: ["/admin/coaching/sessions"] });
      toast({ title: "Credit returned to member" });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  };

  const clearFilters = () => {
    setStatusFilter("");
    setCoachFilter("");
    setDateFrom("");
    setDateTo("");
  };

  const hasFilters = statusFilter || coachFilter || dateFrom || dateTo;

  const upcomingCount = sessions?.filter(s => s.status === "scheduled").length || 0;
  const noShowCount = sessions?.filter(s => s.status === "no_show").length || 0;

  return (
    <CoachingAdminLayout>
      <div className="space-y-8">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Session Management</h1>
          <p className="text-muted-foreground mt-1">View and manage all 1-on-1 coaching sessions</p>
        </div>

        <div className="grid grid-cols-4 gap-4">
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center">
                  <Calendar className="w-5 h-5 text-blue-600" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{sessions?.length || 0}</p>
                  <p className="text-sm text-muted-foreground">Total Sessions</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-green-50 flex items-center justify-center">
                  <Clock className="w-5 h-5 text-green-600" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{upcomingCount}</p>
                  <p className="text-sm text-muted-foreground">Upcoming</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-amber-50 flex items-center justify-center">
                  <FileText className="w-5 h-5 text-amber-600" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{sessions?.filter(s => s.status === "completed" && !s.coachNotes).length || 0}</p>
                  <p className="text-sm text-muted-foreground">Needs Notes</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-red-50 flex items-center justify-center">
                  <AlertTriangle className="w-5 h-5 text-red-600" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{noShowCount}</p>
                  <p className="text-sm text-muted-foreground">No-Shows</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="all">All Sessions</TabsTrigger>
            <TabsTrigger value="upcoming">Upcoming</TabsTrigger>
            <TabsTrigger value="needs-notes">Needs Notes</TabsTrigger>
            <TabsTrigger value="no-show">No-Shows</TabsTrigger>
          </TabsList>

          <TabsContent value="all" className="mt-4">
            <Card className="mb-4">
              <CardContent className="p-4">
                <div className="flex items-center gap-4 flex-wrap">
                  <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger className="w-40"><SelectValue placeholder="Status" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="scheduled">Scheduled</SelectItem>
                      <SelectItem value="completed">Completed</SelectItem>
                      <SelectItem value="cancelled">Cancelled</SelectItem>
                      <SelectItem value="no_show">No Show</SelectItem>
                      <SelectItem value="credit_returned">Credit Returned</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select value={coachFilter} onValueChange={setCoachFilter}>
                    <SelectTrigger className="w-48"><SelectValue placeholder="Coach" /></SelectTrigger>
                    <SelectContent>
                      {coaches?.map(c => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Input type="date" className="w-40" placeholder="From" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
                  <Input type="date" className="w-40" placeholder="To" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
                  {hasFilters && (
                    <Button variant="ghost" size="sm" onClick={clearFilters}>Clear Filters</Button>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        <Card>
          <CardContent className="p-0">
            {isLoading ? (
              <p className="text-muted-foreground text-sm py-12 text-center">Loading sessions...</p>
            ) : !sessions?.length ? (
              <p className="text-muted-foreground text-sm py-12 text-center">No sessions found</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b bg-secondary/30">
                      <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Date</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Member</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Coach</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Status</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Duration</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Notes</th>
                      <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sessions.map(session => (
                      <tr key={session.id} className="border-b hover:bg-secondary/20 transition-colors">
                        <td className="px-4 py-3 text-sm">
                          {new Date(session.scheduledAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                          <br />
                          <span className="text-xs text-muted-foreground">
                            {new Date(session.scheduledAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <p className="text-sm font-medium">{session.memberName}</p>
                          <p className="text-xs text-muted-foreground">{session.memberEmail}</p>
                        </td>
                        <td className="px-4 py-3 text-sm">{session.coachName}</td>
                        <td className="px-4 py-3">
                          <Badge variant="outline" className={STATUS_COLORS[session.status] || ""}>
                            {session.status.replace("_", " ")}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-sm">{session.durationMinutes} min</td>
                        <td className="px-4 py-3">
                          {session.coachNotes ? (
                            <Badge variant="secondary" className="text-xs">Has notes</Badge>
                          ) : session.status === "completed" ? (
                            <Badge variant="outline" className="text-xs text-amber-600 border-amber-200">Missing</Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center gap-1 justify-end">
                            <Link href={`/admin/coaching/notes?sessionId=${session.id}`}>
                              <Button variant="ghost" size="sm">
                                <FileText className="w-4 h-4" />
                              </Button>
                            </Link>
                            {session.meetLink && (
                              <a href={session.meetLink} target="_blank" rel="noopener noreferrer">
                                <Button variant="ghost" size="sm">
                                  <ExternalLink className="w-4 h-4" />
                                </Button>
                              </a>
                            )}
                            {session.status === "no_show" && (
                              <Button variant="ghost" size="sm" onClick={() => handleReturnCredit(session.id)} title="Return credit">
                                <RotateCcw className="w-4 h-4 text-amber-600" />
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </CoachingAdminLayout>
  );
}
