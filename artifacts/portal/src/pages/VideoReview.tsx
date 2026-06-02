// TEMP PAGE — admin-only video review tracker at /videoreview.
// REMOVE BEFORE GO-LIVE together with the video status counter and the
// data-status tags on .video-slot elements in Blitz.tsx.
import { useMemo } from "react";
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

const STATUS_META: Record<StatusKey, { label: string; color: string; bg: string }> = {
  unreviewed: { label: "Unreviewed", color: "#334155", bg: "#e2e8f0" },
  "needs-rerecord": { label: "Re-record", color: "#92400e", bg: "#fde68a" },
};

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

function VideoTable({ items }: { items: VideoItem[] }) {
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
          {items.map((v, i) => (
            <tr key={`${v.vidalyticsId}-${i}`} className="border-t border-border align-top">
              <td className="px-3 py-2 text-muted-foreground">{i + 1}</td>
              <td className="px-3 py-2">
                <div className="font-medium">{v.title}</div>
                {v.description && (
                  <div className="text-xs text-muted-foreground">{v.description}</div>
                )}
              </td>
              <td className="px-3 py-2 text-xs text-muted-foreground">{v.section}</td>
              <td className="px-3 py-2 font-mono text-xs">{v.vidalyticsId}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function VideoReview() {
  const videos = useMemo(parseVideos, []);
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
        <VideoTable items={items} />
      </section>
    );
  };

  return (
    <AppLayout>
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Video Review Tracker</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Temporary admin-only view of Blitz videos that still need to be reviewed or
          re-recorded. {videos.length} total need attention.
        </p>
      </div>
      <Section status="unreviewed" items={unreviewed} />
      <Section status="needs-rerecord" items={rerecord} />
    </AppLayout>
  );
}
