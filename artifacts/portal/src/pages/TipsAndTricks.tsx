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
    vidalyticsId: "8a5iTjH5kCC_OgIs",
  },
  {
    title: "Making Slight Adjustments To Images With Qwen",
    date: "9/26/2025",
    vidalyticsId: "sugpfpVtoqSG95t6",
  },
  {
    title: "Creating Animated GIF's With Grok Imagine",
    date: "9/12/2025",
    vidalyticsId: "ERMmmPggEuGl1j0K",
  },
];

const copywritingTips: Tip[] = [
  {
    title: "Creating Headlines In Specific Styles",
    date: "9/19/2025",
    vidalyticsId: "wmIGaYXDGcAysvL0",
  },
  {
    title: "Creating Native Ad Headlines With Anstrex",
    date: "9/12/2025",
    vidalyticsId: "4HUgSPTVgS7C2_XZ",
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
    <Card className="border-border/60 shadow-sm overflow-hidden">
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
      <div className="max-w-4xl mx-auto space-y-8">

        <div className="bg-[#1a56db] rounded-2xl p-8 md:p-10 text-white shadow-lg">
          <div className="flex items-center gap-4 mb-2">
            <div className="w-12 h-12 rounded-xl bg-white/20 flex items-center justify-center">
              <Lightbulb className="w-6 h-6 text-yellow-300" />
            </div>
            <div>
              <h1 className="text-3xl md:text-4xl font-bold font-['Roboto'] tracking-tight">
                Tips & Tricks
              </h1>
              <p className="text-lg opacity-90">
                Quick wins to level up your campaigns
              </p>
            </div>
          </div>
        </div>

        <Card className="border-border/60 shadow-sm">
          <CardContent className="p-6">
            <h2 className="font-bold text-foreground mb-3">Tip Categories:</h2>
            <div className="flex flex-wrap gap-3">
              <a
                href="#image-tips"
                className="flex items-center gap-2 px-4 py-2 bg-[#faf9f7] border border-[#e8e4dc] rounded-lg text-sm font-medium text-foreground hover:border-[#1a56db]/40 transition-colors"
              >
                <Image className="w-4 h-4 text-[#1a56db]" />
                Images
              </a>
              <a
                href="#copywriting-tips"
                className="flex items-center gap-2 px-4 py-2 bg-[#faf9f7] border border-[#e8e4dc] rounded-lg text-sm font-medium text-foreground hover:border-[#1a56db]/40 transition-colors"
              >
                <PenTool className="w-4 h-4 text-[#1a56db]" />
                Copywriting
              </a>
            </div>
          </CardContent>
        </Card>

        <section id="image-tips" className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-[#1a56db]/10 flex items-center justify-center">
              <Image className="w-4 h-4 text-[#1a56db]" />
            </div>
            <h2 className="text-xl font-bold text-foreground">Image Tips</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {imageTips.map((tip) => (
              <TipCard key={tip.vidalyticsId} tip={tip} />
            ))}
          </div>
        </section>

        <section id="copywriting-tips" className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-[#1a56db]/10 flex items-center justify-center">
              <PenTool className="w-4 h-4 text-[#1a56db]" />
            </div>
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
