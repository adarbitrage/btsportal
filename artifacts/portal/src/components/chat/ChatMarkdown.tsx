import { useState, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneLight } from "react-syntax-highlighter/dist/esm/styles/prism";
import { Check, Copy } from "lucide-react";

interface ChatMarkdownProps {
  content: string;
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
  return (
    <div className="chat-markdown prose prose-sm max-w-none prose-headings:text-foreground prose-p:text-foreground prose-strong:text-foreground prose-li:text-foreground">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
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
