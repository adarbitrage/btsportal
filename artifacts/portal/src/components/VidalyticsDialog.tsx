import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { PlayCircle } from "lucide-react";

type VidalyticsDialogProps = {
  videoUrl: string;
  title: string;
  triggerLabel?: string;
  posterUrl?: string;
};

export function VidalyticsDialog({ videoUrl, title, triggerLabel = "Watch overview", posterUrl }: VidalyticsDialogProps) {
  const [open, setOpen] = useState(false);

  if (!videoUrl) return null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="gap-1.5"
        onClick={() => setOpen(true)}
        data-testid={`button-overview-video-${encodeURIComponent(videoUrl)}`}
      >
        <PlayCircle className="w-4 h-4" />
        {triggerLabel}
      </Button>
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
