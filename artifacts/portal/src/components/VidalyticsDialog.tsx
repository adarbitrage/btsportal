import { useCallback, useRef, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { PlayCircle } from "lucide-react";

const VD_ACCOUNT = "trR5xdVa";

type VidalyticsDialogProps = {
  videoId: string;
  title: string;
  triggerLabel?: string;
};

type ActiveEmbed = {
  scripts: Set<HTMLScriptElement>;
  observer: MutationObserver | null;
};

export function VidalyticsDialog({ videoId, title, triggerLabel = "Watch overview" }: VidalyticsDialogProps) {
  const [open, setOpen] = useState(false);
  const activeRef = useRef<ActiveEmbed | null>(null);

  const teardown = useCallback(() => {
    const a = activeRef.current;
    if (!a) return;
    a.observer?.disconnect();
    a.scripts.forEach((s) => s.parentNode?.removeChild(s));
    a.scripts.clear();
    activeRef.current = null;
    const w = window as unknown as Record<string, unknown>;
    try { delete w.Vidalytics; } catch { /* ignore */ }
    try { delete w.VidalyticsL; } catch { /* ignore */ }
  }, []);

  // Callback ref: fires when the container <div> mounts (after Radix portal/
  // animation has actually attached it to the DOM). This avoids the race with
  // useEffect + useRef where containerRef.current could be null on first run.
  const containerCallbackRef = useCallback(
    (node: HTMLDivElement | null) => {
      if (!node) {
        teardown();
        return;
      }
      if (!videoId) return;

      teardown();
      node.innerHTML = "";

      const embedId = `vidalytics_embed_${videoId}`;
      const baseUrl = `https://fast.vidalytics.com/embeds/${VD_ACCOUNT}/${videoId}/`;

      const embedDiv = document.createElement("div");
      embedDiv.id = embedId;
      embedDiv.style.cssText = "width:100%;position:relative;padding-top:56.25%;";
      node.appendChild(embedDiv);

      const owned: Set<HTMLScriptElement> = new Set();
      const observer = new MutationObserver((records) => {
        for (const r of records) {
          r.addedNodes.forEach((n) => {
            if (
              n.nodeType === 1 &&
              (n as HTMLElement).tagName === "SCRIPT" &&
              ((n as HTMLScriptElement).src || "").includes("vidalytics.com")
            ) {
              owned.add(n as HTMLScriptElement);
            }
          });
        }
      });
      observer.observe(document.head, { childList: true });

      const script = document.createElement("script");
      script.type = "text/javascript";
      script.text =
        "(function(v,i,d,a,l,y,t,c,s){y='_'+d.toLowerCase();c=d+'L';if(!v[d]){v[d]={};}if(!v[c]){v[c]={};}if(!v[y]){v[y]={};}var vl='Loader',vli=v[y][vl],vsl=v[c][vl+'Script'],vlf=v[c][vl+'Loaded'],ve='Embed';if(!vsl){vsl=function(u,cb){if(t){cb();return;}s=i.createElement('script');s.type='text/javascript';s.async=1;s.src=u;if(s.readyState){s.onreadystatechange=function(){if(s.readyState==='loaded'||s.readyState=='complete'){s.onreadystatechange=null;vlf=1;cb();}};}else{s.onload=function(){vlf=1;cb();};}i.getElementsByTagName('head')[0].appendChild(s);};}vsl(l+'loader.min.js',function(){if(!vli){var vlc=v[c][vl];vli=new vlc();}vli.loadScript(l+'player.min.js',function(){var vec=v[d][ve];t=new vec();t.run(a);});});})(window,document,'Vidalytics'," +
        JSON.stringify(embedId) + "," + JSON.stringify(baseUrl) + ");";
      embedDiv.parentNode?.insertBefore(script, embedDiv.nextSibling);
      owned.add(script);

      activeRef.current = { scripts: owned, observer };
    },
    [videoId, teardown],
  );

  if (!videoId) return null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="gap-1.5"
        onClick={() => setOpen(true)}
        data-testid={`button-overview-video-${videoId}`}
      >
        <PlayCircle className="w-4 h-4" />
        {triggerLabel}
      </Button>
      <DialogContent className="max-w-3xl p-0 overflow-hidden bg-black border-0 sm:rounded-lg">
        <DialogHeader className="sr-only">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>Video player for {title}.</DialogDescription>
        </DialogHeader>
        <div ref={containerCallbackRef} className="w-full" />
      </DialogContent>
    </Dialog>
  );
}
