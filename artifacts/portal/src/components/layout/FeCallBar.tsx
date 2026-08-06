import { useCallback } from "react";
import { useLocation } from "wouter";
import { CalendarClock } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Persistent bottom bar for front-end (funnel) members who haven't booked
 * their FE-intensive call yet. Rendered portal-wide by AppLayout; visibility
 * is decided by useFeCallBar (fail-closed) — this component is purely
 * presentational.
 *
 * The CTA sends the member to the Frontend Welcome page's booking section
 * ("/" renders FrontendWelcome for this audience via the landing gate, with
 * the booking anchor #booking). Because the Welcome body loads async, we
 * retry the scroll briefly after navigating.
 */

const BOOKING_ANCHOR_ID = "booking";
const SCROLL_RETRY_MS = 250;
const SCROLL_RETRY_MAX = 20; // ~5s of retries while the page body loads

export function scrollToBookingWithRetry(attempt = 0) {
  const el = document.getElementById(BOOKING_ANCHOR_ID);
  if (el) {
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }
  if (attempt < SCROLL_RETRY_MAX) {
    window.setTimeout(() => scrollToBookingWithRetry(attempt + 1), SCROLL_RETRY_MS);
  }
}

export function FeCallBar() {
  const [location, navigate] = useLocation();

  const onCta = useCallback(() => {
    if (location !== "/") navigate("/");
    scrollToBookingWithRetry();
  }, [location, navigate]);

  return (
    <div
      className="fixed bottom-0 inset-x-0 z-40 border-t border-emerald-700/40 bg-emerald-600 text-white shadow-[0_-4px_12px_rgba(0,0,0,0.15)]"
      data-testid="fe-call-bar"
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3 flex flex-col sm:flex-row items-center justify-center gap-2 sm:gap-4 text-center sm:text-left">
        <p className="text-sm sm:text-base font-medium flex items-center gap-2">
          <CalendarClock className="w-5 h-5 shrink-0" />
          Your next step: book your call with a coach.
        </p>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="bg-white text-emerald-700 hover:bg-emerald-50"
          onClick={onCta}
          data-testid="fe-call-bar-cta"
        >
          Book My Call
        </Button>
      </div>
    </div>
  );
}
