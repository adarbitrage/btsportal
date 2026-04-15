import { AppLayout } from "@/components/layout/AppLayout";

const blitzCSS = `
.blitz-content {
  --blitz-primary: #1a2e4a;
  --blitz-accent: #2e7de9;
  --blitz-success: #1a7a4a;
  --blitz-warning: #b45309;
  --blitz-danger: #b91c1c;
  --blitz-bg: #f8f9fb;
  --blitz-card: #ffffff;
  --blitz-border: #dde2ea;
  --blitz-text: #1e2533;
  --blitz-muted: #6b7280;
  --mm-color: #166534;
  --mm-bg: #f0fdf4;
  --mm-border: #86efac;
  --cb-color: #92400e;
  --cb-bg: #fff7ed;
  --cb-border: #fcd34d;
  --mw-color: #1e40af;
  --mw-bg: #eff6ff;
  --mw-border: #93c5fd;
  --cat-color: #6b21a8;
  --cat-bg: #faf5ff;
  --gh-color: #065f46;
  --gh-bg: #ecfdf5;
  --cr-color: #1e3a5f;
  --cr-bg: #e8f0fe;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  color: var(--blitz-text);
  line-height: 1.75;
  font-size: 15px;
}
.blitz-content * { box-sizing: border-box; }
.blitz-content .page-header {
  background: var(--blitz-primary);
  color: white;
  padding: 52px 32px 44px;
  text-align: center;
  border-radius: 12px 12px 0 0;
}
.blitz-content .page-header h1 { font-size: 2.2rem; letter-spacing: -0.5px; margin-bottom: 10px; }
.blitz-content .page-header .tagline { opacity: 0.8; font-size: 1.05rem; max-width: 560px; margin: 0 auto 18px; }
.blitz-content .page-header .reassurance {
  display: inline-block;
  background: rgba(255,255,255,0.12);
  border: 1px solid rgba(255,255,255,0.25);
  border-radius: 30px;
  padding: 8px 20px;
  font-size: 0.88rem;
  opacity: 0.9;
}
.blitz-content nav.toc {
  background: var(--blitz-primary);
  border-top: 1px solid rgba(255,255,255,0.1);
  padding: 0 32px;
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
  justify-content: center;
}
.blitz-content nav.toc a {
  color: rgba(255,255,255,0.7);
  text-decoration: none;
  font-size: 0.82rem;
  padding: 10px 12px;
  border-bottom: 3px solid transparent;
  transition: all 0.15s;
  white-space: nowrap;
}
.blitz-content nav.toc a:hover { color: white; border-color: var(--blitz-accent); }
.blitz-content .container { max-width: 900px; margin: 0 auto; padding: 40px 24px 80px; }
.blitz-content .module { margin-bottom: 60px; }
.blitz-content .module-header {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 8px;
  padding-bottom: 16px;
  border-bottom: 2px solid var(--blitz-border);
}
.blitz-content .module-badge {
  background: var(--blitz-primary);
  color: white;
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 1px;
  text-transform: uppercase;
  padding: 4px 12px;
  border-radius: 20px;
  white-space: nowrap;
}
.blitz-content .module-badge.build { background: #1a7a4a; }
.blitz-content .module-badge.test { background: #b45309; }
.blitz-content .module-badge.scale { background: #6b21a8; }
.blitz-content .module-header h2 { font-size: 1.6rem; color: var(--blitz-primary); }
.blitz-content .module-intro {
  background: #f0f4ff;
  border-left: 4px solid var(--blitz-accent);
  border-radius: 0 8px 8px 0;
  padding: 16px 20px;
  margin-bottom: 28px;
  font-size: 0.95rem;
  color: #1e3a6e;
}
.blitz-content h3 { font-size: 1.1rem; color: var(--blitz-primary); margin: 32px 0 10px; }
.blitz-content h4 { font-size: 0.9rem; font-weight: 700; color: #374151; margin: 20px 0 8px; text-transform: uppercase; letter-spacing: 0.5px; }
.blitz-content p { margin-bottom: 14px; }
.blitz-content ul, .blitz-content ol { margin: 8px 0 16px 22px; }
.blitz-content li { margin-bottom: 8px; }
.blitz-content .plain-english {
  background: #fffbeb;
  border: 1px solid #fde68a;
  border-radius: 8px;
  padding: 14px 18px;
  margin: 12px 0 18px;
  font-size: 0.9rem;
}
.blitz-content .plain-english .pe-label {
  font-size: 0.72rem;
  font-weight: 800;
  letter-spacing: 1px;
  text-transform: uppercase;
  color: #92400e;
  margin-bottom: 6px;
}
.blitz-content .jargon {
  display: inline-block;
  background: #e0e7ff;
  color: #3730a3;
  border-radius: 4px;
  padding: 1px 7px;
  font-size: 0.82rem;
  font-weight: 600;
  cursor: help;
}
.blitz-content .card {
  background: var(--blitz-card);
  border: 1px solid var(--blitz-border);
  border-radius: 10px;
  padding: 22px 24px;
  margin-bottom: 20px;
}
.blitz-content .card-title {
  font-weight: 700;
  font-size: 0.82rem;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 12px;
  color: var(--blitz-muted);
}
.blitz-content .path-tag {
  display: inline-block;
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.5px;
  text-transform: uppercase;
  padding: 2px 9px;
  border-radius: 4px;
  margin-right: 4px;
}
.blitz-content .tag-mm { background: var(--mm-bg); color: var(--mm-color); border: 1px solid var(--mm-border); }
.blitz-content .tag-cb { background: var(--cb-bg); color: var(--cb-color); border: 1px solid var(--cb-border); }
.blitz-content .tag-mw { background: var(--mw-bg); color: var(--mw-color); border: 1px solid var(--mw-border); }
.blitz-content .tag-cat { background: var(--cat-bg); color: var(--cat-color); border: 1px solid #d8b4fe; }
.blitz-content .tag-gh { background: var(--gh-bg); color: var(--gh-color); border: 1px solid #6ee7b7; }
.blitz-content .tag-cr { background: var(--cr-bg); color: var(--cr-color); border: 1px solid var(--mw-border); }
.blitz-content .tag-all { background: #f1f5f9; color: #334155; border: 1px solid #cbd5e1; }
.blitz-content .path-block {
  border-left: 4px solid;
  border-radius: 0 8px 8px 0;
  padding: 18px 22px;
  margin: 18px 0;
}
.blitz-content .path-block.mm { border-color: var(--mm-color); background: var(--mm-bg); }
.blitz-content .path-block.cb { border-color: var(--cb-color); background: var(--cb-bg); }
.blitz-content .path-block.mw { border-color: var(--mw-color); background: var(--mw-bg); }
.blitz-content .path-block.cat { border-color: var(--cat-color); background: var(--cat-bg); }
.blitz-content .path-block.gh { border-color: var(--gh-color); background: var(--gh-bg); }
.blitz-content .path-block.cr { border-color: var(--cr-color); background: var(--cr-bg); }
.blitz-content .path-block.all { border-color: #94a3b8; background: #f8fafc; }
.blitz-content .path-block-label {
  font-size: 0.72rem;
  font-weight: 800;
  letter-spacing: 1px;
  text-transform: uppercase;
  margin-bottom: 10px;
  display: flex;
  align-items: center;
  gap: 6px;
}
.blitz-content .path-block.mm .path-block-label { color: var(--mm-color); }
.blitz-content .path-block.cb .path-block-label { color: var(--cb-color); }
.blitz-content .path-block.mw .path-block-label { color: var(--mw-color); }
.blitz-content .path-block.cat .path-block-label { color: var(--cat-color); }
.blitz-content .path-block.gh .path-block-label { color: var(--gh-color); }
.blitz-content .path-block.cr .path-block-label { color: var(--cr-color); }
.blitz-content .path-block.all .path-block-label { color: #475569; }
.blitz-content .path-chooser {
  display: grid;
  gap: 14px;
  margin: 16px 0;
}
.blitz-content .path-chooser-3 { grid-template-columns: repeat(3,1fr); }
.blitz-content .path-chooser-2 { grid-template-columns: repeat(2,1fr); }
@media (max-width: 600px) { .blitz-content .path-chooser { grid-template-columns: 1fr !important; } }
.blitz-content .path-option {
  border: 2px solid var(--blitz-border);
  border-radius: 10px;
  padding: 18px 20px;
}
.blitz-content .path-option .opt-name { font-weight: 700; font-size: 1rem; margin-bottom: 6px; }
.blitz-content .path-option .opt-desc { font-size: 0.85rem; color: var(--blitz-muted); line-height: 1.55; }
.blitz-content .path-option.mm { border-color: var(--mm-border); background: var(--mm-bg); }
.blitz-content .path-option.cb { border-color: var(--cb-border); background: var(--cb-bg); }
.blitz-content .path-option.mw { border-color: var(--mw-border); background: var(--mw-bg); }
.blitz-content table { width: 100%; border-collapse: collapse; margin: 14px 0; font-size: 0.88rem; }
.blitz-content th { background: var(--blitz-primary); color: white; text-align: left; padding: 10px 14px; font-size: 0.8rem; }
.blitz-content td { padding: 10px 14px; border-bottom: 1px solid var(--blitz-border); vertical-align: top; }
.blitz-content tr:nth-child(even) td { background: #f8f9fb; }
.blitz-content tr.total-row td { font-weight: 700; background: #f0f4ff; border-top: 2px solid var(--blitz-accent); }
.blitz-content .alert {
  border-radius: 8px;
  padding: 16px 20px;
  margin: 16px 0;
  font-size: 0.9rem;
}
.blitz-content .alert.info { background: #eff6ff; border: 1px solid #93c5fd; color: #1e40af; }
.blitz-content .alert.warning { background: #fff7ed; border: 1px solid #fcd34d; color: #92400e; }
.blitz-content .alert.danger { background: #fef2f2; border: 1px solid #fca5a5; color: #b91c1c; }
.blitz-content .alert.success { background: #f0fdf4; border: 1px solid #86efac; color: #166534; }
.blitz-content .alert strong { display: block; margin-bottom: 4px; font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.5px; }
.blitz-content .checklist { list-style: none; margin: 0; padding: 0; }
.blitz-content .checklist li {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 9px 0;
  border-bottom: 1px solid var(--blitz-border);
  font-size: 0.9rem;
  line-height: 1.55;
}
.blitz-content .checklist li:last-child { border-bottom: none; }
.blitz-content .checklist li::before { content: "☐"; font-size: 1rem; color: var(--blitz-accent); margin-top: 1px; flex-shrink: 0; }
.blitz-content .video-slot {
  background: #1e2533;
  border-radius: 8px;
  padding: 18px 20px;
  display: flex;
  align-items: center;
  gap: 14px;
  margin: 10px 0;
  color: #e2e8f0;
  font-size: 0.88rem;
}
.blitz-content .video-slot .play-icon {
  width: 36px; height: 36px; min-width: 36px;
  background: var(--blitz-accent); border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
}
.blitz-content .video-slot .play-icon::after { content: "▶"; font-size: 0.72rem; margin-left: 2px; color: white; }
.blitz-content .video-slot .vt { font-weight: 600; margin-bottom: 2px; }
.blitz-content .video-slot .vd { color: #94a3b8; font-size: 0.8rem; }
.blitz-content .roadmap {
  display: grid;
  grid-template-columns: 1fr 40px 1fr 40px 1fr;
  align-items: center;
  gap: 0;
  margin: 24px 0;
}
@media (max-width: 600px) {
  .blitz-content .roadmap { grid-template-columns: 1fr; }
  .blitz-content .roadmap-arrow { display: none; }
}
.blitz-content .roadmap-phase {
  background: var(--blitz-card);
  border: 2px solid var(--blitz-border);
  border-radius: 12px;
  padding: 20px;
  text-align: center;
}
.blitz-content .roadmap-phase.p1 { border-color: #86efac; }
.blitz-content .roadmap-phase.p2 { border-color: #fcd34d; }
.blitz-content .roadmap-phase.p3 { border-color: #d8b4fe; }
.blitz-content .roadmap-arrow { text-align: center; color: var(--blitz-muted); font-size: 1.4rem; }
.blitz-content .roadmap-phase .ph-num {
  font-size: 0.68rem; font-weight: 800; letter-spacing: 1px;
  text-transform: uppercase; margin-bottom: 4px; color: var(--blitz-muted);
}
.blitz-content .roadmap-phase .ph-title { font-weight: 800; font-size: 1.1rem; margin-bottom: 6px; }
.blitz-content .roadmap-phase.p1 .ph-title { color: var(--blitz-success); }
.blitz-content .roadmap-phase.p2 .ph-title { color: var(--blitz-warning); }
.blitz-content .roadmap-phase.p3 .ph-title { color: var(--cat-color); }
.blitz-content .roadmap-phase .ph-desc { font-size: 0.82rem; color: var(--blitz-muted); line-height: 1.5; }
.blitz-content .gate { border: 2px solid; border-radius: 10px; padding: 18px 22px; margin: 16px 0; }
.blitz-content .gate.pass { border-color: #86efac; background: var(--mm-bg); }
.blitz-content .gate.fail { border-color: #fca5a5; background: #fef2f2; }
.blitz-content .gate-header { font-weight: 800; font-size: 0.85rem; margin-bottom: 10px; }
.blitz-content .gate.pass .gate-header { color: var(--blitz-success); }
.blitz-content .gate.fail .gate-header { color: var(--blitz-danger); }
.blitz-content .milestone {
  display: flex;
  overflow: hidden;
  border-radius: 8px;
  border: 1px solid var(--blitz-border);
  margin: 16px 0;
}
.blitz-content .ms-item { flex: 1; padding: 14px 10px; text-align: center; border-right: 1px solid var(--blitz-border); font-size: 0.8rem; background: var(--blitz-card); }
.blitz-content .ms-item:last-child { border-right: none; }
.blitz-content .ms-item .ms-amount { font-weight: 800; font-size: 1rem; color: var(--blitz-primary); margin-bottom: 4px; }
.blitz-content .ms-item .ms-do { color: var(--blitz-muted); line-height: 1.4; }
.blitz-content .method-grid { display: grid; grid-template-columns: repeat(3,1fr); gap: 14px; margin: 16px 0; }
@media (max-width: 640px) { .blitz-content .method-grid { grid-template-columns: 1fr; } }
.blitz-content .method-card { background: var(--blitz-card); border: 1px solid var(--blitz-border); border-radius: 10px; padding: 18px; }
.blitz-content .method-card .mc-num { font-size: 0.68rem; font-weight: 800; letter-spacing: 1px; text-transform: uppercase; color: var(--blitz-muted); margin-bottom: 6px; }
.blitz-content .method-card h4 { font-size: 0.92rem; margin: 0 0 8px; text-transform: none; letter-spacing: 0; color: var(--blitz-primary); }
.blitz-content .method-card p { font-size: 0.83rem; color: var(--blitz-muted); margin: 0; }
.blitz-content .support-grid { display: grid; grid-template-columns: repeat(3,1fr); gap: 12px; margin: 16px 0; }
@media (max-width: 600px) { .blitz-content .support-grid { grid-template-columns: 1fr; } }
.blitz-content .support-card { background: var(--blitz-card); border: 1px solid var(--blitz-border); border-radius: 8px; padding: 16px; font-size: 0.85rem; }
.blitz-content .support-card .sc-type { font-weight: 700; margin-bottom: 6px; color: var(--blitz-primary); }
.blitz-content .glossary { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin: 16px 0; }
@media (max-width: 600px) { .blitz-content .glossary { grid-template-columns: 1fr; } }
.blitz-content .gloss-item { background: var(--blitz-card); border: 1px solid var(--blitz-border); border-radius: 8px; padding: 14px 16px; }
.blitz-content .gloss-term { font-weight: 700; font-size: 0.88rem; color: var(--blitz-primary); margin-bottom: 4px; }
.blitz-content .gloss-def { font-size: 0.83rem; color: var(--blitz-muted); line-height: 1.5; }
.blitz-content .divider { border: none; border-top: 1px solid var(--blitz-border); margin: 36px 0; }
.blitz-content .big-stat {
  display: inline-block;
  background: var(--blitz-primary);
  color: white;
  border-radius: 8px;
  padding: 4px 12px;
  font-weight: 800;
  font-size: 1rem;
  margin: 2px 0;
}
.blitz-content .step-list { list-style: none; margin: 0; padding: 0; }
.blitz-content .step-list > li { display: flex; gap: 14px; margin-bottom: 18px; align-items: flex-start; }
.blitz-content .step-num { width: 28px; height: 28px; min-width: 28px; background: var(--blitz-primary); color: white; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 0.78rem; font-weight: 700; margin-top: 2px; }
.blitz-content .step-body { flex: 1; }
.blitz-content .step-body strong { display: block; margin-bottom: 2px; }
.blitz-content .why-box {
  background: #f0f9ff;
  border: 1px solid #bae6fd;
  border-radius: 8px;
  padding: 14px 18px;
  margin: 12px 0;
  font-size: 0.88rem;
  color: #0c4a6e;
}
.blitz-content .why-box .why-label { font-weight: 800; font-size: 0.72rem; letter-spacing: 1px; text-transform: uppercase; margin-bottom: 4px; color: #0369a1; }
@media (max-width: 640px) {
  .blitz-content .page-header { padding: 32px 16px 28px; }
  .blitz-content .page-header h1 { font-size: 1.6rem; }
  .blitz-content .milestone { flex-direction: column; }
  .blitz-content .ms-item { border-right: none; border-bottom: 1px solid var(--blitz-border); }
  .blitz-content .ms-item:last-child { border-bottom: none; }
}
`;

export default function Blitz() {
  return (
    <AppLayout>
      <style>{blitzCSS}</style>
      <div className="blitz-content">

        <div className="page-header">
          <h1>The Blitz™</h1>
          <p className="tagline">A step-by-step guide to launching your first profitable affiliate marketing campaign — even if you've never done this before.</p>
          <span className="reassurance">✦ &nbsp; No experience needed &nbsp; ✦ &nbsp; Work at your own pace &nbsp; ✦ &nbsp; Support available every step of the way</span>
        </div>

        <nav className="toc">
          <a href="#glossary">Key Terms</a>
          <a href="#path-select">Choose Your Path</a>
          <a href="#module0">Module 0: Before You Start</a>
          <a href="#module1">Module 1: Build</a>
          <a href="#module2">Module 2: Test</a>
          <a href="#module3">Module 3: Scale</a>
          <a href="#support">Support</a>
        </nav>

        <div className="container">

          {/* WELCOME */}
          <div className="module" id="welcome">
            <div className="module-header">
              <span className="module-badge">Start Here</span>
              <h2>Welcome to The Blitz™</h2>
            </div>

            <div className="module-intro">
              If you're new to affiliate marketing, you're in exactly the right place. This guide is written in plain language and will walk you through every single step. You don't need any prior experience — just a willingness to follow the process and make decisions based on data.
            </div>

            <div className="video-slot">
              <div className="play-icon"></div>
              <div>
                <div className="vt">Watch This First: What Is Affiliate Arbitrage?</div>
                <div className="vd">A short overview of how this business model works — start here before anything else</div>
              </div>
            </div>

            <div className="plain-english">
              <div className="pe-label">💡 What is Affiliate Arbitrage? (Plain English)</div>
              Here's the basic idea: you promote someone else's product using paid ads. When someone clicks your ad, visits a landing page you've created, and then buys the product — you earn a commission. The "arbitrage" part means you're trying to spend less on ads than you make in commissions. Your goal is to find the right combination of ad, landing page, and audience that makes that happen consistently.
            </div>
          </div>


          {/* GLOSSARY */}
          <div className="module" id="glossary">
            <div className="module-header">
              <span className="module-badge">Reference</span>
              <h2>Key Terms — Plain English Definitions</h2>
            </div>

            <p>You'll see these terms throughout this guide and in the videos. Bookmark this section and refer back to it whenever something is unclear.</p>

            <div className="glossary">
              <div className="gloss-item">
                <div className="gloss-term">Affiliate Network</div>
                <div className="gloss-def">A marketplace where companies list products they want promoted. You sign up, pick a product, and get a unique link. When someone buys through your link, you get paid. In The Blitz™, your options are: Media Mavens (our own in-house network), ClickBank, Affiliati, and MaxWeb.</div>
              </div>
              <div className="gloss-item">
                <div className="gloss-term">Commission / CPA</div>
                <div className="gloss-def">The money you earn each time someone buys the product you're promoting. "CPA" stands for Cost Per Acquisition — it's the dollar amount you receive per sale. Example: if you earn $50 per sale, your CPA is $50.</div>
              </div>
              <div className="gloss-item">
                <div className="gloss-term">Landing Page</div>
                <div className="gloss-def">The web page someone sees after clicking your ad. Its job is to warm them up and get them interested enough to click through to the product's sales page. You create and control this page.</div>
              </div>
              <div className="gloss-item">
                <div className="gloss-term">Advertorial</div>
                <div className="gloss-def">A type of landing page that reads like an article or editorial — it tells a story or shares information rather than being an obvious advertisement. Used in Media Mavens campaigns.</div>
              </div>
              <div className="gloss-item">
                <div className="gloss-term">Jump Page / Bridge Page</div>
                <div className="gloss-def">A very short landing page — usually just a headline, an image, and a button — that sends visitors directly to a video sales letter (VSL). Used in ClickBank campaigns.</div>
              </div>
              <div className="gloss-item">
                <div className="gloss-term">VSL (Video Sales Letter)</div>
                <div className="gloss-def">A video that sells the product. This is the main selling tool for many ClickBank products. You don't create the VSL — the product owner does. Your job is to get people to watch it.</div>
              </div>
              <div className="gloss-item">
                <div className="gloss-term">Traffic Source / Publisher</div>
                <div className="gloss-def">The advertising platform where your ads run. Think of it like the network that displays your ads to potential buyers. In The Blitz™, you'll work with one of three publishers: Caterpillar, Grasshopper, or Crane.</div>
              </div>
              <div className="gloss-item">
                <div className="gloss-term">Native Ad</div>
                <div className="gloss-def">An ad that blends in with the content around it — it looks like an article recommendation rather than a traditional banner. You upload the headline and image separately, and the platform assembles the ad. Caterpillar runs native ads.</div>
              </div>
              <div className="gloss-item">
                <div className="gloss-term">Banner Ad</div>
                <div className="gloss-def">A traditional display ad — an image with your headline built directly into it. You create the full image as a single file. Grasshopper and Crane run banner ads.</div>
              </div>
              <div className="gloss-item">
                <div className="gloss-term">CTR (Click-Through Rate)</div>
                <div className="gloss-def">The percentage of people who click your ad or landing page. Higher CTR means your ad or page is grabbing attention. Ad CTR = people who clicked the ad. Landing Page CTR = people who clicked through to the product.</div>
              </div>
              <div className="gloss-item">
                <div className="gloss-term">ROAS (Return on Ad Spend)</div>
                <div className="gloss-def">How much money you made back for every dollar you spent on ads. Example: if you spent $1,000 and made $600 in commissions, your ROAS is 60%. Your goal is to eventually reach 100% ROAS (break-even) and then above it (profit).</div>
              </div>
              <div className="gloss-item">
                <div className="gloss-term">Hero Shot</div>
                <div className="gloss-def">The main image on your landing page — the first big visual a visitor sees. It sets the emotional tone for the page and needs to connect with the headline.</div>
              </div>
              <div className="gloss-item">
                <div className="gloss-term">Split Testing (A/B Testing)</div>
                <div className="gloss-def">Showing different versions of your ads or landing pages to different visitors to see which one performs better. You might test 10 different headlines, for example, and see which one generates the most clicks or sales.</div>
              </div>
              <div className="gloss-item">
                <div className="gloss-term">DIYTrax</div>
                <div className="gloss-def">Your campaign tracking dashboard. It connects your ads, landing pages, and affiliate links together, and records which combinations are generating sales. Think of it as your campaign's control center.</div>
              </div>
              <div className="gloss-item">
                <div className="gloss-term">Placement</div>
                <div className="gloss-def">The specific format and size of your ad. On Caterpillar, placements are things like "16:9 image" or "9:16 video." On Grasshopper, they're banner sizes like 300×250 or 970×250.</div>
              </div>
              <div className="gloss-item">
                <div className="gloss-term">Compliance</div>
                <div className="gloss-def">A review process where your ads and landing pages are checked to make sure they follow the rules of the affiliate network and publisher. You must submit your creative assets for compliance approval before going live.</div>
              </div>
            </div>
          </div>


          {/* CHOOSE YOUR PATH */}
          <div className="module" id="path-select">
            <div className="module-header">
              <span className="module-badge">Choose</span>
              <h2>Choose Your Path</h2>
            </div>

            <div className="module-intro">
              Before you start, you need to make two decisions: which affiliate network to use (where you'll find products to promote), and which publisher to use (where your ads will run). This guide is built around three main paths, plus some alternatives. Pick the one that fits your situation.
            </div>

            <h3>Decision 1 — Which Affiliate Network?</h3>
            <p>This is where you'll find the product you're going to promote and get your unique affiliate link.</p>

            <div className="path-chooser path-chooser-3">
              <div className="path-option mm">
                <div className="opt-name">🟢 Media Mavens</div>
                <div className="opt-desc">BTS's own in-house network. Curated, high-converting offers with dedicated support. Best for most students — especially if you want a streamlined experience with vetted products.</div>
              </div>
              <div className="path-option cb">
                <div className="opt-name">🟡 ClickBank</div>
                <div className="opt-desc">A large, well-known affiliate marketplace with thousands of digital products. Great if you want more variety or already have a specific niche in mind. Slightly more setup involved.</div>
              </div>
              <div className="path-option mw">
                <div className="opt-name">🔵 MaxWeb</div>
                <div className="opt-desc">A performance-focused network with high-quality offers. Similar workflow to ClickBank. Good option if you have some experience or want to diversify later.</div>
              </div>
            </div>

            <div className="alert info">
              <strong>Not sure which to pick?</strong>
              Start with Media Mavens. It's the most supported path in this program, and the products have been vetted specifically for this system. You can always add ClickBank or MaxWeb later once you have your first campaign running.
            </div>

            <h3>Decision 2 — Which Publisher (Traffic Source)?</h3>
            <p>This is where your ads will actually be shown to potential buyers.</p>

            <div className="path-chooser path-chooser-3">
              <div className="path-option mm">
                <div className="opt-name">🐛 Caterpillar</div>
                <div className="opt-desc"><strong>Native ads</strong> — your ads look like recommended articles. You provide a headline, a description, and one image separately; the platform assembles the ad. Lower barrier to entry, works well for content-driven offers.</div>
              </div>
              <div className="path-option cb">
                <div className="opt-name">🦗 Grasshopper</div>
                <div className="opt-desc"><strong>Banner ads</strong> — you design a complete image file (headline + image combined). Supports both static images and animated GIFs. Higher creative bar, but very strong traffic volume.</div>
              </div>
              <div className="path-option mw">
                <div className="opt-name">🏗 Crane</div>
                <div className="opt-desc"><strong>Banner ads</strong> — similar to Grasshopper but static images only (no GIFs). Available sizes: 970×250, 900×750, 1242×699, 1536×864. Currently only supports Media Mavens offers.</div>
              </div>
            </div>

            <div className="alert info">
              <strong>Starting budget matters</strong>
              Caterpillar requires the lowest test budget (~$500 for Round 1). Grasshopper requires ~$1,500. Choose based on what you can comfortably invest in testing before expecting returns.
            </div>
          </div>


          {/* MODULE 0 */}
          <div className="module" id="module0">
            <div className="module-header">
              <span className="module-badge build">Module 0</span>
              <h2>Before You Start — Foundations</h2>
            </div>

            <div className="module-intro">
              This module covers everything you need to have in place before building your first campaign. Think of it as setting up your workbench before starting a project. Skip these steps and you'll waste time later.
            </div>

            <div className="roadmap">
              <div className="roadmap-phase p1">
                <div className="ph-num">Phase 1</div>
                <div className="ph-title">Build</div>
                <div className="ph-desc">Choose your product, create landing pages, set up ads</div>
              </div>
              <div className="roadmap-arrow">→</div>
              <div className="roadmap-phase p2">
                <div className="ph-num">Phase 2</div>
                <div className="ph-title">Test</div>
                <div className="ph-desc">Spend real money, find winning headlines and images</div>
              </div>
              <div className="roadmap-arrow">→</div>
              <div className="roadmap-phase p3">
                <div className="ph-num">Phase 3</div>
                <div className="ph-title">Scale</div>
                <div className="ph-desc">Increase budget on what works, expand to new placements</div>
              </div>
            </div>

            <h3>What You'll Need</h3>
            <div className="card">
              <ul className="checklist">
                <li>A computer with a web browser (Chrome recommended)</li>
                <li>A valid email address</li>
                <li>A payment method for ad spend (credit card or debit card)</li>
                <li>A domain name (you'll purchase this — typically $10–15/year)</li>
                <li>Starting ad budget: $500 minimum for Caterpillar, $1,500 minimum for Grasshopper/Crane</li>
                <li>2–3 hours per day to work on your campaign (more is fine, but consistency matters more than marathon sessions)</li>
              </ul>
            </div>

            <div className="why-box">
              <div className="why-label">Why does this cost money upfront?</div>
              This is a real business, not a get-rich-quick scheme. The ad spend is your investment — you're paying to put your ads in front of real people. The testing process helps you find the combinations that turn that investment into profit. Every successful media buyer started with a testing budget.
            </div>
          </div>


          {/* MODULE 1: BUILD */}
          <div className="module" id="module1">
            <div className="module-header">
              <span className="module-badge build">Module 1</span>
              <h2>Build — Create Your Campaign</h2>
            </div>

            <div className="module-intro">
              The Build phase takes you from zero to a live campaign. You'll choose a product, create your landing pages, build your ads, connect everything with tracking, and go live. Follow the steps in order — each one builds on the previous step.
            </div>

            {/* Step 1 */}
            <h3>Step 1 — Choose Your Offer (Product) <span className="path-tag tag-all">Everyone</span></h3>

            <p>Your "offer" is the product you're going to promote. This is the most important decision in the Build phase — the right product makes everything else easier.</p>

            <div className="path-block mm">
              <div className="path-block-label">✦ Media Mavens</div>
              <p>Log into your Media Mavens dashboard and browse the available offers. Each offer page shows you the commission amount, the product's sales page, and any restrictions. Pick one that interests you and that you think you could write a compelling ad about.</p>
              <ul className="checklist">
                <li>Watch: <strong>How to Navigate Your Media Mavens Dashboard</strong></li>
                <li>Watch: <strong>How to Choose a Winning Offer</strong></li>
              </ul>
            </div>

            <div className="path-block cb">
              <div className="path-block-label">✦ ClickBank</div>
              <p>Create a ClickBank account (free), browse their marketplace, and choose a product. Look for products with a high "gravity" score (meaning other affiliates are actively making sales with it) and a commission of at least $40.</p>
              <ul className="checklist">
                <li>Watch: <strong>How to Create a ClickBank Account</strong></li>
                <li>Watch: <strong>How to Find Offers on ClickBank</strong></li>
                <li>Watch: <strong>How to Generate Your ClickBank Affiliate Link (HopLink)</strong></li>
              </ul>
            </div>

            <div className="path-block mw">
              <div className="path-block-label">✦ MaxWeb</div>
              <p>Apply to MaxWeb, browse their offers, and select one. MaxWeb offers tend to be health, beauty, and supplement products. Commission rates vary — aim for $40+ per sale.</p>
              <ul className="checklist">
                <li>Watch: <strong>How to Apply to MaxWeb</strong></li>
                <li>Watch: <strong>Navigating the MaxWeb Dashboard</strong></li>
              </ul>
            </div>

            <hr className="divider" />

            {/* Step 2 */}
            <h3>Step 2 — Set Up Your Foundation Tools <span className="path-tag tag-all">Everyone</span></h3>

            <p>Before you start creating ads and landing pages, you need a few tools set up. These are the infrastructure your campaign runs on.</p>

            <div className="card">
              <div className="card-title">Required Accounts & Tools</div>
              <ul className="checklist">
                <li><strong>DIYTrax™ Account</strong> — your campaign tracking system. Watch: <em>How to Create Your DIYTrax Account</em></li>
                <li><strong>Flexy™ Account</strong> — your landing page builder. Watch: <em>How to Create Your Flexy Account</em></li>
                <li><strong>A Domain Name</strong> — purchase from Namecheap, GoDaddy, or any registrar. Keep it generic (avoid putting the product name in it). Watch: <em>How to Purchase and Set Up Your Domain</em></li>
                <li><strong>Publisher Account</strong> — sign up for Caterpillar, Grasshopper, or Crane (whichever you chose above)</li>
              </ul>
            </div>

            <hr className="divider" />

            {/* Step 3 */}
            <h3>Step 3 — Create Your Landing Page Content <span className="path-tag tag-all">Everyone</span></h3>

            <p>Your landing page is the bridge between your ad and the product. When someone clicks your ad, they land on this page. Its job is to warm them up, build interest, and get them to click through to the product's sales page.</p>

            <div className="path-block mm">
              <div className="path-block-label">✦ Media Mavens — Advertorial Content</div>
              <p><strong>Your target:</strong> 5 different headlines and 5 different hero shot images. These will be combined into 25 unique landing page variants using MetricMover™.</p>

              <h4>Write 5 Headlines</h4>
              <p>Your headlines are the most important element of your entire campaign. A great headline pulls people in; a weak one gets ignored. You'll test all 5 to find the winner.</p>
              <ul>
                <li><strong>Option 1 (Preferred): AffiliateCMO Bot</strong> — an AI assistant that generates optimized headlines for you based on the product. Watch the tutorial videos to learn how to use it effectively.</li>
                <li><strong>Option 2: FreeAdCopy™</strong> — a standalone tool for generating ad copy. Watch: <em>How to Create Headlines with FreeAdCopy</em></li>
                <li><strong>Option 3: Write Them Yourself</strong> — if you prefer to craft your own, study the product's sales page and write headlines that make someone curious enough to read more.</li>
              </ul>

              <h4>Source 5 Hero Shot Images</h4>
              <p>You need 5 different images to pair with your 5 headlines. Here are your options:</p>
              <ul>
                <li>Generate them using AI image tools (Midjourney, DALL-E, or similar)</li>
                <li>Find them using ScrapeBot™, CropBot™, Gifster™, or a Google image search</li>
                <li>License them from stock photography sites (paid) or find free open-source images</li>
              </ul>

              <div className="alert warning">
                <strong>Don't Skip Compliance</strong>
                Before you build your pages, you must submit your 5 headlines and 5 hero shots for compliance review. This protects you and ensures your ads are approved quickly. Watch: <em>Submit Advertorial Split Test Media to Compliance.</em> Wait for approval before proceeding to Step 4.
              </div>
            </div>

            <div className="path-block cb">
              <div className="path-block-label">✦ ClickBank — Jump Page Assets</div>
              <p><strong>Your target:</strong> 10 unique landing pages, each with its own angle, headline, image, and body copy.</p>

              <div className="plain-english">
                <div className="pe-label">💡 What's an "angle"?</div>
                An angle is a specific point of view or emotional hook you use to get someone interested in a product. For example, a weight-loss product could be marketed from the angle of "science-backed method," or "fits into a busy lifestyle," or "designed for people over 50." Each angle speaks to a different type of buyer. You'll create 10 different angles and test them all to see which one your audience responds to most.
              </div>

              <h4>Step 3a — Get Your VSL Transcript</h4>
              <p>Your copy will come from the product's VSL (video sales letter). You'll download the video, convert it to text, and use that text to generate your page copy. Here's how:</p>
              <ul className="checklist">
                <li>Watch: <strong>Install Video DownloadHelper in Firefox</strong> — a free browser tool that lets you download videos from websites</li>
                <li>Watch: <strong>Download Your VSL</strong> — how to save the product video to your computer</li>
                <li>Watch: <strong>How to Get a Transcription from Your VSL</strong> — how to convert the video to text using a transcription tool, then clean it up for accuracy</li>
              </ul>

              <h4>Step 3b — Generate 10 Angles</h4>
              <p>Use your transcript to generate 10 different marketing angles:</p>
              <ul>
                <li><strong>Option 1 (Preferred): Affiliate Angle Architect Bot</strong> — Watch the short tutorial and the call recording introduction. Then use the bot directly: it will analyze your transcript and generate strong angles for you.</li>
                <li><strong>Option 2: AngleArchitect Jr. Prompt Sequence</strong> — a written prompt sequence in Google Docs if you prefer to do this manually using an AI chatbot like Claude or ChatGPT.</li>
              </ul>

              <h4>Step 3c — Write Body Copy for Each Angle</h4>
              <p>Once you have your 10 angles, you need to write the actual page content for each one:</p>
              <ul>
                <li><strong>Option 1 (Preferred): Bridge Page Copy Bot</strong> — Watch the short tutorial. The bot takes your angle and generates full page copy for you.</li>
                <li><strong>Option 2: Bridge Page Copy Bot Jr. Prompt Sequence</strong> — a manual prompt sequence in Google Docs.</li>
              </ul>

              <div className="alert warning">
                <strong>Don't Skip Compliance</strong>
                Submit your landing page copy for compliance review before building your pages. Watch: <em>Submit Landing Page Split Test Media to Compliance.</em>
              </div>
            </div>

            <div className="path-block mw">
              <div className="path-block-label">✦ MaxWeb</div>
              <p>The MaxWeb process is very similar to ClickBank. Follow the ClickBank steps above — get your VSL transcript (if available for your product), generate 10 angles, and write body copy for each. If you need product-specific guidance, reach out to your MaxWeb Account Representative whose contact info is on your MaxWeb Dashboard.</p>
            </div>

            <hr className="divider" />

            {/* Step 4 */}
            <h3>Step 4 — Build Your Landing Pages in Flexy™ <span className="path-tag tag-all">Everyone</span></h3>

            <p>Flexy™ is the website builder you'll use to create your landing pages. Think of it like a drag-and-drop website tool — you don't need to know how to code. You'll start by cloning (copying) a pre-built template and then customizing it with your own headline, image, and copy.</p>

            <h4>Universal Setup — Everyone Does This First</h4>
            <ul className="checklist">
              <li>Watch: <strong>Clone Flexy™ Website</strong> — how to copy the pre-built website template into your account</li>
              <li>Watch: <strong>Add Domain To Flexy™</strong> — how to connect a web address (domain) to your website. You'll need to purchase a domain name if you don't have one.</li>
              <li>Watch: <strong>Connect Domain To Website</strong> — the technical step that links your domain to your Flexy™ site</li>
              <li>Watch: <strong>Clone Page Into Any Website</strong> — how to duplicate individual pages within your site</li>
            </ul>

            <h4>Choose Your Split Testing Method</h4>
            <p>A split test means running multiple versions of your landing page at the same time to see which one performs best. There are two ways to set this up, and which one you use depends on your path. Watch this first:</p>

            <div className="video-slot">
              <div className="play-icon"></div>
              <div>
                <div className="vt">How to Know Whether to Use MetricMover or Individual Landing Pages</div>
                <div className="vd">Watch this before choosing a method — it will make the decision clear</div>
              </div>
            </div>

            <div className="path-block mm">
              <div className="path-block-label">✦ Media Mavens — MetricMover™ Setup (creates all 25 combinations automatically)</div>
              <div className="plain-english">
                <div className="pe-label">💡 What does MetricMover do?</div>
                MetricMover automatically rotates through all 25 combinations of your 5 headlines and 5 images. Each visitor to your landing page sees one combination. The software tracks which combinations lead to sales, so you can cut the losers and keep the winners. You set it up once, and it runs automatically.
              </div>
              <ul className="checklist">
                <li>Watch MM1: What You Need For A MetricMover™ Test</li>
                <li>Watch MM2: Creating A New MetricMover™ Campaign</li>
                <li>Watch MM3: How To Import Your Landing Page Into MetricMover™</li>
                <li>Watch MM4: How To Create Headline Variants In MetricMover™</li>
                <li>Watch MM5: How To Upload Hero Shots To Flexy™ For Use In MetricMover™</li>
                <li>Watch MM6: How To Create Hero Shot Variants In MetricMover™</li>
                <li>Watch MM7: How To Set Up A Flexy™ Page For MetricMover™ Code</li>
                <li>Watch MM8: How To Export MetricMover™ Campaign Files</li>
                <li>Watch MM9: How To Find Your MetricMover™ Code File</li>
                <li>Watch MM10: How To Embed MetricMover™ Code Into A Flexy™ Page</li>
                <li>Watch MM11: How To Check MetricMover™ Page Variants — verify all 25 combinations are working</li>
                <li>Watch MM12: How To Find Your MetricMover™ .csv File For DIYTrax™ Import</li>
                <li>Watch MM13: How To Import MetricMover™ Page Variants Into DIYTrax™</li>
              </ul>
            </div>

            <div className="path-block cb">
              <div className="path-block-label">✦ ClickBank / MaxWeb — Individual Flexy™ Pages (10 separate pages, one per angle)</div>
              <div className="plain-english">
                <div className="pe-label">💡 How this works</div>
                Instead of one page with rotating elements, you'll create 10 completely separate landing pages — one for each of your 10 angles. You'll start with a base template, customize it for Angle 1, then duplicate and customize it 9 more times. DIYTrax will then rotate traffic between all 10 pages automatically.
              </div>
              <ul className="checklist">
                <li>Watch CF1: What You Need for Cloned Flexy Page Test</li>
                <li>Watch CF2: How to Duplicate Your Base Flexy Page</li>
                <li>Watch CF3: How to Change The Headline and Hero Shot</li>
                <li>Watch CF4: Further Page Edits — adjusting styling and removing unwanted elements</li>
                <li>Watch CF5: Cloning and Editing More Landing Page Variants — repeat for all 10 angles</li>
                <li>Watch CF6: Gathering Your Landing Page Variant URLs — collecting the web address for each of your 10 pages</li>
                <li>Watch CF7: Adding Your Landing Page Variant URLs to Your DIYTrax Campaign</li>
              </ul>
            </div>

            <div className="alert info">
              <strong>Stuck on Flexy™ or MetricMover™?</strong>
              These are the steps where students most often need help. Don't get stuck — contact BTS Concierge™ for done-for-you technical setup, or bring your question to the next coaching call.
            </div>

            <hr className="divider" />

            {/* Step 5 */}
            <h3>Step 5 — Create Your Ad Creative <span className="path-tag tag-all">Everyone</span></h3>

            <p>Your "ad creative" is the actual ad that people will see — the headline, image, or banner that gets them to click. What you create depends on your publisher.</p>

            <div className="plain-english">
              <div className="pe-label">💡 Know your target before you start creating</div>
              The most important thing to do before opening any design tool is to know exactly what you need to produce. Read the target for your publisher below first, then create.
            </div>

            <div className="path-block cat">
              <div className="path-block-label">✦ Caterpillar — Native Ads</div>

              <div className="plain-english">
                <div className="pe-label">💡 How Caterpillar ads work</div>
                Caterpillar is a "native" ad platform. This means your ads look like recommended articles or content — they blend into the page rather than looking like obvious advertisements. You upload three things separately: your headlines (as plain text), one description (as plain text), and one image. The platform assembles the ad automatically. You do <strong>not</strong> design a complete ad banner.
              </div>

              <h4>Round 1 Targets</h4>
              <ul>
                <li><strong>10 Headlines</strong> — each 90 characters or fewer (that's roughly the length of a tweet)</li>
                <li><strong>1 Description</strong> — 90 characters or fewer, appears below the headline in the ad</li>
                <li><strong>1 Image</strong> — 16:9 ratio (landscape/horizontal), minimum size 960×540px, recommended 1280×720px or larger</li>
              </ul>

              <div className="video-slot">
                <div className="play-icon"></div>
                <div>
                  <div className="vt">How to Create Ad Headlines and Descriptions for Caterpillar Campaigns</div>
                  <div className="vd">Draw your angles from your advertorial and the product's sales page</div>
                </div>
              </div>

              <div className="card">
                <div className="card-title">Optional: Make Your Ads Feel Personal Using Dynamic Macros</div>
                <p style={{fontSize: "0.88rem", marginBottom: "8px"}}>Caterpillar lets you insert "macros" — placeholder codes that automatically fill in real information about each viewer, making the ad feel personalized. For example, <code>{"{city}"}</code> gets replaced by the viewer's city name. You can ask Claude to help you work these into your headlines naturally.</p>
                <div style={{fontFamily: "monospace", fontSize: "0.82rem", background: "#1e2533", color: "#93c5fd", borderRadius: "6px", padding: "10px 14px"}}>
                  {"{state}"} &nbsp;{"{city}"} &nbsp;{"{year}"} &nbsp;{"{month}"} &nbsp;{"{day_of_week}"} &nbsp;{"{date}"} &nbsp;{"{os}"}
                </div>
              </div>

              <div className="video-slot">
                <div className="play-icon"></div>
                <div>
                  <div className="vt">How to Create An Ad Image for Caterpillar Campaigns</div>
                  <div className="vd">Use any AI image generator — match your image to your headline's theme</div>
                </div>
              </div>

              <div className="alert warning">
                <strong>Submit for Compliance Before Moving On</strong>
                Once your 10 headlines, 1 description, and 1 image are ready, submit them for compliance review. Do not proceed to Step 6 until they're approved.
              </div>
            </div>

            <div className="path-block gh">
              <div className="path-block-label">✦ Grasshopper — Banner Ads</div>

              <div className="plain-english">
                <div className="pe-label">💡 How Grasshopper banner ads work</div>
                Unlike Caterpillar, you design a complete image file — your headline is part of the image itself. Each banner is a single image file that includes both the headline text and the background image. You'll create 20 different banners, each with a different headline but using the same background image.
              </div>

              <h4>Round 1 Targets</h4>
              <ul>
                <li><strong>20 Banner Ads</strong> — 20 different headlines on the same background image</li>
                <li><strong>Recommended placement for Round 1:</strong> 300×250 or 970×250 (save the 970×550 size for later rounds)</li>
              </ul>

              <div className="video-slot">
                <div className="play-icon"></div>
                <div>
                  <div className="vt">Creating Ad Banner Variants for Testing</div>
                  <div className="vd">How to build your banners using PixelPress or another design tool</div>
                </div>
              </div>

              <p>You can use PixelPress (see PixelPress Training link), Canva, Adobe Photoshop, or any image editing software. There are no restrictions on which tool you use to build the image.</p>
            </div>

            <div className="path-block cr">
              <div className="path-block-label">✦ Crane — Banner Ads</div>
              <h4>Round 1 Targets</h4>
              <ul>
                <li><strong>20 Banner Ads</strong> — 20 headlines on the same static background image (no animated GIFs on Crane)</li>
                <li><strong>Available sizes:</strong> 970×250, 900×750, 1242×699, 1536×864 — any size is fine for Round 1</li>
              </ul>
              <p>Build banners using PixelPress, Canva, or any image editor. Static images only — Crane does not allow animated GIFs.</p>
            </div>

            <hr className="divider" />

            {/* Step 6 */}
            <h3>Step 6 — Set Up DIYTrax (Your Campaign Tracking System) <span className="path-tag tag-all">Everyone</span></h3>

            <div className="plain-english">
              <div className="pe-label">💡 What is DIYTrax and why do you need it?</div>
              DIYTrax is the "brain" of your campaign. It sits in the middle between your ads and your affiliate link, and it tracks everything — which ad someone clicked, which landing page they saw, and whether they made a purchase. Without it, you'd have no idea which parts of your campaign are working. Think of it like a flight data recorder for your campaign.
            </div>

            <h4>The DIYTrax Setup Sequence</h4>
            <p>Follow these in order — each step connects to the next:</p>

            <div className="card">
              <ol className="step-list">
                <li>
                  <div className="step-num">1</div>
                  <div className="step-body">
                    <strong>Create a Campaign Placeholder</strong>
                    This generates the special link you'll embed on your landing pages. Your landing page needs this link to send visitors to the product — set this up first so you have the link ready when you build your pages.
                  </div>
                </li>
                <li>
                  <div className="step-num">2</div>
                  <div className="step-body">
                    <strong><span className="path-tag tag-cb">ClickBank only</span> Set Up IPN Integration</strong>
                    IPN (Instant Payment Notification) is ClickBank's way of telling DIYTrax when a sale happens. This step connects the two systems so your sales are recorded accurately.
                  </div>
                </li>
                <li>
                  <div className="step-num">3</div>
                  <div className="step-body">
                    <strong>Add Your DIYTrax Link to Your Landing Pages</strong>
                    Place the campaign link from Step 1 into your Flexy™ landing pages. Use the "Custom Value" method first — it's simpler and works for most setups.
                  </div>
                </li>
                <li>
                  <div className="step-num">4</div>
                  <div className="step-body">
                    <strong>Add Your Landing Pages to DIYTrax</strong>
                    Tell DIYTrax about all the landing page variants you created so it can rotate between them and track performance for each.
                  </div>
                </li>
                <li>
                  <div className="step-num">5</div>
                  <div className="step-body">
                    <strong>Place Your Affiliate Link in DIYTrax</strong>
                    Add your unique affiliate link (from Step 1 of this guide) into DIYTrax so it knows where to send visitors who are ready to buy.
                  </div>
                </li>
              </ol>
            </div>

            <ul className="checklist">
              <li>Watch: <strong>Create DIYTrax Campaign Placeholder</strong></li>
              <li><span className="path-tag tag-cb">ClickBank</span> Watch: <strong>DIYTrax ClickBank IPN Integration</strong></li>
              <li>Watch: <strong>Add DIYTrax LP Offer Link in Flexy Custom Value</strong> (if this doesn't work for your setup, there's a backup method shown in the next video)</li>
              <li>Watch: <strong>Optimize Landing Page Base Copy</strong></li>
            </ul>

            <hr className="divider" />

            {/* Step 7 */}
            <h3>Step 7 — Configure Your Traffic Source and Go Live <span className="path-tag tag-all">Everyone</span></h3>

            <p>This is the final step before your campaign is running. You'll connect your publisher (Caterpillar, Grasshopper, or Crane) to DIYTrax, upload your ads, fund your account, do a final check, and launch.</p>

            <div className="path-block cat">
              <div className="path-block-label">✦ Caterpillar</div>
              <ul className="checklist">
                <li>Watch T1: <strong>Caterpillar Campaign Basic Info</strong> — setting up the basic campaign details in DIYTrax</li>
                <li>Watch T2: <strong>Configure Caterpillar Traffic Source Settings</strong></li>
                <li>Watch T3: <strong>Create Your First Native Ad in Caterpillar</strong></li>
                <li>Watch T4: <strong>Create More Ads in Caterpillar</strong></li>
                <li>Watch T5: <strong>Fund Your Traffic Source</strong> — adding money to your publisher account so your ads can run</li>
                <li>Watch T6: <strong>Add Your Landing Pages in DIYTrax</strong></li>
                <li>Watch T7: <strong>Place Affiliate Link in DIYTrax Campaign Offer Pages</strong></li>
                <li>Watch T8: <strong>Final QA Campaign Check and Set To Go Live</strong> — a final review before flipping the switch</li>
                <li>Watch T9: <strong>How Caterpillar Traffic Source Works and What to Expect</strong></li>
              </ul>

              <div className="alert warning">
                <strong>Important: Split Your Headlines Across Two Sub-Campaigns</strong>
                Caterpillar recommends a maximum of 3–5 ads per Sub-Campaign. Since you have 10 headlines, create 2 Sub-Campaigns with 5 headlines each. The videos walk you through how to do this.
              </div>

              <h4>Understanding Your Ad Status</h4>
              <p>After submitting your ads, you'll see a status next to each one in DIYTrax. Here's what each status means:</p>
              <table>
                <thead><tr><th>Status</th><th>What It Means</th><th>What to Do</th></tr></thead>
                <tbody>
                  <tr><td><strong>Pending</strong></td><td>Your ad is being reviewed by the publisher — this is normal</td><td>Wait. Review usually takes less than 24 hours.</td></tr>
                  <tr><td><strong>Active</strong></td><td>Your ad is running and showing to people</td><td>Nothing — this is what you want!</td></tr>
                  <tr><td><strong>Inactive</strong></td><td>Your ad is turned off</td><td>Check if you turned it off, or if there's an account issue</td></tr>
                  <tr><td><strong>Rejected</strong></td><td>Your ad didn't pass the publisher's review</td><td>Review your compliance guidelines and revise the ad</td></tr>
                  <tr><td><strong>Warning</strong></td><td>An issue with your account or payment at the publisher level</td><td>This is separate from your DIYTrax funding — contact support</td></tr>
                </tbody>
              </table>
            </div>

            <div className="path-block gh">
              <div className="path-block-label">✦ Grasshopper</div>
              <ul className="checklist">
                <li>Watch T0: <strong>Configure Campaign Basic Info Settings</strong></li>
                <li>Watch T1: <strong>Configure Traffic Source Settings</strong></li>
                <li>Watch T2: <strong>Upload Ad Banners</strong></li>
                <li>Watch T3: <strong>Fund Your Traffic Source</strong></li>
                <li>Watch T4: <strong>Place Affiliate Link in DIYTrax Campaign Offer Pages</strong></li>
                <li>Watch T5: <strong>Perform a Final QA Campaign Check</strong></li>
                <li>Watch T6: <strong>Submit Ad Banners and Turn Campaign Toggle to Active</strong></li>
                <li>Watch T7: <strong>How Grasshopper Traffic Source Works and What to Expect</strong></li>
              </ul>
            </div>

            <div className="path-block cr">
              <div className="path-block-label">✦ Crane</div>
              <p>Follow the same DIYTrax setup flow as Grasshopper above. Crane-specific settings are covered in the Publisher Overview section. If you need additional guidance, contact the support team or bring it to a coaching call.</p>
            </div>

            <div className="alert success">
              <strong>🎉 Your campaign is now live!</strong>
              This is a big milestone. Now move to Module 2 — but remember: do not make any changes to your campaign until you've spent at least $25 per ad or $500 total. Making changes too early, based on too little data, is one of the most common mistakes beginners make.
            </div>
          </div>


          {/* MODULE 2: TEST */}
          <div className="module" id="module2">
            <div className="module-header">
              <span className="module-badge test">Module 2</span>
              <h2>Test — Find Your Winners Through Data</h2>
            </div>

            <div className="module-intro">
              The Test phase is where your campaign gets smarter — but it takes time and patience. Most students go through <strong>multiple rounds of testing</strong> before they're ready to scale. That's not a sign of failure; it's how the system is designed to work. Think of it like learning to ride a bike — the first few attempts are wobbly, but each one teaches you something that makes the next attempt better. Each round gives you clearer data, which leads to better decisions, which leads to better results. How quickly you move through the Test phase depends largely on how quickly you develop your skills in writing effective headlines and choosing the right images — so invest time in your training and don't rush it.
            </div>

            <h3>Your Daily Monitoring Routine <span className="path-tag tag-all">Everyone</span></h3>
            <div className="card">
              <p><strong>Once per day</strong> — that's all you need. Here's what to do each day your campaign is running:</p>
              <ul>
                <li>Log into DIYTrax and confirm traffic data is flowing (numbers are updating)</li>
                <li>Update your P&L Tracker™ with today's spend and revenue</li>
                <li>Note trends in these three metrics, in this order of importance: <strong>Conversions (sales) → Ad CTR → Landing Page CTR</strong></li>
              </ul>
              <div className="plain-english">
                <div className="pe-label">💡 Don't panic over a single bad day</div>
                Ad performance fluctuates day to day. What matters is the trend over several days. One bad day followed by two good days is fine. Focus on cumulative data, not today's numbers.
              </div>
            </div>

            <p>Watch: <strong>How to Set Up Your P&L Tracker</strong> — set this up after Round 1 launches so you have a clean record from the start.</p>

            <hr className="divider" />

            {/* Round 1 */}
            <h3>Round 1 — Finding Your Winning Headline</h3>

            <p>Round 1 has one primary goal: find the headline that your audience responds to best. Everything else — images, placements, creative formats — gets tested in later rounds, using the winning headline from Round 1. This sequencing is intentional. Headlines are the most powerful element in your campaign. Get that right first.</p>

            <div className="path-block cat">
              <div className="path-block-label">✦ Caterpillar — Round 1</div>
              <p><strong>The question you're answering:</strong> Which of my 10 ad headlines gets the most people to click through?</p>
              <p><strong>What's running:</strong> 10 headlines + 1 description + 1 image, showing to real people, while 25 landing page combinations rotate in the background</p>
              <p><strong>Minimum spend:</strong> $500 before making any final decisions</p>
            </div>

            <div className="path-block gh">
              <div className="path-block-label">✦ Grasshopper / Crane — Round 1</div>
              <p><strong>The question you're answering:</strong> Which of my 20 banner headlines resonates with this audience?</p>
              <p><strong>What's running:</strong> 20 banner ads (20 headlines, 1 image), while 25 landing page combinations rotate</p>
              <p><strong>Minimum spend:</strong> $1,500 before making final landing page decisions</p>
            </div>

            <h4>When to Cut Underperforming Ads — Spend Milestones</h4>
            <p>One of the hardest things for new students is knowing when to turn off an ad that isn't working. Do it too early and you waste a potential winner. Do it too late and you waste budget. Follow these milestones:</p>

            <div className="path-block cat">
              <div className="path-block-label">✦ Caterpillar</div>
              <div className="milestone">
                <div className="ms-item">
                  <div className="ms-amount">$25 per ad</div>
                  <div className="ms-do">Turn off any ad with zero landing page clicks despite 33+ ad clicks — it's a clear loser</div>
                </div>
                <div className="ms-item">
                  <div className="ms-amount">$500 total</div>
                  <div className="ms-do">You now have enough data. Identify your 1 best-performing headline. Proceed to the Round 1 Exit Gate.</div>
                </div>
              </div>
            </div>

            <div className="path-block gh">
              <div className="path-block-label">✦ Grasshopper / Crane</div>
              <div className="milestone">
                <div className="ms-item">
                  <div className="ms-amount">$25 per banner</div>
                  <div className="ms-do">Begin pausing the worst performers — lowest sales rate, lowest ad click rate, lowest landing page click rate</div>
                </div>
                <div className="ms-item">
                  <div className="ms-amount">$500 total</div>
                  <div className="ms-do">Once 5 banners have each spent $80+ and been turned off, use their average performance as your benchmark for cutting others</div>
                </div>
                <div className="ms-item">
                  <div className="ms-amount">$750 total</div>
                  <div className="ms-do">Now look at your landing pages. Turn off the bottom 30–50% of your landing page combinations based on performance</div>
                </div>
                <div className="ms-item">
                  <div className="ms-amount">$1,500 total</div>
                  <div className="ms-do">Identify your top 1–2 landing pages and your 2+ best banner ads. Proceed to the Round 1 Exit Gate.</div>
                </div>
              </div>
            </div>

            <div className="alert warning">
              <strong>The Patience Rule</strong>
              Do not cut ads or make landing page decisions before reaching the spend milestones above. The data before those thresholds is too small a sample to be reliable. A headline that looks bad at $10 in spend might be your best performer at $30. Wait for the numbers.
            </div>

            <div className="video-slot">
              <div className="play-icon"></div>
              <div>
                <div className="vt">Round 1: When to Make a Banner Inactive</div>
                <div className="vd">Watch for a visual walkthrough of this decision-making process</div>
              </div>
            </div>
            <div className="video-slot">
              <div className="play-icon"></div>
              <div>
                <div className="vt">What To Do If Your Campaign Turns Off Before You've Spent the Full Amount</div>
                <div className="vd">How to reactivate your best performers: prioritize sales first, then landing page CTR, then ad CTR</div>
              </div>
            </div>

            <h4>Round 1 Exit Gate — Are You Ready for Round 2?</h4>

            <div className="path-block cat">
              <div className="path-block-label">✦ Caterpillar</div>
              <div className="gate pass">
                <div className="gate-header">✅ You Pass If: You've spent $500+ and can identify 1 winning headline</div>
                <p style={{fontSize: "0.9rem", margin: 0}}>→ Great work. Proceed to the "Round 1 Wrap-Up" section below, then start Round 2.</p>
              </div>
              <div className="gate fail">
                <div className="gate-header">❌ You Don't Pass If: After $500 spent, no clear headline winner emerged</div>
                <p style={{fontSize: "0.9rem", margin: 0, marginBottom: "8px"}}>Choose one of these two options:</p>
                <ul style={{margin: 0, fontSize: "0.9rem"}}>
                  <li><strong>Option A — New Headlines, Same Offer:</strong> Generate 10 completely new headlines and spend another $500 testing them. Choose this if you believe in the product but think your messaging missed the mark.</li>
                  <li><strong>Option B — Start Fresh with a New Offer:</strong> Choose a different product and restart from Step 1. Choose this if the product itself didn't seem to connect with any audience.</li>
                </ul>
                <p style={{fontSize: "0.9rem", marginTop: "8px", marginBottom: 0}}><em>Not sure which to choose? This is exactly what coaching calls are for — bring your data and get a recommendation.</em></p>
              </div>
            </div>

            <div className="path-block gh">
              <div className="path-block-label">✦ Grasshopper / Crane</div>
              <div className="gate pass">
                <div className="gate-header">✅ You Pass If: You've earned $300+ in commissions AND have 2+ banners that generated sales</div>
                <p style={{fontSize: "0.9rem", margin: 0}}>→ Proceed to the "Round 1 Wrap-Up" section below, then prepare for Round 2.</p>
              </div>
              <div className="gate fail">
                <div className="gate-header">❌ You Don't Pass If: Less than $300 in commissions, or fewer than 2 profitable banners</div>
                <ul style={{margin: 0, fontSize: "0.9rem", marginTop: "6px"}}>
                  <li><strong>Option A — New Headlines, Same Offer:</strong> Generate 20 new headlines and invest another $500. Choose this if you believe the offer is right but the messages weren't connecting.</li>
                  <li><strong>Option B — New Offer, Start Over:</strong> Pick a different product and restart. Choose this if the offer/audience fit felt wrong throughout.</li>
                </ul>
              </div>
            </div>

            <h4>Round 1 Wrap-Up — Typical Outcome</h4>
            <div className="card">
              <p>Here's what a normal, successful Round 1 looks like when you proceed to Round 2:</p>
              <table>
                <thead><tr><th></th><th>Caterpillar</th><th>Grasshopper / Crane</th></tr></thead>
                <tbody>
                  <tr><td>Total spent</td><td>~$500</td><td>~$1,500</td></tr>
                  <tr><td>Total returned</td><td>~$100</td><td>~$500</td></tr>
                  <tr><td>Net result</td><td>~−$400</td><td>~−$1,000</td></tr>
                  <tr><td>What you have</td><td colSpan={2}><strong>1 proven headline + data on which landing pages are working. This is the foundation Round 2 is built on.</strong></td></tr>
                </tbody>
              </table>
              <div className="alert success" style={{marginBottom: 0}}>
                <strong>Remember</strong>
                This loss is not a failure — it's the tuition you paid to find your winning headline. Round 2, built on that proven headline, will perform significantly better.
              </div>
            </div>

            <h4>🎁 Earn $1,000 in Ad Credits to Help Fund Round 2</h4>
            <div className="card">
              <p>After completing Round 1, you can earn <strong>$1,000 in free ad credits</strong> by recording a short 2–5 minute video about your experience in BTS so far. Email the video link to <strong>support@buildtestscale.com</strong> with the subject line <em>"Blitz Testimonial — [Your Name]"</em> and the credits will be added to your DIYTrax balance within 24 hours.</p>
              <p style={{fontSize: "0.85rem", color: "var(--blitz-muted)", marginBottom: 0}}>Any camera is fine. Upload to YouTube, Vimeo, or Google Drive and share the link. One submission per student.</p>
            </div>

            <hr className="divider" />

            {/* Between Rounds */}
            <h3>Between Rounds — Prep Round 2 Assets While Round 1 Is Running</h3>

            <p>You don't have to wait for Round 1 to finish before preparing your Round 2 materials. Once your Round 1 campaign is live and spending, start getting your Round 2 assets ready in parallel. This saves time.</p>

            <div className="path-block cat">
              <div className="path-block-label">✦ Caterpillar — Round 2 Asset Prep</div>
              <p>In Round 2, you'll test 6 different "placements" — different format and orientation combinations for your ad. You'll take your one Round 1 image and convert it into 5 additional formats:</p>
              <ul>
                <li>Static Image — 9:16 (portrait/vertical)</li>
                <li>Animated GIF — 16:9 (landscape)</li>
                <li>Animated GIF — 9:16 (portrait)</li>
                <li>Video — 16:9 (landscape)</li>
                <li>Video — 9:16 (portrait)</li>
              </ul>
              <p><strong>Tip:</strong> Use a free tool called Grok Imagine to animate your static image into GIFs and videos automatically.</p>
              <ul className="checklist">
                <li>Watch RD2-V1: <strong>How to Use Cropbot to Crop Your Image to 9:16</strong></li>
                <li>Watch RD2-V2: <strong>How to Create Videos From Your Base Image</strong></li>
                <li>Watch RD2-V3: <strong>How to Trim Video Length Using Adobe Express</strong></li>
                <li>Watch RD2-V4: <strong>How to Convert Videos to GIFs Using Adobe Express</strong></li>
                <li>Watch RD2-V5: <strong>How to Reduce GIF File Size Under 5MB Using GIFSTER</strong></li>
                <li>Watch RD2-V6: <strong>How to Convert Videos to GIFs Using GIFSTER</strong></li>
              </ul>
            </div>

            <div className="path-block gh">
              <div className="path-block-label">✦ Grasshopper / Crane — Round 2 Asset Prep</div>
              <p>In Round 2, you'll test 20 new banner images paired with your Round 1 winning headline. Start brainstorming and creating these images now. Experiment with different visual styles, emotions, and compositions. Use FreeAdCopy™ or any image tool to generate options. For Grasshopper, you can create both static and animated versions. For Crane, static only.</p>
            </div>

            <h4>Round 2 Landing Page Prep <span className="path-tag tag-all">Everyone</span></h4>

            <div className="path-block mm">
              <div className="path-block-label">✦ Media Mavens</div>
              <p><strong>Create 5 new headlines for Round 2:</strong> If your Round 1 winning headlines performed well, try close variations — change just a few words to see if you can make them stronger. If they underperformed, use AffiliateCMO or FreeAdCopy™ to generate completely new ideas.</p>
              <p><strong>Create 5 new hero shots:</strong> Same logic — keep close variations of what worked, replace what didn't. Set up a new MetricMover project for these 25 new combinations.</p>
            </div>

            <div className="path-block cb">
              <div className="path-block-label">✦ ClickBank / MaxWeb</div>
              <p>Look at your Round 1 landing page data. Which of your 10 pages generated the most sales? Which had the highest click-through rates? Use those insights to build your next set of landing page variants — improve on what worked, drop what didn't.</p>
            </div>

            <hr className="divider" />

            {/* Round 2 */}
            <h3>Round 2 — Finding Your Winning Format or Image</h3>

            <div className="path-block cat">
              <div className="path-block-label">✦ Caterpillar — Round 2</div>
              <p><strong>The question you're answering:</strong> Which of the 6 ad formats (static image, animated GIF, or video, in landscape or portrait) performs best with my proven headline?</p>
              <p><strong>What's running:</strong> 6 ads — all using your Round 1 winning headline and description — split into two sub-campaigns (16:9 formats in one, 9:16 formats in the other)</p>
              <p><strong>Minimum spend:</strong> 2 × your commission payout × 6 placements. Example: if you earn $50 per sale → 2 × $50 × 6 = $600 minimum</p>

              <div className="gate pass">
                <div className="gate-header">✅ Round 2 Pass: Your best placement is returning 60%+ of your spend in commissions</div>
                <p style={{fontSize: "0.9rem", margin: 0}}>Example: You spend $1,000 and earn $600 or more in commissions. → Proceed to Round 3.</p>
              </div>
              <div className="gate fail">
                <div className="gate-header">❌ Round 2 Fail: Best placement returns less than 60%</div>
                <p style={{fontSize: "0.9rem", margin: 0}}>Don't panic — this means your headline needs more work. Take your best-performing placement and test a new round of 5 headlines × 2 descriptions (10 ads total). Spend at least 1× your commission payout per ad before making cuts.</p>
              </div>

              <div className="video-slot">
                <div className="play-icon"></div>
                <div>
                  <div className="vt">How to Create Ads and Launch Caterpillar Round 2</div>
                  <div className="vd">Walk-through of setting up and launching your 6-placement test</div>
                </div>
              </div>
            </div>

            <div className="path-block gh">
              <div className="path-block-label">✦ Grasshopper / Crane — Round 2</div>
              <p><strong>The question you're answering:</strong> Which of 20 banner images works best with my Round 1 winning headline?</p>
              <p><strong>What's running:</strong> 20 new banner ads — all using your winning headline from Round 1 — on the same placement as Round 1 (no new minimum budget required)</p>
              <p><strong>Minimum spend:</strong> $500+ (about $25 per image)</p>

              <div className="gate pass">
                <div className="gate-header">✅ Round 2 Pass: 2 or more new sales, and your total campaign spend reaches $2,000</div>
                <p style={{fontSize: "0.9rem", margin: 0}}>→ You're ready for the Scale Phase!</p>
              </div>
              <div className="gate fail">
                <div className="gate-header">❌ Round 2 Fail: Fewer than 2 new sales after $500 spent</div>
                <p style={{fontSize: "0.9rem", margin: 0}}>→ Return to Round 1 options: generate new headlines (Option A) or choose a new offer (Option B).</p>
              </div>
            </div>

            <hr className="divider" />

            {/* Round 3 */}
            <h3>Round 3 — Finding Your Winning Visual Creative <span className="path-tag tag-cat">Caterpillar Path Only</span></h3>

            <p><strong>The question you're answering:</strong> Which specific visual — which exact image, GIF, or video — converts best on my winning format?</p>
            <p><strong>What's running:</strong> Take your Round 2 winning placement format (for example, 9:16 animated GIF) and create 9 new versions of it. You'll test all 10 (the original + 9 new) against each other, all using your Round 1 winning headline and description.</p>
            <p><strong>Minimum spend:</strong> 2 × your commission payout × 10 ads. Example: $50 commission × 2 × 10 = $1,000 minimum</p>

            <div className="gate pass">
              <div className="gate-header">✅ Round 3 Pass: Your best ad is returning 75%+ of your spend in commissions</div>
              <p style={{fontSize: "0.9rem", margin: 0, marginBottom: "8px"}}>Example: You spend $1,000 and earn $750 or more. → You're ready for the Scale Phase!</p>
              <p style={{fontSize: "0.9rem", margin: 0}}><em>Next suggestion: consider testing your Description — it's the one element you haven't deeply tested yet. Your advertorial (headline, hero shot, opening copy) is also a high-leverage area for further improvement.</em></p>
            </div>
            <div className="gate fail">
              <div className="gate-header">❌ Round 3 Fail: Best ad returns less than 75%</div>
              <p style={{fontSize: "0.9rem", margin: 0, marginBottom: "8px"}}>Find your weakest link and fix it. Look at each element:</p>
              <ul style={{margin: 0, fontSize: "0.9rem"}}>
                <li>Ad headline — does it grab attention?</li>
                <li>Ad description — does it support the headline?</li>
                <li>Ad visual — is the image/video the right emotional match?</li>
                <li>Advertorial headline — does it carry through the ad's promise?</li>
                <li>Advertorial hero shot — does the image reinforce the message?</li>
                <li>Advertorial opening — does the first paragraph pull people in?</li>
              </ul>
              <p style={{fontSize: "0.9rem", marginTop: "8px", marginBottom: 0}}>Test your suspected weakest element in isolation. Cut losers as you identify them. Attend a coaching call if you're not sure where the weakness is.</p>
            </div>
          </div>


          {/* MODULE 3: SCALE */}
          <div className="module" id="module3">
            <div className="module-header">
              <span className="module-badge scale">Module 3</span>
              <h2>Scale — Multiply Your Profits</h2>
            </div>

            <div className="module-intro">
              Scaling is the exciting part — but it only works if you've done the testing properly. You are not introducing new ideas at this stage. You are spending more money on the exact ads and pages that have already proven they work. Think of it like finding a machine that turns $1 into $1.20, then feeding it more and more $1 bills.
            </div>

            <div className="alert danger">
              <strong>You Must Meet ALL of These Before Scaling</strong>
              Rounds 1 and 2 (and Round 3 for Caterpillar) are complete. You have found ad + landing page combinations that are profitable or near-profitable. You have met the success criteria from your last round. Scaling without meeting these criteria is how people lose money.
            </div>

            <div className="method-grid">
              <div className="method-card">
                <div className="mc-num">Method 1</div>
                <h4>Spend More on What's Working</h4>
                <p>Increase your daily budget and cost-per-click bids on profitable placements. Remove all non-profitable ads first. Try 2× budget, let it stabilize, then try 5×, then 10×. Example: profiting $50/day at $100 spend → test $200/day, then $500/day.</p>
              </div>
              <div className="method-card">
                <div className="mc-num">Method 2</div>
                <h4>Test New Ad Placements</h4>
                <p>Take your proven ads and proven landing pages to new placements across publishers. Budget $1,500 minimum per new placement. Testing 2–3 new placements costs $3,000–$4,500. This expands your reach while using only what's already proven to work.</p>
              </div>
              <div className="method-card">
                <div className="mc-num">Method 3</div>
                <h4>Graduate to the Master Publisher</h4>
                <p>A dedicated email blast to a large, engaged subscriber list. Much bigger reach, higher potential return — but also higher risk. Only attempt after 14+ consecutive days of profitability on your current publishers.</p>
              </div>
            </div>

            <h3>Master Publisher Requirements</h3>
            <div className="card">
              <p>The Master publisher works differently from banner and native ads — you're sending a single email to a large list rather than showing ads to browsing visitors. The bar is higher because the stakes are higher. Make sure you've checked all of these before trying it:</p>
              <ul className="checklist">
                <li>At least 14 consecutive days of profitable campaigns on Caterpillar, Grasshopper, or Crane</li>
                <li>Your single best-performing headline + image combination is clearly identified</li>
                <li>Your single best-performing landing page is clearly identified</li>
                <li>You have dedicated budget set aside specifically for this test</li>
              </ul>
            </div>

            <h3>Where Your Proven Ads Can Run During Scaling</h3>
            <div className="card">
              <table>
                <thead><tr><th>Publisher</th><th>Placement Options</th><th>Networks</th><th>Min. per New Placement</th></tr></thead>
                <tbody>
                  <tr>
                    <td><span className="path-tag tag-cat">Caterpillar</span></td>
                    <td>Static image, GIF, or video in 16:9 and 9:16</td>
                    <td>MM, CB, MaxWeb</td>
                    <td>No minimum (already active)</td>
                  </tr>
                  <tr>
                    <td><span className="path-tag tag-gh">Grasshopper</span></td>
                    <td>970×250, 300×250, 970×550</td>
                    <td>MM, CB, MaxWeb</td>
                    <td>$1,500 for new placement</td>
                  </tr>
                  <tr>
                    <td><span className="path-tag tag-cr">Crane</span></td>
                    <td>970×250, 1536×864, 900×750, 1242×699 (static only)</td>
                    <td>MM only</td>
                    <td>$1,500 for new placement</td>
                  </tr>
                  <tr>
                    <td><strong>Master</strong></td>
                    <td>Dedicated email blast</td>
                    <td>All (with requirements)</td>
                    <td>Discussed with your coach</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <h3>Example Scaling Timeline</h3>
            <div className="card">
              <table>
                <thead><tr><th>Week</th><th>What You're Doing</th></tr></thead>
                <tbody>
                  <tr><td><strong>Week 1</strong></td><td>Complete testing rounds. Identify your winning ads and landing pages.</td></tr>
                  <tr><td><strong>Week 2</strong></td><td>Increase daily budget on your winning placements (Method 1). Monitor closely at 2× and 5× budget.</td></tr>
                  <tr><td><strong>Week 3</strong></td><td>Test your proven creatives on new placements (Method 2). Remember: $1,500 minimum per new placement.</td></tr>
                  <tr><td><strong>Week 4+</strong></td><td>If you have 14+ days of documented profitability, discuss the Master publisher with your coach.</td></tr>
                </tbody>
              </table>
            </div>

            <div className="alert success">
              <strong>Ready to scale but want guidance?</strong>
              Join a coaching call to review your numbers and get a specific scaling recommendation. Or contact BTS Concierge™ for done-for-you scaling support.
            </div>
          </div>


          {/* SUPPORT */}
          <div className="module" id="support">
            <div className="module-header">
              <span className="module-badge">Support</span>
              <h2>You're Never Alone in This</h2>
            </div>

            <p>Every successful media buyer started exactly where you are right now. The system works when you follow the steps, trust the data, and use the support resources available to you. Here's a quick reminder of what's available and when to use it:</p>

            <div className="support-grid">
              <div className="support-card">
                <div className="sc-type">📅 Coaching Calls — 6 days/week</div>
                Use when: You're at a decision point. You've completed a round and aren't sure whether you pass the exit gate. You want to discuss your data with an expert before spending more.
              </div>
              <div className="support-card">
                <div className="sc-type">💬 BTS Community — 24/7</div>
                Use when: You have a quick question that doesn't require a full coaching call. You want to see how other students handled a similar situation. You need encouragement or inspiration.
              </div>
              <div className="support-card">
                <div className="sc-type">🛠 BTS Concierge™ — Done-For-You</div>
                Use when: A technical issue is blocking your progress. You want a step handled for you so you can stay focused on the strategy. Available for any step of the process.
              </div>
            </div>

            <div className="card">
              <div className="card-title">Technical Support</div>
              <p>If something isn't working — a campaign won't go live, DIYTrax isn't tracking correctly, Flexy™ isn't behaving as expected — contact the support team directly for same-day help. Don't let a technical issue stop your momentum. That's exactly what the support team is here for.</p>
            </div>

            <div className="alert info">
              <strong>One Last Reminder</strong>
              The biggest difference between students who succeed and those who don't isn't talent or prior experience — it's whether they follow the process consistently and ask for help when they get stuck. Use your resources. That's what they're there for.
            </div>
          </div>

        </div>
      </div>
    </AppLayout>
  );
}
