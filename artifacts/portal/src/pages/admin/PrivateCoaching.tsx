import { useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import PackSessions from "@/pages/admin/PackSessions";
import PackCredits from "@/pages/admin/PackCredits";

// Private Coaching admin page. Sessions and Session Credits are two halves of
// the same 1-on-1 process, so they live together here under one heading with
// tabs instead of two separate sidebar entries.
export default function PrivateCoaching() {
  const [tab, setTab] = useState("sessions");

  return (
    <AppLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Private Coaching</h1>
          <p className="text-muted-foreground">
            Manage 1-on-1 bookings and the session credits that fund them.
          </p>
        </div>

        <Tabs value={tab} onValueChange={setTab} className="space-y-6">
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
