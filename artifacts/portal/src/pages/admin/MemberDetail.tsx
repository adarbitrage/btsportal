import { useState, useEffect } from "react";
import { useParams, Link } from "wouter";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { User, Package, Ticket, BookOpen, Video, DollarSign, Users, MessageSquare, StickyNote, ScrollText, ShieldCheck, ArrowLeft, Plus, X, Mail } from "lucide-react";
import { adminPanelApi } from "@/lib/admin-panel-api";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";

interface ProductRow {
  id: number;
  slug: string;
  name: string;
  type: string;
  durationDays: number | null;
  priceDisplay: string | null;
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function toDateInputValue(d: Date | null): string {
  if (!d) return "";
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export default function MemberDetail() {
  const params = useParams<{ id: string }>();
  const memberId = parseInt(params.id || "0", 10);
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [noteContent, setNoteContent] = useState("");
  const [submittingNote, setSubmittingNote] = useState(false);
  const { toast } = useToast();

  const [grantOpen, setGrantOpen] = useState(false);
  const [allProducts, setAllProducts] = useState<ProductRow[]>([]);
  const [grantProductId, setGrantProductId] = useState<string>("");
  const [grantExpiresAt, setGrantExpiresAt] = useState<string>("");
  const [grantSubmitting, setGrantSubmitting] = useState(false);

  const openGrantDialog = async () => {
    setGrantProductId("");
    setGrantExpiresAt("");
    setGrantOpen(true);
    if (allProducts.length === 0) {
      try {
        const rows: ProductRow[] = await adminPanelApi.listProducts();
        setAllProducts(rows);
      } catch (err: any) {
        toast({ title: "Failed to load products", description: err.message, variant: "destructive" });
      }
    }
  };

  const onSelectProduct = (idStr: string) => {
    setGrantProductId(idStr);
    const product = allProducts.find((p) => String(p.id) === idStr);
    if (product?.durationDays && product.durationDays > 0) {
      setGrantExpiresAt(toDateInputValue(addDays(new Date(), product.durationDays)));
    } else {
      setGrantExpiresAt("");
    }
  };

  const handleGrantProduct = async () => {
    if (!grantProductId) return;
    setGrantSubmitting(true);
    try {
      const expiresAt = grantExpiresAt ? new Date(grantExpiresAt).toISOString() : undefined;
      await adminPanelApi.grantProduct(memberId, parseInt(grantProductId, 10), expiresAt);
      toast({ title: "Product granted" });
      setGrantOpen(false);
      load();
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setGrantSubmitting(false);
    }
  };

  const load = async () => {
    try {
      setLoading(true);
      const result = await adminPanelApi.getMemberFull(memberId);
      setData(result);
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (memberId) load(); }, [memberId]);

  const handleAddNote = async () => {
    if (!noteContent.trim()) return;
    try {
      setSubmittingNote(true);
      await adminPanelApi.addMemberNote(memberId, noteContent);
      setNoteContent("");
      toast({ title: "Note added" });
      load();
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setSubmittingNote(false);
    }
  };

  const handleRevokeProduct = async (userProductId: number) => {
    try {
      await adminPanelApi.revokeProduct(memberId, userProductId);
      toast({ title: "Product revoked" });
      load();
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  };

  if (loading) {
    return <AdminLayout><div className="p-8 text-center text-muted-foreground">Loading member details...</div></AdminLayout>;
  }

  if (!data) {
    return <AdminLayout><div className="p-8 text-center text-muted-foreground">Member not found</div></AdminLayout>;
  }

  const { member, products, tickets, trainingProgress, coachingSessions, commissions, community, adminNotes, auditHistory, emailHistory = [] } = data;

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Link href="/admin/members">
            <Button variant="ghost" size="sm"><ArrowLeft className="w-4 h-4 mr-1" />Back</Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <User className="w-6 h-6" /> {member.name}
            </h1>
            <p className="text-muted-foreground">{member.email}</p>
          </div>
          <Badge variant="outline" className="ml-auto">{member.role}</Badge>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card><CardContent className="p-4 text-center"><p className="text-2xl font-bold">{products.length}</p><p className="text-xs text-muted-foreground">Products</p></CardContent></Card>
          <Card><CardContent className="p-4 text-center"><p className="text-2xl font-bold">{trainingProgress.completedLessons}</p><p className="text-xs text-muted-foreground">Lessons Completed</p></CardContent></Card>
          <Card><CardContent className="p-4 text-center"><p className="text-2xl font-bold">{tickets.length}</p><p className="text-xs text-muted-foreground">Tickets</p></CardContent></Card>
          <Card><CardContent className="p-4 text-center"><p className="text-2xl font-bold">{community.posts + community.comments}</p><p className="text-xs text-muted-foreground">Community Activity</p></CardContent></Card>
        </div>

        {emailHistory.length > 0 && (
          <Card data-testid="card-email-history">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Mail className="w-4 h-4" /> Email history
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {emailHistory.map((entry: any) => (
                  <div
                    key={entry.id}
                    className="flex items-center justify-between p-2 rounded-md bg-muted/50 text-sm"
                    data-testid={`row-email-history-${entry.id}`}
                  >
                    <div className="min-w-0 flex-1">
                      <span className="font-mono break-all" data-testid={`text-old-email-${entry.id}`}>{entry.oldEmail}</span>
                      <span className="mx-2 text-muted-foreground">→</span>
                      <span className="font-mono break-all" data-testid={`text-new-email-${entry.id}`}>{entry.newEmail}</span>
                    </div>
                    <span className="text-xs text-muted-foreground shrink-0 ml-3">
                      {entry.changedAt ? format(new Date(entry.changedAt), "MMM d, yyyy") : ""}
                    </span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        <Tabs defaultValue="products">
          <TabsList className="grid w-full grid-cols-8 gap-1">
            <TabsTrigger value="products" className="text-xs"><Package className="w-3 h-3 mr-1" />Products</TabsTrigger>
            <TabsTrigger value="training" className="text-xs"><BookOpen className="w-3 h-3 mr-1" />Training</TabsTrigger>
            <TabsTrigger value="tickets" className="text-xs"><Ticket className="w-3 h-3 mr-1" />Tickets</TabsTrigger>
            <TabsTrigger value="coaching" className="text-xs"><Video className="w-3 h-3 mr-1" />Coaching</TabsTrigger>
            <TabsTrigger value="commissions" className="text-xs"><DollarSign className="w-3 h-3 mr-1" />Commissions</TabsTrigger>
            <TabsTrigger value="community" className="text-xs"><Users className="w-3 h-3 mr-1" />Community</TabsTrigger>
            <TabsTrigger value="notes" className="text-xs"><StickyNote className="w-3 h-3 mr-1" />Notes</TabsTrigger>
            <TabsTrigger value="audit" className="text-xs"><ScrollText className="w-3 h-3 mr-1" />Audit</TabsTrigger>
          </TabsList>

          <TabsContent value="products">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
                <CardTitle className="text-base">Products & Entitlements</CardTitle>
                <Dialog open={grantOpen} onOpenChange={setGrantOpen}>
                  <DialogTrigger asChild>
                    <Button size="sm" onClick={openGrantDialog}>
                      <Plus className="w-3 h-3 mr-1" />Grant Product
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Grant product to {member.name}</DialogTitle>
                      <DialogDescription>
                        Assign a membership tier or front-end product. Expiration auto-fills from the product's duration but can be cleared for no expiry.
                      </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-2">
                      <div className="space-y-1.5">
                        <Label htmlFor="grant-product">Product</Label>
                        <Select value={grantProductId} onValueChange={onSelectProduct}>
                          <SelectTrigger id="grant-product">
                            <SelectValue placeholder={allProducts.length ? "Choose a product..." : "Loading products..."} />
                          </SelectTrigger>
                          <SelectContent>
                            {allProducts.map((p) => (
                              <SelectItem key={p.id} value={String(p.id)}>
                                {p.name}
                                {p.durationDays ? ` · ${p.durationDays} days` : p.type === "backend" ? " · no expiry" : ""}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="grant-expires">Expires on (optional)</Label>
                        <Input
                          id="grant-expires"
                          type="date"
                          value={grantExpiresAt}
                          onChange={(e) => setGrantExpiresAt(e.target.value)}
                        />
                        <p className="text-xs text-muted-foreground">
                          Leave blank for no expiration (lifetime / front-end / LaunchPad).
                        </p>
                      </div>
                    </div>
                    <DialogFooter>
                      <Button variant="outline" onClick={() => setGrantOpen(false)} disabled={grantSubmitting}>
                        Cancel
                      </Button>
                      <Button onClick={handleGrantProduct} disabled={!grantProductId || grantSubmitting}>
                        {grantSubmitting ? "Granting..." : "Grant Product"}
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </CardHeader>
              <CardContent>
                {products.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No products assigned. Use "Grant Product" above to assign a tier.</p>
                ) : (
                  <div className="space-y-3">
                    {products.map((p: any) => (
                      <div key={p.id} className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                        <div>
                          <p className="font-medium text-sm">{p.productName}</p>
                          <div className="flex items-center gap-2 mt-1">
                            <Badge variant={p.status === "active" ? "default" : "secondary"}>{p.status}</Badge>
                            {p.expiresAt && <span className="text-xs text-muted-foreground">Expires: {format(new Date(p.expiresAt), "MMM d, yyyy")}</span>}
                          </div>
                        </div>
                        {p.status === "active" && (
                          <Button variant="destructive" size="sm" onClick={() => handleRevokeProduct(p.id)}>
                            <X className="w-3 h-3 mr-1" />Revoke
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="training">
            <Card>
              <CardHeader><CardTitle className="text-base">Training Progress</CardTitle></CardHeader>
              <CardContent>
                <p className="text-sm"><strong>{trainingProgress.completedLessons}</strong> lessons completed</p>
                <p className="text-sm text-muted-foreground mt-1">Current streak: {member.currentStreak} days</p>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="tickets">
            <Card>
              <CardHeader><CardTitle className="text-base">Support Tickets</CardTitle></CardHeader>
              <CardContent>
                {tickets.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No tickets</p>
                ) : (
                  <div className="space-y-2">
                    {tickets.map((t: any) => (
                      <Link key={t.id} href={`/admin/tickets/${t.id}`}>
                        <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50 hover:bg-muted transition-colors cursor-pointer">
                          <div>
                            <p className="text-sm font-medium">{t.subject}</p>
                            <span className="text-xs text-muted-foreground">#{t.ticketNumber}</span>
                          </div>
                          <Badge variant={t.status === "open" ? "default" : "secondary"}>{t.status}</Badge>
                        </div>
                      </Link>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="coaching">
            <Card>
              <CardHeader><CardTitle className="text-base">Coaching Sessions</CardTitle></CardHeader>
              <CardContent>
                {coachingSessions.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No coaching sessions</p>
                ) : (
                  <div className="space-y-2">
                    {coachingSessions.map((s: any) => (
                      <div key={s.id} className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                        <div>
                          <p className="text-sm font-medium">Session with Coach #{s.coachId}</p>
                          <span className="text-xs text-muted-foreground">{s.scheduledAt ? format(new Date(s.scheduledAt), "MMM d, yyyy") : ""}</span>
                        </div>
                        <Badge variant={s.status === "completed" ? "default" : "secondary"}>{s.status}</Badge>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="commissions">
            <Card>
              <CardHeader><CardTitle className="text-base">Commissions</CardTitle></CardHeader>
              <CardContent>
                {commissions.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No commissions</p>
                ) : (
                  <div className="space-y-2">
                    {commissions.map((c: any) => (
                      <div key={c.id} className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                        <div>
                          <p className="text-sm font-medium">${(Number(c.amount) || 0).toFixed(2)}</p>
                          <span className="text-xs text-muted-foreground">{c.createdAt ? format(new Date(c.createdAt), "MMM d, yyyy") : ""}</span>
                        </div>
                        <Badge variant={c.status === "paid" ? "default" : "secondary"}>{c.status}</Badge>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="community">
            <Card>
              <CardHeader><CardTitle className="text-base">Community Activity</CardTitle></CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-4 bg-muted/50 rounded-lg text-center">
                    <p className="text-2xl font-bold">{community.posts}</p>
                    <p className="text-xs text-muted-foreground">Posts</p>
                  </div>
                  <div className="p-4 bg-muted/50 rounded-lg text-center">
                    <p className="text-2xl font-bold">{community.comments}</p>
                    <p className="text-xs text-muted-foreground">Comments</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="notes">
            <Card>
              <CardHeader><CardTitle className="text-base">Admin Notes</CardTitle></CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="flex gap-2">
                    <Textarea value={noteContent} onChange={(e) => setNoteContent(e.target.value)} placeholder="Add a note about this member..." className="min-h-[80px]" />
                    <Button onClick={handleAddNote} disabled={submittingNote || !noteContent.trim()} className="shrink-0">
                      <Plus className="w-4 h-4 mr-1" />Add
                    </Button>
                  </div>
                  {adminNotes.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No admin notes</p>
                  ) : (
                    <div className="space-y-3">
                      {adminNotes.map((n: any) => (
                        <div key={n.id} className="p-3 rounded-lg bg-muted/50">
                          <p className="text-sm">{n.content}</p>
                          <p className="text-xs text-muted-foreground mt-1">
                            {n.createdAt ? format(new Date(n.createdAt), "MMM d, yyyy h:mm a") : ""}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="audit">
            <Card>
              <CardHeader><CardTitle className="text-base">Audit History</CardTitle></CardHeader>
              <CardContent>
                {auditHistory.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No audit history for this member</p>
                ) : (
                  <div className="space-y-2">
                    {auditHistory.map((log: any) => (
                      <div key={log.id} className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
                        <div className="w-2 h-2 rounded-full bg-primary shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm">{log.description}</p>
                          <div className="flex items-center gap-2 mt-0.5">
                            <Badge variant="outline" className="text-[10px]">{log.actionType}</Badge>
                            <span className="text-[10px] text-muted-foreground">{log.createdAt ? format(new Date(log.createdAt), "MMM d, h:mm a") : ""}</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </AdminLayout>
  );
}
