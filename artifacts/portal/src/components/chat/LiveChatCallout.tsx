import { useState } from "react";
import { ArrowDownRight, X } from "lucide-react";

/**
 * Attention callout floating just above/left of the TicketDesk live-chat
 * bubble (bottom-right corner), pointing at it with a gently bouncing arrow
 * so members notice the live-chat option.
 *
 * - Dismissible: the × persists dismissal in localStorage so the callout
 *   never nags the same browser again.
 * - Pointer-events: the fixed wrapper is pointer-events-none so the chat
 *   bubble underneath / around it always stays clickable; only the visible
 *   card re-enables pointer events.
 * - Motion: the arrow bounce uses `motion-safe:` so it is disabled entirely
 *   for prefers-reduced-motion users.
 * - Stacking: z-50 — above page content and the FE call bar (z-40), below
 *   the Toaster (z-[100]) and the impersonation banner (z-[9999]).
 * - The `raised` prop lifts the callout when the sticky FE "book your call"
 *   bottom bar is visible so the two never collide.
 *
 * Purely presentational + localStorage — auth/audience gating lives in the
 * App-level mount (LiveChatCalloutGate in App.tsx).
 */

export const LIVE_CHAT_CALLOUT_DISMISSED_KEY = "bts:live-chat-callout-dismissed";

export function isLiveChatCalloutDismissed(): boolean {
  try {
    return window.localStorage.getItem(LIVE_CHAT_CALLOUT_DISMISSED_KEY) === "1";
  } catch {
    // localStorage unavailable (privacy mode etc.) — fail closed so we don't
    // nag on every load with no way to persist the dismissal.
    return true;
  }
}

export function LiveChatCallout({ raised = false }: { raised?: boolean }) {
  const [dismissed, setDismissed] = useState<boolean>(() => isLiveChatCalloutDismissed());

  if (dismissed) return null;

  const dismiss = () => {
    try {
      window.localStorage.setItem(LIVE_CHAT_CALLOUT_DISMISSED_KEY, "1");
    } catch {
      // Best effort — still hide for this session.
    }
    setDismissed(true);
  };

  return (
    <div
      className={`fixed right-3 sm:right-5 z-50 pointer-events-none ${
        raised ? "bottom-44 sm:bottom-40" : "bottom-24 sm:bottom-24"
      }`}
      data-testid="live-chat-callout"
    >
      <div className="pointer-events-auto relative max-w-[240px] rounded-lg border border-border bg-card text-card-foreground shadow-lg px-3 py-2.5 pr-8">
        <button
          type="button"
          aria-label="Dismiss"
          onClick={dismiss}
          className="absolute top-1.5 right-1.5 rounded p-0.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          data-testid="live-chat-callout-dismiss"
        >
          <X className="w-3.5 h-3.5" />
        </button>
        <p className="text-sm font-medium leading-snug">
          Have questions? Chat with a live team member now.
        </p>
        <ArrowDownRight
          aria-hidden="true"
          className="absolute -bottom-6 right-2 w-6 h-6 text-primary motion-safe:animate-bounce"
          data-testid="live-chat-callout-arrow"
        />
      </div>
    </div>
  );
}
