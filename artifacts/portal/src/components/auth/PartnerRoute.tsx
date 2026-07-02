import type React from "react";
import { Redirect } from "wouter";
import { isPartnerRole } from "@workspace/auth";
import { useGetCurrentMember } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { resolveAdminRole } from "@/components/layout/sidebar-nav";

export interface PartnerRouteProps {
  component: React.ComponentType<any>;
}

export function PartnerRoute({ component: Component }: PartnerRouteProps) {
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

  const isPartner = isPartnerRole(userRole) || isPartnerRole(memberRole) || isPartnerRole(user.role);
  const isAdminWithPartnersView = isAdminUser && hasPermission(userRole, "partners:view");

  if (!isPartner && !isAdminWithPartnersView) {
    return <Redirect to="/" />;
  }

  return <Component />;
}

export default PartnerRoute;
