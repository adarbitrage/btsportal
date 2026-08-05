import { useCallback } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { VidalyticsEmbed } from "@/components/VidalyticsEmbed";
import {
  useCurriculumContent,
  CURRICULUM_SKELETON_ROWS,
} from "@/hooks/use-curriculum-content";
import { CalendarClock, LifeBuoy, Sparkles } from "lucide-react";
import {
  FeIntensiveBooking,
  type FeBookingUiCopy,
} from "@/components/welcome/FeIntensiveBooking";

/**
 * Front-End Welcome page — the post-purchase landing surface for members
 * whose highest product is a front-end offer or funnel product (no
 * mentorship tier). Rendered at `/` by the landing gate in App.tsx; tier
 * members never land here (they keep the existing Home).
 *
 * The page body is served by the gated /curriculum/frontend-welcome endpoint
 * (de-bundle pattern — zero copy in the JS bundle) with client-side brand
 * substitution. The video at the top is a PLACEHOLDER (single swappable
 * constant server-side); the booking section renders a config-pending state
 * until the native portal booking calendar (GHL-backed) ships as its own
 * future task.
 */

interface WelcomeBullet {
  title: string;
  text: string;
}

interface WelcomeDay {
  title: string;
  paragraphsHtml: string[];
  bullets: WelcomeBullet[];
  closingHtml: string[];
}

interface FrontendWelcomeContent {
  pageTitle: string;
  video: { embedId: string; loaderUrl: string; isPlaceholder?: boolean };
  introHtml: string[];
  pillars: { title: string; lead?: string; paragraphsHtml: string[] }[];
  afterPillarsHtml: string[];
  days: WelcomeDay[];
  closingHtml: string[];
  booking: {
    heading: string;
    pendingTitle: string;
    pendingBodyHtml: string;
    ui: FeBookingUiCopy;
  };
}

const BOOKING_ANCHOR_ID = "booking";

function Paragraphs({ html }: { html: string[] }) {
  return (
    <>
      {html.map((p, i) => (
        <p
          key={i}
          className="text-muted-foreground leading-relaxed"
          dangerouslySetInnerHTML={{ __html: p }}
        />
      ))}
    </>
  );
}

export default function FrontendWelcome() {
  const { content, isLoading, isError } =
    useCurriculumContent<FrontendWelcomeContent>("frontend-welcome");

  // Intercept the copy's inline "book your call" links (<a data-booking>)
  // and smooth-scroll to the booking section instead of navigating.
  const onBodyClick = useCallback((e: React.MouseEvent<HTMLElement>) => {
    const anchor = (e.target as HTMLElement).closest("a[data-booking]");
    if (!anchor) return;
    e.preventDefault();
    document
      .getElementById(BOOKING_ANCHOR_ID)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  return (
    <AppLayout>
      <div className="space-y-8 max-w-4xl" onClick={onBodyClick}>
        {isLoading && (
          <div className="space-y-4" data-testid="welcome-loading">
            {CURRICULUM_SKELETON_ROWS.map((r) => (
              <Skeleton key={r} className="h-24 w-full" />
            ))}
          </div>
        )}

        {isError && !isLoading && (
          <Card>
            <CardContent className="py-10 text-center text-muted-foreground">
              We couldn't load your welcome page right now. Please refresh, or
              reach out through the Support page if this keeps happening.
            </CardContent>
          </Card>
        )}

        {content && (
          <>
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Sparkles className="w-6 h-6 text-primary" />
                <h1
                  className="text-3xl font-bold"
                  data-testid="welcome-title"
                  dangerouslySetInnerHTML={{ __html: content.pageTitle }}
                />
              </div>
            </div>

            {/* Placeholder welcome video (swappable server-side constant). */}
            <div className="space-y-2">
              <VidalyticsEmbed
                embedId={content.video.embedId}
                loaderUrl={content.video.loaderUrl}
                className="rounded-lg overflow-hidden border"
              />
              {content.video.isPlaceholder && (
                <p className="text-xs text-muted-foreground text-center">
                  Placeholder video — your official welcome video is on its
                  way.
                </p>
              )}
            </div>

            <div className="space-y-4">
              <Paragraphs html={content.introHtml} />
            </div>

            <div className="space-y-6">
              {content.pillars.map((pillar) => (
                <div key={pillar.title} className="space-y-3">
                  {pillar.lead && (
                    <p className="text-muted-foreground leading-relaxed">
                      {pillar.lead}
                    </p>
                  )}
                  <h2 className="text-xl font-semibold text-foreground">
                    {pillar.title}
                  </h2>
                  <Paragraphs html={pillar.paragraphsHtml} />
                </div>
              ))}
            </div>

            <div className="space-y-4">
              <Paragraphs html={content.afterPillarsHtml} />
            </div>

            <div className="space-y-8">
              {content.days.map((day) => (
                <div key={day.title} className="space-y-4">
                  <h2 className="text-xl font-semibold text-foreground">
                    {day.title}
                  </h2>
                  <Paragraphs html={day.paragraphsHtml} />
                  {day.bullets.length > 0 && (
                    <div className="space-y-4 border-l-2 border-primary/30 pl-4">
                      {day.bullets.map((b) => (
                        <p
                          key={b.title}
                          className="text-muted-foreground leading-relaxed"
                        >
                          <strong className="text-foreground">
                            {b.title}
                          </strong>{" "}
                          {b.text}
                        </p>
                      ))}
                    </div>
                  )}
                  {day.closingHtml.length > 0 && (
                    <Paragraphs html={day.closingHtml} />
                  )}
                </div>
              ))}
            </div>

            <div className="space-y-4">
              <Paragraphs html={content.closingHtml} />
            </div>

            {/* Booking section — anchor target for the copy's inline links.
                The native GHL-backed booking surface renders once the
                FE-intensive calendar is configured in admin settings; until
                then the pending card below stays. Do NOT wire front-end
                members into kickoff/session-pack/partner booking. */}
            <section
              id={BOOKING_ANCHOR_ID}
              className="scroll-mt-24 space-y-4"
              data-testid="booking-section"
            >
              <h2 className="text-2xl font-bold text-center">
                {content.booking.heading}
              </h2>
              <FeIntensiveBooking
                copy={content.booking.ui}
                pending={
                  <Card>
                    <CardContent className="py-10 text-center space-y-3">
                      <CalendarClock className="w-10 h-10 text-primary mx-auto" />
                      <p className="text-lg font-semibold">
                        {content.booking.pendingTitle}
                      </p>
                      <p
                        className="text-muted-foreground max-w-xl mx-auto leading-relaxed"
                        dangerouslySetInnerHTML={{
                          __html: content.booking.pendingBodyHtml,
                        }}
                      />
                      <p className="text-sm text-muted-foreground flex items-center justify-center gap-1.5">
                        <LifeBuoy className="w-4 h-4" />
                        Need a hand? Contact support any time from the Support
                        page.
                      </p>
                    </CardContent>
                  </Card>
                }
              />
            </section>
          </>
        )}
      </div>
    </AppLayout>
  );
}
