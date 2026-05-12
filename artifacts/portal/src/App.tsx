import { Switch, Route, Router as WouterRouter, Redirect, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/lib/auth";

import { useGetCurrentMember } from "@workspace/api-client-react";
import Dashboard from "@/pages/Dashboard";
import Home from "@/pages/Home";
import CoreTraining from "@/pages/CoreTraining";
import QuickStartGuide from "@/pages/QuickStartGuide";
import SevenPillars from "@/pages/SevenPillars";
import DirectEdge from "@/pages/DirectEdge";
import TipsAndTricks from "@/pages/TipsAndTricks";
import Concierge from "@/pages/Concierge";
import CoachingSession from "@/pages/CoachingSession";
import Advantage from "@/pages/Advantage";
import ComplianceReview from "@/pages/ComplianceReview";
import PrimeCorporate from "@/pages/PrimeCorporate";
import AdCredit from "@/pages/AdCredit";
import CoachingRecruitment from "@/pages/CoachingRecruitment";
import SelfPromoting from "@/pages/SelfPromoting";
import AiAssistant from "@/pages/AiAssistant";
import Blitz from "@/pages/Blitz";
import BlitzHub from "@/pages/BlitzHub";
import AgreementPreview from "@/pages/AgreementPreview";
import Training from "@/pages/Training";
import ModuleDetail from "@/pages/ModuleDetail";
import LessonView from "@/pages/LessonView";
import Coaching from "@/pages/Coaching";
import Support from "@/pages/Support";
import GeneralSupport from "@/pages/GeneralSupport";
import TicketDetail from "@/pages/TicketDetail";
import CommunityFeed from "@/pages/community/CommunityFeed";
import MemberDirectory from "@/pages/community/MemberDirectory";
import MemberProfile from "@/pages/community/MemberProfile";
import SatisfactionSurveyPage from "@/pages/SatisfactionSurveyPage";
import Tools from "@/pages/Tools";
import ToolDetail from "@/pages/ToolDetail";
import Apps from "@/pages/Apps";
import Resources from "@/pages/Resources";
import AffiliateNetworks from "@/pages/AffiliateNetworks";
import CollectionDetail from "@/pages/CollectionDetail";
import ResourceDetail from "@/pages/ResourceDetail";
import Login from "@/pages/Login";
import Register from "@/pages/Register";
import ForgotPassword from "@/pages/ForgotPassword";
import VerifyEmail from "@/pages/VerifyEmail";
import VerifyEmailChange from "@/pages/VerifyEmailChange";
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
import KnowledgeBaseReview from "@/pages/admin/KnowledgeBaseReview";
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
import CoachingCoaches from "@/pages/admin/CoachingCoaches";
import CoachingAvailability from "@/pages/admin/CoachingAvailability";
import CoachingOverrides from "@/pages/admin/CoachingOverrides";
import CoachingSessions from "@/pages/admin/CoachingSessions";
import CoachingNotes from "@/pages/admin/CoachingNotes";
import CoachingAnalytics from "@/pages/admin/CoachingAnalytics";
import CommunicationsTemplates from "@/pages/admin/CommunicationsTemplates";
import CommunicationsSmsTemplates from "@/pages/admin/CommunicationsSmsTemplates";
import CommunicationsSequences from "@/pages/admin/CommunicationsSequences";
import CommunicationsBroadcasts from "@/pages/admin/CommunicationsBroadcasts";
import CommunicationsLog from "@/pages/admin/CommunicationsLog";
import CommunicationsAnalytics from "@/pages/admin/CommunicationsAnalytics";
import ToolManagement from "@/pages/admin/ToolManagement";
import ToolAnalytics from "@/pages/admin/ToolAnalytics";
import ToolUsageDetail from "@/pages/admin/ToolUsageDetail";
import AdminDashboard from "@/pages/admin/AdminDashboard";
import AuditLog from "@/pages/admin/AuditLog";
import AdminMembers from "@/pages/admin/AdminMembers";
import MemberDetail from "@/pages/admin/MemberDetail";
import SystemHealth from "@/pages/admin/SystemHealth";
import AdminSettings from "@/pages/admin/AdminSettings";
import RevenueDashboard from "@/pages/admin/RevenueDashboard";
import CohortAnalysis from "@/pages/admin/CohortAnalysis";
import AtRiskMembers from "@/pages/admin/AtRiskMembers";
import UpgradeOpportunities from "@/pages/admin/UpgradeOpportunities";
import FunnelPerformance from "@/pages/admin/FunnelPerformance";
import UpgradePromptAnalytics from "@/pages/admin/UpgradePromptAnalytics";
import LtvAnalysis from "@/pages/admin/LtvAnalysis";
import RevenueForecast from "@/pages/admin/RevenueForecast";
import AppsManager from "@/pages/admin/AppsManager";
import Account from "@/pages/Account";
import Plans from "@/pages/Plans";
import { AdminRoute } from "@/components/auth/AdminRoute";

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
      <Route path="/verify-email">{() => <VerifyEmail />}</Route>
      <Route path="/verify-email-change">{() => <VerifyEmailChange />}</Route>
      <Route path="/onboarding/welcome">{() => <OnboardingRoute component={OnboardingWelcome} step={1} />}</Route>
      <Route path="/onboarding/documents">{() => <OnboardingRoute component={OnboardingDocuments} step={2} />}</Route>
      <Route path="/onboarding/profile">{() => <OnboardingRoute component={OnboardingProfile} step={3} />}</Route>
      <Route path="/onboarding/orientation">{() => <OnboardingRoute component={OnboardingOrientation} step={4} />}</Route>
      <Route path="/onboarding/quick-start">{() => <OnboardingRoute component={OnboardingQuickStart} step={5} />}</Route>
      <Route path="/">{() => <ProtectedRoute component={Home} />}</Route>
      <Route path="/dashboard">{() => <ProtectedRoute component={Dashboard} />}</Route>
      <Route path="/core-training">{() => <ProtectedRoute component={CoreTraining} />}</Route>
      <Route path="/core-training/quick-start">{() => <ProtectedRoute component={QuickStartGuide} />}</Route>
      <Route path="/core-training/7-pillars">{() => <ProtectedRoute component={SevenPillars} />}</Route>
      <Route path="/core-training/direct-edge">{() => <ProtectedRoute component={DirectEdge} />}</Route>
      <Route path="/tips-and-tricks">{() => <ProtectedRoute component={TipsAndTricks} />}</Route>
      <Route path="/concierge">{() => <ProtectedRoute component={Concierge} />}</Route>
      <Route path="/coaching/sessions">{() => <ProtectedRoute component={CoachingSession} />}</Route>
      <Route path="/advantage">{() => <ProtectedRoute component={Advantage} />}</Route>
      <Route path="/compliance">{() => <ProtectedRoute component={ComplianceReview} />}</Route>
      <Route path="/prime-corporate">{() => <ProtectedRoute component={PrimeCorporate} />}</Route>
      <Route path="/ad-credit">{() => <ProtectedRoute component={AdCredit} />}</Route>
      <Route path="/coaching/recruitment">{() => <ProtectedRoute component={CoachingRecruitment} />}</Route>
      <Route path="/self-promoting">{() => <ProtectedRoute component={SelfPromoting} />}</Route>
      <Route path="/ai-assistant">{() => <ProtectedRoute component={AiAssistant} />}</Route>
      <Route path="/blitz">{() => <ProtectedRoute component={BlitzHub} />}</Route>
      <Route path="/blitz/guide">{() => <ProtectedRoute component={Blitz} />}</Route>
      <Route path="/blitz/guide/:lessonId">{() => <ProtectedRoute component={Blitz} />}</Route>
      <Route path="/agreement-preview">{() => <ProtectedRoute component={AgreementPreview} />}</Route>
      <Route path="/training">{() => <ProtectedRoute component={Training} />}</Route>
      <Route path="/training/modules/:id">{() => <ProtectedRoute component={ModuleDetail} />}</Route>
      <Route path="/training/lessons/:id">{() => <ProtectedRoute component={LessonView} />}</Route>
      <Route path="/admin/content/tracks">{() => <AdminRoute component={ContentTracks} permission="content:manage" />}</Route>
      <Route path="/admin/content/lessons/:id/edit">{() => <AdminRoute component={LessonEditor} permission="content:manage" />}</Route>
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
      <Route path="/account">{() => <ProtectedRoute component={Account} />}</Route>
      <Route path="/plans">{() => <ProtectedRoute component={Plans} />}</Route>
      <Route path="/support">{() => <ProtectedRoute component={Support} />}</Route>
      <Route path="/support/contact">{() => <ProtectedRoute component={GeneralSupport} />}</Route>
      <Route path="/support/tickets/:id">{() => <ProtectedRoute component={TicketDetail} />}</Route>
      <Route path="/support/tickets/:id/rate">{() => <ProtectedRoute component={SatisfactionSurveyPage} />}</Route>
      <Route path="/admin/ghl">{() => <AdminRoute component={GhlDashboard} permission="ghl:view" />}</Route>
      <Route path="/admin/ghl/contacts">{() => <AdminRoute component={GhlContacts} permission="ghl:view" />}</Route>
      <Route path="/admin/ghl/config">{() => <AdminRoute component={GhlConfig} permission="ghl:manage" />}</Route>
      <Route path="/chat">{() => <Redirect to="/ai-assistant" />}</Route>
      <Route path="/resources/:collectionSlug/:resourceId">{() => <ProtectedRoute component={ResourceDetail} />}</Route>
      <Route path="/resources/:collectionSlug">{() => <ProtectedRoute component={CollectionDetail} />}</Route>
      <Route path="/resources">{() => <ProtectedRoute component={Resources} />}</Route>
      <Route path="/affiliate-networks">{() => <ProtectedRoute component={AffiliateNetworks} />}</Route>
      <Route path="/admin/tickets">{() => <AdminRoute component={AdminTicketQueue} permission="tickets:view" />}</Route>
      <Route path="/admin/tickets/:id">{() => <AdminRoute component={AdminTicketDetail} permission="tickets:view" />}</Route>
      <Route path="/admin/routing-rules">{() => <AdminRoute component={RoutingRules} permission="tickets:manage" />}</Route>
      <Route path="/admin/canned-responses">{() => <AdminRoute component={CannedResponses} permission="tickets:manage" />}</Route>
      <Route path="/admin/agent-performance">{() => <AdminRoute component={AgentPerformance} permission="tickets:view" />}</Route>
      <Route path="/admin/analytics">{() => <AdminRoute component={SupportAnalytics} permission="tickets:view" />}</Route>
      <Route path="/settings/api-keys">{() => <AdminRoute component={AdminApiKeys} permission="api_keys:view" />}</Route>
      <Route path="/admin/community/categories">{() => <AdminRoute component={CommunityCategories} permission="community:moderate" />}</Route>
      <Route path="/admin/community/moderation">{() => <AdminRoute component={CommunityModeration} permission="community:moderate" />}</Route>
      <Route path="/admin/community/analytics">{() => <AdminRoute component={CommunityAnalytics} permission="community:view" />}</Route>
      <Route path="/admin/resources">{() => <AdminRoute component={VaultResources} permission="vault:view" />}</Route>
      <Route path="/admin/resources/new">{() => <AdminRoute component={VaultResourceEditor} permission="vault:manage" />}</Route>
      <Route path="/admin/resources/:id/edit">{() => <AdminRoute component={VaultResourceEditor} permission="vault:manage" />}</Route>
      <Route path="/admin/collections">{() => <AdminRoute component={VaultCollections} permission="vault:manage" />}</Route>
      <Route path="/admin/vault/analytics">{() => <AdminRoute component={VaultAnalytics} permission="vault:view" />}</Route>
      <Route path="/admin/wins">{() => <AdminRoute component={AdminWins} permission="wins:manage" />}</Route>
      <Route path="/tools">{() => <ProtectedRoute component={Tools} />}</Route>
      <Route path="/tools/:slug">{() => <ProtectedRoute component={ToolDetail} />}</Route>
      <Route path="/apps">{() => <ProtectedRoute component={Apps} />}</Route>
      <Route path="/admin/commissions">{() => <AdminRoute component={CommissionOverview} permission="commissions:view" />}</Route>
      <Route path="/admin/commissions/all">{() => <AdminRoute component={CommissionAll} permission="commissions:view" />}</Route>
      <Route path="/admin/commissions/payouts">{() => <AdminRoute component={CommissionPayouts} permission="commissions:manage" />}</Route>
      <Route path="/admin/commissions/affiliates">{() => <AdminRoute component={CommissionAffiliates} permission="commissions:view" />}</Route>
      <Route path="/admin/commissions/rates">{() => <AdminRoute component={CommissionRates} permission="commissions:manage" />}</Route>
      <Route path="/admin/commissions/resources">{() => <AdminRoute component={CommissionResources} permission="commissions:manage" />}</Route>
      <Route path="/admin/commissions/fraud">{() => <AdminRoute component={CommissionFraudAlerts} permission="commissions:view" />}</Route>
      <Route path="/admin/chat/analytics">{() => <AdminRoute component={ChatAnalytics} permission="chat:view" />}</Route>
      <Route path="/admin/chat/transcripts">{() => <AdminRoute component={ChatTranscripts} permission="chat:view" />}</Route>
      <Route path="/admin/chat/prompts">{() => <AdminRoute component={SystemPrompts} permission="chat:manage" />}</Route>
      <Route path="/admin/chat/knowledgebase/review">{() => <AdminRoute component={KnowledgeBaseReview} permission="chat:manage" />}</Route>
      <Route path="/admin/chat/knowledgebase">{() => <AdminRoute component={Knowledgebase} permission="chat:manage" />}</Route>
      <Route path="/admin/chat/rate-limits">{() => <AdminRoute component={RateLimits} permission="chat:manage" />}</Route>
      <Route path="/admin/coaching">{() => <AdminRoute component={CoachingCoaches} permission="coaching:view" />}</Route>
      <Route path="/admin/coaching/availability">{() => <AdminRoute component={CoachingAvailability} permission="coaching:manage" />}</Route>
      <Route path="/admin/coaching/overrides">{() => <AdminRoute component={CoachingOverrides} permission="coaching:manage" />}</Route>
      <Route path="/admin/coaching/sessions">{() => <AdminRoute component={CoachingSessions} permission="coaching:view" />}</Route>
      <Route path="/admin/coaching/notes">{() => <AdminRoute component={CoachingNotes} permission="coaching:view" />}</Route>
      <Route path="/admin/coaching/analytics">{() => <AdminRoute component={CoachingAnalytics} permission="coaching:view" />}</Route>
      <Route path="/admin/communications/templates">{() => <AdminRoute component={CommunicationsTemplates} permission="communications:manage" />}</Route>
      <Route path="/admin/communications/sms-templates">{() => <AdminRoute component={CommunicationsSmsTemplates} permission="communications:manage" />}</Route>
      <Route path="/admin/communications/sequences">{() => <AdminRoute component={CommunicationsSequences} permission="communications:manage" />}</Route>
      <Route path="/admin/communications/broadcasts">{() => <AdminRoute component={CommunicationsBroadcasts} permission="communications:manage" />}</Route>
      <Route path="/admin/communications/log">{() => <AdminRoute component={CommunicationsLog} permission="communications:view" />}</Route>
      <Route path="/admin/communications/analytics">{() => <AdminRoute component={CommunicationsAnalytics} permission="communications:view" />}</Route>
      <Route path="/admin/tools">{() => <AdminRoute component={ToolManagement} permission="apps:manage" />}</Route>
      <Route path="/admin/tools/analytics">{() => <AdminRoute component={ToolAnalytics} permission="apps:manage" />}</Route>
      <Route path="/admin/tools/:id/usage">{() => <AdminRoute component={ToolUsageDetail} permission="apps:manage" />}</Route>
      <Route path="/admin/dashboard">{() => <AdminRoute component={AdminDashboard} permission="dashboard:view" />}</Route>
      <Route path="/admin/audit-log">{() => <AdminRoute component={AuditLog} permission="audit:view" />}</Route>
      <Route path="/admin/members/:id">{() => <AdminRoute component={MemberDetail} permission="members:view" />}</Route>
      <Route path="/admin/members">{() => <AdminRoute component={AdminMembers} permission="members:view" />}</Route>
      <Route path="/admin/system">{() => <AdminRoute component={SystemHealth} permission="system:view" />}</Route>
      <Route path="/admin/settings">{() => <AdminRoute component={AdminSettings} permission="settings:view" />}</Route>
      <Route path="/admin/revenue">{() => <AdminRoute component={RevenueDashboard} permission="revenue:view" />}</Route>
      <Route path="/admin/revenue/cohorts">{() => <AdminRoute component={CohortAnalysis} permission="revenue:view" />}</Route>
      <Route path="/admin/revenue/at-risk">{() => <AdminRoute component={AtRiskMembers} permission="revenue:view" />}</Route>
      <Route path="/admin/revenue/upgrade-opportunities">{() => <AdminRoute component={UpgradeOpportunities} permission="revenue:view" />}</Route>
      <Route path="/admin/revenue/funnels">{() => <AdminRoute component={FunnelPerformance} permission="revenue:view" />}</Route>
      <Route path="/admin/revenue/upgrade-prompts">{() => <AdminRoute component={UpgradePromptAnalytics} permission="revenue:view" />}</Route>
      <Route path="/admin/revenue/ltv">{() => <AdminRoute component={LtvAnalysis} permission="revenue:view" />}</Route>
      <Route path="/admin/revenue/forecast">{() => <AdminRoute component={RevenueForecast} permission="revenue:view" />}</Route>
      <Route path="/admin/apps-manager">{() => <AdminRoute component={AppsManager} permission="apps:manage" />}</Route>
      <Route component={NotFound} />
    </Switch>
  );
}

function AuthenticatedChatWidget() {
  const { user, loading } = useAuth();
  const [location] = useLocation();
  if (loading || !user || !user.onboardingComplete) return null;
  if (location === "/chat" || location === "/ai-assistant") return null;
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
