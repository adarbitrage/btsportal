import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Gift, Video, Send, CreditCard, Star,
  CheckCircle2, Lightbulb, Info, Mail
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
      <div className="max-w-3xl mx-auto space-y-6">

        <div className="bg-[#1a56db] rounded-2xl p-8 md:p-10 text-white shadow-lg">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-white/20 flex items-center justify-center">
              <Gift className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-2xl md:text-3xl font-bold font-['Roboto'] tracking-tight">
                Earn $1,000 in Ad Credits for Round 2!
              </h1>
              <p className="text-sm opacity-90 mt-1">
                Get a MASSIVE boost for your Round 2 testing with $1,000 in FREE ad credits!
              </p>
            </div>
          </div>
        </div>

        <Card className="border-border/60 shadow-sm">
          <CardContent className="p-6 md:p-8">
            <h2 className="text-lg font-bold text-foreground mb-5">How to Claim Your Credits:</h2>
            <div className="space-y-4">
              <div className="flex items-start gap-4">
                <div className="w-9 h-9 rounded-full bg-[#1a56db] text-white flex items-center justify-center text-sm font-bold shrink-0">1</div>
                <div>
                  <p className="font-medium text-foreground">Record a 2–5 minute video testimonial</p>
                  <p className="text-sm text-muted-foreground">Share your BTS experience</p>
                </div>
              </div>
              <div className="flex items-start gap-4">
                <div className="w-9 h-9 rounded-full bg-[#1a56db] text-white flex items-center justify-center text-sm font-bold shrink-0">2</div>
                <div>
                  <p className="font-medium text-foreground">Send the video link</p>
                  <p className="text-sm text-muted-foreground">
                    Email to{" "}
                    <a href="mailto:support@buildtestscale.com" className="text-[#1a56db] underline">
                      support@buildtestscale.com
                    </a>
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-4">
                <div className="w-9 h-9 rounded-full bg-[#2d8a4e] text-white flex items-center justify-center text-sm font-bold shrink-0">3</div>
                <div>
                  <p className="font-medium text-foreground">Receive $1,000 in ad credits</p>
                  <p className="text-sm text-muted-foreground">Added directly to your DIYTrax balance</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/60 shadow-sm">
          <CardContent className="p-6 md:p-8">
            <div className="flex items-center gap-2 mb-4">
              <Star className="w-5 h-5 text-[#1a56db]" />
              <h2 className="text-lg font-bold text-foreground">What to Include in Your Testimonial</h2>
            </div>
            <p className="text-sm text-muted-foreground mb-3">
              Share anything you've found valuable about BTS:
            </p>
            <div className="space-y-2">
              {testimonialIdeas.map((idea) => (
                <div key={idea} className="flex items-start gap-2.5">
                  <CheckCircle2 className="w-4 h-4 text-[#2d8a4e] mt-0.5 shrink-0" />
                  <p className="text-sm text-muted-foreground">{idea}</p>
                </div>
              ))}
            </div>
            <div className="mt-5 p-4 bg-[#1a56db]/5 rounded-xl border border-[#1a56db]/10">
              <div className="flex items-start gap-2.5">
                <Lightbulb className="w-4 h-4 text-[#1a56db] mt-0.5 shrink-0" />
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
                <Video className="w-5 h-5 text-[#1a56db]" />
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
                <Info className="w-5 h-5 text-[#1a56db]" />
                <h3 className="font-bold text-foreground">Important Details</h3>
              </div>
              <div className="space-y-2.5">
                {importantDetails.map((d) => (
                  <div key={d} className="flex items-start gap-2.5">
                    <CheckCircle2 className="w-4 h-4 text-[#2d8a4e] mt-0.5 shrink-0" />
                    <p className="text-sm text-muted-foreground">{d}</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        <Card className="border-[#2d8a4e]/30 shadow-sm bg-gradient-to-br from-[#2d8a4e]/5 to-transparent">
          <CardContent className="p-6 md:p-8 text-center space-y-3">
            <h3 className="text-lg font-bold text-foreground">Ready to Claim Your Credits?</h3>
            <p className="text-sm text-muted-foreground">
              Email your video link to <strong className="text-foreground">support@buildtestscale.com</strong> with the subject line <strong className="text-foreground">"Blitz Testimonial – [Your Name]"</strong> and we'll add the $1,000 credit to your DIYTrax account within 24 hours.
            </p>
            <p className="text-sm font-medium text-[#2d8a4e]">
              This is literally free money for your testing budget — don't leave it on the table!
            </p>
            <a href="mailto:support@buildtestscale.com?subject=Blitz%20Testimonial%20-%20" className="inline-block mt-2">
              <Button size="lg" className="bg-[#2d8a4e] hover:bg-[#246e3e] text-white gap-2">
                <Mail className="w-5 h-5" />
                Send Your Testimonial
              </Button>
            </a>
          </CardContent>
        </Card>

      </div>
    </AppLayout>
  );
}
