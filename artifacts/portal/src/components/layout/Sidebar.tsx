import { Link, useLocation } from "wouter";
import { useState, useEffect } from "react";
import { 
  LayoutDashboard, 
  BookOpen, 
  Video, 
  LifeBuoy, 
  MessageCircle, 
  Crown, 
  User, 
  Users, 
  LogOut, 
  Settings, 
  Activity, 
  Shield, 
  FolderOpen, 
  Eye, 
  BarChart3,
  Ticket,
  Network,
  MessageSquare,
  Users2,
  PieChart,
  DollarSign,
  Key,
  Globe,
  FileEdit,
  Wrench,
  FileText,
  Database,
  Gauge,
  Trophy,
  UserCheck,
  Hammer,
  TrendingUp,
  ScrollText,
  Server,
  Home,
  LineChart,
  GraduationCap,
  Lightbulb,
  Headphones,
  ShieldCheck,
  Building2,
  Gift,
  UserPlus,
  Megaphone,
  Menu,
  X,
  Zap
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { useGetCurrentMember } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { NotificationBell, NotificationBadgeCount } from "@/components/community/NotificationBell";

interface NavItem {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  requiredEntitlement?: string;
  showNotificationBadge?: boolean;
}

const navItems: NavItem[] = [
  { href: "/", label: "Home", icon: Home },
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/blitz", label: "The Blitz™", icon: Zap },
  { href: "/core-training", label: "Core Training", icon: GraduationCap },
  { href: "/training", label: "Training Library", icon: BookOpen },
  { href: "/resources", label: "Resources", icon: FolderOpen },
  { href: "/community", label: "Community", icon: Users, requiredEntitlement: "community:access", showNotificationBadge: true },
  { href: "/wins", label: "Wins", icon: Trophy },
  { href: "/tips-and-tricks", label: "Tips & Tricks", icon: Lightbulb },
  { href: "/coaching", label: "Coaching", icon: Video },
  { href: "/concierge", label: "BTS Concierge™", icon: Headphones },
  { href: "/coaching/sessions", label: "1:1 Coaching Sessions", icon: UserCheck },
  { href: "/advantage", label: "BTS Advantage", icon: Wrench },
  { href: "/apps", label: "Apps", icon: Hammer },
  { href: "/compliance", label: "Compliance Review", icon: ShieldCheck },
  { href: "/prime-corporate", label: "Prime Corporate", icon: Building2 },
  { href: "/ad-credit", label: "$1K Ad Credit", icon: Gift },
  { href: "/coaching/recruitment", label: "Become a Coach", icon: UserPlus },
  { href: "/self-promoting", label: "Promote BTS", icon: Megaphone },
  { href: "/commissions", label: "Commissions", icon: DollarSign, requiredEntitlement: "commissions:*" },
  { href: "/support", label: "Support", icon: LifeBuoy },
  { href: "/ai-assistant", label: "AI Assistant", icon: MessageCircle },
];

const adminGhlItems = [
  { href: "/admin/ghl", label: "GHL Sync", icon: Activity },
  { href: "/admin/ghl/contacts", label: "GHL Contacts", icon: Users },
  { href: "/admin/ghl/config", label: "GHL Config", icon: Settings },
  { href: "/admin/tickets", label: "Support Dashboard", icon: Shield },
  { href: "/settings/api-keys", label: "API Keys", icon: Key },
];

const adminNavItems: NavItem[] = [
  { href: "/admin/content/tracks", label: "Content Management", icon: FileEdit },
];

const adminTicketItems = [
  { href: "/admin/tickets", label: "Ticket Queue", icon: Ticket },
  { href: "/admin/routing-rules", label: "Routing Rules", icon: Network },
  { href: "/admin/canned-responses", label: "Canned Responses", icon: MessageSquare },
  { href: "/admin/agent-performance", label: "Agent Performance", icon: Users2 },
  { href: "/admin/analytics", label: "Support Analytics", icon: PieChart },
];

const adminCommunityItems = [
  { href: "/admin/community/categories", label: "Categories", icon: FolderOpen },
  { href: "/admin/community/moderation", label: "Moderation", icon: Eye },
  { href: "/admin/community/analytics", label: "Community Stats", icon: BarChart3 },
];

const adminCommissionItems = [
  { href: "/admin/commissions", label: "Commissions", icon: DollarSign },
];

const adminCoachingItems = [
  { href: "/admin/coaching", label: "1-on-1 Coaching", icon: Video },
];

const adminChatItems = [
  { href: "/admin/chat/analytics", label: "Chat Analytics", icon: BarChart3 },
  { href: "/admin/chat/transcripts", label: "Transcripts", icon: MessageSquare },
  { href: "/admin/chat/prompts", label: "System Prompts", icon: FileText },
  { href: "/admin/chat/knowledgebase", label: "Knowledgebase", icon: Database },
  { href: "/admin/chat/rate-limits", label: "Rate Limits", icon: Gauge },
];

const adminWinsItems = [
  { href: "/admin/wins", label: "Win Curation", icon: Trophy },
];

const adminToolItems = [
  { href: "/admin/tools", label: "Tool Management", icon: Hammer },
  { href: "/admin/tools/analytics", label: "Tool Analytics", icon: TrendingUp },
];

const adminPanelItems = [
  { href: "/admin/dashboard", label: "Admin Dashboard", icon: Home },
  { href: "/admin/members", label: "Members", icon: Users },
  { href: "/admin/audit-log", label: "Audit Log", icon: ScrollText },
  { href: "/admin/system", label: "System Health", icon: Server },
  { href: "/admin/settings", label: "Settings", icon: Settings },
];

const adminRevenueItems = [
  { href: "/admin/revenue", label: "Revenue Intelligence", icon: LineChart },
];

function SidebarContent({ onNavClick }: { onNavClick?: () => void }) {
  const [location] = useLocation();
  const { data: member } = useGetCurrentMember();
  const { user, logout } = useAuth();

  const isAdmin = user?.role === "admin" || member?.role === "admin";
  const entitlements = new Set(member?.entitlements ?? []);

  const productDisplayNames: Record<string, string> = {
    frontend: "Front-End Member",
    launchpad: "LaunchPad Member",
    "3month": "3-Month Mentorship",
    "6month": "6-Month Mentorship",
    "1year": "1-Year Mentorship",
    lifetime: "Lifetime Member",
    free: "Free Member",
  };

  const highestSlug = member?.sourceProduct ?? "free";
  const hasLifetime = highestSlug === "lifetime";

  return (
    <>
      <div className="p-6 border-b border-border/50">
        <div className="flex items-center gap-3">
          <img 
            src={`${import.meta.env.BASE_URL}images/bts-logo.png`} 
            alt="Build Test Scale" 
            className="w-10 h-10 object-contain"
          />
          <div>
            <h1 className="font-bold text-sm tracking-tight text-foreground leading-tight">BUILD TEST SCALE</h1>
            <p className="text-[10px] text-muted-foreground tracking-widest uppercase">Member Portal</p>
          </div>
        </div>
      </div>

      <div className="flex-1 py-4 px-3 space-y-0.5 overflow-y-auto">
        {navItems.map((item) => {
          const isActive = location === item.href || (item.href !== "/" && location.startsWith(item.href));
          const hasEntitlement = !item.requiredEntitlement
            || (item.requiredEntitlement.endsWith(":*")
              ? Array.from(entitlements).some((e: string) => e.startsWith(item.requiredEntitlement!.replace(":*", ":")))
              : entitlements.has(item.requiredEntitlement));
          const isLocked = item.requiredEntitlement && !hasEntitlement;
          if (item.requiredEntitlement?.endsWith(":*") && isLocked) return null;
          return (
            <Link key={item.href} href={item.href}>
              <div
                onClick={onNavClick}
                className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all cursor-pointer group",
                  isActive 
                    ? "bg-primary/10 text-primary" 
                    : isLocked
                    ? "text-muted-foreground/50 hover:bg-secondary/50"
                    : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                )}
              >
                <item.icon className={cn("w-5 h-5 transition-transform group-hover:scale-110", isActive ? "text-primary" : isLocked ? "opacity-50" : "")} />
                {item.label}
                {isLocked && <span className="ml-auto text-[9px] text-muted-foreground/60 bg-secondary px-1.5 py-0.5 rounded">Upgrade</span>}
                {!isLocked && item.showNotificationBadge && <NotificationBadgeCount />}
              </div>
            </Link>
          );
        })}

        {(member as any)?.role === "admin" && (
          <>
            <div className="mt-6 mb-2 px-3">
              <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                <Shield className="w-3.5 h-3.5" />
                Admin
              </div>
            </div>
            
            {[...adminPanelItems, ...adminNavItems, ...adminRevenueItems, ...adminGhlItems, ...adminTicketItems, ...adminCommunityItems, ...adminCommissionItems, ...adminCoachingItems, ...adminChatItems, ...adminWinsItems, ...adminToolItems].map((item) => {
              const isActive = location === item.href || (item.href !== "/" && location.startsWith(item.href));
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
          </>
        )}
      </div>

      <div className="p-4 mt-auto">
        {!hasLifetime && (
          <Card className="bg-gradient-to-br from-[#f8fafc] to-[#f1f5f9] border-blue-100/50 mb-4 shadow-sm">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <Crown className="w-4 h-4 text-primary" />
                <h4 className="font-semibold text-sm text-foreground">Upgrade Your Access</h4>
              </div>
              <p className="text-xs text-muted-foreground mb-3 leading-relaxed">
                Unlock more content, coaching, and priority support.
              </p>
              <Button className="w-full text-xs h-8" variant="default">View Plans</Button>
            </CardContent>
          </Card>
        )}

        <div className="flex items-center gap-3 px-2 py-2">
          <div className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-xs shrink-0">
            {member?.name?.split(' ').map(n => n[0]).join('') ?? '??'}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-foreground truncate">{member?.name ?? 'Loading...'}</p>
            <p className="text-xs text-muted-foreground truncate">
              {productDisplayNames[highestSlug] ?? highestSlug}
            </p>
          </div>
          {entitlements.has("community:access") && <NotificationBell />}
          <button
            onClick={() => logout()}
            className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
            title="Sign out"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </>
  );
}

export function Sidebar() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [location] = useLocation();

  useEffect(() => {
    setMobileOpen(false);
  }, [location]);

  useEffect(() => {
    if (mobileOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => { document.body.style.overflow = ""; };
  }, [mobileOpen]);

  return (
    <>
      <div className="fixed top-0 left-0 right-0 z-40 md:hidden bg-white border-b border-border flex items-center h-14 px-4">
        <button
          onClick={() => setMobileOpen(true)}
          className="p-2 -ml-2 rounded-lg text-foreground hover:bg-secondary transition-colors"
          aria-label="Open menu"
        >
          <Menu className="w-5 h-5" />
        </button>
        <div className="flex items-center gap-2 ml-2">
          <img 
            src={`${import.meta.env.BASE_URL}images/bts-logo.png`} 
            alt="Build Test Scale" 
            className="w-7 h-7 object-contain"
          />
          <span className="font-bold text-sm tracking-tight text-foreground">BTS</span>
        </div>
      </div>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div 
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => setMobileOpen(false)} 
          />
          <aside className="absolute left-0 top-0 bottom-0 w-72 max-w-[85vw] bg-white shadow-2xl flex flex-col animate-in slide-in-from-left duration-200">
            <div className="absolute top-4 right-4 z-10">
              <button
                onClick={() => setMobileOpen(false)}
                className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
                aria-label="Close menu"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <SidebarContent onNavClick={() => setMobileOpen(false)} />
          </aside>
        </div>
      )}

      <aside className="hidden md:flex w-64 shrink-0 flex-col bg-white border-r border-border min-h-screen sticky top-0">
        <SidebarContent />
      </aside>
    </>
  );
}
