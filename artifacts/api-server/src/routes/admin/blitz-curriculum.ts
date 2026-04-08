export interface BlitzLesson {
  lessonId: string;
  title: string;
  phase: "build" | "test" | "scale";
  module: string;
  moduleSlug: string;
  lessonType: "conceptual" | "technical" | "strategy";
  networkPath: "universal" | "media-mavens" | "clickbank" | "maxweb";
  publisherPath: "all" | "caterpillar" | "grasshopper-crane";
  blitzOrder: number;
  matchKeywords: string[];
}

export const BLITZ_CURRICULUM: BlitzLesson[] = [
  {
    lessonId: "1.1", title: "Affiliate Arbitrage Overview", phase: "build",
    module: "Introduction", moduleSlug: "introduction", lessonType: "conceptual",
    networkPath: "universal", publisherPath: "all", blitzOrder: 1,
    matchKeywords: ["overview", "affiliate arbitrage", "intro"],
  },
  {
    lessonId: "2.1", title: "Choose Your Affiliate Network", phase: "build",
    module: "Offer Selection", moduleSlug: "offer-selection", lessonType: "conceptual",
    networkPath: "universal", publisherPath: "all", blitzOrder: 2,
    matchKeywords: ["choose your offer network", "choose your affiliate network", "offer network"],
  },
  {
    lessonId: "2.2", title: "Logging Into Media Mavens For The First Time", phase: "build",
    module: "Offer Selection", moduleSlug: "offer-selection", lessonType: "technical",
    networkPath: "media-mavens", publisherPath: "all", blitzOrder: 3,
    matchKeywords: ["logging into media mavens", "media mavens first time"],
  },
  {
    lessonId: "2.3", title: "Choosing Your Media Mavens Product To Promote", phase: "build",
    module: "Offer Selection", moduleSlug: "offer-selection", lessonType: "technical",
    networkPath: "media-mavens", publisherPath: "all", blitzOrder: 4,
    matchKeywords: ["media mavens product", "choosing your media mavens"],
  },
  {
    lessonId: "2.4", title: "How To Get Your Media Mavens Offer Affiliate Link", phase: "build",
    module: "Offer Selection", moduleSlug: "offer-selection", lessonType: "technical",
    networkPath: "media-mavens", publisherPath: "all", blitzOrder: 5,
    matchKeywords: ["media mavens", "affiliate link", "offer affiliate link"],
  },
  {
    lessonId: "2.5", title: "Choosing Your ClickBank Product To Promote", phase: "build",
    module: "Offer Selection", moduleSlug: "offer-selection", lessonType: "technical",
    networkPath: "clickbank", publisherPath: "all", blitzOrder: 6,
    matchKeywords: ["clickbank product", "choosing your clickbank"],
  },
  {
    lessonId: "2.6", title: "Applying For A MaxWeb Affiliate Account", phase: "build",
    module: "Offer Selection", moduleSlug: "offer-selection", lessonType: "technical",
    networkPath: "maxweb", publisherPath: "all", blitzOrder: 7,
    matchKeywords: ["maxweb", "applying", "affiliate account"],
  },
  {
    lessonId: "2.7", title: "Connecting MaxWeb Account to DIYtrax", phase: "build",
    module: "Offer Selection", moduleSlug: "offer-selection", lessonType: "technical",
    networkPath: "maxweb", publisherPath: "all", blitzOrder: 8,
    matchKeywords: ["maxweb", "diytrax", "connecting"],
  },
  {
    lessonId: "3.1", title: "Landing Page Overview", phase: "build",
    module: "Landing Page Setup", moduleSlug: "landing-page-setup", lessonType: "conceptual",
    networkPath: "universal", publisherPath: "all", blitzOrder: 9,
    matchKeywords: ["landing page overview"],
  },
  {
    lessonId: "3.2", title: "Clone Flexy Website", phase: "build",
    module: "Landing Page Setup", moduleSlug: "landing-page-setup", lessonType: "technical",
    networkPath: "universal", publisherPath: "all", blitzOrder: 10,
    matchKeywords: ["clone", "flexy", "template", "website"],
  },
  {
    lessonId: "3.3", title: "Add Domain To Flexy", phase: "build",
    module: "Landing Page Setup", moduleSlug: "landing-page-setup", lessonType: "technical",
    networkPath: "universal", publisherPath: "all", blitzOrder: 11,
    matchKeywords: ["add", "domain", "subdomain", "flexy"],
  },
  {
    lessonId: "3.4", title: "Connect Domain To Website", phase: "build",
    module: "Landing Page Setup", moduleSlug: "landing-page-setup", lessonType: "technical",
    networkPath: "universal", publisherPath: "all", blitzOrder: 12,
    matchKeywords: ["connect domain", "domain to website"],
  },
  {
    lessonId: "3.5", title: "Clone Page Into Any Website", phase: "build",
    module: "Landing Page Setup", moduleSlug: "landing-page-setup", lessonType: "technical",
    networkPath: "universal", publisherPath: "all", blitzOrder: 13,
    matchKeywords: ["clone page into any website", "clone a page into"],
  },
  {
    lessonId: "3.6", title: "Copy Blocks Headline Training", phase: "build",
    module: "Landing Page Setup", moduleSlug: "landing-page-setup", lessonType: "conceptual",
    networkPath: "universal", publisherPath: "all", blitzOrder: 14,
    matchKeywords: ["copy blocks training 1", "copy blocks", "headline training"],
  },
  {
    lessonId: "3.7", title: "Hero Shot Selection and Creation Training", phase: "build",
    module: "Landing Page Setup", moduleSlug: "landing-page-setup", lessonType: "conceptual",
    networkPath: "universal", publisherPath: "all", blitzOrder: 15,
    matchKeywords: ["copy blocks training 2", "hero shot", "hero shots", "selection", "creation"],
  },
  {
    lessonId: "3.8", title: "Cloning Your Advertorial Page", phase: "build",
    module: "Landing Page Setup", moduleSlug: "landing-page-setup", lessonType: "technical",
    networkPath: "media-mavens", publisherPath: "all", blitzOrder: 16,
    matchKeywords: ["cloning your advertorial", "advertorial page"],
  },
  {
    lessonId: "3.9", title: "Creating Split Test Variants for Your Advertorial", phase: "build",
    module: "Landing Page Setup", moduleSlug: "landing-page-setup", lessonType: "technical",
    networkPath: "media-mavens", publisherPath: "all", blitzOrder: 17,
    matchKeywords: ["split test variants", "advertorial"],
  },
  {
    lessonId: "3.10", title: "Generate Advertorial Headlines with AffiliateCMO", phase: "build",
    module: "Landing Page Setup", moduleSlug: "landing-page-setup", lessonType: "technical",
    networkPath: "media-mavens", publisherPath: "all", blitzOrder: 18,
    matchKeywords: ["advertorial headlines", "affiliatecmo"],
  },
  {
    lessonId: "3.11", title: "Generate Advertorial Headlines with FreeAdCopy", phase: "build",
    module: "Landing Page Setup", moduleSlug: "landing-page-setup", lessonType: "technical",
    networkPath: "media-mavens", publisherPath: "all", blitzOrder: 19,
    matchKeywords: ["advertorial headlines", "freeadcopy"],
  },
  {
    lessonId: "3.12", title: "Generate/Find 5 Advertorial Hero Shots", phase: "build",
    module: "Landing Page Setup", moduleSlug: "landing-page-setup", lessonType: "technical",
    networkPath: "media-mavens", publisherPath: "all", blitzOrder: 20,
    matchKeywords: ["advertorial hero shots", "hero shots cb", "adam on hero shots"],
  },
  {
    lessonId: "3.13", title: "Submit Advertorial Split Test Media to Compliance", phase: "build",
    module: "Landing Page Setup", moduleSlug: "landing-page-setup", lessonType: "technical",
    networkPath: "media-mavens", publisherPath: "all", blitzOrder: 21,
    matchKeywords: ["advertorial", "split test", "compliance"],
  },
  {
    lessonId: "3.14", title: "Install Video DownloadHelper in Firefox", phase: "build",
    module: "Landing Page Setup", moduleSlug: "landing-page-setup", lessonType: "technical",
    networkPath: "clickbank", publisherPath: "all", blitzOrder: 22,
    matchKeywords: ["install video downloadhelper", "downloadhelper", "firefox"],
  },
  {
    lessonId: "3.15", title: "Download Your VSL", phase: "build",
    module: "Landing Page Setup", moduleSlug: "landing-page-setup", lessonType: "technical",
    networkPath: "clickbank", publisherPath: "all", blitzOrder: 23,
    matchKeywords: ["download your vsl", "download vsl"],
  },
  {
    lessonId: "3.16", title: "How to Get a Transcription from Your VSL", phase: "build",
    module: "Landing Page Setup", moduleSlug: "landing-page-setup", lessonType: "technical",
    networkPath: "clickbank", publisherPath: "all", blitzOrder: 24,
    matchKeywords: ["transcript", "vsl", "temi", "transcription"],
  },
  {
    lessonId: "3.17a", title: "How to Generate Angles — Affiliate Angle Architect Bot", phase: "build",
    module: "Landing Page Setup", moduleSlug: "landing-page-setup", lessonType: "technical",
    networkPath: "clickbank", publisherPath: "all", blitzOrder: 25,
    matchKeywords: ["affiliate architect bot"],
  },
  {
    lessonId: "3.17b", title: "Generating Landing Page Angles Using POE", phase: "build",
    module: "Landing Page Setup", moduleSlug: "landing-page-setup", lessonType: "technical",
    networkPath: "clickbank", publisherPath: "all", blitzOrder: 26,
    matchKeywords: ["generating landing page angles", "angles using poe"],
  },
  {
    lessonId: "3.18a", title: "How to Use the Bridge Page Bot", phase: "build",
    module: "Landing Page Setup", moduleSlug: "landing-page-setup", lessonType: "technical",
    networkPath: "clickbank", publisherPath: "all", blitzOrder: 27,
    matchKeywords: ["bridge page bot"],
  },
  {
    lessonId: "3.18b", title: "How to Generate Jump Page Body Copy — Bridge Page Copy Bot", phase: "build",
    module: "Landing Page Setup", moduleSlug: "landing-page-setup", lessonType: "technical",
    networkPath: "clickbank", publisherPath: "all", blitzOrder: 28,
    matchKeywords: ["bridge page copy bot"],
  },
  {
    lessonId: "3.19", title: "Choosing a Jump Page Base to Clone", phase: "build",
    module: "Landing Page Setup", moduleSlug: "landing-page-setup", lessonType: "technical",
    networkPath: "clickbank", publisherPath: "all", blitzOrder: 27,
    matchKeywords: ["jump page base", "choose jump page", "choosing a jump page"],
  },
  {
    lessonId: "3.20", title: "Create Your Landing Page Base Copy", phase: "build",
    module: "Landing Page Setup", moduleSlug: "landing-page-setup", lessonType: "technical",
    networkPath: "clickbank", publisherPath: "all", blitzOrder: 28,
    matchKeywords: ["landing page base copy", "create your landing page"],
  },
  {
    lessonId: "3.21", title: "Clone More Landing Pages from Base Copy", phase: "build",
    module: "Landing Page Setup", moduleSlug: "landing-page-setup", lessonType: "technical",
    networkPath: "clickbank", publisherPath: "all", blitzOrder: 29,
    matchKeywords: ["clone more landing pages", "cb lp", "submit landing page", "landing page split test"],
  },
  {
    lessonId: "3.22", title: "Submit Landing Page Split Test Media to Compliance", phase: "build",
    module: "Landing Page Setup", moduleSlug: "landing-page-setup", lessonType: "technical",
    networkPath: "clickbank", publisherPath: "all", blitzOrder: 30,
    matchKeywords: ["landing page split test", "compliance", "submit landing"],
  },
  {
    lessonId: "4.1", title: "Finding Your Edge With Ad Banner Psychology", phase: "build",
    module: "Ad Creation", moduleSlug: "ad-creation", lessonType: "conceptual",
    networkPath: "universal", publisherPath: "all", blitzOrder: 31,
    matchKeywords: ["ad banner", "psychology", "edge", "winning"],
  },
  {
    lessonId: "4.2", title: "How to Create Ad Headlines and Descriptions", phase: "build",
    module: "Ad Creation", moduleSlug: "ad-creation", lessonType: "technical",
    networkPath: "universal", publisherPath: "caterpillar", blitzOrder: 32,
    matchKeywords: ["native ads", "headlines", "claude"],
  },
  {
    lessonId: "4.3", title: "How to Create An Ad Image (16x9)", phase: "build",
    module: "Ad Creation", moduleSlug: "ad-creation", lessonType: "technical",
    networkPath: "universal", publisherPath: "caterpillar", blitzOrder: 33,
    matchKeywords: ["native ads", "images", "midjourney", "ad image"],
  },
  {
    lessonId: "4.4", title: "Submit Ad Split Test Media to Compliance", phase: "build",
    module: "Ad Creation", moduleSlug: "ad-creation", lessonType: "technical",
    networkPath: "universal", publisherPath: "caterpillar", blitzOrder: 34,
    matchKeywords: ["ad split test", "ad banner split test", "compliance", "submit ad"],
  },
  {
    lessonId: "4.5", title: "Creating Ad Banner Variants for Testing", phase: "build",
    module: "Ad Creation", moduleSlug: "ad-creation", lessonType: "technical",
    networkPath: "universal", publisherPath: "grasshopper-crane", blitzOrder: 35,
    matchKeywords: ["ad banner variants", "creating ad banner"],
  },
  {
    lessonId: "4.6", title: "Choose Your Publisher and Placement", phase: "build",
    module: "Ad Creation", moduleSlug: "ad-creation", lessonType: "strategy",
    networkPath: "universal", publisherPath: "grasshopper-crane", blitzOrder: 36,
    matchKeywords: ["publisher", "placement", "choose your publisher"],
  },
  {
    lessonId: "5.1", title: "Create DIYTrax Campaign Placeholder", phase: "build",
    module: "DIYTrax Setup", moduleSlug: "diytrax-setup", lessonType: "technical",
    networkPath: "universal", publisherPath: "all", blitzOrder: 37,
    matchKeywords: ["diytrax campaign placeholder", "create diytrax"],
  },
  {
    lessonId: "5.2", title: "DIYTrax ClickBank IPN Integration", phase: "build",
    module: "DIYTrax Setup", moduleSlug: "diytrax-setup", lessonType: "technical",
    networkPath: "clickbank", publisherPath: "all", blitzOrder: 38,
    matchKeywords: ["clickbank ipn", "ipn integration", "diytrax"],
  },
  {
    lessonId: "5.3", title: "Add DIYTrax LP Offer Link in Flexy Custom Value", phase: "build",
    module: "DIYTrax Setup", moduleSlug: "diytrax-setup", lessonType: "technical",
    networkPath: "universal", publisherPath: "all", blitzOrder: 39,
    matchKeywords: ["diytrax lp offer link", "custom value"],
  },
  {
    lessonId: "5.4", title: "Add DIYTrax LP Offer Link Directly in Flexy", phase: "build",
    module: "DIYTrax Setup", moduleSlug: "diytrax-setup", lessonType: "technical",
    networkPath: "universal", publisherPath: "all", blitzOrder: 40,
    matchKeywords: ["diytrax lp offer link", "landing page", "directly"],
  },
  {
    lessonId: "6.1", title: "Optimize Landing Page Base Copy", phase: "build",
    module: "Split Test Setup", moduleSlug: "split-test-setup", lessonType: "strategy",
    networkPath: "universal", publisherPath: "all", blitzOrder: 41,
    matchKeywords: ["optimize", "landing page base copy", "optimizing"],
  },
  {
    lessonId: "6.2", title: "How to Know Whether to Use MetricMover or Individual Landing Pages", phase: "build",
    module: "Split Test Setup", moduleSlug: "split-test-setup", lessonType: "strategy",
    networkPath: "universal", publisherPath: "all", blitzOrder: 42,
    matchKeywords: ["metric mover or individual", "whether to use metric mover"],
  },
  {
    lessonId: "6.3", title: "What You Need For A MetricMover Test", phase: "build",
    module: "Split Test Setup", moduleSlug: "split-test-setup", lessonType: "technical",
    networkPath: "universal", publisherPath: "all", blitzOrder: 43,
    matchKeywords: ["metric mover 1", "what you need", "metricmover test"],
  },
  {
    lessonId: "6.4", title: "Creating A New MetricMover Campaign", phase: "build",
    module: "Split Test Setup", moduleSlug: "split-test-setup", lessonType: "technical",
    networkPath: "universal", publisherPath: "all", blitzOrder: 44,
    matchKeywords: ["metric mover 2", "new metric mover campaign", "creating a new"],
  },
  {
    lessonId: "6.5", title: "How To Import Your Landing Page Into MetricMover", phase: "build",
    module: "Split Test Setup", moduleSlug: "split-test-setup", lessonType: "technical",
    networkPath: "universal", publisherPath: "all", blitzOrder: 45,
    matchKeywords: ["metric mover 3", "import your landing page", "import landing"],
  },
  {
    lessonId: "6.6", title: "How To Create Headline Variants In MetricMover", phase: "build",
    module: "Split Test Setup", moduleSlug: "split-test-setup", lessonType: "technical",
    networkPath: "universal", publisherPath: "all", blitzOrder: 46,
    matchKeywords: ["metric mover 4", "headline variants", "create headline"],
  },
  {
    lessonId: "6.7", title: "How To Upload Hero Shots To Flexy For Use In MetricMover", phase: "build",
    module: "Split Test Setup", moduleSlug: "split-test-setup", lessonType: "technical",
    networkPath: "universal", publisherPath: "all", blitzOrder: 47,
    matchKeywords: ["metric mover 5", "upload hero shots", "hero shots to flexy"],
  },
  {
    lessonId: "6.8", title: "How To Create Hero Shot Variants In MetricMover", phase: "build",
    module: "Split Test Setup", moduleSlug: "split-test-setup", lessonType: "technical",
    networkPath: "universal", publisherPath: "all", blitzOrder: 48,
    matchKeywords: ["metric mover 6", "hero shot variants"],
  },
  {
    lessonId: "6.9", title: "How To Set Up A Flexy Page For MetricMover Code", phase: "build",
    module: "Split Test Setup", moduleSlug: "split-test-setup", lessonType: "technical",
    networkPath: "universal", publisherPath: "all", blitzOrder: 49,
    matchKeywords: ["metric mover 7", "set up a flexy page", "metricmover code"],
  },
  {
    lessonId: "6.10", title: "How To Export MetricMover Campaign Files", phase: "build",
    module: "Split Test Setup", moduleSlug: "split-test-setup", lessonType: "technical",
    networkPath: "universal", publisherPath: "all", blitzOrder: 50,
    matchKeywords: ["metric mover 8", "export", "campaign files"],
  },
  {
    lessonId: "6.11", title: "How To Find Your MetricMover Code File", phase: "build",
    module: "Split Test Setup", moduleSlug: "split-test-setup", lessonType: "technical",
    networkPath: "universal", publisherPath: "all", blitzOrder: 51,
    matchKeywords: ["metric mover 9", "find your metricmover", "code file"],
  },
  {
    lessonId: "6.12", title: "How To Embed MetricMover Code Into A Flexy Page", phase: "build",
    module: "Split Test Setup", moduleSlug: "split-test-setup", lessonType: "technical",
    networkPath: "universal", publisherPath: "all", blitzOrder: 52,
    matchKeywords: ["metric mover 10", "embed", "metricmover code"],
  },
  {
    lessonId: "6.13", title: "How To Check MetricMover Page Variants", phase: "build",
    module: "Split Test Setup", moduleSlug: "split-test-setup", lessonType: "technical",
    networkPath: "universal", publisherPath: "all", blitzOrder: 53,
    matchKeywords: ["metric mover 11", "check", "page variants"],
  },
  {
    lessonId: "6.14", title: "How To Find Your MetricMover .csv File For DIYTrax Import", phase: "build",
    module: "Split Test Setup", moduleSlug: "split-test-setup", lessonType: "technical",
    networkPath: "universal", publisherPath: "all", blitzOrder: 54,
    matchKeywords: ["metric mover 12", "csv", "diytrax import"],
  },
  {
    lessonId: "6.15", title: "How To Import MetricMover Page Variants Into DIYTrax", phase: "build",
    module: "Split Test Setup", moduleSlug: "split-test-setup", lessonType: "technical",
    networkPath: "universal", publisherPath: "all", blitzOrder: 55,
    matchKeywords: ["metric mover 13", "import metricmover", "page variants into diytrax"],
  },
  {
    lessonId: "6.16", title: "What You Need for Cloned Flexy Page Test", phase: "build",
    module: "Split Test Setup", moduleSlug: "split-test-setup", lessonType: "technical",
    networkPath: "universal", publisherPath: "all", blitzOrder: 56,
    matchKeywords: ["cloned flexy 1", "what you need", "cloned flexy page test"],
  },
  {
    lessonId: "6.17", title: "How to Duplicate Your Base Flexy Page", phase: "build",
    module: "Split Test Setup", moduleSlug: "split-test-setup", lessonType: "technical",
    networkPath: "universal", publisherPath: "all", blitzOrder: 57,
    matchKeywords: ["cloned flexy 2", "duplicate your base", "duplicate base flexy"],
  },
  {
    lessonId: "6.18", title: "How to Change The Headline and Hero Shot", phase: "build",
    module: "Split Test Setup", moduleSlug: "split-test-setup", lessonType: "technical",
    networkPath: "universal", publisherPath: "all", blitzOrder: 58,
    matchKeywords: ["cloned flexy 3", "change the headline", "headline and hero shot"],
  },
  {
    lessonId: "6.19", title: "Further Page Edits", phase: "build",
    module: "Split Test Setup", moduleSlug: "split-test-setup", lessonType: "technical",
    networkPath: "universal", publisherPath: "all", blitzOrder: 59,
    matchKeywords: ["cloned flexy 4", "further page edits", "editing landing page"],
  },
  {
    lessonId: "6.20", title: "Cloning and Editing More Landing Page Variants", phase: "build",
    module: "Split Test Setup", moduleSlug: "split-test-setup", lessonType: "technical",
    networkPath: "universal", publisherPath: "all", blitzOrder: 60,
    matchKeywords: ["cloned flexy 5", "cloning and editing", "more landing page variants"],
  },
  {
    lessonId: "6.21", title: "Gathering Your Landing Page Variant URLs for DIYTrax", phase: "build",
    module: "Split Test Setup", moduleSlug: "split-test-setup", lessonType: "technical",
    networkPath: "universal", publisherPath: "all", blitzOrder: 61,
    matchKeywords: ["cloned flexy 6", "gathering", "variant urls", "landing page variant urls"],
  },
  {
    lessonId: "6.22", title: "Adding Your Landing Page Variant URLs to DIYTrax", phase: "build",
    module: "Split Test Setup", moduleSlug: "split-test-setup", lessonType: "technical",
    networkPath: "universal", publisherPath: "all", blitzOrder: 62,
    matchKeywords: ["cloned flexy 7", "adding your landing page", "variant urls to diytrax"],
  },
  {
    lessonId: "7.1", title: "DIYTrax Campaign Basic Info", phase: "build",
    module: "Go Live — Caterpillar", moduleSlug: "go-live-caterpillar", lessonType: "technical",
    networkPath: "universal", publisherPath: "caterpillar", blitzOrder: 63,
    matchKeywords: ["traffic vid 1", "caterpillar basic info", "campaign basic info"],
  },
  {
    lessonId: "7.2", title: "Configure Traffic Source Settings", phase: "build",
    module: "Go Live — Caterpillar", moduleSlug: "go-live-caterpillar", lessonType: "technical",
    networkPath: "universal", publisherPath: "caterpillar", blitzOrder: 64,
    matchKeywords: ["traffic vid 2", "caterpillar traffic source", "traffic source settings"],
  },
  {
    lessonId: "7.3", title: "Create Your First Native Ad", phase: "build",
    module: "Go Live — Caterpillar", moduleSlug: "go-live-caterpillar", lessonType: "technical",
    networkPath: "universal", publisherPath: "caterpillar", blitzOrder: 65,
    matchKeywords: ["traffic vid 3", "caterpillar first ad", "first native ad"],
  },
  {
    lessonId: "7.4", title: "Create More Ads", phase: "build",
    module: "Go Live — Caterpillar", moduleSlug: "go-live-caterpillar", lessonType: "technical",
    networkPath: "universal", publisherPath: "caterpillar", blitzOrder: 66,
    matchKeywords: ["traffic vid 4", "caterpillar more ads", "create more ads"],
  },
  {
    lessonId: "7.5", title: "Fund Your Traffic Source", phase: "build",
    module: "Go Live — Caterpillar", moduleSlug: "go-live-caterpillar", lessonType: "technical",
    networkPath: "universal", publisherPath: "caterpillar", blitzOrder: 67,
    matchKeywords: ["traffic vid 7", "caterpillar fund", "fund your traffic"],
  },
  {
    lessonId: "7.6", title: "Add Your Landing Pages in DIYTrax", phase: "build",
    module: "Go Live — Caterpillar", moduleSlug: "go-live-caterpillar", lessonType: "technical",
    networkPath: "universal", publisherPath: "caterpillar", blitzOrder: 68,
    matchKeywords: ["traffic vid 5", "caterpillar landing pages", "landing pages in diytrax"],
  },
  {
    lessonId: "7.7", title: "Place Affiliate Link in DIYTrax Campaign Offer Pages", phase: "build",
    module: "Go Live — Caterpillar", moduleSlug: "go-live-caterpillar", lessonType: "technical",
    networkPath: "universal", publisherPath: "caterpillar", blitzOrder: 69,
    matchKeywords: ["traffic vid 6", "caterpillar offer page", "affiliate link", "offer pages"],
  },
  {
    lessonId: "7.8", title: "Final QA Campaign Check and Set to Live", phase: "build",
    module: "Go Live — Caterpillar", moduleSlug: "go-live-caterpillar", lessonType: "technical",
    networkPath: "universal", publisherPath: "caterpillar", blitzOrder: 70,
    matchKeywords: ["traffic vid 8", "caterpillar final qa", "qa campaign check"],
  },
  {
    lessonId: "7.9", title: "How Traffic Source Works and What to Expect", phase: "build",
    module: "Go Live — Caterpillar", moduleSlug: "go-live-caterpillar", lessonType: "strategy",
    networkPath: "universal", publisherPath: "caterpillar", blitzOrder: 71,
    matchKeywords: ["traffic vid 9", "how traffic source works", "what to expect", "how caterpillar"],
  },
  {
    lessonId: "7B.1", title: "Configure Campaign Basic Info", phase: "build",
    module: "Go Live — Grasshopper/Crane", moduleSlug: "go-live-grasshopper-crane", lessonType: "technical",
    networkPath: "universal", publisherPath: "grasshopper-crane", blitzOrder: 72,
    matchKeywords: ["diytrax traffic", "configure", "basic info", "grasshopper"],
  },
  {
    lessonId: "7B.2", title: "Configure Traffic Source Settings", phase: "build",
    module: "Go Live — Grasshopper/Crane", moduleSlug: "go-live-grasshopper-crane", lessonType: "technical",
    networkPath: "universal", publisherPath: "grasshopper-crane", blitzOrder: 73,
    matchKeywords: ["diytrax traffic 1", "configure traffic source", "grasshopper"],
  },
  {
    lessonId: "7B.3", title: "Upload Ad Banners", phase: "build",
    module: "Go Live — Grasshopper/Crane", moduleSlug: "go-live-grasshopper-crane", lessonType: "technical",
    networkPath: "universal", publisherPath: "grasshopper-crane", blitzOrder: 74,
    matchKeywords: ["diytrax traffic 2", "upload ad banners"],
  },
  {
    lessonId: "7B.4", title: "Fund Your Traffic Source", phase: "build",
    module: "Go Live — Grasshopper/Crane", moduleSlug: "go-live-grasshopper-crane", lessonType: "technical",
    networkPath: "universal", publisherPath: "grasshopper-crane", blitzOrder: 75,
    matchKeywords: ["diytrax traffic 3", "fund your traffic", "grasshopper"],
  },
  {
    lessonId: "7B.5", title: "Place Affiliate Link in Campaign Offer Pages", phase: "build",
    module: "Go Live — Grasshopper/Crane", moduleSlug: "go-live-grasshopper-crane", lessonType: "technical",
    networkPath: "universal", publisherPath: "grasshopper-crane", blitzOrder: 76,
    matchKeywords: ["diytrax traffic 4", "affiliate link", "offer page", "grasshopper"],
  },
  {
    lessonId: "7B.6", title: "Final QA Campaign Check", phase: "build",
    module: "Go Live — Grasshopper/Crane", moduleSlug: "go-live-grasshopper-crane", lessonType: "technical",
    networkPath: "universal", publisherPath: "grasshopper-crane", blitzOrder: 77,
    matchKeywords: ["diytrax traffic 5", "final qa", "grasshopper"],
  },
  {
    lessonId: "7B.7", title: "Submit Banners and Turn Campaign Active", phase: "build",
    module: "Go Live — Grasshopper/Crane", moduleSlug: "go-live-grasshopper-crane", lessonType: "technical",
    networkPath: "universal", publisherPath: "grasshopper-crane", blitzOrder: 78,
    matchKeywords: ["diytrax traffic 6", "submit banners", "turn campaign active", "submit ad banners"],
  },
  {
    lessonId: "7B.8", title: "How Traffic Source Works and What to Expect", phase: "build",
    module: "Go Live — Grasshopper/Crane", moduleSlug: "go-live-grasshopper-crane", lessonType: "strategy",
    networkPath: "universal", publisherPath: "grasshopper-crane", blitzOrder: 79,
    matchKeywords: ["diytrax traffic 7", "how grasshopper", "how traffic", "what to expect", "grasshopper"],
  },
  {
    lessonId: "8.1", title: "How to Monitor Your Campaign Performance", phase: "test",
    module: "Round 1 Campaign Management", moduleSlug: "round-1-management", lessonType: "strategy",
    networkPath: "universal", publisherPath: "all", blitzOrder: 80,
    matchKeywords: ["p&l tracker", "profit and loss", "monitor", "campaign performance"],
  },
  {
    lessonId: "8.2", title: "Round 1 — When to Make a Banner Inactive", phase: "test",
    module: "Round 1 Campaign Management", moduleSlug: "round-1-management", lessonType: "strategy",
    networkPath: "universal", publisherPath: "all", blitzOrder: 81,
    matchKeywords: ["banner inactive", "when to make", "round 1"],
  },
  {
    lessonId: "8.3", title: "Round 1 — What To Do If Campaign Turns Off Before $1500", phase: "test",
    module: "Round 1 Campaign Management", moduleSlug: "round-1-management", lessonType: "strategy",
    networkPath: "universal", publisherPath: "all", blitzOrder: 82,
    matchKeywords: ["campaign turns off", "$1500", "before 1500"],
  },
  {
    lessonId: "9.1", title: "How to Set Up Your P&L Tracker", phase: "test",
    module: "After Round 1", moduleSlug: "after-round-1", lessonType: "technical",
    networkPath: "universal", publisherPath: "all", blitzOrder: 83,
    matchKeywords: ["p&l tracker", "set up", "profit and loss"],
  },
  {
    lessonId: "10.1", title: "How to Use Cropbot to Create 9x16 Image", phase: "test",
    module: "Preparing for Round 2 — Caterpillar", moduleSlug: "round-2-caterpillar", lessonType: "technical",
    networkPath: "universal", publisherPath: "caterpillar", blitzOrder: 84,
    matchKeywords: ["rd2 vid 1", "cropbot", "9x16"],
  },
  {
    lessonId: "10.2", title: "How to Create Videos From Round 1 Image", phase: "test",
    module: "Preparing for Round 2 — Caterpillar", moduleSlug: "round-2-caterpillar", lessonType: "technical",
    networkPath: "universal", publisherPath: "caterpillar", blitzOrder: 85,
    matchKeywords: ["rd2 vid 2", "grok imagine", "create videos", "round 1 image"],
  },
  {
    lessonId: "10.3", title: "How to Trim Video Length", phase: "test",
    module: "Preparing for Round 2 — Caterpillar", moduleSlug: "round-2-caterpillar", lessonType: "technical",
    networkPath: "universal", publisherPath: "caterpillar", blitzOrder: 86,
    matchKeywords: ["rd2 vid 3", "trim", "video length", "adobe express"],
  },
  {
    lessonId: "10.4", title: "How to Convert Videos to GIFs Using Adobe Express", phase: "test",
    module: "Preparing for Round 2 — Caterpillar", moduleSlug: "round-2-caterpillar", lessonType: "technical",
    networkPath: "universal", publisherPath: "caterpillar", blitzOrder: 87,
    matchKeywords: ["rd2 vid 4", "vids to gif", "adobe express", "convert videos to gifs"],
  },
  {
    lessonId: "10.5", title: "How to Reduce GIF File Size Using GIFSTER", phase: "test",
    module: "Preparing for Round 2 — Caterpillar", moduleSlug: "round-2-caterpillar", lessonType: "technical",
    networkPath: "universal", publisherPath: "caterpillar", blitzOrder: 88,
    matchKeywords: ["rd2 vid 5", "reduce gif", "gifster"],
  },
  {
    lessonId: "10.6", title: "How to Convert Videos to GIFs Using GIFSTER", phase: "test",
    module: "Preparing for Round 2 — Caterpillar", moduleSlug: "round-2-caterpillar", lessonType: "technical",
    networkPath: "universal", publisherPath: "caterpillar", blitzOrder: 89,
    matchKeywords: ["rd2 vid 6", "vids to gif gifster", "convert videos", "gifster"],
  },
  {
    lessonId: "10.7", title: "How to Create Ads and Launch Round 2", phase: "test",
    module: "Preparing for Round 2 — Caterpillar", moduleSlug: "round-2-caterpillar", lessonType: "technical",
    networkPath: "universal", publisherPath: "caterpillar", blitzOrder: 90,
    matchKeywords: ["rd2 vid 7", "launch rd 2", "launch round 2", "create ads"],
  },
];

export function matchVideoToCurriculum(videoTitle: string): { lesson: BlitzLesson; score: number } | null {
  const normalizedTitle = videoTitle
    .toLowerCase()
    .replace(/tce\s*blitz\s*-?\s*/gi, "")
    .replace(/\(\d+\)/g, "")
    .replace(/\d{4}-\d{2}-\d{2}/g, "")
    .replace(/\s+/g, " ")
    .trim();

  let bestMatch: BlitzLesson | null = null;
  let bestScore = 0;

  for (const lesson of BLITZ_CURRICULUM) {
    let score = 0;

    for (const keyword of lesson.matchKeywords) {
      if (normalizedTitle.includes(keyword.toLowerCase())) {
        score += keyword.length;
      }
    }

    if (lesson.title.toLowerCase() === normalizedTitle) {
      score += 1000;
    }

    const titleWords = lesson.title.toLowerCase().split(/\s+/);
    const matchingWords = titleWords.filter(w => w.length > 3 && normalizedTitle.includes(w));
    score += matchingWords.length * 3;

    if (score > bestScore) {
      bestScore = score;
      bestMatch = lesson;
    }
  }

  if (!bestMatch || bestScore < 5) return null;
  return { lesson: bestMatch, score: bestScore };
}
