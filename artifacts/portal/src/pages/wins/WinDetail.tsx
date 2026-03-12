import { useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useWin, useToggleWinReaction } from "@/hooks/use-wins";
import { useRoute, Link } from "wouter";
import { ArrowLeft, Star, CheckCircle2, DollarSign, Calendar, Flame, MessageSquare, ExternalLink, X } from "lucide-react";
import { format } from "date-fns";

export default function WinDetail() {
  const [, params] = useRoute("/wins/:id");
  const winId = parseInt(params?.id ?? "0", 10);
  const { data: win, isLoading, error } = useWin(winId);
  const toggleReaction = useToggleWinReaction();
  const [expandedImage, setExpandedImage] = useState<string | null>(null);

  return (
    <AppLayout>
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="flex items-center gap-3 mb-2">
          <Link href="/wins">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="w-4 h-4 mr-1" />
              Wins Wall
            </Button>
          </Link>
        </div>

        {isLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-12 w-3/4" />
            <Skeleton className="h-6 w-1/2" />
            <Skeleton className="h-48 w-full rounded-xl" />
          </div>
        ) : error || !win ? (
          <Card>
            <CardContent className="p-8 text-center">
              <h2 className="text-xl font-semibold text-foreground">Win not found</h2>
              <p className="text-muted-foreground mt-2">This win may have been removed or doesn't exist.</p>
              <Link href="/wins">
                <Button variant="outline" className="mt-4">Back to Wins Wall</Button>
              </Link>
            </CardContent>
          </Card>
        ) : (
          <>
            <Card>
              <CardContent className="p-6 space-y-5">
                <div className="flex items-start gap-1.5 flex-wrap">
                  {win.status === "featured" && (
                    <Badge variant="outline" className="text-[10px] bg-yellow-50 border-yellow-300 text-yellow-700 gap-1">
                      <Star className="w-3 h-3" /> Featured
                    </Badge>
                  )}
                  {win.proofVerified && (
                    <Badge variant="outline" className="text-[10px] bg-green-50 border-green-300 text-green-700 gap-1">
                      <CheckCircle2 className="w-3 h-3" /> Verified
                    </Badge>
                  )}
                  {win.status === "draft" && (
                    <Badge variant="secondary" className="text-[10px]">Draft</Badge>
                  )}
                </div>

                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-sm shrink-0">
                    {win.author.avatarUrl ? (
                      <img src={win.author.avatarUrl} alt="" className="w-full h-full rounded-full object-cover" />
                    ) : (
                      win.author.name.split(" ").map((n) => n[0]).join("")
                    )}
                  </div>
                  <div>
                    <p className="font-semibold text-foreground">{win.author.name}</p>
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <span>{win.milestone.icon} {win.milestone.name}</span>
                      <span>·</span>
                      <span className="flex items-center gap-1">
                        <Calendar className="w-3.5 h-3.5" />
                        {format(new Date(win.winDate), "MMMM d, yyyy")}
                      </span>
                    </div>
                  </div>
                </div>

                <div>
                  <h1 className="text-2xl font-bold text-foreground mb-3">{win.title}</h1>
                  <p className="text-foreground/90 leading-relaxed whitespace-pre-wrap">{win.description}</p>
                </div>

                {(win.revenueAmount || win.metricLabel) && (
                  <div className="flex flex-wrap gap-3">
                    {win.revenueAmount && (
                      <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-2.5 flex items-center gap-2">
                        <DollarSign className="w-4 h-4 text-green-600" />
                        <div>
                          <p className="text-xs text-green-600 font-medium">Revenue</p>
                          <p className="text-lg font-bold text-green-700">${win.revenueAmount.toLocaleString()}</p>
                        </div>
                      </div>
                    )}
                    {win.metricLabel && win.metricValue && (
                      <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-2.5">
                        <p className="text-xs text-blue-600 font-medium">{win.metricLabel}</p>
                        <p className="text-lg font-bold text-blue-700">{win.metricValue}</p>
                      </div>
                    )}
                  </div>
                )}

                {(win.proofImageUrl || win.proofImage2Url) && (
                  <div className="space-y-3">
                    <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Proof</h3>
                    <div className="grid grid-cols-2 gap-3">
                      {win.proofImageUrl && (
                        <button
                          onClick={() => setExpandedImage(win.proofImageUrl)}
                          className="rounded-lg overflow-hidden border border-border hover:shadow-md transition-shadow"
                        >
                          <img
                            src={win.proofImageUrl}
                            alt="Proof screenshot"
                            className="w-full h-48 object-cover"
                            loading="lazy"
                          />
                        </button>
                      )}
                      {win.proofImage2Url && (
                        <button
                          onClick={() => setExpandedImage(win.proofImage2Url)}
                          className="rounded-lg overflow-hidden border border-border hover:shadow-md transition-shadow"
                        >
                          <img
                            src={win.proofImage2Url}
                            alt="Proof screenshot 2"
                            className="w-full h-48 object-cover"
                            loading="lazy"
                          />
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {win.communityPostId && (
                  <div className="bg-secondary/50 rounded-lg p-3 flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">This win was shared to the community</span>
                    <Link href="/community">
                      <Button variant="ghost" size="sm" className="gap-1 text-primary">
                        View post <ExternalLink className="w-3 h-3" />
                      </Button>
                    </Link>
                  </div>
                )}

                <div className="flex items-center gap-4 pt-3 border-t border-border/30">
                  <button
                    onClick={() => toggleReaction.mutate(win.id)}
                    className={cn(
                      "flex items-center gap-1.5 text-sm font-medium transition-all",
                      win.hasReacted
                        ? "text-orange-500 hover:text-orange-600"
                        : "text-muted-foreground hover:text-orange-500"
                    )}
                  >
                    <Flame className={cn("w-4 h-4", win.hasReacted && "scale-110")} />
                    {win.reactionCount > 0 && <span>{win.reactionCount}</span>}
                    🔥
                  </button>
                  {win.commentCount > 0 && (
                    <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                      <MessageSquare className="w-4 h-4" />
                      {win.commentCount} comments
                    </span>
                  )}
                </div>
              </CardContent>
            </Card>
          </>
        )}

        {expandedImage && (
          <div
            className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4"
            onClick={() => setExpandedImage(null)}
          >
            <button
              onClick={() => setExpandedImage(null)}
              className="absolute top-4 right-4 text-white/80 hover:text-white"
            >
              <X className="w-8 h-8" />
            </button>
            <img
              src={expandedImage}
              alt="Proof screenshot"
              className="max-w-full max-h-full object-contain rounded-lg"
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        )}
      </div>
    </AppLayout>
  );
}
