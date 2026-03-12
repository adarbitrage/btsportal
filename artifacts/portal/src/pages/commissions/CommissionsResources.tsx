import { useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Copy, Check, Download, Mail, Share2, Image, BookOpen, ArrowLeft } from "lucide-react";
import { Link } from "wouter";
import { useCommissionResources } from "@/lib/commission-api";
import { useToast } from "@/hooks/use-toast";

export default function CommissionsResources() {
  const { data: resources, isLoading, error } = useCommissionResources();
  const { toast } = useToast();
  const [copiedId, setCopiedId] = useState<number | null>(null);

  const handleCopy = async (text: string, id: number) => {
    await navigator.clipboard.writeText(text);
    setCopiedId(id);
    toast({ title: "Copied!", description: "Content copied to clipboard." });
    setTimeout(() => setCopiedId(null), 2000);
  };

  if (isLoading) {
    return (
      <AppLayout>
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-40 bg-card rounded-xl animate-pulse" />
          ))}
        </div>
      </AppLayout>
    );
  }

  if (error || !resources) {
    return (
      <AppLayout>
        <div className="text-center p-12 bg-white rounded-xl border border-border">
          <h2 className="text-xl font-semibold text-foreground">Could not load resources</h2>
          <p className="text-muted-foreground mt-2">Please try refreshing the page.</p>
        </div>
      </AppLayout>
    );
  }

  const emailSwipes = resources.filter((r) => r.type === "email_swipe");
  const socialPosts = resources.filter((r) => r.type === "social_post");
  const banners = resources.filter((r) => r.type === "banner");
  const guidelines = resources.filter((r) => r.type === "guideline");

  return (
    <AppLayout>
      <div className="space-y-8">
        <div className="flex items-center gap-4">
          <Link href="/commissions">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to Commissions
            </Button>
          </Link>
        </div>

        <div className="bg-white rounded-2xl border border-border p-8 shadow-sm">
          <h1 className="text-3xl font-bold text-foreground mb-2">Promotional Resources</h1>
          <p className="text-muted-foreground">
            Ready-to-use marketing materials to help you promote BTS products and earn commissions.
          </p>
        </div>

        <Tabs defaultValue="email" className="w-full">
          <TabsList className="w-full justify-start border-b bg-transparent p-0 h-auto rounded-none">
            <TabsTrigger
              value="email"
              className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none px-6 py-3"
            >
              <Mail className="w-4 h-4 mr-2" />
              Email Swipes
            </TabsTrigger>
            <TabsTrigger
              value="social"
              className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none px-6 py-3"
            >
              <Share2 className="w-4 h-4 mr-2" />
              Social Posts
            </TabsTrigger>
            <TabsTrigger
              value="banners"
              className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none px-6 py-3"
            >
              <Image className="w-4 h-4 mr-2" />
              Banners
            </TabsTrigger>
            <TabsTrigger
              value="guidelines"
              className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none px-6 py-3"
            >
              <BookOpen className="w-4 h-4 mr-2" />
              Guidelines
            </TabsTrigger>
          </TabsList>

          <div className="mt-6">
            <TabsContent value="email">
              <div className="space-y-4">
                {emailSwipes.length > 0 ? (
                  emailSwipes.map((item) => (
                    <ResourceCard
                      key={item.id}
                      item={item}
                      copiedId={copiedId}
                      onCopy={handleCopy}
                    />
                  ))
                ) : (
                  <EmptyState label="email swipes" />
                )}
              </div>
            </TabsContent>

            <TabsContent value="social">
              <div className="space-y-4">
                {socialPosts.length > 0 ? (
                  socialPosts.map((item) => (
                    <ResourceCard
                      key={item.id}
                      item={item}
                      copiedId={copiedId}
                      onCopy={handleCopy}
                    />
                  ))
                ) : (
                  <EmptyState label="social post templates" />
                )}
              </div>
            </TabsContent>

            <TabsContent value="banners">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {banners.length > 0 ? (
                  banners.map((item) => (
                    <Card key={item.id}>
                      <CardContent className="p-4">
                        {item.imageUrl && (
                          <div className="mb-4 rounded-lg overflow-hidden bg-secondary/50 aspect-[16/9] flex items-center justify-center">
                            <img
                              src={item.imageUrl}
                              alt={item.title}
                              className="max-w-full max-h-full object-contain"
                            />
                          </div>
                        )}
                        <h3 className="font-semibold text-foreground mb-1">{item.title}</h3>
                        <p className="text-sm text-muted-foreground mb-3">{item.content}</p>
                        {item.imageUrl && (
                          <a href={item.imageUrl} download>
                            <Button variant="outline" size="sm">
                              <Download className="w-4 h-4 mr-2" />
                              Download
                            </Button>
                          </a>
                        )}
                      </CardContent>
                    </Card>
                  ))
                ) : (
                  <div className="col-span-2">
                    <EmptyState label="banner images" />
                  </div>
                )}
              </div>
            </TabsContent>

            <TabsContent value="guidelines">
              <div className="space-y-4">
                {guidelines.length > 0 ? (
                  guidelines.map((item) => (
                    <Card key={item.id}>
                      <CardContent className="p-6">
                        <h3 className="font-semibold text-foreground mb-3">{item.title}</h3>
                        <div className="prose prose-sm max-w-none text-muted-foreground whitespace-pre-wrap">
                          {item.content}
                        </div>
                      </CardContent>
                    </Card>
                  ))
                ) : (
                  <EmptyState label="guidelines" />
                )}
              </div>
            </TabsContent>
          </div>
        </Tabs>
      </div>
    </AppLayout>
  );
}

function ResourceCard({
  item,
  copiedId,
  onCopy,
}: {
  item: { id: number; title: string; content: string; category: string };
  copiedId: number | null;
  onCopy: (text: string, id: number) => void;
}) {
  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardContent className="p-6">
        <div className="flex items-start justify-between mb-3">
          <div>
            <h3 className="font-semibold text-foreground">{item.title}</h3>
            <Badge variant="outline" className="text-[10px] mt-1">
              {item.category}
            </Badge>
          </div>
          <Button
            variant={copiedId === item.id ? "default" : "outline"}
            size="sm"
            onClick={() => onCopy(item.content, item.id)}
          >
            {copiedId === item.id ? (
              <Check className="w-4 h-4 mr-1" />
            ) : (
              <Copy className="w-4 h-4 mr-1" />
            )}
            {copiedId === item.id ? "Copied" : "Copy"}
          </Button>
        </div>
        <div className="bg-secondary/50 rounded-lg p-4 text-sm text-muted-foreground whitespace-pre-wrap font-mono text-xs leading-relaxed max-h-40 overflow-y-auto">
          {item.content}
        </div>
      </CardContent>
    </Card>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="text-center py-12 text-muted-foreground">
      <p>No {label} available yet. Check back soon!</p>
    </div>
  );
}
