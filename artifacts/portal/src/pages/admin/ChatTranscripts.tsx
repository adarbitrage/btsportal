import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { MessageSquare, Search, Flag, StickyNote, ArrowLeft, ChevronLeft, ChevronRight, Filter } from "lucide-react";
import { fetchChatSessions, fetchChatSessionDetail, flagChatMessage, updateMessageNotes } from "@/lib/admin-api";
import { RetrievalSourcesPanel } from "@/components/assistant/RetrievalSourcesPanel";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";

export default function ChatTranscripts() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [flaggedOnly, setFlaggedOnly] = useState(false);
  const [ticketCreated, setTicketCreated] = useState(false);
  const [selectedSessionId, setSelectedSessionId] = useState<number | null>(null);
  const [editingNote, setEditingNote] = useState<{ messageId: number; notes: string } | null>(null);

  const { data: sessionsData, isLoading } = useQuery({
    queryKey: ["admin-chat-sessions", page, search, dateFrom, dateTo, flaggedOnly, ticketCreated],
    queryFn: () => fetchChatSessions({ page, limit: 20, search, dateFrom, dateTo, flagged: flaggedOnly, ticketCreated }),
  });

  const { data: sessionDetail, isLoading: detailLoading } = useQuery({
    queryKey: ["admin-chat-session-detail", selectedSessionId],
    queryFn: () => fetchChatSessionDetail(selectedSessionId!),
    enabled: !!selectedSessionId,
  });

  const flagMutation = useMutation({
    mutationFn: ({ messageId, flagged }: { messageId: number; flagged: boolean }) => flagChatMessage(messageId, flagged),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-chat-session-detail", selectedSessionId] });
      queryClient.invalidateQueries({ queryKey: ["admin-chat-sessions"] });
      toast({ title: "Message flag updated" });
    },
  });

  const notesMutation = useMutation({
    mutationFn: ({ messageId, notes }: { messageId: number; notes: string }) => updateMessageNotes(messageId, notes),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-chat-session-detail", selectedSessionId] });
      setEditingNote(null);
      toast({ title: "Note saved" });
    },
  });

  const handleSearch = () => {
    setSearch(searchInput);
    setPage(1);
  };

  if (selectedSessionId && sessionDetail) {
    return (
      <AppLayout>
        <div className="space-y-6">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={() => setSelectedSessionId(null)}>
              <ArrowLeft className="w-4 h-4 mr-1" /> Back
            </Button>
            <div>
              <h1 className="text-xl font-bold">{sessionDetail.title}</h1>
              <p className="text-sm text-muted-foreground">
                {sessionDetail.userName} ({sessionDetail.userEmail}) &mdash; {format(new Date(sessionDetail.createdAt), "MMM d, yyyy h:mm a")}
              </p>
            </div>
          </div>

          <div className="space-y-4">
            {detailLoading ? (
              <div className="text-center py-8 text-muted-foreground">Loading transcript...</div>
            ) : (
              sessionDetail.messages?.map((msg: any) => (
                <Card key={msg.id} className={msg.role === "assistant" ? "border-l-4 border-l-primary/40" : ""}>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          <Badge variant={msg.role === "user" ? "secondary" : "default"} className="text-xs">
                            {msg.role === "user" ? "User" : "Assistant"}
                          </Badge>
                          <span className="text-xs text-muted-foreground">
                            {format(new Date(msg.createdAt), "h:mm a")}
                          </span>
                          {msg.flagged && (
                            <Badge variant="destructive" className="text-xs">Flagged</Badge>
                          )}
                        </div>
                        <div className="text-sm whitespace-pre-wrap">{msg.content}</div>
                        {msg.role === "assistant" && msg.retrievalTrace && (
                          <RetrievalSourcesPanel trace={msg.retrievalTrace} />
                        )}
                        {msg.adminNotes && !editingNote && (
                          <div className="mt-3 p-2 bg-yellow-50 border border-yellow-200 rounded text-xs">
                            <span className="font-medium">Admin Note:</span> {msg.adminNotes}
                          </div>
                        )}
                      </div>
                      {msg.role === "assistant" && (
                        <div className="flex flex-col gap-1 shrink-0">
                          <Button
                            size="sm"
                            variant={msg.flagged ? "destructive" : "outline"}
                            className="text-xs"
                            onClick={() => flagMutation.mutate({ messageId: msg.id, flagged: !msg.flagged })}
                            disabled={flagMutation.isPending}
                          >
                            <Flag className="w-3 h-3 mr-1" />
                            {msg.flagged ? "Unflag" : "Flag"}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-xs"
                            onClick={() => setEditingNote({ messageId: msg.id, notes: msg.adminNotes || "" })}
                          >
                            <StickyNote className="w-3 h-3 mr-1" />
                            Note
                          </Button>
                        </div>
                      )}
                    </div>
                    {editingNote && editingNote.messageId === msg.id && (
                      <div className="mt-3 space-y-2">
                        <Textarea
                          value={editingNote.notes}
                          onChange={(e) => setEditingNote({ ...editingNote, notes: e.target.value })}
                          placeholder="Add an admin note..."
                          className="text-sm"
                          rows={2}
                        />
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            onClick={() => notesMutation.mutate({ messageId: msg.id, notes: editingNote.notes })}
                            disabled={notesMutation.isPending}
                          >
                            Save Note
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => setEditingNote(null)}>Cancel</Button>
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Chat Transcripts</h1>
          <p className="text-muted-foreground mt-1">Browse and review AI chat sessions.</p>
        </div>

        <Card>
          <CardContent className="p-4">
            <div className="flex flex-wrap gap-3 items-end">
              <div className="flex-1 min-w-[200px]">
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Search Messages</label>
                <div className="flex gap-2">
                  <Input
                    placeholder="Search by keyword..."
                    value={searchInput}
                    onChange={(e) => setSearchInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                  />
                  <Button onClick={handleSearch} size="sm">
                    <Search className="w-4 h-4" />
                  </Button>
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">From</label>
                <Input type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(1); }} className="w-[150px]" />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">To</label>
                <Input type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(1); }} className="w-[150px]" />
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant={flaggedOnly ? "default" : "outline"}
                  onClick={() => { setFlaggedOnly(!flaggedOnly); setPage(1); }}
                >
                  <Flag className="w-3 h-3 mr-1" /> Flagged
                </Button>
                <Button
                  size="sm"
                  variant={ticketCreated ? "default" : "outline"}
                  onClick={() => { setTicketCreated(!ticketCreated); setPage(1); }}
                >
                  <Filter className="w-3 h-3 mr-1" /> Tickets
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MessageSquare className="w-5 h-5" />
              Sessions
              {sessionsData?.pagination && (
                <span className="text-sm font-normal text-muted-foreground ml-2">
                  ({sessionsData.pagination.total} total)
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="text-center py-8 text-muted-foreground">Loading sessions...</div>
            ) : !sessionsData?.sessions?.length ? (
              <div className="text-center py-8 text-muted-foreground">No chat sessions found.</div>
            ) : (
              <>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Title</TableHead>
                      <TableHead>User</TableHead>
                      <TableHead>Messages</TableHead>
                      <TableHead>Flagged</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sessionsData.sessions.map((s: any) => (
                      <TableRow key={s.id} className="cursor-pointer hover:bg-secondary/50" onClick={() => setSelectedSessionId(s.id)}>
                        <TableCell className="font-medium max-w-[250px] truncate">{s.title}</TableCell>
                        <TableCell>
                          <div className="text-sm">{s.userName}</div>
                          <div className="text-xs text-muted-foreground">{s.userEmail}</div>
                        </TableCell>
                        <TableCell>{s.messageCount}</TableCell>
                        <TableCell>
                          {s.flaggedCount > 0 ? (
                            <Badge variant="destructive" className="text-xs">{s.flaggedCount}</Badge>
                          ) : (
                            <span className="text-muted-foreground">0</span>
                          )}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {format(new Date(s.createdAt), "MMM d, yyyy")}
                        </TableCell>
                        <TableCell>
                          <Button size="sm" variant="ghost">View</Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>

                {sessionsData.pagination.totalPages > 1 && (
                  <div className="flex items-center justify-center gap-2 mt-4">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={page <= 1}
                      onClick={() => setPage(p => p - 1)}
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </Button>
                    <span className="text-sm text-muted-foreground">
                      Page {page} of {sessionsData.pagination.totalPages}
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={page >= sessionsData.pagination.totalPages}
                      onClick={() => setPage(p => p + 1)}
                    >
                      <ChevronRight className="w-4 h-4" />
                    </Button>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
