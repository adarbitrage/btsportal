import { useEffect } from "react";
import {
  TICKETDESK_WIDGET_SCRIPT_URL,
  TICKETDESK_WIDGET_WORKSPACE_ID,
  TICKETDESK_WIDGET_API_URL,
} from "@/config/support";

interface LiveChatLauncherProps {
  /** When true, injects a CSS offset so the TicketDesk widget bubble sits
   *  above the AI chat launcher instead of overlapping it. */
  stacked?: boolean;
}

/** DOM id for the injected widget script element. */
export const WIDGET_SCRIPT_ID = "ticketdesk-widget-script";

/** DOM id for the injected stacking-offset style element. */
export const WIDGET_STACKED_STYLE_ID = "ticketdesk-widget-stacked";

/**
 * Injects the TicketDesk chat widget script so the configured customer-facing
 * chat widget renders on the page. The widget renders its own launcher bubble
 * and chat panel; this component does not render any custom button or iframe.
 *
 * The script is injected once and removed on unmount so it does not leak when
 * the component is removed from the tree (e.g. navigating to a hidden route or
 * signing out). The `isChatWidgetHiddenRoute` + `AuthenticatedChatWidget`
 * gating in App.tsx ensures this component is never mounted on auth /
 * onboarding routes.
 *
 * When `stacked` is true (the AI ChatWidget is also rendered), a CSS override
 * is injected that lifts the TicketDesk widget bubble above the AI chat
 * launcher so the two do not overlap.
 */
export function LiveChatLauncher({ stacked = false }: LiveChatLauncherProps) {
  useEffect(() => {
    if (!document.getElementById(WIDGET_SCRIPT_ID)) {
      const script = document.createElement("script");
      script.id = WIDGET_SCRIPT_ID;
      script.src = TICKETDESK_WIDGET_SCRIPT_URL;
      script.async = true;
      script.setAttribute("data-workspace", TICKETDESK_WIDGET_WORKSPACE_ID);
      script.setAttribute("data-api", TICKETDESK_WIDGET_API_URL);
      document.head.appendChild(script);
    }
    return () => {
      document.getElementById(WIDGET_SCRIPT_ID)?.remove();
    };
  }, []);

  useEffect(() => {
    if (stacked) {
      if (!document.getElementById(WIDGET_STACKED_STYLE_ID)) {
        const style = document.createElement("style");
        style.id = WIDGET_STACKED_STYLE_ID;
        // Push the TicketDesk widget bubble up by ~96 px (bottom-24 in Tailwind
        // = 6rem = 96 px) so it clears the AI chat launcher (bottom-6 + height).
        style.textContent = [
          ".woot-widget-bubble { bottom: 96px !important; }",
          ".chatwoot-widget-bubble { bottom: 96px !important; }",
        ].join("\n");
        document.head.appendChild(style);
      }
    } else {
      document.getElementById(WIDGET_STACKED_STYLE_ID)?.remove();
    }
    return () => {
      document.getElementById(WIDGET_STACKED_STYLE_ID)?.remove();
    };
  }, [stacked]);

  return null;
}
