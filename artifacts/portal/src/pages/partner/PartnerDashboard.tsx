/**
 * Placeholder /partner landing page. Verifies the partner role + PartnerRoute
 * guard are wired end to end ahead of the Tier 2 accountability-partner
 * dashboard (roster views, assignment data, etc.), which is out of scope here.
 */
export default function PartnerDashboard() {
  return (
    <div className="p-6 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold text-foreground mb-2">Partner Portal</h1>
      <p className="text-muted-foreground">
        Your accountability-partner dashboard is coming soon. This area is
        reserved for partner-only tools and mentee assignments.
      </p>
    </div>
  );
}
