import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  fetchSwipeBank,
  fetchSwipeBankItemBlob,
  downloadSwipeBankItem,
  swipeBankThumbnailUrl,
  type SwipeBankItem,
  type SwipeBankSubVertical,
  type SwipeBankVertical,
} from "@/lib/swipe-bank-api";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Download, FileText, Images, Loader2, ScrollText } from "lucide-react";

/**
 * Swipe Resource Bank (Task #2104) — gated member gallery of creative swipes.
 * Vertical tabs → sub-vertical sections; banners in angle-grouped thumbnail
 * grids (cookie-backed thumbs, full-size lightbox via authFetch→blob);
 * advertorials as preview cards with blob-based downloads.
 *
 * The ownership/use disclaimer is legally load-bearing: a top link plus the
 * full block at the bottom, both always rendered.
 */

function EmptyState({ label }: { label: string }) {
  return (
    <div
      className="rounded-lg border border-dashed border-border bg-muted/30 px-6 py-8 text-center text-sm text-muted-foreground"
      data-testid="swipe-bank-empty-state"
    >
      {label}
    </div>
  );
}

/** Full-size viewer: fetches bytes via authFetch→blob (token-expiry-proof). */
function Lightbox({
  item,
  onClose,
}: {
  item: SwipeBankItem | null;
  onClose: () => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!item) return;
    let objectUrl: string | null = null;
    let cancelled = false;
    setUrl(null);
    setError(null);
    fetchSwipeBankItemBlob(item.id)
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load");
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [item]);

  return (
    <Dialog open={!!item} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-4xl" data-testid="swipe-bank-lightbox">
        <DialogHeader>
          <DialogTitle className="pr-8 truncate">{item?.title}</DialogTitle>
        </DialogHeader>
        <div className="flex items-center justify-center min-h-[200px] max-h-[70vh] overflow-auto">
          {error ? (
            <p className="text-sm text-destructive">{error}</p>
          ) : url ? (
            <img src={url} alt={item?.title ?? ""} className="max-w-full h-auto" />
          ) : (
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          )}
        </div>
        {item?.sourceLabel ? (
          <p className="text-xs text-muted-foreground">Source: {item.sourceLabel}</p>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function BannerGrid({
  sub,
  onOpen,
}: {
  sub: SwipeBankSubVertical;
  onOpen: (item: SwipeBankItem) => void;
}) {
  const banners = sub.items.filter((i) => i.itemType === "banner");
  if (banners.length === 0) return null;

  const angleName = new Map(sub.angles.map((a) => [a.id, a.name]));
  const groups = new Map<string, SwipeBankItem[]>();
  for (const item of banners) {
    const key = item.angleId ? angleName.get(item.angleId) ?? "Other" : "General";
    const list = groups.get(key) ?? [];
    list.push(item);
    groups.set(key, list);
  }

  return (
    <div className="space-y-4">
      {Array.from(groups.entries()).map(([angle, items]) => (
        <div key={angle}>
          <h4
            className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2"
            data-testid={`swipe-bank-angle-${angle.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
          >
            {angle}
          </h4>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
            {items.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => onOpen(item)}
                className="group rounded-md border border-border bg-card overflow-hidden text-left hover:border-primary/60 transition-colors"
                data-testid={`swipe-bank-banner-${item.id}`}
              >
                <div className="aspect-square bg-muted/40 flex items-center justify-center overflow-hidden">
                  <img
                    src={swipeBankThumbnailUrl(item.id)}
                    alt={item.title}
                    loading="lazy"
                    className="max-w-full max-h-full object-contain"
                  />
                </div>
                <div className="px-2 py-1.5">
                  <p className="text-xs truncate">{item.title}</p>
                </div>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function AdvertorialCards({ sub }: { sub: SwipeBankSubVertical }) {
  const [busyId, setBusyId] = useState<number | null>(null);
  const advertorials = sub.items.filter((i) => i.itemType === "advertorial");
  if (advertorials.length === 0) return null;
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {advertorials.map((item) => (
        <div
          key={item.id}
          className="rounded-md border border-border bg-card p-4 flex flex-col gap-2"
          data-testid={`swipe-bank-advertorial-${item.id}`}
        >
          <div className="flex items-start gap-2">
            <FileText className="w-5 h-5 text-muted-foreground shrink-0 mt-0.5" />
            <div className="min-w-0">
              <p className="text-sm font-medium truncate">{item.title}</p>
              {item.sourceLabel ? (
                <p className="text-xs text-muted-foreground truncate">{item.sourceLabel}</p>
              ) : null}
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="h-8 mt-auto self-start"
            disabled={busyId === item.id}
            onClick={async () => {
              setBusyId(item.id);
              try {
                await downloadSwipeBankItem(item);
              } catch (err) {
                console.error("Swipe Bank download failed:", err);
              } finally {
                setBusyId(null);
              }
            }}
            data-testid={`swipe-bank-download-${item.id}`}
          >
            {busyId === item.id ? (
              <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
            ) : (
              <Download className="w-3.5 h-3.5 mr-1.5" />
            )}
            Download
          </Button>
        </div>
      ))}
    </div>
  );
}

function VerticalPanel({
  vertical,
  onOpen,
}: {
  vertical: SwipeBankVertical;
  onOpen: (item: SwipeBankItem) => void;
}) {
  if (vertical.subVerticals.length === 0) {
    return <EmptyState label="Nothing filed under this vertical yet — new swipes are added regularly." />;
  }
  return (
    <div className="space-y-8">
      {vertical.subVerticals.map((sub) => (
        <section key={sub.id} data-testid={`swipe-bank-sub-vertical-${sub.id}`}>
          <div className="flex items-center gap-3 mb-3">
            <h3 className="text-base font-bold text-foreground tracking-tight">{sub.name}</h3>
            <div className="flex-1 h-px bg-border" />
          </div>
          {sub.items.length === 0 ? (
            <EmptyState label={`No ${sub.name} swipes yet — check back soon.`} />
          ) : (
            <div className="space-y-5">
              <BannerGrid sub={sub} onOpen={onOpen} />
              <AdvertorialCards sub={sub} />
            </div>
          )}
        </section>
      ))}
    </div>
  );
}

export default function SwipeBank() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["swipe-bank"],
    queryFn: fetchSwipeBank,
  });
  const [activeVerticalId, setActiveVerticalId] = useState<number | null>(null);
  const [lightboxItem, setLightboxItem] = useState<SwipeBankItem | null>(null);

  const verticals = data?.verticals ?? [];
  const activeVertical = useMemo(
    () =>
      verticals.find((v) => v.id === activeVerticalId) ?? verticals[0] ?? null,
    [verticals, activeVerticalId],
  );

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <div className="flex items-center gap-3 mb-1">
        <Images className="w-6 h-6 text-primary" />
        <h1 className="text-2xl font-bold tracking-tight" data-testid="swipe-bank-title">
          Swipe Resource Bank
        </h1>
      </div>
      <p className="text-sm text-muted-foreground mb-3">
        Proven banner ads and advertorials from across the industry, organized by
        vertical and marketing angle — for research and inspiration.
      </p>

      {/* Top disclaimer link (legally load-bearing — always rendered). */}
      {data?.disclaimer ? (
        <a
          href="#swipe-bank-disclaimer"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground mb-6"
          data-testid="swipe-bank-disclaimer-top-link"
        >
          <ScrollText className="w-3.5 h-3.5" />
          {data.disclaimer.topNote}
        </a>
      ) : null}

      {isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : isError ? (
        <EmptyState label="We couldn't load the Swipe Resource Bank. Please try again shortly." />
      ) : verticals.length === 0 ? (
        <EmptyState label="The Swipe Resource Bank is being stocked — check back soon." />
      ) : (
        <>
          {/* Vertical tabs */}
          <div className="flex flex-wrap gap-2 mb-6" role="tablist" data-testid="swipe-bank-vertical-tabs">
            {verticals.map((v) => (
              <button
                key={v.id}
                type="button"
                role="tab"
                aria-selected={activeVertical?.id === v.id}
                onClick={() => setActiveVerticalId(v.id)}
                className={`px-4 py-1.5 rounded-full text-sm font-medium border transition-colors ${
                  activeVertical?.id === v.id
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-card text-foreground border-border hover:border-primary/60"
                }`}
                data-testid={`swipe-bank-tab-${v.id}`}
              >
                {v.name}
              </button>
            ))}
          </div>

          {activeVertical ? (
            <VerticalPanel vertical={activeVertical} onOpen={setLightboxItem} />
          ) : null}
        </>
      )}

      {/* Full disclaimer block at the bottom (matches the WP layout). */}
      {data?.disclaimer ? (
        <section
          id="swipe-bank-disclaimer"
          className="mt-12 rounded-lg border border-border bg-muted/30 p-6"
          data-testid="swipe-bank-disclaimer-block"
        >
          <h2 className="text-base font-bold mb-3">{data.disclaimer.heading}</h2>
          <div className="space-y-3">
            {data.disclaimer.paragraphs.map((p, i) => (
              <p key={i} className="text-sm text-muted-foreground leading-relaxed">
                {p}
              </p>
            ))}
          </div>
        </section>
      ) : null}

      <Lightbox item={lightboxItem} onClose={() => setLightboxItem(null)} />
    </div>
  );
}
