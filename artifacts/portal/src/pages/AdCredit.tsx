import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Gift, Video, Star,
  CheckCircle2, Lightbulb, Info
} from "lucide-react";

const testimonialIdeas = [
  "The expertise of our coaches and their game-changing insights",
  "How our software tools have streamlined your campaigns",
  "Your experience with the BTS Concierge™ team",
  "Access to our exclusive underground traffic sources",
  "The support from the BTS Community",
  "Any \"aha moments\" or breakthroughs you've had",
];

const videoRequirements = [
  { label: "Length", value: "2–5 minutes" },
  { label: "Quality", value: "Phone, webcam, or professional camera — whatever works for you" },
  { label: "Format", value: "Upload to YouTube, Vimeo, Google Drive, or any platform where you can share a link" },
  { label: "Tone", value: "Keep it authentic, positive, and conversational" },
];

const importantDetails = [
  "One submission per mentee — make it count!",
  "Your testimonial may be featured on our website, social media, or marketing materials",
  "Ad credits are applied immediately upon receipt of your video link",
  "Credits can be used for testing in Round 2 & beyond",
];

export default function AdCredit() {
  return (
    <AppLayout>
      <div className="space-y-6 max-w-6xl">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Gift className="w-6 h-6 text-primary" />
            <h1 className="text-3xl font-bold">Earn $1,000 in Ad Credits</h1>
          </div>
          <p className="text-muted-foreground">
            Get a massive boost for your Round 2 testing with $1,000 in free ad credits.
          </p>
        </div>

        <Card className="border-border/60 shadow-sm">
          <CardContent className="p-5 sm:p-8 md:p-10">
            <h2 className="text-xl font-bold text-foreground mb-5">How to Claim Your Credits</h2>
            <div className="space-y-4">
              <div className="flex items-start gap-4">
                <div className="w-9 h-9 rounded-full bg-muted text-foreground border border-border/60 flex items-center justify-center text-sm font-bold shrink-0">1</div>
                <div>
                  <p className="font-medium text-foreground">Record a 2–5 minute video testimonial</p>
                  <p className="text-sm text-muted-foreground">Share your BTS experience</p>
                </div>
              </div>
              <div className="flex items-start gap-4">
                <div className="w-9 h-9 rounded-full bg-muted text-foreground border border-border/60 flex items-center justify-center text-sm font-bold shrink-0">2</div>
                <div>
                  <p className="font-medium text-foreground">Send the video link</p>
                  <p className="text-sm text-muted-foreground">
                    Email to{" "}
                    <a href="mailto:support@buildtestscale.com" className="text-primary underline">
                      support@buildtestscale.com
                    </a>
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-4">
                <div className="w-9 h-9 rounded-full bg-emerald-100 text-emerald-700 border border-emerald-200 flex items-center justify-center text-sm font-bold shrink-0">3</div>
                <div>
                  <p className="font-medium text-foreground">Receive $1,000 in ad credits</p>
                  <p className="text-sm text-muted-foreground">Added directly to your DIYTrax balance</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/60 shadow-sm">
          <CardContent className="p-5 sm:p-8 md:p-10">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-lg border border-border/60 bg-muted flex items-center justify-center">
                <Star className="w-5 h-5 text-foreground" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-foreground">What to Include in Your Testimonial</h2>
                <p className="text-sm text-muted-foreground">Share anything you've found valuable about BTS.</p>
              </div>
            </div>
            <div className="space-y-2">
              {testimonialIdeas.map((idea) => (
                <div key={idea} className="flex items-start gap-2.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-700 mt-0.5 shrink-0" />
                  <p className="text-sm text-muted-foreground">{idea}</p>
                </div>
              ))}
            </div>
            <div className="mt-5 p-4 bg-muted/40 rounded-xl border border-border/60">
              <div className="flex items-start gap-2.5">
                <Lightbulb className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
                <p className="text-sm text-muted-foreground">
                  <strong className="text-foreground">Pro Tip:</strong> If your Round 1 campaign generated sales (even at a loss), definitely mention it! Share your actual numbers if you're comfortable — other members love hearing real results.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card className="border-border/60 shadow-sm">
            <CardContent className="p-6">
              <div className="flex items-center gap-2 mb-4">
                <Video className="w-5 h-5 text-muted-foreground" />
                <h3 className="font-bold text-foreground">Video Requirements</h3>
              </div>
              <div className="space-y-3">
                {videoRequirements.map((r) => (
                  <div key={r.label}>
                    <p className="text-xs font-semibold text-foreground uppercase tracking-wide">{r.label}</p>
                    <p className="text-sm text-muted-foreground">{r.value}</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card className="border-border/60 shadow-sm">
            <CardContent className="p-6">
              <div className="flex items-center gap-2 mb-4">
                <Info className="w-5 h-5 text-muted-foreground" />
                <h3 className="font-bold text-foreground">Important Details</h3>
              </div>
              <div className="space-y-2.5">
                {importantDetails.map((d) => (
                  <div key={d} className="flex items-start gap-2.5">
                    <CheckCircle2 className="w-4 h-4 text-emerald-700 mt-0.5 shrink-0" />
                    <p className="text-sm text-muted-foreground">{d}</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        <Card className="border-border/60 shadow-sm">
          <CardContent className="p-5 sm:p-8 md:p-10 text-center space-y-3">
            <h3 className="text-xl font-bold text-foreground">Ready to Claim Your Credits?</h3>
            <p className="text-sm text-muted-foreground">
              Email your video link to <strong className="text-foreground">support@buildtestscale.com</strong> with the subject line <strong className="text-foreground">"Blitz Testimonial – [Your Name]"</strong> and we'll add the $1,000 credit to your DIYTrax account within 24 hours.
            </p>
            <p className="text-sm font-medium text-foreground">
              This is literally free money for your testing budget — don't leave it on the table!
            </p>
            <div className="pt-2">
              <Button asChild size="lg">
                <a href="mailto:support@buildtestscale.com?subject=Blitz%20Testimonial%20-%20">
                  Send Your Testimonial
                </a>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
