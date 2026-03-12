import { Switch, Route, Router as WouterRouter, Redirect, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/lib/auth";

import { useGetCurrentMember } from "@workspace/api-client-react";
import Dashboard from "@/pages/Dashboard";
import Training from "@/pages/Training";
import ModuleDetail from "@/pages/ModuleDetail";
import Coaching from "@/pages/Coaching";
import Support from "@/pages/Support";
import TicketDetail from "@/pages/TicketDetail";
import CommunityFeed from "@/pages/community/CommunityFeed";
import MemberDirectory from "@/pages/community/MemberDirectory";
import MemberProfile from "@/pages/community/MemberProfile";
import Login from "@/pages/Login";
import Register from "@/pages/Register";
import ForgotPassword from "@/pages/ForgotPassword";
import NotFound from "@/pages/not-found";
import OnboardingWelcome from "@/pages/onboarding/Welcome";
import OnboardingDocuments from "@/pages/onboarding/Documents";
import OnboardingProfile from "@/pages/onboarding/Profile";
import OnboardingOrientation from "@/pages/onboarding/Orientation";
import OnboardingQuickStart from "@/pages/onboarding/QuickStart";

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
  if (!entitlements.has(entitlement)) {
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
      <Route path="/onboarding/welcome">{() => <OnboardingRoute component={OnboardingWelcome} step={1} />}</Route>
      <Route path="/onboarding/documents">{() => <OnboardingRoute component={OnboardingDocuments} step={2} />}</Route>
      <Route path="/onboarding/profile">{() => <OnboardingRoute component={OnboardingProfile} step={3} />}</Route>
      <Route path="/onboarding/orientation">{() => <OnboardingRoute component={OnboardingOrientation} step={4} />}</Route>
      <Route path="/onboarding/quick-start">{() => <OnboardingRoute component={OnboardingQuickStart} step={5} />}</Route>
      <Route path="/">{() => <ProtectedRoute component={Dashboard} />}</Route>
      <Route path="/training">{() => <ProtectedRoute component={Training} />}</Route>
      <Route path="/training/modules/:id">{() => <ProtectedRoute component={ModuleDetail} />}</Route>
      <Route path="/community">{() => <EntitlementRoute component={CommunityFeed} entitlement="community:access" />}</Route>
      <Route path="/community/members">{() => <EntitlementRoute component={MemberDirectory} entitlement="community:access" />}</Route>
      <Route path="/community/members/:userId">{() => <EntitlementRoute component={MemberProfile} entitlement="community:access" />}</Route>
      <Route path="/coaching">{() => <ProtectedRoute component={Coaching} />}</Route>
      <Route path="/support">{() => <ProtectedRoute component={Support} />}</Route>
      <Route path="/support/tickets/:id">{() => <ProtectedRoute component={TicketDetail} />}</Route>
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AuthProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <Router />
          </WouterRouter>
          <Toaster />
        </AuthProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
