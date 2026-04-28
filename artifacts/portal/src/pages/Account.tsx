import { useState, useEffect } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { User, Lock, Bell } from "lucide-react";
import {
  useGetCurrentMember,
  usePatchMemberProfile,
  useChangeMemberPassword,
} from "@workspace/api-client-react";

export default function Account() {
  const { toast } = useToast();
  const { data: member, isLoading, refetch } = useGetCurrentMember();
  const patchProfile = usePatchMemberProfile();
  const changePassword = useChangeMemberPassword();

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [timezone, setTimezone] = useState("");
  const [smsOptIn, setSmsOptIn] = useState(false);
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

  useEffect(() => {
    if (member) {
      setName(member.name || "");
      setPhone(member.phone || "");
      setTimezone(
        member.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
      );
      setSmsOptIn(member.smsOptIn ?? false);
      setMarketingOptIn(member.marketingOptIn ?? true);
    }
  }, [member]);

  const profileDirty =
    !!member &&
    (name.trim() !== (member.name || "") ||
      (phone.trim() || null) !== (member.phone || null) ||
      (timezone || null) !== (member.timezone || null));

  const notifDirty =
    !!member &&
    (smsOptIn !== (member.smsOptIn ?? false) ||
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
        description: res?.message || "Your password has been changed.",
      });
    } catch (err: any) {
      setPasswordError(err?.message || "Failed to change password.");
    } finally {
      setPasswordSaving(false);
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
      <div className="space-y-8">
        <div>
          <h1 className="text-3xl font-bold text-foreground tracking-tight">Account</h1>
          <p className="text-muted-foreground mt-1">
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
                <Input
                  id="account-email"
                  type="email"
                  value={member.email}
                  disabled
                  className="mt-1.5 bg-muted"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Contact support to change your email address.
                </p>
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
    </AppLayout>
  );
}
