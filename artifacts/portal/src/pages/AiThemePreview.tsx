import { useEffect, useState } from "react";
import {
  Send, Bot, Plus, MessageCircle, Menu, ChevronLeft, ChevronRight,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface Theme {
  name: string;
  description: string;
  pageBg: string;
  cardBg: string;
  cardBorder: string;
  cardShadow: string;
  sidebarBg: string;
  sidebarBorder: string;
  sidebarItemHover: string;
  sidebarItemActive: string;
  headerBorder: string;
  userBubbleBg: string;
  userBubbleText: string;
  assistantText: string;
  secondaryText: string;
  mutedText: string;
  accent: string;
  accentText: string;
  link: string;
  inputBg: string;
  inputBorder: string;
  inputText: string;
  avatarBg: string;
  avatarRing: string;
  avatarIcon: string;
  codeBg: string;
  codeText: string;
  newChatBg: string;
  newChatText: string;
  swatches: { label: string; color: string }[];
}

const THEMES: Theme[] = [
  {
    name: "Editorial Warm",
    description:
      "Crisp white chat card on the warm page, soft warm beige sidebar and user bubbles, muted BTS Blue accents.",
    pageBg: "#FAF9F7",
    cardBg: "#FFFFFF",
    cardBorder: "#E5E1D8",
    cardShadow:
      "0 20px 50px -20px rgba(28,25,23,0.18), 0 8px 20px -8px rgba(28,25,23,0.08)",
    sidebarBg: "#F2F0ED",
    sidebarBorder: "#E5E1D8",
    sidebarItemHover: "#ECE9E2",
    sidebarItemActive: "#E6E2D9",
    headerBorder: "#ECE9E2",
    userBubbleBg: "#ECE9E2",
    userBubbleText: "#292524",
    assistantText: "#292524",
    secondaryText: "#78716C",
    mutedText: "#A8A29E",
    accent: "#1A56DB",
    accentText: "#FFFFFF",
    link: "#1A56DB",
    inputBg: "#FAF9F7",
    inputBorder: "#E5E1D8",
    inputText: "#292524",
    avatarBg: "#F2F0ED",
    avatarRing: "#E5E1D8",
    avatarIcon: "#57534E",
    codeBg: "#F2F0ED",
    codeText: "#44403C",
    newChatBg: "#1C1917",
    newChatText: "#FAFAF9",
    swatches: [
      { label: "Card", color: "#FFFFFF" },
      { label: "Sidebar", color: "#F2F0ED" },
      { label: "User bubble", color: "#ECE9E2" },
      { label: "Accent", color: "#1A56DB" },
      { label: "Text", color: "#292524" },
    ],
  },
  {
    name: "Soft Blue Whisper",
    description:
      "Near-white card with a hairline blue-tinted border, faint blue-gray sidebar, pale desaturated blue user bubbles.",
    pageBg: "#FAF9F7",
    cardBg: "#FDFDFE",
    cardBorder: "#D6DEEC",
    cardShadow:
      "0 20px 50px -20px rgba(51,65,85,0.18), 0 8px 20px -8px rgba(51,65,85,0.08)",
    sidebarBg: "#EEF1F7",
    sidebarBorder: "#DDE3EE",
    sidebarItemHover: "#E4E9F2",
    sidebarItemActive: "#DCE3F0",
    headerBorder: "#E4E9F2",
    userBubbleBg: "#E7EDF9",
    userBubbleText: "#1E293B",
    assistantText: "#1E293B",
    secondaryText: "#64748B",
    mutedText: "#94A3B8",
    accent: "#3B5FA8",
    accentText: "#FFFFFF",
    link: "#2F55A4",
    inputBg: "#F6F8FC",
    inputBorder: "#D6DEEC",
    inputText: "#1E293B",
    avatarBg: "#E7EDF9",
    avatarRing: "#D6DEEC",
    avatarIcon: "#3B5FA8",
    codeBg: "#EEF1F7",
    codeText: "#334155",
    newChatBg: "#3B5FA8",
    newChatText: "#FFFFFF",
    swatches: [
      { label: "Card", color: "#FDFDFE" },
      { label: "Sidebar", color: "#EEF1F7" },
      { label: "User bubble", color: "#E7EDF9" },
      { label: "Accent", color: "#3B5FA8" },
      { label: "Text", color: "#1E293B" },
    ],
  },
  {
    name: "Claude-style Cream",
    description:
      "Deeper warm cream card that reads distinctly against the page, sidebar one cream step deeper, warm gray-brown secondary text, one quiet accent.",
    pageBg: "#FAF9F7",
    cardBg: "#F1EEE6",
    cardBorder: "#DFD9CB",
    cardShadow:
      "0 20px 50px -20px rgba(87,72,52,0.22), 0 8px 20px -8px rgba(87,72,52,0.10)",
    sidebarBg: "#E9E4D8",
    sidebarBorder: "#DCD5C5",
    sidebarItemHover: "#E2DCCE",
    sidebarItemActive: "#DBD4C3",
    headerBorder: "#E0DACB",
    userBubbleBg: "#E4DECF",
    userBubbleText: "#3D362C",
    assistantText: "#3D362C",
    secondaryText: "#7D7263",
    mutedText: "#A39A8B",
    accent: "#0F766E",
    accentText: "#FFFFFF",
    link: "#0F766E",
    inputBg: "#F7F5EF",
    inputBorder: "#DFD9CB",
    inputText: "#3D362C",
    avatarBg: "#E9E4D8",
    avatarRing: "#DCD5C5",
    avatarIcon: "#6B5F4D",
    codeBg: "#E9E4D8",
    codeText: "#57503F",
    newChatBg: "#3D362C",
    newChatText: "#F7F5EF",
    swatches: [
      { label: "Card", color: "#F1EEE6" },
      { label: "Sidebar", color: "#E9E4D8" },
      { label: "User bubble", color: "#E4DECF" },
      { label: "Accent", color: "#0F766E" },
      { label: "Text", color: "#3D362C" },
    ],
  },
  {
    name: "Quiet Sage / Teal",
    description:
      "Near-white card with a very muted sage-teal tint for the sidebar, user bubbles, and accents — harmonizing with existing teal links.",
    pageBg: "#FAF9F7",
    cardBg: "#FDFEFD",
    cardBorder: "#D9E2DD",
    cardShadow:
      "0 20px 50px -20px rgba(45,74,66,0.18), 0 8px 20px -8px rgba(45,74,66,0.08)",
    sidebarBg: "#EDF2EF",
    sidebarBorder: "#DDE6E1",
    sidebarItemHover: "#E3EBE6",
    sidebarItemActive: "#DAE5DF",
    headerBorder: "#E3EBE6",
    userBubbleBg: "#E4EEE9",
    userBubbleText: "#1F2E29",
    assistantText: "#22302B",
    secondaryText: "#5F6F68",
    mutedText: "#8DA098",
    accent: "#0F766E",
    accentText: "#FFFFFF",
    link: "#0F766E",
    inputBg: "#F5F8F6",
    inputBorder: "#D9E2DD",
    inputText: "#22302B",
    avatarBg: "#E4EEE9",
    avatarRing: "#D9E2DD",
    avatarIcon: "#0F766E",
    codeBg: "#EDF2EF",
    codeText: "#33463F",
    newChatBg: "#0F766E",
    newChatText: "#FFFFFF",
    swatches: [
      { label: "Card", color: "#FDFEFD" },
      { label: "Sidebar", color: "#EDF2EF" },
      { label: "User bubble", color: "#E4EEE9" },
      { label: "Accent", color: "#0F766E" },
      { label: "Text", color: "#22302B" },
    ],
  },
];

const MOCK_CONVERSATION: { role: "user" | "assistant"; content: string }[] = [
  {
    role: "user",
    content: "Lorem ipsum dolor sit amet — how do I set up my first campaign tracker?",
  },
  {
    role: "assistant",
    content:
      "Great question! Consectetur adipiscing elit, sed do eiusmod tempor. Here's the short version:\n\n1. **Open the tracker** from your dashboard and pick a template\n2. Add your campaign under `Campaigns → New`\n3. Paste your tracking link and set the daily budget\n\nYou can read the full walkthrough in the [Campaign Tracker guide](#). Ut enim ad minim veniam, quis nostrud exercitation.",
  },
  {
    role: "user",
    content: "Duis aute irure dolor — what budget should I start with?",
  },
  {
    role: "assistant",
    content:
      "Excepteur sint occaecat cupidatat non proident. Most members start small and scale:\n\n- **Testing phase:** $10–20/day per campaign, sunt in culpa qui officia\n- **Validation:** once `ROAS > 1.2`, deserunt mollit anim id est laborum\n- **Scaling:** increase by ~20% every 3 days, lorem ipsum dolor sit amet\n\nSed ut perspiciatis unde omnis iste natus error sit voluptatem accusantium.",
  },
  {
    role: "user",
    content: "Perfect, thanks! One more thing — sed quia consequuntur magni?",
  },
  {
    role: "assistant",
    content:
      "Of course! Neque porro quisquam est qui *dolorem ipsum* quia dolor sit amet, consectetur, adipisci velit. If you get stuck, check the [help center](#) or ask me anything else — nisi ut aliquid ex ea commodi consequatur.",
  },
];

const MOCK_SESSIONS = [
  { group: "Today", items: ["Campaign tracker setup", "Budget question"] },
  { group: "Yesterday", items: ["Lorem ipsum strategy", "Dolor sit tools"] },
  { group: "Last 7 Days", items: ["Adipiscing elit review"] },
];

function MockAssistant({ theme }: { theme: Theme }) {
  return (
    <div
      className="rounded-2xl overflow-hidden flex h-[calc(100vh-16rem)] min-h-[480px]"
      style={{
        backgroundColor: theme.cardBg,
        border: `1px solid ${theme.cardBorder}`,
        boxShadow: theme.cardShadow,
      }}
    >
      {/* Sidebar */}
      <div
        className="hidden md:flex w-64 flex-col shrink-0"
        style={{
          backgroundColor: theme.sidebarBg,
          borderRight: `1px solid ${theme.sidebarBorder}`,
        }}
      >
        <div
          className="h-14 px-3 flex items-center shrink-0"
          style={{ borderBottom: `1px solid ${theme.sidebarBorder}` }}
        >
          <button
            className="w-full h-8 rounded-md flex items-center justify-center gap-2 text-sm font-medium cursor-default"
            style={{ backgroundColor: theme.newChatBg, color: theme.newChatText }}
          >
            <Plus className="w-4 h-4" />
            New Chat
          </button>
        </div>
        <div className="flex-1 overflow-y-auto py-2">
          {MOCK_SESSIONS.map((grp) => (
            <div key={grp.group} className="mb-2">
              <p
                className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider"
                style={{ color: theme.mutedText }}
              >
                {grp.group}
              </p>
              {grp.items.map((title, i) => {
                const active = grp.group === "Today" && i === 0;
                return (
                  <div
                    key={title}
                    className="flex items-center gap-2 px-3 py-2"
                    style={{
                      backgroundColor: active ? theme.sidebarItemActive : undefined,
                    }}
                  >
                    <MessageCircle
                      className="w-3.5 h-3.5 shrink-0"
                      style={{ color: theme.mutedText }}
                    />
                    <span
                      className="flex-1 text-sm truncate"
                      style={{ color: theme.assistantText }}
                    >
                      {title}
                    </span>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {/* Chat column */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0">
        <div
          className="h-14 px-4 flex items-center gap-3 shrink-0"
          style={{ borderBottom: `1px solid ${theme.headerBorder}` }}
        >
          <span className="md:hidden p-1.5" style={{ color: theme.mutedText }}>
            <Menu className="w-5 h-5" />
          </span>
          <div className="flex items-center gap-2.5 min-w-0">
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center shrink-0"
              style={{
                backgroundColor: theme.avatarBg,
                boxShadow: `inset 0 0 0 1px ${theme.avatarRing}`,
              }}
            >
              <Bot className="w-4 h-4" style={{ color: theme.avatarIcon }} />
            </div>
            <div className="min-w-0 leading-tight">
              <h2
                className="font-semibold text-sm truncate"
                style={{ color: theme.assistantText }}
              >
                Campaign tracker setup
              </h2>
              <p className="text-[11px]" style={{ color: theme.secondaryText }}>
                Powered by your BTS knowledge base
              </p>
            </div>
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto">
          <div className="max-w-3xl mx-auto px-4 py-6 space-y-4">
            {MOCK_CONVERSATION.map((msg, i) => (
              <div
                key={i}
                className={`flex gap-3 ${msg.role === "user" ? "justify-end" : ""}`}
              >
                {msg.role === "assistant" && (
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 mt-0.5"
                    style={{
                      backgroundColor: theme.avatarBg,
                      boxShadow: `inset 0 0 0 1px ${theme.avatarRing}`,
                    }}
                  >
                    <Bot className="w-4 h-4" style={{ color: theme.avatarIcon }} />
                  </div>
                )}
                {msg.role === "assistant" ? (
                  <div
                    className="flex-1 min-w-0 pt-1"
                    style={{ color: theme.assistantText }}
                  >
                    <div className="text-[15px] leading-7 [&_p]:mb-2 [&_p:last-child]:mb-0 [&_ul]:mb-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:mb-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:mb-0.5">
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={{
                          a: ({ node: _n, ...props }) => (
                            <a
                              {...props}
                              onClick={(e) => e.preventDefault()}
                              style={{
                                color: theme.link,
                                textDecoration: "underline",
                              }}
                            />
                          ),
                          strong: ({ node: _n, ...props }) => (
                            <strong
                              {...props}
                              style={{ color: theme.assistantText, fontWeight: 600 }}
                            />
                          ),
                          code: ({ node: _n, ...props }) => (
                            <code
                              {...props}
                              className="px-1.5 py-0.5 rounded text-[0.85em]"
                              style={{
                                backgroundColor: theme.codeBg,
                                color: theme.codeText,
                              }}
                            />
                          ),
                        }}
                      >
                        {msg.content}
                      </ReactMarkdown>
                    </div>
                  </div>
                ) : (
                  <div
                    className="max-w-[80%] rounded-2xl px-4 py-2.5"
                    style={{
                      backgroundColor: theme.userBubbleBg,
                      color: theme.userBubbleText,
                    }}
                  >
                    <p className="text-[15px] whitespace-pre-wrap leading-6">
                      {msg.content}
                    </p>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        <div
          className="p-4 shrink-0"
          style={{ borderTop: `1px solid ${theme.headerBorder}` }}
        >
          <div className="max-w-3xl mx-auto flex gap-2 items-end">
            <div
              className="flex-1 px-4 py-3 rounded-2xl text-[15px] min-h-[44px] cursor-default"
              style={{
                backgroundColor: theme.inputBg,
                border: `1px solid ${theme.inputBorder}`,
                color: theme.mutedText,
              }}
            >
              Ask the BTS Assistant anything...
            </div>
            <button
              className="shrink-0 h-[44px] w-[44px] rounded-2xl flex items-center justify-center cursor-default"
              style={{ backgroundColor: theme.accent, color: theme.accentText }}
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function AiThemePreview() {
  const [index, setIndex] = useState(() => {
    const t = Number(new URLSearchParams(window.location.search).get("t"));
    return Number.isInteger(t) && t >= 1 && t <= THEMES.length ? t - 1 : 0;
  });
  const theme = THEMES[index];

  const prev = () => setIndex((i) => (i - 1 + THEMES.length) % THEMES.length);
  const next = () => setIndex((i) => (i + 1) % THEMES.length);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") setIndex((i) => (i - 1 + THEMES.length) % THEMES.length);
      else if (e.key === "ArrowRight") setIndex((i) => (i + 1) % THEMES.length);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div
      className="min-h-screen px-4 md:px-8 py-6"
      style={{ backgroundColor: "#FAF9F7", fontFamily: "'Roboto', sans-serif" }}
    >
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between gap-4 mb-5">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-stone-400 mb-1">
              AI Assistant · Light-theme preview ({index + 1} of {THEMES.length})
            </p>
            <h1 className="text-2xl font-bold text-stone-900 leading-tight" data-testid="text-theme-name">
              {theme.name}
            </h1>
            <p className="text-sm text-stone-500 mt-1 max-w-2xl">{theme.description}</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={prev}
              className="w-10 h-10 rounded-full border border-stone-300 bg-white flex items-center justify-center text-stone-700 hover:bg-stone-100 transition-colors shadow-sm"
              aria-label="Previous theme"
              data-testid="button-prev-theme"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <button
              onClick={next}
              className="w-10 h-10 rounded-full border border-stone-300 bg-white flex items-center justify-center text-stone-700 hover:bg-stone-100 transition-colors shadow-sm"
              aria-label="Next theme"
              data-testid="button-next-theme"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 mb-4" data-testid="swatch-strip">
          {theme.swatches.map((s) => (
            <div key={s.label} className="flex items-center gap-1.5">
              <span
                className="w-5 h-5 rounded-md border border-stone-300/70 inline-block"
                style={{ backgroundColor: s.color }}
              />
              <span className="text-[12px] text-stone-600">
                {s.label}{" "}
                <code className="text-[11px] text-stone-400">{s.color}</code>
              </span>
            </div>
          ))}
        </div>

        <MockAssistant theme={theme} />

        <p className="text-center text-[12px] text-stone-400 mt-4">
          Use ← → arrow keys or the buttons above to switch themes. Static mockup — nothing here is functional.
        </p>
      </div>
    </div>
  );
}
