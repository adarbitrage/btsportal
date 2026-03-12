import { ReactNode } from "react";
import {
  LayoutDashboard,
  BookOpen,
  Video,
  HeadphonesIcon,
  User,
  MessageCircle,
  ChevronUp,
} from "lucide-react";

interface AppLayoutProps {
  children: ReactNode;
  activePage: string;
  memberName?: string;
  tier?: "bronze" | "silver" | "gold" | "diamond";
}

const navItems = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "training", label: "Training Library", icon: BookOpen },
  { id: "coaching", label: "Coaching Calls", icon: Video },
  { id: "support", label: "Support", icon: HeadphonesIcon },
  { id: "account", label: "Account", icon: User },
];

const tierLabels: Record<string, string> = {
  bronze: "Bronze",
  silver: "Silver",
  gold: "Gold",
  diamond: "Diamond",
};

const tierColors: Record<string, string> = {
  bronze: "#92400e",
  silver: "#6b7280",
  gold: "#b45309",
  diamond: "#0891b2",
};

const tierBgColors: Record<string, string> = {
  bronze: "#fef3c7",
  silver: "#f3f4f6",
  gold: "#fef3c7",
  diamond: "#ecfeff",
};

export function AppLayout({
  children,
  activePage,
  memberName = "Marcus Johnson",
  tier = "gold",
}: AppLayoutProps) {
  return (
    <div
      className="flex h-screen w-full"
      style={{ background: "#faf9f7", color: "#2d2d2d", fontFamily: "'Source Serif Pro', Georgia, serif" }}
    >
      <aside
        className="w-[260px] flex flex-col shrink-0"
        style={{
          background: "#ffffff",
          borderRight: "1px solid #e8e4dc",
        }}
      >
        <div className="px-6 pt-6 pb-5" style={{ borderBottom: "3px double #2d2d2d" }}>
          <div className="flex items-center gap-3">
            <img
              src="/__mockup/images/bts-logo.png"
              alt="BTS Logo"
              className="w-10 h-10 rounded-full object-contain"
              style={{ background: "#fff" }}
            />
            <div>
              <h1
                className="text-[15px] font-bold tracking-wide"
                style={{ fontFamily: "'Playfair Display', serif", color: "#2d2d2d", letterSpacing: "0.5px" }}
              >
                BUILD TEST SCALE
              </h1>
              <p
                className="text-[10px] tracking-[2px] uppercase"
                style={{ fontFamily: "'Source Sans Pro', sans-serif", color: "#888" }}
              >
                Member Portal
              </p>
            </div>
          </div>
        </div>

        <nav className="flex-1 px-4 pt-5 space-y-0.5 overflow-y-auto">
          {navItems.map((item) => {
            const isActive = item.id === activePage;
            return (
              <button
                key={item.id}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded text-[13.5px] font-semibold transition-all"
                style={{
                  fontFamily: "'Source Sans Pro', sans-serif",
                  background: isActive ? "#eff6ff" : "transparent",
                  color: isActive ? "#1a56db" : "#5a5a5a",
                  borderLeft: isActive ? "3px solid #1a56db" : "3px solid transparent",
                }}
              >
                <item.icon className="w-[18px] h-[18px]" />
                {item.label}
              </button>
            );
          })}
        </nav>

        <div className="p-4 mt-auto">
          <div
            className="rounded p-3.5 mb-3"
            style={{
              background: "#eff6ff",
              border: "1px solid #dbeafe",
            }}
          >
            <div className="flex items-center gap-2 mb-1.5">
              <ChevronUp className="w-4 h-4" style={{ color: "#1a56db" }} />
              <span
                className="text-xs font-bold"
                style={{ fontFamily: "'Source Sans Pro', sans-serif", color: "#1a56db" }}
              >
                Upgrade to Diamond
              </span>
            </div>
            <p
              className="text-[11px] leading-relaxed mb-2.5"
              style={{ fontFamily: "'Source Sans Pro', sans-serif", color: "#5a5a5a" }}
            >
              Get weekly 1-on-1 coaching and priority support
            </p>
            <button
              className="w-full py-1.5 rounded text-xs font-bold text-white"
              style={{ fontFamily: "'Source Sans Pro', sans-serif", background: "#1a56db" }}
            >
              View Plans
            </button>
          </div>

          <div
            className="flex items-center gap-3 px-3 py-2.5 rounded"
            style={{ background: "#f5f2ed" }}
          >
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold"
              style={{
                fontFamily: "'Source Sans Pro', sans-serif",
                background: tierBgColors[tier],
                border: `1.5px solid ${tierColors[tier]}44`,
                color: tierColors[tier],
              }}
            >
              {memberName
                .split(" ")
                .map((n) => n[0])
                .join("")}
            </div>
            <div className="flex-1 min-w-0">
              <p
                className="text-[13px] font-bold truncate"
                style={{ fontFamily: "'Source Sans Pro', sans-serif", color: "#2d2d2d" }}
              >
                {memberName}
              </p>
              <p
                className="text-[11px] font-semibold"
                style={{ fontFamily: "'Source Sans Pro', sans-serif", color: tierColors[tier] }}
              >
                {tierLabels[tier]} Member
              </p>
            </div>
          </div>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto" style={{ background: "#faf9f7" }}>
        {children}
      </main>

      <button
        className="fixed bottom-5 right-5 w-12 h-12 rounded-full flex items-center justify-center shadow-lg z-50"
        style={{
          background: "#1a56db",
          boxShadow: "0 4px 12px rgba(26,86,219,0.3)",
        }}
      >
        <MessageCircle className="w-5 h-5 text-white" />
      </button>
    </div>
  );
}
