import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Star } from "lucide-react";
import { cn } from "@/lib/utils";
import { useRateSession } from "@/lib/coaching-api";

interface RatingModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessionId: number;
  coachName: string;
}

export function RatingModal({ open, onOpenChange, sessionId, coachName }: RatingModalProps) {
  const [rating, setRating] = useState(0);
  const [hoveredRating, setHoveredRating] = useState(0);
  const [comment, setComment] = useState("");
  const rateMutation = useRateSession();

  const handleSubmit = async () => {
    if (rating === 0) return;
    try {
      await rateMutation.mutateAsync({ sessionId, rating, comment: comment.trim() || undefined });
      onOpenChange(false);
      setRating(0);
      setComment("");
    } catch {
      // error state handled by rateMutation.isError below
    }
  };

  const displayRating = hoveredRating || rating;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Rate Your Session</DialogTitle>
          <DialogDescription>
            How was your coaching session with {coachName}?
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          <div className="flex justify-center gap-2">
            {[1, 2, 3, 4, 5].map((star) => (
              <button
                key={star}
                type="button"
                onClick={() => setRating(star)}
                onMouseEnter={() => setHoveredRating(star)}
                onMouseLeave={() => setHoveredRating(0)}
                className="p-1 transition-transform hover:scale-110"
              >
                <Star
                  className={cn(
                    "w-10 h-10 transition-colors",
                    star <= displayRating
                      ? "fill-yellow-400 text-yellow-400"
                      : "text-muted-foreground/30"
                  )}
                />
              </button>
            ))}
          </div>

          {rating > 0 && (
            <p className="text-center text-sm text-muted-foreground">
              {rating === 1 && "Poor"}
              {rating === 2 && "Below Average"}
              {rating === 3 && "Average"}
              {rating === 4 && "Good"}
              {rating === 5 && "Excellent"}
            </p>
          )}

          <div>
            <label className="text-sm font-medium text-foreground mb-2 block">
              Additional comments (optional)
            </label>
            <Textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Share any feedback about the session..."
              rows={3}
            />
          </div>
        </div>

        {rateMutation.isError && (
          <p className="text-sm text-destructive text-center">
            Failed to submit rating. Please try again.
          </p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Skip
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={rating === 0 || rateMutation.isPending}
          >
            {rateMutation.isPending ? "Submitting..." : "Submit Rating"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
