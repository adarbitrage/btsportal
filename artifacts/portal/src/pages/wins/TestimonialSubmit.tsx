import { useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useWin, useSubmitTestimonial } from "@/hooks/use-wins";
import { useRoute, useLocation, Link } from "wouter";
import { ArrowLeft, Trophy, Send, Loader2, CheckCircle2, Calendar } from "lucide-react";
import { format } from "date-fns";

export default function TestimonialSubmit() {
  const [, params] = useRoute("/wins/:id/testimonial");
  const winId = parseInt(params?.id ?? "0", 10);
  const { data: win, isLoading, error } = useWin(winId);
  const submitTestimonial = useSubmitTestimonial();
  const [, navigate] = useLocation();

  const [testimonialText, setTestimonialText] = useState("");
  const [allowTestimonial, setAllowTestimonial] = useState(false);
  const [allowPublicName, setAllowPublicName] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = async () => {
    if (!testimonialText.trim() || !allowTestimonial) return;

    await submitTestimonial.mutateAsync({
      winId,
      data: {
        testimonialText: testimonialText.trim(),
        allowTestimonial,
        allowPublicName,
      },
    });
    setSubmitted(true);
  };

  if (submitted) {
    return (
      <AppLayout>
        <div className="max-w-lg mx-auto py-16 text-center">
          <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
            <CheckCircle2 className="w-8 h-8 text-green-600" />
          </div>
          <h1 className="text-2xl font-bold text-foreground mb-2">Testimonial Submitted!</h1>
          <p className="text-muted-foreground mb-6">
            Thank you for sharing your story. Our team will review it shortly.
          </p>
          <Link href="/wins/mine">
            <Button>View Your Wins</Button>
          </Link>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="flex items-center gap-3 mb-2">
          <Link href={`/wins/${winId}`}>
            <Button variant="ghost" size="sm">
              <ArrowLeft className="w-4 h-4 mr-1" />
              Back to Win
            </Button>
          </Link>
        </div>

        <div className="flex items-center gap-3 mb-6">
          <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center">
            <Trophy className="w-6 h-6 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">Share Your Story</h1>
            <p className="text-muted-foreground text-sm">Your win inspired us — would you share your story?</p>
          </div>
        </div>

        {isLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-32 w-full rounded-xl" />
            <Skeleton className="h-48 w-full rounded-xl" />
          </div>
        ) : error || !win ? (
          <Card>
            <CardContent className="p-8 text-center">
              <h2 className="text-xl font-semibold text-foreground">Win not found</h2>
              <p className="text-muted-foreground mt-2">This win may have been removed or doesn't exist.</p>
            </CardContent>
          </Card>
        ) : (
          <>
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Your Win</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="bg-secondary/50 rounded-lg p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-lg">{win.milestone.icon}</span>
                    <span className="font-semibold text-foreground">{win.milestone.name}</span>
                  </div>
                  <h3 className="font-bold text-foreground mb-1">{win.title}</h3>
                  <p className="text-sm text-muted-foreground flex items-center gap-1">
                    <Calendar className="w-3.5 h-3.5" />
                    {format(new Date(win.winDate), "MMMM d, yyyy")}
                  </p>
                  {win.revenueAmount && (
                    <p className="text-sm font-semibold text-green-600 mt-1">
                      Revenue: ${win.revenueAmount.toLocaleString()}
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Your Testimonial</CardTitle>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="space-y-2">
                  <Label htmlFor="testimonial">
                    Write a 2-4 sentence testimonial about your experience with BTS
                  </Label>
                  <Textarea
                    id="testimonial"
                    placeholder="BTS completely changed my approach to affiliate marketing. The headline testing framework from Module 4 took me from break-even to my first $1K day in just 3 weeks..."
                    value={testimonialText}
                    onChange={(e) => setTestimonialText(e.target.value)}
                    className="min-h-[120px]"
                    maxLength={1000}
                  />
                  <p className="text-xs text-muted-foreground text-right">{testimonialText.length}/1000</p>
                </div>

                <div className="space-y-4 pt-2 border-t border-border/50">
                  <div className="flex items-start gap-3">
                    <Checkbox
                      id="consent"
                      checked={allowTestimonial}
                      onCheckedChange={(v) => setAllowTestimonial(v === true)}
                    />
                    <div>
                      <Label htmlFor="consent" className="text-sm leading-relaxed cursor-pointer">
                        I consent to BTS using this testimonial in marketing materials
                      </Label>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        On the website, in marketing materials, or in ads
                      </p>
                    </div>
                  </div>

                  <div className="flex items-start gap-3">
                    <Checkbox
                      id="publicName"
                      checked={allowPublicName}
                      onCheckedChange={(v) => setAllowPublicName(v === true)}
                    />
                    <Label htmlFor="publicName" className="text-sm leading-relaxed cursor-pointer">
                      You may use my full name (otherwise first name + last initial)
                    </Label>
                  </div>
                </div>

                <div className="flex justify-end pt-2">
                  <Button
                    onClick={handleSubmit}
                    disabled={
                      submitTestimonial.isPending ||
                      !testimonialText.trim() ||
                      !allowTestimonial
                    }
                    className="gap-2"
                  >
                    {submitTestimonial.isPending ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Submitting...
                      </>
                    ) : (
                      <>
                        <Send className="w-4 h-4" />
                        Submit Testimonial
                      </>
                    )}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </AppLayout>
  );
}
