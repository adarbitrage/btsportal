import { useState } from "react";
import { useRoute } from "wouter";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  ArrowLeft,
  Calendar,
  Clock,
  FileText,
  CheckSquare,
  Star,
  MessageSquare,
  AlertTriangle,
} from "lucide-react";
import { format } from "date-fns";
import { Link } from "wouter";
import { useOneOnOneSession, useToggleActionItem } from "@/lib/coaching-api";
import { RatingModal } from "@/components/coaching/RatingModal";

export default function CoachingSessionDetail() {
  const [, params] = useRoute("/coaching/one-on-one/sessions/:id");
  const sessionId = parseInt(params?.id ?? "0", 10);
  const { data: session, isLoading, error } = useOneOnOneSession(sessionId);
  const toggleItem = useToggleActionItem();
  const [ratingOpen, setRatingOpen] = useState(false);

  if (isLoading) {
    return (
      <AppLayout>
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-card rounded w-1/3"></div>
          <div className="h-48 bg-card rounded-xl"></div>
          <div className="h-32 bg-card rounded-xl"></div>
        </div>
      </AppLayout>
    );
  }

  if (error || !session) {
    return (
      <AppLayout>
        <div className="text-center p-12 bg-white rounded-xl border border-border">
          <AlertTriangle className="w-12 h-12 text-destructive/50 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-foreground">Session not found</h2>
          <p className="text-muted-foreground mt-2">
            This session may not exist or you may not have access.
          </p>
          <Link href="/coaching/one-on-one">
            <Button variant="outline" className="mt-4">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to Coaching
            </Button>
          </Link>
        </div>
      </AppLayout>
    );
  }

  const statusColors: Record<string, string> = {
    scheduled: "bg-blue-100 text-blue-800",
    completed: "bg-green-100 text-green-800",
    cancelled: "bg-red-100 text-red-800",
    rescheduled: "bg-orange-100 text-orange-800",
    no_show: "bg-yellow-100 text-yellow-800",
  };

  const actionItems = session.actionItems ?? [];

  return (
    <AppLayout>
      <div className="space-y-8 max-w-4xl">
        <div className="flex items-center gap-4">
          <Link href="/coaching/one-on-one">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back
            </Button>
          </Link>
          <div className="flex-1">
            <div className="flex items-center gap-3 mb-1">
              <h1 className="text-2xl font-bold text-foreground">
                Session with {session.coachName}
              </h1>
              <Badge className={statusColors[session.status] ?? "bg-secondary text-foreground"}>
                {session.status.replace("_", " ")}
              </Badge>
            </div>
            <div className="flex items-center gap-4 text-sm text-muted-foreground">
              <span className="flex items-center gap-1">
                <Calendar className="w-4 h-4" />
                {format(new Date(session.scheduledAt), "EEEE, MMMM d, yyyy")}
              </span>
              <span className="flex items-center gap-1">
                <Clock className="w-4 h-4" />
                {format(new Date(session.scheduledAt), "h:mm a")}
              </span>
              <span>{session.durationMinutes} min</span>
            </div>
          </div>
        </div>

        {session.status === "completed" && !session.rating && (
          <Card className="border-primary/30 bg-primary/5">
            <CardContent className="p-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Star className="w-5 h-5 text-primary" />
                <div>
                  <p className="font-semibold text-foreground text-sm">Rate this session</p>
                  <p className="text-xs text-muted-foreground">
                    Your feedback helps us improve coaching quality.
                  </p>
                </div>
              </div>
              <Button size="sm" onClick={() => setRatingOpen(true)}>
                Rate Now
              </Button>
            </CardContent>
          </Card>
        )}

        {session.rating && (
          <Card>
            <CardContent className="p-4 flex items-center gap-4">
              <div className="flex items-center gap-1">
                {[1, 2, 3, 4, 5].map((s) => (
                  <Star
                    key={s}
                    className={`w-5 h-5 ${
                      s <= session.rating!.rating
                        ? "fill-yellow-400 text-yellow-400"
                        : "text-muted-foreground/20"
                    }`}
                  />
                ))}
              </div>
              {session.rating.comment && (
                <p className="text-sm text-muted-foreground italic">"{session.rating.comment}"</p>
              )}
            </CardContent>
          </Card>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <Card>
            <CardHeader className="pb-4 border-b border-border/50">
              <div className="flex items-center gap-2 text-foreground font-semibold">
                <MessageSquare className="w-5 h-5 text-primary" />
                Pre-Session Notes
              </div>
            </CardHeader>
            <CardContent className="pt-4">
              {session.memberNotes ? (
                <p className="text-sm text-muted-foreground whitespace-pre-wrap leading-relaxed">
                  {session.memberNotes}
                </p>
              ) : (
                <p className="text-sm text-muted-foreground/50 italic">
                  No pre-session notes were added.
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-4 border-b border-border/50">
              <div className="flex items-center gap-2 text-foreground font-semibold">
                <FileText className="w-5 h-5 text-primary" />
                Coach's Shared Notes
              </div>
            </CardHeader>
            <CardContent className="pt-4">
              {session.coachNotes ? (
                <p className="text-sm text-muted-foreground whitespace-pre-wrap leading-relaxed">
                  {session.coachNotes}
                </p>
              ) : (
                <p className="text-sm text-muted-foreground/50 italic">
                  No shared notes from the coach yet.
                </p>
              )}
            </CardContent>
          </Card>

          {session.cancelledAt && (
            <Card className="border-red-200">
              <CardHeader className="pb-4 border-b border-border/50">
                <div className="flex items-center gap-2 text-foreground font-semibold">
                  <AlertTriangle className="w-5 h-5 text-destructive" />
                  Cancellation Details
                </div>
              </CardHeader>
              <CardContent className="pt-4 space-y-2">
                <p className="text-sm text-muted-foreground">
                  Cancelled {format(new Date(session.cancelledAt), "MMM d, yyyy 'at' h:mm a")}
                  {session.cancelledBy && ` by ${session.cancelledBy}`}
                </p>
                {session.cancellationReason && (
                  <p className="text-sm text-muted-foreground">Reason: {session.cancellationReason}</p>
                )}
                <p className="text-sm">
                  {session.creditReturned
                    ? <span className="text-green-600 font-medium">Credit was returned</span>
                    : <span className="text-amber-600 font-medium">Credit was not returned (late cancellation)</span>}
                </p>
              </CardContent>
            </Card>
          )}
        </div>

        <Card>
          <CardHeader className="pb-4 border-b border-border/50">
            <div className="flex items-center gap-2 text-foreground font-semibold">
              <CheckSquare className="w-5 h-5 text-primary" />
              Action Items
            </div>
          </CardHeader>
          <CardContent className="pt-4">
            {actionItems.length > 0 ? (
              <ul className="space-y-3">
                {actionItems.map((item) => (
                  <li key={item.id} className="flex items-start gap-3 p-3 rounded-lg hover:bg-secondary/50 transition-colors">
                    <Checkbox
                      checked={item.completed}
                      onCheckedChange={(checked) => {
                        toggleItem.mutate({
                          sessionId: session.id,
                          actionItemId: item.id,
                          completed: checked === true,
                        });
                      }}
                      className="mt-0.5"
                    />
                    <div className="flex-1">
                      <span
                        className={`text-sm ${
                          item.completed
                            ? "text-muted-foreground line-through"
                            : "text-foreground"
                        }`}
                      >
                        {item.text}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-4">
                No action items for this session.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <RatingModal
        open={ratingOpen}
        onOpenChange={setRatingOpen}
        sessionId={session.id}
        coachName={session.coachName}
      />
    </AppLayout>
  );
}
