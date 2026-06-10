import { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Users, Search, ChevronLeft, ChevronRight, Eye, Download, Loader2, UserPlus, ShieldPlus, Copy, Check } from "lucide-react";
import { adminPanelApi, saveBlobAsFile, type StreamDownloadProgress } from "@/lib/admin-panel-api";
import { formatDownloadProgress } from "@/lib/download-progress";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { hasPermission, ADMIN_ROLES, ROLE_INFO, type AdminRole } from "@/lib/permissions";
import { format } from "date-fns";

const SOURCE_ANY = "any";
const SOURCE_DIRECT = "direct";

// Role filter for the list. "all" tells the backend to skip its default
// role=member filter so staff/admins (incl. super_admins like the founders)
// also appear — otherwise they are invisible here. Order: All, Member, then
// each admin role.
const ROLE_ALL = "all";
const ROLE_FILTER_OPTIONS: ReadonlyArray<string> = [ROLE_ALL, "member", ...ADMIN_ROLES];

function formatSourceLabel(source: string): string {
  if (source === SOURCE_ANY) return "Any source";
  if (source === SOURCE_DIRECT) return "Direct";
  return source.toUpperCase();
}

function formatRoleLabel(role: string): string {
  if (role === ROLE_ALL) return "All roles";
  if (role === "member") return "Member";
  return ROLE_INFO[role as AdminRole]?.label ?? role;
}

export default function AdminMembers() {
  const [members, setMembers] = useState<any[]>([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 20, total: 0, totalPages: 0 });
  const [search, setSearch] = useState("");
  const [externalSource, setExternalSource] = useState<string>(SOURCE_ANY);
  const [roleFilter, setRoleFilter] = useState<string>(ROLE_ALL);
  const [externalOrderId, setExternalOrderId] = useState("");
  const [availableSources, setAvailableSources] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  // Tracks an in-flight export so we can disable the button (no double
  // submits) and surface a streamed bytes/rows hint while a wide member
  // export is being pulled down. `null` whenever no export is running.
  const [exportProgress, setExportProgress] = useState<StreamDownloadProgress | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  // Staff-account creation (super_admin only). Distinct from the member-invite
  // flow above: it picks a role and surfaces a one-time temporary password.
  const [staffOpen, setStaffOpen] = useState(false);
  const [staffEmail, setStaffEmail] = useState("");
  const [staffName, setStaffName] = useState("");
  const [staffRole, setStaffRole] = useState<AdminRole>("support_agent");
  const [creatingStaff, setCreatingStaff] = useState(false);
  // Holds the freshly-minted staff credentials so we can show the one-time
  // temporary password until the super_admin dismisses it.
  const [staffResult, setStaffResult] = useState<{
    id: number;
    email: string;
    name: string;
    role: string;
    temporaryPassword: string;
  } | null>(null);
  const [copiedPassword, setCopiedPassword] = useState(false);
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const { user: currentUser } = useAuth();
  const canCreateMembers = hasPermission(currentUser?.role, "members:edit");
  const canCreateStaff = hasPermission(currentUser?.role, "members:assign_role");

  const load = async (page = 1, roleOverride?: string) => {
    try {
      setLoading(true);
      const data = await adminPanelApi.getMembers({
        page,
        search: search || undefined,
        role: (roleOverride ?? roleFilter) || undefined,
        externalSource: externalSource && externalSource !== SOURCE_ANY ? externalSource : undefined,
        externalOrderId: externalOrderId || undefined,
      });
      setMembers(data.members);
      setPagination(data.pagination);
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  useEffect(() => {
    // Best-effort populate of the source-filter dropdown. The endpoint
    // is read-only and the filter still works (the value is sent through
    // either way) if the request fails, so we just log and move on.
    adminPanelApi
      .getMemberExternalSources()
      .then((data) => setAvailableSources(data.sources ?? []))
      .catch(() => setAvailableSources([]));
  }, []);

  const handleSearch = () => { load(1); };

  const handleCreate = async () => {
    const email = newEmail.trim();
    const name = newName.trim();
    if (!email || !name) {
      toast({ title: "Missing info", description: "Email and name are required.", variant: "destructive" });
      return;
    }
    setCreating(true);
    try {
      const result = await adminPanelApi.createMember({ email, name });
      toast({
        title: "Member created",
        description: `Sent a password-setup email to ${result.email}.`,
      });
      setAddOpen(false);
      setNewEmail("");
      setNewName("");
      navigate(`/admin/members/${result.id}`);
    } catch (err: any) {
      toast({ title: "Could not create member", description: err.message, variant: "destructive" });
    } finally {
      setCreating(false);
    }
  };

  const resetStaffForm = () => {
    setStaffEmail("");
    setStaffName("");
    setStaffRole("support_agent");
  };

  const handleCreateStaff = async () => {
    const email = staffEmail.trim();
    const name = staffName.trim();
    if (!email || !name) {
      toast({ title: "Missing info", description: "Email and name are required.", variant: "destructive" });
      return;
    }
    setCreatingStaff(true);
    try {
      const result = await adminPanelApi.createStaffAccount({ email, name, role: staffRole });
      setStaffOpen(false);
      resetStaffForm();
      setCopiedPassword(false);
      setStaffResult(result);
    } catch (err: any) {
      toast({ title: "Could not create staff account", description: err.message, variant: "destructive" });
    } finally {
      setCreatingStaff(false);
    }
  };

  const handleCopyPassword = async () => {
    if (!staffResult) return;
    try {
      await navigator.clipboard.writeText(staffResult.temporaryPassword);
      setCopiedPassword(true);
      toast({ title: "Temporary password copied" });
      setTimeout(() => setCopiedPassword(false), 2000);
    } catch {
      toast({ title: "Copy failed", description: "Select the password and copy it manually.", variant: "destructive" });
    }
  };

  const handleExport = async () => {
    // Belt-and-braces: the button is also disabled while an export runs,
    // but a stale Enter key / double-tap could still re-enter this handler
    // before React re-renders the disabled state.
    if (exportProgress) return;
    setExportProgress({ bytesReceived: 0, rowsReceived: null });
    try {
      const { blob } = await adminPanelApi.exportData(
        "members",
        "csv",
        undefined,
        undefined,
        (progress) => setExportProgress(progress),
      );
      saveBlobAsFile(blob, "members-export.csv");
      toast({ title: "Export complete" });
    } catch (err: any) {
      toast({ title: "Export failed", description: err.message, variant: "destructive" });
    } finally {
      setExportProgress(null);
    }
  };

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2"><Users className="w-6 h-6" /> Members</h1>
            <p className="text-muted-foreground mt-1">Manage all platform members</p>
          </div>
          <div className="flex items-center gap-3">
            {exportProgress && (
              <span
                className="text-xs text-muted-foreground tabular-nums"
                aria-live="polite"
                data-testid="text-export-progress"
              >
                {formatDownloadProgress({
                  bytesReceived: exportProgress.bytesReceived,
                  rowsReceived: exportProgress.rowsReceived,
                })}
              </span>
            )}
            {canCreateMembers && (
              <Button
                size="sm"
                onClick={() => setAddOpen(true)}
                data-testid="button-add-member"
              >
                <UserPlus className="w-4 h-4 mr-1" />
                Add Member
              </Button>
            )}
            {canCreateStaff && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setStaffOpen(true)}
                data-testid="button-add-staff"
              >
                <ShieldPlus className="w-4 h-4 mr-1" />
                Create Staff Account
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={handleExport}
              disabled={!!exportProgress}
              data-testid="button-export-members"
            >
              {exportProgress ? (
                <Loader2 className="w-4 h-4 mr-1 animate-spin" />
              ) : (
                <Download className="w-4 h-4 mr-1" />
              )}
              {exportProgress ? "Exporting…" : "Export CSV"}
            </Button>
          </div>
        </div>

        <Card>
          <CardContent className="p-4 space-y-3">
            <div className="flex gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleSearch()} placeholder="Search by name or email..." className="pl-10" data-testid="input-search-members" />
              </div>
              <Button onClick={handleSearch} data-testid="button-search-members">Search</Button>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row">
              <div className="sm:w-48">
                <Select value={roleFilter} onValueChange={(v) => { setRoleFilter(v); load(1, v); }}>
                  <SelectTrigger data-testid="select-role-filter">
                    <SelectValue placeholder="Role" />
                  </SelectTrigger>
                  <SelectContent>
                    {ROLE_FILTER_OPTIONS.map((r) => (
                      <SelectItem key={r} value={r}>{formatRoleLabel(r)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="sm:w-48">
                <Select value={externalSource} onValueChange={setExternalSource}>
                  <SelectTrigger data-testid="select-external-source">
                    <SelectValue placeholder="Source" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={SOURCE_ANY}>{formatSourceLabel(SOURCE_ANY)}</SelectItem>
                    <SelectItem value={SOURCE_DIRECT}>{formatSourceLabel(SOURCE_DIRECT)}</SelectItem>
                    {availableSources.map((s) => (
                      <SelectItem key={s} value={s}>{formatSourceLabel(s)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="relative flex-1">
                <Input
                  value={externalOrderId}
                  onChange={(e) => setExternalOrderId(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                  placeholder="Find by external order ID (e.g. YSE order ABC-123)"
                  data-testid="input-external-order-id"
                />
              </div>
              <Button variant="outline" onClick={handleSearch} data-testid="button-apply-filters">Apply</Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-0">
            {loading ? (
              <div className="p-8 text-center text-muted-foreground">Loading...</div>
            ) : members.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground">No members found</div>
            ) : (
              <table className="w-full">
                <thead>
                  <tr className="border-b text-left">
                    <th className="p-4 text-xs font-medium text-muted-foreground">Name</th>
                    <th className="p-4 text-xs font-medium text-muted-foreground">Email</th>
                    <th className="p-4 text-xs font-medium text-muted-foreground">Role</th>
                    <th className="p-4 text-xs font-medium text-muted-foreground">Source</th>
                    <th className="p-4 text-xs font-medium text-muted-foreground">Joined</th>
                    <th className="p-4 text-xs font-medium text-muted-foreground"></th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {members.map((m) => (
                    <tr key={m.id} className="hover:bg-muted/30 transition-colors">
                      <td className="p-4 text-sm font-medium">{m.name}</td>
                      <td className="p-4 text-sm text-muted-foreground">{m.email}</td>
                      <td className="p-4"><Badge variant="outline" className="text-[10px]">{m.role}</Badge></td>
                      <td className="p-4 text-sm text-muted-foreground">{m.sourceProduct || "N/A"}</td>
                      <td className="p-4 text-sm text-muted-foreground">{m.memberSince ? format(new Date(m.memberSince), "MMM d, yyyy") : ""}</td>
                      <td className="p-4">
                        <Link href={`/admin/members/${m.id}`}>
                          <Button variant="ghost" size="sm"><Eye className="w-4 h-4" /></Button>
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>

        <Dialog open={addOpen} onOpenChange={(open) => { if (!creating) setAddOpen(open); }}>
          <DialogContent data-testid="dialog-add-member">
            <DialogHeader>
              <DialogTitle>Add a new member</DialogTitle>
              <DialogDescription>
                Creates the account and emails the member a link to set their own password.
                Their email is marked verified — only add people you trust the address for.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label htmlFor="new-member-name">Name</Label>
                <Input
                  id="new-member-name"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Jane Doe"
                  autoComplete="off"
                  data-testid="input-new-member-name"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="new-member-email">Email</Label>
                <Input
                  id="new-member-email"
                  type="email"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  placeholder="jane@example.com"
                  autoComplete="off"
                  data-testid="input-new-member-email"
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setAddOpen(false)}
                disabled={creating}
                data-testid="button-cancel-add-member"
              >
                Cancel
              </Button>
              <Button
                onClick={handleCreate}
                disabled={creating}
                data-testid="button-confirm-add-member"
              >
                {creating ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <UserPlus className="w-4 h-4 mr-1" />}
                {creating ? "Creating…" : "Create & send invite"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={staffOpen} onOpenChange={(open) => { if (!creatingStaff) setStaffOpen(open); }}>
          <DialogContent data-testid="dialog-add-staff">
            <DialogHeader>
              <DialogTitle>Create a staff account</DialogTitle>
              <DialogDescription>
                Provisions a new admin-panel team member with the role you pick. The account is
                ready to use immediately and a one-time temporary password is shown after creation
                for you to share manually.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label htmlFor="new-staff-name">Name</Label>
                <Input
                  id="new-staff-name"
                  value={staffName}
                  onChange={(e) => setStaffName(e.target.value)}
                  placeholder="Jane Doe"
                  autoComplete="off"
                  data-testid="input-new-staff-name"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="new-staff-email">Email</Label>
                <Input
                  id="new-staff-email"
                  type="email"
                  value={staffEmail}
                  onChange={(e) => setStaffEmail(e.target.value)}
                  placeholder="jane@example.com"
                  autoComplete="off"
                  data-testid="input-new-staff-email"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="new-staff-role">Role</Label>
                <Select value={staffRole} onValueChange={(v) => setStaffRole(v as AdminRole)}>
                  <SelectTrigger id="new-staff-role" data-testid="select-new-staff-role">
                    <SelectValue placeholder="Select a role" />
                  </SelectTrigger>
                  <SelectContent>
                    {ADMIN_ROLES.map((role) => (
                      <SelectItem key={role} value={role}>{ROLE_INFO[role]?.label ?? role}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">{ROLE_INFO[staffRole]?.impact}</p>
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setStaffOpen(false)}
                disabled={creatingStaff}
                data-testid="button-cancel-add-staff"
              >
                Cancel
              </Button>
              <Button
                onClick={handleCreateStaff}
                disabled={creatingStaff}
                data-testid="button-confirm-add-staff"
              >
                {creatingStaff ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <ShieldPlus className="w-4 h-4 mr-1" />}
                {creatingStaff ? "Creating…" : "Create account"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={!!staffResult} onOpenChange={(open) => { if (!open) setStaffResult(null); }}>
          <DialogContent data-testid="dialog-staff-credentials">
            <DialogHeader>
              <DialogTitle>Staff account created</DialogTitle>
              <DialogDescription>
                Share these credentials with {staffResult?.name} securely. This temporary password
                is shown only once — it cannot be retrieved again. Ask them to change it after their
                first sign-in.
              </DialogDescription>
            </DialogHeader>
            {staffResult && (
              <div className="space-y-4 py-2">
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Email</Label>
                  <p className="text-sm font-medium" data-testid="text-staff-email">{staffResult.email}</p>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Role</Label>
                  <p className="text-sm font-medium" data-testid="text-staff-role">{ROLE_INFO[staffResult.role as AdminRole]?.label ?? staffResult.role}</p>
                </div>
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">Temporary password</Label>
                  <div className="flex items-center gap-2">
                    <code
                      className="flex-1 rounded bg-muted px-3 py-2 text-sm font-mono break-all"
                      data-testid="text-staff-temp-password"
                    >
                      {staffResult.temporaryPassword}
                    </code>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleCopyPassword}
                      data-testid="button-copy-staff-password"
                    >
                      {copiedPassword ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                    </Button>
                  </div>
                </div>
              </div>
            )}
            <DialogFooter>
              <Button
                onClick={() => {
                  const id = staffResult?.id;
                  setStaffResult(null);
                  if (id) navigate(`/admin/members/${id}`);
                }}
                variant="outline"
                data-testid="button-view-staff-member"
              >
                View account
              </Button>
              <Button onClick={() => setStaffResult(null)} data-testid="button-done-staff-credentials">
                Done
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {pagination.totalPages > 1 && (
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">Page {pagination.page} of {pagination.totalPages} ({pagination.total} total)</p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={pagination.page <= 1} onClick={() => load(pagination.page - 1)}><ChevronLeft className="w-4 h-4" /></Button>
              <Button variant="outline" size="sm" disabled={pagination.page >= pagination.totalPages} onClick={() => load(pagination.page + 1)}><ChevronRight className="w-4 h-4" /></Button>
            </div>
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
