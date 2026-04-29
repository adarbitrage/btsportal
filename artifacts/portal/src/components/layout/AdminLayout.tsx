import { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import {
  LayoutDashboard,
  Ticket,
  Route,
  MessageSquareText,
  Users,
  BarChart3,
  ArrowLeft,
  Vault,
  FolderOpen,
  TrendingUp,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";
import { AdminNotifications } from "@/components/admin/AdminNotifications";

const adminNav = [
  { href: "/admin/tickets", label: "Ticket Queue", icon: Ticket },
  { href: "/admin/routing-rules", label: "Routing Rules", icon: Route },
  { href: "/admin/canned-responses", label: "Canned Responses", icon: MessageSquareText },
  { href: "/admin/agent-performance", label: "Agent Performance", icon: Users },
  { href: "/admin/analytics", label: "Support Analytics", icon: BarChart3 },
  { href: "/admin/resources", label: "Resource Vault", icon: Vault },
  { href: "/admin/collections", label: "Collections", icon: FolderOpen },
  { href: "/admin/vault/analytics", label: "Vault Analytics", icon: TrendingUp },
];

export function AdminLayout({ children }: { children: ReactNode }) {
  const [location] = useLocation();

  return (
    <div className="flex min-h-screen bg-background">
      <aside className="w-64 shrink-0 flex flex-col bg-white border-r border-border min-h-screen sticky top-0">
        <div className="p-6 border-b border-border/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
              <LayoutDashboard className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h1 className="font-bold text-sm tracking-tight text-foreground leading-tight">ADMIN PANEL</h1>
              <p className="text-[10px] text-muted-foreground tracking-widest uppercase">Support Management</p>
            </div>
          </div>
        </div>

        <div className="flex-1 py-6 px-4 space-y-1 overflow-y-auto">
          {adminNav.map((item) => {
            const isActive = location === item.href || location.startsWith(item.href + "/");
            return (
              <Link key={item.href} href={item.href}>
                <div
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

        <div className="p-4 mt-auto">
          <Link href="/">
            <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm font-medium text-muted-foreground hover:bg-secondary hover:text-foreground transition-all cursor-pointer">
              <ArrowLeft className="w-4 h-4" />
              Back to Portal
            </div>
          </Link>
        </div>
      </aside>
      <main className="flex-1 w-full relative">
        <div className="sticky top-0 z-30 flex justify-end items-center gap-2 px-8 lg:px-12 py-3 bg-background/80 backdrop-blur border-b border-border/40">
          <AdminNotifications />
        </div>
        <div className="max-w-7xl mx-auto p-8 lg:p-12">
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
