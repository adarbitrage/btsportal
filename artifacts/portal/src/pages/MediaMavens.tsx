import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sparkles, Copy, Check } from "lucide-react";
import { useState } from "react";
import vistaVeilImg from "@assets/vista-veil-404x400_1778783637190.png";
import skinSpectraImg from "@assets/skin-spectra-404x400_1778783632451.png";

type Product = {
  slug: string;
  name: string;
  tagline: string;
  image: string;
  description: string;
  costToConsumer: string;
  affiliateCommission: string;
  salesPageUrl: string;
  logoDriveUrl: string;
  affiliateLink: string;
};

const PRODUCTS: Product[] = [
  {
    slug: "vista-veil",
    name: "Vista Veil™",
    tagline: "Trending — The Eye Awakening Mask",
    image: vistaVeilImg,
    description:
      "Banish tired eyes in just 15 minutes with Vista Veil™, the revolutionary 4-in-1 eye rejuvenation mask that delivers instant spa-quality results at home. This clinically proven device combines red light therapy, EMS micro-current, therapeutic warmth, and vibration massage to target every sign of eye fatigue in one powerful treatment. Clinical studies show remarkable results within 21 days: 68% increase in hydration, 24% reduction in dark circles, and 21% fewer fine lines around the delicate eye area. Perfect for all skin types and backed by a 30-day money-back guarantee, Vista Veil™ comes with FREE wireless headphones for the ultimate relaxation experience — it's the 15-minute miracle that makes you look like you got a full night's sleep, even when you don't.",
    costToConsumer: "$79",
    affiliateCommission: "$100 CPA",
    salesPageUrl: "https://tryvistaveil.com/products/vista-veil",
    logoDriveUrl: "https://drive.google.com/drive/folders/1Y-Gk5PKahUXnvyFrgFOVmSDQu73HYY8f",
    affiliateLink: "https://tryvistaveil.com/products/vista-veil?ref=youraffiliateid",
  },
  {
    slug: "skin-spectra",
    name: "Skin Spectra™",
    tagline: "4-in-1 Age Defying Magic",
    image: skinSpectraImg,
    description:
      "Transform your skin in just 3 minutes daily with Skin Spectra™, the revolutionary 4-in-1 anti-aging device that delivers professional spa results at home. This clinically proven wand combines red light therapy, EMS micro-current, vibration, and gentle warmth in one portable device. Clinical studies show remarkable results within 28 days: 62% increase in skin suppleness, 26% brighter skin tone, and up to 17% reduction in crow's feet and fine lines. Perfect for all skin types and backed by a 60-day money-back guarantee, Skin Spectra™ is the risk-free investment that has thousands of women saying goodbye to expensive spa visits and hello to younger-looking, radiant skin.",
    costToConsumer: "$149",
    affiliateCommission: "$200 CPA",
    salesPageUrl: "https://skinspectra.store/products/skinspectra",
    logoDriveUrl: "https://drive.google.com/drive/folders/1VmsFlYIwIG6Tfg0TrCAjbdNnCDBKOHNu",
    affiliateLink: "https://skinspectra.store/products/skinspectra?ref=youraffiliateid",
  },
];

function ProductCard({ product }: { product: Product }) {
  const [copied, setCopied] = useState(false);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(product.affiliateLink);
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
          <div className="bg-white flex items-center justify-center md:w-80 shrink-0 border-b md:border-b-0 md:border-r border-border overflow-hidden">
            <img
              src={product.image}
              alt={`${product.name} product`}
              className="w-full h-auto object-contain block"
            />
          </div>

          <div className="flex-1 p-5 flex flex-col">
            <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h2 className="text-xl font-bold text-foreground">{product.name}</h2>
              <p className="text-sm text-muted-foreground">{product.tagline}</p>
            </div>

            <p className="text-sm text-foreground/90 leading-relaxed mb-4">
              {product.description}
            </p>

            <div className="flex flex-wrap gap-2 mb-4">
              <Button asChild size="sm" data-testid={`button-sales-${product.slug}`}>
                <a href={product.salesPageUrl} target="_blank" rel="noreferrer">
                  View Sales Page
                </a>
              </Button>
              <Button
                asChild
                size="sm"
                variant="outline"
                data-testid={`button-logo-${product.slug}`}
              >
                <a href={product.logoDriveUrl} target="_blank" rel="noreferrer">
                  Download Official Logo
                </a>
              </Button>
            </div>

            <div className="rounded-lg border border-border bg-muted/40 p-4 mt-auto">
              <div className="flex items-center gap-2 mb-3">
                <Badge className="bg-primary text-primary-foreground hover:bg-primary text-[10px] font-bold tracking-wide uppercase">
                  Offer Card
                </Badge>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
                <div>
                  <p className="text-[11px] uppercase tracking-wide font-semibold text-muted-foreground">
                    Cost to Consumer
                  </p>
                  <p className="text-base font-bold text-foreground">
                    {product.costToConsumer}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] uppercase tracking-wide font-semibold text-emerald-700">
                    Affiliate Commission
                  </p>
                  <p className="text-base font-bold text-emerald-700">
                    {product.affiliateCommission}
                  </p>
                </div>
              </div>
              <p className="text-xs font-semibold text-foreground mb-1.5">
                Grab your affiliate link below:
              </p>
              <div className="flex items-stretch gap-2">
                <code className="flex-1 min-w-0 text-xs bg-background border border-dashed border-border rounded px-2.5 py-2 font-mono text-foreground/90 truncate">
                  {product.affiliateLink}
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
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function MediaMavens() {
  return (
    <AppLayout>
      <div className="space-y-6 max-w-6xl">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Sparkles className="w-6 h-6 text-primary" />
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

        <div className="grid grid-cols-1 gap-5">
          {PRODUCTS.map((p) => (
            <ProductCard key={p.slug} product={p} />
          ))}
        </div>
      </div>
    </AppLayout>
  );
}
