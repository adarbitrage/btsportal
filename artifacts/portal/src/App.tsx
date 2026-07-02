import { useEffect, useState } from "react";
import { Switch, Route, Router as WouterRouter, Redirect, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/lib/auth";
import { isAdminRole, isCoachRole } from "@workspace/auth";

import { useGetCurrentMember } from "@workspace/api-client-react";
import Dashboard from "@/pages/Dashboard";
import Home from "@/pages/Home";
import CoreTraining from "@/pages/CoreTraining";
import QuickStartGuide from "@/pages/QuickStartGuide";
import SevenPillars from "@/pages/SevenPillars";
import PillarsToBlitz from "@/pages/PillarsToBlitz";
import DirectEdge from "@/pages/DirectEdge";
import TipsAndTricks from "@/pages/TipsAndTricks";
import Concierge from "@/pages/Concierge";
import ConciergeSubmit from "@/pages/ConciergeSubmit";
import BookVaCall from "@/pages/coaching/BookVaCall";
import VaCalls from "@/pages/coaching/VaCalls";
import CoachingSession from "@/pages/CoachingSession";
import Advantage from "@/pages/Advantage";
import ComplianceReview from "@/pages/ComplianceReview";
import ComplianceSubmit from "@/pages/ComplianceSubmit";
import PrimeCorporate from "@/pages/PrimeCorporate";
import AdCredit from "@/pages/AdCredit";
import CoachingRecruitment from "@/pages/CoachingRecruitment";
import SelfPromoting from "@/pages/SelfPromoting";
import AiAssistant from "@/pages/AiAssistant";
import VoiceAssistant from "@/pages/VoiceAssistant";
import Blitz from "@/pages/Blitz";
import BlitzHub from "@/pages/BlitzHub";
import BlitzArchive from "@/pages/BlitzArchive";
import BlitzHubArchive from "@/pages/BlitzHubArchive";
import VideoReview from "@/pages/VideoReview";
import Training from "@/pages/Training";
import ModuleDetail from "@/pages/ModuleDetail";
import LessonView from "@/pages/LessonView";
import Coaching from "@/pages/Coaching";
import CommunityFeed from "@/pages/community/CommunityFeed";
import DMInbox from "@/pages/dm/inbox";
import DMThread from "@/pages/dm/thread";
import MemberDirectory from "@/pages/community/MemberDirectory";
import MemberProfile from "@/pages/community/MemberProfile";
import PostDetail from "@/pages/community/PostDetail";
import Tools from "@/pages/Tools";
import ToolDetail from "@/pages/ToolDetail";
import Apps from "@/pages/Apps";
import PartnerTools from "@/pages/PartnerTools";
import Resources from "@/pages/Resources";
import ResourceLibrary from "@/pages/ResourceLibrary";
import KnowledgeBase from "@/pages/KnowledgeBase";
import AffiliateNetworks from "@/pages/AffiliateNetworks";
import AdminAffiliateNetworks from "@/pages/admin/AdminAffiliateNetworks";
import AdminMediaMavens from "@/pages/admin/AdminMediaMavens";
import MediaMavens from "@/pages/MediaMavens";
import MediaMavensPerformance from "@/pages/MediaMavensPerformance";
import CollectionDetail from "@/pages/CollectionDetail";
import ResourceDetail from "@/pages/ResourceDetail";
import Login from "@/pages/Login";
import ChangePasswordRequired from "@/pages/ChangePasswordRequired";
import Register from "@/pages/Register";
import ForgotPassword from "@/pages/ForgotPassword";
import ResetPassword from "@/pages/ResetPassword";
import VerifyEmail from "@/pages/VerifyEmail";
import VerifyEmailChange from "@/pages/VerifyEmailChange";
import NotFound from "@/pages/not-found";
import GhlDashboard from "@/pages/admin/GhlDashboard";
import GhlContacts from "@/pages/admin/GhlContacts";
import GhlConfig from "@/pages/admin/GhlConfig";
import AdminApiKeys from "@/pages/AdminApiKeys";
import ChatAnalytics from "@/pages/admin/ChatAnalytics";
import ChatTranscripts from "@/pages/admin/ChatTranscripts";
import SystemPrompts from "@/pages/admin/SystemPrompts";
import Knowledgebase from "@/pages/admin/Knowledgebase";
import ContentGaps from "@/pages/admin/ContentGaps";
import KnowledgeBaseReview from "@/pages/admin/KnowledgeBaseReview";
import LiveAIDocuments from "@/pages/admin/LiveAIDocuments";
import AiSourceKnowledge from "@/pages/admin/AiSourceKnowledge";
import TranscriptCleaner from "@/pages/admin/TranscriptCleaner";
import KnowledgeBaseArchive from "@/pages/admin/KnowledgeBaseArchive";
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
import SessionBooking from "@/pages/coaching/SessionBooking";
import BookSessionPack from "@/pages/coaching/BookSessionPack";
import PrivateCoaching from "@/pages/admin/PrivateCoaching";
import CoachingCalls from "@/pages/admin/CoachingCalls";
import CoachProfiles from "@/pages/admin/CoachProfiles";
import CommunicationsTemplates from "@/pages/admin/CommunicationsTemplates";
import CommunicationsSmsTemplates from "@/pages/admin/CommunicationsSmsTemplates";
import CommunicationsSequences from "@/pages/admin/CommunicationsSequences";
import CommunicationsBroadcasts from "@/pages/admin/CommunicationsBroadcasts";
import CommunicationsAnnouncements from "@/pages/admin/CommunicationsAnnouncements";
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
import VoiceUsage from "@/pages/admin/VoiceUsage";
import AdminSettings from "@/pages/admin/AdminSettings";
import RevenueDashboard from "@/pages/admin/RevenueDashboard";
import RefundMetrics from "@/pages/admin/RefundMetrics";
import CohortAnalysis from "@/pages/admin/CohortAnalysis";
import AtRiskMembers from "@/pages/admin/AtRiskMembers";
import UpgradeOpportunities from "@/pages/admin/UpgradeOpportunities";
import FunnelPerformance from "@/pages/admin/FunnelPerformance";
import UpgradePromptAnalytics from "@/pages/admin/UpgradePromptAnalytics";
import LtvAnalysis from "@/pages/admin/LtvAnalysis";
import RevenueForecast from "@/pages/admin/RevenueForecast";
import AppsManager from "@/pages/admin/AppsManager";
import StrikesList from "@/pages/admin/moderation/strikes";
import UserStrikesDetail from "@/pages/admin/moderation/user-strikes";
import ModerationQueue from "@/pages/admin/moderation/queue";
import ModerationAiFlagged from "@/pages/admin/moderation/ai-flagged";
import ModerationWordlist from "@/pages/admin/moderation/wordlist";
import YseOrders from "@/pages/admin/YseOrders";
import YseGrantFailures from "@/pages/admin/YseGrantFailures";
import FulfillmentMap from "@/pages/admin/FulfillmentMap";
import ContentAccessMap from "@/pages/admin/ContentAccessMap";
import AdminAssistantGroups from "@/pages/admin/AdminAssistantGroups";
import AdminAssistantCards from "@/pages/admin/AdminAssistantCards";
import AdminAssistantQuestions from "@/pages/admin/AdminAssistantQuestions";
import Account from "@/pages/Account";
import Plans from "@/pages/Plans";
import Checkout from "@/pages/Checkout";
import AdSpendFund from "@/pages/AdSpendFund";
import PaymentMethods from "@/pages/PaymentMethods";
import MyProducts from "@/pages/MyProducts";
import CoachDashboard from "@/pages/coaching/CoachDashboard";
import PackCoachDashboard from "@/pages/coaching/PackCoachDashboard";
import GroupCoaching from "@/pages/coaching/GroupCoaching";
import MenteeDetail from "@/pages/coaching/MenteeDetail";
import { AdminRoute } from "@/components/auth/AdminRoute";
import { CoachRoute } from "@/components/auth/CoachRoute";
import { adminPanelApi } from "@/lib/admin-panel-api";
import { useToast } from "@/hooks/use-toast";
import { useContentAccess } from "@/hooks/use-content-access";
import { ContentLockedScreen } from "@/components/content-access/ContentLockedScreen";

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

export function ProtectedRoute({ component: Component }: { component: React.ComponentType<any> }) {
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

  if (user.mustChangePassword) {
    return <Redirect to="/change-password" />;
  }

  if (!user.onboardingComplete && !isCoachRole(user.role)) {
    const stepRoute = STEP_ROUTES[(user.onboardingStep || 1) - 1] || STEP_ROUTES[0];
    return <Redirect to={stepRoute} />;
  }

  return <Component />;
}

export function EntitlementRoute({ component: Component, entitlement }: { component: React.ComponentType<any>; entitlement: string }) {
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

  if (user.mustChangePassword) {
    return <Redirect to="/change-password" />;
  }

  if (!user.onboardingComplete && !isCoachRole(user.role)) {
    const stepRoute = STEP_ROUTES[(user.onboardingStep || 1) - 1] || STEP_ROUTES[0];
    return <Redirect to={stepRoute} />;
  }

  const isAdmin = isAdminRole(user?.role) || isAdminRole(member?.role);
  const isCoach = isCoachRole(user?.role) || isCoachRole(member?.role);
  const entitlements = new Set(member?.entitlements ?? []);
  const hasEntitlement = entitlement.endsWith(":*")
    ? Array.from(entitlements).some((e: string) => e.startsWith(entitlement.replace(":*", ":")))
    : entitlements.has(entitlement);
  if (!isAdmin && !isCoach && !hasEntitlement) {
    return <Redirect to="/" />;
  }

  return <Component />;
}

/**
 * Guards a content page with the admin-configurable Content Access Map.
 * - Admin and coach roles bypass the map and always see the page.
 * - For members: if the map has no rows for this pageKey the page is open
 *   (API returns it as accessible); if rows exist and this member lacks a
 *   qualifying product, the locked screen is rendered in place (no redirect).
 */
export function ContentAccessRoute({
  component: Component,
  pageKey,
}: {
  component: React.ComponentType<any>;
  pageKey: string;
}) {
  const { user, loading } = useAuth();
  const { data: member, isLoading: memberLoading } = useGetCurrentMember();
  const { accessiblePageKeys, isLoading: accessLoading, isError: accessError } = useContentAccess();

  // Defense-in-depth: never let an *errored* content-access query drive the
  // spinner. An errored React Query has no data and stays stale, so a bad
  // request (e.g. a 404) would otherwise keep `accessLoading` flipping on every
  // remount and spin the guard forever. On error we fall through to fail-open.
  if (loading || memberLoading || (accessLoading && !accessError)) {
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

  if (user.mustChangePassword) {
    return <Redirect to="/change-password" />;
  }

  if (!user.onboardingComplete && !isCoachRole(user.role)) {
    const stepRoute = STEP_ROUTES[(user.onboardingStep || 1) - 1] || STEP_ROUTES[0];
    return <Redirect to={stepRoute} />;
  }

  const isAdmin = isAdminRole(user?.role) || isAdminRole(member?.role);
  const isCoach = isCoachRole(user?.role) || isCoachRole(member?.role);

  if (isAdmin || isCoach) {
    return <Component />;
  }

  // Fail-open on error: transient API failures should not lock members out.
  // Only show the locked screen when we have a definitive "not in the set"
  // answer from a successful fetch.
  if (!accessError && !accessiblePageKeys.has(pageKey)) {
    return <ContentLockedScreen />;
  }

  return <Component />;
}

export function OnboardingRoute({ component: Component, step }: { component: React.ComponentType<any>; step: number }) {
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

export function GuestRoute({ component: Component }: { component: React.ComponentType<any> }) {
  const { user, loading } = useAuth();

  if (loading) return null;

  if (user) {
    if (user.mustChangePassword) {
      return <Redirect to="/change-password" />;
    }
    if (!user.onboardingComplete && !isCoachRole(user.role)) {
      const stepRoute = STEP_ROUTES[(user.onboardingStep || 1) - 1] || STEP_ROUTES[0];
      return <Redirect to={stepRoute} />;
    }
    return <Redirect to="/" />;
  }

  return <Component />;
}

// Gate for the forced first-login change-password screen. Only reachable by a
// signed-in user whose account still carries the temporary password
// (mustChangePassword). Everyone else is bounced away so the screen can't be
// opened (or linked to) outside the intended flow.
export function PasswordChangeRoute({ component: Component }: { component: React.ComponentType<any> }) {
  const { user, loading } = useAuth();

  if (loading) return null;

  if (!user) {
    return <Redirect to="/login" />;
  }

  if (!user.mustChangePassword) {
    return <Redirect to="/" />;
  }

  return <Component />;
}

function Router() {
  return (
    <Switch>
      <Route path="/login">{() => <GuestRoute component={Login} />}</Route>
      <Route path="/change-password">{() => <PasswordChangeRoute component={ChangePasswordRequired} />}</Route>
      <Route path="/register">{() => <GuestRoute component={Register} />}</Route>
      <Route path="/forgot-password">{() => <GuestRoute component={ForgotPassword} />}</Route>
      <Route path="/reset-password">{() => <ResetPassword />}</Route>
      <Route path="/verify-email">{() => <VerifyEmail />}</Route>
      <Route path="/verify-email-change">{() => <VerifyEmailChange />}</Route>
      <Route path="/onboarding/welcome">{() => <OnboardingRoute component={OnboardingWelcome} step={1} />}</Route>
      <Route path="/onboarding/documents">{() => <OnboardingRoute component={OnboardingDocuments} step={2} />}</Route>
      <Route path="/onboarding/profile">{() => <OnboardingRoute component={OnboardingProfile} step={3} />}</Route>
      <Route path="/onboarding/orientation">{() => <OnboardingRoute component={OnboardingOrientation} step={4} />}</Route>
      <Route path="/onboarding/quick-start">{() => <OnboardingRoute component={OnboardingQuickStart} step={5} />}</Route>
      <Route path="/">{() => <ProtectedRoute component={Home} />}</Route>
      <Route path="/dashboard">{() => <ProtectedRoute component={Dashboard} />}</Route>
      <Route path="/core-training">{() => <ContentAccessRoute component={CoreTraining} pageKey="core-training" />}</Route>
      <Route path="/core-training/quick-start">{() => <ContentAccessRoute component={QuickStartGuide} pageKey="quick-start" />}</Route>
      <Route path="/core-training/7-pillars">{() => <ContentAccessRoute component={SevenPillars} pageKey="seven-pillars" />}</Route>
      <Route path="/core-training/pillars-to-blitz">{() => <ContentAccessRoute component={PillarsToBlitz} pageKey="pillars-to-blitz" />}</Route>
      <Route path="/core-training/direct-edge">{() => <ContentAccessRoute component={DirectEdge} pageKey="direct-edge" />}</Route>
      <Route path="/tips-and-tricks">{() => <ContentAccessRoute component={TipsAndTricks} pageKey="tips-and-tricks" />}</Route>
      <Route path="/va-calls/book">{() => <EntitlementRoute component={BookVaCall} entitlement="coaching:group" />}</Route>
      <Route path="/va-calls">{() => <ProtectedRoute component={VaCalls} />}</Route>
      {/* Legacy concierge VA-call paths now live under /va-calls. Preserve the
          query string so old ?reschedule=<id> deep links keep working. */}
      <Route path="/concierge/book-va-call">
        {() => <Redirect to={`/va-calls/book${window.location.search}`} />}
      </Route>
      <Route path="/concierge/submit">{() => <ProtectedRoute component={ConciergeSubmit} />}</Route>
      <Route path="/concierge">{() => <ProtectedRoute component={Concierge} />}</Route>
      <Route path="/coaching/sessions">{() => <ProtectedRoute component={CoachingSession} />}</Route>
      <Route path="/advantage">{() => <ProtectedRoute component={Advantage} />}</Route>
      <Route path="/compliance/submit">{() => <EntitlementRoute component={ComplianceSubmit} entitlement="software:base" />}</Route>
      <Route path="/compliance">{() => <EntitlementRoute component={ComplianceReview} entitlement="software:base" />}</Route>
      <Route path="/prime-corporate">{() => <ProtectedRoute component={PrimeCorporate} />}</Route>
      <Route path="/ad-credit">{() => <ProtectedRoute component={AdCredit} />}</Route>
      <Route path="/coaching/recruitment">{() => <ProtectedRoute component={CoachingRecruitment} />}</Route>
      <Route path="/self-promoting">{() => <ProtectedRoute component={SelfPromoting} />}</Route>
      <Route path="/ai-assistant">{() => <ProtectedRoute component={AiAssistant} />}</Route>
      <Route path="/assistant/voice">{() => <EntitlementRoute component={VoiceAssistant} entitlement="voice:access" />}</Route>
      <Route path="/blitz">{() => <ContentAccessRoute component={BlitzHub} pageKey="blitz" />}</Route>
      <Route path="/blitz/guide">{() => <ContentAccessRoute component={Blitz} pageKey="blitz" />}</Route>
      <Route path="/blitz/guide/:lessonId">{() => <ContentAccessRoute component={Blitz} pageKey="blitz" />}</Route>
      <Route path="/blitz-archive">{() => <AdminRoute component={BlitzHubArchive} permission="content:manage" />}</Route>
      <Route path="/blitz-archive/guide">{() => <AdminRoute component={BlitzArchive} permission="content:manage" />}</Route>
      <Route path="/blitz-archive/guide/:lessonId">{() => <AdminRoute component={BlitzArchive} permission="content:manage" />}</Route>
      <Route path="/videoreview">{() => <AdminRoute component={VideoReview} permission="content:manage" />}</Route>
      <Route path="/training">{() => <ContentAccessRoute component={Training} pageKey="training" />}</Route>
      <Route path="/training/modules/:id">{() => <ContentAccessRoute component={ModuleDetail} pageKey="training-module" />}</Route>
      <Route path="/training/lessons/:id">{() => <ContentAccessRoute component={LessonView} pageKey="training-lesson" />}</Route>
      <Route path="/admin/content/tracks">{() => <AdminRoute component={ContentTracks} permission="content:manage" />}</Route>
      <Route path="/admin/content/lessons/:id/edit">{() => <AdminRoute component={LessonEditor} permission="content:manage" />}</Route>
      <Route path="/admin/affiliate-networks">{() => <AdminRoute component={AdminAffiliateNetworks} permission="content:manage" />}</Route>
      <Route path="/admin/media-mavens">{() => <AdminRoute component={AdminMediaMavens} permission="content:manage" />}</Route>
      <Route path="/community">{() => <ProtectedRoute component={CommunityFeed} />}</Route>
      <Route path="/dm">{() => <AdminRoute component={DMInbox} />}</Route>
      <Route path="/dm/:threadId">{() => <AdminRoute component={DMThread} />}</Route>
      <Route path="/community/members">{() => <EntitlementRoute component={MemberDirectory} entitlement="community:access" />}</Route>
      <Route path="/community/members/:userId">{() => <EntitlementRoute component={MemberProfile} entitlement="community:access" />}</Route>
      <Route path="/community/:postId">{() => <ProtectedRoute component={PostDetail} />}</Route>
      <Route path="/wins">{() => <ProtectedRoute component={WinsWall} />}</Route>
      <Route path="/wins/submit">{() => <ProtectedRoute component={WinSubmit} />}</Route>
      <Route path="/wins/mine">{() => <ProtectedRoute component={MyWins} />}</Route>
      <Route path="/wins/:id/testimonial">{() => <ProtectedRoute component={TestimonialSubmit} />}</Route>
      <Route path="/wins/:id">{() => <ProtectedRoute component={WinDetail} />}</Route>
      <Route path="/coaching/book-session/book">{() => <ProtectedRoute component={BookSessionPack} />}</Route>
      <Route path="/coaching/book-session">{() => <ProtectedRoute component={SessionBooking} />}</Route>
      <Route path="/coaching">{() => <EntitlementRoute component={Coaching} entitlement="coaching:group" />}</Route>
      <Route path="/account">{() => <ProtectedRoute component={Account} />}</Route>
      <Route path="/account/products">{() => <ProtectedRoute component={MyProducts} />}</Route>
      <Route path="/payment-methods">{() => <ProtectedRoute component={PaymentMethods} />}</Route>
      <Route path="/plans">{() => <ProtectedRoute component={Plans} />}</Route>
      <Route path="/checkout/:productId">{() => <ProtectedRoute component={Checkout} />}</Route>
      <Route path="/ad-spend/fund">{() => <ProtectedRoute component={AdSpendFund} />}</Route>
      <Route path="/admin/ghl">{() => <AdminRoute component={GhlDashboard} permission="ghl:view" />}</Route>
      <Route path="/admin/ghl/contacts">{() => <AdminRoute component={GhlContacts} permission="ghl:view" />}</Route>
      <Route path="/admin/ghl/config">{() => <AdminRoute component={GhlConfig} permission="ghl:manage" />}</Route>
      <Route path="/chat">{() => <Redirect to="/ai-assistant" />}</Route>
      <Route path="/resources/:collectionSlug/:resourceId">{() => <ProtectedRoute component={ResourceDetail} />}</Route>
      <Route path="/resources/:collectionSlug">{() => <ProtectedRoute component={CollectionDetail} />}</Route>
      <Route path="/resources">{() => <ProtectedRoute component={Resources} />}</Route>
      <Route path="/resource-library">{() => <ContentAccessRoute component={ResourceLibrary} pageKey="resource-library" />}</Route>
      <Route path="/knowledge-base">{() => <ContentAccessRoute component={KnowledgeBase} pageKey="knowledge-base" />}</Route>
      <Route path="/affiliate-networks">{() => <ContentAccessRoute component={AffiliateNetworks} pageKey="affiliate-networks" />}</Route>
      <Route path="/media-mavens">{() => <ProtectedRoute component={MediaMavens} />}</Route>
      <Route path="/media-mavens/performance">{() => <ProtectedRoute component={MediaMavensPerformance} />}</Route>
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
      <Route path="/apps">{() => <EntitlementRoute component={Apps} entitlement="software:base" />}</Route>
      <Route path="/partner-tools">{() => <ProtectedRoute component={PartnerTools} />}</Route>
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
      <Route path="/admin/chat/knowledgebase/archivebackup">{() => <AdminRoute component={KnowledgeBaseArchive} permission="chat:manage" />}</Route>
      <Route path="/admin/chat/knowledgebase/review">{() => <AdminRoute component={KnowledgeBaseReview} permission="chat:manage" />}</Route>
      <Route path="/admin/chat/knowledgebase">{() => <AdminRoute component={Knowledgebase} permission="chat:manage" />}</Route>
      <Route path="/admin/ai-knowledgebase/live-documents">{() => <AdminRoute component={LiveAIDocuments} permission="chat:manage" />}</Route>
      <Route path="/admin/ai-knowledgebase/source-knowledge">{() => <AdminRoute component={AiSourceKnowledge} permission="chat:manage" />}</Route>
      <Route path="/admin/ai-knowledgebase/transcript-cleaner">{() => <AdminRoute component={TranscriptCleaner} permission="chat:manage" />}</Route>
      <Route path="/admin/chat/content-gaps">{() => <AdminRoute component={ContentGaps} permission="chat:manage" />}</Route>
      <Route path="/admin/chat/rate-limits">{() => <AdminRoute component={RateLimits} permission="chat:manage" />}</Route>
      <Route path="/admin/coaching/sessions">{() => <AdminRoute component={PrivateCoaching} permission="coaching:view" />}</Route>
      <Route path="/admin/coaching/credits">{() => <Redirect to="/admin/coaching/sessions" />}</Route>
      <Route path="/admin/coaching/calls">{() => <AdminRoute component={CoachingCalls} permission="coaching:view" />}</Route>
      <Route path="/admin/coaching/coaches">{() => <AdminRoute component={CoachProfiles} permission="coaching:view" />}</Route>
      <Route path="/admin/communications/templates">{() => <AdminRoute component={CommunicationsTemplates} permission="communications:manage" />}</Route>
      <Route path="/admin/communications/sms-templates">{() => <AdminRoute component={CommunicationsSmsTemplates} permission="communications:manage" />}</Route>
      <Route path="/admin/communications/sequences">{() => <AdminRoute component={CommunicationsSequences} permission="communications:manage" />}</Route>
      <Route path="/admin/communications/broadcasts">{() => <AdminRoute component={CommunicationsBroadcasts} permission="communications:manage" />}</Route>
      <Route path="/admin/communications/announcements">{() => <AdminRoute component={CommunicationsAnnouncements} permission="communications:manage" />}</Route>
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
      <Route path="/admin/voice">{() => <AdminRoute component={VoiceUsage} permission="system:view" />}</Route>
      <Route path="/admin/settings">{() => <AdminRoute component={AdminSettings} permission="settings:view" />}</Route>
      <Route path="/admin/revenue">{() => <AdminRoute component={RevenueDashboard} permission="revenue:view" />}</Route>
      <Route path="/admin/refund-metrics">{() => <AdminRoute component={RefundMetrics} permission="revenue:view" />}</Route>
      <Route path="/admin/revenue/cohorts">{() => <AdminRoute component={CohortAnalysis} permission="revenue:view" />}</Route>
      <Route path="/admin/revenue/at-risk">{() => <AdminRoute component={AtRiskMembers} permission="revenue:view" />}</Route>
      <Route path="/admin/revenue/upgrade-opportunities">{() => <AdminRoute component={UpgradeOpportunities} permission="revenue:view" />}</Route>
      <Route path="/admin/revenue/funnels">{() => <AdminRoute component={FunnelPerformance} permission="revenue:view" />}</Route>
      <Route path="/admin/revenue/upgrade-prompts">{() => <AdminRoute component={UpgradePromptAnalytics} permission="revenue:view" />}</Route>
      <Route path="/admin/revenue/ltv">{() => <AdminRoute component={LtvAnalysis} permission="revenue:view" />}</Route>
      <Route path="/admin/revenue/forecast">{() => <AdminRoute component={RevenueForecast} permission="revenue:view" />}</Route>
      <Route path="/admin/apps-manager">{() => <AdminRoute component={AppsManager} permission="apps:manage" />}</Route>
      <Route path="/admin/moderation/queue">{() => <AdminRoute component={ModerationQueue} permission="community:moderate" />}</Route>
      <Route path="/admin/moderation/ai-flagged">{() => <AdminRoute component={ModerationAiFlagged} permission="community:moderate" />}</Route>
      <Route path="/admin/moderation/wordlist">{() => <AdminRoute component={ModerationWordlist} permission="community:moderate" />}</Route>
      <Route path="/admin/moderation/strikes/:userId">{() => <AdminRoute component={UserStrikesDetail} permission="community:moderate" />}</Route>
      <Route path="/admin/moderation/strikes">{() => <AdminRoute component={StrikesList} permission="community:moderate" />}</Route>
      <Route path="/admin/integrations/yse">{() => <AdminRoute component={YseOrders} permission="members:view" />}</Route>
      <Route path="/admin/integrations/machine">{() => <AdminRoute component={YseOrders} permission="members:view" />}</Route>
      <Route path="/admin/integrations/yse/failures">{() => <AdminRoute component={YseGrantFailures} permission="system:view" />}</Route>
      <Route path="/admin/integrations/fulfillment-map">{() => <AdminRoute component={FulfillmentMap} permission="members:view" />}</Route>
      <Route path="/admin/integrations/content-access-map">{() => <AdminRoute component={ContentAccessMap} permission="members:view" />}</Route>
      <Route path="/admin/assistant/groups">{() => <AdminRoute component={AdminAssistantGroups} permission="content:manage" />}</Route>
      <Route path="/admin/assistant/groups/:groupId/cards">{() => <AdminRoute component={AdminAssistantCards} permission="content:manage" />}</Route>
      <Route path="/admin/assistant/cards/:cardId/questions">{() => <AdminRoute component={AdminAssistantQuestions} permission="content:manage" />}</Route>
      <Route path="/coach/dashboard">{() => <CoachRoute component={CoachDashboard} />}</Route>
      <Route path="/coach/sessions">{() => <CoachRoute component={PackCoachDashboard} />}</Route>
      <Route path="/coach/group-coaching">{() => <CoachRoute component={GroupCoaching} />}</Route>
      <Route path="/coach/mentees/:userId">{() => <CoachRoute component={MenteeDetail} />}</Route>
      <Route path="/coach/messages">{() => <CoachRoute component={DMInbox} />}</Route>
      <Route path="/coach/messages/:threadId">{() => <CoachRoute component={DMThread} />}</Route>
      <Route component={NotFound} />
    </Switch>
  );
}

function ScrollToTop() {
  const [location] = useLocation();
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  }, [location]);
  return null;
}

// Routes where the live-chat launchers should be suppressed — auth and
// onboarding screens where the launcher feels out of place or overlaps form
// elements.
const CHAT_WIDGET_HIDDEN_EXACT = new Set([
  "/login",
  "/register",
  "/change-password",
  "/forgot-password",
  "/reset-password",
  "/verify-email",
  "/verify-email-change",
]);
const CHAT_WIDGET_HIDDEN_PREFIXES = ["/onboarding"];

function ImpersonationBanner() {
  const { user, refreshAuth } = useAuth();
  const [stopping, setStopping] = useState(false);
  const { toast } = useToast();
  const [, navigate] = useLocation();

  if (!user?.isImpersonation) return null;

  const handleStop = async () => {
    setStopping(true);
    try {
      await adminPanelApi.stopImpersonation();
      await refreshAuth();
      navigate("/admin/members");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to exit impersonation";
      toast({ title: "Failed to exit impersonation", description: message, variant: "destructive" });
    } finally {
      setStopping(false);
    }
  };

  return (
    <div
      className="fixed top-0 left-0 right-0 z-[9999] flex items-center justify-between gap-3 bg-amber-400 px-4 py-2 text-amber-950 text-sm font-medium shadow-md"
      data-testid="impersonation-banner"
    >
      <span>
        Viewing as <strong>{user.name}</strong> ({user.email}) — impersonated by{" "}
        <strong>{user.impersonatedBy?.name ?? "Admin"}</strong>
      </span>
      <button
        onClick={handleStop}
        disabled={stopping}
        className="shrink-0 rounded border border-amber-700 bg-amber-500 px-3 py-1 text-xs font-semibold text-amber-950 hover:bg-amber-600 disabled:opacity-60 transition-colors"
        data-testid="button-exit-impersonation"
      >
        {stopping ? "Exiting…" : "Exit / Stop impersonating"}
      </button>
    </div>
  );
}

export function isChatWidgetHiddenRoute(location: string) {
  return (
    CHAT_WIDGET_HIDDEN_EXACT.has(location) ||
    CHAT_WIDGET_HIDDEN_PREFIXES.some(
      (prefix) => location === prefix || location.startsWith(prefix + "/"),
    )
  );
}

export function AuthenticatedChatWidget() {
  const { user, loading } = useAuth();
  const [location] = useLocation();
  if (loading || !user || !user.onboardingComplete) return null;
  if (location === "/chat" || location === "/ai-assistant") return null;
  if (isChatWidgetHiddenRoute(location)) return null;
  return <ChatWidget />;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AuthProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <ImpersonationBanner />
            <ScrollToTop />
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
