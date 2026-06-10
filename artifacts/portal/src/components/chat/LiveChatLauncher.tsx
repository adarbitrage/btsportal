import { Headset } from "lucide-react";

const TICKETDESK_URL = "https://tickets.buildtestscale.com/";

interface LiveChatLauncherProps {
  /** When true, sits above the AI chat launcher so the two don't overlap. */
  stacked?: boolean;
}

export function LiveChatLauncher({ stacked = false }: LiveChatLauncherProps) {
  const handleOpen = () => {
    window.open(TICKETDESK_URL, "_blank", "noopener,noreferrer");
  };

  return (
    <button
      onClick={handleOpen}
      className={`fixed right-6 z-50 h-14 px-5 rounded-full bg-foreground text-background shadow-lg shadow-foreground/20 flex items-center gap-2 hover:scale-105 transition-transform ${
        stacked ? "bottom-24" : "bottom-6"
      }`}
      aria-label="Open live chat support"
      title="Live Chat Support"
    >
      <Headset className="w-6 h-6 shrink-0" />
      <span className="text-sm font-semibold whitespace-nowrap">Live Chat</span>
    </button>
  );
}
