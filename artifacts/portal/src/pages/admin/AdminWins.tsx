import { useState, useEffect, useMemo } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { format } from "date-fns";
import {
  Trophy,
  Star,
  CheckCircle2,
  EyeOff,
  MessageSquarePlus,
  ThumbsUp,
  ChevronLeft,
  ChevronRight,
  Search,
  Image,
  Shield,
  Clock,
  Send,
} from "lucide-react";
import { adminWinsApi, type AdminWin } from "@/lib/admin-api";
import { useToast } from "@/hooks/use-toast";

type TabFilter = "all" | "needs_review" | "featured" | "testimonial_pipeline";

function getTestimonialStatus(win: AdminWin): string {
  if (win.testimonialApproved) return "approved";
  if (win.testimonialText) return "submitted";
  if (win.testimonialRequested) return "requested";
  return "not_asked";
}

function TestimonialBadge({ win }: { win: AdminWin }) {
  const status = getTestimonialStatus(win);
  switch (status) {
    case "approved":
      return <Badge className="bg-green-100 text-green-800 border-green-200 gap-1"><ThumbsUp className="w-3 h-3" />Approved</Badge>;
    case "submitted":
      return <Badge className="bg-blue-100 text-blue-800 border-blue-200 gap-1"><Clock className="w-3 h-3" />Submitted</Badge>;
    case "requested":
      return <Badge className="bg-yellow-100 text-yellow-800 border-yellow-200 gap-1"><Send className="w-3 h-3" />Requested</Badge>;
    default:
      return <span className="text-xs text-muted-foreground">Not asked</span>;
  }
}

function hasProofImage(win: AdminWin): boolean {
  return !!(win.proofImageUrl || win.proofImage2Url);
}

function safeImageUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url, window.location.origin);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") return url;
    return null;
  } catch {
    return null;
  }
}

function ProofBadge({ verified, hasProof }: { verified: boolean; hasProof: boolean }) {
  if (!hasProof) return <span className="text-xs text-muted-foreground">No proof</span>;
  if (verified) return <Badge className="bg-green-100 text-green-800 border-green-200 gap-1"><CheckCircle2 className="w-3 h-3" />Verified</Badge>;
  return <Badge className="bg-orange-100 text-orange-800 border-orange-200 gap-1"><Image className="w-3 h-3" />Unverified</Badge>;
}

function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case "featured":
      return <Badge className="bg-purple-100 text-purple-800 border-purple-200 gap-1"><Star className="w-3 h-3" />Featured</Badge>;
    case "hidden":
      return <Badge className="bg-red-100 text-red-800 border-red-200 gap-1"><EyeOff className="w-3 h-3" />Hidden</Badge>;
    case "draft":
      return <Badge variant="secondary">Draft</Badge>;
    default:
      return <Badge className="bg-gray-100 text-gray-700 border-gray-200">Published</Badge>;
  }
}

export default function AdminWins() {
  const [activeTab, setActiveTab] = useState<TabFilter>("all");
  const [wins, setWins] = useState<AdminWin[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedWin, setSelectedWin] = useState<AdminWin | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const limit = 20;
  const { toast } = useToast();

  const loadWins = async (p = page) => {
    try {
      setLoading(true);
      const params: { page: number; limit: number; status?: string; testimonial?: string } = { page: p, limit };

      if (activeTab === "needs_review") {
        params.status = "needs_review";
      } else if (activeTab === "featured") {
        params.status = "featured";
      } else if (activeTab === "testimonial_pipeline") {
        params.testimonial = "requested";
      }

      const data = await adminWinsApi.getWins(params);
      setWins(data.wins);
      setTotal(data.pagination.total);
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setPage(1);
    loadWins(1);
  }, [activeTab]);

  useEffect(() => {
    loadWins(page);
  }, [page]);

  const filteredWins = useMemo(() => {
    if (!searchQuery) return wins;
    const q = searchQuery.toLowerCase();
    return wins.filter(
      (w) =>
        w.userName.toLowerCase().includes(q) ||
        w.title.toLowerCase().includes(q) ||
        w.milestoneName.toLowerCase().includes(q)
    );
  }, [wins, searchQuery]);

  const stats = useMemo(() => {
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    return {
      thisWeek: wins.filter((w) => new Date(w.createdAt) >= weekAgo).length,
      pendingReview: wins.filter((w) => w.status === "published" && !w.proofVerified).length,
      featured: wins.filter((w) => w.status === "featured").length,
      approvedTestimonials: wins.filter((w) => w.testimonialApproved).length,
    };
  }, [wins]);

  const handleAction = async (actionName: string, winId: number, action: () => Promise<AdminWin>) => {
    setActionLoading(`${actionName}-${winId}`);
    try {
      const updated = await action();
      if (selectedWin?.id === updated.id) {
        setSelectedWin({ ...selectedWin, ...updated });
      }
      toast({ title: "Success", description: `Win ${actionName} successfully.` });
      await loadWins(page);
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setActionLoading(null);
    }
  };

  const totalPages = Math.ceil(total / limit);

  return (
    <AppLayout>
      <div className="space-y-6">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
              <Trophy className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h1 className="text-3xl font-bold text-foreground">Win Curation</h1>
              <p className="text-muted-foreground">Review, feature, and manage member wins and testimonials</p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-4 gap-4">
          <Card className="p-4">
            <div className="text-2xl font-bold">{stats.thisWeek}</div>
            <div className="text-sm text-muted-foreground">Wins This Week</div>
          </Card>
          <Card className="p-4 border-orange-200 bg-orange-50/50">
            <div className="text-2xl font-bold text-orange-700">{stats.pendingReview}</div>
            <div className="text-sm text-orange-600">Pending Review</div>
          </Card>
          <Card className="p-4 border-purple-200 bg-purple-50/50">
            <div className="text-2xl font-bold text-purple-700">{stats.featured}</div>
            <div className="text-sm text-purple-600">Featured</div>
          </Card>
          <Card className="p-4 border-green-200 bg-green-50/50">
            <div className="text-2xl font-bold text-green-700">{stats.approvedTestimonials}</div>
            <div className="text-sm text-green-600">Approved Testimonials</div>
          </Card>
        </div>

        <Card>
          <div className="p-4 border-b border-border space-y-3">
            <div className="flex items-center justify-between gap-4">
              <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as TabFilter)}>
                <TabsList>
                  <TabsTrigger value="all">All Wins</TabsTrigger>
                  <TabsTrigger value="needs_review">Needs Review</TabsTrigger>
                  <TabsTrigger value="featured">Featured</TabsTrigger>
                  <TabsTrigger value="testimonial_pipeline">Testimonial Pipeline</TabsTrigger>
                </TabsList>
              </Tabs>

              <div className="relative max-w-sm">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Search wins..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 text-sm border rounded-md bg-white"
                />
              </div>
            </div>
          </div>

          <div className="divide-y divide-border">
            <div className="grid grid-cols-[1fr_140px_100px_100px_120px_100px] gap-2 px-4 py-2.5 bg-secondary/30 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              <div>Member / Win</div>
              <div>Milestone</div>
              <div>Revenue</div>
              <div>Proof</div>
              <div>Testimonial</div>
              <div>Date</div>
            </div>

            {loading ? (
              <div className="p-8 text-center text-muted-foreground">Loading wins...</div>
            ) : filteredWins.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground">No wins found.</div>
            ) : (
              filteredWins.map((win) => (
                <div
                  key={win.id}
                  className="grid grid-cols-[1fr_140px_100px_100px_120px_100px] gap-2 px-4 py-3 hover:bg-secondary/20 transition-colors items-center cursor-pointer"
                  onClick={() => setSelectedWin(win)}
                >
                  <div>
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-sm font-medium text-foreground">{win.userName}</span>
                      <StatusBadge status={win.status} />
                    </div>
                    <p className="text-xs text-muted-foreground truncate max-w-md">{win.title}</p>
                  </div>
                  <div className="flex items-center gap-1.5 text-sm">
                    <span>{win.milestoneIcon}</span>
                    <span className="text-xs truncate">{win.milestoneName}</span>
                  </div>
                  <div className="text-sm font-medium">
                    {win.revenueAmount ? `$${Number(win.revenueAmount).toLocaleString()}` : "—"}
                  </div>
                  <div>
                    <ProofBadge verified={win.proofVerified} hasProof={hasProofImage(win)} />
                  </div>
                  <div>
                    <TestimonialBadge win={win} />
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {format(new Date(win.createdAt), "MMM d, yyyy")}
                  </div>
                </div>
              ))
            )}
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between p-4 border-t border-border">
              <div className="text-sm text-muted-foreground">
                Page {page} of {totalPages} ({total} wins)
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  <ChevronLeft className="w-4 h-4 mr-1" /> Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next <ChevronRight className="w-4 h-4 ml-1" />
                </Button>
              </div>
            </div>
          )}
        </Card>
      </div>

      <Dialog open={!!selectedWin} onOpenChange={(open) => !open && setSelectedWin(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          {selectedWin && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <span>{selectedWin.milestoneIcon}</span>
                  {selectedWin.title}
                </DialogTitle>
              </DialogHeader>

              <div className="space-y-6 mt-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">{selectedWin.userName}</p>
                    <p className="text-xs text-muted-foreground">{selectedWin.userEmail}</p>
                  </div>
                  <StatusBadge status={selectedWin.status} />
                </div>

                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-muted-foreground">Milestone:</span>{" "}
                    <span className="font-medium">{selectedWin.milestoneIcon} {selectedWin.milestoneName}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Category:</span>{" "}
                    <span className="font-medium capitalize">{selectedWin.milestoneCategory}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Win Date:</span>{" "}
                    <span className="font-medium">{format(new Date(selectedWin.winDate), "MMMM d, yyyy")}</span>
                  </div>
                  {selectedWin.revenueAmount && (
                    <div>
                      <span className="text-muted-foreground">Revenue:</span>{" "}
                      <span className="font-medium text-green-700">${Number(selectedWin.revenueAmount).toLocaleString()}</span>
                    </div>
                  )}
                  {selectedWin.metricLabel && (
                    <div>
                      <span className="text-muted-foreground">{selectedWin.metricLabel}:</span>{" "}
                      <span className="font-medium">{selectedWin.metricValue}</span>
                    </div>
                  )}
                </div>

                <div>
                  <h4 className="text-sm font-semibold mb-2">Description</h4>
                  <p className="text-sm text-muted-foreground whitespace-pre-wrap bg-secondary/30 rounded-lg p-3">
                    {selectedWin.description}
                  </p>
                </div>

                {hasProofImage(selectedWin) && (
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="text-sm font-semibold">Proof Screenshots</h4>
                      <ProofBadge verified={selectedWin.proofVerified} hasProof={true} />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      {safeImageUrl(selectedWin.proofImageUrl) && (
                        <a href={safeImageUrl(selectedWin.proofImageUrl)!} target="_blank" rel="noopener noreferrer">
                          <img
                            src={safeImageUrl(selectedWin.proofImageUrl)!}
                            alt="Proof screenshot"
                            className="rounded-lg border border-border w-full object-cover max-h-64 hover:opacity-90 transition-opacity"
                          />
                        </a>
                      )}
                      {safeImageUrl(selectedWin.proofImage2Url) && (
                        <a href={safeImageUrl(selectedWin.proofImage2Url)!} target="_blank" rel="noopener noreferrer">
                          <img
                            src={safeImageUrl(selectedWin.proofImage2Url)!}
                            alt="Proof screenshot 2"
                            className="rounded-lg border border-border w-full object-cover max-h-64 hover:opacity-90 transition-opacity"
                          />
                        </a>
                      )}
                    </div>
                  </div>
                )}

                {selectedWin.testimonialText && (
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="text-sm font-semibold">Testimonial</h4>
                      <TestimonialBadge win={selectedWin} />
                    </div>
                    <blockquote className="text-sm italic bg-blue-50 border-l-4 border-blue-400 p-3 rounded-r-lg">
                      "{selectedWin.testimonialText}"
                    </blockquote>
                  </div>
                )}

                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Shield className="w-3 h-3" />
                  <span>
                    {selectedWin.allowTestimonial ? "Consented to testimonial use" : "No testimonial consent"} ·{" "}
                    {selectedWin.allowPublicName ? "Full name OK" : "First name + initial only"}
                  </span>
                </div>

                <div className="border-t border-border pt-4">
                  <h4 className="text-sm font-semibold mb-3">Admin Actions</h4>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant={selectedWin.status === "featured" ? "default" : "outline"}
                      disabled={actionLoading === `feature-${selectedWin.id}` || selectedWin.status === "hidden"}
                      onClick={() =>
                        handleAction("feature", selectedWin.id, () => adminWinsApi.featureWin(selectedWin.id))
                      }
                    >
                      <Star className="w-4 h-4 mr-1" />
                      {selectedWin.status === "featured" ? "Unfeature" : "Feature"}
                    </Button>

                    <Button
                      size="sm"
                      variant={selectedWin.proofVerified ? "default" : "outline"}
                      disabled={actionLoading === `verify-${selectedWin.id}` || !hasProofImage(selectedWin)}
                      onClick={() =>
                        handleAction("verify", selectedWin.id, () => adminWinsApi.verifyWin(selectedWin.id))
                      }
                    >
                      <CheckCircle2 className="w-4 h-4 mr-1" />
                      {selectedWin.proofVerified ? "Unverify" : "Verify Proof"}
                    </Button>

                    {!selectedWin.testimonialRequested && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={actionLoading === `request-testimonial-${selectedWin.id}`}
                        onClick={() =>
                          handleAction("request-testimonial", selectedWin.id, () =>
                            adminWinsApi.requestTestimonial(selectedWin.id)
                          )
                        }
                      >
                        <MessageSquarePlus className="w-4 h-4 mr-1" />
                        Request Testimonial
                      </Button>
                    )}

                    {selectedWin.testimonialText && (
                      <Button
                        size="sm"
                        variant={selectedWin.testimonialApproved ? "default" : "outline"}
                        disabled={actionLoading === `approve-testimonial-${selectedWin.id}`}
                        onClick={() =>
                          handleAction("approve-testimonial", selectedWin.id, () =>
                            adminWinsApi.approveTestimonial(selectedWin.id)
                          )
                        }
                      >
                        <ThumbsUp className="w-4 h-4 mr-1" />
                        {selectedWin.testimonialApproved ? "Unapprove" : "Approve Testimonial"}
                      </Button>
                    )}

                    <Button
                      size="sm"
                      variant="outline"
                      className={selectedWin.status !== "hidden" ? "text-red-600 border-red-200 hover:bg-red-50" : ""}
                      disabled={actionLoading === `hide-${selectedWin.id}`}
                      onClick={() =>
                        handleAction("hide", selectedWin.id, () => adminWinsApi.hideWin(selectedWin.id))
                      }
                    >
                      <EyeOff className="w-4 h-4 mr-1" />
                      {selectedWin.status === "hidden" ? "Unhide" : "Hide Win"}
                    </Button>
                  </div>
                </div>
              </div>

              <DialogFooter className="mt-4">
                <Button variant="ghost" onClick={() => setSelectedWin(null)}>
                  Close
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
