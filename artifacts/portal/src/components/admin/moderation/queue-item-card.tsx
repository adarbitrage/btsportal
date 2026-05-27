import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { CheckCircle2, XCircle, MessageSquare, FileText } from "lucide-react";
import { format } from "date-fns";
import { TriggerDetails } from "./trigger-details";
import type { ModerationQueueItem } from "@/hooks/useAdminModeration";

interface QueueItemCardProps {
  item: ModerationQueueItem;
  onApprove?: (id: number) => void;
  onReject?: (id: number) => void;
  isApproving?: boolean;
  isRejecting?: boolean;
  showActions?: boolean;
}

function initials(name: string | null): string {
  if (!name) return "?";
  return name
    .split(" ")
    .map((n) => n[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export function QueueItemCard({
  item,
  onApprove,
  onReject,
  isApproving = false,
  isRejecting = false,
  showActions = true,
}: QueueItemCardProps) {
  const [rejectOpen, setRejectOpen] = useState(false);

  const handleApprove = () => {
    onApprove?.(item.id);
  };

  const handleRejectConfirm = () => {
    onReject?.(item.id);
    setRejectOpen(false);
  };

  return (
    <>
      <Card>
        <CardContent className="py-4 px-5">
          <div className="flex items-start gap-4">
            <Avatar className="h-9 w-9 shrink-0 mt-0.5">
              <AvatarFallback className="text-xs bg-muted">
                {initials(item.authorName)}
              </AvatarFallback>
            </Avatar>

            <div className="flex-1 min-w-0 space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-medium text-sm">{item.authorName ?? "Unknown"}</span>
                {item.authorEmail && (
                  <span className="text-xs text-muted-foreground">{item.authorEmail}</span>
                )}
                <Badge variant="outline" className="text-xs gap-1">
                  {item.targetType === "post" ? (
                    <FileText className="w-3 h-3" />
                  ) : (
                    <MessageSquare className="w-3 h-3" />
                  )}
                  {item.targetType === "post" ? "Post" : "Comment"}
                </Badge>
                <span className="text-xs text-muted-foreground ml-auto">
                  {format(new Date(item.createdAt), "MMM d, yyyy h:mm a")}
                </span>
              </div>

              <blockquote className="border-l-2 border-muted pl-3 text-sm text-foreground/80 italic line-clamp-4">
                {item.body}
              </blockquote>

              <TriggerDetails
                triggeredBy={item.triggeredBy}
                wordlistMatches={item.wordlistMatches}
                aiScores={item.aiScores}
              />
            </div>

            {showActions && (
              <div className="flex items-center gap-1.5 shrink-0 mt-0.5">
                <Button
                  size="sm"
                  variant="outline"
                  className="border-green-300 text-green-700 hover:bg-green-50 hover:border-green-400 dark:border-green-800 dark:text-green-400 dark:hover:bg-green-950"
                  onClick={handleApprove}
                  disabled={isApproving || isRejecting}
                  title="Approve"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  <span className="ml-1.5 hidden sm:inline">Approve</span>
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="border-red-300 text-red-700 hover:bg-red-50 hover:border-red-400 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950"
                  onClick={() => setRejectOpen(true)}
                  disabled={isApproving || isRejecting}
                  title="Reject"
                >
                  <XCircle className="w-4 h-4" />
                  <span className="ml-1.5 hidden sm:inline">Reject</span>
                </Button>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <AlertDialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reject this content?</AlertDialogTitle>
            <AlertDialogDescription>
              This will add a strike to{" "}
              <span className="font-medium text-foreground">{item.authorName ?? "this user"}</span>.
              3 strikes auto-suspends posting.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isRejecting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleRejectConfirm}
              disabled={isRejecting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Reject &amp; Add Strike
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
