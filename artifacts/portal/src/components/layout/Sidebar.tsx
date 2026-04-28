import { Link, useLocation } from "wouter";
import { useState, useEffect, useCallback, useRef } from "react";
import {
  LayoutDashboard,
  BookOpen,
  Video,
  LifeBuoy,
  MessageCircle,
  Crown,
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
  Zap,
  AppWindow,
  Users,
  ChevronRight,
  ArrowLeft,
  Home,
  Briefcase,
  Mail,
  Radio,
  BookMarked,
  Layers,
  UserCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useGetCurrentMember, type MemberProfile } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { NotificationBell, NotificationBadgeCount } from "@/components/community/NotificationBell";

type LucideIcon = typeof LayoutDashboard;
type AdminRole = "super_admin" | "admin" | "support_agent" | "content_manager";

interface NavLeaf {
  kind: "leaf";
  href: string;
  label: string;
  icon: LucideIcon;
  requiredEntitlement?: string;
  showNotificationBadge?: boolean;
  visibleToRoles?: AdminRole[];
}

interface NavFolder {
  kind: "folder";
  storageKey: string;
  label: string;
  icon: LucideIcon;
  defaultOpen?: boolean;
  children: NavNode[];
  visibleToRoles?: AdminRole[];
}

type NavNode = NavLeaf | NavFolder;

const MEMBER_NAV: NavNode[] = [
  {
    kind: "leaf",
    href: "/dashboard",
    label: "Dashboard",
    icon: LayoutDashboard,
  },
  {
    kind: "folder",
    storageKey: "training",
    label: "Training",
    icon: GraduationCap,
    defaultOpen: false,
    children: [
      { kind: "leaf", href: "/blitz", label: "The Blitz™", icon: Zap },
      { kind: "leaf", href: "/core-training", label: "Core Training", icon: BookOpen },
      { kind: "leaf", href: "/tips-and-tricks", label: "Tips & Tricks", icon: Lightbulb },
      { kind: "leaf", href: "/training", label: "Training Library", icon: BookMarked },
    ],
  },
  {
    kind: "folder",
    storageKey: "tools-apps",
    label: "Tools & Apps",
    icon: Wrench,
    defaultOpen: false,
    children: [
      { kind: "leaf", href: "/apps", label: "Apps", icon: AppWindow, requiredEntitlement: "software:base" },
      { kind: "leaf", href: "/ai-assistant", label: "AI Assistant", icon: MessageCircle },
      { kind: "leaf", href: "/compliance", label: "Compliance Review", icon: ShieldCheck, requiredEntitlement: "software:base" },
    ],
  },
  {
    kind: "folder",
    storageKey: "coaching",
    label: "Coaching",
    icon: Video,
    defaultOpen: false,
    children: [
      { kind: "leaf", href: "/coaching", label: "Coaching Calls", icon: Video, requiredEntitlement: "coaching:group" },
      { kind: "leaf", href: "/coaching/one-on-one", label: "1-on-1 Coaching", icon: UserCheck, requiredEntitlement: "coaching:one_on_one:*" },
      { kind: "leaf", href: "/concierge", label: "BTS Concierge™", icon: Headphones },
    ],
  },
  {
    kind: "leaf",
    href: "/community",
    label: "Community",
    icon: Users,
    requiredEntitlement: "community:access",
    showNotificationBadge: true,
  },
  {
    kind: "folder",
    storageKey: "earn",
    label: "Earn",
    icon: DollarSign,
    defaultOpen: false,
    children: [
      { kind: "leaf", href: "/commissions", label: "Commissions", icon: DollarSign, requiredEntitlement: "commissions:*" },
      { kind: "leaf", href: "/self-promoting", label: "Promote BTS", icon: Megaphone, requiredEntitlement: "commissions:*" },
      { kind: "leaf", href: "/ad-credit", label: "$1K Ad Credit", icon: Gift },
      { kind: "leaf", href: "/coaching/recruitment", label: "Become a Coach", icon: UserPlus },
    ],
  },
  {
    kind: "folder",
    storageKey: "resources",
    label: "Resources",
    icon: FolderOpen,
    defaultOpen: false,
    children: [
      { kind: "leaf", href: "/resources", label: "Resource Vault", icon: FolderOpen },
      { kind: "leaf", href: "/prime-corporate", label: "Prime Corporate", icon: Building2 },
    ],
  },
  { kind: "leaf", href: "/wins", label: "Wins", icon: Trophy },
  { kind: "leaf", href: "/advantage", label: "BTS Advantage", icon: Wrench },
  { kind: "leaf", href: "/support", label: "Support", icon: LifeBuoy },
  { kind: "leaf", href: "/account", label: "Account", icon: UserCircle },
];

const ADMIN_CHILDREN: NavNode[] = [
  { kind: "leaf", href: "/admin/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { kind: "leaf", href: "/admin/members", label: "Members", icon: Users },
  { kind: "leaf", href: "/admin/settings", label: "Products & Entitlements", icon: Layers },
  {
    kind: "folder",
    storageKey: "admin-content",
    label: "Content",
    icon: FileEdit,
    defaultOpen: false,
    visibleToRoles: ["super_admin", "admin", "content_manager"],
    children: [
      { kind: "leaf", href: "/admin/content/tracks", label: "Training CMS", icon: GraduationCap },
      { kind: "leaf", href: "/admin/resources", label: "Resource Vault", icon: FolderOpen },
      { kind: "leaf", href: "/admin/collections", label: "Collections", icon: Layers },
      { kind: "leaf", href: "/admin/vault/analytics", label: "Vault Analytics", icon: BarChart3 },
    ],
  },
  {
    kind: "folder",
    storageKey: "admin-support",
    label: "Support",
    icon: LifeBuoy,
    defaultOpen: false,
    visibleToRoles: ["super_admin", "admin", "support_agent"],
    children: [
      { kind: "leaf", href: "/admin/tickets", label: "Ticket Queue", icon: Ticket },
      { kind: "leaf", href: "/admin/routing-rules", label: "Routing Rules", icon: Network },
      { kind: "leaf", href: "/admin/canned-responses", label: "Canned Responses", icon: MessageSquare },
      { kind: "leaf", href: "/admin/agent-performance", label: "Agent Performance", icon: Users2 },
      { kind: "leaf", href: "/admin/analytics", label: "Support Analytics", icon: PieChart },
    ],
  },
  {
    kind: "folder",
    storageKey: "admin-coaching",
    label: "Coaching",
    icon: Video,
    defaultOpen: false,
    visibleToRoles: ["super_admin", "admin"],
    children: [
      { kind: "leaf", href: "/admin/coaching/availability", label: "Call Schedules", icon: Activity },
      { kind: "leaf", href: "/admin/coaching/sessions", label: "1-on-1 Sessions", icon: UserCheck },
      { kind: "leaf", href: "/admin/coaching", label: "Coach Management", icon: Users2 },
    ],
  },
  {
    kind: "folder",
    storageKey: "admin-community",
    label: "Community",
    icon: Users,
    defaultOpen: false,
    visibleToRoles: ["super_admin", "admin", "content_manager"],
    children: [
      { kind: "leaf", href: "/admin/community/moderation", label: "Moderation Queue", icon: Eye },
      { kind: "leaf", href: "/admin/community/categories", label: "Categories", icon: FolderOpen },
      { kind: "leaf", href: "/admin/community/analytics", label: "Community Stats", icon: BarChart3 },
    ],
  },
  {
    kind: "folder",
    storageKey: "admin-commissions",
    label: "Commissions",
    icon: DollarSign,
    defaultOpen: false,
    visibleToRoles: ["super_admin", "admin"],
    children: [
      { kind: "leaf", href: "/admin/commissions", label: "Commission Overview", icon: DollarSign },
      { kind: "leaf", href: "/admin/commissions/all", label: "All Commissions", icon: ScrollText },
      { kind: "leaf", href: "/admin/commissions/payouts", label: "Payouts", icon: TrendingUp },
      { kind: "leaf", href: "/admin/commissions/rates", label: "Rates", icon: BarChart3 },
      { kind: "leaf", href: "/admin/commissions/affiliates", label: "Affiliates", icon: UserPlus },
      { kind: "leaf", href: "/admin/commissions/fraud", label: "Fraud Alerts", icon: Shield },
    ],
  },
  {
    kind: "folder",
    storageKey: "admin-communications",
    label: "Communications",
    icon: Mail,
    defaultOpen: false,
    visibleToRoles: ["super_admin", "admin"],
    children: [
      { kind: "leaf", href: "/admin/communications/templates", label: "Email Templates", icon: FileText },
      { kind: "leaf", href: "/admin/communications/sms-templates", label: "SMS Templates", icon: MessageSquare },
      { kind: "leaf", href: "/admin/communications/sequences", label: "Sequences", icon: Network },
      { kind: "leaf", href: "/admin/communications/broadcasts", label: "Broadcasts", icon: Radio },
      { kind: "leaf", href: "/admin/communications/log", label: "Log", icon: ScrollText },
      { kind: "leaf", href: "/admin/communications/analytics", label: "Analytics", icon: BarChart3 },
    ],
  },
  {
    kind: "folder",
    storageKey: "admin-knowledge-base",
    label: "Knowledge Base",
    icon: Database,
    defaultOpen: false,
    visibleToRoles: ["super_admin", "admin", "support_agent", "content_manager"],
    children: [
      { kind: "leaf", href: "/admin/chat/knowledgebase/review", label: "Document Review", icon: Eye },
      { kind: "leaf", href: "/admin/chat/knowledgebase", label: "Live Documents", icon: Database },
    ],
  },
  {
    kind: "folder",
    storageKey: "admin-tools-mgmt",
    label: "Tools Management",
    icon: Hammer,
    defaultOpen: false,
    visibleToRoles: ["super_admin", "admin"],
    children: [
      { kind: "leaf", href: "/admin/tools", label: "Tool Registry", icon: Hammer },
      { kind: "leaf", href: "/admin/tools/analytics", label: "Tool Analytics", icon: TrendingUp },
    ],
  },
  {
    kind: "folder",
    storageKey: "admin-integrations",
    label: "Integrations",
    icon: Activity,
    defaultOpen: false,
    visibleToRoles: ["super_admin", "admin"],
    children: [
      { kind: "leaf", href: "/admin/ghl", label: "GHL Sync", icon: Activity },
      { kind: "leaf", href: "/admin/ghl/contacts", label: "GHL Contacts", icon: Users },
      { kind: "leaf", href: "/admin/ghl/config", label: "GHL Config", icon: Settings },
      { kind: "leaf", href: "/settings/api-keys", label: "API Keys", icon: Key },
    ],
  },
  { kind: "leaf", href: "/admin/wins", label: "Wins Curation", icon: Trophy, visibleToRoles: ["super_admin", "admin"] },
  { kind: "leaf", href: "/admin/revenue", label: "Revenue Intelligence", icon: LineChart, visibleToRoles: ["super_admin", "admin"] },
  { kind: "leaf", href: "/admin/audit-log", label: "Audit Log", icon: ScrollText, visibleToRoles: ["super_admin", "admin"] },
  { kind: "leaf", href: "/admin/system", label: "System Health", icon: Server, visibleToRoles: ["super_admin", "admin"] },
];

const ADMIN_NAV_FOLDER: NavFolder = {
  kind: "folder",
  storageKey: "admin-root",
  label: "Admin",
  icon: Shield,
  defaultOpen: false,
  children: ADMIN_CHILDREN,
};

const LS_PREFIX = "sidebar-folder-";

function useFolderState(key: string, defaultOpen: boolean) {
  const storageKey = LS_PREFIX + key;
  const [open, setOpenState] = useState<boolean>(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored !== null) return stored === "true";
    } catch {}
    return defaultOpen;
  });

  const setOpen = useCallback((val: boolean) => {
    setOpenState(val);
    try {
      localStorage.setItem(storageKey, String(val));
    } catch {}
  }, [storageKey]);

  return [open, setOpen] as const;
}

function leafMatchesLocation(leaf: NavLeaf, location: string): boolean {
  return location === leaf.href || (leaf.href !== "/" && location.startsWith(leaf.href));
}

function nodeContainsLocation(node: NavNode, location: string): boolean {
  if (node.kind === "leaf") return leafMatchesLocation(node, location);
  return node.children.some((child) => nodeContainsLocation(child, location));
}

function hasEntitlementCheck(
  requiredEntitlement: string | undefined,
  entitlements: Set<string>
): boolean {
  if (!requiredEntitlement) return true;
  if (requiredEntitlement.endsWith(":*")) {
    const prefix = requiredEntitlement.replace(":*", ":");
    return Array.from(entitlements).some((e: string) => e.startsWith(prefix));
  }
  return entitlements.has(requiredEntitlement);
}

function allChildrenLocked(children: NavNode[], entitlements: Set<string>): boolean {
  return children.every((child) => {
    if (child.kind === "folder") return allChildrenLocked(child.children, entitlements);
    if (!child.requiredEntitlement) return false;
    return !hasEntitlementCheck(child.requiredEntitlement, entitlements);
  });
}

interface LeafRowProps {
  leaf: NavLeaf;
  location: string;
  entitlements: Set<string>;
  onNavClick?: () => void;
  indent?: number;
}

function LeafRow({ leaf, location, entitlements, onNavClick, indent = 0 }: LeafRowProps) {
  const isActive = leafMatchesLocation(leaf, location);
  const hasEnt = hasEntitlementCheck(leaf.requiredEntitlement, entitlements);
  const isLocked = !!leaf.requiredEntitlement && !hasEnt;

  return (
    <Link href={isLocked ? "#" : leaf.href}>
      <div
        onClick={isLocked ? undefined : onNavClick}
        style={{ paddingLeft: `${12 + indent * 12}px` }}
        className={cn(
          "flex items-center gap-3 pr-3 py-2 rounded-lg text-sm font-medium transition-all cursor-pointer group",
          isActive
            ? "bg-primary/10 text-primary"
            : isLocked
            ? "text-muted-foreground/50 hover:bg-secondary/50"
            : "text-muted-foreground hover:bg-secondary hover:text-foreground"
        )}
      >
        <leaf.icon
          className={cn(
            "w-4 h-4 shrink-0 transition-transform group-hover:scale-110",
            isActive ? "text-primary" : isLocked ? "opacity-50" : ""
          )}
        />
        <span className="truncate">{leaf.label}</span>
        {isLocked && (
          <span className="ml-auto shrink-0 text-[9px] text-muted-foreground/60 bg-secondary px-1.5 py-0.5 rounded">
            Upgrade
          </span>
        )}
        {!isLocked && leaf.showNotificationBadge && <NotificationBadgeCount />}
      </div>
    </Link>
  );
}

interface FolderRowProps {
  folder: NavFolder;
  location: string;
  entitlements: Set<string>;
  onNavClick?: () => void;
  indent?: number;
  isAdminNode?: boolean;
  onCollapseAdmin?: () => void;
}

function FolderRow({
  folder,
  location,
  entitlements,
  onNavClick,
  indent = 0,
  isAdminNode = false,
  onCollapseAdmin,
}: FolderRowProps) {
  const containsCurrent = nodeContainsLocation(folder, location);
  const [open, setOpen] = useFolderState(
    folder.storageKey,
    containsCurrent ? true : (folder.defaultOpen ?? true)
  );

  useEffect(() => {
    if (containsCurrent) setOpen(true);
  }, [location, containsCurrent]);

  if (allChildrenLocked(folder.children, entitlements)) return null;

  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        style={{ paddingLeft: `${12 + indent * 12}px` }}
        className={cn(
          "w-full flex items-center gap-3 pr-3 py-2 rounded-lg text-sm font-medium transition-all cursor-pointer group",
          containsCurrent && !open
            ? "bg-primary/10 text-primary"
            : "text-muted-foreground hover:bg-secondary hover:text-foreground"
        )}
      >
        <folder.icon
          className={cn(
            "w-4 h-4 shrink-0 transition-transform group-hover:scale-110",
            containsCurrent && !open ? "text-primary" : ""
          )}
        />
        <span className="flex-1 text-left truncate">{folder.label}</span>
        <ChevronRight
          className={cn(
            "w-3.5 h-3.5 shrink-0 transition-transform duration-200",
            open ? "rotate-90" : ""
          )}
        />
      </button>

      {open && (
        <div className="mt-0.5 space-y-0.5">
          {folder.children.map((child, i) => (
            <NavNodeRow
              key={child.kind === "leaf" ? child.href : child.storageKey + i}
              node={child}
              location={location}
              entitlements={entitlements}
              onNavClick={onNavClick}
              indent={indent + 1}
              isAdminNode={isAdminNode}
            />
          ))}
          {isAdminNode && folder.storageKey === "admin-root" && onCollapseAdmin && (
            <button
              onClick={() => {
                setOpen(false);
                onCollapseAdmin();
              }}
              style={{ paddingLeft: `${12 + (indent + 1) * 12}px` }}
              className="w-full flex items-center gap-3 pr-3 py-2 rounded-lg text-sm font-medium text-muted-foreground hover:bg-secondary hover:text-foreground transition-all cursor-pointer group"
            >
              <ArrowLeft className="w-4 h-4 shrink-0" />
              <span>Back to Portal</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}

interface NavNodeRowProps {
  node: NavNode;
  location: string;
  entitlements: Set<string>;
  onNavClick?: () => void;
  indent?: number;
  isAdminNode?: boolean;
  onCollapseAdmin?: () => void;
  userRole?: string;
}

function NavNodeRow({
  node,
  location,
  entitlements,
  onNavClick,
  indent = 0,
  isAdminNode = false,
  onCollapseAdmin,
  userRole,
}: NavNodeRowProps) {
  if (node.kind === "leaf") {
    if (node.visibleToRoles && userRole) {
      if (!node.visibleToRoles.includes(userRole as AdminRole)) return null;
    }
    return (
      <LeafRow
        leaf={node}
        location={location}
        entitlements={entitlements}
        onNavClick={onNavClick}
        indent={indent}
      />
    );
  }

  if (node.visibleToRoles && userRole) {
    if (!node.visibleToRoles.includes(userRole as AdminRole)) return null;
  }

  return (
    <FolderRow
      folder={node}
      location={location}
      entitlements={entitlements}
      onNavClick={onNavClick}
      indent={indent}
      isAdminNode={isAdminNode}
      onCollapseAdmin={onCollapseAdmin}
    />
  );
}

const ADMIN_ROLES: AdminRole[] = ["super_admin", "admin", "support_agent", "content_manager"];

function filterAdminChildren(children: NavNode[], role: AdminRole): NavNode[] {
  const supportOnly = ["super_admin", "admin"].includes(role)
    ? null
    : role === "support_agent"
    ? ["admin-support", "admin-knowledge-base"]
    : role === "content_manager"
    ? ["admin-content", "admin-knowledge-base"]
    : null;

  if (!supportOnly) return children;

  return children.filter((node) => {
    if (node.kind === "folder") return supportOnly.includes(node.storageKey);
    return false;
  });
}

function SidebarContent({ onNavClick }: { onNavClick?: () => void }) {
  const [location] = useLocation();
  const { data: member } = useGetCurrentMember() as { data: MemberProfile | undefined };
  const { user, logout } = useAuth();
  const scrollRef = useRef<HTMLDivElement>(null);

  const entitlements = new Set<string>(member?.entitlements ?? []);

  const roleFromAuth = user?.role ?? "";
  const roleFromMember = member?.role ?? "";
  const userRole: string = ADMIN_ROLES.includes(roleFromAuth as AdminRole)
    ? roleFromAuth
    : ADMIN_ROLES.includes(roleFromMember as AdminRole)
    ? roleFromMember
    : roleFromAuth || roleFromMember;
  const isAdminUser =
    ADMIN_ROLES.includes(roleFromAuth as AdminRole) ||
    ADMIN_ROLES.includes(roleFromMember as AdminRole);

  const productDisplayNames: Record<string, string> = {
    frontend: "Front-End Member",
    launchpad: "LaunchPad Member",
    "3month": "3-Month Mentorship",
    "6month": "6-Month Mentorship",
    "1year": "1-Year Mentorship",
    lifetime: "Lifetime Member",
    free: "Free Member",
  };

  const highestSlug: string = member?.sourceProduct ?? "free";
  const hasLifetime = highestSlug === "lifetime";

  const filteredAdminChildren = isAdminUser
    ? filterAdminChildren(ADMIN_CHILDREN, userRole as AdminRole)
    : [];

  const adminFolder: NavFolder = {
    ...ADMIN_NAV_FOLDER,
    children: filteredAdminChildren,
  };

  const collapseAdminFolder = useCallback(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, []);

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
            <h1 className="font-bold text-sm tracking-tight text-foreground leading-tight">
              BUILD TEST SCALE
            </h1>
            <p className="text-[10px] text-muted-foreground tracking-widest uppercase">
              Member Portal
            </p>
          </div>
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 py-4 px-3 space-y-0.5 overflow-y-auto">
        {MEMBER_NAV.map((node, i) => (
          <NavNodeRow
            key={node.kind === "leaf" ? node.href : node.storageKey + i}
            node={node}
            location={location}
            entitlements={entitlements}
            onNavClick={onNavClick}
            indent={0}
            isAdminNode={false}
            userRole={userRole}
          />
        ))}

        {isAdminUser && (
          <div className="mt-6 pt-4 border-t border-border/50">
            <div className="flex items-center gap-2 px-3 mb-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              <Shield className="w-3.5 h-3.5" />
              Admin
            </div>
            <div className="pl-1 border-l-2 border-primary/20 ml-1 space-y-0.5 bg-primary/[0.02] rounded-r-lg">
              <FolderRow
                folder={adminFolder}
                location={location}
                entitlements={entitlements}
                onNavClick={onNavClick}
                indent={0}
                isAdminNode={true}
                onCollapseAdmin={collapseAdminFolder}
              />
            </div>
          </div>
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
              <Button className="w-full text-xs h-8" variant="default">
                View Plans
              </Button>
            </CardContent>
          </Card>
        )}

        <div className="flex items-center gap-3 px-2 py-2">
          <div className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-xs shrink-0">
            {member?.name?.split(" ").map((n) => n[0]).join("") ?? "??"}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-foreground truncate">
              {member?.name ?? "Loading..."}
            </p>
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
    return () => {
      document.body.style.overflow = "";
    };
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
