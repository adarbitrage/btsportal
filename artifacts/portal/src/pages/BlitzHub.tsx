import { useEffect, useState, useCallback, useMemo } from "react";
import { AppLayout } from "@/components/layout/AppLayout";

type Phase = "intro" | "build" | "test" | "scale";
type Tag = { kind: "mm" | "cb" | "all" | "warn"; label: string };

interface HubLesson {
  id: number;
  phase: Phase;
  step: string;
  title: string;
  desc: React.ReactNode;
  tags?: Tag[];
  ctas: { label: string; section: string; secondary?: boolean }[];
}

const LESSONS: HubLesson[] = [
  {
    id: 1, phase: "intro", step: "Introduction",
    title: "What Is Affiliate Arbitrage?",
    desc: "Start here before anything else. This short video explains the business model behind The Blitz™ — how affiliate arbitrage works, and why the Build → Test → Scale framework makes it predictable and scalable. The Key Terms reference guide is also available for any unfamiliar affiliate marketing terms you encounter throughout the guide — bookmark it and use it as needed.",
    ctas: [
      { label: "Watch Video", section: "s1" },
      { label: "Key Terms Reference", section: "s1", secondary: true },
    ],
  },
  {
    id: 2, phase: "intro", step: "Before You Start",
    title: "Understand the System — The Three Phases, Your Budget, and the Phase Gates",
    desc: "Read this entire section before touching any technical setup. It covers how the three phases work, what your money is actually buying in the early rounds, realistic budget expectations including net cost after commissions, and the gates you must pass before advancing to the next phase.",
    ctas: [{ label: "Read Section", section: "s2" }],
  },
  {
    id: 3, phase: "build", step: "Phase 1 — Overview",
    title: "How Phase 1 Works — Campaign Architecture and Your Path",
    desc: "Before jumping into the steps, start here to understand how all the tools and pieces fit together. This section covers the Campaign Architecture diagram (how Caterpillar, Flexy™, DIYTrax, and your affiliate network connect), the Path Decision Tree (which path you're on based on whether your product has a pre-built advertorial), and a full overview of what you'll build across Steps 1–5.",
    tags: [
      { kind: "mm", label: "Path A: Pre-built advertorial → MetricMover™" },
      { kind: "cb", label: "Path B: Jump page template → MetricMover™" },
    ],
    ctas: [{ label: "Go to Phase 1 Overview", section: "s3" }],
  },
  {
    id: 4, phase: "build", step: "Network Selection",
    title: "Choose Your Affiliate Network",
    desc: "Select the network you'll use to find and promote products. Media Mavens is recommended for first campaigns — pre-built advertorials, no chargebacks, higher commissions. Affiliati and MaxWeb require proof of prior affiliate revenue — check with your coach before applying to either.",
    tags: [
      { kind: "mm", label: "Media Mavens ⭐ Recommended" },
      { kind: "cb", label: "ClickBank · MaxWeb · Affiliati" },
    ],
    ctas: [{ label: "Go to Section", section: "s3" }],
  },
  {
    id: 5, phase: "build", step: "Phase 1 — Step 1: Product Selection",
    title: "Select Your Offer and Get Your Affiliate Link",
    desc: "Choose the specific product you'll promote within your network. Save your unique affiliate tracking link. For ClickBank and MaxWeb, confirm the product's sales page URL — you'll refer to it when writing your jump page body copy.",
    tags: [
      { kind: "mm", label: "MM: Look for products with pre-built advertorial" },
      { kind: "cb", label: "CB/MW: Confirm jump page path applies" },
    ],
    ctas: [{ label: "Go to Step 1", section: "s4" }],
  },
  {
    id: 6, phase: "build", step: "Phase 1 — Step 2: Creative Assets",
    title: "Build Your Creative Assets",
    desc: (
      <>
        Create all four asset types your campaign needs: ad headlines and ad image (to earn the click), and landing page headlines and hero shots (to engage and convert). This step begins with a crucial section on <strong>angles</strong> — understanding why you're testing multiple headlines and images at both the ad and landing page level is the foundation of everything that follows. Also covers jump page body copy for ClickBank/MaxWeb.
      </>
    ),
    tags: [
      { kind: "all", label: "10 Ad Headlines + 1 Ad Image" },
      { kind: "mm", label: "MM: 5 LP Headlines + 5 Hero Shots" },
      { kind: "cb", label: "CB/MW: Jump page body copy + 5 LP Headlines + 5 Hero Shots" },
    ],
    ctas: [{ label: "Go to Step 2", section: "s5" }],
  },
  {
    id: 7, phase: "build", step: "Compliance",
    title: "Submit Your Assets for Compliance Review",
    desc: "Before building any pages, submit your headlines, images, and landing page assets to Cherrington Media for compliance review. Typical turnaround is 24–48 hours. You may begin Step 3 (Flexy™ setup) while waiting, but do not go live until approval is confirmed.",
    tags: [{ kind: "warn", label: "Do not go live until compliance is confirmed" }],
    ctas: [{ label: "Compliance Section", section: "s6" }],
  },
  {
    id: 8, phase: "build", step: "Phase 1 — Step 3: Landing Pages",
    title: "Build Your Landing Pages in Flexy™ Using MetricMover™",
    desc: "Clone your Flexy™ website and connect your domain. Media Mavens path: import your advertorial into MetricMover™ and follow MM1–MM13. ClickBank/MaxWeb path: first clone and customize your jump page template in Flexy™ (CF1–CF4), then follow MM1–MM13 to set up MetricMover™. Both paths end with 25 combinations imported into DIYTrax.",
    tags: [
      { kind: "all", label: "MM1–MM13 Video Series" },
      { kind: "mm", label: "MM: Advertorial imported into MetricMover™" },
      { kind: "cb", label: "CB/MW: Jump page template imported into MetricMover™" },
    ],
    ctas: [{ label: "Go to Step 3", section: "s7" }],
  },
  {
    id: 9, phase: "build", step: "Phase 1 — Step 4: DIYTrax Setup",
    title: "Set Up DIYTrax",
    desc: "Configure your campaign tracking system. Create your Campaign Placeholder to generate your tracking link, set up IPN integration if using ClickBank, embed your offer link in landing pages, and import your MetricMover™ page variants. DIYTrax connects every part of your campaign and records which combinations generate sales.",
    tags: [
      { kind: "cb", label: "ClickBank: IPN integration required" },
      { kind: "all", label: "Complete 5-step setup sequence in order" },
    ],
    ctas: [{ label: "Go to Step 4", section: "s8" }],
  },
  {
    id: 10, phase: "build", step: "Phase 1 — Step 5: Go Live",
    title: "Configure Caterpillar and Go Live",
    desc: "Create your campaign in Caterpillar, upload all 10 ad headlines across 2 sub-campaigns of 5 each, upload your ad image, fund your account with at least $500, and complete the pre-launch checklist before activating. Watch T1–T9 in order.",
    tags: [
      { kind: "all", label: "T1–T9 Video Series" },
      { kind: "all", label: "2 Sub-Campaigns × 5 headlines" },
      { kind: "warn", label: "Complete pre-launch checklist before going live" },
    ],
    ctas: [{ label: "Go to Step 5", section: "s9" }],
  },
  {
    id: 11, phase: "test", step: "Round 1 · Min. $500",
    title: "Find Your Top Performing Headline",
    desc: "Run all 10 ads and monitor performance daily. At $25/ad: cut any ad with 33+ clicks but zero landing page clicks. At $500 total: identify the headline with the strongest metrics. Expect ~20% ROAS — you are buying data, not revenue. Set up your P&L Tracker immediately after launch.",
    tags: [{ kind: "all", label: "Target: ~$100 returned (20% ROAS)" }],
    ctas: [{ label: "Go to Round 1", section: "s10" }],
  },
  {
    id: 12, phase: "test", step: "Between Rounds 1 and 2",
    title: "Prepare Additional Static Images While Round 1 Runs",
    desc: "While Round 1 is running, prepare your Round 2 assets. Create 9 new static images in 16:9 format using AI tools. These will compete against your original Round 1 image in Round 2. MM/CB path: also prepare 5 new landing page headlines, 5 new hero shots, and set up a new MetricMover™ project.",
    ctas: [{ label: "Go to Between Rounds", section: "s11" }],
  },
  {
    id: 13, phase: "test", step: "Round 2 · Min. $500",
    title: "Find Your Top Performing Visual Creative",
    desc: "Run 10 static images in 16:9 format — your original plus 9 new ones — all using your Round 1 top performing headline. Identify which visual generates the best return. Target approximately 75% ROAS before advancing to Round 3.",
    tags: [
      { kind: "all", label: "Target: ~$375 returned (75% ROAS)" },
      { kind: "all", label: "All creatives 16:9 static format" },
    ],
    ctas: [{ label: "Go to Round 2", section: "s12" }],
  },
  {
    id: 14, phase: "test", step: "Between Rounds 2 and 3",
    title: "Prepare Your Round 3 Placement Format Assets",
    desc: "Take your Round 2 top performing creative and convert it into all 6 placement formats: 16:9 static image, 9:16 static image, 16:9 GIF, 9:16 GIF, 16:9 video, and 9:16 video. Use Cropbot, Adobe Express, and GIFSTER as needed.",
    ctas: [{ label: "Go to Between Rounds", section: "s13" }],
  },
  {
    id: 15, phase: "test", step: "Round 3 · Min. $1,000",
    title: "Find Your Top Performing Placement Format",
    desc: "Run all 6 placement formats as 6 separate sub-campaigns — one format per sub-campaign, as required by the publisher. Identify which placement format generates the best return. Earning ~$600 on $1,000 means you're closing in on profitability — continue refining until the campaign generates a positive return.",
    tags: [
      { kind: "all", label: "Target: ~$600 returned (60% ROAS)" },
      { kind: "warn", label: "1 placement format per sub-campaign — publisher requirement" },
    ],
    ctas: [{ label: "Go to Round 3", section: "s14" }],
  },
  {
    id: 16, phase: "scale", step: "Method 1",
    title: "Increase Budget on Your Top Performing Placement",
    desc: "Remove non-profitable ads and increase your daily budget 2× on your top performing placement. If ROAS stays stable after 3–5 days, increase to 5×, then 10×. Monitor daily — stop scaling a placement if ROAS declines for 5+ consecutive days.",
    tags: [{ kind: "warn", label: "Only enter Phase 3 once Phase 2 is profitable" }],
    ctas: [{ label: "Go to Scale Module", section: "s15" }],
  },
  {
    id: 17, phase: "scale", step: "Method 2",
    title: "Test New Placements and Publishers",
    desc: "Use your proven ads and landing pages on Grasshopper or Crane publishers — no new creative required. Minimum $1,500 per new placement. See the Grasshopper and Crane Supplemental Guides for setup instructions.",
    ctas: [{ label: "Go to Scale Module", section: "s16" }],
  },
  {
    id: 18, phase: "scale", step: "Method 3",
    title: "Master Publisher",
    desc: "A dedicated email blast to a large subscriber list — dramatically higher reach than native or banner ads. Only available after 14+ consecutive profitable days. Requires a single best headline, image, and landing page. Discuss with your coach before pursuing.",
    tags: [
      { kind: "warn", label: "14+ consecutive profitable days required" },
      { kind: "warn", label: "Coach approval required" },
    ],
    ctas: [{ label: "Go to Scale Module", section: "s17" }],
  },
];

const TOTAL = LESSONS.length;
const STEP_COURSE_PREFIX = "blitz-hub-step-";
const API_BASE = `${import.meta.env.BASE_URL}api`;
const GUIDE_BASE = `${import.meta.env.BASE_URL}blitz/guide`;

const ArrowIcon = () => (
  <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
    <path d="M6 3.5a.5.5 0 0 1 .5-.5h5a.5.5 0 0 1 .5.5v5a.5.5 0 0 1-1 0V4.707L5.354 10.354a.5.5 0 0 1-.708-.708L10.293 4H6.5a.5.5 0 0 1-.5-.5z" />
  </svg>
);

const CheckIcon = () => (
  <svg className="check-icon" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
    <path d="M13.854 3.646a.5.5 0 0 1 0 .708l-7 7a.5.5 0 0 1-.708 0l-3.5-3.5a.5.5 0 1 1 .708-.708L6.5 10.293l6.646-6.647a.5.5 0 0 1 .708 0z" />
  </svg>
);

const HUB_CSS = `
.blitz-hub :where(*) { box-sizing: border-box; }
.blitz-hub {
  --bg: #f5f4f0;
  --card: #ffffff;
  --navy: #0f1e33;
  --text: #1a2030;
  --muted: #64748b;
  --border: #e2e0da;
  --blue2: #3b82f6;
  --green: #15803d;
  --green2: #16a34a;
  --green-bg: #f0fdf4;
  --orange: #c2410c;
  --orange2: #ea580c;
  --orange-bg: #fff7ed;
  --purple: #7c3aed;
  --purple2: #8b5cf6;
  --purple-bg: #faf5ff;
  --complete: #15803d;
  --complete-bg: #dcfce7;
  font-family: 'DM Sans', system-ui, -apple-system, sans-serif;
  background: var(--bg);
  color: var(--text);
  min-height: 100%;
  background-image: url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23c8c5bc' fill-opacity='0.18'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E");
}
.blitz-hub .hero { background: var(--navy); position: relative; overflow: hidden; }
.blitz-hub .hero::before {
  content: ''; position: absolute; inset: 0;
  background:
    radial-gradient(ellipse at 15% 50%, rgba(37,99,235,.25) 0%, transparent 55%),
    radial-gradient(ellipse at 85% 50%, rgba(124,58,237,.2) 0%, transparent 55%);
}
.blitz-hub .hero-inner {
  position: relative; max-width: 860px; margin: 0 auto;
  padding: 28px 24px 24px; text-align: center;
}
.blitz-hub .hero-eyebrow {
  display: inline-flex; align-items: center; gap: 8px;
  font-family: 'DM Mono', ui-monospace, monospace;
  font-size: .72rem; letter-spacing: 3px; text-transform: uppercase;
  color: rgba(255,255,255,.5); margin-bottom: 12px;
}
.blitz-hub .hero-eyebrow span {
  display: inline-block; width: 20px; height: 1px; background: rgba(255,255,255,.3);
}
.blitz-hub .hero-title {
  font-family: 'Bebas Neue', 'Oswald', system-ui, sans-serif;
  font-size: clamp(2.8rem, 8vw, 5rem);
  letter-spacing: 6px; line-height: .95; color: white; margin: 0 0 4px;
}
.blitz-hub .hero-sub {
  font-family: 'Bebas Neue', 'Oswald', system-ui, sans-serif;
  font-size: clamp(1rem, 2.5vw, 1.2rem);
  letter-spacing: 4px; color: rgba(255,255,255,.45); margin-bottom: 14px;
}
.blitz-hub .hero-desc {
  font-size: .95rem; color: rgba(255,255,255,.65); font-weight: 300;
  line-height: 1.6; max-width: 580px; margin: 0 auto 20px;
}
.blitz-hub .hero-desc strong { color: rgba(255,255,255,.9); font-weight: 600; }
.blitz-hub .progress-wrap {
  background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.1);
  border-radius: 16px; padding: 12px 20px; max-width: 580px; margin: 0 auto;
}
.blitz-hub .progress-top {
  display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 10px;
}
.blitz-hub .progress-label {
  font-size: .8rem; font-family: 'DM Mono', ui-monospace, monospace;
  letter-spacing: 1px; text-transform: uppercase; color: rgba(255,255,255,.5);
}
.blitz-hub .progress-count {
  font-family: 'Bebas Neue', 'Oswald', system-ui, sans-serif;
  font-size: 1.1rem; letter-spacing: 2px; color: rgba(255,255,255,.8);
}
.blitz-hub .progress-bar {
  background: rgba(255,255,255,.12); border-radius: 999px; height: 6px; overflow: hidden;
}
.blitz-hub .progress-fill {
  height: 100%; background: linear-gradient(90deg, var(--blue2), #a78bfa);
  border-radius: 999px; transition: width .4s ease;
}
.blitz-hub .progress-pct {
  font-size: .75rem; color: rgba(255,255,255,.4); margin-top: 8px;
  text-align: right; font-family: 'DM Mono', ui-monospace, monospace;
}
.blitz-hub .container {
  max-width: 860px; margin: 0 auto; padding: 48px 24px 80px;
}
.blitz-hub .phase-divider {
  display: flex; align-items: center; gap: 14px; margin: 44px 0 20px;
}
.blitz-hub .phase-divider:first-child { margin-top: 0; }
.blitz-hub .phase-divider::after { content: ''; flex: 1; height: 1px; background: var(--border); }
.blitz-hub .phase-pill {
  display: flex; align-items: center; gap: 8px;
  padding: 6px 18px; border-radius: 30px;
  font-family: 'Bebas Neue', 'Oswald', system-ui, sans-serif;
  font-size: .9rem; letter-spacing: 2px; border: 1.5px solid; white-space: nowrap;
}
.blitz-hub .intro-pill { background: #f8fafc; color: #475569; border-color: #cbd5e1; }
.blitz-hub .intro-pill .phase-num { background: #e2e8f0; color: #475569; }
.blitz-hub .lesson.intro::before { background: #94a3b8; }
.blitz-hub .lesson.intro .lesson-num { background: #f1f5f9; color: #475569; border: 1.5px solid #cbd5e1; }
.blitz-hub .lesson.intro .btn-go { background: #475569; color: white; }
.blitz-hub .phase-pill.build { background: var(--green-bg); color: var(--green); border-color: #bbf7d0; }
.blitz-hub .phase-pill.test { background: var(--orange-bg); color: var(--orange); border-color: #fed7aa; }
.blitz-hub .phase-pill.scale { background: var(--purple-bg); color: var(--purple); border-color: #ddd6fe; }
.blitz-hub .phase-num {
  width: 22px; height: 22px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  font-size: .7rem; font-family: 'DM Mono', ui-monospace, monospace;
}
.blitz-hub .build .phase-num { background: #bbf7d0; color: var(--green); }
.blitz-hub .test .phase-num { background: #fed7aa; color: var(--orange); }
.blitz-hub .scale .phase-num { background: #ddd6fe; color: var(--purple); }
.blitz-hub .lesson {
  background: var(--card); border: 1.5px solid var(--border);
  border-radius: 16px; margin-bottom: 12px; overflow: hidden;
  transition: box-shadow .2s, border-color .2s, transform .15s;
  display: flex; position: relative;
}
.blitz-hub .lesson:hover {
  box-shadow: 0 6px 24px rgba(0,0,0,.08);
  border-color: #c8c5bc; transform: translateY(-1px);
}
.blitz-hub .lesson.completed { background: #fafff9; border-color: #bbf7d0; }
.blitz-hub .lesson.completed::after {
  content: '✓'; position: absolute; top: 16px; right: 16px;
  width: 24px; height: 24px; background: var(--complete-bg); color: var(--complete);
  border-radius: 50%; display: flex; align-items: center; justify-content: center;
  font-size: .8rem; font-weight: 700;
}
.blitz-hub .lesson::before {
  content: ''; display: block; width: 4px; flex-shrink: 0; border-radius: 16px 0 0 16px;
}
.blitz-hub .lesson.build::before { background: var(--green2); }
.blitz-hub .lesson.test::before { background: var(--orange2); }
.blitz-hub .lesson.scale::before { background: var(--purple2); }
.blitz-hub .lesson-inner {
  padding: 22px 24px 22px 20px; display: flex; align-items: flex-start;
  gap: 18px; flex: 1; min-width: 0;
}
.blitz-hub .lesson-num {
  width: 40px; height: 40px; border-radius: 12px;
  display: flex; align-items: center; justify-content: center;
  font-family: 'Bebas Neue', 'Oswald', system-ui, sans-serif;
  font-size: 1.1rem; letter-spacing: 1px; flex-shrink: 0; margin-top: 2px;
}
.blitz-hub .lesson.build .lesson-num { background: var(--green-bg); color: var(--green2); border: 1.5px solid #bbf7d0; }
.blitz-hub .lesson.test .lesson-num { background: var(--orange-bg); color: var(--orange2); border: 1.5px solid #fed7aa; }
.blitz-hub .lesson.scale .lesson-num { background: var(--purple-bg); color: var(--purple2); border: 1.5px solid #ddd6fe; }
.blitz-hub .lesson.completed .lesson-num { background: var(--complete-bg); color: var(--complete); border-color: #86efac; }
.blitz-hub .lesson-content { flex: 1; min-width: 0; }
.blitz-hub .lesson-step {
  font-family: 'DM Mono', ui-monospace, monospace;
  font-size: .68rem; letter-spacing: 1.5px; text-transform: uppercase;
  color: var(--muted); margin-bottom: 4px;
}
.blitz-hub .lesson-title {
  font-size: 1.05rem; font-weight: 700; color: var(--text);
  margin: 0 0 6px; line-height: 1.3;
}
.blitz-hub .lesson.completed .lesson-title { color: #166534; }
.blitz-hub .lesson-desc {
  font-size: .875rem; color: var(--muted); font-weight: 300;
  line-height: 1.6; margin: 0 0 16px;
}
.blitz-hub .lesson-actions {
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
}
.blitz-hub .btn-go {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 8px 18px; border-radius: 8px; font-size: .875rem; font-weight: 600;
  text-decoration: none; transition: all .15s; cursor: pointer; border: none;
}
.blitz-hub .lesson.build .btn-go { background: var(--green2); color: white; }
.blitz-hub .lesson.test .btn-go { background: var(--orange2); color: white; }
.blitz-hub .lesson.scale .btn-go { background: var(--purple2); color: white; }
.blitz-hub .btn-go:hover { opacity: .88; transform: translateX(2px); color: white; }
.blitz-hub .lesson.intro .btn-go:hover { color: white; }
.blitz-hub .btn-go svg { width: 14px; height: 14px; flex-shrink: 0; }
.blitz-hub .btn-complete {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 7px 14px; border-radius: 8px; font-size: .8rem; font-weight: 500;
  cursor: pointer; border: 1.5px solid var(--border); background: transparent;
  color: var(--muted); transition: all .15s;
  font-family: 'DM Sans', system-ui, sans-serif;
}
.blitz-hub .btn-complete:hover:not(:disabled) {
  border-color: var(--complete); color: var(--complete); background: var(--complete-bg);
}
.blitz-hub .btn-complete:disabled { opacity: .6; cursor: wait; }
.blitz-hub .lesson.completed .btn-complete {
  background: var(--complete-bg); border-color: #86efac; color: var(--complete);
}
.blitz-hub .btn-complete .check-icon { width: 14px; height: 14px; }
.blitz-hub .lesson-tags { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 12px; }
.blitz-hub .tag {
  font-size: .68rem; font-family: 'DM Mono', ui-monospace, monospace;
  padding: 2px 9px; border-radius: 8px; border: 1px solid; letter-spacing: .5px;
}
.blitz-hub .tag.mm { background: #f0fdf4; color: #15803d; border-color: #bbf7d0; }
.blitz-hub .tag.cb { background: #fff7ed; color: #c2410c; border-color: #fed7aa; }
.blitz-hub .tag.all { background: #eff6ff; color: #1d4ed8; border-color: #bfdbfe; }
.blitz-hub .tag.warn { background: #fef2f2; color: #991b1b; border-color: #fecaca; }
.blitz-hub .reset-wrap { text-align: center; margin-top: 48px; }
.blitz-hub .btn-reset {
  font-size: .75rem; font-family: 'DM Mono', ui-monospace, monospace;
  letter-spacing: 1px; color: var(--muted); background: none;
  border: 1px solid var(--border); padding: 6px 16px; border-radius: 6px;
  cursor: pointer; transition: color .15s, border-color .15s;
}
.blitz-hub .btn-reset:hover { color: var(--text); border-color: #c8c5bc; }
.blitz-hub .hub-footer {
  background: var(--navy); padding: 28px 24px; text-align: center;
  font-size: .82rem; color: rgba(255,255,255,.35);
  font-family: 'DM Mono', ui-monospace, monospace; letter-spacing: .5px;
}
@media (max-width: 560px) {
  .blitz-hub .lesson-inner { flex-direction: column; gap: 12px; }
  .blitz-hub .lesson-num { width: 34px; height: 34px; }
  .blitz-hub .hero-title { font-size: 3.5rem; }
}
`;

interface ProgressEntry {
  courseId: string;
}

export default function BlitzHub() {
  const [completed, setCompleted] = useState<Set<number>>(new Set());
  const [pending, setPending] = useState<Set<number>>(new Set());

  // Hydrate from server on mount.
  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE}/course-progress`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: ProgressEntry[]) => {
        if (cancelled) return;
        const next = new Set<number>();
        for (const row of rows ?? []) {
          const m = row.courseId?.match(/^blitz-hub-step-(\d+)$/);
          if (m) next.add(Number(m[1]));
        }
        setCompleted(next);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const setBusy = useCallback((id: number, busy: boolean) => {
    setPending((prev) => {
      const next = new Set(prev);
      if (busy) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const toggleComplete = useCallback(
    async (id: number) => {
      const courseId = `${STEP_COURSE_PREFIX}${id}`;
      const wasCompleted = completed.has(id);
      // Optimistic update
      setCompleted((prev) => {
        const next = new Set(prev);
        if (wasCompleted) next.delete(id);
        else next.add(id);
        return next;
      });
      setBusy(id, true);
      try {
        if (wasCompleted) {
          const res = await fetch(
            `${API_BASE}/course-progress/${courseId}`,
            { method: "DELETE", credentials: "include" },
          );
          if (!res.ok) throw new Error("delete failed");
        } else {
          const res = await fetch(`${API_BASE}/course-progress`, {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ courseId }),
          });
          if (!res.ok) throw new Error("post failed");
        }
      } catch {
        // Roll back on failure
        setCompleted((prev) => {
          const next = new Set(prev);
          if (wasCompleted) next.add(id);
          else next.delete(id);
          return next;
        });
      } finally {
        setBusy(id, false);
      }
    },
    [completed, setBusy],
  );

  const resetProgress = useCallback(async () => {
    if (!window.confirm("Reset all progress? This cannot be undone.")) return;
    const previous = new Set(completed);
    const ids = Array.from(previous);
    setCompleted(new Set());
    await Promise.all(
      ids.map((id) =>
        fetch(`${API_BASE}/course-progress/${STEP_COURSE_PREFIX}${id}`, {
          method: "DELETE",
          credentials: "include",
        }).catch(() => null),
      ),
    );
    // Reconcile with server in case any DELETE failed.
    try {
      const res = await fetch(`${API_BASE}/course-progress`, {
        credentials: "include",
      });
      if (res.ok) {
        const rows: ProgressEntry[] = await res.json();
        const next = new Set<number>();
        for (const row of rows ?? []) {
          const m = row.courseId?.match(/^blitz-hub-step-(\d+)$/);
          if (m) next.add(Number(m[1]));
        }
        setCompleted(next);
      } else {
        setCompleted(previous);
      }
    } catch {
      setCompleted(previous);
    }
  }, [completed]);

  const doneCount = completed.size;
  const pct = Math.round((doneCount / TOTAL) * 100);

  const grouped = useMemo(() => {
    const intro = LESSONS.filter((l) => l.phase === "intro");
    const build = LESSONS.filter((l) => l.phase === "build");
    const test = LESSONS.filter((l) => l.phase === "test");
    const scale = LESSONS.filter((l) => l.phase === "scale");
    return { intro, build, test, scale };
  }, []);

  return (
    <AppLayout>
      <style dangerouslySetInnerHTML={{ __html: HUB_CSS }} />
      <link
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:ital,wght@0,300;0,400;0,500;0,600;0,700;1,300&family=DM+Mono:wght@400;500&display=swap"
      />
      <div className="blitz-hub">
        <div className="hero">
          <div className="hero-inner">
            <div className="hero-eyebrow">
              <span></span>Caterpillar Edition<span></span>
            </div>
            <h1 className="hero-title">The Blitz™</h1>
            <div className="hero-sub">Build · Test · Scale</div>
            <p className="hero-desc">
              A <strong>proven, step-by-step system</strong> for launching
              profitable affiliate marketing campaigns. Work through each
              module in order, make decisions based on data, and the results
              will follow.
            </p>
            <div className="progress-wrap">
              <div className="progress-top">
                <span className="progress-label">Your Progress</span>
                <span className="progress-count">
                  {doneCount} / {TOTAL} Complete
                </span>
              </div>
              <div className="progress-bar">
                <div className="progress-fill" style={{ width: `${pct}%` }} />
              </div>
              <div className="progress-pct">{pct}% complete</div>
            </div>
          </div>
        </div>

        <div className="container">
          <PhaseDivider phase="intro" label="Introduction" num="✦" />
          {grouped.intro.map((l) => (
            <LessonCard
              key={l.id}
              lesson={l}
              completed={completed.has(l.id)}
              busy={pending.has(l.id)}
              onToggle={() => toggleComplete(l.id)}
            />
          ))}

          <PhaseDivider phase="build" label="Phase 1 — Build" num="1" />
          {grouped.build.map((l) => (
            <LessonCard
              key={l.id}
              lesson={l}
              completed={completed.has(l.id)}
              busy={pending.has(l.id)}
              onToggle={() => toggleComplete(l.id)}
            />
          ))}

          <PhaseDivider phase="test" label="Phase 2 — Test" num="2" />
          {grouped.test.map((l) => (
            <LessonCard
              key={l.id}
              lesson={l}
              completed={completed.has(l.id)}
              busy={pending.has(l.id)}
              onToggle={() => toggleComplete(l.id)}
            />
          ))}

          <PhaseDivider phase="scale" label="Phase 3 — Scale" num="3" />
          {grouped.scale.map((l) => (
            <LessonCard
              key={l.id}
              lesson={l}
              completed={completed.has(l.id)}
              busy={pending.has(l.id)}
              onToggle={() => toggleComplete(l.id)}
            />
          ))}

          <div className="reset-wrap">
            <button
              type="button"
              className="btn-reset"
              onClick={resetProgress}
              disabled={doneCount === 0}
            >
              Reset Progress
            </button>
          </div>
        </div>

        <div className="hub-footer">
          The Blitz™ — Caterpillar Edition · Cherrington Media · v4.0
        </div>
      </div>
    </AppLayout>
  );
}

function PhaseDivider({
  phase,
  label,
  num,
}: {
  phase: Phase;
  label: string;
  num: string;
}) {
  const cls = phase === "intro" ? "phase-pill intro-pill" : `phase-pill ${phase}`;
  return (
    <div className="phase-divider">
      <div className={cls}>
        <div className="phase-num">{num}</div>
        {label}
      </div>
    </div>
  );
}

function LessonCard({
  lesson,
  completed,
  busy,
  onToggle,
}: {
  lesson: HubLesson;
  completed: boolean;
  busy: boolean;
  onToggle: () => void;
}) {
  return (
    <div className={`lesson ${lesson.phase}${completed ? " completed" : ""}`}>
      <div className="lesson-inner">
        <div className="lesson-num">{lesson.id}</div>
        <div className="lesson-content">
          <div className="lesson-step">{lesson.step}</div>
          <h3 className="lesson-title">{lesson.title}</h3>
          <p className="lesson-desc">{lesson.desc}</p>
          {lesson.tags && lesson.tags.length > 0 && (
            <div className="lesson-tags">
              {lesson.tags.map((t, i) => (
                <span key={i} className={`tag ${t.kind}`}>
                  {t.label}
                </span>
              ))}
            </div>
          )}
          <div className="lesson-actions">
            {lesson.ctas.map((cta, i) => (
              <a
                key={i}
                href={`${GUIDE_BASE}/${lesson.id}${i > 0 ? `#${cta.section}` : ""}`}
                className="btn-go"
                style={cta.secondary ? { background: "#475569" } : undefined}
              >
                <ArrowIcon />
                {cta.label}
              </a>
            ))}
            <button
              type="button"
              className="btn-complete"
              onClick={onToggle}
              disabled={busy}
            >
              <CheckIcon />
              {completed ? "✓ Completed" : "Mark as Complete"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
