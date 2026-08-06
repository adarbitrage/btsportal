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
 * - Geometry (keep in lockstep with src/lib/ticketdesk-bubble-pin.ts and
 *   BackToTopButton.tsx): the TicketDesk bubble renders inside an open shadow
 *   root at the widget's stock `right: 20px`, is 56px wide/tall, and is
 *   pinned at `bottom: 96px` by the injected shadow style — so it occupies
 *   96–152px from the bottom with its horizontal center 48px from the right
 *   viewport edge.
 *   - Wrapper: `right-5` (20px) + `bottom-40` (160px) puts the arrow's
 *     bottom edge 8px above the bubble's 152px top edge.
 *   - Arrow: w-7 (28px) with mr-3.5 (14px) → arrow center at
 *     20 + 14 + 14 = 48px from the right = the bubble's center.
 *   - Pill: sits above the arrow with mt-7 (28px) of clearance so its bottom
 *     edge (160 + 28 + 28 = 216px) clears the BackToTopButton's highest
 *     position (raised mobile: bottom-44 + 40px height = 216px top edge).
 * - The `raised` prop marks the sticky FE "book your call" bottom bar as
 *   visible. The bubble is pinned at 96px regardless (well above the bar),
 *   so the callout keeps the same offsets in both states — the prop is
 *   retained for the App-level gate's API and future-proofing.
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

  // `raised` intentionally unused for positioning — the bubble is pinned at
  // 96px in both states; kept so the App gate's contract stays stable.
  void raised;

  return (
    <div
      className="fixed right-5 bottom-40 z-50 pointer-events-none flex flex-col items-end motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-3 motion-safe:duration-500"
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
      {/* Bouncing arrow pointing straight down at the chat bubble beneath —
          mr-3.5 centers it on the bubble's 48px-from-right column */}
      <ArrowDown
        aria-hidden="true"
        className="mt-7 mr-3.5 w-7 h-7 text-primary drop-shadow-sm motion-safe:animate-bounce"
        data-testid="live-chat-callout-arrow"
      />
    </div>
  );
}
