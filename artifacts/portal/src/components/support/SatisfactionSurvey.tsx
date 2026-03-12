import { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Star, CheckCircle2 } from "lucide-react";

interface SatisfactionSurveyProps {
  ticketId: number;
  initialRating?: number;
}

interface SurveyStatus {
  submitted: boolean;
  rating?: number;
  feedback?: string;
}

export function SatisfactionSurvey({ ticketId, initialRating }: SatisfactionSurveyProps) {
  const clampedInitial = initialRating && initialRating >= 1 && initialRating <= 5
    ? initialRating
    : 0;
  const [rating, setRating] = useState<number>(clampedInitial);
  const [hoveredRating, setHoveredRating] = useState<number>(0);
  const [feedback, setFeedback] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [alreadySubmitted, setAlreadySubmitted] = useState(false);
  const [existingRating, setExistingRating] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function checkSurveyStatus() {
      try {
        const res = await fetch(`/api/tickets/${ticketId}/satisfaction`, {
          credentials: "include",
        });
        if (res.ok) {
          const data: SurveyStatus = await res.json();
          if (data.submitted) {
            setAlreadySubmitted(true);
            setExistingRating(data.rating || null);
          }
        }
      } catch {
      }
    }
    checkSurveyStatus();
  }, [ticketId]);

  const handleSubmit = async () => {
    if (rating === 0) return;
    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch(`/api/tickets/${ticketId}/satisfaction`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rating, feedback: feedback.trim() || undefined }),
      });

      if (res.ok) {
        setSubmitted(true);
      } else {
        const data = await res.json().catch(() => null);
        setError(data?.error || "Failed to submit survey. Please try again.");
      }
    } catch {
      setError("Failed to submit survey. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <Card className="border-green-200 bg-green-50/50">
        <CardContent className="p-6 text-center">
          <CheckCircle2 className="w-10 h-10 text-green-500 mx-auto mb-3" />
          <h3 className="text-lg font-semibold text-foreground mb-1">Thank you for your feedback!</h3>
          <p className="text-sm text-muted-foreground">Your response helps us improve our support.</p>
        </CardContent>
      </Card>
    );
  }

  if (alreadySubmitted) {
    return (
      <Card className="border-green-200 bg-green-50/50">
        <CardContent className="p-6 text-center">
          <CheckCircle2 className="w-10 h-10 text-green-500 mx-auto mb-3" />
          <h3 className="text-lg font-semibold text-foreground mb-1">Survey Already Submitted</h3>
          <p className="text-sm text-muted-foreground">
            You rated this ticket {existingRating} out of 5 stars. Thank you!
          </p>
        </CardContent>
      </Card>
    );
  }

  const ratingLabels = ["", "Poor", "Fair", "Good", "Great", "Excellent"];
  const displayRating = hoveredRating || rating;

  return (
    <Card className="border-primary/20 bg-primary/[0.02]">
      <CardContent className="p-6">
        <h3 className="text-lg font-semibold text-foreground mb-1 text-center">
          How was your support experience?
        </h3>
        <p className="text-sm text-muted-foreground mb-5 text-center">
          Your feedback helps us improve. Rate your experience below.
        </p>

        <div className="flex justify-center gap-2 mb-2">
          {[1, 2, 3, 4, 5].map((star) => (
            <button
              key={star}
              type="button"
              onClick={() => setRating(star)}
              onMouseEnter={() => setHoveredRating(star)}
              onMouseLeave={() => setHoveredRating(0)}
              className="p-1 transition-transform hover:scale-110 focus:outline-none focus:ring-2 focus:ring-primary rounded"
              aria-label={`Rate ${star} star${star > 1 ? "s" : ""}`}
            >
              <Star
                className={`w-8 h-8 transition-colors ${
                  star <= displayRating
                    ? "fill-yellow-400 text-yellow-400"
                    : "text-gray-300"
                }`}
              />
            </button>
          ))}
        </div>

        {displayRating > 0 && (
          <p className="text-center text-sm font-medium text-foreground mb-4">
            {ratingLabels[displayRating]}
          </p>
        )}

        <textarea
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
          placeholder="Any additional feedback? (optional)"
          className="w-full p-3 border border-border rounded-md bg-white text-sm resize-none min-h-[80px] focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary"
          rows={3}
        />

        {error && (
          <p className="text-sm text-red-500 mt-2 text-center">{error}</p>
        )}

        <div className="flex justify-center mt-4">
          <Button
            onClick={handleSubmit}
            disabled={rating === 0 || submitting}
            className="min-w-[160px]"
          >
            {submitting ? "Submitting..." : "Submit Feedback"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
