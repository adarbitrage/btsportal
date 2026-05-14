import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Sparkles, Copy, Check } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import vistaVeilImg from "@assets/vista-veil-404x400_1778783637190.png";
import skinSpectraImg from "@assets/skin-spectra-404x400_1778783632451.png";
import barkchesterImg from "@assets/barkchester-370x400_1778784846297.png";
import robomouseImg from "@assets/robomouse-371x400_1778784848971.png";
import skeeterStrikeImg from "@assets/skeeter-strike-409x400_1778784850895.png";
import heatHavenImg from "@assets/heathaven-387x400_1778784855700.png";
import palmPamperImg from "@assets/palm-pamper-385x400_1778785683234.png";
import grippitImg from "@assets/grippit-387x400_1778785685104.png";
import furbulousImg from "@assets/furbulous-373x400_1778785687103.png";
import reliveImg from "@assets/relive-383x400_1778785689621.png";

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
    tagline: "The Eye Awakening Mask",
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
  {
    slug: "barkchester-united",
    name: "Barkchester United™",
    tagline: "The Smart Soccer Ball for Champion Dogs",
    image: barkchesterImg,
    description:
      "Unleash your dog's inner athlete with Barkchester United™, the revolutionary smart soccer ball that transforms lazy pups into playful champions using breakthrough motion sensors and intelligent play modes. This military-grade, water-resistant ball automatically responds to your dog's movements, creating an interactive play experience that keeps them engaged for hours without any human involvement. With four customizable modes (Champion, Rookie, Training, and Rest), it adapts to any dog's energy level and confidence, from anxious pups to athletic powerhouses up to 100 lbs. Featuring 4-hour battery life, whisper-quiet operation for indoor use, and dental-grade safe materials, Barkchester United™ works on any surface to deliver the mental stimulation and physical exercise dogs crave. Backed by a 30-day money-back guarantee, it's the guilt-free solution that turns couch potatoes into soccer stars.",
    costToConsumer: "$29",
    affiliateCommission: "$50 CPA",
    salesPageUrl:
      "https://barkchester.com/products/watch-barkchester-united-bring-out-your-dogs-inner-champion",
    logoDriveUrl:
      "https://drive.google.com/drive/folders/100Kn5OW4tSMBEfNGC0AHrglzEhwzWtd2?usp=sharing",
    affiliateLink:
      "https://barkchester.com/products/watch-barkchester-united-bring-out-your-dogs-inner-champion?ref=youraffiliateid",
  },
  {
    slug: "robo-mouse",
    name: "RoboMouse™",
    tagline: "The Smart Prey Simulator",
    image: robomouseImg,
    description:
      "Watch your cat transform from couch potato to mighty hunter with RoboMouse™, the intelligent toy that uses IMS (Intelligent Movement System) technology to perfectly mimic real mouse movements and trigger your cat's natural hunting instincts. This USB-rechargeable marvel delivers up to 4 hours of continuous play with smart movement patterns, LED lights, and adjustable speed settings that keep cats of all ages engaged and exercising. Built with impact-resistant materials to withstand enthusiastic attacks, it works on any floor surface from carpet to hardwood. Complete with bonus attachments and backed by a 30-day money-back guarantee, RoboMouse™ is the boredom-busting solution that saves your furniture while providing endless entertainment for your feline friend.",
    costToConsumer: "$29",
    affiliateCommission: "$50 CPA",
    salesPageUrl:
      "https://robomousetoy.com/products/warning-this-smart-toy-may-cause-extreme-cat-happiness/",
    logoDriveUrl:
      "https://drive.google.com/drive/folders/1eAapTVoWlXKRYRCSzhNOAG5haPULkVhs",
    affiliateLink:
      "https://robomousetoy.com/products/warning-this-smart-toy-may-cause-extreme-cat-happiness/?ref=youraffiliateid",
  },
  {
    slug: "skeeter-strike",
    name: "Skeeter Strike™",
    tagline: "Mosquito Zapper Lantern",
    image: skeeterStrikeImg,
    description:
      "Say goodbye to mosquito-invaded evenings with Skeeter Strike™, the powerful 2-in-1 mosquito zapper and lantern that creates an 80-square-meter protective shield around your indoor and outdoor spaces. This portable guardian uses advanced UV light technology to silently eliminate mosquitoes and flying insects while providing ambient lighting for up to 20 hours on a single USB charge. Perfect for patios, camping trips, bedrooms, or any space where you want uninterrupted peace, Skeeter Strike™ features a durable design with an easy-hang carabiner handle and simple twist activation. Backed by a 30-day money-back guarantee, it's the chemical-free solution that lets you reclaim your evenings from buzzing invaders.",
    costToConsumer: "$59",
    affiliateCommission: "$75 CPA",
    salesPageUrl: "https://skeeterstrike.store/products/skeeter-strike",
    logoDriveUrl:
      "https://drive.google.com/drive/folders/1S3pjdrTWhh9aEdoD1Yka0xv_QH3pWhFF",
    affiliateLink:
      "https://skeeterstrike.store/products/skeeter-strike?ref=youraffiliateid",
  },
  {
    slug: "heat-haven",
    name: "Heat Haven™",
    tagline: "Infrared Detox & Recovery Blanket",
    image: heatHavenImg,
    description:
      "Transform your home into a revitalizing sanctuary with the Heat Haven™ UltraLux Far-Infrared Total-Body Detox & Recovery Blanket. Engineered with advanced far-infrared panels that reach up to 176°F and wrapped in ten layers of heat-retaining insulation, this portable spa solution delivers professional-grade detoxification, stress relief, and muscle recovery — all in a 30-minute session. Just drape yourself in the lightweight, foldable design, set your customizable 20–60-minute timer, and let the deep-penetrating warmth boost your metabolism, elevate circulation, and rejuvenate your skin from the inside out. Enjoy the bliss of a spa-quality treatment without ever leaving your living room.",
    costToConsumer: "$199",
    affiliateCommission: "$250 CPA",
    salesPageUrl: "https://heathavensauna.com/products/heat-haven",
    logoDriveUrl:
      "https://drive.google.com/drive/folders/1GWessS6TOOG-lDFb5UvtNt2P_3F3nY07",
    affiliateLink:
      "https://heathavensauna.com/products/heat-haven?ref=youraffiliateid",
  },
  {
    slug: "palm-pamper",
    name: "Palm Pamper™",
    tagline: "The Hand Recovery Station",
    image: palmPamperImg,
    description:
      "Experience instant hand relief in just 15 minutes with Palm Pamper™, the revolutionary 4-in-1 device that combines 3D AirFlex compression, therapeutic heat, pressure point therapy, and circulation boost technology to eliminate pain and restore mobility. This clinically proven massager delivers impressive results within 21 days: 73% improved grip strength and 85% reduction in hand stiffness. Perfect for arthritis, carpal tunnel, or daily hand strain, it fits all hand sizes with customizable programs. Backed by a 60-day money-back guarantee, Palm Pamper™ transforms painful, stiff hands into strong, flexible ones without expensive therapy sessions.",
    costToConsumer: "$79",
    affiliateCommission: "$100 CPA",
    salesPageUrl: "https://palmpamper.com/products/palm-pamper/",
    logoDriveUrl:
      "https://drive.google.com/drive/folders/1qBfFu2xmUxK3Hy3hbX3_AY4GQ3xweHyj",
    affiliateLink:
      "https://palmpamper.com/products/palm-pamper/?ref=youraffiliateid",
  },
  {
    slug: "grippit",
    name: "GrippIt™",
    tagline: "The 5-Minute Power Trainer",
    image: grippitImg,
    description:
      "Transform weak hands into powerful tools with GrippIt™, the revolutionary adjustable grip trainer that delivers professional-grade strength building in just 5 minutes daily. This premium ABS device uses customizable resistance levels and ergonomic design to target finger, hand, and forearm muscles, delivering clinically proven results: 72% increased grip endurance and 35% improved overall grip strength within 21 days. Perfect for athletes, musicians, climbers, or anyone wanting stronger hands, GrippIt™ fits comfortably in your pocket for training anywhere. Backed by a 60-day money-back guarantee, it's the simple solution that turns frustrating grip weakness into confidence-boosting strength without expensive gym equipment.",
    costToConsumer: "$25",
    affiliateCommission: "$50 CPA",
    salesPageUrl: "https://trygrippit.com/products/grippit/",
    logoDriveUrl:
      "https://drive.google.com/drive/folders/1gNijnFcqAPfUOauJ5pRtoI6BTIVfugbP",
    affiliateLink:
      "https://trygrippit.com/products/grippit/?ref=youraffiliateid",
  },
  {
    slug: "furbulous-spa-brush",
    name: "Furbulous™ Spa-Brush",
    tagline: "The Pet Pampering Revolution",
    image: furbulousImg,
    description:
      "Transform grooming battles into bonding bliss with the Furbulous Spa-Brush™, the ingenious 3-in-1 device that uses gentle steam, soothing massage, and smart brushing technology to make your pet actually beg for grooming time. This rechargeable wonder delivers spa-quality warmth that melts away resistance while the therapeutic massage feature triggers natural relaxation responses, turning even the most brush-resistant pets into grooming enthusiasts. With 45–60 minutes of battery life, whisper-quiet operation, and the ability to reduce shedding by up to 95%, it works on all coat types from short-haired cats to fluffy huskies. Backed by a 30-day money-back guarantee and including bonus brush heads, the Furbulous Spa-Brush™ is the grooming game-changer that has pet parents everywhere saying goodbye to wrestling matches and hello to peaceful pampering sessions.",
    costToConsumer: "$29",
    affiliateCommission: "$50 CPA",
    salesPageUrl:
      "https://furbulouspetbrush.com/products/the-spa-brush-that-ends-grooming-battles-forever",
    logoDriveUrl:
      "https://drive.google.com/drive/folders/1NKCX35FTl52eHSoS28qPkd0wt4klWSQ3",
    affiliateLink:
      "https://furbulouspetbrush.com/products/the-spa-brush-that-ends-grooming-battles-forever?ref=youraffiliateid",
  },
  {
    slug: "relive",
    name: "Relivé™",
    tagline: "The Hands-Free Relief Station",
    image: reliveImg,
    description:
      "Experience professional-grade massage therapy anytime with Relivé™, the revolutionary hands-free massager that uses 3D massage technology to eliminate neck and shoulder tension in just 15 minutes. This wearable device features ergonomic massage heads that mimic human hand movements, targeting key trigger points while you work, read, or relax — no appointment needed. The USB-rechargeable design delivers multi-zone relief for shoulders, neck, waist, and arms, providing instant tension release and improved circulation. CE and FCC certified for safety and backed by a 30-day money-back guarantee, Relivé™ is the portable solution that transforms painful, tense muscles into relaxed, flexible ones without expensive spa visits.",
    costToConsumer: "$79",
    affiliateCommission: "$100 CPA",
    salesPageUrl: "https://relivemassager.com/products/relive/",
    logoDriveUrl:
      "https://drive.google.com/drive/folders/1MyvtMPwVRGswFxP_KTr05cq6N7lywAzq",
    affiliateLink:
      "https://relivemassager.com/products/relive/?ref=youraffiliateid",
  },
];

function ProductCard({ product }: { product: Product }) {
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [isTruncated, setIsTruncated] = useState(false);
  const descRef = useRef<HTMLParagraphElement>(null);

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
          <div className="bg-white flex items-center justify-center md:w-80 md:h-80 shrink-0 border-b md:border-b-0 md:border-r border-border overflow-hidden">
            <img
              src={product.image}
              alt={`${product.name} product`}
              className="w-full h-full object-contain block"
            />
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
