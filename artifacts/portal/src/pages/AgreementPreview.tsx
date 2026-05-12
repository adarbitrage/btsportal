import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import agreementMarkdown from "@/content/bts-master-agreement-draft.md?raw";

export default function AgreementPreview() {
  return (
    <AppLayout>
      <div className="max-w-4xl mx-auto p-6">
        <div className="mb-4">
          <h1 className="text-2xl font-bold text-foreground">Agreement Preview (Draft)</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Rough draft of the BTS Mentorship Program Agreement, formatted to match the
            seeded Membership Agreement style. This page is a temporary preview &mdash; edit
            <code className="mx-1 px-1.5 py-0.5 rounded bg-secondary/60 text-xs">
              artifacts/portal/src/content/bts-master-agreement-draft.md
            </code>
            (or the root-level
            <code className="mx-1 px-1.5 py-0.5 rounded bg-secondary/60 text-xs">
              BTS_Master_Agreement_DRAFT.md
            </code>
            ) to update it.
          </p>
        </div>
        <Card>
          <CardContent className="p-8">
            <article className="prose prose-sm md:prose-base max-w-none dark:prose-invert prose-headings:scroll-mt-20 prose-h1:text-3xl prose-h2:text-xl prose-h2:mt-8 prose-h2:font-semibold prose-p:leading-relaxed prose-li:leading-relaxed">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {agreementMarkdown}
              </ReactMarkdown>
            </article>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
