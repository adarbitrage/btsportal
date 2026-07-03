import { useState, useEffect, useMemo, useRef } from "react";
import { useParams, Link, useSearch, useLocation } from "wouter";
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
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { User, Package, BookOpen, Video, DollarSign, Users, MessageSquare, StickyNote, ScrollText, ShieldCheck, ArrowLeft, Plus, X, Mail, KeyRound, Loader2, Lock, LockOpen, ExternalLink, Phone, Monitor, LogIn } from "lucide-react";
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
import { ADMIN_ROLES, ROLE_INFO, getRoleLabel, hasPermission } from "@/lib/permissions";
import { formatDeviceLabel } from "@/lib/device-label";

// Render an impersonation session length (milliseconds) as a compact, human
// "1h 4m 12s" / "4m 12s" / "12s" string. Mirrors the helper on the Audit Log
// page. Returns null for missing/negative values so callers can fall back to
// an "ongoing / unknown" badge.
function formatImpersonationDuration(ms: number | null | undefined): string | null {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) return null;
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds === 0) return "under 1s";
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (seconds > 0 || parts.length === 0) parts.push(`${seconds}s`);
  return parts.join(" ");
}

interface ProductRow {
  id: number;
  slug: string;
  name: string;
  type: string;
  durationDays: number | null;
  priceDisplay: string | null;
}

interface ActiveSessionRow {
  id: number;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  ipAddress: string | null;
  userAgent: string | null;
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
  const [forceVerifying, setForceVerifying] = useState(false);
  const [forceVerifyConfirmOpen, setForceVerifyConfirmOpen] = useState(false);
  const [resendingInvite, setResendingInvite] = useState(false);
  const [forcingPasswordReset, setForcingPasswordReset] = useState(false);
  const [forcePasswordResetConfirmOpen, setForcePasswordResetConfirmOpen] = useState(false);
  const [sendingResetEmail, setSendingResetEmail] = useState(false);
  const [sendResetEmailConfirmOpen, setSendResetEmailConfirmOpen] = useState(false);
  // Session id currently being revoked (single), or null. Used to disable just
  // that row's button while the request is in flight.
  const [revokingSessionId, setRevokingSessionId] = useState<number | null>(null);
  const [revokeAllSessionsConfirmOpen, setRevokeAllSessionsConfirmOpen] = useState(false);
  const [revokingAllSessions, setRevokingAllSessions] = useState(false);

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
    cancelledByMember: boolean;
    // ISO timestamp of when the member dismissed the in-app banner that
    // surfaced this admin-cancelled attempt. Null if the row is not
    // admin-cancelled or the member has not yet dismissed the banner.
    dismissedByMemberAt: string | null;
    status:
      | "pending"
      | "confirmed"
      | "expired"
      | "abandoned"
      | "cancelled_by_admin"
      | "cancelled_by_member";
  };
  const [emailAttempts, setEmailAttempts] = useState<EmailAttemptRow[]>([]);
  const [emailAttemptsTotal, setEmailAttemptsTotal] = useState<number>(0);
  const [emailAttemptsPageSize, setEmailAttemptsPageSize] = useState<number>(50);
  const [emailAttemptsLoadingMore, setEmailAttemptsLoadingMore] = useState(false);
  // Status filter is sent to the server as `status=<filter>`, so the loaded
  // rows AND the `total` reflect only matching rows. That way "Show older"
  // can keep paging through e.g. cancelled-by-admin rows past page 1, even
  // when newer non-matching rows would otherwise saturate the first page.
  type AttemptStatusFilter =
    | "all"
    | "pending"
    | "confirmed"
    | "expired"
    | "abandoned"
    | "cancelled_by_admin"
    | "cancelled_by_member";
  const [emailAttemptsStatusFilter, setEmailAttemptsStatusFilter] =
    useState<AttemptStatusFilter>("all");
  const [emailAttemptsFilterLoading, setEmailAttemptsFilterLoading] =
    useState(false);
  // Snapshot of the unfiltered list (rows + total) at the moment the admin
  // applied a filter, so clearing the filter restores any extra pages they
  // had already loaded via "Show older". Without this, returning to "all"
  // would fall back to just the embedded /full first page and silently
  // drop everything they paginated through.
  const [unfilteredSnapshot, setUnfilteredSnapshot] = useState<
    { attempts: EmailAttemptRow[]; total: number } | null
  >(null);

  // Click-through detail panel for a single attempt. The list view only
  // shows status + dates; the detail panel adds the matching audit log
  // entry and "what happened next" (next attempt or eventual confirmation)
  // so support staff can resolve old abandoned attempts.
  type AttemptDetail = Awaited<
    ReturnType<typeof adminPanelApi.getMemberEmailAttemptDetail>
  >;
  const [attemptDetailOpen, setAttemptDetailOpen] = useState(false);
  const [attemptDetailLoading, setAttemptDetailLoading] = useState(false);
  const [attemptDetailError, setAttemptDetailError] = useState<string | null>(null);
  const [attemptDetail, setAttemptDetail] = useState<AttemptDetail | null>(null);
  const [attemptDetailRowId, setAttemptDetailRowId] = useState<number | null>(null);

  const { user: currentUser, refreshAuth } = useAuth();
  const [, navigate] = useLocation();
  const canEditMembers = hasPermission(currentUser?.role, "members:edit");
  const canAssignRole = hasPermission(currentUser?.role, "members:assign_role");
  const canImpersonate = hasPermission(currentUser?.role, "members:impersonate");
  const canDeleteMembers = hasPermission(currentUser?.role, "members:delete");
  type DeleteEligibility = Awaited<
    ReturnType<typeof adminPanelApi.getMemberDeleteEligibility>
  >;
  const [deleteEligibility, setDeleteEligibility] = useState<DeleteEligibility | null>(null);
  const [deleteEligibilityLoading, setDeleteEligibilityLoading] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteConfirmEmailInput, setDeleteConfirmEmailInput] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [impersonating, setImpersonating] = useState(false);
  const [impersonateConfirmOpen, setImpersonateConfirmOpen] = useState(false);
  const [roleSaving, setRoleSaving] = useState(false);
  // Role assignment is destructive (one click can demote an admin), so we
  // intercept the dropdown's selection and stage it as `pendingRole` until
  // the super-admin confirms in the dialog. The Select itself stays bound
  // to `member.role`, so cancelling restores the original value with no
  // request sent.
  const [pendingRole, setPendingRole] = useState<string | null>(null);
  const [roleConfirmOpen, setRoleConfirmOpen] = useState(false);

  // Impersonation ("Log in as member") history for the dedicated tab. Lazily
  // loaded the first time the tab is opened so the member detail page's initial
  // /full fetch stays lean — most member views never open this compliance tab.
  type ImpersonationSession = {
    adminId: number | null;
    adminEmail: string | null;
    startId: number | null;
    startedAt: string | null;
    stopId: number | null;
    stoppedAt: string | null;
    durationMs: number | null;
  };
  const [impersonationSessions, setImpersonationSessions] = useState<ImpersonationSession[]>([]);
  const [impersonationHistoryLoading, setImpersonationHistoryLoading] = useState(false);
  const [impersonationHistoryLoaded, setImpersonationHistoryLoaded] = useState(false);

  const loadImpersonationHistory = async () => {
    if (impersonationHistoryLoaded || impersonationHistoryLoading) return;
    try {
      setImpersonationHistoryLoading(true);
      const result = await adminPanelApi.getMemberImpersonationHistory(memberId);
      setImpersonationSessions(Array.isArray(result?.sessions) ? result.sessions : []);
      setImpersonationHistoryLoaded(true);
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setImpersonationHistoryLoading(false);
    }
  };

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

  const handleRoleChange = async (nextRole: string) => {
    if (!member) return;
    if (nextRole === member.role) return;
    setRoleSaving(true);
    try {
      const result = await adminPanelApi.updateMemberRole(memberId, nextRole);
      if (result.changed) {
        toast({
          title: "Role updated",
          description: `Now: ${getRoleLabel(result.role)}`,
        });
      } else {
        toast({
          title: "No change",
          description: `Already ${getRoleLabel(result.role)}`,
        });
      }
      load();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to update role";
      toast({ title: "Error", description: message, variant: "destructive" });
    } finally {
      setRoleSaving(false);
    }
  };

  // Staged in by the dropdown; the Select stays on member.role until this
  // resolves, so closing the dialog without confirming silently restores
  // the original selection.
  const handleRoleSelect = (nextRole: string) => {
    if (!member) return;
    if (nextRole === member.role) return;
    setPendingRole(nextRole);
    setRoleConfirmOpen(true);
  };

  const handleConfirmRoleChange = async () => {
    if (!pendingRole) return;
    const next = pendingRole;
    setRoleConfirmOpen(false);
    setPendingRole(null);
    await handleRoleChange(next);
  };

  const handleRoleConfirmOpenChange = (open: boolean) => {
    setRoleConfirmOpen(open);
    if (!open) setPendingRole(null);
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
      // /full embeds the unfiltered first page, so any active filter from a
      // prior render would mismatch the rows we just dropped in. Reset the
      // filter to "all" so what you see matches what's loaded, and drop any
      // stale snapshot from a previous filter session on the old data.
      setEmailAttemptsStatusFilter("all");
      setUnfilteredSnapshot(null);
      if (typeof result?.emailAttemptsPageSize === "number" && result.emailAttemptsPageSize > 0) {
        setEmailAttemptsPageSize(result.emailAttemptsPageSize);
      }
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const handleOpenAttemptDetail = async (attemptId: number) => {
    setAttemptDetailRowId(attemptId);
    setAttemptDetailOpen(true);
    setAttemptDetailLoading(true);
    setAttemptDetailError(null);
    setAttemptDetail(null);
    try {
      const result = await adminPanelApi.getMemberEmailAttemptDetail(
        memberId,
        attemptId,
      );
      // Guard against a stale response: if the admin clicked a different
      // row (or closed the dialog) while this request was in flight,
      // discard the result so we don't render the wrong attempt.
      setAttemptDetailRowId((current) => {
        if (current === attemptId) {
          setAttemptDetail(result);
          setAttemptDetailLoading(false);
        }
        return current;
      });
    } catch (err: any) {
      setAttemptDetailRowId((current) => {
        if (current === attemptId) {
          setAttemptDetailError(err?.message || "Failed to load attempt detail");
          setAttemptDetailLoading(false);
        }
        return current;
      });
    }
  };

  const handleAttemptDetailOpenChange = (open: boolean) => {
    setAttemptDetailOpen(open);
    if (!open) {
      setAttemptDetail(null);
      setAttemptDetailError(null);
      setAttemptDetailRowId(null);
    }
  };

  const handleLoadOlderEmailAttempts = async () => {
    if (emailAttemptsLoadingMore) return;
    setEmailAttemptsLoadingMore(true);
    try {
      const offset = emailAttempts.length;
      // Keep the same status filter on subsequent pages so the pager
      // surfaces older matching rows (e.g. cancelled-by-admin rows that
      // sit past page 1 of the unfiltered list). Omit the field entirely
      // when "all" so a plain unfiltered request stays plain.
      const params: {
        offset: number;
        limit: number;
        status?: Exclude<AttemptStatusFilter, "all">;
      } = {
        offset,
        limit: emailAttemptsPageSize,
      };
      if (emailAttemptsStatusFilter !== "all") {
        params.status = emailAttemptsStatusFilter;
      }
      const result = await adminPanelApi.getMemberEmailAttempts(memberId, params);
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

  // Refetch the first page from the server when the admin changes the
  // status filter. The server applies the filter before paginating so the
  // returned `total` reflects only matching rows — that's what makes
  // "Show older" able to reach matching rows past the unfiltered page 1.
  // For the default "all" with no offset we can re-use the data the
  // initial /full call embedded, so we avoid a second round-trip.
  const handleStatusFilterChange = async (next: AttemptStatusFilter) => {
    if (next === emailAttemptsStatusFilter) return;
    const wasAll = emailAttemptsStatusFilter === "all";
    setEmailAttemptsStatusFilter(next);
    // Leaving "all" for a filter: snapshot whatever the admin had loaded
    // (including any extra pages from "Show older") so we can restore it
    // verbatim when they clear back to "all", instead of dropping them
    // back to just the embedded /full first page.
    if (wasAll && next !== "all") {
      setUnfilteredSnapshot({
        attempts: emailAttempts,
        total: emailAttemptsTotal,
      });
    }
    if (next === "all") {
      // Prefer the live snapshot (preserves paginated rows). Fall back to
      // the embedded /full data when there is no snapshot yet (e.g. the
      // admin filtered before the page finished loading).
      const restored = unfilteredSnapshot
        ? unfilteredSnapshot
        : data
        ? {
            attempts: Array.isArray(data?.emailAttempts) ? data.emailAttempts : [],
            total:
              typeof data?.emailAttemptsTotal === "number"
                ? data.emailAttemptsTotal
                : Array.isArray(data?.emailAttempts)
                ? data.emailAttempts.length
                : 0,
          }
        : null;
      if (restored) {
        setEmailAttempts(restored.attempts);
        setEmailAttemptsTotal(restored.total);
        setUnfilteredSnapshot(null);
        return;
      }
    }
    setEmailAttemptsFilterLoading(true);
    try {
      const params: {
        offset: number;
        limit: number;
        status?: Exclude<AttemptStatusFilter, "all">;
      } = {
        offset: 0,
        limit: emailAttemptsPageSize,
      };
      if (next !== "all") params.status = next;
      const result = await adminPanelApi.getMemberEmailAttempts(memberId, params);
      setEmailAttempts(result.attempts);
      setEmailAttemptsTotal(result.total);
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setEmailAttemptsFilterLoading(false);
    }
  };

  useEffect(() => { if (memberId) load(); }, [memberId]);

  // Reset the lazily-loaded impersonation tab whenever we switch members.
  // The component stays mounted across member-to-member navigation, so without
  // this the `impersonationHistoryLoaded` guard would short-circuit and show
  // the previous member's sessions under the new member (a compliance bug).
  useEffect(() => {
    setImpersonationSessions([]);
    setImpersonationHistoryLoaded(false);
    setImpersonationHistoryLoading(false);
  }, [memberId]);

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

  // Only super_admins can even see the danger zone, so only fetch the
  // (financial-history-checking) eligibility preview for them — no point
  // spending a round trip for admins who'd never see the card render.
  const loadDeleteEligibility = async () => {
    if (!memberId || !canDeleteMembers) return;
    setDeleteEligibilityLoading(true);
    try {
      const result = await adminPanelApi.getMemberDeleteEligibility(memberId);
      setDeleteEligibility(result);
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setDeleteEligibilityLoading(false);
    }
  };

  useEffect(() => {
    setDeleteEligibility(null);
    if (canDeleteMembers) loadDeleteEligibility();
  }, [memberId, canDeleteMembers]);

  const handleDeleteMember = async () => {
    if (!data) return;
    try {
      setDeleting(true);
      const result = await adminPanelApi.deleteMember(memberId, deleteConfirmEmailInput);
      toast({
        title: "Member deleted",
        description: `${result.deletedMemberEmail} was permanently removed.`,
      });
      setDeleteConfirmOpen(false);
      navigate("/admin/members");
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setDeleting(false);
    }
  };

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

  const handleResendInvite = async () => {
    try {
      setResendingInvite(true);
      await adminPanelApi.resendMemberInvite(memberId);
      toast({
        title: "Invite sent",
        description: "The member will receive a fresh password-setup link.",
      });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setResendingInvite(false);
    }
  };

  const handleForceVerifyEmail = async () => {
    try {
      setForceVerifying(true);
      await adminPanelApi.forceVerifyMemberEmail(memberId);
      toast({ title: "Email verified" });
      setForceVerifyConfirmOpen(false);
      load();
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setForceVerifying(false);
    }
  };

  const handleForcePasswordReset = async () => {
    try {
      setForcingPasswordReset(true);
      await adminPanelApi.forceMemberPasswordReset(memberId);
      toast({
        title: "Password reset forced",
        description: "They'll be required to set a new password the next time they sign in.",
      });
      setForcePasswordResetConfirmOpen(false);
      load();
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setForcingPasswordReset(false);
    }
  };

  const handleSendPasswordResetEmail = async () => {
    try {
      setSendingResetEmail(true);
      const result = await adminPanelApi.sendMemberPasswordResetEmail(memberId);
      setSendResetEmailConfirmOpen(false);
      if (result.emailSent) {
        toast({
          title: "Password reset email sent",
          description: "The member will receive a link to set a new password in their inbox.",
        });
      } else if (result.portalUrlMissing) {
        toast({
          title: "Email not sent — portal URL not configured",
          description: "Set a portal URL in Admin → Settings before sending password reset emails.",
          variant: "destructive",
        });
      } else if (!result.emailConfigured) {
        toast({
          title: "Email not sent — SendGrid not configured",
          description: "Configure the SENDGRID_API_KEY environment variable to enable outbound email.",
          variant: "destructive",
        });
      } else {
        toast({
          title: "Email skipped",
          description: `The email was not delivered (status: ${result.emailStatus}). Check system settings.`,
          variant: "destructive",
        });
      }
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setSendingResetEmail(false);
    }
  };

  const handleRevokeSession = async (sessionId: number) => {
    try {
      setRevokingSessionId(sessionId);
      const result = await adminPanelApi.revokeMemberSession(memberId, sessionId);
      toast({
        title: result.revoked ? "Session revoked" : "Session already ended",
        description: result.revoked
          ? "That sign-in session has been ended."
          : "That session was no longer active.",
      });
      load();
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setRevokingSessionId(null);
    }
  };

  const handleStartImpersonation = async () => {
    setImpersonating(true);
    try {
      await adminPanelApi.startImpersonation(memberId);
      setImpersonateConfirmOpen(false);
      await refreshAuth();
      navigate("/");
    } catch (err: any) {
      toast({ title: "Failed to start impersonation", description: err.message, variant: "destructive" });
    } finally {
      setImpersonating(false);
    }
  };

  const handleRevokeAllSessions = async () => {
    try {
      setRevokingAllSessions(true);
      const result = await adminPanelApi.revokeAllMemberSessions(memberId);
      setRevokeAllSessionsConfirmOpen(false);
      toast({
        title: "Sessions revoked",
        description:
          result.revokedSessionCount > 0
            ? `Ended ${result.revokedSessionCount} active session${result.revokedSessionCount === 1 ? "" : "s"}.`
            : "There were no active sessions to end.",
      });
      load();
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setRevokingAllSessions(false);
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

  const { member, products, trainingProgress, coachingSessions, commissions, community, adminNotes, auditHistory, emailHistory = [], phoneHistory = [], activeSessions = [] } = data;
  // The server applies the status filter before pagination, so the loaded
  // rows AND `emailAttemptsTotal` already reflect only matching rows.
  const visibleAttempts = emailAttempts;
  const hasMoreAttempts = emailAttempts.length < emailAttemptsTotal;
  const isStatusFilterActive = emailAttemptsStatusFilter !== "all";
  const statusFilterLabels: Record<AttemptStatusFilter, string> = {
    all: "All statuses",
    pending: "Pending",
    confirmed: "Confirmed",
    expired: "Expired",
    abandoned: "Abandoned",
    cancelled_by_admin: "Cancelled by admin",
    cancelled_by_member: "Cancelled by member",
  };
  const statusFilterShortLabels: Record<AttemptStatusFilter, string> = {
    all: "attempts",
    pending: "pending attempts",
    confirmed: "confirmed attempts",
    expired: "expired attempts",
    abandoned: "abandoned attempts",
    cancelled_by_admin: "cancelled-by-admin attempts",
    cancelled_by_member: "cancelled-by-member attempts",
  };

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
      case "cancelled_by_member":
        return <Badge variant="outline" className="bg-amber-100 text-amber-800 border-transparent" data-testid={`badge-attempt-status-${status}`}>Cancelled by member</Badge>;
      case "confirmed":
        return <Badge variant="default" className="bg-emerald-600 hover:bg-emerald-600" data-testid={`badge-attempt-status-${status}`}>Confirmed</Badge>;
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
          {canAssignRole && currentUser?.id !== member.id ? (
            <div className="ml-auto flex items-center gap-2" data-testid="container-role-assign">
              <Label htmlFor="select-member-role" className="text-xs text-muted-foreground">Role</Label>
              <Select
                value={member.role}
                onValueChange={handleRoleSelect}
                disabled={roleSaving}
              >
                <SelectTrigger id="select-member-role" className="w-[240px]" data-testid="select-member-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="member" data-testid="option-role-member">
                    {ROLE_INFO.member.label}
                  </SelectItem>
                  {ADMIN_ROLES.map((r: string) => (
                    <SelectItem key={r} value={r} data-testid={`option-role-${r}`}>
                      {getRoleLabel(r)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Dialog open={roleConfirmOpen} onOpenChange={handleRoleConfirmOpenChange}>
                <DialogContent data-testid="dialog-confirm-role-change">
                  <DialogHeader>
                    <DialogTitle>Change role?</DialogTitle>
                    <DialogDescription asChild>
                      <div className="space-y-3 text-sm">
                        <p>
                          Change <span className="font-medium">{member.name}</span>
                          {member.email ? (
                            <>
                              {" "}(<span className="font-mono">{member.email}</span>)
                            </>
                          ) : null}{" "}
                          from{" "}
                          <span className="font-medium" data-testid="text-role-current">
                            {getRoleLabel(member.role)}
                          </span>{" "}
                          to{" "}
                          <span className="font-medium" data-testid="text-role-next">
                            {pendingRole ? getRoleLabel(pendingRole) : ""}
                          </span>
                          ?
                        </p>
                        {pendingRole &&
                        (ROLE_INFO as Record<string, { impact: string }>)[pendingRole] ? (
                          <p
                            className="text-muted-foreground"
                            data-testid="text-role-impact"
                          >
                            {
                              (ROLE_INFO as Record<string, { impact: string }>)[
                                pendingRole
                              ].impact
                            }
                          </p>
                        ) : null}
                        <p className="text-muted-foreground">
                          The change takes effect immediately on save.
                        </p>
                      </div>
                    </DialogDescription>
                  </DialogHeader>
                  <DialogFooter>
                    <Button
                      variant="outline"
                      onClick={() => handleRoleConfirmOpenChange(false)}
                      disabled={roleSaving}
                      data-testid="button-cancel-role-change"
                    >
                      Cancel
                    </Button>
                    <Button
                      onClick={handleConfirmRoleChange}
                      disabled={roleSaving || !pendingRole}
                      data-testid="button-confirm-role-change"
                    >
                      {roleSaving ? "Saving..." : "Change role"}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
          ) : (
            <Badge variant="outline" className="ml-auto" data-testid="badge-member-role">{member.role}</Badge>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card><CardContent className="p-4 text-center"><p className="text-2xl font-bold">{products.length}</p><p className="text-xs text-muted-foreground">Products</p></CardContent></Card>
          <Card><CardContent className="p-4 text-center"><p className="text-2xl font-bold">{trainingProgress.completedLessons}</p><p className="text-xs text-muted-foreground">Lessons Completed</p></CardContent></Card>
          <Card><CardContent className="p-4 text-center"><p className="text-2xl font-bold">{community.posts + community.comments}</p><p className="text-xs text-muted-foreground">Community Activity</p></CardContent></Card>
        </div>

        {!member.emailVerified && (
          <Card data-testid="card-email-unverified">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Mail className="w-4 h-4" />
                Email verification
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="space-y-1 min-w-0">
                  <Badge variant="outline" className="bg-amber-100 text-amber-800 border-transparent" data-testid="badge-email-unverified">
                    Email not verified
                  </Badge>
                  <p className="text-xs text-muted-foreground">
                    Member can't sign in until they confirm their address. Force-verify only if you've confirmed their identity another way.
                  </p>
                </div>
                {canEditMembers && (
                  <Dialog open={forceVerifyConfirmOpen} onOpenChange={setForceVerifyConfirmOpen}>
                    <DialogTrigger asChild>
                      <Button
                        size="sm"
                        disabled={forceVerifying}
                        data-testid="button-force-verify-email"
                      >
                        <ShieldCheck className="w-3 h-3 mr-1" />
                        {forceVerifying ? "Verifying..." : "Force verify email"}
                      </Button>
                    </DialogTrigger>
                    <DialogContent data-testid="dialog-confirm-force-verify">
                      <DialogHeader>
                        <DialogTitle>Force-verify this email?</DialogTitle>
                        <DialogDescription>
                          Mark <span className="font-medium">{member.name}</span>
                          {member.email ? (
                            <>
                              {" "}(<span className="font-mono">{member.email}</span>)
                            </>
                          ) : null}
                          {" "}as verified without requiring them to click the verification
                          link. They'll be able to sign in immediately. Only use this when
                          you've confirmed their identity through another channel.
                        </DialogDescription>
                      </DialogHeader>
                      <DialogFooter>
                        <Button
                          variant="outline"
                          onClick={() => setForceVerifyConfirmOpen(false)}
                          disabled={forceVerifying}
                          data-testid="button-cancel-force-verify"
                        >
                          Cancel
                        </Button>
                        <Button
                          onClick={handleForceVerifyEmail}
                          disabled={forceVerifying}
                          data-testid="button-confirm-force-verify"
                        >
                          <ShieldCheck className="w-3 h-3 mr-1" />
                          {forceVerifying ? "Verifying..." : "Force verify"}
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {canEditMembers && (
          <Card data-testid="card-account-access">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <KeyRound className="w-4 h-4" />
                Account access
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="space-y-1 min-w-0">
                  <p className="text-sm">Resend password-setup email</p>
                  <p className="text-xs text-muted-foreground">
                    Sends the member a fresh link to set (or reset) their password. Use this if their original invite expired or they can't get into their account.
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleResendInvite}
                  disabled={resendingInvite}
                  data-testid="button-resend-invite"
                >
                  {resendingInvite ? (
                    <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                  ) : (
                    <Mail className="w-3 h-3 mr-1" />
                  )}
                  {resendingInvite ? "Sending…" : "Resend invite"}
                </Button>
              </div>

              {canAssignRole && (
                <div className="flex items-center justify-between gap-3 flex-wrap border-t pt-4 mt-4">
                  <div className="space-y-1 min-w-0">
                    <p className="text-sm">Force password reset on next sign-in</p>
                    <p className="text-xs text-muted-foreground">
                      Requires this account to set a brand-new password before reaching anything else the next time they sign in. Use after sharing a temporary password out-of-band, or if the account may be compromised.
                    </p>
                  </div>
                  <Dialog open={forcePasswordResetConfirmOpen} onOpenChange={setForcePasswordResetConfirmOpen}>
                    <DialogTrigger asChild>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={forcingPasswordReset}
                        data-testid="button-force-password-reset"
                      >
                        <KeyRound className="w-3 h-3 mr-1" />
                        {forcingPasswordReset ? "Forcing…" : "Force password reset"}
                      </Button>
                    </DialogTrigger>
                    <DialogContent data-testid="dialog-confirm-force-password-reset">
                      <DialogHeader>
                        <DialogTitle>Force a password reset?</DialogTitle>
                        <DialogDescription>
                          Require <span className="font-medium">{member.name}</span>
                          {member.email ? (
                            <>
                              {" "}(<span className="font-mono">{member.email}</span>)
                            </>
                          ) : null}
                          {" "}to set a new password the next time they sign in. They won't be able to reach anything else until they do. The requirement clears itself once they set the new password.
                        </DialogDescription>
                      </DialogHeader>
                      <DialogFooter>
                        <Button
                          variant="outline"
                          onClick={() => setForcePasswordResetConfirmOpen(false)}
                          disabled={forcingPasswordReset}
                          data-testid="button-cancel-force-password-reset"
                        >
                          Cancel
                        </Button>
                        <Button
                          onClick={handleForcePasswordReset}
                          disabled={forcingPasswordReset}
                          data-testid="button-confirm-force-password-reset"
                        >
                          <KeyRound className="w-3 h-3 mr-1" />
                          {forcingPasswordReset ? "Forcing…" : "Force password reset"}
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                </div>
              )}

              {canAssignRole && (
                <div className="flex items-center justify-between gap-3 flex-wrap border-t pt-4 mt-4">
                  <div className="space-y-1 min-w-0">
                    <p className="text-sm">Send password reset email</p>
                    <p className="text-xs text-muted-foreground">
                      Emails the member a time-limited link to set a new password — the same link the "Forgot password" flow sends. Use this to recover their account on their behalf.
                    </p>
                  </div>
                  <Dialog open={sendResetEmailConfirmOpen} onOpenChange={setSendResetEmailConfirmOpen}>
                    <DialogTrigger asChild>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={sendingResetEmail}
                        data-testid="button-send-password-reset-email"
                      >
                        {sendingResetEmail ? (
                          <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                        ) : (
                          <Mail className="w-3 h-3 mr-1" />
                        )}
                        {sendingResetEmail ? "Sending…" : "Send password reset email"}
                      </Button>
                    </DialogTrigger>
                    <DialogContent data-testid="dialog-confirm-send-password-reset-email">
                      <DialogHeader>
                        <DialogTitle>Send password reset email?</DialogTitle>
                        <DialogDescription>
                          Send <span className="font-medium">{member.name}</span>
                          {member.email ? (
                            <>
                              {" "}(<span className="font-mono">{member.email}</span>)
                            </>
                          ) : null}
                          {" "}a password reset link by email. The link expires in 1 hour. Any existing reset link is invalidated.
                        </DialogDescription>
                      </DialogHeader>
                      <DialogFooter>
                        <Button
                          variant="outline"
                          onClick={() => setSendResetEmailConfirmOpen(false)}
                          disabled={sendingResetEmail}
                          data-testid="button-cancel-send-password-reset-email"
                        >
                          Cancel
                        </Button>
                        <Button
                          onClick={handleSendPasswordResetEmail}
                          disabled={sendingResetEmail}
                          data-testid="button-confirm-send-password-reset-email"
                        >
                          {sendingResetEmail ? (
                            <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                          ) : (
                            <Mail className="w-3 h-3 mr-1" />
                          )}
                          {sendingResetEmail ? "Sending…" : "Send email"}
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {canAssignRole && (
          <Card data-testid="card-active-sessions">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <CardTitle className="text-base flex items-center gap-2">
                  <Monitor className="w-4 h-4" />
                  Active sessions
                </CardTitle>
                {activeSessions.length > 0 && (
                  <Dialog open={revokeAllSessionsConfirmOpen} onOpenChange={setRevokeAllSessionsConfirmOpen}>
                    <DialogTrigger asChild>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={revokingAllSessions}
                        data-testid="button-revoke-all-sessions"
                      >
                        {revokingAllSessions ? (
                          <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                        ) : (
                          <X className="w-3 h-3 mr-1" />
                        )}
                        {revokingAllSessions ? "Ending…" : "End all sessions"}
                      </Button>
                    </DialogTrigger>
                    <DialogContent data-testid="dialog-confirm-revoke-all-sessions">
                      <DialogHeader>
                        <DialogTitle>End all active sessions?</DialogTitle>
                        <DialogDescription>
                          Sign <span className="font-medium">{member.name}</span>
                          {member.email ? (
                            <>
                              {" "}(<span className="font-mono">{member.email}</span>)
                            </>
                          ) : null}
                          {" "}out of every device. They'll need to sign in again everywhere. This does not change their password.
                        </DialogDescription>
                      </DialogHeader>
                      <DialogFooter>
                        <Button
                          variant="outline"
                          onClick={() => setRevokeAllSessionsConfirmOpen(false)}
                          disabled={revokingAllSessions}
                          data-testid="button-cancel-revoke-all-sessions"
                        >
                          Cancel
                        </Button>
                        <Button
                          onClick={handleRevokeAllSessions}
                          disabled={revokingAllSessions}
                          data-testid="button-confirm-revoke-all-sessions"
                        >
                          <X className="w-3 h-3 mr-1" />
                          {revokingAllSessions ? "Ending…" : "End all sessions"}
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                )}
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground mb-3">
                Devices currently signed in to this account. End a single session to sign out one suspicious device, or end all sessions to sign out everywhere. Sessions also end automatically when you force a password reset.
              </p>
              {activeSessions.length === 0 ? (
                <p className="text-sm text-muted-foreground" data-testid="text-no-active-sessions">
                  No active sessions.
                </p>
              ) : (
                <div className="space-y-2">
                  {activeSessions.map((s: ActiveSessionRow) => (
                    <div
                      key={s.id}
                      className="flex items-start justify-between gap-3 flex-wrap border rounded-md p-3"
                      data-testid={`row-session-${s.id}`}
                    >
                      <div className="space-y-1 min-w-0">
                        <p
                          className="text-sm font-medium break-all"
                          title={s.userAgent || undefined}
                          data-testid={`text-session-useragent-${s.id}`}
                        >
                          {formatDeviceLabel(s.userAgent)}
                        </p>
                        <p className="text-xs text-muted-foreground" data-testid={`text-session-ip-${s.id}`}>
                          IP: {s.ipAddress || "unknown"}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Signed in {format(new Date(s.createdAt), "MMM d, yyyy 'at' h:mm a")}
                          {" · "}
                          Last seen {format(new Date(s.lastSeenAt), "MMM d, yyyy 'at' h:mm a")}
                        </p>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleRevokeSession(s.id)}
                        disabled={revokingSessionId === s.id}
                        data-testid={`button-revoke-session-${s.id}`}
                      >
                        {revokingSessionId === s.id ? (
                          <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                        ) : (
                          <X className="w-3 h-3 mr-1" />
                        )}
                        {revokingSessionId === s.id ? "Ending…" : "End session"}
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {canImpersonate && member.role !== "admin" && member.role !== "super_admin" && (
          <Card data-testid="card-impersonation">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <LogIn className="w-4 h-4" />
                Log in as member
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="space-y-1 min-w-0">
                  <p className="text-sm">See the portal exactly as this member sees it</p>
                  <p className="text-xs text-muted-foreground">
                    Starts a full session as <span className="font-medium">{member.name}</span>. An orange banner will be shown at all times so you know you are impersonating. Use "Exit / Stop impersonating" to return to your admin session.
                  </p>
                </div>
                <Dialog open={impersonateConfirmOpen} onOpenChange={setImpersonateConfirmOpen}>
                  <DialogTrigger asChild>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={impersonating}
                      data-testid="button-impersonate"
                    >
                      <LogIn className="w-3 h-3 mr-1" />
                      Log in as member
                    </Button>
                  </DialogTrigger>
                  <DialogContent data-testid="dialog-confirm-impersonate">
                    <DialogHeader>
                      <DialogTitle>Log in as this member?</DialogTitle>
                      <DialogDescription asChild>
                        <div className="space-y-2 text-sm">
                          <p>
                            You will be switched to a session as{" "}
                            <span className="font-medium">{member.name}</span>
                            {member.email ? (
                              <>
                                {" "}(<span className="font-mono">{member.email}</span>)
                              </>
                            ) : null}
                            . You will see and be able to do everything this member can.
                          </p>
                          <p className="text-muted-foreground">
                            An orange banner will always be visible. Click "Exit / Stop impersonating" to return to your admin session. The session expires in 30 minutes.
                          </p>
                          <p className="text-muted-foreground">This action is recorded in the audit log.</p>
                        </div>
                      </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                      <Button
                        variant="outline"
                        onClick={() => setImpersonateConfirmOpen(false)}
                        disabled={impersonating}
                        data-testid="button-cancel-impersonate"
                      >
                        Cancel
                      </Button>
                      <Button
                        onClick={handleStartImpersonation}
                        disabled={impersonating}
                        data-testid="button-confirm-impersonate"
                      >
                        <LogIn className="w-3 h-3 mr-1" />
                        {impersonating ? "Starting…" : "Log in as member"}
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </div>
            </CardContent>
          </Card>
        )}

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

        {(emailAttempts.length > 0 || hasMoreAttempts || isStatusFilterActive) && (
          <Card data-testid="card-email-attempts">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Mail className="w-4 h-4" /> Email change attempts
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                Every email change request — confirmed, expired, abandoned, or cancelled. Click any row to see what happened.
              </p>
            </CardHeader>
            <CardContent>
              <div className="mb-3 flex items-center gap-2 flex-wrap">
                <Label
                  htmlFor="select-email-attempts-status"
                  className="text-xs text-muted-foreground"
                >
                  Filter by status
                </Label>
                <Select
                  value={emailAttemptsStatusFilter}
                  onValueChange={(value) =>
                    handleStatusFilterChange(value as AttemptStatusFilter)
                  }
                  disabled={emailAttemptsFilterLoading}
                >
                  <SelectTrigger
                    id="select-email-attempts-status"
                    className="h-8 w-[200px]"
                    data-testid="select-email-attempts-status"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(statusFilterLabels) as AttemptStatusFilter[]).map((value) => (
                      <SelectItem
                        key={value}
                        value={value}
                        data-testid={`option-email-attempts-status-${value}`}
                      >
                        {statusFilterLabels[value]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {isStatusFilterActive && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 px-2 text-xs"
                    onClick={() => handleStatusFilterChange("all")}
                    disabled={emailAttemptsFilterLoading}
                    data-testid="button-clear-email-attempts-status"
                  >
                    <X className="w-3 h-3 mr-1" /> Clear
                  </Button>
                )}
                {emailAttemptsFilterLoading && (
                  <Loader2
                    className="w-3 h-3 animate-spin text-muted-foreground"
                    data-testid="spinner-email-attempts-filter"
                  />
                )}
              </div>
              <div className="space-y-2">
                {visibleAttempts.length === 0 && (
                  <p
                    className="text-xs text-muted-foreground"
                    data-testid="text-email-attempts-empty"
                  >
                    {isStatusFilterActive ? (
                      <>
                        No {statusFilterShortLabels[emailAttemptsStatusFilter]} on record for this member.
                      </>
                    ) : (
                      <>
                        No email change attempts in the most recent {emailAttempts.length}.
                        {hasMoreAttempts ? " There may be older ones below." : ""}
                      </>
                    )}
                  </p>
                )}
                {visibleAttempts.map((entry: any) => {
                  const cancelledByLabel =
                    entry.cancelledByAdminName ||
                    entry.cancelledByAdminEmail ||
                    (entry.cancelledByAdminId
                      ? `admin #${entry.cancelledByAdminId}`
                      : "an admin");
                  return (
                    <div
                      key={entry.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => handleOpenAttemptDetail(entry.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          handleOpenAttemptDetail(entry.id);
                        }
                      }}
                      className="flex items-center justify-between gap-3 p-2 rounded-md bg-muted/50 hover:bg-muted text-sm cursor-pointer focus:outline-none focus:ring-2 focus:ring-ring"
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
                        {entry.status === "cancelled_by_admin" && (
                          <TooltipProvider delayDuration={150}>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <div
                                  className="text-xs text-muted-foreground mt-0.5 inline-flex items-center cursor-help underline decoration-dotted decoration-muted-foreground/50 underline-offset-2"
                                  data-testid={`text-attempt-dismissed-${entry.id}`}
                                  data-dismissed={entry.dismissedByMemberAt ? "true" : "false"}
                                >
                                  {entry.dismissedByMemberAt
                                    ? `Member dismissed banner on ${format(new Date(entry.dismissedByMemberAt), "MMM d, yyyy 'at' h:mm a")}`
                                    : "Member has not yet dismissed the cancellation banner"}
                                </div>
                              </TooltipTrigger>
                              <TooltipContent
                                side="top"
                                className="max-w-xs text-xs"
                                data-testid={`tooltip-attempt-dismissed-${entry.id}`}
                              >
                                After an admin cancels a pending email change,
                                the member sees an in-app banner on their
                                account page explaining what happened.
                                "Dismissed" means the member clicked to close
                                that banner, so support can confirm they saw
                                the cancellation notice.
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        )}
                        {entry.status === "cancelled_by_member" && entry.cancelledAt && (
                          <div
                            className="text-xs text-muted-foreground mt-0.5"
                            data-testid={`text-attempt-cancelled-by-member-${entry.id}`}
                          >
                            Cancelled by member on {format(new Date(entry.cancelledAt), "MMM d, yyyy 'at' h:mm a")}
                          </div>
                        )}
                        {entry.status === "confirmed" && entry.confirmedAt && (
                          <div
                            className="text-xs text-muted-foreground mt-0.5"
                            data-testid={`text-attempt-confirmed-${entry.id}`}
                          >
                            Confirmed {format(new Date(entry.confirmedAt), "MMM d, yyyy 'at' h:mm a")}
                          </div>
                        )}
                      </div>
                      {entry.status === "pending" && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="shrink-0"
                          onClick={(e) => {
                            // Don't bubble up to the row's click handler —
                            // cancelling shouldn't also open the detail panel.
                            e.stopPropagation();
                            handleCancelEmailChange();
                          }}
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
                    {isStatusFilterActive ? (
                      <>
                        Showing {visibleAttempts.length} of {emailAttemptsTotal} {statusFilterShortLabels[emailAttemptsStatusFilter]}
                      </>
                    ) : (
                      <>
                        Showing {emailAttempts.length} of {emailAttemptsTotal}
                        {emailAttemptsTotal === 1 ? " attempt" : " attempts"}
                      </>
                    )}
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

        <Tabs
          defaultValue="products"
          onValueChange={(v) => { if (v === "impersonation") void loadImpersonationHistory(); }}
        >
          <TabsList className="grid w-full grid-cols-9 gap-1">
            <TabsTrigger value="products" className="text-xs"><Package className="w-3 h-3 mr-1" />Products</TabsTrigger>
            <TabsTrigger value="training" className="text-xs"><BookOpen className="w-3 h-3 mr-1" />Training</TabsTrigger>
            <TabsTrigger value="coaching" className="text-xs"><Video className="w-3 h-3 mr-1" />Coaching</TabsTrigger>
            <TabsTrigger value="commissions" className="text-xs"><DollarSign className="w-3 h-3 mr-1" />Commissions</TabsTrigger>
            <TabsTrigger value="community" className="text-xs"><Users className="w-3 h-3 mr-1" />Community</TabsTrigger>
            <TabsTrigger value="notes" className="text-xs"><StickyNote className="w-3 h-3 mr-1" />Notes</TabsTrigger>
            <TabsTrigger value="password-resets" className="text-xs" data-testid="tab-password-resets"><KeyRound className="w-3 h-3 mr-1" />Password Resets</TabsTrigger>
            <TabsTrigger value="impersonation" className="text-xs" data-testid="tab-impersonation"><LogIn className="w-3 h-3 mr-1" />Impersonation</TabsTrigger>
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
                      <div key={p.id} className="flex items-center justify-between p-3 rounded-lg bg-muted/50" data-testid={`admin-member-product-${p.id}`}>
                        <div>
                          <p className="font-medium text-sm">{p.productName}</p>
                          <div className="flex items-center gap-2 mt-1 flex-wrap">
                            <Badge variant={p.status === "active" ? "default" : "secondary"}>{p.status}</Badge>
                            {p.externalSource && (
                              <Badge variant="outline" data-testid={`admin-member-product-${p.id}-source`}>
                                Source: {p.externalSource}
                              </Badge>
                            )}
                            {p.expiresAt && <span className="text-xs text-muted-foreground">Expires: {format(new Date(p.expiresAt), "MMM d, yyyy")}</span>}
                          </div>
                          {p.externalOrderId && (
                            <p className="text-xs text-muted-foreground mt-1" data-testid={`admin-member-product-${p.id}-order`}>
                              Order: <span className="font-mono">{p.externalOrderId}</span>
                            </p>
                          )}
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

          <TabsContent value="impersonation">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Impersonation history</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground mb-4">
                  Every "Log in as member" session opened against this member —
                  which staff member, when it started and stopped, and how long it
                  lasted.
                </p>
                {impersonationHistoryLoading ? (
                  <div
                    className="flex items-center gap-2 text-sm text-muted-foreground py-4"
                    data-testid="text-impersonation-loading"
                  >
                    <Loader2 className="w-4 h-4 animate-spin" /> Loading impersonation history...
                  </div>
                ) : impersonationSessions.length === 0 ? (
                  <p
                    className="text-sm text-muted-foreground"
                    data-testid="text-impersonation-empty"
                  >
                    No impersonation sessions recorded for this member
                  </p>
                ) : (
                  <div className="space-y-2">
                    {impersonationSessions.map((session, idx) => {
                      const duration = formatImpersonationDuration(session.durationMs);
                      const linkId = session.startId ?? session.stopId;
                      return (
                        <div
                          key={`${session.startId ?? "x"}-${session.stopId ?? "x"}-${idx}`}
                          className="flex items-center gap-3 p-3 rounded-lg bg-muted/50"
                          data-testid={`impersonation-session-${linkId ?? idx}`}
                        >
                          <div className="w-2 h-2 rounded-full bg-primary shrink-0" />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span
                                className="text-sm font-mono break-all"
                                data-testid={`impersonation-session-admin-${linkId ?? idx}`}
                              >
                                {session.adminEmail ||
                                  (session.adminId ? `admin #${session.adminId}` : "an admin")}
                              </span>
                              {duration ? (
                                <Badge variant="outline" className="text-[10px]">
                                  {duration}
                                </Badge>
                              ) : (
                                <Badge variant="secondary" className="text-[10px]">
                                  ongoing / unknown
                                </Badge>
                              )}
                            </div>
                            <div className="text-[10px] text-muted-foreground mt-0.5">
                              Started:{" "}
                              {session.startedAt
                                ? format(new Date(session.startedAt), "MMM d, yyyy h:mm a")
                                : "—"}
                              {" · "}Stopped:{" "}
                              {session.stoppedAt
                                ? format(new Date(session.stoppedAt), "MMM d, yyyy h:mm a")
                                : "—"}
                            </div>
                          </div>
                          {linkId != null && (
                            <Link
                              href={`/admin/audit-log?actionType=impersonation&expand=${linkId}`}
                              data-testid={`link-impersonation-${linkId}`}
                            >
                              <ExternalLink className="w-3 h-3 text-muted-foreground shrink-0" />
                            </Link>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
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
                            <p className="text-sm" data-testid={`text-audit-description-${log.id}`}>{log.description}</p>
                            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                              <Badge variant="outline" className="text-[10px]" data-testid={`badge-audit-action-${log.id}`}>{log.actionType}</Badge>
                              <span className="text-[10px] text-muted-foreground">{log.createdAt ? format(new Date(log.createdAt), "MMM d, h:mm a") : ""}</span>
                              {log.actorEmail && (
                                <span
                                  className="text-[10px] text-muted-foreground font-mono break-all"
                                  data-testid={`text-audit-actor-${log.id}`}
                                >
                                  by {log.actorEmail}
                                </span>
                              )}
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

        {canDeleteMembers && (
          <Card className="border-destructive/40" data-testid="card-danger-zone">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2 text-destructive">
                <X className="w-4 h-4" />
                Danger zone
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="space-y-1 min-w-0">
                  <p className="text-sm">Permanently delete this member account</p>
                  <p className="text-xs text-muted-foreground max-w-xl">
                    For test/probe accounts only. This cancels any booked calls, ends active
                    partner assignments, and permanently removes the member and all associated
                    records. This cannot be undone.
                  </p>
                  {deleteEligibilityLoading && (
                    <p className="text-xs text-muted-foreground" data-testid="text-delete-eligibility-loading">
                      Checking eligibility…
                    </p>
                  )}
                  {!deleteEligibilityLoading && deleteEligibility && !deleteEligibility.eligible && (
                    <p className="text-xs text-destructive" data-testid="text-delete-blocked-reason">
                      {deleteEligibility.blockedReason}
                    </p>
                  )}
                </div>
                <Dialog
                  open={deleteConfirmOpen}
                  onOpenChange={(open) => {
                    setDeleteConfirmOpen(open);
                    if (!open) setDeleteConfirmEmailInput("");
                  }}
                >
                  <DialogTrigger asChild>
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={
                        deleteEligibilityLoading ||
                        !deleteEligibility ||
                        !deleteEligibility.eligible
                      }
                      data-testid="button-delete-member"
                    >
                      <X className="w-3 h-3 mr-1" />
                      Delete member
                    </Button>
                  </DialogTrigger>
                  <DialogContent data-testid="dialog-confirm-delete-member">
                    <DialogHeader>
                      <DialogTitle>Permanently delete this member?</DialogTitle>
                      <DialogDescription asChild>
                        <div className="space-y-3 text-sm">
                          <p>
                            This will permanently delete{" "}
                            <span className="font-medium">{member.name}</span>
                            {member.email ? (
                              <>
                                {" "}(<span className="font-mono">{member.email}</span>)
                              </>
                            ) : null}
                            {" "}and cannot be undone. The following will happen, in order:
                          </p>
                          {deleteEligibility && deleteEligibility.preview && (
                            <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
                              <li data-testid="text-delete-preview-bookings">
                                Cancel {deleteEligibility.preview.bookingsToCancel} booked call(s) with the calendar provider
                              </li>
                              <li data-testid="text-delete-preview-assignments">
                                End {deleteEligibility.preview.activeAssignmentsToEnd} active partner assignment(s)
                              </li>
                              <li data-testid="text-delete-preview-notes">
                                Remove {deleteEligibility.preview.partnerNotes} partner note(s)
                              </li>
                              <li data-testid="text-delete-preview-callbookings">
                                Remove {deleteEligibility.preview.callBookings} call booking record(s)
                              </li>
                              <li data-testid="text-delete-preview-onboarding">
                                Remove {deleteEligibility.preview.onboardingEffects} onboarding effect(s)
                              </li>
                              <li data-testid="text-delete-preview-sequences">
                                Remove {deleteEligibility.preview.sequenceEnrollments} sequence enrollment(s)
                              </li>
                              <li data-testid="text-delete-preview-documents">
                                Remove {deleteEligibility.preview.signedDocuments} signed document(s)
                              </li>
                              <li data-testid="text-delete-preview-products">
                                Remove {deleteEligibility.preview.userProducts} product grant(s)
                              </li>
                              <li>Permanently delete the member account</li>
                            </ul>
                          )}
                          <div className="space-y-1.5">
                            <Label htmlFor="input-delete-confirm-email">
                              Type <span className="font-mono">{member.email}</span> to confirm
                            </Label>
                            <Input
                              id="input-delete-confirm-email"
                              value={deleteConfirmEmailInput}
                              onChange={(e) => setDeleteConfirmEmailInput(e.target.value)}
                              autoComplete="off"
                              data-testid="input-delete-confirm-email"
                            />
                          </div>
                        </div>
                      </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                      <Button
                        variant="outline"
                        onClick={() => setDeleteConfirmOpen(false)}
                        disabled={deleting}
                        data-testid="button-cancel-delete-member"
                      >
                        Cancel
                      </Button>
                      <Button
                        variant="destructive"
                        onClick={handleDeleteMember}
                        disabled={
                          deleting ||
                          !member.email ||
                          deleteConfirmEmailInput !== member.email
                        }
                        data-testid="button-confirm-delete-member"
                      >
                        {deleting ? (
                          <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                        ) : (
                          <X className="w-3 h-3 mr-1" />
                        )}
                        {deleting ? "Deleting…" : "Permanently delete"}
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      <Dialog open={attemptDetailOpen} onOpenChange={handleAttemptDetailOpenChange}>
        <DialogContent className="max-w-2xl" data-testid="dialog-email-attempt-detail">
          <DialogHeader>
            <DialogTitle>Email change attempt detail</DialogTitle>
            <DialogDescription>
              The audit trail and what happened next for this attempt.
            </DialogDescription>
          </DialogHeader>
          {attemptDetailLoading && (
            <div
              className="flex items-center gap-2 text-sm text-muted-foreground py-4"
              data-testid="text-attempt-detail-loading"
            >
              <Loader2 className="w-4 h-4 animate-spin" /> Loading attempt detail...
            </div>
          )}
          {!attemptDetailLoading && attemptDetailError && (
            <p
              className="text-sm text-red-700 py-4"
              data-testid="text-attempt-detail-error"
            >
              {attemptDetailError}
            </p>
          )}
          {!attemptDetailLoading && !attemptDetailError && attemptDetail && (
            <div className="space-y-5 py-2">
              <section className="space-y-1.5" data-testid="section-attempt-detail-attempt">
                <h3 className="text-sm font-medium">This attempt</h3>
                <div className="rounded-md border bg-muted/30 p-3 text-sm space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span
                      className="font-mono break-all"
                      data-testid="text-attempt-detail-email"
                    >
                      {attemptDetail.attempt.newEmail || (
                        <span className="text-muted-foreground italic">(no target email recorded)</span>
                      )}
                    </span>
                    {attemptStatusBadge(attemptDetail.attempt.status)}
                  </div>
                  <p
                    className="text-xs text-muted-foreground"
                    data-testid="text-attempt-detail-requested"
                  >
                    Requested {format(new Date(attemptDetail.attempt.requestedAt), "MMM d, yyyy 'at' h:mm a")}
                  </p>
                  {attemptDetail.attempt.expiresAt && (
                    <p className="text-xs text-muted-foreground">
                      {attemptDetail.attempt.status === "pending"
                        ? "Expires"
                        : attemptDetail.attempt.status === "expired"
                        ? "Expired"
                        : "Would have expired"}{" "}
                      {format(new Date(attemptDetail.attempt.expiresAt), "MMM d, yyyy 'at' h:mm a")}
                    </p>
                  )}
                  {attemptDetail.attempt.confirmedAt && (
                    <p
                      className="text-xs text-muted-foreground"
                      data-testid="text-attempt-detail-confirmed"
                    >
                      Confirmed {format(new Date(attemptDetail.attempt.confirmedAt), "MMM d, yyyy 'at' h:mm a")}
                    </p>
                  )}
                  {attemptDetail.attempt.cancelledAt && (
                    <p
                      className="text-xs text-muted-foreground"
                      data-testid="text-attempt-detail-cancelled"
                    >
                      Cancelled by{" "}
                      {attemptDetail.attempt.cancelledByAdminName ||
                      attemptDetail.attempt.cancelledByAdminEmail ||
                      attemptDetail.attempt.cancelledByAdminId
                        ? attemptDetail.attempt.cancelledByAdminName ||
                          attemptDetail.attempt.cancelledByAdminEmail ||
                          `admin #${attemptDetail.attempt.cancelledByAdminId}`
                        : attemptDetail.attempt.cancelledByMember
                        ? "the member"
                        : "an admin"}{" "}
                      on {format(new Date(attemptDetail.attempt.cancelledAt), "MMM d, yyyy 'at' h:mm a")}
                    </p>
                  )}
                </div>
              </section>

              <section className="space-y-1.5" data-testid="section-attempt-detail-resolution">
                <h3 className="text-sm font-medium">What happened next</h3>
                {!attemptDetail.subsequentConfirmation && !attemptDetail.nextAttempt && (
                  <p
                    className="text-xs text-muted-foreground rounded-md border border-dashed p-3"
                    data-testid="text-attempt-detail-no-resolution"
                  >
                    No follow-up attempt or confirmed change after this one.
                  </p>
                )}
                {attemptDetail.subsequentConfirmation && (
                  <div
                    className="rounded-md border bg-emerald-50 p-3 text-sm space-y-1"
                    data-testid="row-attempt-detail-confirmation"
                  >
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge
                        variant="default"
                        className="bg-emerald-600 hover:bg-emerald-600"
                        data-testid="badge-attempt-detail-confirmation"
                      >
                        Confirmed change
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {format(new Date(attemptDetail.subsequentConfirmation.changedAt), "MMM d, yyyy 'at' h:mm a")}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span
                        className="font-mono break-all"
                        data-testid="text-attempt-detail-confirmation-old"
                      >
                        {attemptDetail.subsequentConfirmation.oldEmail}
                      </span>
                      <span className="text-muted-foreground">→</span>
                      <span
                        className="font-mono break-all"
                        data-testid="text-attempt-detail-confirmation-new"
                      >
                        {attemptDetail.subsequentConfirmation.newEmail}
                      </span>
                    </div>
                  </div>
                )}
                {attemptDetail.nextAttempt && (
                  <div
                    className="rounded-md border bg-muted/30 p-3 text-sm space-y-1"
                    data-testid="row-attempt-detail-next-attempt"
                  >
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant="outline" data-testid="badge-attempt-detail-next-attempt">
                        Next attempt
                      </Badge>
                      <span
                        className="font-mono break-all"
                        data-testid="text-attempt-detail-next-attempt-email"
                      >
                        {attemptDetail.nextAttempt.newEmail || (
                          <span className="text-muted-foreground italic">(no target email)</span>
                        )}
                      </span>
                      {attemptStatusBadge(attemptDetail.nextAttempt.status)}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Requested {format(new Date(attemptDetail.nextAttempt.requestedAt), "MMM d, yyyy 'at' h:mm a")}
                    </p>
                  </div>
                )}
              </section>

              <section className="space-y-1.5" data-testid="section-attempt-detail-audit">
                <h3 className="text-sm font-medium">Audit trail</h3>
                {attemptDetail.auditEntries.length === 0 ? (
                  <p
                    className="text-xs text-muted-foreground rounded-md border border-dashed p-3"
                    data-testid="text-attempt-detail-no-audit"
                  >
                    No admin audit entries recorded for this member during this attempt's window.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {attemptDetail.auditEntries.map((log) => (
                      <div
                        key={log.id}
                        className="rounded-md border bg-muted/30 p-3 text-sm space-y-1"
                        data-testid={`row-attempt-detail-audit-${log.id}`}
                      >
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge
                            variant="outline"
                            className="text-[10px]"
                            data-testid={`badge-attempt-detail-audit-${log.id}`}
                          >
                            {log.actionType}
                          </Badge>
                          <span className="text-xs text-muted-foreground">
                            {log.createdAt ? format(new Date(log.createdAt), "MMM d, yyyy 'at' h:mm a") : ""}
                          </span>
                          {log.actorEmail && (
                            <span
                              className="text-xs text-muted-foreground font-mono break-all"
                              data-testid={`text-attempt-detail-audit-actor-${log.id}`}
                            >
                              {log.actorEmail}
                            </span>
                          )}
                        </div>
                        <p
                          className="text-xs text-foreground/80 break-words"
                          data-testid={`text-attempt-detail-audit-description-${log.id}`}
                        >
                          {log.description}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => handleAttemptDetailOpenChange(false)}
              data-testid="button-attempt-detail-close"
            >
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
