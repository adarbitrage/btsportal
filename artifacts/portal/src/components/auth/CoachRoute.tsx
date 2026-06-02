import type React from "react";
import { Redirect } from "wouter";
import { useGetCurrentMember } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { resolveAdminRole } from "@/components/layout/sidebar-nav";

export interface CoachRouteProps {
  component: React.ComponentType<any>;
}

export function CoachRoute({ component: Component }: CoachRouteProps) {
  const { user, loading } = useAuth();
  const { data: member, isLoading: memberLoading } = useGetCurrentMember();

  if (loading || memberLoading) {
    return (
      <div style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#faf9f7",
        fontFamily: "Roboto, sans-serif",
      }}>
        <div style={{ textAlign: "center" }}>
          <div style={{
            width: 40,
            height: 40,
            border: "3px solid #e8e4dc",
            borderTop: "3px solid #1a56db",
            borderRadius: "50%",
            animation: "spin 1s linear infinite",
            margin: "0 auto 16px",
          }} />
          <p style={{ color: "#6b7280", fontSize: 14 }}>Loading...</p>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      </div>
    );
  }

  if (!user) {
    return <Redirect to="/login" />;
  }

  const memberRole = (member as { role?: string } | undefined)?.role;
  const { userRole, isAdminUser } = resolveAdminRole(user.role, memberRole);

  const isCoach = userRole === "coach" || memberRole === "coach" || user.role === "coach";
  const isAdminWithCoachingView = isAdminUser && hasPermission(userRole, "coaching:view");

  if (!isCoach && !isAdminWithCoachingView) {
    return <Redirect to="/" />;
  }

  return <Component />;
}

export default CoachRoute;
