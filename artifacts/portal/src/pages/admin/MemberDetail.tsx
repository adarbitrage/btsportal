import { useState, useEffect, useMemo, useRef } from "react";
import { useParams, Link, useSearch } from "wouter";
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
import { User, Package, Ticket, BookOpen, Video, DollarSign, Users, MessageSquare, StickyNote, ScrollText, ShieldCheck, ArrowLeft, Plus, X, Mail, KeyRound, Loader2, Lock, LockOpen, ExternalLink, Phone } from "lucide-react";
import { adminPanelApi } from "@/lib/admin-panel-api";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import {
  FlexyRegeneratePanel,
  FlexyStatusSummary,
  fetchFlexyLookup,
  type FlexyLookup,
} from "@/components/admin/FlexyRegeneratePanel";
import { useAuth } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";

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
  const searchString = useSearch();
  const highlightOldEmail = useMemo(() => {
    const value = new URLSearchParams(searchString).get("highlightOldEmail");
    return value ? value.trim().toLowerCase() : null;
  }, [searchString]);
  const highlightOldPhone = useMemo(() => {
    const value = new URLSearchParams(searchString).get("highlightOldPhone");
    return value ? value.trim() : null;
  }, [searchString]);
  const highlightedRowRef = useRef<HTMLDivElement | null>(null);
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [noteContent, setNoteContent] = useState("");
  const [submittingNote, setSubmittingNote] = useState(false);
  const [flexyLookup, setFlexyLookup] = useState<FlexyLookup | null>(null);
  const [flexyLookupLoading, setFlexyLookupLoading] = useState(false);
  const [flexyLookupError, setFlexyLookupError] = useState<string | null>(null);
  const { toast } = useToast();

  const [grantOpen, setGrantOpen] = useState(false);
  const [allProducts, setAllProducts] = useState<ProductRow[]>([]);
  const [grantProductId, setGrantProductId] = useState<string>("");
  const [grantExpiresAt, setGrantExpiresAt] = useState<string>("");
  const [grantSubmitting, setGrantSubmitting] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  const [unlockConfirmOpen, setUnlockConfirmOpen] = useState(false);

  // Email-change attempts are paged so support can reach attempts older than
  // the most recent page. Ordinary audit rows live for ~90 days, but
  // admin-cancelled rows live for ~1 year so older cancelled rows can still
  // be paged in for stale-ticket investigations. The first page comes in on
  // `/full`; "Show older" calls the dedicated paginated endpoint.
  type EmailAttemptRow = {
    id: number;
    newEmail: string | null;
    requestedAt: string;
    expiresAt: string | null;
    confirmedAt: string | null;
    cancelledAt: string | null;
    cancelledByAdminId: number | null;
    cancelledByAdminName: string | null;
    cancelledByAdminEmail: string | null;
    status: "pending" | "confirmed" | "expired" | "abandoned" | "cancelled_by_admin";
  };
  const [emailAttempts, setEmailAttempts] = useState<EmailAttemptRow[]>([]);
  const [emailAttemptsTotal, setEmailAttemptsTotal] = useState<number>(0);
  const [emailAttemptsPageSize, setEmailAttemptsPageSize] = useState<number>(50);
  const [emailAttemptsLoadingMore, setEmailAttemptsLoadingMore] = useState(false);

  const { user: currentUser } = useAuth();
  const canEditMembers = hasPermission(currentUser?.role, "members:edit");

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
      const initialAttempts: EmailAttemptRow[] = Array.isArray(result?.emailAttempts)
        ? result.emailAttempts
        : [];
      setEmailAttempts(initialAttempts);
      const total = typeof result?.emailAttemptsTotal === "number"
        ? result.emailAttemptsTotal
        : initialAttempts.length;
      setEmailAttemptsTotal(total);
      if (typeof result?.emailAttemptsPageSize === "number" && result.emailAttemptsPageSize > 0) {
        setEmailAttemptsPageSize(result.emailAttemptsPageSize);
      }
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const handleLoadOlderEmailAttempts = async () => {
    if (emailAttemptsLoadingMore) return;
    setEmailAttemptsLoadingMore(true);
    try {
      const offset = emailAttempts.length;
      const result = await adminPanelApi.getMemberEmailAttempts(memberId, {
        offset,
        limit: emailAttemptsPageSize,
      });
      // Dedupe by id in case the underlying list shifted between calls (e.g.
      // a new attempt was inserted between the initial /full and this paged
      // request).
      const existingIds = new Set(emailAttempts.map((a) => a.id));
      const newer = result.attempts.filter((a) => !existingIds.has(a.id));
      setEmailAttempts((prev) => [...prev, ...newer]);
      setEmailAttemptsTotal(result.total);
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setEmailAttemptsLoadingMore(false);
    }
  };

  useEffect(() => { if (memberId) load(); }, [memberId]);

  useEffect(() => {
    if (!memberId) return;
    let cancelled = false;
    setFlexyLookup(null);
    setFlexyLookupError(null);
    setFlexyLookupLoading(true);
    fetchFlexyLookup(memberId)
      .then((result) => {
        if (!cancelled) setFlexyLookup(result);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setFlexyLookupError(err instanceof Error ? err.message : "Lookup failed");
        }
      })
      .finally(() => {
        if (!cancelled) setFlexyLookupLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [memberId]);

  useEffect(() => {
    if (!data) return;
    if (!highlightOldEmail && !highlightOldPhone) return;
    if (highlightedRowRef.current) {
      highlightedRowRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [highlightOldEmail, highlightOldPhone, data]);

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

  const handleUnlockAccount = async () => {
    try {
      setUnlocking(true);
      await adminPanelApi.unlockMember(memberId);
      toast({ title: "Account unlocked" });
      setUnlockConfirmOpen(false);
      load();
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setUnlocking(false);
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

  const [cancellingEmailChange, setCancellingEmailChange] = useState(false);
  const handleCancelEmailChange = async () => {
    if (cancellingEmailChange) return;
    setCancellingEmailChange(true);
    try {
      await adminPanelApi.cancelMemberEmailChange(memberId);
      toast({ title: "Pending email change cancelled" });
      load();
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setCancellingEmailChange(false);
    }
  };

  if (loading) {
    return <AdminLayout><div className="p-8 text-center text-muted-foreground">Loading member details...</div></AdminLayout>;
  }

  if (!data) {
    return <AdminLayout><div className="p-8 text-center text-muted-foreground">Member not found</div></AdminLayout>;
  }

  const { member, products, tickets, trainingProgress, coachingSessions, commissions, community, adminNotes, auditHistory, emailHistory = [], phoneHistory = [] } = data;
  const unconfirmedAttempts = emailAttempts.filter((a) => a.status !== "confirmed");
  const hasMoreAttempts = emailAttempts.length < emailAttemptsTotal;

  const lockedUntilDate: Date | null = member.lockedUntil ? new Date(member.lockedUntil) : null;
  const isLocked = !!(lockedUntilDate && lockedUntilDate.getTime() > Date.now());
  const failedLoginCount: number = Number(member.failedLoginCount) || 0;
  const showLockCard = isLocked || failedLoginCount > 0;

  const attemptStatusBadge = (status: string) => {
    switch (status) {
      case "pending":
        return <Badge variant="default" data-testid={`badge-attempt-status-${status}`}>Pending</Badge>;
      case "expired":
        return <Badge variant="secondary" data-testid={`badge-attempt-status-${status}`}>Expired</Badge>;
      case "abandoned":
        return <Badge variant="outline" data-testid={`badge-attempt-status-${status}`}>Abandoned</Badge>;
      case "cancelled_by_admin":
        return <Badge variant="outline" className="bg-red-100 text-red-800 border-transparent" data-testid={`badge-attempt-status-${status}`}>Cancelled by admin</Badge>;
      default:
        return <Badge variant="outline" data-testid={`badge-attempt-status-${status}`}>{status}</Badge>;
    }
  };

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
            {member.phone ? (
              <p className="text-muted-foreground" data-testid="text-member-phone">{member.phone}</p>
            ) : null}
          </div>
          <Badge variant="outline" className="ml-auto">{member.role}</Badge>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card><CardContent className="p-4 text-center"><p className="text-2xl font-bold">{products.length}</p><p className="text-xs text-muted-foreground">Products</p></CardContent></Card>
          <Card><CardContent className="p-4 text-center"><p className="text-2xl font-bold">{trainingProgress.completedLessons}</p><p className="text-xs text-muted-foreground">Lessons Completed</p></CardContent></Card>
          <Card><CardContent className="p-4 text-center"><p className="text-2xl font-bold">{tickets.length}</p><p className="text-xs text-muted-foreground">Tickets</p></CardContent></Card>
          <Card><CardContent className="p-4 text-center"><p className="text-2xl font-bold">{community.posts + community.comments}</p><p className="text-xs text-muted-foreground">Community Activity</p></CardContent></Card>
        </div>

        {showLockCard && (
          <Card data-testid="card-account-lock">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                {isLocked ? <Lock className="w-4 h-4" /> : <LockOpen className="w-4 h-4" />}
                Account lock state
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="space-y-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    {isLocked ? (
                      <Badge variant="locked" data-testid="badge-lock-status">Locked</Badge>
                    ) : (
                      <Badge variant="secondary" data-testid="badge-lock-status">Not locked</Badge>
                    )}
                    <span className="text-sm text-muted-foreground" data-testid="text-failed-login-count">
                      {failedLoginCount} failed login attempt{failedLoginCount === 1 ? "" : "s"}
                    </span>
                  </div>
                  {isLocked && lockedUntilDate && (
                    <p className="text-xs text-muted-foreground" data-testid="text-locked-until">
                      Locked until {format(lockedUntilDate, "MMM d, yyyy 'at' h:mm a")}
                    </p>
                  )}
                  {!isLocked && failedLoginCount > 0 && (
                    <p className="text-xs text-muted-foreground">
                      Account is not currently locked, but failed login attempts have not been cleared.
                    </p>
                  )}
                </div>
                {canEditMembers && (
                  <Dialog open={unlockConfirmOpen} onOpenChange={setUnlockConfirmOpen}>
                    <DialogTrigger asChild>
                      <Button
                        size="sm"
                        disabled={unlocking}
                        data-testid="button-unlock-account"
                      >
                        <LockOpen className="w-3 h-3 mr-1" />
                        {unlocking ? "Unlocking..." : "Unlock account"}
                      </Button>
                    </DialogTrigger>
                    <DialogContent data-testid="dialog-confirm-unlock">
                      <DialogHeader>
                        <DialogTitle>Unlock account?</DialogTitle>
                        <DialogDescription>
                          Unlock <span className="font-medium">{member.name}</span>
                          {member.email ? (
                            <>
                              {" "}(<span className="font-mono">{member.email}</span>)
                            </>
                          ) : null}
                          ? Clears the lockout and resets failed login count to 0,
                          allowing them to retry login immediately.
                        </DialogDescription>
                      </DialogHeader>
                      <DialogFooter>
                        <Button
                          variant="outline"
                          onClick={() => setUnlockConfirmOpen(false)}
                          disabled={unlocking}
                          data-testid="button-cancel-unlock"
                        >
                          Cancel
                        </Button>
                        <Button
                          onClick={handleUnlockAccount}
                          disabled={unlocking}
                          data-testid="button-confirm-unlock"
                        >
                          <LockOpen className="w-3 h-3 mr-1" />
                          {unlocking ? "Unlocking..." : "Unlock account"}
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {emailHistory.length > 0 && (
          <Card data-testid="card-email-history">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Mail className="w-4 h-4" /> Email history
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {emailHistory.map((entry: any) => {
                  const isHighlighted =
                    !!highlightOldEmail &&
                    typeof entry.oldEmail === "string" &&
                    entry.oldEmail.trim().toLowerCase() === highlightOldEmail;
                  return (
                    <div
                      key={entry.id}
                      ref={isHighlighted ? highlightedRowRef : undefined}
                      className={
                        "flex items-center justify-between p-2 rounded-md text-sm " +
                        (isHighlighted
                          ? "bg-amber-100 ring-2 ring-amber-400"
                          : "bg-muted/50")
                      }
                      data-testid={`row-email-history-${entry.id}`}
                      data-highlighted={isHighlighted ? "true" : "false"}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono break-all" data-testid={`text-old-email-${entry.id}`}>{entry.oldEmail}</span>
                          {isHighlighted && (
                            <Badge variant="default" className="bg-amber-500 hover:bg-amber-500 text-[10px]" data-testid={`badge-matched-old-email-${entry.id}`}>
                              Matched search
                            </Badge>
                          )}
                          <span className="text-muted-foreground">→</span>
                          <span className="font-mono break-all" data-testid={`text-new-email-${entry.id}`}>{entry.newEmail}</span>
                        </div>
                      </div>
                      <span className="text-xs text-muted-foreground shrink-0 ml-3">
                        {entry.changedAt ? format(new Date(entry.changedAt), "MMM d, yyyy") : ""}
                      </span>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}

        {phoneHistory.length > 0 && (
          <Card data-testid="card-phone-history">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Phone className="w-4 h-4" /> Phone history
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {phoneHistory.map((entry: any) => {
                  const isHighlighted =
                    !!highlightOldPhone &&
                    typeof entry.oldPhone === "string" &&
                    entry.oldPhone.trim() === highlightOldPhone;
                  return (
                    <div
                      key={entry.id}
                      ref={isHighlighted ? highlightedRowRef : undefined}
                      className={
                        "flex items-center justify-between p-2 rounded-md text-sm " +
                        (isHighlighted
                          ? "bg-amber-100 ring-2 ring-amber-400"
                          : "bg-muted/50")
                      }
                      data-testid={`row-phone-history-${entry.id}`}
                      data-highlighted={isHighlighted ? "true" : "false"}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono break-all" data-testid={`text-old-phone-${entry.id}`}>{entry.oldPhone}</span>
                          {isHighlighted && (
                            <Badge variant="default" className="bg-amber-500 hover:bg-amber-500 text-[10px]" data-testid={`badge-matched-old-phone-${entry.id}`}>
                              Matched search
                            </Badge>
                          )}
                          <span className="text-muted-foreground">→</span>
                          <span className="font-mono break-all" data-testid={`text-new-phone-${entry.id}`}>
                            {entry.newPhone || <span className="text-muted-foreground italic">(removed)</span>}
                          </span>
                        </div>
                      </div>
                      <span className="text-xs text-muted-foreground shrink-0 ml-3">
                        {entry.changedAt ? format(new Date(entry.changedAt), "MMM d, yyyy") : ""}
                      </span>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}

        {(unconfirmedAttempts.length > 0 || hasMoreAttempts) && (
          <Card data-testid="card-email-attempts">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Mail className="w-4 h-4" /> Email change attempts
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                Pending or unconfirmed change requests that never resulted in a completed switch.
              </p>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {unconfirmedAttempts.length === 0 && (
                  <p
                    className="text-xs text-muted-foreground"
                    data-testid="text-email-attempts-empty"
                  >
                    No unconfirmed attempts in the most recent {emailAttempts.length}.
                    {hasMoreAttempts ? " There may be older ones below." : ""}
                  </p>
                )}
                {unconfirmedAttempts.map((entry: any) => {
                  const cancelledByLabel =
                    entry.cancelledByAdminName ||
                    entry.cancelledByAdminEmail ||
                    (entry.cancelledByAdminId
                      ? `admin #${entry.cancelledByAdminId}`
                      : "an admin");
                  return (
                    <div
                      key={entry.id}
                      className="flex items-center justify-between gap-3 p-2 rounded-md bg-muted/50 text-sm"
                      data-testid={`row-email-attempt-${entry.id}`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-mono break-all" data-testid={`text-attempt-email-${entry.id}`}>
                            {entry.newEmail}
                          </span>
                          {attemptStatusBadge(entry.status)}
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          Requested {entry.requestedAt ? format(new Date(entry.requestedAt), "MMM d, yyyy 'at' h:mm a") : ""}
                          {entry.expiresAt
                            ? ` · ${
                                entry.status === "pending"
                                  ? "expires"
                                  : entry.status === "expired"
                                  ? "expired"
                                  : "would have expired"
                              } ${format(new Date(entry.expiresAt), "MMM d, yyyy 'at' h:mm a")}`
                            : ""}
                        </div>
                        {entry.status === "cancelled_by_admin" && entry.cancelledAt && (
                          <div
                            className="text-xs text-muted-foreground mt-0.5"
                            data-testid={`text-attempt-cancelled-by-${entry.id}`}
                          >
                            Cancelled by {cancelledByLabel} on {format(new Date(entry.cancelledAt), "MMM d, yyyy 'at' h:mm a")}
                          </div>
                        )}
                      </div>
                      {entry.status === "pending" && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="shrink-0"
                          onClick={handleCancelEmailChange}
                          disabled={cancellingEmailChange}
                          data-testid={`button-cancel-email-attempt-${entry.id}`}
                        >
                          <X className="w-3 h-3 mr-1" />
                          {cancellingEmailChange ? "Cancelling..." : "Cancel pending change"}
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>
              {(hasMoreAttempts || emailAttemptsTotal > 0) && (
                <div className="mt-3 flex items-center justify-between gap-3 flex-wrap">
                  <p
                    className="text-xs text-muted-foreground"
                    data-testid="text-email-attempts-pagination"
                  >
                    Showing {emailAttempts.length} of {emailAttemptsTotal}
                    {emailAttemptsTotal === 1 ? " attempt" : " attempts"}
                  </p>
                  {hasMoreAttempts && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleLoadOlderEmailAttempts}
                      disabled={emailAttemptsLoadingMore}
                      data-testid="button-load-older-email-attempts"
                    >
                      {emailAttemptsLoadingMore ? (
                        <>
                          <Loader2 className="w-3 h-3 mr-1 animate-spin" /> Loading...
                        </>
                      ) : (
                        "Show older attempts"
                      )}
                    </Button>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {flexyLookupError ? null : (
          <Card data-testid="card-flexy-summary">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <KeyRound className="w-4 h-4" /> Flexy
              </CardTitle>
            </CardHeader>
            <CardContent>
              {flexyLookupLoading && !flexyLookup ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="w-4 h-4 animate-spin" /> Looking up Flexy details...
                </div>
              ) : flexyLookup ? (
                <div className="space-y-2">
                  <FlexyStatusSummary lookup={flexyLookup} testIdPrefix="member-flexy" />
                  <p className="text-xs text-muted-foreground">
                    Open the Password Resets tab to regenerate the password or view reset history.
                  </p>
                </div>
              ) : null}
            </CardContent>
          </Card>
        )}

        <Tabs defaultValue="products">
          <TabsList className="grid w-full grid-cols-9 gap-1">
            <TabsTrigger value="products" className="text-xs"><Package className="w-3 h-3 mr-1" />Products</TabsTrigger>
            <TabsTrigger value="training" className="text-xs"><BookOpen className="w-3 h-3 mr-1" />Training</TabsTrigger>
            <TabsTrigger value="tickets" className="text-xs"><Ticket className="w-3 h-3 mr-1" />Tickets</TabsTrigger>
            <TabsTrigger value="coaching" className="text-xs"><Video className="w-3 h-3 mr-1" />Coaching</TabsTrigger>
            <TabsTrigger value="commissions" className="text-xs"><DollarSign className="w-3 h-3 mr-1" />Commissions</TabsTrigger>
            <TabsTrigger value="community" className="text-xs"><Users className="w-3 h-3 mr-1" />Community</TabsTrigger>
            <TabsTrigger value="notes" className="text-xs"><StickyNote className="w-3 h-3 mr-1" />Notes</TabsTrigger>
            <TabsTrigger value="password-resets" className="text-xs" data-testid="tab-password-resets"><KeyRound className="w-3 h-3 mr-1" />Password Resets</TabsTrigger>
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

          <TabsContent value="password-resets">
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <KeyRound className="w-4 h-4" /> Flexy Password Resets
                </CardTitle>
              </CardHeader>
              <CardContent>
                <FlexyRegeneratePanel
                  userId={memberId}
                  initialLookup={flexyLookup}
                  historyContainerTestId="member-flexy-reset-history"
                  historyItemTestIdPrefix="member-flexy-history"
                  historyHeaderLabel="All password reset events for this member"
                  showHistoryActorFilter={true}
                />
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
                      <Link
                        key={log.id}
                        href={`/admin/audit-log?entityType=user&expand=${log.id}`}
                        data-testid={`link-audit-${log.id}`}
                      >
                        <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50 hover:bg-muted transition-colors cursor-pointer">
                          <div className="w-2 h-2 rounded-full bg-primary shrink-0" />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm">{log.description}</p>
                            <div className="flex items-center gap-2 mt-0.5">
                              <Badge variant="outline" className="text-[10px]">{log.actionType}</Badge>
                              <span className="text-[10px] text-muted-foreground">{log.createdAt ? format(new Date(log.createdAt), "MMM d, h:mm a") : ""}</span>
                            </div>
                          </div>
                          <ExternalLink className="w-3 h-3 text-muted-foreground shrink-0" />
                        </div>
                      </Link>
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
