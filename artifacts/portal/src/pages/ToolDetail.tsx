import { useEffect, Suspense, lazy } from "react";
import { useRoute, Link } from "wouter";
import { useGetToolBySlug, useLogToolUsage } from "@workspace/api-client-react";
import { useGetCurrentMember } from "@workspace/api-client-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, ExternalLink, HelpCircle, Lock, Sparkles, Calculator, Link as LinkIcon, FileText, Search, ShieldCheck, TrendingUp, Palette, Rocket, Maximize2, Minimize2 } from "lucide-react";
import { useState } from "react";

const iconMap: Record<string, any> = {
  Sparkles, Calculator, Link: LinkIcon, FileText, Search, ShieldCheck, TrendingUp, Palette,
};

function getIcon(name: string | null | undefined) {
  if (!name) return Rocket;
  return iconMap[name] || Rocket;
}

const componentRegistry: Record<string, React.LazyExoticComponent<any>> = {
  HeadlineGenerator: lazy(() => import("@/components/tools/HeadlineGenerator")),
  CampaignCalculator: lazy(() => import("@/components/tools/CampaignCalculator")),
  TrackingUrlBuilder: lazy(() => import("@/components/tools/TrackingUrlBuilder")),
};

export default function ToolDetail() {
  const [, params] = useRoute("/tools/:slug");
  const slug = params?.slug ?? "";
  const { data: tool, isLoading, error } = useGetToolBySlug(slug);
  const { data: member } = useGetCurrentMember();
  const logUsage = useLogToolUsage();
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    if (tool?.id) {
      logUsage.mutate({ toolId: tool.id, data: { action: "open" } });
    }
  }, [tool?.id]);

  if (isLoading) {
    return (
      <AppLayout>
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-card rounded w-64"></div>
          <div className="h-96 bg-card rounded-xl"></div>
        </div>
      </AppLayout>
    );
  }

  if (error || !tool) {
    return (
      <AppLayout>
        <div className="text-center p-12 bg-white rounded-xl border border-border">
          <h2 className="text-xl font-semibold">Tool not found</h2>
          <p className="text-muted-foreground mt-2">This tool may not exist or you may not have access.</p>
          <Link href="/tools">
            <Button variant="outline" className="mt-4">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to Tools
            </Button>
          </Link>
        </div>
      </AppLayout>
    );
  }

  if (tool.access === "locked") {
    const Icon = getIcon(tool.icon);
    return (
      <AppLayout>
        <div className="space-y-4">
          <Link href="/tools">
            <Button variant="ghost" size="sm" className="text-muted-foreground">
              <ArrowLeft className="w-4 h-4 mr-1" />
              Back to Tools
            </Button>
          </Link>
          <div className="text-center p-12 bg-white rounded-xl border border-border">
            <div className="w-16 h-16 rounded-2xl bg-secondary flex items-center justify-center mx-auto mb-4">
              <Icon className="w-8 h-8 text-muted-foreground" />
            </div>
            <Lock className="w-6 h-6 text-muted-foreground mx-auto mb-2" />
            <h2 className="text-xl font-semibold">{tool.name}</h2>
            <p className="text-muted-foreground mt-2 max-w-md mx-auto">{tool.shortDescription}</p>
            <Button className="mt-6">Upgrade to Unlock</Button>
          </div>
        </div>
      </AppLayout>
    );
  }

  const Icon = getIcon(tool.icon);
  const config = tool.config as any;
  const entitlements = new Set(tool.userEntitlements ?? []);

  const content = (() => {
    if (tool.type === "builtin") {
      const componentName = config?.component;
      const Component = componentName ? componentRegistry[componentName] : null;

      if (!Component) {
        return (
          <div className="text-center p-12 bg-white rounded-xl border border-border">
            <p className="text-muted-foreground">This tool is not yet available.</p>
          </div>
        );
      }

      return (
        <Suspense
          fallback={
            <div className="flex items-center justify-center h-64">
              <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full" />
            </div>
          }
        >
          <Component
            tool={tool}
            userId={member?.id}
            memberName={member?.name}
            entitlements={Array.from(entitlements)}
          />
        </Suspense>
      );
    }

    if (tool.type === "external") {
      return (
        <div className="bg-white rounded-xl border border-border p-8 text-center">
          <Icon className="w-12 h-12 text-primary mx-auto mb-4" />
          <h3 className="text-lg font-semibold mb-2">{tool.name}</h3>
          <p className="text-muted-foreground mb-6 max-w-lg mx-auto">
            {tool.longDescription || tool.shortDescription}
          </p>
          <a href={config?.url} target="_blank" rel="noopener noreferrer">
            <Button size="lg">
              <ExternalLink className="w-4 h-4 mr-2" />
              Launch Tool
            </Button>
          </a>
        </div>
      );
    }

    if (tool.type === "embedded") {
      return (
        <div className={`relative bg-white rounded-xl border border-border overflow-hidden ${isFullscreen ? "fixed inset-0 z-50 rounded-none" : ""}`}>
          <div className="flex items-center justify-between p-3 border-b bg-secondary/30">
            <span className="text-sm font-medium">{tool.name}</span>
            <div className="flex gap-2">
              <a href={config?.url} target="_blank" rel="noopener noreferrer">
                <Button variant="ghost" size="sm">
                  <ExternalLink className="w-4 h-4" />
                </Button>
              </a>
              <Button variant="ghost" size="sm" onClick={() => setIsFullscreen(!isFullscreen)}>
                {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
              </Button>
            </div>
          </div>
          <iframe
            src={config?.url}
            className="w-full border-0"
            style={{ height: isFullscreen ? "calc(100vh - 49px)" : "600px" }}
            title={tool.name}
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            onError={() => {}}
          />
        </div>
      );
    }

    return null;
  })();

  return (
    <AppLayout>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <Link href="/tools">
            <Button variant="ghost" size="sm" className="text-muted-foreground">
              <ArrowLeft className="w-4 h-4 mr-1" />
              Back to Tools
            </Button>
          </Link>
          <div className="flex gap-2">
            {tool.helpDocUrl && (
              <a href={tool.helpDocUrl} target="_blank" rel="noopener noreferrer">
                <Button variant="outline" size="sm">
                  <HelpCircle className="w-4 h-4 mr-1" />
                  Help
                </Button>
              </a>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
            <Icon className="w-5 h-5 text-primary" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold text-foreground">{tool.name}</h1>
              {tool.badge && <Badge variant="default" className="text-[10px]">{tool.badge}</Badge>}
            </div>
            <p className="text-sm text-muted-foreground">{tool.shortDescription}</p>
          </div>
        </div>

        {content}
      </div>
    </AppLayout>
  );
}
