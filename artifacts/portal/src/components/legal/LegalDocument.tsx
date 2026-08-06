import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { FileText } from "lucide-react";

// Shared read-only renderer for the static legal pages linked from the
// portal footer. The body text is the exact user-supplied copy (see
// src/content/legal/*); this component only classifies lines for display
// (headings vs meta vs paragraphs) — it never rewrites or reflows the text.

const META_LINE =
  /^(Effective Date|Last Updated|Last Reviewed|Version)\s*:/i;
// "2.1 Typicality Disclosure" style numbered sub-headings (short, no
// trailing sentence punctuation — longer prose lines starting with the
// same numbering render as normal paragraphs so no text is lost).
const NUMBERED_SUB = /^\d+(\.\d+)+\s+\S/;
// "1. INTRODUCTION" / "IV. LIMITATIONS" style top-level section headings.
const TOP_SECTION = /^([IVXL]+|\d+)\.\s+\S/;
// "A. Purpose and Scope" style lettered sub-headings.
const LETTER_SUB = /^[A-Z]\.\s+\S/;

type Block =
  | { kind: "h2" | "h3" | "meta" | "p"; text: string };

function isHeadingShaped(line: string): boolean {
  return line.length < 100 && !/[.;,]$/.test(line.trim());
}

export function parseLegalBody(body: string, title: string): {
  subtitle: string[];
  meta: string[];
  blocks: Block[];
} {
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  const subtitle: string[] = [];
  const meta: string[] = [];

  // Leading block (before the first blank line): title / subtitle / meta.
  let i = 0;
  let inHeader = true;
  for (; i < lines.length && inHeader; i++) {
    const line = lines[i].trim();
    if (line === "") {
      inHeader = false;
      break;
    }
    if (META_LINE.test(line)) {
      meta.push(line);
    } else if (line.toUpperCase() === line && !TOP_SECTION.test(line)) {
      // All-caps banner line; drop only an exact duplicate of the page title.
      if (line.toLowerCase() !== title.toLowerCase()) subtitle.push(line);
    } else {
      // Header ended early (body starts without a blank separator).
      break;
    }
  }

  for (; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === "") continue;
    if (META_LINE.test(line) && blocks.length === 0) {
      meta.push(line);
    } else if (NUMBERED_SUB.test(line) && isHeadingShaped(line)) {
      blocks.push({ kind: "h3", text: line });
    } else if (TOP_SECTION.test(line) && isHeadingShaped(line)) {
      blocks.push({ kind: "h2", text: line });
    } else if (LETTER_SUB.test(line) && isHeadingShaped(line)) {
      blocks.push({ kind: "h3", text: line });
    } else {
      blocks.push({ kind: "p", text: line });
    }
  }

  return { subtitle, meta, blocks };
}

export function LegalDocument({ title, body }: { title: string; body: string }) {
  const { subtitle, meta, blocks } = parseLegalBody(body, title);

  return (
    <AppLayout>
      <div className="max-w-3xl mx-auto space-y-6">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 shrink-0 rounded-full bg-primary/10 flex items-center justify-center">
            <FileText className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground" data-testid="legal-page-title">
              {title}
            </h1>
            {subtitle.map((s) => (
              <p key={s} className="text-sm font-medium text-foreground/80">
                {s}
              </p>
            ))}
            {meta.map((m) => (
              <p key={m} className="text-sm text-muted-foreground">
                {m}
              </p>
            ))}
          </div>
        </div>

        <Card>
          <CardContent className="p-6 space-y-3">
            {blocks.map((b, idx) => {
              if (b.kind === "h2") {
                return (
                  <h2 key={idx} className="text-base font-bold text-foreground pt-4 first:pt-0">
                    {b.text}
                  </h2>
                );
              }
              if (b.kind === "h3") {
                return (
                  <h3 key={idx} className="text-sm font-semibold text-foreground pt-2">
                    {b.text}
                  </h3>
                );
              }
              return (
                <p key={idx} className="text-sm text-foreground/90 leading-relaxed whitespace-pre-wrap">
                  {b.text}
                </p>
              );
            })}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
