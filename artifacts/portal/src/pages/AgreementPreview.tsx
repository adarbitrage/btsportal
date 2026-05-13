import { AppLayout } from "@/components/layout/AppLayout";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import agreementMarkdown from "@/content/bts-master-agreement-draft.md?raw";

export default function AgreementPreview() {
  const today = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <AppLayout>
      <div className="max-w-4xl mx-auto p-6 space-y-4">
        <div className="flex items-baseline justify-between">
          <h1 className="text-xl font-semibold text-foreground">Agreement Preview</h1>
          <span className="text-xs uppercase tracking-widest text-muted-foreground">
            Draft · live preview
          </span>
        </div>
        <p className="text-xs text-muted-foreground">
          Edits to{" "}
          <code className="px-1.5 py-0.5 rounded bg-secondary/60 text-[11px]">
            artifacts/portal/src/content/bts-master-agreement-draft.md
          </code>{" "}
          appear here on save.
        </p>

        <div className="rounded-lg overflow-hidden shadow-lg border border-[#1a56db]/15 bg-white">
          <div
            className="h-2"
            style={{
              background:
                "linear-gradient(90deg, #1a56db 0%, #2563eb 50%, #60a5fa 100%)",
            }}
          />

          <header className="px-10 pt-8 pb-6 border-b border-slate-200/70 bg-gradient-to-b from-[#f8faff] to-white">
            <div className="flex items-center gap-4">
              <img
                src={`${import.meta.env.BASE_URL}images/bts-logo.png`}
                alt="Build Test Scale"
                className="h-14 w-14 object-contain"
              />
              <div>
                <div className="text-[10px] tracking-[0.25em] text-[#1a56db] font-semibold uppercase">
                  Build Test Scale, LLC
                </div>
                <div className="text-2xl font-bold text-slate-900 leading-tight tracking-tight">
                  BUILD TEST SCALE
                </div>
                <div className="text-xs text-slate-500 tracking-wider uppercase mt-0.5">
                  Mentorship Program · Member Agreement
                </div>
              </div>
            </div>

            <div className="mt-6 grid grid-cols-3 gap-4 text-xs">
              <div>
                <div className="text-[10px] uppercase tracking-widest text-slate-400 font-semibold">
                  Document
                </div>
                <div className="text-slate-700 mt-0.5">Master Agreement</div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-widest text-slate-400 font-semibold">
                  Status
                </div>
                <div className="text-slate-700 mt-0.5">Draft for review</div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-widest text-slate-400 font-semibold">
                  Generated
                </div>
                <div className="text-slate-700 mt-0.5">{today}</div>
              </div>
            </div>
          </header>

          <article
            className="px-10 py-10 prose prose-sm md:prose-base max-w-none
              prose-headings:font-semibold prose-headings:text-slate-900 prose-headings:scroll-mt-20
              prose-h1:text-3xl prose-h1:font-bold prose-h1:text-[#1a56db] prose-h1:border-b prose-h1:border-[#1a56db]/20 prose-h1:pb-3 prose-h1:mb-6
              prose-h2:text-lg prose-h2:mt-10 prose-h2:mb-3 prose-h2:text-slate-800 prose-h2:tracking-tight
              prose-h2:before:content-[''] prose-h2:before:inline-block prose-h2:before:w-1 prose-h2:before:h-5 prose-h2:before:bg-[#1a56db] prose-h2:before:rounded-sm prose-h2:before:mr-3 prose-h2:before:align-[-2px]
              prose-h3:text-base prose-h3:mt-6 prose-h3:mb-2 prose-h3:text-slate-700
              prose-p:text-slate-700 prose-p:leading-relaxed
              prose-li:text-slate-700 prose-li:leading-relaxed prose-li:marker:text-[#1a56db]
              prose-strong:text-slate-900 prose-strong:font-semibold
              prose-a:text-[#1a56db] prose-a:no-underline hover:prose-a:underline
              prose-blockquote:border-l-4 prose-blockquote:border-[#1a56db] prose-blockquote:bg-[#f8faff] prose-blockquote:py-1 prose-blockquote:px-4 prose-blockquote:text-slate-700 prose-blockquote:not-italic
              prose-hr:border-slate-200
              prose-table:text-sm prose-th:bg-[#f8faff] prose-th:text-slate-700 prose-th:font-semibold prose-th:px-3 prose-th:py-2 prose-th:border prose-th:border-slate-200
              prose-td:px-3 prose-td:py-2 prose-td:border prose-td:border-slate-200 prose-td:text-slate-700
              prose-code:bg-slate-100 prose-code:text-slate-800 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:before:content-none prose-code:after:content-none"
          >
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {agreementMarkdown}
            </ReactMarkdown>
          </article>

          <footer className="px-10 py-6 border-t border-slate-200/70 bg-slate-50/60 flex items-center justify-between text-xs text-slate-500">
            <div className="flex items-center gap-2">
              <span
                className="inline-block w-2 h-2 rounded-full"
                style={{ background: "#1a56db" }}
              />
              <span>Build Test Scale, LLC · Confidential — for member review</span>
            </div>
            <div className="tracking-widest uppercase">Page Footer</div>
          </footer>
        </div>
      </div>
    </AppLayout>
  );
}
