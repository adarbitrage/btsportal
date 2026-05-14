import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Sparkles, Wrench, Globe, Radar, FolderOpen,
  Calculator, Mail, ChevronDown, ChevronRight
} from "lucide-react";
import { useState } from "react";

type SectionId = "apps" | "networks" | "traffic" | "creative-drive" | "pnl" | "email-template";

type Tint = { bg: string; border: string; text: string };

interface NavItem {
  id: SectionId;
  label: string;
  icon: typeof Wrench;
  tint: Tint;
  note?: string;
}

const navItems: NavItem[] = [
  { id: "apps", label: "Paid Media Suite™", icon: Wrench, tint: { bg: "bg-blue-50", border: "border-blue-200", text: "text-blue-700" }, note: "Not sold anywhere — exclusive to BTS members" },
  { id: "networks", label: "Affiliate Networks", icon: Globe, tint: { bg: "bg-emerald-50", border: "border-emerald-200", text: "text-emerald-700" } },
  { id: "traffic", label: "Traffic Sources", icon: Radar, tint: { bg: "bg-violet-50", border: "border-violet-200", text: "text-violet-700" } },
  { id: "creative-drive", label: "Creative Drive", icon: FolderOpen, tint: { bg: "bg-cyan-50", border: "border-cyan-200", text: "text-cyan-700" } },
  { id: "pnl", label: "P&L Tracker™", icon: Calculator, tint: { bg: "bg-orange-50", border: "border-orange-200", text: "text-orange-700" } },
  { id: "email-template", label: "Email Template", icon: Mail, tint: { bg: "bg-pink-50", border: "border-pink-200", text: "text-pink-700" } },
];

const tintFor = (id: SectionId) => navItems.find((n) => n.id === id)!.tint;

function SectionHeader({ id, title, note }: { id: SectionId; title: string; note?: string }) {
  const item = navItems.find((n) => n.id === id)!;
  const Icon = item.icon;
  return (
    <div className="flex items-center gap-3">
      <div className={`w-10 h-10 rounded-lg ${item.tint.bg} border ${item.tint.border} flex items-center justify-center`}>
        <Icon className={`w-5 h-5 ${item.tint.text}`} />
      </div>
      <div>
        <h2 className="text-xl font-bold text-foreground">{title}</h2>
        {note && <p className="text-xs text-muted-foreground italic">{note}</p>}
      </div>
    </div>
  );
}

interface ToolInfo {
  name: string;
  tagline: string;
  description: string;
  features?: string[];
  vidalyticsId?: string;
  launchLabel?: string;
  trainingLabel?: string;
  chromeUrl?: string;
  logoSrc?: string;
}

const paidMediaTools: ToolInfo[] = [
  {
    name: "Flexy™",
    tagline: "Drag & Drop Landing Pages",
    description: "Build a website in under an hour! Your days of slogging through code, or waiting weeks for your web designer to make a simple tweak... are over. FLEXY will have your website built in record time, with the latest in point and click technology!",
    features: [
      "NO CODE! Use your mouse to modify your design and create the pages you always wanted.",
      "Over 80 beautifully designed website templates ready to choose from.",
      "Modify your global colors, fonts and many other settings with just a few clicks.",
      "Scales perfectly on mobile devices — your page will automatically scale on phones and tablets.",
    ],
    vidalyticsId: "mxMJcb1ABTOgkKiW",
    launchLabel: "Launch Flexy™",
    trainingLabel: "Watch Flexy™ Training",
  },
  {
    name: "DIYTrax™",
    tagline: "URL & Lander Rotator",
    description: "A URL rotator/tracker developed for advanced campaign management. Other tracking apps on the market just didn't function as needed for high-volume buying processes, so DIYTrax™ was born. It's stable, reliable, and gets the job done.",
    features: [
      "Create multiple campaign types: Direct Link, Landing Page, Multi-Path, or Multi-Option.",
      "Track, test, and optimize campaigns across multiple traffic sources with on-the-fly control.",
      "In-depth data for all campaigns including ads, keywords, pages, and offers with detailed revenue data.",
      "Add or edit pages and offers in rotation with no coding — adjust rotation on the fly, in real-time.",
    ],
    vidalyticsId: "EqqoE4li5xO0wrjq",
    launchLabel: "Launch DIYTrax™",
    trainingLabel: "Watch DIYTrax™ Training",
  },
  {
    name: "MetricMover™",
    tagline: "Lander Split Tester",
    description: "This landing page split tester has literally doubled profit since development. It takes over the painfully manual process of split testing elements on landing pages — testing dozens of elements like Headlines, Hero Shots, and Call to Actions becomes a breeze.",
    features: [
      "Create literally THOUSANDS of split tests in minutes.",
      "Test one page element at a time, OR large chunks of HTML.",
      "Test headlines, sub-headlines, hero shots, lead paragraphs, layouts, CTAs — if it's HTML, it can be tested.",
      "Seamlessly upload all split tests into DIYTrax™ and rotate through each variation to find the winners.",
    ],
    vidalyticsId: "9FQkRbOSSrI3JMML",
    launchLabel: "Launch MetricMover™",
    trainingLabel: "Watch MetricMover™ Training",
  },
  {
    name: "Gifster™",
    tagline: "Ad Images, Automated",
    description: "Animated GIFs are crucial in attaining an ad CTR worthy of scale — but they're a pain to create. With Gifster™, you can create hundreds of animations for your ads and landing pages in a fraction of the time.",
    features: [
      "Search YouTube for videos on any topic to make animated GIFs from.",
      "Set the length of your desired GIFs: 1–5 seconds.",
      "Set dimensions matching all PixelPress™ full banner sizes.",
      "Download all animated GIFs for easy uploading into PixelPress™.",
    ],
    vidalyticsId: "ucrw84JSj_OoMMQE",
    launchLabel: "Launch Gifster™",
    trainingLabel: "Watch Gifster™ Training",
  },
  {
    name: "PixelPress™",
    tagline: "Bulk Banner Creator",
    description: "Bulk create and split test banner ads of all sizes. Since winning at the traffic game comes down to testing, this tool quickly tests headlines, body text, calls to action, and images on banners.",
    features: [
      "Create literally THOUSANDS of banner variations in minutes.",
      "Split test new layouts, headlines, images, CTAs, and more.",
      "Optimize images for your necessary file sizes.",
      "Output to single or multiple zip files based on file size.",
      "Choose from a variety of template layouts to get started.",
    ],
    vidalyticsId: "vA7IOa_12U66yEFl",
    launchLabel: "Launch PixelPress™",
    trainingLabel: "Watch PixelPress™ Training",
  },
];

function ToolCard({ tool }: { tool: ToolInfo }) {
  const [expanded, setExpanded] = useState(false);
  const tint = tintFor("apps");

  return (
    <Card className="border-border/60 shadow-sm overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-4 p-5 text-left hover:bg-muted/40 transition-colors"
      >
        {tool.logoSrc ? (
          <div className="w-10 h-10 rounded-lg border border-border/60 bg-background overflow-hidden flex items-center justify-center shrink-0">
            <img src={tool.logoSrc} alt={`${tool.name} logo`} className="w-full h-full object-cover" />
          </div>
        ) : (
          <div className={`w-10 h-10 rounded-lg ${tint.bg} border ${tint.border} flex items-center justify-center shrink-0`}>
            <Wrench className={`w-5 h-5 ${tint.text}`} />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <h3 className="font-bold text-foreground">{tool.name}</h3>
          <p className="text-sm text-muted-foreground">{tool.tagline}</p>
        </div>
        {expanded ? (
          <ChevronDown className="w-5 h-5 text-muted-foreground shrink-0" />
        ) : (
          <ChevronRight className="w-5 h-5 text-muted-foreground shrink-0" />
        )}
      </button>
      {expanded && (
        <div className="border-t border-border/60 p-5 space-y-4 bg-muted/40">
          {tool.vidalyticsId && (
            <div className="rounded-lg overflow-hidden bg-black aspect-video">
              <iframe
                src={`https://fast.vidalytics.com/embeds/trR5xdVa/${tool.vidalyticsId}/`}
                className="w-full h-full border-0"
                allow="autoplay; fullscreen"
                allowFullScreen
              />
            </div>
          )}
          <p className="text-sm text-muted-foreground leading-relaxed">{tool.description}</p>
          {tool.features && (
            <ul className="space-y-1.5">
              {tool.features.map((f, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                  <span className="text-emerald-700 mt-0.5 shrink-0">&#10003;</span>
                  {f}
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap gap-2 pt-2">
            {tool.launchLabel && (
              <Button size="sm">{tool.launchLabel}</Button>
            )}
            {tool.chromeUrl && (
              <Button asChild size="sm">
                <a href={tool.chromeUrl} target="_blank" rel="noopener noreferrer">
                  Download Extension
                </a>
              </Button>
            )}
            {tool.trainingLabel && (
              <Button size="sm" variant="outline">{tool.trainingLabel}</Button>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}

export default function Advantage() {
  return (
    <AppLayout>
      <div className="space-y-6 max-w-6xl">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Sparkles className="w-6 h-6 text-primary" />
            <h1 className="text-3xl font-bold">The BTS Advantage</h1>
          </div>
          <p className="text-muted-foreground">
            Proprietary apps, resources, and templates for managing your affiliate campaigns. Over $3,000,000 in tools developed exclusively for high-performance affiliate work — built for our team, and now for you.
          </p>
        </div>

        <Card className="border-border/60 shadow-sm">
          <CardContent className="p-5">
            <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Jump To</h2>
            <div className="flex flex-wrap gap-2">
              {navItems.map((item) => (
                <a
                  key={item.id}
                  href={`#${item.id}`}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-background border border-border/60 rounded-lg text-xs font-medium text-foreground hover:border-foreground/30 hover:bg-muted/40 transition-colors"
                >
                  <item.icon className={`w-3.5 h-3.5 ${item.tint.text}`} />
                  {item.label}
                </a>
              ))}
            </div>
          </CardContent>
        </Card>

        <section id="apps" className="space-y-4 scroll-mt-6">
          <SectionHeader id="apps" title="Paid Media Suite™" note="Not sold anywhere — exclusive to BTS members" />
          {paidMediaTools.map((tool) => (
            <ToolCard key={tool.name} tool={tool} />
          ))}
        </section>

        <section id="networks" className="space-y-4 scroll-mt-6">
          <SectionHeader id="networks" title="Affiliate Networks" />

          <Card className="border-border/60 shadow-sm">
            <CardContent className="p-6 space-y-4">
              <h3 className="font-bold text-foreground text-lg">Media Mavens</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Media Mavens is our in-house affiliate network where BTS members earn 100%+ commissions on a pure CPA model — meaning you get at least the full retail price (and often more) on every sale — so you never have to worry about refunds or chargebacks. Payouts happen five days a week via Tipalti for fast, reliable cash flow. You'll gain exclusive access to high-margin e-commerce offers you won't find anywhere else.
              </p>
              <Button size="sm">Learn About Media Mavens</Button>
            </CardContent>
          </Card>

          <Card className="border-border/60 shadow-sm">
            <CardContent className="p-6 space-y-4">
              <h3 className="font-bold text-foreground text-lg">Clickbank</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                The world's leading affiliate marketplace! Over 100,000 affiliates worldwide choose ClickBank. Over $6.6 billion in commissions paid on time for more than 25 years. Sign up for a free account to access quality products, reliable tracking, and high commissions.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button asChild size="sm">
                  <a href="https://www.clickbank.com/affiliates/" target="_blank" rel="noopener noreferrer">Register</a>
                </Button>
                <Button asChild size="sm" variant="outline">
                  <a href="https://accounts.clickbank.com/login.htm" target="_blank" rel="noopener noreferrer">Log In</a>
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card className="border-border/60 shadow-sm">
            <CardContent className="p-6 space-y-4">
              <h3 className="font-bold text-foreground text-lg">MaxWeb</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                A performance-based CPA affiliate network that provides access to professionally built offers used across major paid traffic platforms. Sign up for reliable tracking, structured reporting, consistent payouts, and access to affiliate support.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button asChild size="sm">
                  <a href="https://affiliates-backoffice.maxweb.com/auth#signup" target="_blank" rel="noopener noreferrer">Sign Up</a>
                </Button>
                <Button asChild size="sm" variant="outline">
                  <a href="https://affiliates-backoffice.maxweb.com/auth" target="_blank" rel="noopener noreferrer">Log In</a>
                </Button>
              </div>
            </CardContent>
          </Card>
        </section>

        <section id="traffic" className="space-y-4 scroll-mt-6">
          <SectionHeader id="traffic" title="Traffic Sources" />

          <Card className="border-border/60 shadow-sm">
            <CardContent className="p-6 space-y-4">
              <h3 className="font-bold text-foreground text-lg">The Responsive Rolodex™</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Your fast track to running successful Direct Media Buying campaigns. This exclusive resource gives you access to pre-approved, high-performing publisher placements that have been thoroughly tested and optimized for results. No need to negotiate deals or vet publishers yourself — each placement has been handpicked to deliver proven traffic, ensuring you get started with confidence.
              </p>
              <p className="text-sm text-muted-foreground leading-relaxed">
                With step-by-step setup instructions and the ability to launch campaigns quickly, the Responsive Rolodex eliminates guesswork and reduces risk. Whether you're new to Direct Buys or scaling your efforts, this tool leverages years of expertise to connect you with winning placements from day one.
              </p>
              <Button size="sm">Access the Rolodex</Button>
            </CardContent>
          </Card>
        </section>

        <section id="creative-drive" className="space-y-4 scroll-mt-6">
          <SectionHeader id="creative-drive" title="Creative Drive" />

          <Card className="border-border/60 shadow-sm">
            <CardContent className="p-6 space-y-4">
              <h3 className="font-bold text-foreground text-lg">The Ultimate Resource Vault</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Packed with high-converting ad templates, expert-crafted guides, brand logos, copywriting blueprints, and more — your shortcut to affiliate arbitrage mastery. Whether you're refining your ad creatives, dialing in your messaging, or scaling your campaigns, everything you need is just a click away. Don't reinvent the wheel — tap into a treasure trove of proven assets and accelerate your success!
              </p>
              <div className="flex flex-wrap gap-2">
                <Button asChild size="sm">
                  <a href="https://creative.buildtestscale.com/register" target="_blank" rel="noopener noreferrer">Register</a>
                </Button>
                <Button asChild size="sm" variant="outline">
                  <a href="https://creative.buildtestscale.com/login" target="_blank" rel="noopener noreferrer">Log In</a>
                </Button>
              </div>
            </CardContent>
          </Card>
        </section>

        <section id="pnl" className="space-y-4 scroll-mt-6">
          <SectionHeader id="pnl" title="P&L Tracker™" />

          <Card className="border-border/60 shadow-sm">
            <CardContent className="p-6 space-y-4">
              <h3 className="font-bold text-foreground text-lg">Know Your Numbers</h3>
              <p className="text-sm text-muted-foreground leading-relaxed italic">
                If you can't track it, you can't manage it.
              </p>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Tracking is the absolute bane of the media buyer. You simply cannot grow your business if you're not able to make calculated decisions based on your numbers. This spreadsheet will help tremendously.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button asChild size="sm">
                  <a href="https://docs.google.com/spreadsheets/d/1zQ47ozphtdmTqbHaiqy3rA9-pZbaA7mUifptdLCRh20/copy" target="_blank" rel="noopener noreferrer">
                    Download Spreadsheet
                  </a>
                </Button>
                <Button size="sm" variant="outline">Watch Training</Button>
              </div>
            </CardContent>
          </Card>
        </section>

        <section id="email-template" className="space-y-4 scroll-mt-6">
          <SectionHeader id="email-template" title="Dedicated Email Template" />

          <Card className="border-border/60 shadow-sm">
            <CardContent className="p-6 space-y-4">
              <h3 className="font-bold text-foreground text-lg">Proven Dedicated Email Template</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Over 15+ years of buying media, dozens of dedicated email templates have been tested — none compare to this one. Simple, elegant, and proven to convert. Over $60 Million has been sent to this exact template. Use it.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button asChild size="sm">
                  <a href="https://experience.buildtestscale.com/wp-content/uploads/2025/04/1-DEDICATED-EMAIL-TEMPLATE.zip" target="_blank" rel="noopener noreferrer">
                    Download Template
                  </a>
                </Button>
                <Button size="sm" variant="outline">Watch Training</Button>
              </div>
            </CardContent>
          </Card>
        </section>

      </div>
    </AppLayout>
  );
}
