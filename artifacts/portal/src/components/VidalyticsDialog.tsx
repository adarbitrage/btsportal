import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { PlayCircle } from "lucide-react";

const VD_ACCOUNT = "trR5xdVa";

type VidalyticsDialogProps = {
  videoId: string;
  title: string;
  triggerLabel?: string;
};

export function VidalyticsDialog({ videoId, title, triggerLabel = "Watch overview" }: VidalyticsDialogProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const ownedScriptsRef = useRef<Set<HTMLScriptElement>>(new Set());
  const headObserverRef = useRef<MutationObserver | null>(null);

  useEffect(() => {
    if (!open) return;
    const container = containerRef.current;
    if (!container || !videoId) return;

    const embedId = `vidalytics_embed_${videoId}`;
    const baseUrl = `https://fast.vidalytics.com/embeds/${VD_ACCOUNT}/${videoId}/`;

    container.innerHTML = "";
    const div = document.createElement("div");
    div.id = embedId;
    div.style.cssText = "width:100%;position:relative;padding-top:56.25%;";
    container.appendChild(div);

    headObserverRef.current?.disconnect();
    const owned = ownedScriptsRef.current;
    headObserverRef.current = new MutationObserver((records) => {
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
    headObserverRef.current.observe(document.head, { childList: true });

    const script = document.createElement("script");
    script.type = "text/javascript";
    script.text =
      "(function(v,i,d,a,l,y,t,c,s){y='_'+d.toLowerCase();c=d+'L';if(!v[d]){v[d]={};}if(!v[c]){v[c]={};}if(!v[y]){v[y]={};}var vl='Loader',vli=v[y][vl],vsl=v[c][vl+'Script'],vlf=v[c][vl+'Loaded'],ve='Embed';if(!vsl){vsl=function(u,cb){if(t){cb();return;}s=i.createElement('script');s.type='text/javascript';s.async=1;s.src=u;if(s.readyState){s.onreadystatechange=function(){if(s.readyState==='loaded'||s.readyState=='complete'){s.onreadystatechange=null;vlf=1;cb();}};}else{s.onload=function(){vlf=1;cb();};}i.getElementsByTagName('head')[0].appendChild(s);};}vsl(l+'loader.min.js',function(){if(!vli){var vlc=v[c][vl];vli=new vlc();}vli.loadScript(l+'player.min.js',function(){var vec=v[d][ve];t=new vec();t.run(a);});});})(window,document,'Vidalytics'," +
      JSON.stringify(embedId) + "," + JSON.stringify(baseUrl) + ");";
    div.parentNode?.insertBefore(script, div.nextSibling);
    owned.add(script);

    return () => {
      headObserverRef.current?.disconnect();
      headObserverRef.current = null;
      owned.forEach((s) => s.parentNode?.removeChild(s));
      owned.clear();
      if (container) container.innerHTML = "";
      const w = window as unknown as Record<string, unknown>;
      try { delete w.Vidalytics; } catch { /* ignore */ }
      try { delete w.VidalyticsL; } catch { /* ignore */ }
    };
  }, [open, videoId]);

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
      <DialogContent className="max-w-3xl p-0 overflow-hidden bg-black border-0">
        <DialogHeader className="sr-only">
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div ref={containerRef} className="w-full" />
      </DialogContent>
    </Dialog>
  );
}
