import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Library } from "lucide-react";
import creativeDriveLogo from "@assets/creative-drive-logo_1778798332569.png";
import pnlTrackerLogo from "@assets/pnl-tracker-logo_1778798334663.jpg";
import dedicatedEmailLogo from "@assets/dedicated-email-template-logo_1778798336760.jpg";

type ResourceItem = {
  slug: string;
  name: string;
  logo: string;
  logoBg: string;
  tagline: string;
  description: string;
  primary: { label: string; href: string };
  secondary?: { label: string; href: string };
};

const RESOURCES: ResourceItem[] = [
  {
    slug: "creative-drive",
    name: "Creative Drive",
    logo: creativeDriveLogo,
    logoBg: "bg-white",
    tagline: "The Ultimate Resource Vault",
    description:
      "Packed with high-converting ad templates, expert-crafted guides, brand logos, copywriting blueprints, and more — your shortcut to affiliate arbitrage mastery. Whether you're refining your ad creatives, dialing in your messaging, or scaling your campaigns, everything you need is just a click away. Don't reinvent the wheel — tap into a treasure trove of proven assets and accelerate your success!",
    primary: {
      label: "Register",
      href: "https://creative.buildtestscale.com/register",
    },
    secondary: {
      label: "Log In",
      href: "https://creative.buildtestscale.com/login",
    },
  },
  {
    slug: "pnl-tracker",
    name: "P&L Tracker™",
    logo: pnlTrackerLogo,
    logoBg: "bg-white",
    tagline: "Know your numbers — if you can't track it, you can't manage it.",
    description:
      "Tracking is the absolute bane of the media buyer. You simply cannot grow your business if you're not able to make calculated decisions based on your numbers. This spreadsheet will help tremendously.",
    primary: {
      label: "Download Spreadsheet",
      href: "https://docs.google.com/spreadsheets/d/1zQ47ozphtdmTqbHaiqy3rA9-pZbaA7mUifptdLCRh20/copy",
    },
  },
  {
    slug: "dedicated-email-template",
    name: "Dedicated Email Template",
    logo: dedicatedEmailLogo,
    logoBg: "bg-white",
    tagline: "Proven dedicated email template — over $60 million sent through it.",
    description:
      "Over 15+ years of buying media, dozens of dedicated email templates have been tested — none compare to this one. Simple, elegant, and proven to convert. Over $60 Million has been sent to this exact template. Use it.",
    primary: {
      label: "Download Template",
      href: "https://experience.buildtestscale.com/wp-content/uploads/2025/04/1-DEDICATED-EMAIL-TEMPLATE.zip",
    },
  },
];

function ResourceCard({ item }: { item: ResourceItem }) {
  return (
    <Card
      className="border-border/60 shadow-sm overflow-hidden"
      data-testid={`card-resource-${item.slug}`}
    >
      <CardContent className="p-0">
        <div className="flex flex-col md:flex-row">
          <div
            className={`${item.logoBg} flex items-center justify-center p-6 md:p-8 md:w-56 shrink-0 border-b md:border-b-0 md:border-r border-border`}
          >
            <img
              src={item.logo}
              alt={`${item.name} logo`}
              className="max-h-24 max-w-full object-contain"
            />
          </div>

          <div className="flex-1 p-5 flex flex-col">
            <div className="mb-2">
              <h2 className="text-xl font-bold text-foreground">{item.name}</h2>
              <p className="text-sm text-muted-foreground mt-1">{item.tagline}</p>
            </div>

            <p className="text-sm text-foreground/90 leading-relaxed mb-4">
              {item.description}
            </p>

            <div className="mt-auto flex flex-wrap gap-2 justify-end">
              <Button asChild size="sm" data-testid={`button-primary-${item.slug}`}>
                <a href={item.primary.href} target="_blank" rel="noopener noreferrer">
                  {item.primary.label}
                </a>
              </Button>
              {item.secondary && (
                <Button
                  asChild
                  size="sm"
                  variant="outline"
                  data-testid={`button-secondary-${item.slug}`}
                >
                  <a href={item.secondary.href} target="_blank" rel="noopener noreferrer">
                    {item.secondary.label}
                  </a>
                </Button>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function ResourceLibrary() {
  return (
    <AppLayout>
      <div className="space-y-6 max-w-6xl">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Library className="w-6 h-6 text-primary" />
            <h1 className="text-3xl font-bold">Resource Library</h1>
          </div>
          <p className="text-muted-foreground">
            Proven templates, spreadsheets, and creative assets to support your campaigns
            — pulled together in one place so you don't have to reinvent the wheel.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-5">
          {RESOURCES.map((item) => (
            <ResourceCard key={item.slug} item={item} />
          ))}
        </div>
      </div>
    </AppLayout>
  );
}
