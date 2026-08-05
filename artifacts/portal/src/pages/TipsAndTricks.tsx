import { useEffect, useRef } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Lightbulb, Image, PenTool } from "lucide-react";
import { useCurriculumContent } from "@/hooks/use-curriculum-content";

interface Tip {
  title: string;
  vidalyticsId: string;
}

interface TipsContent {
  intro: string;
  vidalyticsPlayer: string;
  imageTips: Tip[];
  copywritingTips: Tip[];
}

function VidalyticsEmbed({ id, player }: { id: string; player: string }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const embedDivId = `vidalytics_embed_${id}`;
    container.innerHTML = `<div id="${embedDivId}" style="width:100%;position:relative;padding-top:56.25%;"></div>`;

    const script = document.createElement("script");
    script.type = "text/javascript";
    script.text = `
      (function (v, i, d, a, l, y, t, c, s) {
        y='_'+d.toLowerCase();c=d+'L';if(!v[d]){v[d]={};}if(!v[c]){v[c]={};}if(!v[y]){v[y]={};}var vl='Loader',vli=v[y][vl],vsl=v[c][vl + 'Script'],vlf=v[c][vl + 'Loaded'],ve='Embed';
        if (!vsl){vsl=function(u,cb){
          if(t){cb();return;}s=i.createElement("script");s.type="text/javascript";s.async=1;s.src=u;
          if(s.readyState){s.onreadystatechange=function(){if(s.readyState==="loaded"||s.readyState=="complete"){s.onreadystatechange=null;vlf=1;cb();}};}else{s.onload=function(){vlf=1;cb();};}
          i.getElementsByTagName("head")[0].appendChild(s);
        };}
        vsl(l+'loader.min.js',function(){if(!vli){var vlc=v[c][vl];vli=new vlc();}vli.loadScript(l+'player.min.js',function(){var vec=v[d][ve];t=new vec();t.run(a);});});
      })(window, document, 'Vidalytics', '${embedDivId}', 'https://fast.vidalytics.com/embeds/${player}/${id}/');
    `;
    container.appendChild(script);

    return () => {
      container.innerHTML = "";
    };
  }, [id, player]);

  return <div ref={containerRef} className="rounded-lg overflow-hidden bg-black" />;
}

function TipCard({ tip, player }: { tip: Tip; player: string }) {
  return (
    <Card className="border-border/60 overflow-hidden">
      <CardContent className="p-0">
        <VidalyticsEmbed id={tip.vidalyticsId} player={player} />
        <div className="p-5">
          <h3 className="font-bold text-foreground text-base">{tip.title}</h3>
        </div>
      </CardContent>
    </Card>
  );
}

export default function TipsAndTricks() {
  const { content, isLoading, isError } = useCurriculumContent<TipsContent>("tips-and-tricks");

  return (
    <AppLayout>
      <div className="space-y-6 max-w-6xl">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Lightbulb className="w-6 h-6 text-primary" />
            <h1 className="text-3xl font-bold">Tips & Tricks</h1>
          </div>
          {content && <p className="text-muted-foreground">{content.intro}</p>}
        </div>

        {isLoading && (
          <div className="space-y-4" data-testid="tips-loading">
            <Skeleton className="h-24 w-full rounded-xl" />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Skeleton className="h-64 w-full rounded-xl" />
              <Skeleton className="h-64 w-full rounded-xl" />
            </div>
          </div>
        )}

        {isError && !isLoading && (
          <Card className="border-border/60">
            <CardContent className="p-6 text-sm text-muted-foreground">
              This content couldn't be loaded. Please refresh the page or try again later.
            </CardContent>
          </Card>
        )}

        {content && (
          <>
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
                {content.imageTips.map((tip) => (
                  <TipCard key={tip.vidalyticsId} tip={tip} player={content.vidalyticsPlayer} />
                ))}
              </div>
            </section>

            <section id="copywriting-tips" className="space-y-4 scroll-mt-6">
              <div className="flex items-center gap-2">
                <PenTool className="w-5 h-5 text-foreground" />
                <h2 className="text-xl font-bold text-foreground">Copywriting Tips</h2>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {content.copywritingTips.map((tip) => (
                  <TipCard key={tip.vidalyticsId} tip={tip} player={content.vidalyticsPlayer} />
                ))}
              </div>
            </section>
          </>
        )}
      </div>
    </AppLayout>
  );
}
