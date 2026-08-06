import { useEffect, useState } from "react";
import { ArrowUp } from "lucide-react";

/**
 * Floating "back to top" button rendered portal-wide by AppLayout.
 *
 * - Hidden until the user has scrolled down a meaningful amount
 *   (SCROLL_THRESHOLD_PX), then fades in near the lower-right.
 * - Click scrolls the window back to the top. Motion preference aware:
 *   smooth for most users, instant for prefers-reduced-motion.
 * - Positioning: sits ABOVE the bottom-right widget stack so it never
 *   overlaps it. The stack is: AI chat launcher (bottom-6, top edge ≈96px)
 *   with the TicketDesk bubble pushed above it by index.css
 *   (`bottom: 96px !important`, 56px tall → top edge ≈152px). So the
 *   button's default offset is 160px (152px + an 8px gap). The `raised`
 *   prop lifts it a step further when the sticky FE "book your call" bottom
 *   bar is visible (mobile bar height ≈96px, still below the 152px stack
 *   top, so 176px keeps a clean gap above everything).
 * - Stacking: z-40 — above page content, level with the FE call bar, below
 *   the LiveChatCallout (z-50), Toaster (z-[100]) and impersonation banner.
 */

export const SCROLL_THRESHOLD_PX = 400;

export function scrollWindowToTop() {
  const prefersReducedMotion =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  window.scrollTo({ top: 0, behavior: prefersReducedMotion ? "instant" : "smooth" });
}

export function BackToTopButton({ raised = false }: { raised?: boolean }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > SCROLL_THRESHOLD_PX);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <button
      type="button"
      aria-label="Back to top"
      onClick={scrollWindowToTop}
      tabIndex={visible ? 0 : -1}
      aria-hidden={visible ? undefined : true}
      className={`fixed right-3 sm:right-5 z-40 flex h-10 w-10 items-center justify-center rounded-full border border-border bg-card text-card-foreground shadow-lg transition-all duration-200 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
        raised ? "bottom-44 sm:bottom-40" : "bottom-40"
      } ${visible ? "opacity-100" : "pointer-events-none opacity-0"}`}
      data-testid="back-to-top"
    >
      <ArrowUp className="h-5 w-5" aria-hidden="true" />
    </button>
  );
}
