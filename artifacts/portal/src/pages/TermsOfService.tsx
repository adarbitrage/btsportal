import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { useGetLegalDocuments } from "@workspace/api-client-react";
import { FileText, Loader2 } from "lucide-react";

// Read-only "browsewrap" view of the platform Terms of Service — reachable
// from the portal sidebar link and footer link. No signature is collected
// here; the onboarding signing gate that used to live on this content was
// removed (Task #1625).
export default function TermsOfService() {
  const { data: documents, isLoading, isError } = useGetLegalDocuments({
    type: "terms_of_service",
  });

  const latest = documents?.[0];

  return (
    <AppLayout>
      <div className="max-w-3xl mx-auto space-y-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
            <FileText className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">{latest?.title ?? "Terms of Service"}</h1>
            {latest && <p className="text-sm text-muted-foreground">Version {latest.version}</p>}
          </div>
        </div>

        <Card>
          <CardContent className="p-6">
            {isLoading && (
              <div className="flex items-center justify-center py-12 text-muted-foreground">
                <Loader2 className="w-5 h-5 animate-spin mr-2" />
                Loading...
              </div>
            )}
            {isError && (
              <p className="text-sm text-destructive">
                Could not load the Terms of Service right now. Please try again later.
              </p>
            )}
            {!isLoading && !isError && !latest && (
              <p className="text-sm text-muted-foreground">
                The Terms of Service are not available right now.
              </p>
            )}
            {latest && (
              <div className="prose prose-sm max-w-none whitespace-pre-wrap text-foreground">
                {latest.content}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
