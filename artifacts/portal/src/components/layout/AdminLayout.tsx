import { ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import {
  LayoutDashboard,
  ArrowLeft,
  Vault,
  FolderOpen,
  TrendingUp,
  ShoppingCart,
  AlertTriangle,
  Menu,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";
import { AdminNotifications } from "@/components/admin/AdminNotifications";
import { GlobalSearch } from "@/components/admin/GlobalSearch";

type NavItem = { href: string; label: string; icon: typeof Vault };
type NavGroup = { label: string; items: NavItem[] };

const adminNav: NavItem[] = [];

const adminNavGroups: NavGroup[] = [
  {
    label: "Vault",
    items: [
      { href: "/admin/resources", label: "Resource Vault", icon: Vault },
      { href: "/admin/collections", label: "Collections", icon: FolderOpen },
      { href: "/admin/vault/analytics", label: "Vault Analytics", icon: TrendingUp },
    ],
  },
  {
    label: "Integrations",
    items: [
      { href: "/admin/integrations/yse", label: "YSE Orders", icon: ShoppingCart },
      { href: "/admin/integrations/machine", label: "Machine Orders", icon: ShoppingCart },
      { href: "/admin/integrations/yse/failures", label: "YSE Grant Failures", icon: AlertTriangle },
    ],
  },
];

const ADMIN_SIDEBAR_SCROLL_KEY = "admin-sidebar-scroll-top";

function AdminSidebarContent({ onNavClick }: { onNavClick?: () => void }) {
  const [location] = useLocation();
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const save = () => {
      try {
        sessionStorage.setItem(ADMIN_SIDEBAR_SCROLL_KEY, String(el.scrollTop));
      } catch {}
    };
    el.addEventListener("scroll", save, { passive: true });
    return () => el.removeEventListener("scroll", save);
  }, []);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    try {
      const saved = sessionStorage.getItem(ADMIN_SIDEBAR_SCROLL_KEY);
      if (saved !== null) el.scrollTop = parseInt(saved, 10);
    } catch {}
  }, []);

  const resetSidebarScroll = useCallback(() => {
    try {
      sessionStorage.removeItem(ADMIN_SIDEBAR_SCROLL_KEY);
    } catch {}
  }, []);

  return (
    <>
      <div className="p-6 border-b border-border/50">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
            <LayoutDashboard className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="font-bold text-sm tracking-tight text-foreground leading-tight">ADMIN PANEL</h1>
            <p className="text-[10px] text-muted-foreground tracking-widest uppercase">Vault Management</p>
          </div>
        </div>
      </div>

      <div ref={scrollRef} data-testid="admin-sidebar-scroll" className="flex-1 py-6 px-4 space-y-1 overflow-y-auto">
        {adminNav.map((item) => {
          const isActive = location === item.href || location.startsWith(item.href + "/");
          return (
            <Link key={item.href} href={item.href}>
              <div
                onClick={onNavClick}
                className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all cursor-pointer group",
                  isActive
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                )}
              >
                <item.icon className={cn("w-5 h-5 transition-transform group-hover:scale-110", isActive ? "text-primary" : "")} />
                {item.label}
              </div>
            </Link>
          );
        })}

        {adminNavGroups.map((group) => (
          <div key={group.label} className="pt-4">
            <p className="px-3 pb-2 text-[10px] font-semibold tracking-widest uppercase text-muted-foreground/70">
              {group.label}
            </p>
            <div className="space-y-1">
              {group.items.map((item) => {
                const isActive = location === item.href || location.startsWith(item.href + "/");
                return (
                  <Link key={item.href} href={item.href}>
                    <div
                      onClick={onNavClick}
                      className={cn(
                        "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all cursor-pointer group",
                        isActive
                          ? "bg-primary/10 text-primary"
                          : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                      )}
                    >
                      <item.icon className={cn("w-5 h-5 transition-transform group-hover:scale-110", isActive ? "text-primary" : "")} />
                      {item.label}
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="p-4 mt-auto">
        <Link href="/">
          <div
            data-testid="admin-back-to-portal"
            onClick={() => {
              resetSidebarScroll();
              onNavClick?.();
            }}
            className="flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm font-medium text-muted-foreground hover:bg-secondary hover:text-foreground transition-all cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Portal
          </div>
        </Link>
      </div>
    </>
  );
}

export function AdminLayout({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    setMobileOpen(false);
  }, [location]);

  useEffect(() => {
    if (mobileOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [mobileOpen]);

  return (
    <div className="flex min-h-screen bg-background">
      <aside
        data-testid="admin-sidebar-desktop"
        className="hidden md:flex w-64 shrink-0 flex-col bg-white border-r border-border h-screen sticky top-0"
      >
        <AdminSidebarContent />
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => setMobileOpen(false)}
          />
          <aside
            data-testid="admin-sidebar-drawer"
            className="absolute left-0 top-0 bottom-0 w-72 max-w-[85vw] bg-white shadow-2xl flex flex-col animate-in slide-in-from-left duration-200"
          >
            <div className="absolute top-4 right-4 z-10">
              <button
                onClick={() => setMobileOpen(false)}
                className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
                aria-label="Close menu"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <AdminSidebarContent onNavClick={() => setMobileOpen(false)} />
          </aside>
        </div>
      )}

      <main className="flex-1 w-full min-w-0 relative">
        <div className="sticky top-0 z-30 flex items-center gap-3 px-4 sm:px-8 lg:px-12 py-3 bg-background/80 backdrop-blur border-b border-border/40">
          <button
            onClick={() => setMobileOpen(true)}
            className="md:hidden p-2 -ml-2 rounded-lg text-foreground hover:bg-secondary transition-colors shrink-0"
            aria-label="Open menu"
          >
            <Menu className="w-5 h-5" />
          </button>
          <div className="flex-1 min-w-0">
            <GlobalSearch />
          </div>
          <AdminNotifications />
        </div>
        <div className="max-w-7xl mx-auto p-4 sm:p-8 lg:p-12">
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: "easeOut" }}
          >
            {children}
          </motion.div>
        </div>
      </main>
    </div>
  );
}
