// TEMP PAGE — admin-only video review tracker at /videoreview.
// REMOVE BEFORE GO-LIVE together with the video status counter and the
// data-status tags on .video-slot elements in Blitz.tsx.
import { useEffect, useMemo, useRef, useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { blitzBodyHTML } from "@/pages/Blitz";

type StatusKey = "unreviewed" | "needs-rerecord";

interface VideoItem {
  vidalyticsId: string;
  title: string;
  description: string;
  section: string;
  status: StatusKey;
}

const VD_ACCOUNT = "trR5xdVa";

const STATUS_META: Record<StatusKey, { label: string; color: string; bg: string }> = {
  unreviewed: { label: "Unreviewed", color: "#334155", bg: "#e2e8f0" },
  "needs-rerecord": { label: "Re-record", color: "#92400e", bg: "#fde68a" },
};

function isPlayable(id: string): boolean {
  return !!id && id !== "—" && !id.startsWith("VIDEO_ID_");
}

function parseVideos(): VideoItem[] {
  if (typeof window === "undefined") return [];
  const doc = new DOMParser().parseFromString(blitzBodyHTML, "text/html");
  const slots = Array.from(doc.querySelectorAll<HTMLElement>(".video-slot"));
  const items: VideoItem[] = [];
  for (const slot of slots) {
    const raw = slot.getAttribute("data-status");
    let status: StatusKey | null = null;
    if (raw === "needs-rerecord") status = "needs-rerecord";
    else if (!raw) status = "unreviewed";
    if (!status) continue; // skip ready / incorrect-link / awaiting-link

    const title = slot.querySelector(".vt")?.textContent?.trim() || "(untitled)";
    const description = slot.querySelector(".vd")?.textContent?.trim() || "";
    const vidalyticsId = slot.getAttribute("data-vidalytics-id") || "—";

    const moduleEl = slot.closest(".module");
    const badge = moduleEl?.querySelector(".mod-badge")?.textContent?.trim() || "";
    const heading = moduleEl?.querySelector(".module-header h2")?.textContent?.trim() || "";
    const section = [badge, heading].filter(Boolean).join(" · ") || "Unknown section";

    items.push({ vidalyticsId, title, description, section, status });
  }
  return items;
}

// Self-contained Vidalytics player modal. Uses the same per-video JS embed
// bootstrap as the Blitz lightbox so review playback matches the live page.
// Remounted per video via a React `key` so each open bootstraps fresh.
function VideoModal({ video, onClose }: { video: VideoItem; onClose: () => void }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const videoId = video.vidalyticsId;
    container.innerHTML = "";

    if (!isPlayable(videoId)) {
      container.innerHTML =
        '<div style="padding:40px;text-align:center;color:#94a3b8;">&#9888; Video not yet connected.<br><small>This video has not been uploaded to Vidalytics yet.</small></div>';
      return;
    }

    const embedId = `vidalytics_embed_${videoId}`;
    const baseUrl = `https://fast.vidalytics.com/embeds/${VD_ACCOUNT}/${videoId}/`;

    const div = document.createElement("div");
    div.id = embedId;
    div.style.cssText = "width:100%;position:relative;padding-top:56.25%;";
    container.appendChild(div);

    const ownedScripts = new Set<HTMLScriptElement>();
    const headObserver = new MutationObserver((records) => {
      for (const r of records) {
        r.addedNodes.forEach((n) => {
          if (
            n.nodeType === 1 &&
            (n as HTMLElement).tagName === "SCRIPT" &&
            ((n as HTMLScriptElement).src || "").includes("vidalytics.com")
          ) {
            ownedScripts.add(n as HTMLScriptElement);
          }
        });
      }
    });
    headObserver.observe(document.head, { childList: true });

    const script = document.createElement("script");
    script.type = "text/javascript";
    script.text =
      "(function(v,i,d,a,l,y,t,c,s){y='_'+d.toLowerCase();c=d+'L';if(!v[d]){v[d]={};}if(!v[c]){v[c]={};}if(!v[y]){v[y]={};}var vl='Loader',vli=v[y][vl],vsl=v[c][vl+'Script'],vlf=v[c][vl+'Loaded'],ve='Embed';if(!vsl){vsl=function(u,cb){if(t){cb();return;}s=i.createElement('script');s.type='text/javascript';s.async=1;s.src=u;if(s.readyState){s.onreadystatechange=function(){if(s.readyState==='loaded'||s.readyState=='complete'){s.onreadystatechange=null;vlf=1;cb();}};}else{s.onload=function(){vlf=1;cb();};}i.getElementsByTagName('head')[0].appendChild(s);};}vsl(l+'loader.min.js',function(){if(!vli){var vlc=v[c][vl];vli=new vlc();}vli.loadScript(l+'player.min.js',function(){var vec=v[d][ve];t=new vec();t.run(a);});});})(window,document,'Vidalytics'," +
      JSON.stringify(embedId) + "," + JSON.stringify(baseUrl) + ");";
    div.parentNode?.insertBefore(script, div.nextSibling);
    ownedScripts.add(script);

    return () => {
      headObserver.disconnect();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const w = window as any;
      try { delete w.Vidalytics; } catch { /* ignore */ }
      try { delete w.VidalyticsL; } catch { /* ignore */ }
      ownedScripts.forEach((s) => s.parentNode?.removeChild(s));
      ownedScripts.clear();
      container.innerHTML = "";
    };
  }, [video]);

  useEffect(() => {
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = "";
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        background: "rgba(0,0,0,.8)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ position: "relative", width: "100%", maxWidth: 900 }}
      >
        <div className="mb-2 flex items-center justify-between gap-4 text-white">
          <span className="text-sm font-medium">{video.title}</span>
          <button
            onClick={onClose}
            aria-label="Close video"
            className="rounded-md bg-white/15 px-3 py-1 text-sm hover:bg-white/25"
          >
            ✕ Close
          </button>
        </div>
        <div ref={containerRef} style={{ background: "#000", borderRadius: 8, overflow: "hidden" }} />
      </div>
    </div>
  );
}

function VideoTable({
  items,
  onPlay,
}: {
  items: VideoItem[];
  onPlay: (v: VideoItem) => void;
}) {
  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">None — all caught up.</p>;
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-left">
          <tr>
            <th className="px-3 py-2 font-semibold">#</th>
            <th className="px-3 py-2 font-semibold">Video</th>
            <th className="px-3 py-2 font-semibold">Section</th>
            <th className="px-3 py-2 font-semibold">Vidalytics ID</th>
          </tr>
        </thead>
        <tbody>
          {items.map((v, i) => {
            const playable = isPlayable(v.vidalyticsId);
            return (
              <tr key={`${v.vidalyticsId}-${i}`} className="border-t border-border align-top">
                <td className="px-3 py-2 text-muted-foreground">{i + 1}</td>
                <td className="px-3 py-2">
                  {playable ? (
                    <button
                      onClick={() => onPlay(v)}
                      className="text-left font-medium text-primary underline-offset-2 hover:underline"
                      title="Play video"
                    >
                      {v.title}
                    </button>
                  ) : (
                    <div className="font-medium">
                      {v.title}{" "}
                      <span className="text-xs italic text-muted-foreground">(not connected)</span>
                    </div>
                  )}
                  {v.description && (
                    <div className="text-xs text-muted-foreground">{v.description}</div>
                  )}
                </td>
                <td className="px-3 py-2 text-xs text-muted-foreground">{v.section}</td>
                <td className="px-3 py-2 font-mono text-xs">{v.vidalyticsId}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function VideoReview() {
  const videos = useMemo(parseVideos, []);
  const [playing, setPlaying] = useState<VideoItem | null>(null);
  const unreviewed = videos.filter((v) => v.status === "unreviewed");
  const rerecord = videos.filter((v) => v.status === "needs-rerecord");

  const Section = ({ status, items }: { status: StatusKey; items: VideoItem[] }) => {
    const meta = STATUS_META[status];
    return (
      <section className="mb-8">
        <div className="mb-3 flex items-center gap-2">
          <span
            className="rounded-full px-2.5 py-0.5 text-xs font-semibold"
            style={{ color: meta.color, background: meta.bg }}
          >
            {meta.label}
          </span>
          <span className="text-sm text-muted-foreground">{items.length} video(s)</span>
        </div>
        <VideoTable items={items} onPlay={setPlaying} />
      </section>
    );
  };

  return (
    <AppLayout>
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Video Review Tracker</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Temporary admin-only view of Blitz videos that still need to be reviewed or
          re-recorded. Click <strong>Play</strong> to watch any connected video.{" "}
          {videos.length} total need attention.
        </p>
      </div>
      <Section status="unreviewed" items={unreviewed} />
      <Section status="needs-rerecord" items={rerecord} />
      {playing && (
        <VideoModal
          key={playing.vidalyticsId}
          video={playing}
          onClose={() => setPlaying(null)}
        />
      )}
    </AppLayout>
  );
}
