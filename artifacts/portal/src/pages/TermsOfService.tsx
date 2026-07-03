import { useGetLegalDocuments } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useLocation } from "wouter";

// Browsewrap Terms of Service page (Task #1624). This is the SOLE surfacing
// of the platform Terms of Service — reachable via the footer link in the
// Sidebar. It reuses the same legal-documents content source the (now
// removed from onboarding) Documents page reads; it never requires or
// records a signature.
export default function TermsOfService() {
  const { data: documents, isLoading } = useGetLegalDocuments();
  const [, navigate] = useLocation();

  const terms = documents?.find((d) => d.type === "terms_of_service");

  return (
    <div className="min-h-screen bg-[#faf9f7] flex flex-col">
      <header className="bg-white border-b border-border/50 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <img
            src={`${import.meta.env.BASE_URL}images/bts-logo.png`}
            alt="Build Test Scale"
            className="h-10 w-10 object-contain"
          />
          <div>
            <h1 className="font-bold text-sm tracking-tight text-foreground leading-tight">BUILD TEST SCALE</h1>
          </div>
        </div>
        <button
          onClick={() => navigate("/")}
          className="text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          Back to Portal
        </button>
      </header>

      <div className="flex-1 w-full max-w-3xl mx-auto px-6 py-10">
        <Card>
          <CardHeader>
            <CardTitle className="text-xl">{terms?.title ?? "Terms of Service"}</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading && <p className="text-muted-foreground">Loading...</p>}
            {!isLoading && !terms && (
              <p className="text-muted-foreground">Terms of Service content is not currently available.</p>
            )}
            {terms && (
              <div
                className="text-sm leading-relaxed prose prose-sm max-w-none"
                dangerouslySetInnerHTML={{ __html: markdownToHtml(terms.content) }}
              />
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function markdownToHtml(md: string): string {
  return md
    .replace(/^### (.*$)/gm, "<h3>$1</h3>")
    .replace(/^## (.*$)/gm, "<h2>$1</h2>")
    .replace(/^# (.*$)/gm, "<h1>$1</h1>")
    .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.*?)\*/g, "<em>$1</em>")
    .replace(/^- (.*$)/gm, "<li>$1</li>")
    .replace(/(<li>.*<\/li>)/s, "<ul>$1</ul>")
    .replace(/\n\n/g, "<br/><br/>")
    .replace(/\n/g, "<br/>");
}
