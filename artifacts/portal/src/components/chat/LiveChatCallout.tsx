import { useState } from "react";
import { ArrowDown, X } from "lucide-react";

/**
 * Attention callout floating directly above the TicketDesk live-chat bubble
 * (bottom-right corner). A branded speech-bubble pill carries the message and
 * a gently bouncing arrow beneath it points straight down at the chat bubble.
 *
 * - Dismissible: the integrated × persists dismissal in localStorage so the
 *   callout never nags the same browser again.
 * - Pointer-events: the fixed wrapper is pointer-events-none so the chat
 *   bubble underneath / around it always stays clickable; only the visible
 *   pill re-enables pointer events (the arrow never captures clicks).
 * - Motion: the arrow bounce and the entrance animation use `motion-safe:`
 *   so they are disabled entirely for prefers-reduced-motion users.
 * - Stacking: z-50 — above page content and the FE call bar (z-40), below
 *   the Toaster (z-[100]) and the impersonation banner (z-[9999]).
 * - The `raised` prop lifts the callout when the sticky FE "book your call"
 *   bottom bar is visible so the two never collide.
 * - Vertical clearance: the portal pins the TicketDesk bubble at
 *   `bottom: 96px !important` (index.css .woot-widget-bubble) and the bubble
 *   renders ~64px tall, so the callout's default `bottom-44` (176px) puts the
 *   arrow ~16px above the bubble's top edge, pointing down at it without ever
 *   overlapping. Keep these offsets in lockstep with the index.css rule.
 * - Horizontal offset: right-16 (64px) keeps the pill to the LEFT of the
 *   fixed back-to-top button column (BackToTopButton: 40px wide at
 *   right-3/right-5, spanning up to 60px from the right edge), so the two
 *   floating controls can share the same vertical band without the z-50
 *   callout covering the z-40 button.
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
      className={`fixed right-16 z-50 pointer-events-none flex flex-col items-end motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-3 motion-safe:duration-500 ${
        raised ? "bottom-56" : "bottom-44"
      }`}
      data-testid="live-chat-callout"
    >
      {/* Branded speech-bubble pill */}
      <div className="pointer-events-auto relative max-w-[260px] rounded-2xl rounded-br-md bg-primary text-primary-foreground shadow-xl shadow-primary/25 ring-1 ring-black/5 px-4 py-3 pr-9">
        <button
          type="button"
          aria-label="Dismiss"
          onClick={dismiss}
          className="absolute top-2 right-2 rounded-full p-1 text-primary-foreground/70 hover:text-primary-foreground hover:bg-white/15 transition-colors"
          data-testid="live-chat-callout-dismiss"
        >
          <X className="w-3.5 h-3.5" />
        </button>
        <p className="text-sm font-semibold leading-snug">
          Have questions?
        </p>
        <p className="text-sm leading-snug text-primary-foreground/90">
          Chat with a live team member now.
        </p>
        {/* Speech-bubble tail, bottom-right, nudged toward the chat bubble */}
        <span
          aria-hidden="true"
          className="absolute -bottom-1.5 right-6 h-3 w-3 rotate-45 bg-primary"
        />
      </div>
      {/* Bouncing arrow pointing straight down at the chat bubble beneath */}
      <ArrowDown
        aria-hidden="true"
        className="mt-2 mr-5 w-7 h-7 text-primary drop-shadow-sm motion-safe:animate-bounce"
        data-testid="live-chat-callout-arrow"
      />
    </div>
  );
}
