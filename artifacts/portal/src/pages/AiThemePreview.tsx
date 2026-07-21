import { useEffect, useState } from "react";
import {
  Send, Bot, Sparkles, MessageCircle, WandSparkles, Zap,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import botLogo from "@/assets/ai-assistant-logo.png";

/**
 * Typography / spacing / divider / icon comparison lab for the AI Assistant.
 * Everything renders in the locked-in "Soft Blue Whisper" theme so the
 * comparisons are apples-to-apples. Nothing here affects the live page.
 */

const W = {
  pageBg: "#FAF9F7",
  cardBg: "#FDFDFE",
  cardBorder: "#D6DEEC",
  cardShadow:
    "0 20px 50px -20px rgba(51,65,85,0.18), 0 8px 20px -8px rgba(51,65,85,0.08)",
  headerBorder: "#E4E9F2",
  userBubbleBg: "#E7EDF9",
  text: "#1E293B",
  secondaryText: "#64748B",
  mutedText: "#94A3B8",
  accent: "#3B5FA8",
  link: "#2F55A4",
  inputBg: "#F6F8FC",
  avatarBg: "#E7EDF9",
  avatarRing: "#D6DEEC",
  codeBg: "#EEF1F7",
  codeText: "#334155",
};

const GOOGLE_FONTS_HREF =
  "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Manrope:wght@400;500;600;700&family=Source+Serif+4:opsz,wght@8..60,400;8..60,600&family=Lora:wght@400;600&display=swap";

interface FontVariant {
  id: string;
  label: string;
  note: string;
  family: string;
  size: string;
}

const FONT_VARIANTS: FontVariant[] = [
  {
    id: "roboto",
    label: "Roboto (current)",
    note: "The portal's existing baseline font.",
    family: "'Roboto', sans-serif",
    size: "15px",
  },
  {
    id: "inter",
    label: "Inter",
    note: "Neutral, highly legible UI sans — the modern default for product text.",
    family: "'Inter', sans-serif",
    size: "15px",
  },
  {
    id: "manrope",
    label: "Manrope",
    note: "Slightly rounded, friendlier geometric sans with more personality.",
    family: "'Manrope', sans-serif",
    size: "15px",
  },
  {
    id: "serif",
    label: "Serif answers (Claude-style)",
    note: "Warm readable serif (Source Serif 4) for answer bodies only — UI chrome stays sans.",
    family: "'Source Serif 4', 'Lora', Georgia, serif",
    size: "16px",
  },
];

interface SpacingVariant {
  id: string;
  label: string;
  note: string;
  lineHeight: number;
  paragraphGap: number;
  headingTop: number;
  listGap: number;
  itemGap: number;
}

const SPACING_VARIANTS: SpacingVariant[] = [
  {
    id: "current",
    label: "Current (crowded)",
    note: "leading-7 with 8px paragraph gaps — everything runs together vertically.",
    lineHeight: 1.867,
    paragraphGap: 8,
    headingTop: 8,
    listGap: 8,
    itemGap: 2,
  },
  {
    id: "corrected",
    label: "Corrected hierarchy",
    note: "~1.55 line-height, 14px between paragraphs, 28px above headings/sections.",
    lineHeight: 1.55,
    paragraphGap: 14,
    headingTop: 28,
    listGap: 14,
    itemGap: 6,
  },
];

interface DividerVariant {
  id: string;
  label: string;
  note: string;
  style: React.CSSProperties;
}

const DIVIDER_VARIANTS: DividerVariant[] = [
  {
    id: "current",
    label: "Current default hr",
    note: "Full-width browser-default rule — heavy and boxy.",
    style: {
      border: "none",
      borderTop: "1px solid #CBD5E1",
      width: "100%",
      margin: "12px 0",
    },
  },
  {
    id: "hairline",
    label: "Restyled hairline",
    note: "Low-contrast blue-gray tint, 28px vertical breathing room, 50% width, centered.",
    style: {
      border: "none",
      borderTop: "1px solid #DDE3EE",
      width: "50%",
      margin: "28px auto",
    },
  },
];

interface IconVariant {
  id: string;
  label: string;
  note: string;
  render: (size: "sm" | "lg") => React.ReactNode;
}

function IconBadge({
  children,
  size,
  bg,
  ring,
}: {
  children: React.ReactNode;
  size: "sm" | "lg";
  bg?: string;
  ring?: string;
}) {
  const px = size === "sm" ? 32 : 56;
  return (
    <div
      className="rounded-full flex items-center justify-center shrink-0"
      style={{
        width: px,
        height: px,
        background: bg ?? W.avatarBg,
        boxShadow: `inset 0 0 0 1px ${ring ?? W.avatarRing}`,
      }}
    >
      {children}
    </div>
  );
}

const ICON_VARIANTS: IconVariant[] = [
  {
    id: "bot",
    label: "Bot (current)",
    note: "The existing robot icon — functional but reads dated.",
    render: (s) => (
      <IconBadge size={s}>
        <Bot style={{ color: W.accent }} className={s === "sm" ? "w-4 h-4" : "w-7 h-7"} />
      </IconBadge>
    ),
  },
  {
    id: "sparkles",
    label: "Sparkles",
    note: "The de-facto \"AI\" glyph — instantly recognizable, light and modern.",
    render: (s) => (
      <IconBadge size={s}>
        <Sparkles style={{ color: W.accent }} className={s === "sm" ? "w-4 h-4" : "w-7 h-7"} />
      </IconBadge>
    ),
  },
  {
    id: "orb",
    label: "Gradient orb",
    note: "Abstract whisper-blue orb badge — no glyph at all, calm and premium.",
    render: (s) => (
      <IconBadge
        size={s}
        bg="radial-gradient(circle at 32% 28%, #A8BEE8 0%, #5B7FC7 45%, #3B5FA8 100%)"
        ring="rgba(59,95,168,0.35)"
      >
        <span
          className="rounded-full"
          style={{
            width: s === "sm" ? 10 : 18,
            height: s === "sm" ? 10 : 18,
            background: "rgba(255,255,255,0.55)",
            filter: "blur(3px)",
          }}
        />
      </IconBadge>
    ),
  },
  {
    id: "message-spark",
    label: "MessageCircle + spark",
    note: "Chat bubble with a tiny spark — says \"conversation\" first, \"AI\" second.",
    render: (s) => (
      <IconBadge size={s}>
        <span className="relative inline-flex">
          <MessageCircle
            style={{ color: W.accent }}
            className={s === "sm" ? "w-4 h-4" : "w-7 h-7"}
          />
          <Zap
            style={{ color: W.accent, fill: W.accent }}
            className={
              (s === "sm" ? "w-2 h-2" : "w-3.5 h-3.5") +
              " absolute -top-0.5 -right-1"
            }
          />
        </span>
      </IconBadge>
    ),
  },
  {
    id: "wand",
    label: "WandSparkles",
    note: "Magic-wand + sparkles — playful \"assistant magic\" without the robot.",
    render: (s) => (
      <IconBadge size={s}>
        <WandSparkles
          style={{ color: W.accent }}
          className={s === "sm" ? "w-4 h-4" : "w-7 h-7"}
        />
      </IconBadge>
    ),
  },
];

// ---- Logo vertical-alignment lab -------------------------------------------
// The uploaded 100x100 PNG has transparent vertical padding, so the head can
// look low/small inside the avatar circle. These variants let the user pick a
// vertical treatment per location by label.
interface LogoAlignVariant {
  id: string;
  label: string;
  note: string;
  imgStyle: React.CSSProperties;
}

const LOGO_ALIGN_VARIANTS: LogoAlignVariant[] = [
  {
    id: "A",
    label: "A · No adjustment",
    note: "Raw PNG centered as-is — head appears smaller due to the transparent padding.",
    imgStyle: {},
  },
  {
    id: "B",
    label: "B · Small upward nudge",
    note: "Same size, shifted up 2px to sit against the first text line.",
    imgStyle: { transform: "translateY(-2px)" },
  },
  {
    id: "C",
    label: "C · Larger nudge",
    note: "Same size, shifted up 4px — for when the head should hug the title.",
    imgStyle: { transform: "translateY(-4px)" },
  },
  {
    id: "D",
    label: "D · Scale-up (current live default)",
    note: "Scaled ~1.3× to crop out the transparent padding so the head fills the circle.",
    imgStyle: { transform: "scale(1.3)" },
  },
];

function LogoBadge({ variant, px = 32 }: { variant: LogoAlignVariant; px?: number }) {
  return (
    <div
      className="rounded-full flex items-center justify-center shrink-0 overflow-hidden"
      style={{
        width: px,
        height: px,
        background: W.avatarBg,
        boxShadow: `inset 0 0 0 1px ${W.avatarRing}`,
      }}
    >
      <img
        src={botLogo}
        alt=""
        draggable={false}
        style={{ width: "100%", height: "100%", objectFit: "contain", ...variant.imgStyle }}
      />
    </div>
  );
}

function LogoAlignmentSection() {
  return (
    <div
      className="rounded-2xl p-4 md:p-5 mb-5"
      style={{ backgroundColor: "#FFFFFF", border: `1px solid ${W.cardBorder}` }}
      data-testid="logo-alignment-section"
    >
      <p
        className="text-[11px] font-semibold uppercase tracking-wider mb-1"
        style={{ color: W.mutedText }}
      >
        Logo alignment
      </p>
      <p className="text-sm mb-4 max-w-3xl" style={{ color: W.secondaryText }}>
        The bot-head PNG has transparent vertical padding, so pick how it should sit
        against neighboring text — one choice for the page header, one for inline chat
        messages. Tell me the letter for each location.
      </p>

      <p className="text-[12px] font-semibold mb-2" style={{ color: W.text }}>
        1 · Header (next to title + subtitle)
      </p>
      <div className="grid gap-3 md:grid-cols-2 mb-5">
        {LOGO_ALIGN_VARIANTS.map((v) => (
          <div
            key={`header-${v.id}`}
            className="rounded-xl p-3"
            style={{ border: `1px solid ${W.cardBorder}`, backgroundColor: W.cardBg }}
            data-testid={`logo-align-header-${v.id}`}
          >
            <p className="text-[11px] font-semibold mb-2" style={{ color: W.accent }}>
              {v.label}
            </p>
            <div className="flex items-center gap-2.5 min-w-0">
              <LogoBadge variant={v} px={32} />
              <div className="min-w-0 leading-tight">
                <h2 className="font-semibold text-sm truncate" style={{ color: W.text }}>
                  BTS AI Assistant
                </h2>
                <p className="text-[11px]" style={{ color: W.secondaryText }}>
                  Powered by your BTS knowledge base
                </p>
              </div>
            </div>
            <p className="text-[11px] mt-2" style={{ color: W.secondaryText }}>
              {v.note}
            </p>
          </div>
        ))}
      </div>

      <p className="text-[12px] font-semibold mb-2" style={{ color: W.text }}>
        2 · Inline chat message (next to the first line of an answer)
      </p>
      <div className="grid gap-3 md:grid-cols-2">
        {LOGO_ALIGN_VARIANTS.map((v) => (
          <div
            key={`chat-${v.id}`}
            className="rounded-xl p-3"
            style={{ border: `1px solid ${W.cardBorder}`, backgroundColor: W.cardBg }}
            data-testid={`logo-align-chat-${v.id}`}
          >
            <p className="text-[11px] font-semibold mb-2" style={{ color: W.accent }}>
              {v.label}
            </p>
            <div className="flex gap-3">
              <div className="mt-0.5">
                <LogoBadge variant={v} px={32} />
              </div>
              <div className="flex-1 min-w-0 pt-1">
                <p
                  className="font-semibold text-[1.1em] leading-[1.3] mb-1.5"
                  style={{ color: W.text }}
                >
                  Your first week of campaign testing
                </p>
                <p
                  className="text-[15px]"
                  style={{ color: W.text, lineHeight: 1.55 }}
                >
                  The first week is all about gathering clean data, not making money yet.
                </p>
              </div>
            </div>
            <p className="text-[11px] mt-2" style={{ color: W.secondaryText }}>
              {v.note}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

const SAMPLE_QUESTION =
  "How should I structure my first week of campaign testing?";

const SAMPLE_ANSWER = `## Your first week of campaign testing

Great question! The first week is all about gathering clean data, not making money yet. Most members who rush to scale in week one end up burning budget on unvalidated angles.

Here's the mindset shift: you're paying for **information**, not conversions. Every dollar spent should answer a specific question about your audience, angle, or offer.

---

### Day 1–2: Setup and baselines

Start with the fundamentals before spending anything:

- Set up your tracker under \`Campaigns → New\` and verify the postback fires
- Pick **one offer** and **three angles** — no more, or your data gets too thin
- Write down your kill criteria *before* launch (e.g. pause any ad set with no clicks after $10)

### Day 3–5: Controlled testing

Run each angle at a small, equal budget so the comparison is fair:

| Phase | Daily budget | Goal | Kill signal |
|-------|-------------|------|-------------|
| Testing | $10–20 per angle | Find a working angle | CTR < 0.8% after $15 |
| Validation | $30–40 | Confirm \`ROAS > 1.2\` | ROAS < 0.9 over 3 days |
| Early scaling | +20% every 3 days | Stable profitability | ROAS drops 2 days straight |

---

### Day 6–7: Read the data

By the weekend you should have enough signal to make one clear decision per angle: **kill, iterate, or validate**. Check the full walkthrough in the [Campaign Tracker guide](#) for how to read each column.

A quick sanity checklist before week two:

1. Tracker postbacks verified on every campaign
2. At least one angle with CTR above your baseline
3. Kill criteria applied without exceptions — no "just one more day"

---

If you get stuck on any step, ask me here or check the [help center](#). Week two is where we start scaling what survived.`;

function SampleAnswer({
  font,
  spacing,
  divider,
}: {
  font: FontVariant;
  spacing: SpacingVariant;
  divider: DividerVariant;
}) {
  const pStyle: React.CSSProperties = {
    margin: `0 0 ${spacing.paragraphGap}px`,
    lineHeight: spacing.lineHeight,
  };
  const hBase: React.CSSProperties = {
    marginTop: spacing.headingTop,
    marginBottom: Math.max(8, Math.round(spacing.paragraphGap * 0.75)),
    fontWeight: 600,
    lineHeight: 1.3,
    color: W.text,
    fontFamily: font.id === "serif" ? "'Roboto', sans-serif" : undefined,
  };
  return (
    <div
      style={{
        fontFamily: font.family,
        fontSize: font.size,
        color: W.text,
        lineHeight: spacing.lineHeight,
      }}
      data-testid="sample-answer"
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ node: _n, ...props }) => <p {...props} style={pStyle} />,
          h2: ({ node: _n, ...props }) => (
            <h2 {...props} style={{ ...hBase, fontSize: "1.25em" }} />
          ),
          h3: ({ node: _n, ...props }) => (
            <h3 {...props} style={{ ...hBase, fontSize: "1.1em" }} />
          ),
          hr: ({ node: _n, ...props }) => <hr {...props} style={divider.style} />,
          ul: ({ node: _n, ...props }) => (
            <ul
              {...props}
              style={{
                margin: `0 0 ${spacing.listGap}px`,
                paddingLeft: 22,
                listStyleType: "disc",
              }}
            />
          ),
          ol: ({ node: _n, ...props }) => (
            <ol
              {...props}
              style={{
                margin: `0 0 ${spacing.listGap}px`,
                paddingLeft: 22,
                listStyleType: "decimal",
              }}
            />
          ),
          li: ({ node: _n, ...props }) => (
            <li
              {...props}
              style={{
                marginBottom: spacing.itemGap,
                lineHeight: spacing.lineHeight,
              }}
            />
          ),
          a: ({ node: _n, ...props }) => (
            <a
              {...props}
              onClick={(e) => e.preventDefault()}
              style={{ color: W.link, textDecoration: "underline" }}
            />
          ),
          strong: ({ node: _n, ...props }) => (
            <strong {...props} style={{ color: W.text, fontWeight: 600 }} />
          ),
          code: ({ node: _n, ...props }) => (
            <code
              {...props}
              className="px-1.5 py-0.5 rounded"
              style={{
                backgroundColor: W.codeBg,
                color: W.codeText,
                fontSize: "0.85em",
                fontFamily:
                  "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
              }}
            />
          ),
          table: ({ node: _n, ...props }) => (
            <div className="overflow-x-auto max-w-full" style={{ margin: `${spacing.listGap}px 0` }}>
              <table
                {...props}
                style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.92em" }}
              />
            </div>
          ),
          th: ({ node: _n, ...props }) => (
            <th
              {...props}
              style={{
                border: `1px solid ${W.cardBorder}`,
                backgroundColor: W.codeBg,
                padding: "6px 12px",
                textAlign: "left",
                fontWeight: 600,
                color: W.text,
              }}
            />
          ),
          td: ({ node: _n, ...props }) => (
            <td
              {...props}
              style={{
                border: `1px solid ${W.cardBorder}`,
                padding: "6px 12px",
                verticalAlign: "top",
              }}
            />
          ),
        }}
      >
        {SAMPLE_ANSWER}
      </ReactMarkdown>
    </div>
  );
}

function VariantPicker<T extends { id: string; label: string }>({
  title,
  options,
  value,
  onChange,
  testPrefix,
}: {
  title: string;
  options: T[];
  value: string;
  onChange: (id: string) => void;
  testPrefix: string;
}) {
  return (
    <div>
      <p
        className="text-[11px] font-semibold uppercase tracking-wider mb-1.5"
        style={{ color: W.mutedText }}
      >
        {title}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => {
          const active = o.id === value;
          return (
            <button
              key={o.id}
              onClick={() => onChange(o.id)}
              className="px-3 py-1.5 rounded-full text-[13px] font-medium transition-colors border"
              style={{
                backgroundColor: active ? W.accent : "#FFFFFF",
                color: active ? "#FFFFFF" : W.secondaryText,
                borderColor: active ? W.accent : W.cardBorder,
              }}
              data-testid={`button-${testPrefix}-${o.id}`}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function AiThemePreview() {
  const [fontId, setFontId] = useState(FONT_VARIANTS[0].id);
  const [spacingId, setSpacingId] = useState(SPACING_VARIANTS[0].id);
  const [dividerId, setDividerId] = useState(DIVIDER_VARIANTS[0].id);
  const [iconId, setIconId] = useState(ICON_VARIANTS[0].id);

  // Load the comparison fonts only on this page so the rest of the portal
  // keeps its Roboto baseline untouched.
  useEffect(() => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = GOOGLE_FONTS_HREF;
    document.head.appendChild(link);
    return () => {
      document.head.removeChild(link);
    };
  }, []);

  const font = FONT_VARIANTS.find((f) => f.id === fontId)!;
  const spacing = SPACING_VARIANTS.find((s) => s.id === spacingId)!;
  const divider = DIVIDER_VARIANTS.find((d) => d.id === dividerId)!;
  const icon = ICON_VARIANTS.find((i) => i.id === iconId)!;

  return (
    <div
      className="min-h-screen px-4 md:px-8 py-6"
      style={{ backgroundColor: W.pageBg, fontFamily: "'Roboto', sans-serif" }}
    >
      <div className="max-w-6xl mx-auto">
        <div className="mb-5">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-stone-400 mb-1">
            AI Assistant · Typography &amp; icon comparison lab
          </p>
          <h1
            className="text-2xl font-bold leading-tight"
            style={{ color: W.text }}
            data-testid="text-preview-title"
          >
            Font, spacing, divider &amp; icon variants
          </h1>
          <p className="text-sm mt-1 max-w-3xl" style={{ color: W.secondaryText }}>
            The Soft Blue Whisper color theme is now live on the assistant. Pick a
            combination below — the same realistic sample answer re-renders instantly
            under each variant so the differences are easy to judge.
          </p>
        </div>

        {/* Controls */}
        <div
          className="rounded-2xl p-4 md:p-5 mb-5 grid gap-4 md:grid-cols-2"
          style={{
            backgroundColor: "#FFFFFF",
            border: `1px solid ${W.cardBorder}`,
          }}
          data-testid="variant-controls"
        >
          <VariantPicker
            title="Answer font"
            options={FONT_VARIANTS}
            value={fontId}
            onChange={setFontId}
            testPrefix="font"
          />
          <VariantPicker
            title="Line spacing & rhythm"
            options={SPACING_VARIANTS}
            value={spacingId}
            onChange={setSpacingId}
            testPrefix="spacing"
          />
          <VariantPicker
            title="Divider style"
            options={DIVIDER_VARIANTS}
            value={dividerId}
            onChange={setDividerId}
            testPrefix="divider"
          />
          <VariantPicker
            title="Assistant icon"
            options={ICON_VARIANTS}
            value={iconId}
            onChange={setIconId}
            testPrefix="icon"
          />
          <div className="md:col-span-2 flex flex-col gap-1">
            <p className="text-[12px]" style={{ color: W.secondaryText }}>
              <span className="font-semibold">{font.label}:</span> {font.note}
            </p>
            <p className="text-[12px]" style={{ color: W.secondaryText }}>
              <span className="font-semibold">{spacing.label}:</span> {spacing.note}
            </p>
            <p className="text-[12px]" style={{ color: W.secondaryText }}>
              <span className="font-semibold">{divider.label}:</span> {divider.note}
            </p>
            <p className="text-[12px]" style={{ color: W.secondaryText }}>
              <span className="font-semibold">{icon.label}:</span> {icon.note}
            </p>
          </div>
        </div>

        {/* Logo alignment lab */}
        <LogoAlignmentSection />

        {/* Icon lineup strip */}
        <div
          className="rounded-2xl p-4 mb-5 flex flex-wrap items-start gap-5"
          style={{ backgroundColor: "#FFFFFF", border: `1px solid ${W.cardBorder}` }}
          data-testid="icon-lineup"
        >
          {ICON_VARIANTS.map((iv) => (
            <button
              key={iv.id}
              onClick={() => setIconId(iv.id)}
              className="flex flex-col items-center gap-2 w-28 text-center group"
              data-testid={`button-icon-tile-${iv.id}`}
            >
              <span
                className="rounded-xl p-2 transition-colors"
                style={{
                  backgroundColor: iv.id === iconId ? W.userBubbleBg : "transparent",
                  boxShadow:
                    iv.id === iconId ? `inset 0 0 0 1.5px ${W.accent}` : undefined,
                }}
              >
                {iv.render("lg")}
              </span>
              <span
                className="text-[11px] font-medium leading-tight"
                style={{ color: iv.id === iconId ? W.accent : W.secondaryText }}
              >
                {iv.label}
              </span>
            </button>
          ))}
        </div>

        {/* Chat mock in whisper-blue */}
        <div
          className="rounded-2xl overflow-hidden"
          style={{
            backgroundColor: W.cardBg,
            border: `1px solid ${W.cardBorder}`,
            boxShadow: W.cardShadow,
          }}
          data-testid="chat-mock"
        >
          <div
            className="h-14 px-4 flex items-center gap-2.5"
            style={{ borderBottom: `1px solid ${W.headerBorder}` }}
          >
            {icon.render("sm")}
            <div className="min-w-0 leading-tight">
              <h2 className="font-semibold text-sm truncate" style={{ color: W.text }}>
                Campaign testing plan
              </h2>
              <p className="text-[11px]" style={{ color: W.secondaryText }}>
                Powered by your BTS knowledge base
              </p>
            </div>
          </div>

          <div className="max-w-3xl mx-auto px-4 py-6 space-y-4">
            <div className="flex gap-3 justify-end">
              <div
                className="max-w-[80%] rounded-2xl px-4 py-2.5"
                style={{ backgroundColor: W.userBubbleBg, color: W.text }}
              >
                <p className="text-[15px] leading-6">{SAMPLE_QUESTION}</p>
              </div>
            </div>

            <div className="flex gap-3">
              <div className="mt-0.5">{icon.render("sm")}</div>
              <div className="flex-1 min-w-0 pt-1">
                <SampleAnswer font={font} spacing={spacing} divider={divider} />
              </div>
            </div>
          </div>

          <div className="p-4" style={{ borderTop: `1px solid ${W.headerBorder}` }}>
            <div className="max-w-3xl mx-auto flex gap-2 items-end">
              <div
                className="flex-1 px-4 py-3 rounded-2xl text-[15px] min-h-[44px] cursor-default"
                style={{
                  backgroundColor: W.inputBg,
                  border: `1px solid ${W.cardBorder}`,
                  color: W.mutedText,
                }}
              >
                Ask the BTS Assistant anything...
              </div>
              <button
                className="shrink-0 h-[44px] w-[44px] rounded-2xl flex items-center justify-center cursor-default"
                style={{ backgroundColor: W.accent, color: "#FFFFFF" }}
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        <p className="text-center text-[12px] mt-4" style={{ color: W.mutedText }}>
          Static mockup — nothing here is functional. The live assistant only picks up
          the choices you approve.
        </p>
      </div>
    </div>
  );
}
