import { useState, useMemo } from "react";
import { useListTools } from "@workspace/api-client-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Link } from "wouter";
import { Search, Lock, Sparkles, Calculator, Link as LinkIcon, FileText, ShieldCheck, TrendingUp, Palette, Star, Rocket, Users } from "lucide-react";

const iconMap: Record<string, any> = {
  Sparkles, Calculator, Link: LinkIcon, FileText, Search, ShieldCheck, TrendingUp, Palette,
};

function getIcon(name: string | null | undefined) {
  if (!name) return Rocket;
  return iconMap[name] || Rocket;
}

export default function Tools() {
  const { data, isLoading, error } = useListTools();
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState("all");

  const filteredTools = useMemo(() => {
    if (!data?.tools) return [];
    let tools = data.tools.filter((t) => t.status !== "coming_soon" || true);
    if (activeCategory !== "all") {
      tools = tools.filter((t) => t.categorySlug === activeCategory);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      tools = tools.filter(
        (t) =>
          t.name.toLowerCase().includes(q) ||
          t.shortDescription.toLowerCase().includes(q)
      );
    }
    return tools;
  }, [data, search, activeCategory]);

  const featuredTools = useMemo(
    () => filteredTools.filter((t) => t.isFeatured && t.access === "granted"),
    [filteredTools]
  );

  const regularTools = useMemo(
    () => filteredTools.filter((t) => !t.isFeatured || t.access !== "granted"),
    [filteredTools]
  );

  if (isLoading) {
    return (
      <AppLayout>
        <div className="animate-pulse space-y-6">
          <div className="h-10 bg-card rounded-xl w-64"></div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className="h-48 bg-card rounded-xl"></div>
            ))}
          </div>
        </div>
      </AppLayout>
    );
  }

  if (error) {
    return (
      <AppLayout>
        <div className="text-center p-12 bg-white rounded-xl border border-border">
          <h2 className="text-xl font-semibold">Could not load tools</h2>
          <p className="text-muted-foreground mt-2">
            {(error as any)?.message?.includes("403")
              ? "You need a software entitlement to access tools. Upgrade your plan to unlock this feature."
              : "Please try refreshing the page."}
          </p>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="space-y-8">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Software & Tools</h1>
          <p className="text-muted-foreground mt-1">
            Powerful tools to help you build, test, and scale your campaigns.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row gap-4">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search tools..."
              className="pl-9"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

        <div className="flex gap-2 overflow-x-auto pb-2">
          <Button
            variant={activeCategory === "all" ? "default" : "outline"}
            size="sm"
            onClick={() => setActiveCategory("all")}
          >
            All
          </Button>
          {data?.categories?.map((cat) => (
            <Button
              key={cat.slug}
              variant={activeCategory === cat.slug ? "default" : "outline"}
              size="sm"
              onClick={() => setActiveCategory(cat.slug)}
              className="whitespace-nowrap"
            >
              {cat.name}
            </Button>
          ))}
        </div>

        {featuredTools.length > 0 && activeCategory === "all" && !search && (
          <div>
            <div className="flex items-center gap-2 mb-4">
              <Star className="w-5 h-5 text-yellow-500 fill-yellow-500" />
              <h2 className="text-lg font-bold text-foreground">Featured Tools</h2>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {featuredTools.map((tool) => (
                <FeaturedToolCard key={tool.id} tool={tool} />
              ))}
            </div>
          </div>
        )}

        <div>
          {(featuredTools.length > 0 && activeCategory === "all" && !search) && (
            <h2 className="text-lg font-bold text-foreground mb-4">All Tools</h2>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {(activeCategory === "all" && !search ? regularTools : filteredTools).map((tool) => (
              <ToolCard key={tool.id} tool={tool} />
            ))}
          </div>
          {filteredTools.length === 0 && (
            <div className="text-center py-12 text-muted-foreground">
              No tools found matching your criteria.
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  );
}

function FeaturedToolCard({ tool }: { tool: any }) {
  const Icon = getIcon(tool.icon);

  return (
    <Link href={`/tools/${tool.slug}`}>
      <Card className="border-2 border-primary/20 bg-gradient-to-br from-primary/5 to-white hover:shadow-lg transition-all cursor-pointer group">
        <CardContent className="p-6">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center shrink-0 group-hover:scale-110 transition-transform">
              <Icon className="w-6 h-6 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <h3 className="font-bold text-foreground">{tool.name}</h3>
                {tool.badge && (
                  <Badge variant="default" className="text-[10px] px-1.5 py-0">
                    {tool.badge}
                  </Badge>
                )}
                <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-yellow-400 text-yellow-600 bg-yellow-50">
                  Featured
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground line-clamp-2">
                {tool.shortDescription}
              </p>
              <div className="flex items-center justify-between mt-3">
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Users className="w-3 h-3" />
                  {tool.totalLaunches.toLocaleString()} launches
                </div>
                <Button size="sm" className="h-7 text-xs">
                  Open Tool
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

function ToolCard({ tool }: { tool: any }) {
  const Icon = getIcon(tool.icon);
  const isLocked = tool.access === "locked";
  const isComingSoon = tool.status === "coming_soon";
  const isDimmed = isLocked || isComingSoon;

  return (
    <div className={isDimmed ? "opacity-60" : ""}>
      {isComingSoon ? (
        <Card className="hover:shadow-md transition-all">
          <CardContent className="p-5">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-lg bg-secondary flex items-center justify-center shrink-0">
                <Icon className="w-5 h-5 text-muted-foreground" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="font-semibold text-foreground text-sm">{tool.name}</h3>
                  <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                    Coming Soon
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground line-clamp-2">
                  {tool.shortDescription}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : isLocked ? (
        <Card className="hover:shadow-md transition-all">
          <CardContent className="p-5">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-lg bg-secondary flex items-center justify-center shrink-0 relative">
                <Icon className="w-5 h-5 text-muted-foreground" />
                <Lock className="w-3 h-3 text-muted-foreground absolute -bottom-0.5 -right-0.5" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="font-semibold text-foreground text-sm">{tool.name}</h3>
                  {tool.badge && (
                    <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                      {tool.badge}
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground line-clamp-2">
                  {tool.shortDescription}
                </p>
                <div className="flex items-center justify-between mt-3">
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Users className="w-3 h-3" />
                    {tool.totalLaunches.toLocaleString()} launches
                  </div>
                  <Button size="sm" variant="outline" className="h-7 text-xs" disabled>
                    <Lock className="w-3 h-3 mr-1" />
                    Upgrade to unlock
                  </Button>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Link href={`/tools/${tool.slug}`}>
          <Card className="hover:shadow-md transition-all cursor-pointer group">
            <CardContent className="p-5">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 group-hover:scale-110 transition-transform">
                  <Icon className="w-5 h-5 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-semibold text-foreground text-sm">{tool.name}</h3>
                    {tool.badge && (
                      <Badge variant="default" className="text-[10px] px-1.5 py-0">
                        {tool.badge}
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground line-clamp-2">
                    {tool.shortDescription}
                  </p>
                  <div className="flex items-center justify-between mt-3">
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Users className="w-3 h-3" />
                      {tool.totalLaunches.toLocaleString()} launches
                    </div>
                    <Button size="sm" className="h-7 text-xs">
                      Open Tool
                    </Button>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </Link>
      )}
    </div>
  );
}
