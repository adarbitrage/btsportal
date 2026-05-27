import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { PlayCircle, Play } from "lucide-react";

type VidalyticsDialogProps = {
  videoUrl: string;
  title: string;
  triggerLabel?: string;
  posterUrl?: string;
  variant?: "button" | "thumbnail";
  className?: string;
};

export function VidalyticsDialog({
  videoUrl,
  title,
  triggerLabel = "Watch overview",
  posterUrl,
  variant = "button",
  className,
}: VidalyticsDialogProps) {
  const [open, setOpen] = useState(false);

  if (!videoUrl) return null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {variant === "thumbnail" && posterUrl ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={triggerLabel}
          data-testid={`button-overview-video-${encodeURIComponent(videoUrl)}`}
          className="group relative block w-full overflow-hidden rounded-md border border-black/10 bg-black focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
        >
          <img
            src={posterUrl}
            alt={`${title} preview`}
            className="w-full h-auto aspect-video object-cover transition-transform duration-300 group-hover:scale-[1.02]"
            loading="lazy"
          />
          <div className="absolute inset-0 flex items-center justify-center bg-black/30 transition-colors duration-200 group-hover:bg-black/40">
            <div className="flex items-center justify-center w-14 h-14 rounded-full bg-white/95 shadow-lg ring-1 ring-black/10 transition-transform duration-200 group-hover:scale-110">
              <Play className="w-6 h-6 text-black fill-black ml-0.5" />
            </div>
          </div>
          <div className="absolute bottom-0 left-0 right-0 px-3 py-2 text-left text-xs font-medium text-white bg-gradient-to-t from-black/70 to-transparent">
            {triggerLabel}
          </div>
        </button>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={className ?? "gap-1.5"}
          onClick={() => setOpen(true)}
          data-testid={`button-overview-video-${encodeURIComponent(videoUrl)}`}
        >
          <PlayCircle className="w-4 h-4" />
          {triggerLabel}
        </Button>
      )}
      <DialogContent className="max-w-3xl p-0 overflow-hidden bg-black border-0 sm:rounded-lg">
        <DialogHeader className="sr-only">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>Video player for {title}.</DialogDescription>
        </DialogHeader>
        {open && (
          <video
            key={videoUrl}
            src={videoUrl}
            poster={posterUrl}
            controls
            autoPlay
            playsInline
            preload="metadata"
            className="w-full h-auto aspect-video bg-black"
          >
            Your browser does not support the video tag.
          </video>
        )}
      </DialogContent>
    </Dialog>
  );
}
