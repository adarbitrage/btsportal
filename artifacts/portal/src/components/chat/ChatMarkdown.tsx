import { useState, useCallback } from "react";
import { useLocation } from "wouter";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneLight } from "react-syntax-highlighter/dist/esm/styles/prism";
import { Check, Copy } from "lucide-react";
import { flattenNavigationMap } from "@workspace/portal-nav-map";

interface ChatMarkdownProps {
  content: string;
}

// The set of real member-portal paths the AI may deep-link to. Sourced from the
// single nav-map registry (@workspace/portal-nav-map) so a link only renders
// when it resolves to a known page — an unknown/removed path degrades to plain
// text (Rule 14). Computed once per module load; the map is a static registry.
const KNOWN_PORTAL_PATHS: ReadonlySet<string> = new Set(
  flattenNavigationMap().map((item) => item.path),
);

/** A same-origin portal path like "/coaching" (not "//host" or "/api/..."). */
function isInternalPortalPath(href: string): boolean {
  if (!href.startsWith("/") || href.startsWith("//")) return false;
  const path = href.split(/[?#]/)[0];
  return KNOWN_PORTAL_PATHS.has(path);
}

function CopyButton({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [code]);

  return (
    <button
      onClick={handleCopy}
      className="absolute top-2 right-2 p-1.5 rounded-md bg-white/80 hover:bg-white border border-border/50 text-muted-foreground hover:text-foreground transition-colors"
      title="Copy code"
    >
      {copied ? <Check className="w-3.5 h-3.5 text-green-600" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  );
}

export function ChatMarkdown({ content }: ChatMarkdownProps) {
  const [, navigate] = useLocation();

  return (
    <div className="chat-markdown prose prose-sm max-w-none prose-headings:text-foreground prose-p:text-foreground prose-strong:text-foreground prose-li:text-foreground">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a({ href, children }) {
            // Internal portal page → in-app navigation (no full reload).
            if (href && isInternalPortalPath(href)) {
              return (
                <a
                  href={href}
                  onClick={(e) => {
                    // Let the browser handle modified clicks (new tab, etc.).
                    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
                    e.preventDefault();
                    navigate(href);
                  }}
                  className="text-primary font-medium underline underline-offset-2 hover:text-primary/80 cursor-pointer"
                >
                  {children}
                </a>
              );
            }
            // External web link → new tab with safe rel.
            if (href && /^https?:\/\//i.test(href)) {
              return (
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary font-medium underline underline-offset-2 hover:text-primary/80"
                >
                  {children}
                </a>
              );
            }
            // mailto:/tel: (remark-gfm autolinks bare emails like the support
            // address) — keep as a normal anchor so it stays clickable.
            if (href && /^(mailto:|tel:)/i.test(href)) {
              return (
                <a
                  href={href}
                  className="text-primary font-medium underline underline-offset-2 hover:text-primary/80"
                >
                  {children}
                </a>
              );
            }
            // Unknown/non-portal path (e.g. a bare "/made-up") or unknown scheme
            // — degrade to plain text so a broken/unsafe link is never rendered
            // (Rule 14).
            return <>{children}</>;
          },
          code({ className, children, ...props }) {
            const match = /language-(\w+)/.exec(className || "");
            const codeString = String(children).replace(/\n$/, "");
            if (match) {
              return (
                <div className="relative group my-3">
                  <CopyButton code={codeString} />
                  <SyntaxHighlighter
                    style={oneLight}
                    language={match[1]}
                    PreTag="div"
                    customStyle={{
                      margin: 0,
                      borderRadius: "0.5rem",
                      fontSize: "0.8rem",
                      border: "1px solid hsl(40 18% 88%)",
                    }}
                  >
                    {codeString}
                  </SyntaxHighlighter>
                </div>
              );
            }
            return (
              <code className="bg-secondary/80 text-foreground px-1.5 py-0.5 rounded text-xs font-mono" {...props}>
                {children}
              </code>
            );
          },
          p({ children }) {
            return <p className="mb-2 last:mb-0 leading-relaxed">{children}</p>;
          },
          ul({ children }) {
            return <ul className="mb-2 pl-4 space-y-1 list-disc">{children}</ul>;
          },
          ol({ children }) {
            return <ol className="mb-2 pl-4 space-y-1 list-decimal">{children}</ol>;
          },
          h1({ children }) {
            return <h1 className="text-lg font-bold mt-3 mb-2">{children}</h1>;
          },
          h2({ children }) {
            return <h2 className="text-base font-bold mt-3 mb-1.5">{children}</h2>;
          },
          h3({ children }) {
            return <h3 className="text-sm font-bold mt-2 mb-1">{children}</h3>;
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
