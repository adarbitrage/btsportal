import { useState, useEffect, useRef } from "react";
import { Link, useLocation } from "wouter";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { formatDeviceLabel } from "@/lib/device-label";
import { User, Lock, Bell, Mail, Clock, AlertTriangle, X, Monitor, Loader2 } from "lucide-react";
import {
  useGetCurrentMember,
  usePatchMemberProfile,
  useChangeMemberPassword,
  useRequestMemberEmailChange,
  useCancelMemberEmailChange,
  useDismissAdminCancelledEmailChange,
  getMemberEmailChangePrefill,
  useGetMyActiveSessions,
  useRevokeMyActiveSession,
  useRevokeMyOtherSessions,
  type MyActiveSession,
} from "@workspace/api-client-react";

export default function Account() {
  const { toast } = useToast();
  const { logout } = useAuth();
  const [, navigate] = useLocation();
  const { data: member, isLoading, refetch } = useGetCurrentMember();
  const patchProfile = usePatchMemberProfile();
  const changePassword = useChangeMemberPassword();
  const requestEmailChange = useRequestMemberEmailChange();
  const cancelEmailChange = useCancelMemberEmailChange();
  const dismissAdminCancelled = useDismissAdminCancelledEmailChange();
  const {
    data: sessionsData,
    isLoading: sessionsLoading,
    refetch: refetchSessions,
  } = useGetMyActiveSessions();
  const revokeSession = useRevokeMyActiveSession();
  const revokeOtherSessions = useRevokeMyOtherSessions();

  const [emailDialogOpen, setEmailDialogOpen] = useState(false);
  const [emailCurrentPassword, setEmailCurrentPassword] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [emailSaving, setEmailSaving] = useState(false);
  const [emailError, setEmailError] = useState("");
  const [cancellingEmail, setCancellingEmail] = useState(false);
  const [dismissingAdminCancelled, setDismissingAdminCancelled] = useState(false);
  // Guard so that the prefill flow only runs once even if React effects
  // re-fire (e.g. StrictMode double-invocation in dev). Without this we
  // would re-open the dialog after the user manually closes it.
  const prefillHandledRef = useRef(false);

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [timezone, setTimezone] = useState("");
  const [smsOptIn, setSmsOptIn] = useState(false);
  const [ticketReplySmsOptIn, setTicketReplySmsOptIn] = useState(true);
  const [securitySmsOptIn, setSecuritySmsOptIn] = useState(true);
  const [billingSmsOptIn, setBillingSmsOptIn] = useState(true);
  const [coachingSmsOptIn, setCoachingSmsOptIn] = useState(true);
  const [contentSmsOptIn, setContentSmsOptIn] = useState(false);
  const [marketingOptIn, setMarketingOptIn] = useState(true);

  const [profileSaving, setProfileSaving] = useState(false);
  const [profileError, setProfileError] = useState("");

  const [notifSaving, setNotifSaving] = useState(false);
  const [notifError, setNotifError] = useState("");

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordError, setPasswordError] = useState("");

  // Session id currently being revoked (single), or null — disables just that
  // row's button while the request is in flight.
  const [revokingSessionId, setRevokingSessionId] = useState<number | null>(null);
  const [revokeOthersConfirmOpen, setRevokeOthersConfirmOpen] = useState(false);
  const [revokingOthers, setRevokingOthers] = useState(false);

  useEffect(() => {
    if (member) {
      setName(member.name || "");
      setPhone(member.phone || "");
      setTimezone(
        member.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
      );
      setSmsOptIn(member.smsOptIn ?? false);
      setTicketReplySmsOptIn(member.ticketReplySmsOptIn ?? true);
      setSecuritySmsOptIn(member.securitySmsOptIn ?? true);
      setBillingSmsOptIn(member.billingSmsOptIn ?? true);
      setCoachingSmsOptIn(member.coachingSmsOptIn ?? true);
      setContentSmsOptIn(member.contentSmsOptIn ?? false);
      setMarketingOptIn(member.marketingOptIn ?? true);
    }
  }, [member]);

  // Members arriving from the "Start a new email change" CTA in the
  // admin-cancellation email land here with a signed `email_change_prefill`
  // token. We exchange it for the previously-discarded address and open the
  // email-change dialog with that address pre-populated, so the legitimate
  // case of a support-cancelled change can be retried in one click rather
  // than forcing the member to remember and retype the address.
  useEffect(() => {
    if (!member || prefillHandledRef.current) return;
    if (typeof window === "undefined") return;

    const params = new URLSearchParams(window.location.search);
    const token = params.get("email_change_prefill");
    if (!token) return;

    prefillHandledRef.current = true;

    const stripParam = () => {
      params.delete("email_change_prefill");
      const qs = params.toString();
      const cleanUrl =
        window.location.pathname + (qs ? `?${qs}` : "") + window.location.hash;
      window.history.replaceState({}, "", cleanUrl);
    };

    (async () => {
      try {
        const res = await getMemberEmailChangePrefill({ token });
        const prefillEmail = (res?.prefillEmail || "").trim().toLowerCase();
        // If the previously-requested address has since become the member's
        // current verified email (e.g. a different change request completed
        // in the meantime), there is nothing to retry — silently no-op.
        if (
          !prefillEmail ||
          prefillEmail === (member.email || "").toLowerCase()
        ) {
          stripParam();
          return;
        }
        setEmailError("");
        setEmailCurrentPassword("");
        setNewEmail(prefillEmail);
        setEmailDialogOpen(true);
        toast({
          title: "Email change pre-filled",
          description: `We've pre-filled ${prefillEmail} from your previous request. Confirm your password to retry the change.`,
        });
      } catch (err: any) {
        toast({
          title: "Couldn't pre-fill email",
          description:
            err?.data?.error ||
            err?.message ||
            "This pre-fill link is no longer valid. You can still start a new email change manually below.",
          variant: "destructive",
        });
      } finally {
        stripParam();
      }
    })();
  }, [member, toast]);

  const profileDirty =
    !!member &&
    (name.trim() !== (member.name || "") ||
      (phone.trim() || null) !== (member.phone || null) ||
      (timezone || null) !== (member.timezone || null));

  const notifDirty =
    !!member &&
    (smsOptIn !== (member.smsOptIn ?? false) ||
      ticketReplySmsOptIn !== (member.ticketReplySmsOptIn ?? true) ||
      securitySmsOptIn !== (member.securitySmsOptIn ?? true) ||
      billingSmsOptIn !== (member.billingSmsOptIn ?? true) ||
      coachingSmsOptIn !== (member.coachingSmsOptIn ?? true) ||
      contentSmsOptIn !== (member.contentSmsOptIn ?? false) ||
      marketingOptIn !== (member.marketingOptIn ?? true));

  const handleProfileSave = async () => {
    setProfileError("");
    if (!name.trim()) {
      setProfileError("Name is required.");
      return;
    }
    setProfileSaving(true);
    try {
      await patchProfile.mutateAsync({
        data: {
          name: name.trim(),
          phone: phone.trim() || null,
          timezone,
        },
      });
      await refetch();
      toast({ title: "Profile saved", description: "Your details have been updated." });
    } catch (err: any) {
      setProfileError(err?.message || "Failed to save profile.");
    } finally {
      setProfileSaving(false);
    }
  };

  const handleNotificationsSave = async () => {
    setNotifError("");
    setNotifSaving(true);
    try {
      await patchProfile.mutateAsync({
        data: {
          smsOptIn,
          ticketReplySmsOptIn,
          securitySmsOptIn,
          billingSmsOptIn,
          coachingSmsOptIn,
          contentSmsOptIn,
          marketingOptIn,
        },
      });
      await refetch();
      toast({
        title: "Preferences saved",
        description: "Your notification preferences have been updated.",
      });
    } catch (err: any) {
      setNotifError(err?.message || "Failed to save preferences.");
    } finally {
      setNotifSaving(false);
    }
  };

  const handleRequestEmailChange = async () => {
    setEmailError("");
    const trimmed = newEmail.trim().toLowerCase();
    if (!emailCurrentPassword) {
      setEmailError("Please enter your current password.");
      return;
    }
    if (!trimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setEmailError("Please enter a valid email address.");
      return;
    }
    if (member && trimmed === member.email.toLowerCase()) {
      setEmailError("That's already your current email address.");
      return;
    }

    setEmailSaving(true);
    try {
      const res = await requestEmailChange.mutateAsync({
        data: { currentPassword: emailCurrentPassword, newEmail: trimmed },
      });
      await refetch();
      setEmailDialogOpen(false);
      setEmailCurrentPassword("");
      setNewEmail("");
      toast({
        title: "Verification email sent",
        description:
          res?.message ||
          `Click the confirmation link we sent to ${trimmed} to finish the change.`,
      });
    } catch (err: any) {
      setEmailError(
        err?.data?.error || err?.message || "Failed to request email change.",
      );
    } finally {
      setEmailSaving(false);
    }
  };

  const handleDismissAdminCancelled = async () => {
    setDismissingAdminCancelled(true);
    try {
      await dismissAdminCancelled.mutateAsync();
      await refetch();
    } catch (err: any) {
      toast({
        title: "Couldn't dismiss",
        description: err?.message || "Please try again.",
        variant: "destructive",
      });
    } finally {
      setDismissingAdminCancelled(false);
    }
  };

  const handleCancelEmailChange = async () => {
    setCancellingEmail(true);
    try {
      await cancelEmailChange.mutateAsync();
      await refetch();
      toast({
        title: "Email change cancelled",
        description: "Your email address remains unchanged.",
      });
    } catch (err: any) {
      toast({
        title: "Couldn't cancel",
        description: err?.message || "Please try again.",
        variant: "destructive",
      });
    } finally {
      setCancellingEmail(false);
    }
  };

  const handlePasswordChange = async () => {
    setPasswordError("");

    if (!currentPassword || !newPassword || !confirmPassword) {
      setPasswordError("All password fields are required.");
      return;
    }
    if (newPassword.length < 8 || !/[a-zA-Z]/.test(newPassword) || !/[0-9]/.test(newPassword)) {
      setPasswordError(
        "New password must be at least 8 characters with at least 1 letter and 1 number.",
      );
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError("New password and confirmation do not match.");
      return;
    }
    if (newPassword === currentPassword) {
      setPasswordError("New password must be different from current password.");
      return;
    }

    setPasswordSaving(true);
    try {
      const res = await changePassword.mutateAsync({
        data: { currentPassword, newPassword },
      });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      toast({
        title: "Password updated",
        description: res?.message || "Your password has been changed. Please sign in again.",
      });
      await logout();
      navigate("/login");
    } catch (err: any) {
      setPasswordError(err?.message || "Failed to change password.");
    } finally {
      setPasswordSaving(false);
    }
  };

  const sessions = sessionsData?.sessions ?? [];
  const otherSessionsCount = sessions.filter((s) => !s.current).length;

  const handleRevokeSession = async (session: MyActiveSession) => {
    try {
      setRevokingSessionId(session.id);
      const result = await revokeSession.mutateAsync({ sessionId: session.id });
      // Ending the current session signs the member out: their access token is
      // still valid for up to 15 minutes, but the refresh that keeps them
      // signed in will now fail, so send them to login proactively.
      if (session.current) {
        toast({
          title: "Signed out of this device",
          description: "You'll need to sign in again.",
        });
        await logout();
        navigate("/login");
        return;
      }
      toast({
        title: result.revoked ? "Device signed out" : "Already signed out",
        description: result.revoked
          ? "That device has been signed out."
          : "That device was no longer active.",
      });
      await refetchSessions();
    } catch (err: any) {
      toast({
        title: "Couldn't sign out device",
        description: err?.message || "Please try again.",
        variant: "destructive",
      });
    } finally {
      setRevokingSessionId(null);
    }
  };

  const handleRevokeOtherSessions = async () => {
    try {
      setRevokingOthers(true);
      const result = await revokeOtherSessions.mutateAsync();
      setRevokeOthersConfirmOpen(false);
      toast({
        title: "Other devices signed out",
        description:
          result.revokedSessionCount > 0
            ? `Signed out ${result.revokedSessionCount} other device${result.revokedSessionCount === 1 ? "" : "s"}.`
            : "There were no other devices to sign out.",
      });
      await refetchSessions();
    } catch (err: any) {
      toast({
        title: "Couldn't sign out other devices",
        description: err?.message || "Please try again.",
        variant: "destructive",
      });
    } finally {
      setRevokingOthers(false);
    }
  };

  if (isLoading || !member) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center h-64">
          <div className="animate-pulse text-muted-foreground">Loading account...</div>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="space-y-6 max-w-6xl">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <User className="w-6 h-6 text-primary" />
            <h1 className="text-3xl font-bold">Account</h1>
          </div>
          <p className="text-muted-foreground">
            Manage your profile, password, and notification preferences.
          </p>
        </div>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <User className="w-5 h-5 text-primary" />
              <CardTitle>Profile</CardTitle>
            </div>
            <CardDescription>Your name, contact details, and timezone.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="account-name">Full name</Label>
                <Input
                  id="account-name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="mt-1.5"
                />
              </div>
              <div>
                <Label htmlFor="account-email">Email</Label>
                <div className="mt-1.5 flex items-center gap-2">
                  <Input
                    id="account-email"
                    type="email"
                    value={member.email}
                    disabled
                    className="bg-muted flex-1"
                    data-testid="input-account-email"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setEmailError("");
                      setEmailCurrentPassword("");
                      setNewEmail("");
                      setEmailDialogOpen(true);
                    }}
                    data-testid="button-update-email"
                  >
                    Update
                  </Button>
                </div>
                {member.pendingEmail ? (
                  <div
                    className="mt-2 p-3 bg-amber-50 border border-amber-200 rounded-md text-sm text-amber-900 flex items-start gap-2"
                    data-testid="email-pending-banner"
                  >
                    <Clock className="w-4 h-4 mt-0.5 shrink-0" />
                    <div className="flex-1">
                      <p>
                        Pending change to{" "}
                        <strong data-testid="text-pending-email">{member.pendingEmail}</strong>.
                        Click the link we sent to that address to confirm.
                      </p>
                      <button
                        type="button"
                        onClick={handleCancelEmailChange}
                        disabled={cancellingEmail}
                        className="mt-1 text-xs font-medium text-amber-900 underline hover:no-underline disabled:opacity-50"
                        data-testid="button-cancel-email-change"
                      >
                        {cancellingEmail ? "Cancelling..." : "Cancel pending change"}
                      </button>
                    </div>
                  </div>
                ) : member.lastAdminCancelledEmailChange ? (
                  <div
                    className="mt-2 p-3 bg-blue-50 border border-blue-200 rounded-md text-sm text-blue-900 flex items-start gap-2"
                    data-testid="email-admin-cancelled-banner"
                  >
                    <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                    <div className="flex-1">
                      <p>
                        Your pending change to{" "}
                        <strong data-testid="text-admin-cancelled-email">
                          {member.lastAdminCancelledEmailChange.newEmail}
                        </strong>{" "}
                        was cancelled by an administrator on{" "}
                        <span data-testid="text-admin-cancelled-at">
                          {new Date(
                            member.lastAdminCancelledEmailChange.cancelledAt,
                          ).toLocaleString(undefined, {
                            year: "numeric",
                            month: "short",
                            day: "numeric",
                            hour: "numeric",
                            minute: "2-digit",
                          })}
                        </span>
                        . If you weren't expecting this,{" "}
                        <Link
                          href={`/support/contact?topic=email-admin-cancelled&attemptId=${member.lastAdminCancelledEmailChange.attemptId}`}
                          data-testid="link-admin-cancelled-contact-support"
                          className="font-medium text-blue-900 underline hover:no-underline"
                        >
                          contact support
                        </Link>
                        .
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={handleDismissAdminCancelled}
                      disabled={dismissingAdminCancelled}
                      aria-label="Dismiss notice"
                      className="text-blue-900/70 hover:text-blue-900 disabled:opacity-50 shrink-0"
                      data-testid="button-dismiss-admin-cancelled-banner"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground mt-1">
                    We'll send a verification link to confirm any change.
                  </p>
                )}
              </div>
              <div>
                <Label htmlFor="account-phone">Phone (optional)</Label>
                <Input
                  id="account-phone"
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+1 (555) 000-0000"
                  className="mt-1.5"
                />
              </div>
              <div>
                <Label htmlFor="account-timezone">Timezone</Label>
                <select
                  id="account-timezone"
                  value={timezone}
                  onChange={(e) => setTimezone(e.target.value)}
                  className="mt-1.5 w-full px-3 py-2 border border-border rounded-md bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                >
                  {Intl.supportedValuesOf("timeZone").map((tz) => (
                    <option key={tz} value={tz}>
                      {tz.replace(/_/g, " ")}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {profileError && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-md text-red-700 text-sm">
                {profileError}
              </div>
            )}

            <div className="flex justify-end">
              <Button onClick={handleProfileSave} disabled={!profileDirty || profileSaving}>
                {profileSaving ? "Saving..." : "Save profile"}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Lock className="w-5 h-5 text-primary" />
              <CardTitle>Change password</CardTitle>
            </div>
            <CardDescription>
              Use a strong password with at least 8 characters, including a letter and a number.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Label htmlFor="current-password">Current password</Label>
                <Input
                  id="current-password"
                  type="password"
                  autoComplete="current-password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  className="mt-1.5"
                />
              </div>
              <div>
                <Label htmlFor="new-password">New password</Label>
                <Input
                  id="new-password"
                  type="password"
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="mt-1.5"
                />
              </div>
              <div>
                <Label htmlFor="confirm-password">Confirm new password</Label>
                <Input
                  id="confirm-password"
                  type="password"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="mt-1.5"
                />
              </div>
            </div>

            {passwordError && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-md text-red-700 text-sm">
                {passwordError}
              </div>
            )}

            <div className="flex justify-end">
              <Button
                onClick={handlePasswordChange}
                disabled={
                  passwordSaving || !currentPassword || !newPassword || !confirmPassword
                }
              >
                {passwordSaving ? "Updating..." : "Update password"}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card id="sessions" data-testid="card-active-sessions">
          <CardHeader>
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <div className="flex items-center gap-2">
                  <Monitor className="w-5 h-5 text-primary" />
                  <CardTitle>Where you're signed in</CardTitle>
                </div>
                <CardDescription className="mt-1.5">
                  Devices currently signed in to your account. Sign out a device
                  you don't recognize.
                </CardDescription>
              </div>
              {otherSessionsCount > 0 && (
                <Dialog open={revokeOthersConfirmOpen} onOpenChange={setRevokeOthersConfirmOpen}>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={revokingOthers}
                    onClick={() => setRevokeOthersConfirmOpen(true)}
                    data-testid="button-revoke-other-sessions"
                  >
                    {revokingOthers ? (
                      <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                    ) : (
                      <X className="w-3 h-3 mr-1" />
                    )}
                    {revokingOthers ? "Signing out…" : "Sign out other devices"}
                  </Button>
                  <DialogContent data-testid="dialog-confirm-revoke-others">
                    <DialogHeader>
                      <DialogTitle>Sign out other devices?</DialogTitle>
                      <DialogDescription>
                        This signs you out everywhere except this device. You'll
                        stay signed in here. This does not change your password.
                      </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                      <Button
                        variant="outline"
                        onClick={() => setRevokeOthersConfirmOpen(false)}
                        disabled={revokingOthers}
                        data-testid="button-cancel-revoke-others"
                      >
                        Cancel
                      </Button>
                      <Button
                        onClick={handleRevokeOtherSessions}
                        disabled={revokingOthers}
                        data-testid="button-confirm-revoke-others"
                      >
                        <X className="w-3 h-3 mr-1" />
                        {revokingOthers ? "Signing out…" : "Sign out other devices"}
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {sessionsLoading ? (
              <p className="text-sm text-muted-foreground" data-testid="text-sessions-loading">
                Loading devices…
              </p>
            ) : sessions.length === 0 ? (
              <p className="text-sm text-muted-foreground" data-testid="text-no-active-sessions">
                No active sessions.
              </p>
            ) : (
              <div className="space-y-2">
                {sessions.map((s) => (
                  <div
                    key={s.id}
                    className="flex items-start justify-between gap-3 flex-wrap border rounded-md p-3"
                    data-testid={`row-session-${s.id}`}
                  >
                    <div className="space-y-1 min-w-0">
                      <p
                        className="text-sm font-medium flex items-center gap-2"
                        title={s.userAgent || undefined}
                        data-testid={`text-session-useragent-${s.id}`}
                      >
                        {formatDeviceLabel(s.userAgent)}
                        {s.current && (
                          <span
                            className="inline-flex items-center rounded-full bg-primary/10 text-primary text-xs font-medium px-2 py-0.5"
                            data-testid={`badge-current-session-${s.id}`}
                          >
                            This device
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-muted-foreground" data-testid={`text-session-ip-${s.id}`}>
                        IP: {s.ipAddress || "unknown"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Signed in{" "}
                        {new Date(s.createdAt).toLocaleString(undefined, {
                          year: "numeric",
                          month: "short",
                          day: "numeric",
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                        {" · "}
                        Last seen{" "}
                        {new Date(s.lastSeenAt).toLocaleString(undefined, {
                          year: "numeric",
                          month: "short",
                          day: "numeric",
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleRevokeSession(s)}
                      disabled={revokingSessionId === s.id}
                      data-testid={`button-revoke-session-${s.id}`}
                    >
                      {revokingSessionId === s.id ? (
                        <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                      ) : (
                        <X className="w-3 h-3 mr-1" />
                      )}
                      {revokingSessionId === s.id
                        ? "Signing out…"
                        : s.current
                          ? "Sign out"
                          : "Sign out device"}
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Bell className="w-5 h-5 text-primary" />
              <CardTitle>Notification preferences</CardTitle>
            </div>
            <CardDescription>
              Choose which messages you receive from BTS.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="flex items-start justify-between gap-4 py-2">
              <div className="flex-1">
                <p className="font-medium text-sm">SMS notifications</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Coaching reminders, new content alerts, and time-sensitive updates by text.
                  Message and data rates may apply.
                </p>
              </div>
              <Switch
                checked={smsOptIn}
                onCheckedChange={setSmsOptIn}
                aria-label="Toggle SMS notifications"
              />
            </div>

            <div className="flex items-start justify-between gap-4 py-2 pl-4 border-l-2 border-border/60 ml-1">
              <div className="flex-1">
                <p className="font-medium text-sm">Support reply texts</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Get a text whenever our support team replies to one of your
                  tickets. Turn this off to silence ticket-reply texts while
                  keeping your other SMS alerts. You'll always get the email.
                </p>
              </div>
              <Switch
                checked={smsOptIn && ticketReplySmsOptIn}
                disabled={!smsOptIn}
                onCheckedChange={setTicketReplySmsOptIn}
                aria-label="Toggle support reply texts"
              />
            </div>

            <div className="flex items-start justify-between gap-4 py-2 pl-4 border-l-2 border-border/60 ml-1">
              <div className="flex-1">
                <p className="font-medium text-sm">Account &amp; security texts</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Texts for password resets and login credentials. Turn this
                  off to silence security texts while keeping your other SMS
                  alerts. You'll always get the email.
                </p>
              </div>
              <Switch
                checked={smsOptIn && securitySmsOptIn}
                disabled={!smsOptIn}
                onCheckedChange={setSecuritySmsOptIn}
                aria-label="Toggle account and security texts"
              />
            </div>

            <div className="flex items-start justify-between gap-4 py-2 pl-4 border-l-2 border-border/60 ml-1">
              <div className="flex-1">
                <p className="font-medium text-sm">Billing texts</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Texts for purchase confirmations and failed-payment notices.
                  Turn this off to silence billing texts while keeping your
                  other SMS alerts. You'll always get the email.
                </p>
              </div>
              <Switch
                checked={smsOptIn && billingSmsOptIn}
                disabled={!smsOptIn}
                onCheckedChange={setBillingSmsOptIn}
                aria-label="Toggle billing texts"
              />
            </div>

            <div className="flex items-start justify-between gap-4 py-2 pl-4 border-l-2 border-border/60 ml-1">
              <div className="flex-1">
                <p className="font-medium text-sm">Coaching reminders</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Texts reminding you about upcoming coaching calls. Turn this
                  off to silence reminder texts while keeping your other SMS
                  alerts. You'll always get the email.
                </p>
              </div>
              <Switch
                checked={smsOptIn && coachingSmsOptIn}
                disabled={!smsOptIn}
                onCheckedChange={setCoachingSmsOptIn}
                aria-label="Toggle coaching reminder texts"
              />
            </div>

            <div className="flex items-start justify-between gap-4 py-2 pl-4 border-l-2 border-border/60 ml-1">
              <div className="flex-1">
                <p className="font-medium text-sm">New content alerts</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Texts when new training or content drops. Off by default —
                  turn this on to get a text when there's something new.
                  You'll always get the email.
                </p>
              </div>
              <Switch
                checked={smsOptIn && contentSmsOptIn}
                disabled={!smsOptIn}
                onCheckedChange={setContentSmsOptIn}
                aria-label="Toggle new content alert texts"
              />
            </div>

            <div className="flex items-start justify-between gap-4 py-2 border-t border-border/60">
              <div className="flex-1">
                <p className="font-medium text-sm">Marketing emails</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Promotions, product launches, and recommended training. Account and
                  transactional emails are always sent.
                </p>
              </div>
              <Switch
                checked={marketingOptIn}
                onCheckedChange={setMarketingOptIn}
                aria-label="Toggle marketing emails"
              />
            </div>

            {notifError && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-md text-red-700 text-sm">
                {notifError}
              </div>
            )}

            <div className="flex justify-end">
              <Button onClick={handleNotificationsSave} disabled={!notifDirty || notifSaving}>
                {notifSaving ? "Saving..." : "Save preferences"}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      <Dialog open={emailDialogOpen} onOpenChange={setEmailDialogOpen}>
        <DialogContent data-testid="dialog-update-email">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Mail className="w-5 h-5" />
              Update email address
            </DialogTitle>
            <DialogDescription>
              We'll send a verification link to your new address. Your email won't change until you click that link.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div>
              <Label htmlFor="email-current-password">Current password</Label>
              <Input
                id="email-current-password"
                type="password"
                value={emailCurrentPassword}
                onChange={(e) => setEmailCurrentPassword(e.target.value)}
                className="mt-1.5"
                autoComplete="current-password"
                data-testid="input-email-current-password"
              />
            </div>
            <div>
              <Label htmlFor="email-new">New email address</Label>
              <Input
                id="email-new"
                type="email"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                className="mt-1.5"
                autoComplete="email"
                placeholder="you@example.com"
                data-testid="input-new-email"
              />
            </div>

            {emailError && (
              <div
                className="p-3 bg-red-50 border border-red-200 rounded-md text-red-700 text-sm"
                data-testid="text-email-error"
              >
                {emailError}
              </div>
            )}

            <p className="text-xs text-muted-foreground">
              We'll also notify your current email address that this change was requested.
            </p>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setEmailDialogOpen(false)}
              disabled={emailSaving}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleRequestEmailChange}
              disabled={emailSaving}
              data-testid="button-send-email-verification"
            >
              {emailSaving ? "Sending..." : "Send verification link"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
