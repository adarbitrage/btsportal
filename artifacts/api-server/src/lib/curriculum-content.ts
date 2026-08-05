/**
 * Front-end curriculum content — SERVER-ONLY (de-bundle enforcement).
 *
 * The bodies of the 7 Pillars, Quick-Start Guide, Pillars-to-Blitz, and
 * Tips & Tricks pages live here so ZERO course copy ships in the portal JS
 * bundle. Each page's content is served by a gated endpoint
 * (GET /api/curriculum/:pageKey behind requirePageAccess — the same
 * middleware the Blitz guide uses) and rendered client-side by the original
 * React components.
 *
 * Brand substitution: prose contains {{brand.full}} / {{brand.short}} /
 * {{brand.possessive}} / {{brand.shortPossessive}} tokens; the portal's
 * useCurriculumContent hook substitutes them with the member's brand strings
 * (useBrand), so white-label brands render exactly as before.
 *
 * Strings ending in `Html` (or arrays named *Html) may contain inline HTML
 * (<strong class>, <a data-spa href>) and are rendered via a sanit- known,
 * trusted constant — this file is authored content, never user input.
 */

export const CURRICULUM_PAGE_KEYS = [
  "seven-pillars",
  "quick-start",
  "pillars-to-blitz",
  "tips-and-tricks",
] as const;

export type CurriculumPageKey = (typeof CURRICULUM_PAGE_KEYS)[number];

const STRONG = (t: string) => `<strong class="text-foreground">${t}</strong>`;

/* ------------------------------------------------------------------ */
/* The 7 Pillars™                                                      */
/* ------------------------------------------------------------------ */

const sevenPillars = {
  heroIntro:
    "The foundational framework behind every successful affiliate marketing business — the seven elements that turn paid traffic into a profitable digital business.",
  heroNoteHtml: `${STRONG("Start here.")} This is where your path begins — it gives you the big-picture model so the hands-on build in The Blitz™ makes sense.`,
  video: {
    embedId: "CsHMvOhZEPEm1Dpp",
    loaderUrl: "https://fast.vidalytics.com/embeds/trR5xdVa/CsHMvOhZEPEm1Dpp/",
  },
  pillarTitles: [
    "The Business Model",
    "The Market",
    "The Demographic",
    "The Traffic Channel",
    "The Strategy",
    "The Edge",
    "The Commitment",
  ],
  welcome: {
    heading: "Welcome To The 7 Pillars™ Of A Profitable Digital Business",
    paragraphsHtml: [
      "Welcome, and thank you for choosing to embark on this journey. Over the past 20+ years, we've immersed ourselves in the digital marketing industry, navigating its intricate pathways and learning its secrets. We've experienced the peaks of success, the valleys of failure, and the vast plains of steady progress. Each step of the way, we've gathered invaluable insights and honed strategies that work.",
      `In this training, we're going to dive deep into the heart of digital marketing. We're not just skimming the surface; we're dissecting the industry, breaking it down into its core components, and ${STRONG("revealing the essential elements that make a profitable digital business")}. This isn't a quick overview; it's a comprehensive exploration of the intricate details that can propel your success in this industry.`,
      `The digital marketing landscape is vast and complex, but that shouldn't deter you. With the right guidance and a solid understanding of the fundamentals, ${STRONG("you can navigate this landscape with confidence and precision")}. That's where {{brand.full}} comes in. This program is designed to equip you with the knowledge, skills, and strategies you need to thrive in the digital marketing world.`,
      `We've broken down the process of building a successful digital business into ${STRONG("seven key pillars")}. These pillars are the foundation of any successful digital business, and understanding them is crucial to your success. Each pillar represents a vital component of your business, and we're going to explore each one in detail.`,
    ],
  },
  sections: [
    {
      paragraphsHtml: [
        `The first pillar of a successful digital business is ${STRONG("the business model")}. This is the framework that your business operates within, the strategy that guides your actions, and the mechanism that generates your profits.`,
        `In the vast world of online business models, one stands out for its simplicity, predictability, and scalability: ${STRONG("Affiliate Marketing")}. Over the past two decades, we've explored numerous online business models, but none have proven as consistently profitable as Affiliate Marketing, particularly when combined with paid media — a strategy also known as ${STRONG("Affiliate Arbitrage")}.`,
        `Affiliate Arbitrage involves using paid advertising to promote affiliate offers, with the goal of earning more in affiliate commissions than you spend on advertising. If you spend $40 on ads to sell a product and earn a $60 commission, you've made a $20 profit. Scale that to 10 sales a day and you're looking at ${STRONG("$200 daily profit")}.`,
      ],
      highlight: {
        title: "Key Benefits of Affiliate Arbitrage:",
        items: [
          "No need to build a complete website — we're in the business of making profits",
          "No need to create your own product — leverage existing products with market demand",
          "No merchant processing or customer support hassles",
          "No existing audience required — start from scratch and turn a profit in your first week",
          "Track ROI in real time — you're paid on the front-end sale",
        ],
      },
    },
    {
      paragraphsHtml: [
        `Once you've committed to the path of affiliate arbitrage, the next crucial step is selecting the market you wish to operate in. Based on 20+ years of experience, two primary markets consistently deliver exceptional results: ${STRONG("Trendy Gadgets")} and ${STRONG("Health & Wellness Products")}.`,
      ],
      duo: [
        {
          title: "Trendy Gadgets",
          text: "These products have universal appeal. In an era of rapid technological advancements, there's always a new gadget catching the world's attention. The global gadget market is valued at hundreds of billions of dollars and is only projected to grow.",
        },
        {
          title: "Health & Wellness",
          text: "This market is valued at over $300 billion globally. Post-pandemic, consumers are more focused than ever on improving their health. Supplements offer affordable, scalable solutions making them ideal for scaling campaigns.",
        },
      ],
      closingParagraphsHtml: [
        `As part of your enrollment in {{brand.full}}, you'll gain access to hundreds of health and wellness offers through multiple affiliate network relationships. ${STRONG("You will never need to hunt for offers — your pathway to success is already paved.")}`,
      ],
    },
    {
      paragraphsHtml: [
        `Once we've established what we'll be promoting, it's time to identify our target audience. A significant portion of online spending comes from a demographic that many marketers overlook: ${STRONG("Baby Boomers")} — individuals in their late 50s to early 70s who are financially established with disposable income.`,
        `Contrary to popular belief, Baby Boomers are far from being technologically inept. They use smartphones, are active on social media, and regularly shop online. Studies show that ${STRONG("Boomers spend more money online than younger generations")}.`,
      ],
      highlight: {
        title: "Why Boomers Are the Perfect Demographic:",
        items: [
          "They're drawn to products that make their lives easier and more enjoyable",
          "They're highly motivated to invest in health & wellness products",
          "They value convenience and immediate results",
          "They make up one of the largest, most financially capable demographic groups",
        ],
      },
    },
    {
      paragraphsHtml: [
        `We've identified our business model (Affiliate Marketing), our markets (Trendy Gadgets & Health), and our target demographic (Boomers). Now it's time to address WHERE we'll promote our products. The answer is ${STRONG("through the powerful medium of email")}.`,
        "Our strategy revolves around leveraging the power of existing email lists. Instead of building our own list, we seek out those who already have extensive email lists and place our ads within the emails they send to their subscribers.",
      ],
      highlight: {
        title: "Why Email Traffic Reigns Supreme:",
        items: [
          "Enormous scale — vast number of email lists available",
          "Many newsletters are sent daily — plenty of inventory to purchase",
          "Some lists have over a million subscribers for instant reach",
          "No complicated, ever-changing algorithms like Google or Facebook",
          "Warmer traffic — subscribers are already opted in and receptive",
          "Less competition — most marketers are unaware of this channel",
        ],
      },
      closingParagraphsHtml: [
        `As part of your enrollment, you'll gain access to hundreds of underground list management companies, brokers, publishers, and networks. ${STRONG("You'll never be left wondering where to buy advertising!")}`,
      ],
    },
    {
      paragraphsHtml: [
        `The strategy is our operational blueprint. In affiliate marketing, success isn't a game of chance — it's a calculated effort. ${STRONG("Our two-phase approach is built for simplicity and effectiveness.")}`,
      ],
      duo: [
        {
          title: "Phase 1: Email Sponsorships",
          text: "This is where the journey begins. Email Sponsorships put your offers directly in front of highly engaged audiences, giving you the perfect testing ground. Many students spend $5k+ per day, achieving ROI of 50% or higher during this phase.",
        },
        {
          title: "Phase 2: Dedicated Emails",
          text: "Once you've identified the highest-performing ads and landing pages, you move to Dedicated Emails. This is where the big results happen — massive, highly targeted audiences with precision. This phase is all about execution with excellence.",
        },
      ],
      closingEmphasis:
        "Start strong with Sponsorships. Scale big with Dedicateds. This is the formula for success.",
    },
    {
      paragraphsHtml: [
        `In the fiercely competitive landscape of affiliate marketing, having an edge is not just a luxury — it's a necessity. That's where {{brand.full}} comes into play, providing you with the tools and resources you need to not just compete, but to ${STRONG("thrive and succeed")}.`,
        `Our edge is delivered through two primary channels: our ${STRONG("proprietary software (Paid Media Suite™)")} and our dedicated ${STRONG("BTS Concierge™")}. These two elements work in perfect harmony to give you a significant advantage.`,
        "As part of {{brand.full}}, you'll have access to the BTS Concierge™ — a dedicated group of top-tier experts who handle the creation of all your marketing materials, saving you countless hours and significant financial resources.",
      ],
      tools: {
        title: "Proprietary Software Suite:",
        items: [
          { name: "Flexy™", desc: "Drag-and-drop landing page app" },
          { name: "MetricMover™", desc: "Create & test hundreds of pages" },
          { name: "DIYTrax™", desc: "URL rotator and tracker" },
          { name: "PixelPress™", desc: "Bulk create & split test banner ads" },
          { name: "Blaze™", desc: "Personal ad server for scaling" },
          { name: "NoEscape™", desc: "Exit pops & tab-overs to boost revenue" },
        ],
      },
    },
    {
      paragraphsHtml: [
        `The final pillar, and perhaps the most critical, is ${STRONG("the commitment")}. Success in affiliate marketing, as in any business, requires a steadfast commitment to your goals and the willingness to put in the necessary work. {{brand.full}} provides you with the tools, the team, and the strategy, but the commitment must come from you.`,
        `Affiliate marketing is not a get-rich-quick scheme. It's a legitimate business model that requires time, effort, and dedication. You must be willing to learn, adapt, and grow. You must be ready to face challenges and overcome obstacles. And most importantly, ${STRONG("you must be committed to taking consistent action towards your goals")}.`,
        "{{brand.full}} is designed to guide you on this journey, providing you with a clear path to follow. But it's up to you to walk that path. It's up to you to make the commitment to your success.",
      ],
    },
  ],
  conclusion: {
    heading: "Conclusion & Next Steps",
    paragraphsHtml: [
      `{{brand.full}} is a comprehensive training program that covers all aspects of affiliate marketing — from the business model to the product, the market, the demographic, the traffic, the edge, and the commitment. It's designed to provide you with a ${STRONG("clear, step-by-step guide to building a successful affiliate marketing business")}.`,
      "But remember, the training program is just a tool. It's a roadmap to success. But you are the driver. You are the one who must take the wheel and steer your business towards your goals.",
    ],
  },
};

/* ------------------------------------------------------------------ */
/* Quick-Start Guide                                                   */
/* ------------------------------------------------------------------ */

const quickStart = {
  heroSubtitle: "Mastering Affiliate Arbitrage with the Build, Test, Scale Framework",
  introParagraphsHtml: [
    `Congratulations on taking the first step toward building a profitable affiliate arbitrage business using direct media buying. This ${STRONG("Quick-Start Guide")} is your ${STRONG("step-by-step roadmap")} through the ${STRONG("{{brand.short}} framework")} — guiding you from your first campaign setup to full-scale profitability.`,
    `Inside, you'll find detailed strategies, key resources, and exclusive tools designed to accelerate your success. You'll also discover how to leverage the power of the <a data-spa href="/community" class="text-[#1a56db] underline hover:no-underline">BTS Community</a>, the BTS Concierge™, the Responsive Rolodex™, and <a data-spa href="/coaching" class="text-[#1a56db] underline hover:no-underline">live coaching calls</a> to remove the guesswork and scale with confidence.`,
    `This isn't just theory — it's a proven system built on ${STRONG("25+ years and $75M in ad spend")} that has generated millions in affiliate commissions. Let's dive in.`,
  ],
  toc: [
    { href: "#framework", label: "Understanding the Build, Test, Scale Framework", items: [] as string[] },
    {
      href: "#step-build",
      label: "Step 1: Build — Setting Up for Success",
      items: [
        "Choosing the Right Affiliate Offer",
        "Conducting Market Research for Winning Angles",
        "Organizing Your Workflow",
        "Building Banner Ads & Landing Pages with {{brand.short}} Tools",
        "Submitting Your Ads for Approval",
      ],
    },
    {
      href: "#step-test",
      label: "Step 2: Test — Launching Your First Campaigns",
      items: [
        "Using the Responsive Rolodex™ for Proven Traffic",
        "Split-Testing Banners within DIYTrax™",
        "Tracking Performance in the P&L Tracker™",
        "Refining Your Offer & Ad Angles",
      ],
    },
    {
      href: "#step-scale",
      label: "Step 3: Scale — Turning Profitable Campaigns into a Full Business",
      items: [
        "Increasing Ad Spend on Winning Placements",
        "Testing Additional Rolodex Placements",
        "Expanding to Dedicated Emails",
      ],
    },
    {
      href: "#support",
      label: "{{brand.short}} Support & Resources",
      items: [
        "The BTS Concierge™ — Done-For-You Ad Creation & Setup",
        "Live Coaching Calls — Expert Guidance 6 Days/Week",
        "The BTS Community — 24/7 Access to Mentors & Peers",
      ],
    },
    { href: "#final-steps", label: "Final Steps — Your Personalized Success Plan", items: [] as string[] },
  ],
  framework: {
    heading: "Understanding the Build, Test, Scale Framework",
    intro:
      "Affiliate arbitrage is simple when you follow the right steps in order. Our proven process follows three key phases:",
    phases: [
      { title: "Build", desc: "Select your offer, conduct research, and create high-converting ads and landing pages." },
      { title: "Test", desc: "Launch ads on pre-vetted publisher traffic inside the Responsive Rolodex™ while split-testing creative." },
      { title: "Scale", desc: "Once profitable, increase ad spend and expand to dedicated emails or new direct buys." },
    ],
    note: "This system ensures that you don't waste money on bad traffic or ineffective creatives — instead, you systematically refine what works and scale only when profitable.",
  },
  build: {
    heading: "Step 1: Build — Setting Up for Success",
    offer: {
      title: "Choosing the Right Affiliate Offer",
      paragraphsHtml: [
        `The best way to start is with a high-converting affiliate offer. We recommend networks like ${STRONG("Media Mavens™")} (exclusive to {{brand.short}} members — 100%+ commissions) and ${STRONG("ClickBank")} (fast approval and high-payout offers).`,
        `To get started, apply for these networks and choose a proven offer that aligns with {{brand.short}} traffic sources. If you need help choosing, ask in our <a data-spa href="/coaching" class="text-[#1a56db] underline hover:no-underline">weekly coaching calls</a> or consult the BTS Concierge™.`,
      ],
    },
    research: {
      title: "Conducting Market Research for Winning Angles",
      intro: "Once you have an offer, you need a unique angle that speaks to the audience:",
      items: [
        "Use spy tools like Anstrex, AdPlexity, and AdBeat to see what ads are running.",
        "Analyze Amazon Reviews of similar products to uncover emotional pain points.",
        "Use AI for brainstorming new hooks and creative approaches.",
      ],
    },
    workflow: {
      title: "Organizing Your Workflow",
      text: "Success requires structure. We recommend using Google Drive to organize your offers, ad creatives, landing page variations, and performance tracking.",
    },
    tools: {
      title: "Building Banner Ads & Landing Pages with {{brand.short}} Tools",
      intro: "Use {{brand.short}} proprietary tools to build your ads efficiently:",
      items: [
        { name: "ScrapeBot™ & CropBot™", desc: "Find & crop high-quality ad images" },
        { name: "Gifster™", desc: "Create animated banner & landing page images" },
        { name: "PixelPress™", desc: "Generate hundreds of banners in minutes" },
        { name: "Flexy™", desc: "Drag-and-drop landing page builder" },
        { name: "DIYTrax™", desc: "Central hub for campaign tracking" },
      ],
      note: "Need help building creatives? The BTS Concierge™ can do it for you!",
    },
  },
  test: {
    heading: "Step 2: Test — Launching Your First Campaigns",
    rolodex: {
      title: "Using the Responsive Rolodex™ for Proven Traffic",
      textHtml: `Instead of guessing where to buy ads, start with pre-vetted, high-converting publishers inside the ${STRONG("Responsive Rolodex™")}. Simply select a Responsive Rolodex™ placement from within DIYTrax™ and launch your first test.`,
    },
    split: {
      title: "Split-Testing Banners Within DIYTrax™",
      items: [
        "Upload multiple banner ads and let DIYTrax™ automatically split-test them.",
        "Optimize by pausing underperformers and increasing spend on top performers.",
      ],
    },
    tracker: {
      title: "Tracking Performance in the P&L Tracker™",
      textHtml: `"If you can't track it, you can't manage it." Use the ${STRONG("P&L Tracker™")} to record ad spend, revenue, and ROI.`,
    },
    refine: {
      title: "Refining Your Offer & Ad Angles",
      intro: "Test different:",
      items: [
        "Hooks for your banner ads",
        "Headlines and images in PixelPress™",
        "Offers from different affiliate networks",
      ],
    },
  },
  scale: {
    heading: "Step 3: Scale — Turning Profitable Campaigns into a Full Business",
    spend: {
      title: "Increasing Ad Spend on Winning Placements",
      textHtml: `Once a campaign is profitable, increase your daily budget on high-performing placements inside the ${STRONG("Responsive Rolodex™")}.`,
    },
    placements: {
      title: "Testing Additional Rolodex Placements",
      textHtml:
        "After you've found success with your initial placements, expand your reach by testing other placements within the Responsive Rolodex™. Each placement represents a unique audience with profit potential. Take your winning creative and systematically test it across multiple Rolodex placements to maximize your campaign's reach and profitability.",
    },
    dedicated: {
      title: "Expanding to Dedicated Emails",
      textHtml:
        "Dedicated emails are the next step after sponsorships. Resize your best-performing ads and run dedicated placements in the Responsive Rolodex™ for bigger returns.",
    },
  },
  support: {
    heading: "{{brand.short}} Support & Resources",
    cards: [
      {
        title: "The BTS Concierge™",
        desc: "Done-for-you ad creation & setup. Our team handles the technical work while you focus on strategy.",
        href: null as string | null,
      },
      {
        title: "Live Coaching Calls",
        desc: "Get expert guidance 6 days/week. Get your questions answered directly by experienced mentors.",
        href: "/coaching",
      },
      {
        title: "The BTS Community",
        desc: "24/7 access to mentors & peers. Share wins, get feedback, and learn from others on the same journey.",
        href: "/community",
      },
    ],
  },
  finalSteps: {
    heading: "Final Steps — Your Personalized Success Plan",
    introHtml: `You now have ${STRONG("everything you need to succeed")}. Here are your next steps:`,
    steps: [
      { text: "Launch your first test campaign using the Responsive Rolodex™", href: null as string | null },
      { text: "Join the next live coaching call", href: "/coaching" },
      { text: "Engage with the BTS Community for support", href: "/community" },
    ],
    closing: "The path is clear — now take action!",
  },
};

/* ------------------------------------------------------------------ */
/* Pillars → Blitz bridge                                              */
/* ------------------------------------------------------------------ */

const pillarsToBlitz = {
  heroTitle: "What The Blitz™ Is — And Why It's Built the Way It Is",
  heroSubtitle: "A bridge from the 7 Pillars™ to your first campaign",
  introParagraphsHtml: [
    `You've just finished the <a data-spa href="/core-training/7-pillars" class="font-semibold text-primary hover:underline">7 Pillars™</a> — the foundation of everything in this business. Now you're about to open ${STRONG("The Blitz™")}, the step-by-step system for actually building and launching your first campaign.`,
    `Before you dive in, it helps to understand what The Blitz is going to ask you to do — and exactly why. ${STRONG("Every major step in The Blitz is a direct application of one of the pillars you just learned.")} Nothing in it is arbitrary. This page connects those dots so the whole system makes sense from the start.`,
  ],
  bridges: [
    {
      num: 1,
      title: "The Business Model — Affiliate Arbitrage",
      quote:
        "Spend less on ads than you earn in commissions. Scale that and the numbers get very big, very fast.",
      body: [
        "The Blitz is built around a short Introduction, then three working phases — Build, Test, and Scale. Build is where you set everything up before spending a dollar on ads. Test is where you run small amounts of traffic to find what works. Scale is where you spend more on the combinations that are already proven profitable. The entire sequence exists for one reason — to find a reliable spread between what you spend on ads and what you earn in commissions. That's the arbitrage. The Blitz is the process of finding it systematically rather than by guessing.",
        "You'll notice The Blitz has strict rules about when you're allowed to move from one phase to the next. Those rules exist to protect the math — you don't scale until the arbitrage is proven.",
      ],
    },
    {
      num: 2,
      title: "The Market — Health & Wellness",
      quote:
        "Traditional supplements and wellness gadgets — two categories that work together beautifully and cover all the bases for people serious about their health.",
      body: [
        "One of your first steps in The Blitz is choosing a product to promote. You'll do this inside one of two affiliate networks — Media Mavens (BTS's in-house network) or ClickBank. Both are stocked with health and wellness products: supplements, gadgets, and wellness devices aimed at the exact market described in Pillar 2. You won't be hunting for a market or a niche — that decision has already been made. Your job is simply to choose a specific product within it.",
      ],
    },
    {
      num: 3,
      title: "The Demographic — Know Your Buyer",
      quote:
        "Approximately 80% of the money that flows through the internet comes from women in their 40s, 50s, and 60s. Health and wellness products aimed at this group convert like nothing else.",
      body: [
        "A significant portion of The Blitz is devoted to creating your marketing materials — the ads people see and the landing pages they arrive at after clicking. The core principle is simple: know exactly who you're writing for before you write a single word. For the majority of health and wellness products in our networks, that person is a woman in her 40s, 50s, or 60s dealing with a real health challenge — joint pain, low energy, sleep issues, stress. She has disposable income, wants something that works, and isn't looking for complicated solutions.",
        "That said, the demographic follows the product. Some offers skew toward a broader or younger audience — a trendy pet gadget, for example, attracts a different buyer than a joint support supplement. The principle from Pillar 3 isn't a rigid rule; it's a reminder to think clearly about who your specific product is actually for, and make sure every headline, image, and landing page speaks directly to that person. Your coach can help you identify the right target if you're unsure.",
      ],
    },
    {
      num: 4,
      title: "The Traffic Channel — Email",
      quote:
        "We're not building our own email list. We're finding the people who already have massive lists and placing our ads inside the emails they send to their subscribers.",
      body: [
        "In The Blitz you'll be running your ads on a platform called Caterpillar — that's the name used throughout the guide to protect the source. Caterpillar is one of the large email publishers described in Pillar 4. When your ad runs there, it's appearing inside emails being sent to large subscriber lists. You're not on Google. You're not on Facebook. You're doing exactly what Pillar 4 described: placing your ad inside someone else's email, reaching their audience.",
        "This is why the channel works the way it does — no algorithm changes, no account bans, warmer traffic because those subscribers already opted in to receive those emails. The advantages described in Pillar 4 are real, and Caterpillar is where you'll experience them firsthand.",
      ],
    },
    {
      num: 5,
      title: "The Strategy — Test with Sponsorships, Scale with Dedicateds",
      quote:
        "Dedicateds are where you want to end up — that's where the big scale happens. But sponsorships are where you test. You don't spend dedicated money until you know what works.",
      body: [
        "The Blitz is built so these stages map directly onto this strategy. During the Test phase, your ads run as sponsorships — your ad appears alongside other content inside an email, at a lower cost per click. This is your testing ground. You run several rounds of tests to find the combination of ad and landing page that works best, while keeping your spend manageable.",
        "Once you've found a profitable combination and run it for 14 or more consecutive profitable days, The Blitz graduates you to what's called the Master Publisher — a dedicated email send where the entire email is your ad, going out to a massive list all at once. That's the dedicated email phase from Pillar 5. It's where the real scale happens — and The Blitz won't let you go there until you've earned it through the data.",
      ],
    },
    {
      num: 6,
      title: "The Edge — Proprietary Software + Your VA Team",
      quote:
        "You don't want to be the one working your business. We are entrepreneurs — not cogs in the machine. The software and the team exist so you can focus on strategy.",
      body: [
        "Throughout the Build phase of The Blitz, you'll use proprietary software built specifically for this system, including Flexy™, MetricMover™, and DIYTrax™. Flexy™ is the tool you'll use to build your landing pages — no coding required. MetricMover™ automatically generates 25 different versions of your landing page by combining your headlines and images, then rotates visitors through all of them to find what converts best. DIYTrax™ is your tracking dashboard — it connects your ads, your landing pages, and your affiliate link, and records exactly which combinations produce sales.",
        "At any step where you'd rather hand off the technical work and stay focused on the bigger picture, BTS Concierge™ — your VA team — can handle it for you. That option is available at every step throughout The Blitz.",
      ],
    },
    {
      num: 7,
      title: "The Commitment — Perseverance over Perfection",
      quote:
        "You're going to have days when you want to throw in the towel. I've been there dozens of times, if not hundreds. What you must cultivate is a tenacity to persevere.",
      body: [
        "The first rounds of testing in The Blitz almost always lose money — and that is completely by design. You are spending money to buy data: to find out which headlines your audience responds to, which images stop the scroll, which landing pages turn visitors into buyers. That information is what makes the later rounds — and eventually the Scale phase — profitable. The early loss is the price of the knowledge, not a sign that something is wrong.",
        "The Blitz has built the mindset pillar into its structure: there are rules about how long to wait before making decisions, checkpoints that prevent you from panicking and changing things too early, and clear instructions on when to ask for help instead of spinning in place. When the early rounds feel discouraging, come back to Pillar 7. This is what it looks like in practice.",
      ],
    },
  ],
  nextSteps: {
    heading: "Before You Start The Blitz™",
    paragraphsHtml: [
      `The ${STRONG("7 Pillars™")} shows you the destination — a profitable campaign scaling with dedicated email blasts. ${STRONG("The Blitz™")} starts you at step one of getting there. The early steps will look nothing like the finished picture, and that's exactly right.`,
      "Every step you take in The Blitz is grounded in one of the pillars you just learned. Trust the process and the destination comes into view.",
    ],
  },
};

/* ------------------------------------------------------------------ */
/* Tips & Tricks                                                       */
/* ------------------------------------------------------------------ */

const tipsAndTricks = {
  intro:
    "Quick wins to level up your campaigns. Browse short, focused walkthroughs on creating images, writing headlines, and other day-to-day workflows.",
  vidalyticsPlayer: "trR5xdVa",
  imageTips: [
    { title: 'Creating Images With Google\'s "Nano Banana"', vidalyticsId: "qgpAV6gDFy_EujDM" },
    { title: "Making Slight Adjustments To Images With Qwen", vidalyticsId: "uZA1qpHWKIw6O4ao" },
    { title: "Creating Animated GIF's With Grok Imagine", vidalyticsId: "urBv1xbiAL6LST5x" },
  ],
  copywritingTips: [
    { title: "Creating Headlines In Specific Styles", vidalyticsId: "smS9hAL9_0kXcPsf" },
    { title: "Creating Native Ad Headlines With Anstrex", vidalyticsId: "ER6QheTSaVmuoMvN" },
  ],
};

export const CURRICULUM_CONTENT: Record<CurriculumPageKey, unknown> = {
  "seven-pillars": sevenPillars,
  "quick-start": quickStart,
  "pillars-to-blitz": pillarsToBlitz,
  "tips-and-tricks": tipsAndTricks,
};

export type SevenPillarsContent = typeof sevenPillars;
export type QuickStartContent = typeof quickStart;
export type PillarsToBlitzContent = typeof pillarsToBlitz;
export type TipsAndTricksContent = typeof tipsAndTricks;
