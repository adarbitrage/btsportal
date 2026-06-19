import { ReactNode, useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import {
  LayoutDashboard,
  DollarSign,
  Wallet,
  Users,
  Percent,
  FileText,
  AlertTriangle,
  ArrowLeft,
  Menu,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";

const commissionNav = [
  { href: "/admin/commissions", label: "Overview", icon: LayoutDashboard },
  { href: "/admin/commissions/all", label: "All Commissions", icon: DollarSign },
  { href: "/admin/commissions/payouts", label: "Payouts", icon: Wallet },
  { href: "/admin/commissions/affiliates", label: "Affiliates", icon: Users },
  { href: "/admin/commissions/rates", label: "Rates", icon: Percent },
  { href: "/admin/commissions/resources", label: "Resources", icon: FileText },
  { href: "/admin/commissions/fraud", label: "Fraud Alerts", icon: AlertTriangle },
];

function CommissionSidebarContent({ onNavClick }: { onNavClick?: () => void }) {
  const [location] = useLocation();

  return (
    <>
      <div className="p-6 border-b border-border/50">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
            <DollarSign className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="font-bold text-sm tracking-tight text-foreground leading-tight">ADMIN PANEL</h1>
            <p className="text-[10px] text-muted-foreground tracking-widest uppercase">Commission Management</p>
          </div>
        </div>
      </div>

      <div className="flex-1 py-6 px-4 space-y-1 overflow-y-auto">
        {commissionNav.map((item) => {
          const isActive = location === item.href || (item.href !== "/admin/commissions" && location.startsWith(item.href));
          const isOverviewActive = item.href === "/admin/commissions" && location === "/admin/commissions";
          return (
            <Link key={item.href} href={item.href}>
              <div
                onClick={onNavClick}
                className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all cursor-pointer group",
                  (isActive || isOverviewActive)
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                )}
              >
                <item.icon className={cn("w-5 h-5 transition-transform group-hover:scale-110", (isActive || isOverviewActive) ? "text-primary" : "")} />
                {item.label}
              </div>
            </Link>
          );
        })}
      </div>

      <div className="p-4 mt-auto">
        <Link href="/">
          <div
            onClick={onNavClick}
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

export function CommissionAdminLayout({ children }: { children: ReactNode }) {
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
        data-testid="commission-sidebar-desktop"
        className="hidden md:flex w-64 shrink-0 flex-col bg-white border-r border-border h-screen sticky top-0"
      >
        <CommissionSidebarContent />
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => setMobileOpen(false)}
          />
          <aside
            data-testid="commission-sidebar-drawer"
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
            <CommissionSidebarContent onNavClick={() => setMobileOpen(false)} />
          </aside>
        </div>
      )}

      <main className="flex-1 w-full min-w-0 relative">
        <div className="md:hidden sticky top-0 z-30 flex items-center gap-3 px-4 sm:px-8 py-3 bg-background/80 backdrop-blur border-b border-border/40">
          <button
            onClick={() => setMobileOpen(true)}
            className="p-2 -ml-2 rounded-lg text-foreground hover:bg-secondary transition-colors shrink-0"
            aria-label="Open menu"
          >
            <Menu className="w-5 h-5" />
          </button>
          <span className="text-sm font-semibold text-foreground">Commission Management</span>
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
