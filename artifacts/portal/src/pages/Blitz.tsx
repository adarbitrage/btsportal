import { useState, useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { useRoute, Link } from "wouter";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Zap, Printer, ChevronLeft, ChevronRight } from "lucide-react";
import {
  BLITZ_SECTIONS,
  BLITZ_SECTION_COUNT,
  BLITZ_SECTION_BY_ID,
  BLITZ_BODY_HTML,
  buildBlitzCourseId,
  type BlitzPhaseKey,
} from "@workspace/blitz-curriculum";

// Lesson id → guide display label. The section anchor, phase, and total count
// all come from the shared @workspace/blitz-curriculum source of truth; only
// these chrome labels are specific to this guide surface.
export const LESSON_LABELS: Record<number, string> = {
  1: "Introduction",
  2: "Before You Start — What You Need to Know",
  3: "Phase 1 — Overview",
  4: "Network Selection",
  5: "Phase 1 — Product Selection",
  6: "Phase 1 — Creative Assets · Foundation",
  7: "Phase 1 — Create Your Native Ad Assets",
  8: "Phase 1 — Landing Page Assets · Media Mavens",
  9: "Phase 1 — Landing Page Assets · ClickBank",
  10: "Phase 1 — Compliance Review",
  11: "Phase 1 — Setting Up Your Website in Flexy™",
  12: "Phase 1 — DIYTrax Setup",
  13: "Phase 1 — Using MetricMover™",
  14: "Phase 1 — Go Live",
  15: "Phase 2 — Overview",
  16: "Phase 2 · Round 1",
  17: "Between Rounds 1 & 2",
  18: "Phase 2 · Round 2",
  19: "Between Rounds 2 & 3",
  20: "Phase 2 · Round 3",
  21: "Phase 3 · Method 1 — Scale Budget",
  22: "Phase 3 · Method 2 — New Placements",
  23: "Phase 3 · Method 3 — Master Publisher",
};

// Lesson id → section anchor + display label, derived from the shared skeleton.
const LESSON_LOOKUP: Record<number, { section: string; label: string }> =
  Object.fromEntries(
    BLITZ_SECTIONS.map((s) => [
      s.id,
      { section: s.sectionAnchor, label: LESSON_LABELS[s.id] ?? s.title },
    ]),
  );

// Total lessons, used for the header "Lesson X of Y" progress marker.
const TOTAL_LESSONS = BLITZ_SECTION_COUNT;

// Short titles for the large prev/next pager buttons — the full LESSON_LOOKUP
// labels are too long to fit. Indexed by lesson id (all 23).
export const LESSON_SHORT_TITLES: Record<number, string> = {
  1: "Introduction",
  2: "Before You Start",
  3: "Phase 1 Overview",
  4: "Network Selection",
  5: "Product Selection",
  6: "Creative Assets",
  7: "Native Ad Assets",
  8: "Landing Pages · Media Mavens",
  9: "Landing Pages · ClickBank",
  10: "Compliance Review",
  11: "Website Setup (Flexy™)",
  12: "DIYTrax Setup",
  13: "Using MetricMover™",
  14: "Go Live",
  15: "Phase 2 Overview",
  16: "Round 1",
  17: "Between Rounds 1 & 2",
  18: "Round 2",
  19: "Between Rounds 2 & 3",
  20: "Round 3",
  21: "Scale Budget",
  22: "New Placements",
  23: "Master Publisher",
};

// Phase of a lesson, used to color the pager by its DESTINATION phase so the
// color shifts at phase transitions. Lessons 1–2 are the intro (neutral),
// 3–14 Phase 1 (build), 15–20 Phase 2 (test), 21–23 Phase 3 (scale).
type LessonPhase = BlitzPhaseKey;
function lessonPhase(id: number): LessonPhase {
  return BLITZ_SECTION_BY_ID[id]?.phase ?? "intro";
}

// Pager button styling per phase: solid Av2 phase fill + darker border +
// white eyebrow/arrow/title, matching the lesson-hub phase treatment. Intro
// uses a unified dark slate (matches the hub intro tint). Full literal class
// strings so Tailwind's JIT detects them.
const PHASE_PAGER_CLASSES: Record<LessonPhase, { card: string; eyebrow: string; title: string }> = {
  intro: { card: "border-slate-700 bg-slate-600 hover:bg-slate-700", eyebrow: "text-white/90", title: "text-white" },
  build: { card: "border-[#136b38] bg-[#188f4a] hover:bg-[#136b38]", eyebrow: "text-white/90", title: "text-white" },
  test: { card: "border-[#a03f07] bg-[#cf550a] hover:bg-[#a03f07]", eyebrow: "text-white/90", title: "text-white" },
  scale: { card: "border-[#641f9e] bg-[#7f2ac9] hover:bg-[#641f9e]", eyebrow: "text-white/90", title: "text-white" },
};

// The Phase 1 overview (#module1-overview, section s3) is its own top-level
// module and is filtered by the generic data-section pass. Module1 now wraps
// only steps 1 & 2 (#blitz-step1, #blitz-step2) under one data-section
// attribute. To deep-link cleanly we override visibility of those inner divs
// at runtime per lesson-section. Keys are LESSON_LOOKUP section values that
// should render part (or all) of module1; sections not listed here let module1
// fall through to the default data-section filter (which will hide it).
// Step 2 (Creative Assets) is split into four lessons. Each sub-block of
// #blitz-step2 (#step2-overview, #step2-native, #step2-mm, #step2-cb) is
// shown for its corresponding lesson section.
type Step2Parts = {
  overview: boolean;
  native: boolean;
  mm: boolean;
  cb: boolean;
};
const ALL_STEP2: Step2Parts = { overview: true, native: true, mm: true, cb: true };
const NO_STEP2: Step2Parts = { overview: false, native: false, mm: false, cb: false };
const MODULE1_OVERRIDES: Record<
  string,
  {
    showModule1: boolean;
    showStep1: boolean;
    showStep2: boolean;
    step2Parts: Step2Parts;
  }
> = {
  s5: { showModule1: true, showStep1: true, showStep2: false, step2Parts: NO_STEP2 },
  s6: { showModule1: true, showStep1: false, showStep2: true, step2Parts: { overview: true, native: false, mm: false, cb: false } },
  s6b: { showModule1: true, showStep1: false, showStep2: true, step2Parts: { overview: false, native: true, mm: false, cb: false } },
  s6c: { showModule1: true, showStep1: false, showStep2: true, step2Parts: { overview: false, native: false, mm: true, cb: false } },
  s6d: { showModule1: true, showStep1: false, showStep2: true, step2Parts: { overview: false, native: false, mm: false, cb: true } },
  s7: { showModule1: false, showStep1: false, showStep2: false, step2Parts: NO_STEP2 },
  s8: { showModule1: false, showStep1: false, showStep2: false, step2Parts: NO_STEP2 },
  s8b: { showModule1: false, showStep1: false, showStep2: false, step2Parts: NO_STEP2 },
  s9: { showModule1: false, showStep1: false, showStep2: false, step2Parts: NO_STEP2 },
  s10: { showModule1: false, showStep1: false, showStep2: false, step2Parts: NO_STEP2 },
};
void ALL_STEP2;

// Source: attached_assets/blitz_main_caterpillar_110_1778523623764.html (v4.0, 2026-04-21)
// Generated by artifacts/api-server/src/scripts/build-blitz-from-html.ts

const blitzCSS = `.blitz-content{
    --primary:hsl(221 80% 48%); --accent:hsl(221 80% 48%); --success:#15803d; --warning:#b45309; --danger:#b91c1c;
    --bg:hsl(40 25% 97%); --card:hsl(0 0% 100%); --border:hsl(40 18% 88%); --text:hsl(0 0% 15%); --muted:hsl(0 0% 40%);
    --mm-color:#166534; --mm-bg:#f0fdf4; --mm-border:#86efac;
    --cb-color:#92400e; --cb-bg:#fff7ed; --cb-border:#fcd34d;
    --cat-color:#6b21a8; --cat-bg:#faf5ff;
  }
  .blitz-content h1, .blitz-content h2, .blitz-content h3, .blitz-content h4, .blitz-content h5, .blitz-content h6, .blitz-content p, .blitz-content ul, .blitz-content ol, .blitz-content li, .blitz-content figure, .blitz-content blockquote, .blitz-content dl, .blitz-content dd{box-sizing:border-box;margin:0;padding:0;}
  .blitz-content{font-family:'Roboto',system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:var(--bg);color:var(--text);line-height:1.8;font-size:17px;}

  .blitz-content .page-header{background:var(--primary);color:white;padding:0 32px 20px;text-align:center;}
  .blitz-content .page-header h1{font-size:3rem;margin-bottom:8px;letter-spacing:-0.5px;}
  .blitz-content .page-header .tagline{opacity:.85;font-size:.95rem;max-width:600px;margin:0 auto 12px;line-height:1.5;}
  .blitz-content .pub-badge{display:inline-flex;align-items:center;gap:8px;background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.25);border-radius:30px;padding:6px 18px;font-size:.85rem;margin-bottom:8px;}
  .blitz-content .supp-note{font-size:.9rem;opacity:.75;margin-top:10px;}
  .blitz-content .supp-note a{color:#93c5fd;}

  .blitz-content nav.toc{background:var(--primary);border-top:1px solid rgba(255,255,255,.1);padding:0 20px;display:flex;gap:2px;flex-wrap:wrap;justify-content:center;}
  .blitz-content nav.toc a{color:rgba(255,255,255,.75);text-decoration:none;font-size:.9rem;padding:12px 14px;border-bottom:3px solid transparent;white-space:nowrap;transition:all .15s;}
  .blitz-content nav.toc a:hover{color:white;border-color:var(--accent);}

  .blitz-content .container{max-width:960px;margin:0 auto;padding:8px 28px 100px;}

  .blitz-content .module{margin-bottom:72px;margin-top:0;max-width:960px;margin-left:auto;margin-right:auto;padding-left:28px;padding-right:28px;}
  .blitz-content.full-guide #blitz-step1,.blitz-content.full-guide #step2-overview,.blitz-content.full-guide #step2-native,.blitz-content.full-guide #step2-mm{margin-bottom:72px;}
  .blitz-content .module-header{display:flex;flex-direction:column;align-items:flex-start;gap:8px;margin-bottom:10px;padding-bottom:16px;border-bottom:2px solid var(--border);}
  .blitz-content .mod-badge{background:var(--primary);color:white;font-size:.82rem;font-weight:800;letter-spacing:1.5px;text-transform:uppercase;padding:7px 18px;border-radius:20px;white-space:nowrap;}
  .blitz-content .mod-badge.build{background:#188f4a;} .blitz-content .mod-badge.test{background:#cf550a;} .blitz-content .mod-badge.scale{background:#7f2ac9;}
  .blitz-content .mod-badge.intro{background:#475569;}
  .blitz-content .module-header h2{font-size:1.9rem;color:var(--primary);letter-spacing:-0.3px;}
  .blitz-content .module-intro{background:#f0f4ff;border-left:4px solid var(--accent);border-radius:0 8px 8px 0;padding:18px 22px;margin-bottom:28px;font-size:1.05rem;color:#1e3a6e;line-height:1.75;}

  .blitz-content h3{font-size:1.3rem;color:var(--primary);margin:36px 0 12px;font-weight:700;}
  .blitz-content h4{font-size:1rem;font-weight:700;color:#374151;margin:22px 0 10px;text-transform:uppercase;letter-spacing:.5px;}
  .blitz-content p{margin-bottom:16px;}
  .blitz-content ul, .blitz-content ol{margin:10px 0 18px 24px;} .blitz-content li{margin-bottom:9px;font-size:1rem;}

  .blitz-content .path-tag{display:inline-block;vertical-align:middle;font-size:.75rem;font-weight:700;letter-spacing:.5px;text-transform:uppercase;padding:3px 10px;border-radius:4px;margin-right:4px;}
  .blitz-content .tag-mm{background:var(--mm-bg);color:var(--mm-color);border:1px solid var(--mm-border);}
  .blitz-content .tag-cb{background:var(--cb-bg);color:var(--cb-color);border:1px solid var(--cb-border);}
  .blitz-content .tag-cat{background:var(--cat-bg);color:var(--cat-color);border:1px solid #d8b4fe;}
  .blitz-content .tag-all{background:#f1f5f9;color:#334155;border:1px solid #cbd5e1;}

  .blitz-content .path-block{border-left:4px solid;border-radius:0 8px 8px 0;padding:20px 24px;margin:20px 0;}
  .blitz-content .path-block.mm{border-color:var(--mm-color);background:var(--mm-bg);}
  .blitz-content .path-block.cb{border-color:var(--cb-color);background:var(--cb-bg);}
  .blitz-content .path-block-label{font-size:.75rem;font-weight:800;letter-spacing:1px;text-transform:uppercase;margin-bottom:12px;}
  .blitz-content .path-block.mm .path-block-label{color:var(--mm-color);}
  .blitz-content .path-block.cb .path-block-label{color:var(--cb-color);}

  .blitz-content .card{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:24px 28px;margin-bottom:20px;}
  .blitz-content .card-title{font-weight:700;font-size:.85rem;text-transform:uppercase;letter-spacing:.5px;margin-bottom:14px;color:var(--muted);}

  .blitz-content table{width:100%;border-collapse:collapse;margin:16px 0;font-size:.97rem;}
  .blitz-content th{background:var(--primary);color:white;text-align:left;padding:12px 16px;font-size:.85rem;}
  .blitz-content td{padding:12px 16px;border-bottom:1px solid var(--border);vertical-align:top;}
  .blitz-content tr:nth-child(even) td{background:#f8f9fb;}
  .blitz-content tr.total-row td{font-weight:700;background:#f0f4ff;border-top:2px solid var(--accent);}

  .blitz-content .alert{border-radius:10px;padding:18px 22px;margin:18px 0;font-size:1rem;}
  .blitz-content .alert.info{background:#eff6ff;border:1px solid #93c5fd;color:#1e40af;}
  .blitz-content .alert.warning{background:#fff7ed;border:1px solid #fcd34d;color:#92400e;}
  .blitz-content .alert.danger{background:#fef2f2;border:1px solid #fca5a5;color:#b91c1c;}
  .blitz-content .alert.success{background:#f0fdf4;border:1px solid #86efac;color:#166534;}
  .blitz-content .alert strong{display:block;margin-bottom:6px;font-size:.8rem;text-transform:uppercase;letter-spacing:.5px;}

  .blitz-content .callout-box{background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:18px 22px;margin:14px 0 20px;font-size:1rem;}
  .blitz-content .callout-box .pe-label{font-size:.75rem;font-weight:800;letter-spacing:1px;text-transform:uppercase;color:#92400e;margin-bottom:8px;}

  .blitz-content .why-box{background:#f0f9ff;border:1px solid #bae6fd;border-radius:10px;padding:18px 22px;margin:14px 0;font-size:1rem;color:#0c4a6e;}
  .blitz-content .why-box .why-label{font-weight:800;font-size:.75rem;letter-spacing:1px;text-transform:uppercase;margin-bottom:6px;color:#0369a1;}

  .blitz-content .checklist{list-style:none;margin:0;padding:0;}
  .blitz-content .checklist li{display:flex;align-items:flex-start;gap:12px;padding:11px 0;border-bottom:1px solid var(--border);font-size:1rem;line-height:1.6;}
  .blitz-content .checklist li:last-child{border-bottom:none;}
  .blitz-content .checklist li::before{content:"☐";font-size:1.1rem;color:var(--accent);margin-top:1px;flex-shrink:0;}

  .blitz-content .video-slot{background:#1e2533;border-radius:10px;padding:20px 22px;display:flex;align-items:center;gap:16px;margin:12px 0;color:#e2e8f0;font-size:1rem;cursor:pointer;position:relative;}
  .blitz-content .play-icon{width:42px;height:42px;min-width:42px;background:var(--accent);border-radius:50%;display:flex;align-items:center;justify-content:center;}
  .blitz-content .play-icon::after{content:"▶";font-size:.8rem;margin-left:3px;}
  .blitz-content .vt{font-weight:600;margin-bottom:3px;font-size:1rem;} .blitz-content .vd{color:#94a3b8;font-size:.88rem;}

  /* Video review-status badge. Add data-status="ready" or data-status="needs-rerecord"
     to a .video-slot to mark it; absence of the attribute = unreviewed. */
  .blitz-content .video-slot::after{
    position:absolute; top:8px; right:10px;
    font-size:.68rem; font-weight:700; letter-spacing:.04em;
    padding:2px 7px; border-radius:999px; line-height:1.4;
    content:"? UNREVIEWED"; color:#cbd5e1; background:#334155; border:1px solid #475569;
  }
  .blitz-content .video-slot[data-status="ready"]::after{
    content:"✓ READY"; color:#052e1a; background:#6ee7b7; border-color:#34d399;
  }
  .blitz-content .video-slot[data-status="needs-rerecord"]::after{
    content:"⚠ RE-RECORD"; color:#3b1d05; background:#fbbf24; border-color:#f59e0b;
  }
  .blitz-content .video-slot[data-status="incorrect-link"]::after{
    content:"✗ WRONG LINK"; color:#fff; background:#ef4444; border-color:#dc2626;
  }
  .blitz-content .video-slot[data-status="awaiting-link"]::after{
    content:"⏳ AWAITING LINK"; color:#fff; background:#3b82f6; border-color:#2563eb;
  }
  .blitz-content .video-slot[data-status="needs-blur"]::after{
    content:"🔒 NEEDS BLUR"; color:#fff; background:#a855f7; border-color:#9333ea;
  }

  .blitz-content .roadmap{display:grid;grid-template-columns:1fr 40px 1fr 40px 1fr;align-items:stretch;margin:28px 0;}
  @media(max-width:600px){.blitz-content .roadmap{grid-template-columns:1fr;} .blitz-content .roadmap-arrow{display:none;}}
  .blitz-content .roadmap-phase{background:var(--card);border:2px solid var(--border);border-radius:14px;padding:24px;text-align:center;}
  .blitz-content .roadmap-phase.p1{border-color:#188f4a;} .blitz-content .roadmap-phase.p2{border-color:#cf550a;} .blitz-content .roadmap-phase.p3{border-color:#7f2ac9;}
  .blitz-content .roadmap-arrow{display:flex;align-items:center;justify-content:center;color:var(--muted);font-size:1.5rem;}
  .blitz-content .ph-num{font-size:.72rem;font-weight:800;letter-spacing:1px;text-transform:uppercase;color:var(--muted);margin-bottom:6px;}
  .blitz-content .ph-title{font-weight:800;font-size:1.2rem;margin-bottom:8px;}
  .blitz-content .roadmap-phase.p1 .ph-title{color:#188f4a;} .blitz-content .roadmap-phase.p2 .ph-title{color:#cf550a;} .blitz-content .roadmap-phase.p3 .ph-title{color:#7f2ac9;}
  .blitz-content .ph-desc{font-size:.9rem;color:var(--muted);line-height:1.55;}

  .blitz-content .gate{border:2px solid;border-radius:12px;padding:20px 24px;margin:16px 0;}
  .blitz-content .gate.pass{border-color:#86efac;background:var(--mm-bg);} .blitz-content .gate.fail{border-color:#fca5a5;background:#fef2f2;}
  .blitz-content .gate-header{font-weight:800;font-size:1rem;margin-bottom:10px;}
  .blitz-content .gate.pass .gate-header{color:var(--success);} .blitz-content .gate.fail .gate-header{color:var(--danger);}

  .blitz-content .milestone{display:flex;overflow:hidden;border-radius:10px;border:1px solid var(--border);margin:18px 0;}
  .blitz-content .ms-item{flex:1;padding:18px 12px;text-align:center;border-right:1px solid var(--border);font-size:.88rem;background:var(--card);}
  .blitz-content .ms-item:last-child{border-right:none;}
  .blitz-content .ms-amount{font-weight:800;font-size:1.1rem;color:var(--primary);margin-bottom:6px;}
  .blitz-content .ms-do{color:var(--muted);line-height:1.5;}

  .blitz-content .network-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin:16px 0;}
  @media(max-width:560px){.blitz-content .network-grid{grid-template-columns:1fr;}}
  .blitz-content .net-card{border:2px solid var(--border);border-radius:12px;padding:20px 22px;}
  .blitz-content .net-card .net-name{font-weight:700;font-size:1.1rem;margin-bottom:10px;}
  .blitz-content .net-card .net-desc{font-size:.97rem;color:var(--muted);line-height:1.6;}
  .blitz-content .net-card ul{margin:10px 0 0 18px;font-size:.95rem;}

  .blitz-content .method-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin:16px 0;}
  @media(max-width:640px){.blitz-content .method-grid{grid-template-columns:1fr;}}
  .blitz-content .method-card{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:20px;}
  .blitz-content .method-card .mc-num{font-size:.72rem;font-weight:800;letter-spacing:1px;text-transform:uppercase;color:var(--muted);margin-bottom:8px;}
  .blitz-content .method-card h4{font-size:1rem;margin:0 0 10px;text-transform:none;letter-spacing:0;color:var(--primary);}
  .blitz-content .method-card p{font-size:.95rem;color:var(--muted);margin:0;}

  .blitz-content .support-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin:16px 0;}
  @media(max-width:760px){.blitz-content .support-grid{grid-template-columns:repeat(2,1fr);}}
  @media(max-width:480px){.blitz-content .support-grid{grid-template-columns:1fr;}}
  .blitz-content .support-card{background:var(--card);border:1px solid var(--border);border-radius:10px;padding:18px;font-size:.97rem;}
  .blitz-content .support-card .sc-type{font-weight:700;margin-bottom:8px;color:var(--primary);font-size:1rem;}

  .blitz-content .glossary{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin:16px 0;}
  @media(max-width:600px){.blitz-content .glossary{grid-template-columns:1fr;}}
  .blitz-content .gloss-item{background:var(--card);border:1px solid var(--border);border-radius:10px;padding:18px 20px;}
  .blitz-content .gloss-term{font-weight:700;font-size:1rem;color:var(--primary);margin-bottom:6px;}
  .blitz-content .gloss-def{font-size:.95rem;color:var(--muted);line-height:1.6;}

  .blitz-content .step-list{list-style:none;margin:0;padding:0;}
  .blitz-content .step-list>li{display:flex;gap:16px;margin-bottom:20px;align-items:flex-start;}
  .blitz-content .step-num{width:32px;height:32px;min-width:32px;background:var(--primary);color:white;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:.85rem;font-weight:700;margin-top:2px;}
  .blitz-content .step-body{flex:1;font-size:1rem;} .blitz-content .step-body strong{display:block;margin-bottom:4px;}

  .blitz-content .divider{border:none;border-top:1px solid var(--border);margin:40px 0;}

  .blitz-content .back-to-top{
    position: fixed;
    bottom: 32px;
    right: 32px;
    background: var(--primary);
    color: white;
    border: none;
    border-radius: 50px;
    padding: 12px 20px;
    font-size: .85rem;
    font-weight: 700;
    cursor: pointer;
    box-shadow: 0 4px 14px rgba(0,0,0,.25);
    display: none;
    align-items: center;
    gap: 7px;
    text-decoration: none;
    transition: background .15s, transform .15s;
    z-index: 999;
  }
  .blitz-content .back-to-top:hover{ background: var(--accent); transform: translateY(-2px); }
  .blitz-content .back-to-top.visible{ display: flex; }
  .blitz-content /* VERSION BANNER */
  .version-banner{background:#0f1e33;color:#cbd5e1;font-size:.75rem;padding:5px 20px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;border-bottom:1px solid rgba(255,255,255,.08);}
  .blitz-content .version-banner .vb-left{display:flex;gap:14px;align-items:center;flex-wrap:wrap;}
  .blitz-content .version-banner .vb-tag{background:var(--accent);color:white;font-weight:800;letter-spacing:.5px;text-transform:uppercase;padding:2px 10px;border-radius:10px;font-size:.7rem;}
  .blitz-content .version-banner a{color:#93c5fd;text-decoration:none;}
  .blitz-content .version-banner a:hover{text-decoration:underline;}
  .blitz-content .print-btn{background:var(--accent);color:white;border:none;border-radius:6px;padding:6px 14px;font-size:.78rem;font-weight:700;cursor:pointer;text-transform:uppercase;letter-spacing:.4px;}
  .blitz-content .print-btn:hover{background:#1e5fc4;}
  .blitz-content .mod-badge.print{background:#4b5563;}
  .blitz-content .mod-badge.changelog{background:#0369a1;}

  .blitz-content /* PRINT STYLESHEET */
  @media print{
    @page { size: letter; margin: 0.6in 0.55in 0.7in; }
    body { background:#fff !important; color:#000 !important; font-size:11pt; line-height:1.5; }
    .version-banner { background:#fff !important; color:#000 !important; border-bottom:1px solid #000; padding:6px 0; font-size:9pt; }
    .version-banner .vb-tag { background:#000 !important; color:#fff !important; }
    .version-banner a { color:#000 !important; text-decoration:none; }
    .print-btn, .back-to-top, nav.toc { display:none !important; }
    .page-header { background:#fff !important; color:#000 !important; padding:0 0 16pt; text-align:left; border-bottom:2pt solid #000; }
    .page-header h1 { font-size:22pt; color:#000; }
    .page-header .tagline { color:#333; font-size:11pt; }
    .pub-badge { background:#f0f0f0 !important; color:#000 !important; border:1px solid #000 !important; }
    .supp-note, .supp-note a { color:#333 !important; }
    .container { max-width:100%; padding:0; margin:0; }
    .module { page-break-inside:auto; margin-bottom:24pt; }
    .module-header h2 { color:#000; font-size:16pt; }
    .mod-badge { background:#000 !important; color:#fff !important; }
    .module-intro { background:#f4f4f4 !important; color:#000 !important; border-left:3pt solid #000; page-break-inside:avoid; }
    h3 { color:#000; font-size:13pt; page-break-after:avoid; }
    h4 { color:#000; }
    .card, .callout-box, .why-box, .alert, .gate, .net-card, .path-block, .support-card, .method-card, .gloss-item, .roadmap-phase {
      background:#fff !important; border:1pt solid #999 !important; color:#000 !important; page-break-inside:avoid;
    }
    .alert.danger, .alert.warning, .alert.info, .alert.success { background:#f4f4f4 !important; color:#000 !important; }
    .path-block.mm, .path-block.cb { background:#fafafa !important; border-left:3pt solid #000 !important; }
    .path-tag { background:#eee !important; color:#000 !important; border:1px solid #999 !important; }
    table { page-break-inside:avoid; }
    th { background:#000 !important; color:#fff !important; }
    td { color:#000 !important; }
    tr:nth-child(even) td { background:#f8f8f8 !important; }
    .video-slot { background:#fff !important; color:#000 !important; border:1pt dashed #666 !important; padding:10pt 12pt; }
    .video-slot .vt { color:#000; font-weight:700; }
    .video-slot .vt::before { content:"▶ VIDEO: "; font-weight:700; }
    .video-slot .vd { color:#444 !important; font-size:9.5pt; }
    .play-icon { display:none; }
    .checklist li::before { content:"☐"; color:#000; }
    .gate.pass { border:1.5pt solid #000 !important; }
    .gate.fail { border:1.5pt dashed #000 !important; }
    .gate.pass .gate-header::before { content:"PASS — "; }
    .gate.fail .gate-header::before { content:"FAIL — "; }
    a { color:#000; text-decoration:underline; }
    a[href^="http"]::after { content:" (" attr(href) ")"; font-size:9pt; color:#555; }
    a[href^="#"]::after, a[href$=".html"]::after { content:""; }
  }

  .blitz-content /* ── VIDALYTICS LIGHTBOX ── */
  .video-slot{ cursor: pointer; transition: opacity .15s, transform .15s; }
  .blitz-content .video-slot:hover{ opacity: .88; transform: translateY(-1px); }
  .blitz-content .video-slot:hover .play-icon{ background: var(--accent); transform: scale(1.08); }
  .blitz-content .play-icon{ transition: background .15s, transform .15s; }

  .blitz-content .vd-lightbox-overlay{
    display: none;
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,.82);
    z-index: 9999;
    align-items: center;
    justify-content: center;
    padding: 20px;
  }
  .blitz-content .vd-lightbox-overlay.active{ display: flex; }
  .blitz-content .vd-lightbox-inner{
    position: relative;
    width: 100%;
    max-width: 900px;
    background: #000;
    border-radius: 10px;
    overflow: hidden;
    box-shadow: 0 20px 60px rgba(0,0,0,.6);
  }
  .blitz-content .vd-lightbox-close{
    position: absolute;
    top: 8px;
    right: 8px;
    background: rgba(0,0,0,.55);
    border: none;
    color: white;
    font-size: 1.6rem;
    cursor: pointer;
    line-height: 1;
    padding: 2px 10px;
    border-radius: 6px;
    opacity: .85;
    z-index: 20;
  }
  .blitz-content .vd-lightbox-close:hover{ opacity: 1; background: rgba(0,0,0,.75); }
  .blitz-content .vd-lightbox-fullscreen{
    position: absolute;
    top: 10px;
    right: 52px;
    background: rgba(0,0,0,.55);
    border: none;
    color: white;
    font-size: 1.35rem;
    cursor: pointer;
    line-height: 1;
    padding: 4px 10px;
    border-radius: 6px;
    opacity: .85;
    z-index: 20;
  }
  .blitz-content .vd-lightbox-fullscreen:hover{ opacity: 1; background: rgba(0,0,0,.75); }
  /* When the lightbox-inner is the fullscreen element, paint a solid
     background behind the 16:9 video so the surrounding area isn't white,
     and pin the close/fullscreen buttons inside the viewport (the original
     top:-38px puts them above the visible area in fullscreen). */
  .blitz-content .vd-lightbox-inner:fullscreen{
    width: 100vw;
    max-width: 100vw;
    height: 100vh;
    border-radius: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #000;
  }
  .blitz-content .vd-lightbox-inner:fullscreen .vd-lightbox-video{
    width: min(100vw, calc(100vh * 16 / 9));
    padding-top: 0;
    aspect-ratio: 16 / 9;
  }
  .blitz-content .vd-lightbox-inner:fullscreen .vd-lightbox-close{
    top: 12px;
    right: 16px;
  }
  .blitz-content .vd-lightbox-inner:fullscreen .vd-lightbox-fullscreen{
    top: 12px;
    right: 56px;
  }
  .blitz-content .vd-lightbox-video{
    width: 100%;
    position: relative;
    padding-top: 56.25%;
  }
  .blitz-content .vd-lightbox-video > div, .blitz-content .vd-lightbox-video > div[id^="vidalytics_embed"]{
    position: absolute !important;
    inset: 0 !important;
    width: 100% !important;
    height: 100% !important;
    padding-top: 0 !important;
  }
  .blitz-content .vd-no-video{
    padding: 40px;
    text-align: center;
    color: #94a3b8;
    font-size: 1rem;
  }

  .blitz-content /* ── SECTION ROUTING ── */
  .section-hidden{ display: none !important; }
  .blitz-content .section-nav-bar{
    position: sticky;
    top: 0;
    z-index: 100;
    background: var(--primary);
    padding: 10px 20px;
    display: flex;
    align-items: center;
    gap: 12px;
    border-bottom: 1px solid rgba(255,255,255,.1);
    font-size: .875rem;
  }
  .blitz-content .section-nav-bar a{
    color: rgba(255,255,255,.7);
    text-decoration: none;
    padding: 5px 12px;
    border-radius: 6px;
    border: 1px solid rgba(255,255,255,.2);
    transition: all .15s;
  }
  .blitz-content .section-nav-bar a:hover{ background: rgba(255,255,255,.1); color: white; }
  .blitz-content .section-nav-bar .snb-title{
    color: white;
    font-weight: 600;
    flex: 1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* ===== Portal restyle overrides (light banners to match site) ===== */
  .blitz-content .page-header{background:var(--card);color:var(--text);border-bottom:1px solid var(--border);}
  .blitz-content .page-header h1{color:var(--text);}
  .blitz-content .page-header .tagline{color:var(--muted);opacity:1;}
  .blitz-content .pub-badge{background:var(--bg);border:1px solid var(--border);color:var(--muted);}
  .blitz-content .supp-note{color:var(--muted);opacity:1;}
  .blitz-content .supp-note a{color:var(--accent);}

  .blitz-content nav.toc{background:transparent;border:none;}
  .blitz-content nav.toc a{color:var(--muted);}
  .blitz-content nav.toc a:hover{color:var(--text);border-color:var(--accent);}

  .blitz-content th{background:hsl(40 15% 94%);color:var(--text);border-bottom:2px solid var(--border);}
  .blitz-content tr:nth-child(even) td{background:var(--bg);}

  .blitz-content .section-nav-bar{background:var(--card);border-bottom:1px solid var(--border);}
  .blitz-content .section-nav-bar a{color:var(--muted);border:1px solid var(--border);}
  .blitz-content .section-nav-bar a:hover{background:var(--bg);color:var(--text);}
  .blitz-content .section-nav-bar .snb-title{color:var(--text);}

  .blitz-content .version-banner{background:hsl(40 15% 94%);color:var(--muted);border-bottom:1px solid var(--border);}
  .blitz-content .version-banner a{color:var(--accent);}

  /* Layout: fill width + left-align to match portal (AppLayout already centers/pads) */
  .blitz-content{background:transparent;font-size:1rem;line-height:1.7;}
  .blitz-content .container{max-width:none;margin:0;padding:0 0 48px;}
  .blitz-content .module{max-width:none;margin-left:0;margin-right:0;padding-left:0;padding-right:0;}
  .blitz-content .page-header{text-align:left;padding:0 0 20px;border-bottom:none;}
  .blitz-content .page-header h1{font-size:1.875rem;margin-bottom:6px;}
  .blitz-content .page-header .tagline{margin:0 0 12px;max-width:48rem;}
  .blitz-content .pub-badge{margin-bottom:12px;}
  .blitz-content .module-header.welcome-header .wh-top{display:flex;align-items:center;flex-wrap:wrap;gap:12px;}
  .blitz-content .phase-jump{display:flex;align-items:center;gap:10px;flex-wrap:wrap;}
  .blitz-content .phase-jump a.phase-pill{display:inline-flex;align-items:center;border-radius:9999px;border:1px solid transparent;padding:6px 16px;font-size:.8rem;font-weight:600;letter-spacing:.03em;text-transform:uppercase;color:#fff;text-decoration:none;white-space:nowrap;}
  .blitz-content .phase-jump a.phase-pill:hover{color:#fff;opacity:.88;}
  .blitz-content .phase-jump a.phase-pill .pp-arrow{width:14px;height:14px;margin-left:6px;flex-shrink:0;}
  .blitz-content .phase-jump a.phase-pill.build{background:#188f4a;border-color:#136b38;}
  .blitz-content .phase-jump a.phase-pill.test{background:#cf550a;border-color:#a03f07;}
  .blitz-content .phase-jump a.phase-pill.scale{background:#7f2ac9;border-color:#641f9e;}
  .blitz-content .version-banner{padding:5px 0;}`;

// The Blitz guide body HTML now lives in the shared @workspace/blitz-curriculum
// package so the backend can parse the SAME source to derive the video -> lessons
// map. Re-exported here unchanged so the portal render path and VideoReview keep
// importing `blitzBodyHTML` from this module.
export const blitzBodyHTML = BLITZ_BODY_HTML;

const SECTION_BAR_CSS = `
.blitz-section-bar {
  position: sticky; top: 0; z-index: 50;
  background: hsl(0 0% 100%); color: hsl(0 0% 15%);
  border-bottom: 1px solid hsl(40 18% 88%);
  padding: 10px 24px;
  display: flex; align-items: center; justify-content: space-between; gap: 16px;
  font-family: 'Roboto', system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
.blitz-section-bar .bsb-title { font-size: .98rem; font-weight: 600; letter-spacing: .2px; }
.blitz-section-bar .bsb-actions { display: flex; gap: 8px; flex-shrink: 0; }
.blitz-section-bar .bsb-btn {
  display: inline-flex; align-items: center; gap: 6px;
  background: hsl(40 25% 97%); color: hsl(0 0% 15%);
  border: 1px solid hsl(40 18% 88%); border-radius: 6px;
  padding: 7px 14px; font-size: .85rem; font-weight: 500;
  text-decoration: none; cursor: pointer; transition: background .15s;
}
.blitz-section-bar .bsb-btn:hover { background: hsl(40 15% 94%); color: hsl(0 0% 15%); }
.blitz-section-bar .bsb-btn.primary { background: hsl(221 80% 48%); border-color: hsl(221 80% 48%); color: #fff; }
.blitz-section-bar .bsb-btn.primary:hover { background: hsl(221 80% 42%); color: #fff; }
@media (max-width: 640px) {
  .blitz-section-bar { flex-direction: column; align-items: stretch; }
  .blitz-section-bar .bsb-title { text-align: center; }
  .blitz-section-bar .bsb-actions { justify-content: center; }
}
.blitz-content.section-filtered .page-header,
.blitz-content.section-filtered nav.toc,
.blitz-content.section-filtered .phase-jump,
.blitz-content.section-filtered .version-banner { display: none !important; }
.blitz-content.section-filtered .module { margin-bottom: 16px; }
.blitz-content.full-guide .page-header,
.blitz-content.full-guide .version-banner { display: none !important; }
`;

const BLITZ_API_BASE = `${import.meta.env.BASE_URL}api`;

function ArrowLeftIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M11.5 8a.5.5 0 0 1-.5.5H5.707l2.147 2.146a.5.5 0 0 1-.708.708l-3-3a.5.5 0 0 1 0-.708l3-3a.5.5 0 1 1 .708.708L5.707 7.5H11a.5.5 0 0 1 .5.5z" />
    </svg>
  );
}

export default function Blitz() {
  const [contentEl, setContentEl] = useState<HTMLDivElement | null>(null);
  const [match, params] = useRoute<{ lessonId: string }>("/blitz/guide/:lessonId");

  const lessonId = match ? Number(params?.lessonId) : null;
  const lesson = lessonId && LESSON_LOOKUP[lessonId] ? LESSON_LOOKUP[lessonId] : null;
  const isSectionView = !!lesson;
  const prevId = lessonId != null && lessonId > 1 ? lessonId - 1 : null;
  const nextId = lessonId != null && lessonId < TOTAL_LESSONS ? lessonId + 1 : null;
  // Large bottom pager data, color-coded by destination phase.
  const prevPager = prevId ? PHASE_PAGER_CLASSES[lessonPhase(prevId)] : null;
  const nextPager = nextId ? PHASE_PAGER_CLASSES[lessonPhase(nextId)] : null;

  // Bumped every time a content node attaches. The section filter below stores
  // the content node in `contentEl` state purely to (re)trigger its layout
  // effect, but React bails out of `setContentEl(node)` when the same node
  // object is re-attached (Object.is-equal). That happens on a remount that
  // reuses the host DOM node — so the tick guarantees the effect re-runs (and
  // re-establishes its filter + MutationObserver) against the current node.
  // (The primary defense against React silently rebuilding the body's innerHTML
  // is the MutationObserver inside the filter effect; this tick covers the
  // remount-reuse case where the ref re-fires with the same node.)
  const [mountTick, setMountTick] = useState(0);
  const setRef = useCallback((el: HTMLDivElement | null) => {
    setContentEl(el);
    if (el) setMountTick((t) => t + 1);
  }, []);

  // ── VIEW TRACKING ─────────────────────────────────────────────────────────
  // Rate-limit: max one viewed event per minute per lesson across navigations.
  const lastViewedAt = useRef<Map<number, number>>(new Map());
  const scrollPctRef = useRef(0);

  // Fire a "viewed" event when a lesson section is opened.
  useEffect(() => {
    if (!lessonId || !lesson) return;
    const now = Date.now();
    const lastAt = lastViewedAt.current.get(lessonId) ?? 0;
    if (now - lastAt < 60_000) return;
    lastViewedAt.current.set(lessonId, now);
    fetch(`${BLITZ_API_BASE}/blitz/events`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        courseId: buildBlitzCourseId(lessonId),
        eventType: "viewed",
      }),
    }).catch(() => {});
  }, [lessonId, lesson]);

  // Flush scroll position to the API (every ~10 s and on unmount).
  useEffect(() => {
    if (!lessonId || !lesson) return;
    const courseId = buildBlitzCourseId(lessonId);

    const handleScroll = () => {
      const total = document.body.scrollHeight - window.innerHeight;
      if (total <= 0) return;
      scrollPctRef.current = Math.min(
        100,
        Math.round((window.scrollY / total) * 100),
      );
    };

    const flush = () => {
      const pct = scrollPctRef.current;
      if (pct <= 0) return;
      fetch(`${BLITZ_API_BASE}/blitz/events`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ courseId, eventType: "viewed", scrollPositionPct: pct }),
      }).catch(() => {});
      try {
        sessionStorage.setItem(`blitz-scroll-${lessonId}`, String(pct));
      } catch { /* storage unavailable */ }
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    const interval = setInterval(flush, 10_000);

    return () => {
      window.removeEventListener("scroll", handleScroll);
      clearInterval(interval);
      flush();
    };
  }, [lessonId, lesson]);

  // Restore saved scroll position when reopening a lesson.
  // Runs after layout (useEffect, not useLayoutEffect) so the section filter's
  // scroll-to-top has already executed, and this overrides it only when a saved
  // position exists.
  useEffect(() => {
    if (!lessonId || !lesson || !contentEl) return;
    let saved: string | null = null;
    try {
      saved = sessionStorage.getItem(`blitz-scroll-${lessonId}`);
    } catch { /* storage unavailable */ }
    if (!saved) return;
    const pct = Number(saved);
    if (isNaN(pct) || pct < 3) return; // Skip near-top positions.
    const timer = setTimeout(() => {
      const total = document.body.scrollHeight - window.innerHeight;
      if (total > 0) {
        window.scrollTo({ top: Math.round((pct / 100) * total), behavior: "smooth" });
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [lessonId, lesson, contentEl]);
  // ── END VIEW TRACKING ─────────────────────────────────────────────────────

  // Filter modules by section. Runs synchronously before paint to avoid flash
  // of full content.
  //
  // Why the MutationObserver below is required: the guide body is injected via
  // `dangerouslySetInnerHTML` with a constant string. React owns that subtree,
  // and when an unrelated async re-render commits (most notably the
  // content-access guard's query resolving ~100-600ms after mount), React
  // re-applies the innerHTML — silently replacing every module with a fresh,
  // *unfiltered* copy. It does this WITHOUT recreating the host node (so the
  // ref callback never re-fires and `contentEl`/`mountTick` don't change) and
  // WITHOUT re-running this effect. The result was the reported bug: a
  // single-lesson URL briefly filtering correctly, then snapping back to the
  // full guide. So we re-apply the filter every time React rebuilds the body.
  useLayoutEffect(() => {
    if (!contentEl) return;
    const root = contentEl;

    const applyFilter = () => {
      const modules = root.querySelectorAll<HTMLElement>(".module[data-section]");
      if (!isSectionView || !lesson) {
        modules.forEach((m) => { m.style.display = ""; });
        root
          .querySelectorAll<HTMLElement>("hr.divider")
          .forEach((d) => { d.style.display = ""; });
        return;
      }
      const wanted = lesson.section;
      modules.forEach((m) => {
        const sections = (m.getAttribute("data-section") || "").split(/\s+/).filter(Boolean);
        m.style.display = sections.includes(wanted) ? "" : "none";
      });

      // Module1 wraps two logical sub-sections (step 1 + step 2) under a single
      // data-section, so apply explicit per-section overrides to control its
      // outer + inner visibility. (The overview is now its own top-level module
      // and is handled by the generic data-section pass above.)
      const m1 = root.querySelector<HTMLElement>("#module1");
      const m1Steps = root.querySelector<HTMLElement>("#module1-steps");
      const m1Step1 = root.querySelector<HTMLElement>("#blitz-step1");
      const m1Step2 = root.querySelector<HTMLElement>("#blitz-step2");
      const s2Overview = root.querySelector<HTMLElement>("#step2-overview");
      const s2Native = root.querySelector<HTMLElement>("#step2-native");
      const s2MM = root.querySelector<HTMLElement>("#step2-mm");
      const s2CB = root.querySelector<HTMLElement>("#step2-cb");
      const ovr = MODULE1_OVERRIDES[wanted];
      if (ovr) {
        if (m1) m1.style.display = ovr.showModule1 ? "" : "none";
        if (m1Steps) {
          m1Steps.style.display = ovr.showStep1 || ovr.showStep2 ? "" : "none";
        }
        if (m1Step1) m1Step1.style.display = ovr.showStep1 ? "" : "none";
        if (m1Step2) m1Step2.style.display = ovr.showStep2 ? "" : "none";
        if (s2Overview) s2Overview.style.display = ovr.step2Parts.overview ? "" : "none";
        if (s2Native) s2Native.style.display = ovr.step2Parts.native ? "" : "none";
        if (s2MM) s2MM.style.display = ovr.step2Parts.mm ? "" : "none";
        if (s2CB) s2CB.style.display = ovr.step2Parts.cb ? "" : "none";
      } else {
        // Lesson section unrelated to module1 — restore inner defaults so a
        // later switch back into module1 starts from a clean slate.
        if (m1Steps) m1Steps.style.display = "";
        if (m1Step1) m1Step1.style.display = "";
        if (m1Step2) m1Step2.style.display = "";
        if (s2Overview) s2Overview.style.display = "";
        if (s2Native) s2Native.style.display = "";
        if (s2MM) s2MM.style.display = "";
        if (s2CB) s2CB.style.display = "";
      }

      // Trailing dividers: an <hr class="divider"> with no visible content
      // after it renders as a redundant grey bar stacked on top of the
      // pager's own top border. Reset all, then hide only the trailing ones.
      const dividers = Array.from(
        root.querySelectorAll<HTMLElement>("hr.divider"),
      );
      dividers.forEach((d) => {
        d.style.display = "";
      });
      const isShown = (el: HTMLElement) =>
        !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
      const contentEls = Array.from(
        root.querySelectorAll<HTMLElement>(
          "p,h1,h2,h3,h4,h5,h6,ul,ol,table,figure,blockquote,img,.card,.callout-box,.why-box,.alert,.path-block,.video-slot,.checklist,.module-intro",
        ),
      );
      dividers.forEach((d) => {
        const hasVisibleAfter = contentEls.some(
          (el) =>
            Boolean(
              d.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING,
            ) && isShown(el),
        );
        if (!hasVisibleAfter) d.style.display = "none";
      });
    };

    applyFilter();

    // Scroll to top on section switch (only on the initial filter pass, not on
    // every re-apply, so a background rebuild doesn't yank the user's scroll).
    if (isSectionView) window.scrollTo({ top: 0, behavior: "auto" });

    // Re-apply whenever React rebuilds the body (see header comment). The filter
    // only mutates inline `style` attributes, which never trigger this
    // childList observer, so there is no feedback loop; we re-run only when the
    // module/container nodes themselves are added or removed.
    const containsModuleNode = (list: NodeList) =>
      Array.from(list).some(
        (n) =>
          n.nodeType === 1 &&
          ((n as HTMLElement).classList?.contains("module") ||
            (n as HTMLElement).classList?.contains("container") ||
            !!(n as HTMLElement).querySelector?.(".module[data-section]")),
      );
    const observer = new MutationObserver((records) => {
      const rebuilt = records.some(
        (r) =>
          r.type === "childList" &&
          (containsModuleNode(r.addedNodes) || containsModuleNode(r.removedNodes)),
      );
      if (rebuilt) applyFilter();
    });
    observer.observe(root, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [contentEl, mountTick, isSectionView, lesson]);

  // Wire up the Vidalytics video lightbox. The source HTML uses inline
  // onclick="blitzOpenVideo(id)" handlers, but the build script strips the
  // <script> blocks (and the onclick attrs) since they don't execute via
  // dangerouslySetInnerHTML. We re-implement the behavior here with React-
  // friendly delegated event listeners on the content root.
  useEffect(() => {
    if (!contentEl) return;
    const VD_ACCOUNT = "trR5xdVa";
    const overlay = contentEl.querySelector<HTMLElement>("#vdLightbox");
    const container = contentEl.querySelector<HTMLElement>("#vdVideoContainer");
    const closeBtn = contentEl.querySelector<HTMLElement>("#vdClose");
    const fsBtn = contentEl.querySelector<HTMLElement>("#vdFullscreen");
    const inner = overlay?.querySelector<HTMLElement>(".vd-lightbox-inner") ?? null;
    if (!overlay || !container) return;

    // Re-parent the overlay to <body> so its `position: fixed` is always
    // viewport-relative. When it lives inside .blitz-content, an ancestor with
    // `transform`/`filter`/`will-change` (set by the AppLayout shell on the
    // long full-guide page) creates a containing block, which causes the
    // modal to render offscreen while the body-scroll lock still applies.
    // Wrap in a `.blitz-content` div so the existing scoped CSS still applies.
    const originalParent = overlay.parentNode;
    const originalNextSibling = overlay.nextSibling;
    const portalWrapper = document.createElement("div");
    portalWrapper.className = "blitz-content";
    portalWrapper.setAttribute("data-blitz-lightbox-portal", "");
    portalWrapper.appendChild(overlay);
    document.body.appendChild(portalWrapper);

    // Track scripts owned by THIS lightbox instance — both the inline bootstrap
    // we insert next to the embed div, and the loader/player scripts the
    // bootstrap IIFE appends to <head>. We tag the latter with a data-owner
    // attribute via a MutationObserver scoped to the open/close lifecycle.
    const ownedScripts = new Set<HTMLScriptElement>();
    let headObserver: MutationObserver | null = null;

    const removeOwnedScripts = () => {
      ownedScripts.forEach((s) => s.parentNode?.removeChild(s));
      ownedScripts.clear();
    };

    const open = (videoId: string) => {
      container.innerHTML = "";
      if (!videoId || videoId.startsWith("VIDEO_ID_")) {
        container.innerHTML =
          '<div class="vd-no-video" style="padding:40px;text-align:center;color:#94a3b8;">&#9888; Video not yet connected.<br><small>This video has not been uploaded to Vidalytics yet.</small></div>';
        overlay.classList.add("active");
        document.body.style.overflow = "hidden";
        return;
      }

      // Standard Vidalytics JS embed (matches the working GHL bootstrap exactly).
      // The loader.min.js + player.min.js are served at the per-video URL:
      // https://fast.vidalytics.com/embeds/{account}/{videoId}/loader.min.js
      const embedId = `vidalytics_embed_${videoId}`;
      const baseUrl = `https://fast.vidalytics.com/embeds/${VD_ACCOUNT}/${videoId}/`;

      const div = document.createElement("div");
      div.id = embedId;
      div.style.cssText = "width:100%;position:relative;padding-top:56.25%;";
      container.appendChild(div);

      // Use the standard inline IIFE embed pattern from the Vidalytics
      // dashboard. The player.min.js searches the DOM for a <script> element
      // whose source code mentions the embed id (`vidalytics_embed_<videoId>`)
      // — an external loader.min.js <script> tag fails that lookup and the
      // player throws MEDIA_ERR_SRC_NOT_SUPPORTED. Inlining the IIFE so the
      // embed id is in the script's textContent fixes it.
      // Watch <head> for the loader/player scripts the IIFE appends, so we can
      // claim ownership of them and remove only those on close.
      headObserver?.disconnect();
      headObserver = new MutationObserver((records) => {
        for (const r of records) {
          r.addedNodes.forEach((n) => {
            if (
              n.nodeType === 1 &&
              (n as HTMLElement).tagName === "SCRIPT" &&
              ((n as HTMLScriptElement).src || "").includes("vidalytics.com")
            ) {
              ownedScripts.add(n as HTMLScriptElement);
            }
          });
        }
      });
      headObserver.observe(document.head, { childList: true });

      const script = document.createElement("script");
      script.type = "text/javascript";
      script.text =
        "(function(v,i,d,a,l,y,t,c,s){y='_'+d.toLowerCase();c=d+'L';if(!v[d]){v[d]={};}if(!v[c]){v[c]={};}if(!v[y]){v[y]={};}var vl='Loader',vli=v[y][vl],vsl=v[c][vl+'Script'],vlf=v[c][vl+'Loaded'],ve='Embed';if(!vsl){vsl=function(u,cb){if(t){cb();return;}s=i.createElement('script');s.type='text/javascript';s.async=1;s.src=u;if(s.readyState){s.onreadystatechange=function(){if(s.readyState==='loaded'||s.readyState=='complete'){s.onreadystatechange=null;vlf=1;cb();}};}else{s.onload=function(){vlf=1;cb();};}i.getElementsByTagName('head')[0].appendChild(s);};}vsl(l+'loader.min.js',function(){if(!vli){var vlc=v[c][vl];vli=new vlc();}vli.loadScript(l+'player.min.js',function(){var vec=v[d][ve];t=new vec();t.run(a);});});})(window,document,'Vidalytics'," +
        JSON.stringify(embedId) + "," + JSON.stringify(baseUrl) + ");";
      // Insert as DOM sibling immediately after the embed div so the player's
      // script-discovery walks find it.
      div.parentNode?.insertBefore(script, div.nextSibling);
      ownedScripts.add(script);

      overlay.classList.add("active");
      document.body.style.overflow = "hidden";
    };

    const close = () => {
      overlay.classList.remove("active");
      container.innerHTML = "";
      document.body.style.overflow = "";
      headObserver?.disconnect();
      headObserver = null;
      // Reset Vidalytics globals so the next open() bootstraps fresh, and
      // remove ONLY the scripts this lightbox owns (never wildcard-delete).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const w = window as any;
      try { delete w.Vidalytics; } catch { /* ignore */ }
      try { delete w.VidalyticsL; } catch { /* ignore */ }
      removeOwnedScripts();
    };

    const onContentClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      const slot = target?.closest<HTMLElement>(".video-slot[data-vidalytics-id]");
      if (!slot) return;
      e.preventDefault();
      open(slot.dataset.vidalyticsId || "");
    };

    const onOverlayClick = (e: MouseEvent) => {
      if (e.target === overlay) close();
    };

    const toggleFullscreen = () => {
      if (!inner) return;
      // Browsers reject requestFullscreen if the lightbox isn't visible —
      // guard so the keyboard shortcut is a no-op when the modal is closed.
      if (!overlay.classList.contains("active")) return;
      const fsEl = document.fullscreenElement;
      if (fsEl) {
        document.exitFullscreen?.().catch(() => { /* user-gesture / permission denied */ });
      } else {
        inner.requestFullscreen?.().catch(() => { /* user-gesture / permission denied */ });
      }
    };

    const onKey = (e: KeyboardEvent) => {
      if (!overlay.classList.contains("active")) return;
      if (e.key === "Escape") {
        // Browser handles ESC for fullscreen exit automatically; only close
        // the lightbox when we aren't in fullscreen mode.
        if (!document.fullscreenElement) close();
        return;
      }
      if (e.key === "f" || e.key === "F") {
        // Don't hijack typing inside form fields.
        const t = e.target as HTMLElement | null;
        const tag = t?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || t?.isContentEditable) return;
        e.preventDefault();
        toggleFullscreen();
      }
    };

    document.addEventListener("click", onContentClick);
    overlay.addEventListener("click", onOverlayClick);
    closeBtn?.addEventListener("click", close);
    fsBtn?.addEventListener("click", toggleFullscreen);
    document.addEventListener("keydown", onKey);

    return () => {
      document.removeEventListener("click", onContentClick);
      overlay.removeEventListener("click", onOverlayClick);
      closeBtn?.removeEventListener("click", close);
      fsBtn?.removeEventListener("click", toggleFullscreen);
      document.removeEventListener("keydown", onKey);
      // Exit fullscreen on unmount so a route-change while fullscreened
      // doesn't leave the user stuck on a torn-down element.
      if (document.fullscreenElement === inner) {
        document.exitFullscreen?.().catch(() => { /* ignore */ });
      }
      // Full teardown: if the lightbox unmounts while open (e.g. route change),
      // tear down the player + remove owned scripts + reset globals.
      close();
      // Restore the overlay to its original location in the React-rendered DOM
      // so the next mount finds it via contentEl.querySelector again. Guard
      // against the case where React has already torn down or replaced the
      // original parent / next-sibling (e.g. on route change or HMR) — in
      // that situation just drop the overlay along with portalWrapper; the
      // next mount renders a fresh one via dangerouslySetInnerHTML.
      try {
        if (originalParent && (originalParent as Node).isConnected) {
          if (originalNextSibling && originalNextSibling.parentNode === originalParent) {
            originalParent.insertBefore(overlay, originalNextSibling);
          } else {
            originalParent.appendChild(overlay);
          }
        }
      } catch {
        /* DOM gone — let portalWrapper.remove() handle the rest */
      }
      portalWrapper.remove();
    };
  }, [contentEl]);

  // Trigger anchor scroll after filtering when a hash is present (e.g. /blitz/guide/3#s4 from secondary CTAs).
  useEffect(() => {
    if (!isSectionView) return;
    const hash = window.location.hash.replace("#", "");
    if (!hash) return;
    const t = window.setTimeout(() => {
      const el = document.getElementById(hash);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 50);
    return () => window.clearTimeout(t);
  }, [isSectionView, lessonId]);

  // Deep-link resume: read ?t=<seconds> and auto-open the first video in the
  // section, then seek to the saved position. Falls back gracefully if there's
  // no video slot or the player doesn't expose a seekable <video> element.
  useEffect(() => {
    if (!contentEl || !isSectionView) return;
    const params = new URLSearchParams(window.location.search);
    const tRaw = params.get("t");
    if (!tRaw) return;
    const seekTo = Number(tRaw);
    if (!Number.isFinite(seekTo) || seekTo <= 0) return;

    // Wait for the section content to settle, then auto-open the first video.
    let seekTimer: number | undefined;
    const openTimer = window.setTimeout(() => {
      const firstSlot = contentEl.querySelector<HTMLElement>(
        ".video-slot[data-vidalytics-id]",
      );
      if (!firstSlot) return;
      firstSlot.click();

      // Poll for the <video> element that Vidalytics inserts into the lightbox,
      // then seek to the saved position. Give up after ~8s.
      let attempts = 0;
      const maxAttempts = 32;
      seekTimer = window.setInterval(() => {
        attempts++;
        const vid = document.querySelector<HTMLVideoElement>(
          "[data-blitz-lightbox-portal] video, #vdVideoContainer video",
        );
        if (vid && vid.readyState >= 1) {
          try { vid.currentTime = seekTo; } catch { /* ignore */ }
          window.clearInterval(seekTimer);
          return;
        }
        if (attempts >= maxAttempts) window.clearInterval(seekTimer);
      }, 250);
    }, 200);

    return () => {
      window.clearTimeout(openTimer);
      if (seekTimer !== undefined) window.clearInterval(seekTimer);
    };
  }, [contentEl, isSectionView, lessonId]);

  // ─── TEMP: video review-status counter ─────────────────────────────────────
  // REMOVE BEFORE GO-LIVE. Renders a small floating tally of video tiles by
  // data-status. Self-contained: delete this entire block and the
  // `data-status="..."` attributes on .video-slot elements to fully revert.
  useEffect(() => {
    if (!contentEl) return;
    const badge = document.createElement("div");
    badge.id = "vd-review-counter";
    badge.style.cssText =
      "position:fixed;bottom:14px;right:14px;z-index:9998;background:#0f172a;color:#e2e8f0;border:1px solid #334155;border-radius:10px;padding:8px 12px;font:600 12px/1.4 system-ui,sans-serif;box-shadow:0 6px 20px rgba(0,0,0,.35);pointer-events:none;letter-spacing:.02em;";
    document.body.appendChild(badge);
    const update = () => {
      const slots = contentEl.querySelectorAll<HTMLElement>(".video-slot");
      let ready = 0, redo = 0, wrong = 0, awaiting = 0, blur = 0, unrev = 0;
      slots.forEach((s) => {
        const st = s.getAttribute("data-status");
        if (st === "ready") ready++;
        else if (st === "needs-rerecord") redo++;
        else if (st === "incorrect-link") wrong++;
        else if (st === "awaiting-link") awaiting++;
        else if (st === "needs-blur") blur++;
        else unrev++;
      });
      badge.innerHTML =
        `<span style="color:#cbd5e1">${unrev} unreviewed</span> · ` +
        `<span style="color:#6ee7b7">${ready} ready</span> · ` +
        `<span style="color:#fbbf24">${redo} re-record</span> · ` +
        `<span style="color:#fca5a5">${wrong} wrong link</span> · ` +
        `<span style="color:#93c5fd">${awaiting} awaiting link</span> · ` +
        `<span style="color:#d8b4fe">${blur} needs blur</span>`;
    };
    update();
    const obs = new MutationObserver(update);
    obs.observe(contentEl, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-status"] });
    return () => { obs.disconnect(); badge.remove(); };
  }, [contentEl]);
  // ─── END TEMP ──────────────────────────────────────────────────────────────

  return (
    <AppLayout>
      <style dangerouslySetInnerHTML={{ __html: blitzCSS + SECTION_BAR_CSS }} />
      <div className="mb-6">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 mb-2">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 shrink-0">
              <Zap className="w-6 h-6 text-primary" />
              <h1 className="text-3xl font-bold">The Blitz™</h1>
            </div>
            {isSectionView && lesson && (
              <div className="inline-flex items-center gap-0.5 rounded-full border border-border bg-muted/50 p-0.5">
                {prevId ? (
                  <Link
                    href={`/blitz/guide/${prevId}`}
                    aria-label="Previous lesson"
                    className="flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground transition hover:bg-background hover:text-foreground"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Link>
                ) : (
                  <span className="flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground/30" aria-hidden="true">
                    <ChevronLeft className="h-4 w-4" />
                  </span>
                )}
                <span className="px-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Lesson {lessonId} of {TOTAL_LESSONS}
                </span>
                {nextId ? (
                  <Link
                    href={`/blitz/guide/${nextId}`}
                    aria-label="Next lesson"
                    className="flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground transition hover:bg-background hover:text-foreground"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Link>
                ) : (
                  <span className="flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground/30" aria-hidden="true">
                    <ChevronRight className="h-4 w-4" />
                  </span>
                )}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button variant="outline" size="sm" asChild>
              <Link href="/blitz">
                <ArrowLeftIcon />
                Back to Hub
              </Link>
            </Button>
            {isSectionView && (
              <Button size="sm" asChild>
                <Link href="/blitz/guide">
                  View Full Guide
                </Link>
              </Button>
            )}
            <Button
              size="sm"
              onClick={() => window.print()}
              className="gap-1.5 bg-green-600 text-white hover:bg-green-700"
            >
              <Printer className="w-4 h-4" />
              Print / Save PDF
            </Button>
          </div>
        </div>
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Caterpillar Edition
          <span className="mx-2.5 text-border font-normal" aria-hidden="true">|</span>
          Build · Test · Scale
          <span className="mx-2.5 text-border font-normal" aria-hidden="true">|</span>
          V4.0 (Released April 21, 2026)
        </p>
      </div>
      <div
        className={`blitz-content${isSectionView ? " section-filtered" : " full-guide"}`}
        ref={setRef}
        dangerouslySetInnerHTML={{ __html: blitzBodyHTML }}
      />
      {isSectionView && (
        <nav
          aria-label="Lesson navigation"
          className="mt-6 flex flex-col-reverse gap-3 border-t border-border pt-6 sm:flex-row sm:justify-between"
        >
          {prevId && prevPager ? (
            <Link
              href={`/blitz/guide/${prevId}`}
              className={`flex min-h-[64px] flex-col justify-center rounded-xl border px-5 py-3 text-left transition sm:w-[20.8rem] ${prevPager.card}`}
            >
              <span className={`flex items-center gap-1 text-[0.7rem] font-bold uppercase leading-none tracking-wider ${prevPager.eyebrow}`}>
                <ChevronLeft className="relative -top-px h-3.5 w-3.5 shrink-0 -ml-1" />
                Previous
              </span>
              <span className={`mt-0.5 truncate text-base font-semibold ${prevPager.title}`}>
                {LESSON_SHORT_TITLES[prevId]}
              </span>
            </Link>
          ) : (
            <div className="hidden sm:block sm:w-[20.8rem]" aria-hidden="true" />
          )}
          {nextId && nextPager ? (
            <Link
              href={`/blitz/guide/${nextId}`}
              className={`flex min-h-[64px] flex-col justify-center rounded-xl border px-5 py-3 text-right transition sm:w-[20.8rem] ${nextPager.card}`}
            >
              <span className={`flex items-center justify-end gap-1 text-[0.7rem] font-bold uppercase leading-none tracking-wider ${nextPager.eyebrow}`}>
                Next
                <ChevronRight className="relative -top-px h-3.5 w-3.5 shrink-0 -mr-1" />
              </span>
              <span className={`mt-0.5 truncate text-base font-semibold ${nextPager.title}`}>
                {LESSON_SHORT_TITLES[nextId]}
              </span>
            </Link>
          ) : (
            <div className="hidden sm:block sm:w-[20.8rem]" aria-hidden="true" />
          )}
        </nav>
      )}
    </AppLayout>
  );
}
