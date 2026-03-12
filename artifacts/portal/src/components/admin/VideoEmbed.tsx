import { useMemo } from "react";

interface VideoEmbedProps {
  url: string;
  className?: string;
}

function parseVideoUrl(url: string): { provider: string; embedUrl: string } | null {
  if (!url) return null;

  const youtubeMatch = url.match(
    /(?:youtube\.com\/(?:watch\?v=|embed\/|v\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/
  );
  if (youtubeMatch) {
    return {
      provider: "YouTube",
      embedUrl: `https://www.youtube.com/embed/${youtubeMatch[1]}?rel=0`,
    };
  }

  const vimeoMatch = url.match(/(?:vimeo\.com\/|player\.vimeo\.com\/video\/)(\d+)/);
  if (vimeoMatch) {
    return {
      provider: "Vimeo",
      embedUrl: `https://player.vimeo.com/video/${vimeoMatch[1]}`,
    };
  }

  const wistiaMatch = url.match(
    /(?:wistia\.com\/medias\/|wi\.st\/medias\/|fast\.wistia\.(?:net|com)\/(?:embed\/iframe|medias)\/)([a-zA-Z0-9]+)/
  );
  if (wistiaMatch) {
    return {
      provider: "Wistia",
      embedUrl: `https://fast.wistia.net/embed/iframe/${wistiaMatch[1]}`,
    };
  }

  return null;
}

export function VideoEmbed({ url, className = "" }: VideoEmbedProps) {
  const parsed = useMemo(() => parseVideoUrl(url), [url]);

  if (!parsed) {
    return (
      <div className={`bg-muted rounded-lg border border-dashed border-border p-8 text-center ${className}`}>
        <p className="text-sm text-muted-foreground">
          {url ? "Unsupported video URL. Supports YouTube, Vimeo, and Wistia." : "Enter a video URL to see preview"}
        </p>
      </div>
    );
  }

  return (
    <div className={`relative w-full overflow-hidden rounded-lg ${className}`} style={{ paddingBottom: "56.25%" }}>
      <iframe
        src={parsed.embedUrl}
        title={`${parsed.provider} video`}
        className="absolute inset-0 w-full h-full"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
        frameBorder="0"
      />
    </div>
  );
}

export { parseVideoUrl };
