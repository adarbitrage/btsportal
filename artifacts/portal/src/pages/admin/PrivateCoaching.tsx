import { useLocation, useSearch } from "wouter";
import { AppLayout } from "@/components/layout/AppLayout";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import PackSessions from "@/pages/admin/PackSessions";
import PackCredits from "@/pages/admin/PackCredits";

const VALID_TABS = ["sessions", "credits"] as const;
type TabValue = (typeof VALID_TABS)[number];

function normalizeTab(value: string | null): TabValue {
  return VALID_TABS.includes(value as TabValue) ? (value as TabValue) : "sessions";
}

// Private Coaching admin page. Sessions and Session Credits are two halves of
// the same 1-on-1 process, so they live together here under one heading with
// tabs instead of two separate sidebar entries. The active tab is persisted in
// the URL (`?tab=credits`) so admins can bookmark/share a direct link and the
// right tab survives a refresh.
export default function PrivateCoaching() {
  const searchString = useSearch();
  const [, navigate] = useLocation();
  const tab = normalizeTab(new URLSearchParams(searchString).get("tab"));

  const handleTabChange = (value: string) => {
    const next = normalizeTab(value);
    const params = new URLSearchParams(searchString);
    if (next === "sessions") {
      params.delete("tab");
    } else {
      params.set("tab", next);
    }
    const query = params.toString();
    navigate(`/admin/coaching/sessions${query ? `?${query}` : ""}`, { replace: true });
  };

  return (
    <AppLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Private Coaching</h1>
          <p className="text-muted-foreground">
            Manage 1-on-1 bookings and the session credits that fund them.
          </p>
        </div>

        <Tabs value={tab} onValueChange={handleTabChange} className="space-y-6">
          <TabsList>
            <TabsTrigger value="sessions" data-testid="tab-sessions">
              Sessions
            </TabsTrigger>
            <TabsTrigger value="credits" data-testid="tab-credits">
              Session Credits
            </TabsTrigger>
          </TabsList>

          <TabsContent value="sessions">
            <PackSessions />
          </TabsContent>

          <TabsContent value="credits">
            <PackCredits />
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  );
}
