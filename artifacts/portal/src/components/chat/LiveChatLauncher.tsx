import { useCallback, useEffect, useRef, useState } from "react";
import { Headset, X, Minimize2, ExternalLink } from "lucide-react";
import { TICKETDESK_URL } from "@/config/support";

interface LiveChatLauncherProps {
  /** When true, sits above the AI chat launcher so the two don't overlap. */
  stacked?: boolean;
}

export function LiveChatLauncher({ stacked = false }: LiveChatLauncherProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const loadTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const openInNewTab = useCallback(() => {
    window.open(TICKETDESK_URL, "_blank", "noopener,noreferrer");
  }, []);

  const clearLoadTimeout = useCallback(() => {
    if (loadTimeoutRef.current) {
      clearTimeout(loadTimeoutRef.current);
      loadTimeoutRef.current = null;
    }
  }, []);

  const handleOpen = useCallback(() => {
    setIsOpen(true);
    setHasLoaded(false);
    setFailed(false);
    clearLoadTimeout();
    loadTimeoutRef.current = setTimeout(() => {
      setHasLoaded((loaded) => {
        if (!loaded) setFailed(true);
        return loaded;
      });
    }, 8000);
  }, [clearLoadTimeout]);

  const handleClose = useCallback(() => {
    setIsOpen(false);
    clearLoadTimeout();
  }, [clearLoadTimeout]);

  const handleIframeLoad = useCallback(() => {
    setHasLoaded(true);
    setFailed(false);
    clearLoadTimeout();
  }, [clearLoadTimeout]);

  const handleIframeError = useCallback(() => {
    setFailed(true);
    clearLoadTimeout();
  }, [clearLoadTimeout]);

  useEffect(() => clearLoadTimeout, [clearLoadTimeout]);

  if (isOpen) {
    return (
      <div className="fixed bottom-0 right-0 z-50 sm:bottom-6 sm:right-6 w-full sm:w-[420px] h-full sm:h-[640px] sm:max-h-[85vh] bg-white sm:rounded-2xl shadow-2xl border border-border flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-white shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-foreground/10 flex items-center justify-center">
              <Headset className="w-4 h-4 text-foreground" />
            </div>
            <div>
              <h3 className="font-semibold text-sm text-foreground">Live Chat Support</h3>
              <p className="text-[10px] text-muted-foreground">Talk to our support team</p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={openInNewTab}
              className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
              title="Open in new tab"
            >
              <ExternalLink className="w-4 h-4" />
            </button>
            <button
              onClick={handleClose}
              className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
              title="Minimize"
            >
              <Minimize2 className="w-4 h-4" />
            </button>
            <button
              onClick={handleClose}
              className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
              title="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="relative flex-1 bg-secondary/30">
          {failed ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center">
              <Headset className="w-8 h-8 text-muted-foreground" />
              <p className="text-sm text-foreground font-medium">
                Live chat couldn't load here
              </p>
              <p className="text-xs text-muted-foreground">
                Open it in a new tab to continue.
              </p>
              <button
                onClick={openInNewTab}
                className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-foreground text-background px-4 py-2 text-sm font-semibold hover:opacity-90 transition-opacity"
              >
                <ExternalLink className="w-4 h-4" />
                Open Live Chat
              </button>
            </div>
          ) : (
            <>
              {!hasLoaded && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="w-6 h-6 rounded-full border-2 border-muted-foreground/30 border-t-foreground animate-spin" />
                </div>
              )}
              <iframe
                src={TICKETDESK_URL}
                title="Live Chat Support"
                className="absolute inset-0 w-full h-full border-0"
                onLoad={handleIframeLoad}
                onError={handleIframeError}
              />
            </>
          )}
        </div>
      </div>
    );
  }

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
