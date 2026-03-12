import { Link, useLocation } from "wouter";
import { LayoutDashboard, BookOpen, Video, LifeBuoy, Crown, User } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

const navItems = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/training", label: "Training Library", icon: BookOpen },
  { href: "/coaching", label: "Coaching Calls", icon: Video },
  { href: "/support", label: "Support", icon: LifeBuoy },
];

export function Sidebar() {
  const [location] = useLocation();

  return (
    <aside className="w-64 shrink-0 flex flex-col bg-white border-r border-border min-h-screen sticky top-0">
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

      <div className="flex-1 py-6 px-4 space-y-1 overflow-y-auto">
        {navItems.map((item) => {
          const isActive = location === item.href || (item.href !== "/" && location.startsWith(item.href));
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
        <Card className="bg-gradient-to-br from-[#f8fafc] to-[#f1f5f9] border-blue-100/50 mb-4 shadow-sm">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <Crown className="w-4 h-4 text-primary" />
              <h4 className="font-semibold text-sm text-foreground">Upgrade to Diamond</h4>
            </div>
            <p className="text-xs text-muted-foreground mb-3 leading-relaxed">
              Get weekly 1-on-1 coaching and priority technical support.
            </p>
            <Button className="w-full text-xs h-8" variant="default">View Plans</Button>
          </CardContent>
        </Card>

        <div className="flex items-center gap-3 px-2 py-2">
          <div className="w-8 h-8 rounded-full bg-[#fcd34d] text-[#b45309] flex items-center justify-center font-bold text-xs shrink-0">
            MJ
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-foreground truncate">Marcus Johnson</p>
            <p className="text-xs text-[#b45309] font-medium truncate">Gold Member</p>
          </div>
        </div>
      </div>
    </aside>
  );
}
