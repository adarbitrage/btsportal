import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Copy, Check, ChevronDown, ExternalLink } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useListMediaMavensCategories } from "@workspace/api-client-react";
import mediaMavensLogo from "@assets/mediamavens-logo-cropped.png";
import { useQuery } from "@tanstack/react-query";

const API_BASE = `${import.meta.env.BASE_URL}api`;

interface ProductWithLink {
  id: number;
  slug: string;
  name: string;
  tagline: string;
  category: string;
  imageUrl: string | null;
  description: string;
  costToConsumer: string;
  affiliateCommission: string;
  salesPageUrl: string;
  logoDriveUrl: string;
  affiliateLink: string;
  tapfiliateProgramId: string | null;
  tapfiliateProgramTitle: string | null;
  resolvedAffiliateLink: string;
  displayOrder: number;
  isActive: boolean;
}

function useProductsWithLinks() {
  return useQuery<ProductWithLink[]>({
    queryKey: ["/api/media-mavens-products/with-links"],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/media-mavens-products/with-links`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to load products");
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
  });
}

const SECTION_STYLES = {
  bar: "bg-card text-foreground",
  body: "bg-card",
  badge:
    "bg-white/90 dark:bg-emerald-950/60 text-emerald-900 dark:text-emerald-100 border border-emerald-400/60",
  chevron: "text-foreground",
};

function getImageSrc(product: ProductWithLink): string | null {
  if (!product.imageUrl) return null;
  if (product.imageUrl.startsWith("http://") || product.imageUrl.startsWith("https://")) {
    return product.imageUrl;
  }
  return `${import.meta.env.BASE_URL}api${product.imageUrl}`;
}

function isTemplateLink(link: string): boolean {
  return link.includes("youraffiliateid");
}

function ProductCard({ product }: { product: ProductWithLink }) {
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [isTruncated, setIsTruncated] = useState(false);
  const descRef = useRef<HTMLParagraphElement>(null);
  const imageSrc = getImageSrc(product);

  const displayLink = product.resolvedAffiliateLink;
  const isResolved = product.tapfiliateProgramId != null && !isTemplateLink(displayLink);

  useLayoutEffect(() => {
    const el = descRef.current;
    if (!el) return;
    const measure = () => {
      if (expanded) return;
      setIsTruncated(el.scrollHeight - el.clientHeight > 1);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [expanded, product.description]);

  useEffect(() => {
    const onResize = () => {
      const el = descRef.current;
      if (!el || expanded) return;
      setIsTruncated(el.scrollHeight - el.clientHeight > 1);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [expanded]);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(displayLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* noop */
    }
  };

  return (
    <Card
      className="border-2 border-border hover:shadow-lg transition-shadow overflow-hidden"
      data-testid={`card-product-${product.slug}`}
    >
      <CardContent className="p-0">
        <div className="flex flex-col md:flex-row">
          <div className="bg-white flex items-center justify-center md:w-80 md:h-80 shrink-0 border-b md:border-b-0 md:border-r border-border overflow-hidden">
            {imageSrc ? (
              <img
                src={imageSrc}
                alt={`${product.name} product`}
                className="w-full h-full object-contain block"
              />
            ) : (
              <div className="w-24 h-24 bg-muted rounded-lg" />
            )}
          </div>

          <div className="flex-1 min-w-0 p-5 flex flex-col">
            <div className="mb-2 flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
              <div className="min-w-0 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <h2 className="text-xl font-bold text-foreground">{product.name}</h2>
                <p className="text-sm text-muted-foreground">{product.tagline}</p>
              </div>
              <div className="flex flex-wrap gap-2 shrink-0">
                <Button asChild size="sm" data-testid={`button-sales-${product.slug}`}>
                  <a href={product.salesPageUrl} target="_blank" rel="noreferrer">
                    View Sales Page
                  </a>
                </Button>
                <Button
                  asChild
                  size="sm"
                  className="bg-emerald-600 hover:bg-emerald-700 text-white"
                  data-testid={`button-logo-${product.slug}`}
                >
                  <a href={product.logoDriveUrl} target="_blank" rel="noreferrer">
                    Download Official Logo
                  </a>
                </Button>
              </div>
            </div>

            <div className="mb-3">
              <p
                ref={descRef}
                className={`text-sm text-foreground/90 leading-relaxed ${
                  expanded ? "" : "line-clamp-[7]"
                }`}
              >
                {product.description}
              </p>
              {(isTruncated || expanded) && (
                <button
                  type="button"
                  onClick={() => setExpanded((v) => !v)}
                  className="mt-1 text-xs font-semibold text-primary hover:underline"
                  data-testid={`button-expand-${product.slug}`}
                >
                  {expanded ? "Show less" : "Read more"}
                </button>
              )}
            </div>

            <div className="rounded-lg border border-border bg-muted/40 px-4 py-3 mt-auto">
              <div className="flex flex-wrap items-center gap-x-6 gap-y-1 mb-2">
                <div className="flex items-baseline gap-2">
                  <p className="text-[11px] uppercase tracking-wide font-semibold text-muted-foreground">
                    Cost to Consumer
                  </p>
                  <p className="text-sm font-bold text-foreground">
                    {product.costToConsumer}
                  </p>
                </div>
                <div className="flex items-baseline gap-2">
                  <p className="text-[11px] uppercase tracking-wide font-semibold text-emerald-700">
                    Affiliate Commission
                  </p>
                  <p className="text-sm font-bold text-emerald-700">
                    {product.affiliateCommission}
                  </p>
                </div>
              </div>
              <div className="flex items-stretch gap-2">
                <code className="flex-1 min-w-0 text-xs bg-background border border-dashed border-border rounded px-2.5 py-2 font-mono text-foreground/90 truncate">
                  {displayLink}
                </code>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={copyLink}
                  data-testid={`button-copy-${product.slug}`}
                  className="shrink-0"
                >
                  {copied ? (
                    <>
                      <Check className="w-4 h-4 mr-1.5 text-emerald-600" /> Copied
                    </>
                  ) : (
                    <>
                      <Copy className="w-4 h-4 mr-1.5" /> Copy
                    </>
                  )}
                </Button>
                {isResolved && (
                  <Button
                    size="sm"
                    variant="outline"
                    asChild
                    data-testid={`button-visit-${product.slug}`}
                    className="shrink-0"
                  >
                    <a href={displayLink} target="_blank" rel="noreferrer">
                      <ExternalLink className="w-4 h-4 mr-1.5" /> Visit
                    </a>
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function ProductCardSkeleton() {
  return (
    <Card className="border-2 border-border overflow-hidden">
      <CardContent className="p-0">
        <div className="flex flex-col md:flex-row">
          <div className="flex items-center justify-center md:w-80 md:h-80 shrink-0 border-b md:border-b-0 md:border-r border-border">
            <Skeleton className="w-full h-full" />
          </div>
          <div className="flex-1 p-5 flex flex-col gap-3">
            <div className="flex justify-between items-start flex-wrap gap-2">
              <Skeleton className="h-6 w-48" />
              <div className="flex gap-2">
                <Skeleton className="h-8 w-28" />
                <Skeleton className="h-8 w-36" />
              </div>
            </div>
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
            <Skeleton className="h-4 w-4/6" />
            <Skeleton className="h-10 w-full mt-auto" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function MediaMavens() {
  const { data: products, isLoading: productsLoading, isError: productsError } = useProductsWithLinks();
  const { data: categories, isLoading: categoriesLoading, isError: categoriesError } = useListMediaMavensCategories();
  const isLoading = productsLoading || categoriesLoading;
  const isError = productsError || categoriesError;
  const sortedCategories = (categories ?? []).slice().sort((a, b) => a.displayOrder - b.displayOrder);

  const hasAnyResolved = (products ?? []).some(
    (p) => p.tapfiliateProgramId != null && !isTemplateLink(p.resolvedAffiliateLink),
  );

  return (
    <AppLayout>
      <div className="space-y-6 max-w-6xl">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <img
              src={mediaMavensLogo}
              alt="Media Mavens"
              className="h-10 w-auto rounded"
            />
            <h1 className="text-3xl font-bold">Media Mavens Products</h1>
          </div>
          <p className="text-muted-foreground">
            Browse the products available to promote through Media Mavens — our own
            in-house, curated affiliate network built specifically for the Build Test
            Scale system. Every product here is hand-picked, comes with higher
            commissions than comparable offers on public marketplaces, and is backed by
            our no-chargeback guarantee. Pick a product, grab your affiliate link, and
            start promoting.
          </p>
        </div>

        {!isLoading && !isError && !hasAnyResolved && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-4">
            <p className="text-sm text-emerald-900">
              <strong>Heads up:</strong> The affiliate link shown on each product card is
              a template. Your unique affiliate ID will be filled in automatically once
              your Media Mavens account is connected — until then, the placeholder{" "}
              <code className="px-1 py-0.5 rounded bg-white border border-emerald-200 text-emerald-900 font-mono text-xs">
                youraffiliateid
              </code>{" "}
              is shown so you can preview the link format.
            </p>
          </div>
        )}

        {isLoading && (
          <div className="space-y-4">
            <ProductCardSkeleton />
            <ProductCardSkeleton />
            <ProductCardSkeleton />
          </div>
        )}

        {isError && (
          <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-6 text-center text-sm text-destructive">
            Failed to load products. Please try refreshing the page.
          </div>
        )}

        {!isLoading && !isError && (
          <div className="space-y-4">
            {sortedCategories.map((category) => {
              const items = (products ?? [])
                .filter((p) => p.category === category.name)
                .slice()
                .sort((a, b) => a.displayOrder - b.displayOrder);
              if (items.length === 0) return null;
              return (
                <CategorySection
                  key={category.id}
                  category={category.name}
                  products={items}
                />
              );
            })}
          </div>
        )}
      </div>
    </AppLayout>
  );
}

function CategorySection({
  category,
  products,
}: {
  category: string;
  products: ProductWithLink[];
}) {
  const [open, setOpen] = useState(false);
  const styles = SECTION_STYLES;
  return (
    <div className="rounded-xl border-2 border-emerald-300 dark:border-emerald-700/60 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`w-full flex items-center justify-between gap-3 px-5 py-4 hover-elevate active-elevate-2 ${styles.bar}`}
        data-testid={`button-category-${category.toLowerCase().replace(/\s+/g, "-")}`}
        aria-expanded={open}
      >
        <h2 className="text-xl font-bold tracking-wide">{category}</h2>
        <div className="flex items-center gap-3">
          <span
            className={`text-xs font-semibold px-2 py-0.5 rounded-full ${styles.badge}`}
          >
            {products.length}
          </span>
          <ChevronDown
            className={`w-5 h-5 transition-transform ${styles.chevron} ${
              open ? "rotate-180" : ""
            }`}
          />
        </div>
      </button>
      {open && (
        <div
          className={`border-t border-emerald-300 dark:border-emerald-700/60 p-4 grid grid-cols-1 gap-5 ${styles.body}`}
        >
          {products.map((p) => (
            <ProductCard key={p.slug} product={p} />
          ))}
        </div>
      )}
    </div>
  );
}
