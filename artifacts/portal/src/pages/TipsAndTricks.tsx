import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Lightbulb, Image, PenTool } from "lucide-react";

interface Tip {
  title: string;
  date: string;
  vidalyticsId: string;
}

const imageTips: Tip[] = [
  {
    title: 'Creating Images With Google\'s "Nano Banana"',
    date: "11/18/2025",
    vidalyticsId: "qgpAV6gDFy_EujDM",
  },
  {
    title: "Making Slight Adjustments To Images With Qwen",
    date: "9/26/2025",
    vidalyticsId: "uZA1qpHWKIw6O4ao",
  },
  {
    title: "Creating Animated GIF's With Grok Imagine",
    date: "9/12/2025",
    vidalyticsId: "urBv1xbiAL6LST5x",
  },
];

const copywritingTips: Tip[] = [
  {
    title: "Creating Headlines In Specific Styles",
    date: "9/19/2025",
    vidalyticsId: "smS9hAL9_0kXcPsf",
  },
  {
    title: "Creating Native Ad Headlines With Anstrex",
    date: "9/12/2025",
    vidalyticsId: "ER6QheTSaVmuoMvN",
  },
];

function VidalyticsEmbed({ id }: { id: string }) {
  return (
    <div className="rounded-lg overflow-hidden bg-black aspect-video">
      <iframe
        src={`https://fast.vidalytics.com/embeds/trR5xdVa/${id}/`}
        className="w-full h-full border-0"
        allow="autoplay; fullscreen"
        allowFullScreen
      />
    </div>
  );
}

function TipCard({ tip }: { tip: Tip }) {
  return (
    <Card className="border-border/60 overflow-hidden">
      <CardContent className="p-0">
        <VidalyticsEmbed id={tip.vidalyticsId} />
        <div className="p-5">
          <h3 className="font-bold text-foreground text-base">{tip.title}</h3>
          <p className="text-sm text-muted-foreground mt-1">{tip.date}</p>
        </div>
      </CardContent>
    </Card>
  );
}

export default function TipsAndTricks() {
  return (
    <AppLayout>
      <div className="space-y-6 max-w-6xl">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Lightbulb className="w-6 h-6 text-primary" />
            <h1 className="text-3xl font-bold">Tips & Tricks</h1>
          </div>
          <p className="text-muted-foreground">
            Quick wins to level up your campaigns. Browse short, focused walkthroughs on
            creating images, writing headlines, and other day-to-day workflows.
          </p>
        </div>

        <Card className="border-border/60">
          <CardContent className="p-5">
            <h2 className="text-sm font-semibold text-foreground mb-3">Jump to:</h2>
            <div className="flex flex-wrap gap-2">
              <a
                href="#image-tips"
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm border border-border bg-background text-foreground hover:border-foreground/40 transition-colors"
                data-testid="link-jump-images"
              >
                <Image className="w-4 h-4 text-muted-foreground" />
                Images
              </a>
              <a
                href="#copywriting-tips"
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm border border-border bg-background text-foreground hover:border-foreground/40 transition-colors"
                data-testid="link-jump-copywriting"
              >
                <PenTool className="w-4 h-4 text-muted-foreground" />
                Copywriting
              </a>
            </div>
          </CardContent>
        </Card>

        <section id="image-tips" className="space-y-4 scroll-mt-6">
          <div className="flex items-center gap-2">
            <Image className="w-5 h-5 text-foreground" />
            <h2 className="text-xl font-bold text-foreground">Image Tips</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {imageTips.map((tip) => (
              <TipCard key={tip.vidalyticsId} tip={tip} />
            ))}
          </div>
        </section>

        <section id="copywriting-tips" className="space-y-4 scroll-mt-6">
          <div className="flex items-center gap-2">
            <PenTool className="w-5 h-5 text-foreground" />
            <h2 className="text-xl font-bold text-foreground">Copywriting Tips</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {copywritingTips.map((tip) => (
              <TipCard key={tip.vidalyticsId} tip={tip} />
            ))}
          </div>
        </section>

      </div>
    </AppLayout>
  );
}
