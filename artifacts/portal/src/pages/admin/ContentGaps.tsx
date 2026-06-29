import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Radar, MessageSquare, Phone, TrendingUp, Hash } from "lucide-react";
import { fetchContentGaps } from "@/lib/admin-api";

type SortKey = "frequency" | "recent";
type SurfaceFilter = "all" | "chat" | "voice";

function StatCard({
  title,
  value,
  icon: Icon,
}: {
  title: string;
  value: string | number;
  icon: any;
}) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-muted-foreground">{title}</p>
            <p className="text-2xl font-bold mt-1">{value}</p>
          </div>
          <Icon className="w-8 h-8 text-primary opacity-60" />
        </div>
      </CardContent>
    </Card>
  );
}

function formatDate(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function ContentGaps() {
  const [sort, setSort] = useState<SortKey>("frequency");
  const [surface, setSurface] = useState<SurfaceFilter>("all");
  const [page, setPage] = useState(1);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["admin-content-gaps", sort, surface, page],
    queryFn: () =>
      fetchContentGaps({
        sort,
        surface: surface === "all" ? undefined : surface,
        page,
        limit: 25,
      }),
    refetchInterval: 60000,
  });

  const questions = data?.questions ?? [];
  const summary = data?.summary;
  const pagination = data?.pagination;

  return (
    <AppLayout>
      <div className="space-y-8">
        <div className="flex items-start gap-3">
          <Radar className="w-7 h-7 text-primary mt-1" />
          <div>
            <h1 className="text-2xl font-bold text-foreground">Content-Gap Radar</h1>
            <p className="text-muted-foreground mt-1">
              Questions the AI assistants couldn't confidently answer. Use the
              most-asked gaps to decide which knowledge-base docs to write next.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            title="Distinct Gaps"
            value={summary?.distinctQuestions ?? 0}
            icon={Hash}
          />
          <StatCard
            title="Total Unanswered Asks"
            value={summary?.totalAsks ?? 0}
            icon={TrendingUp}
          />
          <StatCard
            title="From Chat"
            value={summary?.chatQuestions ?? 0}
            icon={MessageSquare}
          />
          <StatCard
            title="From Voice"
            value={summary?.voiceQuestions ?? 0}
            icon={Phone}
          />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Sort by</span>
            <Select
              value={sort}
              onValueChange={(v) => {
                setSort(v as SortKey);
                setPage(1);
              }}
            >
              <SelectTrigger className="w-[160px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="frequency">Most asked</SelectItem>
                <SelectItem value="recent">Most recent</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Surface</span>
            <Select
              value={surface}
              onValueChange={(v) => {
                setSurface(v as SurfaceFilter);
                setPage(1);
              }}
            >
              <SelectTrigger className="w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="chat">Chat</SelectItem>
                <SelectItem value="voice">Voice</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <Card>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="text-center py-12 text-muted-foreground">
                Loading content gaps...
              </div>
            ) : isError ? (
              <div className="text-center py-12 text-destructive">
                Failed to load content gaps.
              </div>
            ) : questions.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                No unanswered questions logged yet. As members ask questions the
                assistants can't confidently answer, they'll appear here.
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Question</TableHead>
                    <TableHead className="w-[90px]">Surface</TableHead>
                    <TableHead className="w-[80px] text-right">Asks</TableHead>
                    <TableHead className="w-[180px]">Last asked</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {questions.map((q) => (
                    <TableRow key={q.id}>
                      <TableCell>
                        <div className="font-medium text-foreground">
                          {q.questionText}
                        </div>
                        {q.nearMisses.length > 0 && (
                          <div className="text-xs text-muted-foreground mt-1">
                            Nearest misses:{" "}
                            {q.nearMisses.map((m) => m.title).filter(Boolean).join(", ")}
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant={q.surface === "voice" ? "secondary" : "outline"}>
                          {q.surface}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-semibold">
                        {q.askCount}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {formatDate(q.lastAskedAt)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {pagination && pagination.totalPages > 1 && (
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Page {pagination.page} of {pagination.totalPages} · {pagination.total}{" "}
              gaps
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= pagination.totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
