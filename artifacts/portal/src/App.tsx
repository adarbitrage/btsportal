import { Switch, Route, Router as WouterRouter, Redirect, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/lib/auth";

import { useGetCurrentMember } from "@workspace/api-client-react";
import Dashboard from "@/pages/Dashboard";
import Training from "@/pages/Training";
import ModuleDetail from "@/pages/ModuleDetail";
import LessonView from "@/pages/LessonView";
import Coaching from "@/pages/Coaching";
import Support from "@/pages/Support";
import TicketDetail from "@/pages/TicketDetail";
import CommunityFeed from "@/pages/community/CommunityFeed";
import MemberDirectory from "@/pages/community/MemberDirectory";
import MemberProfile from "@/pages/community/MemberProfile";
import SatisfactionSurveyPage from "@/pages/SatisfactionSurveyPage";
import Chat from "@/pages/Chat";
import Tools from "@/pages/Tools";
import ToolDetail from "@/pages/ToolDetail";
import Resources from "@/pages/Resources";
import CollectionDetail from "@/pages/CollectionDetail";
import ResourceDetail from "@/pages/ResourceDetail";
import Login from "@/pages/Login";
import Register from "@/pages/Register";
import ForgotPassword from "@/pages/ForgotPassword";
import NotFound from "@/pages/not-found";
import GhlDashboard from "@/pages/admin/GhlDashboard";
import GhlContacts from "@/pages/admin/GhlContacts";
import GhlConfig from "@/pages/admin/GhlConfig";
import AdminApiKeys from "@/pages/AdminApiKeys";
import CommissionsDashboard from "@/pages/commissions/CommissionsDashboard";
import CommissionsResources from "@/pages/commissions/CommissionsResources";
import CommissionsRates from "@/pages/commissions/CommissionsRates";
import ChatAnalytics from "@/pages/admin/ChatAnalytics";
import ChatTranscripts from "@/pages/admin/ChatTranscripts";
import SystemPrompts from "@/pages/admin/SystemPrompts";
import Knowledgebase from "@/pages/admin/Knowledgebase";
import RateLimits from "@/pages/admin/RateLimits";
import WinsWall from "@/pages/wins/WinsWall";
import WinSubmit from "@/pages/wins/WinSubmit";
import MyWins from "@/pages/wins/MyWins";
import WinDetail from "@/pages/wins/WinDetail";
import TestimonialSubmit from "@/pages/wins/TestimonialSubmit";
import OnboardingWelcome from "@/pages/onboarding/Welcome";
import OnboardingDocuments from "@/pages/onboarding/Documents";
import OnboardingProfile from "@/pages/onboarding/Profile";
import OnboardingOrientation from "@/pages/onboarding/Orientation";
import OnboardingQuickStart from "@/pages/onboarding/QuickStart";
import { ChatWidget } from "@/components/chat/ChatWidget";
import AdminTicketQueue from "@/pages/admin/AdminTicketQueue";
import AdminTicketDetail from "@/pages/admin/AdminTicketDetail";
import RoutingRules from "@/pages/admin/RoutingRules";
import CannedResponses from "@/pages/admin/CannedResponses";
import AgentPerformance from "@/pages/admin/AgentPerformance";
import SupportAnalytics from "@/pages/admin/SupportAnalytics";
import CommunityCategories from "@/pages/admin/CommunityCategories";
import CommunityModeration from "@/pages/admin/CommunityModeration";
import CommunityAnalytics from "@/pages/admin/CommunityAnalytics";
import ContentTracks from "@/pages/admin/ContentTracks";
import LessonEditor from "@/pages/admin/LessonEditor";
import CommissionOverview from "@/pages/admin/CommissionOverview";
import CommissionAll from "@/pages/admin/CommissionAll";
import CommissionPayouts from "@/pages/admin/CommissionPayouts";
import CommissionAffiliates from "@/pages/admin/CommissionAffiliates";
import CommissionRates from "@/pages/admin/CommissionRates";
import CommissionResources from "@/pages/admin/CommissionResources";
import CommissionFraudAlerts from "@/pages/admin/CommissionFraudAlerts";
import VaultResources from "@/pages/admin/VaultResources";
import VaultResourceEditor from "@/pages/admin/VaultResourceEditor";
import VaultCollections from "@/pages/admin/VaultCollections";
import VaultAnalytics from "@/pages/admin/VaultAnalytics";
import AdminWins from "@/pages/admin/AdminWins";
import OneOnOneCoaching from "@/pages/coaching/OneOnOneCoaching";
import BookCoaching from "@/pages/coaching/BookCoaching";
import CoachingSessionDetail from "@/pages/coaching/CoachingSessionDetail";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
    },
  },
});

const STEP_ROUTES = [
  "/onboarding/welcome",
  "/onboarding/documents",
  "/onboarding/profile",
  "/onboarding/orientation",
  "/onboarding/quick-start",
];

function ProtectedRoute({ component: Component }: { component: React.ComponentType<any> }) {
  const { user, loading } = useAuth();
  const [, navigate] = useLocation();

  if (loading) {
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

  if (!user.onboardingComplete) {
    const stepRoute = STEP_ROUTES[(user.onboardingStep || 1) - 1] || STEP_ROUTES[0];
    return <Redirect to={stepRoute} />;
  }

  return <Component />;
}

function EntitlementRoute({ component: Component, entitlement }: { component: React.ComponentType<any>; entitlement: string }) {
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

  if (!user.onboardingComplete) {
    const stepRoute = STEP_ROUTES[(user.onboardingStep || 1) - 1] || STEP_ROUTES[0];
    return <Redirect to={stepRoute} />;
  }

  const entitlements = new Set(member?.entitlements ?? []);
  const hasEntitlement = entitlement.endsWith(":*")
    ? Array.from(entitlements).some((e: string) => e.startsWith(entitlement.replace(":*", ":")))
    : entitlements.has(entitlement);
  if (!hasEntitlement) {
    return <Redirect to="/" />;
  }

  return <Component />;
}

function OnboardingRoute({ component: Component, step }: { component: React.ComponentType<any>; step: number }) {
  const { user, loading } = useAuth();

  if (loading) {
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

  if (user.onboardingComplete) {
    return <Redirect to="/" />;
  }

  if (step > user.onboardingStep) {
    const currentRoute = STEP_ROUTES[(user.onboardingStep || 1) - 1] || STEP_ROUTES[0];
    return <Redirect to={currentRoute} />;
  }

  return <Component />;
}

function AdminRoute({ component: Component }: { component: React.ComponentType<any> }) {
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

  if ((member as any)?.role !== "admin") {
    return <Redirect to="/" />;
  }

  return <Component />;
}

function GuestRoute({ component: Component }: { component: React.ComponentType<any> }) {
  const { user, loading } = useAuth();

  if (loading) return null;

  if (user) {
    if (!user.onboardingComplete) {
      const stepRoute = STEP_ROUTES[(user.onboardingStep || 1) - 1] || STEP_ROUTES[0];
      return <Redirect to={stepRoute} />;
    }
    return <Redirect to="/" />;
  }

  return <Component />;
}

function Router() {
  return (
    <Switch>
      <Route path="/login">{() => <GuestRoute component={Login} />}</Route>
      <Route path="/register">{() => <GuestRoute component={Register} />}</Route>
      <Route path="/forgot-password">{() => <GuestRoute component={ForgotPassword} />}</Route>
      <Route path="/onboarding/welcome">{() => <OnboardingRoute component={OnboardingWelcome} step={1} />}</Route>
      <Route path="/onboarding/documents">{() => <OnboardingRoute component={OnboardingDocuments} step={2} />}</Route>
      <Route path="/onboarding/profile">{() => <OnboardingRoute component={OnboardingProfile} step={3} />}</Route>
      <Route path="/onboarding/orientation">{() => <OnboardingRoute component={OnboardingOrientation} step={4} />}</Route>
      <Route path="/onboarding/quick-start">{() => <OnboardingRoute component={OnboardingQuickStart} step={5} />}</Route>
      <Route path="/">{() => <ProtectedRoute component={Dashboard} />}</Route>
      <Route path="/training">{() => <ProtectedRoute component={Training} />}</Route>
      <Route path="/training/modules/:id">{() => <ProtectedRoute component={ModuleDetail} />}</Route>
      <Route path="/training/lessons/:id">{() => <ProtectedRoute component={LessonView} />}</Route>
      <Route path="/admin/content/tracks">{() => <AdminRoute component={ContentTracks} />}</Route>
      <Route path="/admin/content/lessons/:id/edit">{() => <AdminRoute component={LessonEditor} />}</Route>
      <Route path="/community">{() => <EntitlementRoute component={CommunityFeed} entitlement="community:access" />}</Route>
      <Route path="/community/members">{() => <EntitlementRoute component={MemberDirectory} entitlement="community:access" />}</Route>
      <Route path="/community/members/:userId">{() => <EntitlementRoute component={MemberProfile} entitlement="community:access" />}</Route>
      <Route path="/commissions">{() => <EntitlementRoute component={CommissionsDashboard} entitlement="commissions:*" />}</Route>
      <Route path="/commissions/resources">{() => <EntitlementRoute component={CommissionsResources} entitlement="commissions:*" />}</Route>
      <Route path="/commissions/rates">{() => <EntitlementRoute component={CommissionsRates} entitlement="commissions:*" />}</Route>
      <Route path="/wins">{() => <ProtectedRoute component={WinsWall} />}</Route>
      <Route path="/wins/submit">{() => <ProtectedRoute component={WinSubmit} />}</Route>
      <Route path="/wins/mine">{() => <ProtectedRoute component={MyWins} />}</Route>
      <Route path="/wins/:id/testimonial">{() => <ProtectedRoute component={TestimonialSubmit} />}</Route>
      <Route path="/wins/:id">{() => <ProtectedRoute component={WinDetail} />}</Route>
      <Route path="/coaching/one-on-one/book">{() => <EntitlementRoute component={BookCoaching} entitlement="coaching:one_on_one:*" />}</Route>
      <Route path="/coaching/one-on-one/sessions/:id">{() => <EntitlementRoute component={CoachingSessionDetail} entitlement="coaching:one_on_one:*" />}</Route>
      <Route path="/coaching/one-on-one">{() => <EntitlementRoute component={OneOnOneCoaching} entitlement="coaching:one_on_one:*" />}</Route>
      <Route path="/coaching">{() => <ProtectedRoute component={Coaching} />}</Route>
      <Route path="/support">{() => <ProtectedRoute component={Support} />}</Route>
      <Route path="/support/tickets/:id">{() => <ProtectedRoute component={TicketDetail} />}</Route>
      <Route path="/support/tickets/:id/rate">{() => <ProtectedRoute component={SatisfactionSurveyPage} />}</Route>
      <Route path="/admin/ghl">{() => <AdminRoute component={GhlDashboard} />}</Route>
      <Route path="/admin/ghl/contacts">{() => <AdminRoute component={GhlContacts} />}</Route>
      <Route path="/admin/ghl/config">{() => <AdminRoute component={GhlConfig} />}</Route>
      <Route path="/chat">{() => <ProtectedRoute component={Chat} />}</Route>
      <Route path="/resources/:collectionSlug/:resourceId">{() => <ProtectedRoute component={ResourceDetail} />}</Route>
      <Route path="/resources/:collectionSlug">{() => <ProtectedRoute component={CollectionDetail} />}</Route>
      <Route path="/resources">{() => <ProtectedRoute component={Resources} />}</Route>
      <Route path="/admin/tickets">{() => <AdminRoute component={AdminTicketQueue} />}</Route>
      <Route path="/admin/tickets/:id">{() => <AdminRoute component={AdminTicketDetail} />}</Route>
      <Route path="/admin/routing-rules">{() => <AdminRoute component={RoutingRules} />}</Route>
      <Route path="/admin/canned-responses">{() => <AdminRoute component={CannedResponses} />}</Route>
      <Route path="/admin/agent-performance">{() => <AdminRoute component={AgentPerformance} />}</Route>
      <Route path="/admin/analytics">{() => <AdminRoute component={SupportAnalytics} />}</Route>
      <Route path="/settings/api-keys">{() => <AdminRoute component={AdminApiKeys} />}</Route>
      <Route path="/admin/community/categories">{() => <AdminRoute component={CommunityCategories} />}</Route>
      <Route path="/admin/community/moderation">{() => <AdminRoute component={CommunityModeration} />}</Route>
      <Route path="/admin/community/analytics">{() => <AdminRoute component={CommunityAnalytics} />}</Route>
      <Route path="/admin/resources">{() => <AdminRoute component={VaultResources} />}</Route>
      <Route path="/admin/resources/new">{() => <AdminRoute component={VaultResourceEditor} />}</Route>
      <Route path="/admin/resources/:id/edit">{() => <AdminRoute component={VaultResourceEditor} />}</Route>
      <Route path="/admin/collections">{() => <AdminRoute component={VaultCollections} />}</Route>
      <Route path="/admin/vault/analytics">{() => <AdminRoute component={VaultAnalytics} />}</Route>
      <Route path="/admin/wins">{() => <AdminRoute component={AdminWins} />}</Route>
      <Route path="/tools">{() => <ProtectedRoute component={Tools} />}</Route>
      <Route path="/tools/:slug">{() => <ProtectedRoute component={ToolDetail} />}</Route>
      <Route path="/admin/commissions">{() => <AdminRoute component={CommissionOverview} />}</Route>
      <Route path="/admin/commissions/all">{() => <AdminRoute component={CommissionAll} />}</Route>
      <Route path="/admin/commissions/payouts">{() => <AdminRoute component={CommissionPayouts} />}</Route>
      <Route path="/admin/commissions/affiliates">{() => <AdminRoute component={CommissionAffiliates} />}</Route>
      <Route path="/admin/commissions/rates">{() => <AdminRoute component={CommissionRates} />}</Route>
      <Route path="/admin/commissions/resources">{() => <AdminRoute component={CommissionResources} />}</Route>
      <Route path="/admin/commissions/fraud">{() => <AdminRoute component={CommissionFraudAlerts} />}</Route>
      <Route path="/admin/chat/analytics">{() => <AdminRoute component={ChatAnalytics} />}</Route>
      <Route path="/admin/chat/transcripts">{() => <AdminRoute component={ChatTranscripts} />}</Route>
      <Route path="/admin/chat/prompts">{() => <AdminRoute component={SystemPrompts} />}</Route>
      <Route path="/admin/chat/knowledgebase">{() => <AdminRoute component={Knowledgebase} />}</Route>
      <Route path="/admin/chat/rate-limits">{() => <AdminRoute component={RateLimits} />}</Route>
      <Route component={NotFound} />
    </Switch>
  );
}

function AuthenticatedChatWidget() {
  const { user, loading } = useAuth();
  const [location] = useLocation();
  if (loading || !user || !user.onboardingComplete) return null;
  if (location === "/chat") return null;
  return <ChatWidget />;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AuthProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <Router />
            <AuthenticatedChatWidget />
          </WouterRouter>
          <Toaster />
        </AuthProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
