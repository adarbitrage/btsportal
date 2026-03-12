import { ReactNode } from "react";
import {
  LayoutDashboard,
  BookOpen,
  Video,
  HeadphonesIcon,
  User,
  Settings,
  LogOut,
  ChevronUp,
  Crown,
  MessageCircle,
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

const tierColors: Record<string, string> = {
  bronze: "#cd7f32",
  silver: "#c0c0c0",
  gold: "#ffd700",
  diamond: "#b9f2ff",
};

const tierGradients: Record<string, string> = {
  bronze: "from-amber-700 to-amber-900",
  silver: "from-slate-300 to-slate-500",
  gold: "from-yellow-400 to-amber-600",
  diamond: "from-cyan-200 to-blue-400",
};

export function AppLayout({
  children,
  activePage,
  memberName = "Marcus Johnson",
  tier = "gold",
}: AppLayoutProps) {
  return (
    <div className="flex h-screen w-full" style={{ background: "#0f172a", color: "#f1f5f9" }}>
      <aside
        className="w-[260px] flex flex-col border-r shrink-0"
        style={{ background: "#0c1425", borderColor: "#1e293b" }}
      >
        <div className="p-6 pb-4">
          <div className="flex items-center gap-2.5">
            <div
              className="w-9 h-9 rounded-lg flex items-center justify-center font-bold text-white text-sm"
              style={{ background: "linear-gradient(135deg, #6366f1, #8b5cf6)" }}
            >
              BTS
            </div>
            <div>
              <h1 className="text-[15px] font-semibold tracking-tight" style={{ color: "#f1f5f9" }}>
                Build Test Scale
              </h1>
              <p className="text-[11px]" style={{ color: "#64748b" }}>
                Member Portal
              </p>
            </div>
          </div>
        </div>

        <nav className="flex-1 px-3 space-y-0.5 overflow-y-auto">
          {navItems.map((item) => {
            const isActive = item.id === activePage;
            return (
              <button
                key={item.id}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-[13.5px] font-medium transition-all"
                style={{
                  background: isActive ? "rgba(99,102,241,0.12)" : "transparent",
                  color: isActive ? "#818cf8" : "#94a3b8",
                }}
              >
                <item.icon className="w-[18px] h-[18px]" />
                {item.label}
              </button>
            );
          })}
        </nav>

        <div className="p-3 mt-auto">
          <div
            className="rounded-xl p-3.5 mb-3"
            style={{
              background: "linear-gradient(135deg, rgba(99,102,241,0.15), rgba(139,92,246,0.1))",
              border: "1px solid rgba(99,102,241,0.2)",
            }}
          >
            <div className="flex items-center gap-2 mb-2">
              <Crown className="w-4 h-4" style={{ color: "#fbbf24" }} />
              <span className="text-xs font-semibold" style={{ color: "#fbbf24" }}>
                Upgrade to Diamond
              </span>
            </div>
            <p className="text-[11px] leading-relaxed mb-2.5" style={{ color: "#94a3b8" }}>
              Get weekly 1-on-1 coaching and priority support
            </p>
            <button
              className="w-full py-1.5 rounded-lg text-xs font-semibold text-white"
              style={{ background: "linear-gradient(135deg, #6366f1, #8b5cf6)" }}
            >
              View Plans
            </button>
          </div>

          <div
            className="flex items-center gap-3 px-3 py-2.5 rounded-lg"
            style={{ background: "rgba(255,255,255,0.03)" }}
          >
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold"
              style={{
                background: `linear-gradient(135deg, ${tierColors[tier]}33, ${tierColors[tier]}11)`,
                border: `1.5px solid ${tierColors[tier]}55`,
                color: tierColors[tier],
              }}
            >
              {memberName
                .split(" ")
                .map((n) => n[0])
                .join("")}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-medium truncate" style={{ color: "#f1f5f9" }}>
                {memberName}
              </p>
              <p className="text-[11px] capitalize" style={{ color: tierColors[tier] }}>
                {tier} Member
              </p>
            </div>
          </div>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto" style={{ background: "#0f172a" }}>
        {children}
      </main>

      <button
        className="fixed bottom-5 right-5 w-12 h-12 rounded-full flex items-center justify-center shadow-lg z-50"
        style={{
          background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
          boxShadow: "0 4px 20px rgba(99,102,241,0.4)",
        }}
      >
        <MessageCircle className="w-5 h-5 text-white" />
      </button>
    </div>
  );
}
