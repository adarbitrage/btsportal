import { Link } from "wouter";
import { ShieldAlert } from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";

interface AccessDeniedProps {
  permission?: string;
}

export default function AccessDenied({ permission }: AccessDeniedProps) {
  return (
    <AppLayout>
      <div
        className="flex flex-col items-center justify-center min-h-[60vh] text-center"
        data-testid="access-denied"
      >
        <div className="rounded-full bg-amber-100 p-4 mb-6">
          <ShieldAlert className="h-10 w-10 text-amber-600" />
        </div>
        <h1 className="text-3xl font-semibold text-foreground mb-2">
          You don't have access to this page
        </h1>
        <p className="text-muted-foreground mb-2 max-w-md">
          Your admin role doesn't include permission to view this section. If you
          think this is a mistake, ask a super admin to update your role.
        </p>
        {permission ? (
          <p
            className="text-xs text-muted-foreground/70 mb-8 font-mono"
            data-testid="access-denied-permission"
          >
            Required permission: {permission}
          </p>
        ) : (
          <div className="mb-8" />
        )}
        <div className="flex gap-3">
          <Link href="/admin/dashboard">
            <Button size="lg" variant="outline" data-testid="button-admin-home">
              Go to admin dashboard
            </Button>
          </Link>
          <Link href="/">
            <Button size="lg" data-testid="button-portal-home">
              Back to portal
            </Button>
          </Link>
        </div>
      </div>
    </AppLayout>
  );
}
