import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Wrench, Globe, Radar, Bot, PenTool, FolderOpen,
  Calculator, Mail, Search, ExternalLink, Download,
  PlayCircle, ChevronDown, ChevronRight
} from "lucide-react";
import { useState } from "react";

type SectionId = "apps" | "networks" | "traffic" | "ai-advertorial" | "ai-adcopy" | "creative-drive" | "pnl" | "email-template" | "spy";

interface NavItem {
  id: SectionId;
  label: string;
  icon: typeof Wrench;
  color: string;
}

const navItems: NavItem[] = [
  { id: "apps", label: "Paid Media Suite™", icon: Wrench, color: "bg-blue-600" },
  { id: "networks", label: "Affiliate Networks", icon: Globe, color: "bg-emerald-600" },
  { id: "traffic", label: "Traffic Sources", icon: Radar, color: "bg-violet-600" },
  { id: "ai-advertorial", label: "AI Advertorial Builder", icon: Bot, color: "bg-rose-600" },
  { id: "ai-adcopy", label: "AI Ad Copy Generator", icon: PenTool, color: "bg-amber-600" },
  { id: "creative-drive", label: "Creative Drive", icon: FolderOpen, color: "bg-cyan-600" },
  { id: "pnl", label: "P&L Tracker™", icon: Calculator, color: "bg-orange-600" },
  { id: "email-template", label: "Email Template", icon: Mail, color: "bg-pink-600" },
  { id: "spy", label: "Spy Tool (Anstrex)", icon: Search, color: "bg-indigo-600" },
];

interface ToolInfo {
  name: string;
  tagline: string;
  description: string;
  features?: string[];
  vidalyticsId?: string;
  launchLabel?: string;
  launchNote?: string;
  trainingLabel?: string;
  trainingNote?: string;
  downloadUrl?: string;
  chromeUrl?: string;
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
    name: "ScrapeBot™",
    tagline: "Google/Bing Image Scraper",
    description: "A Chrome Extension to help scrape Google, Bing & Duck Duck Go Images. Used daily to locate and download all images used in banner ads and advertorial pages. No Photoshop required when you use ScrapeBot™, CropBot™, and PixelPress™ together.",
    vidalyticsId: "wnf8YlB9rxQ3XCUm",
    chromeUrl: "https://chromewebstore.google.com/detail/scrapebot-207/beongpingjcjghpgfcngccpkpmhgldjm",
    trainingLabel: "Watch ScrapeBot™ Training",
  },
  {
    name: "CropBot™",
    tagline: "Image Cropper & Resizer",
    description: "A Chrome Extension to crop and resize images gathered with ScrapeBot™. In most cases, images downloaded from Google won't have ideal dimensions and need resizing. ScrapeBot™, CropBot™, and PixelPress™ make banner creation a breeze.",
    vidalyticsId: "zIbcTMBKHnyz_UOo",
    chromeUrl: "https://chrome.google.com/webstore/detail/cropbot-201/kkabdjjmpkogggbjoenafjejhkalkjdd",
    trainingLabel: "Watch CropBot™ Training",
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

  return (
    <Card className="border-border/60 shadow-sm overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-4 p-5 text-left hover:bg-muted/30 transition-colors"
      >
        <div className="w-10 h-10 rounded-lg bg-[#1a56db]/10 flex items-center justify-center shrink-0">
          <Wrench className="w-5 h-5 text-[#1a56db]" />
        </div>
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
        <div className="border-t border-border/60 p-5 space-y-4 bg-[#faf9f7]">
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
                  <span className="text-[#2d8a4e] mt-0.5 shrink-0">&#10003;</span>
                  {f}
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap gap-2 pt-2">
            {tool.launchLabel && (
              <Button size="sm" className="bg-[#2d8a4e] hover:bg-[#246e3e] text-white gap-1.5">
                <ExternalLink className="w-3.5 h-3.5" />
                {tool.launchLabel}
              </Button>
            )}
            {tool.chromeUrl && (
              <a href={tool.chromeUrl} target="_blank" rel="noopener noreferrer">
                <Button size="sm" variant="outline" className="gap-1.5">
                  <Download className="w-3.5 h-3.5" />
                  Download Extension
                </Button>
              </a>
            )}
            {tool.trainingLabel && (
              <Button size="sm" variant="outline" className="gap-1.5 text-[#1a56db]">
                <PlayCircle className="w-3.5 h-3.5" />
                {tool.trainingLabel}
              </Button>
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
      <div className="max-w-4xl mx-auto space-y-8">

        <div className="bg-gradient-to-br from-gray-900 to-gray-800 rounded-2xl p-8 md:p-10 text-white shadow-lg">
          <h1 className="text-3xl md:text-4xl font-bold font-['Roboto'] tracking-tight mb-2">
            The BTS Advantage
          </h1>
          <p className="text-lg text-white/80 mb-4">
            Proprietary Apps, Resources & Templates For Managing Your Affiliate Campaigns
          </p>
          <p className="text-sm text-white/60 leading-relaxed">
            Welcome to over $3,000,000 in proprietary tools developed exclusively for high-performance affiliate campaigns. You won't find them anywhere in the marketplace. They were built for our team, and now for you. If you utilize each of these resources, no one will be able to compete with you.
          </p>
        </div>

        <Card className="border-border/60 shadow-sm">
          <CardContent className="p-5">
            <h2 className="font-bold text-foreground mb-3 text-sm uppercase tracking-wider text-muted-foreground">Jump To:</h2>
            <div className="flex flex-wrap gap-2">
              {navItems.map((item) => (
                <a
                  key={item.id}
                  href={`#${item.id}`}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-[#faf9f7] border border-[#e8e4dc] rounded-lg text-xs font-medium text-foreground hover:border-[#1a56db]/40 transition-colors"
                >
                  <item.icon className="w-3.5 h-3.5 text-[#1a56db]" />
                  {item.label}
                </a>
              ))}
            </div>
          </CardContent>
        </Card>

        <section id="apps" className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center">
              <Wrench className="w-4 h-4 text-white" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-foreground">Paid Media Suite™</h2>
              <p className="text-xs text-muted-foreground italic">Not sold anywhere — exclusive to BTS members</p>
            </div>
          </div>
          {paidMediaTools.map((tool) => (
            <ToolCard key={tool.name} tool={tool} />
          ))}
        </section>

        <section id="networks" className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-emerald-600 flex items-center justify-center">
              <Globe className="w-4 h-4 text-white" />
            </div>
            <h2 className="text-xl font-bold text-foreground">Affiliate Networks</h2>
          </div>

          <Card className="border-border/60 shadow-sm">
            <CardContent className="p-6 space-y-4">
              <h3 className="font-bold text-foreground text-lg">Media Mavens</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Media Mavens is our in-house affiliate network where BTS members earn 100%+ commissions on a pure CPA model — meaning you get at least the full retail price (and often more) on every sale — so you never have to worry about refunds or chargebacks. Payouts happen five days a week via Tipalti for fast, reliable cash flow. You'll gain exclusive access to high-margin e-commerce offers you won't find anywhere else.
              </p>
              <Button size="sm" variant="outline" className="gap-1.5 text-[#1a56db]">
                <ExternalLink className="w-3.5 h-3.5" />
                Learn About Media Mavens
              </Button>
            </CardContent>
          </Card>

          <Card className="border-border/60 shadow-sm">
            <CardContent className="p-6 space-y-4">
              <h3 className="font-bold text-foreground text-lg">Clickbank</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                The world's leading affiliate marketplace! Over 100,000 affiliates worldwide choose ClickBank. Over $6.6 billion in commissions paid on time for more than 25 years. Sign up for a free account to access quality products, reliable tracking, and high commissions.
              </p>
              <div className="flex flex-wrap gap-2">
                <a href="https://www.clickbank.com/affiliates/" target="_blank" rel="noopener noreferrer">
                  <Button size="sm" className="bg-[#2d8a4e] hover:bg-[#246e3e] text-white gap-1.5">Register</Button>
                </a>
                <a href="https://accounts.clickbank.com/login.htm" target="_blank" rel="noopener noreferrer">
                  <Button size="sm" variant="outline" className="gap-1.5">Log In</Button>
                </a>
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
                <a href="https://affiliates-backoffice.maxweb.com/auth#signup" target="_blank" rel="noopener noreferrer">
                  <Button size="sm" className="bg-[#2d8a4e] hover:bg-[#246e3e] text-white gap-1.5">Sign Up</Button>
                </a>
                <a href="https://affiliates-backoffice.maxweb.com/auth" target="_blank" rel="noopener noreferrer">
                  <Button size="sm" variant="outline" className="gap-1.5">Log In</Button>
                </a>
              </div>
            </CardContent>
          </Card>
        </section>

        <section id="traffic" className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-violet-600 flex items-center justify-center">
              <Radar className="w-4 h-4 text-white" />
            </div>
            <h2 className="text-xl font-bold text-foreground">Traffic Sources</h2>
          </div>

          <Card className="border-border/60 shadow-sm">
            <CardContent className="p-6 space-y-4">
              <h3 className="font-bold text-foreground text-lg">The Responsive Rolodex™</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Your fast track to running successful Direct Media Buying campaigns. This exclusive resource gives you access to pre-approved, high-performing publisher placements that have been thoroughly tested and optimized for results. No need to negotiate deals or vet publishers yourself — each placement has been handpicked to deliver proven traffic, ensuring you get started with confidence.
              </p>
              <p className="text-sm text-muted-foreground leading-relaxed">
                With step-by-step setup instructions and the ability to launch campaigns quickly, the Responsive Rolodex eliminates guesswork and reduces risk. Whether you're new to Direct Buys or scaling your efforts, this tool leverages years of expertise to connect you with winning placements from day one.
              </p>
              <Button size="sm" className="bg-[#2d8a4e] hover:bg-[#246e3e] text-white gap-1.5">
                <ExternalLink className="w-3.5 h-3.5" />
                Access the Rolodex
              </Button>
            </CardContent>
          </Card>
        </section>

        <section id="ai-advertorial" className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-rose-600 flex items-center justify-center">
              <Bot className="w-4 h-4 text-white" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-foreground">AI Advertorial Builder</h2>
              <p className="text-xs text-muted-foreground italic">100% Free for BTS Members</p>
            </div>
          </div>

          <Card className="border-border/60 shadow-sm">
            <CardContent className="p-6 space-y-4">
              <h3 className="font-bold text-foreground text-lg">Affiliate CMO</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                AI-Powered Advertorials That Actually Make Sales. Get high-converting copy that connects with your ideal customer's deepest emotions — without spending weeks on research or testing hundreds of failed variations.
              </p>
              <div className="bg-[#faf9f7] border border-[#e8e4dc] rounded-xl p-5">
                <h4 className="font-semibold text-foreground text-sm mb-2">6 Ways Affiliate CMO Transforms Your Marketing:</h4>
                <ul className="space-y-1.5 text-sm text-muted-foreground">
                  <li className="flex items-start gap-2"><span className="text-[#2d8a4e]">&#10003;</span> Deep Avatar Research</li>
                  <li className="flex items-start gap-2"><span className="text-[#2d8a4e]">&#10003;</span> Advertorial Generator</li>
                  <li className="flex items-start gap-2"><span className="text-[#2d8a4e]">&#10003;</span> Headline Laboratory</li>
                  <li className="flex items-start gap-2"><span className="text-[#2d8a4e]">&#10003;</span> Banner Ad Factory</li>
                  <li className="flex items-start gap-2"><span className="text-[#2d8a4e]">&#10003;</span> Psychology Brief Builder</li>
                  <li className="flex items-start gap-2"><span className="text-[#2d8a4e]">&#10003;</span> Custom Copy Control</li>
                </ul>
              </div>
              <p className="text-sm text-muted-foreground font-medium">
                Use coupon code: <span className="font-mono bg-muted px-2 py-0.5 rounded text-foreground">LIFETIME100</span> to get FREE access for life!
              </p>
              <div className="flex flex-wrap gap-2">
                <a href="https://app.affiliatecmo.com/login" target="_blank" rel="noopener noreferrer">
                  <Button size="sm" className="bg-[#2d8a4e] hover:bg-[#246e3e] text-white gap-1.5">Register / Log In</Button>
                </a>
                <Button size="sm" variant="outline" className="gap-1.5 text-[#1a56db]">
                  <PlayCircle className="w-3.5 h-3.5" />
                  Watch Training
                </Button>
              </div>
            </CardContent>
          </Card>
        </section>

        <section id="ai-adcopy" className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-amber-600 flex items-center justify-center">
              <PenTool className="w-4 h-4 text-white" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-foreground">AI Ad Copy Generator</h2>
              <p className="text-xs text-muted-foreground italic">100% Free for BTS Members</p>
            </div>
          </div>

          <Card className="border-border/60 shadow-sm">
            <CardContent className="p-6 space-y-4">
              <h3 className="font-bold text-foreground text-lg">Free Ad Copy™</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                The only 100% FREE AI copy-generator that will outperform even your best ads. Powered by GPT-4 combined with 25+ years of copywriting experience and over $1.2 billion in sales — the world's most powerful AI copy-generator.
              </p>
              <p className="text-sm text-muted-foreground font-medium">
                Register below to get 1,000 credits instantly applied — completely FREE for all BTS members!
              </p>
              <div className="flex flex-wrap gap-2">
                <a href="https://www.freeadcopy.com/signup?bonusCode=0VLP2B3X" target="_blank" rel="noopener noreferrer">
                  <Button size="sm" className="bg-[#2d8a4e] hover:bg-[#246e3e] text-white gap-1.5">Register</Button>
                </a>
                <a href="https://www.freeadcopy.com/?loginpopup=true#" target="_blank" rel="noopener noreferrer">
                  <Button size="sm" variant="outline" className="gap-1.5">Log In</Button>
                </a>
              </div>
            </CardContent>
          </Card>
        </section>

        <section id="creative-drive" className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-cyan-600 flex items-center justify-center">
              <FolderOpen className="w-4 h-4 text-white" />
            </div>
            <h2 className="text-xl font-bold text-foreground">Creative Drive</h2>
          </div>

          <Card className="border-border/60 shadow-sm">
            <CardContent className="p-6 space-y-4">
              <h3 className="font-bold text-foreground text-lg">The Ultimate Resource Vault</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Packed with high-converting ad templates, expert-crafted guides, brand logos, copywriting blueprints, and more — your shortcut to affiliate arbitrage mastery. Whether you're refining your ad creatives, dialing in your messaging, or scaling your campaigns, everything you need is just a click away. Don't reinvent the wheel — tap into a treasure trove of proven assets and accelerate your success!
              </p>
              <div className="flex flex-wrap gap-2">
                <a href="https://creative.cherringtonmedia.com/register" target="_blank" rel="noopener noreferrer">
                  <Button size="sm" className="bg-[#2d8a4e] hover:bg-[#246e3e] text-white gap-1.5">Register</Button>
                </a>
                <a href="https://creative.cherringtonmedia.com/login" target="_blank" rel="noopener noreferrer">
                  <Button size="sm" variant="outline" className="gap-1.5">Log In</Button>
                </a>
              </div>
            </CardContent>
          </Card>
        </section>

        <section id="pnl" className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-orange-600 flex items-center justify-center">
              <Calculator className="w-4 h-4 text-white" />
            </div>
            <h2 className="text-xl font-bold text-foreground">P&L Tracker™</h2>
          </div>

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
                <a href="https://docs.google.com/spreadsheets/d/1zQ47ozphtdmTqbHaiqy3rA9-pZbaA7mUifptdLCRh20/copy" target="_blank" rel="noopener noreferrer">
                  <Button size="sm" className="bg-[#2d8a4e] hover:bg-[#246e3e] text-white gap-1.5">
                    <Download className="w-3.5 h-3.5" />
                    Download Spreadsheet
                  </Button>
                </a>
                <Button size="sm" variant="outline" className="gap-1.5 text-[#1a56db]">
                  <PlayCircle className="w-3.5 h-3.5" />
                  Watch Training
                </Button>
              </div>
            </CardContent>
          </Card>
        </section>

        <section id="email-template" className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-pink-600 flex items-center justify-center">
              <Mail className="w-4 h-4 text-white" />
            </div>
            <h2 className="text-xl font-bold text-foreground">Dedicated Email Template</h2>
          </div>

          <Card className="border-border/60 shadow-sm">
            <CardContent className="p-6 space-y-4">
              <h3 className="font-bold text-foreground text-lg">Proven Dedicated Email Template</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Over 15+ years of buying media, dozens of dedicated email templates have been tested — none compare to this one. Simple, elegant, and proven to convert. Over $60 Million has been sent to this exact template. Use it.
              </p>
              <div className="flex flex-wrap gap-2">
                <a href="https://experience.cherringtonmedia.com/wp-content/uploads/2025/04/1-DEDICATED-EMAIL-TEMPLATE.zip" target="_blank" rel="noopener noreferrer">
                  <Button size="sm" className="bg-[#2d8a4e] hover:bg-[#246e3e] text-white gap-1.5">
                    <Download className="w-3.5 h-3.5" />
                    Download Template
                  </Button>
                </a>
                <Button size="sm" variant="outline" className="gap-1.5 text-[#1a56db]">
                  <PlayCircle className="w-3.5 h-3.5" />
                  Watch Training
                </Button>
              </div>
            </CardContent>
          </Card>
        </section>

        <section id="spy" className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center">
              <Search className="w-4 h-4 text-white" />
            </div>
            <h2 className="text-xl font-bold text-foreground">Spy Tool</h2>
          </div>

          <Card className="border-border/60 shadow-sm">
            <CardContent className="p-6 space-y-4">
              <h3 className="font-bold text-foreground text-lg">Anstrex (Competitive Intelligence)</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Improve your ROI by unlocking your competitors' marketing strategies. Marketers of all kinds use Anstrex to uncover the secrets of world-class advertisers.
              </p>
              <p className="text-sm text-muted-foreground font-medium">
                BTS members get FREE access — log in with the shared credentials below:
              </p>
              <div className="bg-[#faf9f7] border border-[#e8e4dc] rounded-xl p-4 space-y-1 font-mono text-sm">
                <p><span className="text-muted-foreground">USER:</span> <span className="text-foreground">support@cherringtonmedia.com</span></p>
                <p><span className="text-muted-foreground">PASSWORD:</span> <span className="text-foreground">JesusLives3838!</span></p>
              </div>
              <a href="https://app.anstrex.com/login" target="_blank" rel="noopener noreferrer">
                <Button size="sm" className="bg-[#2d8a4e] hover:bg-[#246e3e] text-white gap-1.5">
                  <ExternalLink className="w-3.5 h-3.5" />
                  Log In to Anstrex
                </Button>
              </a>
            </CardContent>
          </Card>
        </section>

      </div>
    </AppLayout>
  );
}
