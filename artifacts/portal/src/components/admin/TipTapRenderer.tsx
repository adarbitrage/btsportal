import React from "react";

function sanitizeUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const parsed = new URL(url, window.location.origin);
    if (!["http:", "https:", "mailto:"].includes(parsed.protocol)) {
      return undefined;
    }
    return url;
  } catch {
    return undefined;
  }
}

export function TipTapContentRenderer({ content }: { content: any }) {
  if (!content || !content.content) return null;

  const renderNode = (node: any, index: number): React.ReactNode => {
    if (!node) return null;

    switch (node.type) {
      case "paragraph":
        return <p key={index}>{renderChildren(node.content)}</p>;
      case "heading": {
        const level = node.attrs?.level || 2;
        if (level === 2) return <h2 key={index}>{renderChildren(node.content)}</h2>;
        if (level === 3) return <h3 key={index}>{renderChildren(node.content)}</h3>;
        return <h4 key={index}>{renderChildren(node.content)}</h4>;
      }
      case "bulletList":
        return <ul key={index}>{renderChildren(node.content)}</ul>;
      case "orderedList":
        return <ol key={index}>{renderChildren(node.content)}</ol>;
      case "listItem":
        return <li key={index}>{renderChildren(node.content)}</li>;
      case "blockquote":
        return <blockquote key={index}>{renderChildren(node.content)}</blockquote>;
      case "codeBlock":
        return (
          <pre key={index} className="bg-[#1e1e1e] text-[#d4d4d4] rounded-lg p-4 overflow-x-auto">
            <code>{renderChildren(node.content)}</code>
          </pre>
        );
      case "horizontalRule":
        return <hr key={index} />;
      case "image": {
        const src = sanitizeUrl(node.attrs?.src);
        return src ? <img key={index} src={src} alt={node.attrs?.alt || ""} className="rounded-lg max-w-full" /> : null;
      }
      case "youtube":
        return (
          <div key={index} className="relative w-full" style={{ paddingBottom: "56.25%" }}>
            <iframe
              src={`https://www.youtube.com/embed/${node.attrs?.src?.match(/(?:v=|youtu\.be\/)([^&]+)/)?.[1] || ""}`}
              className="absolute inset-0 w-full h-full rounded-lg"
              allowFullScreen
              frameBorder="0"
            />
          </div>
        );
      case "table":
        return (
          <table key={index} className="border-collapse w-full">
            <tbody>{renderChildren(node.content)}</tbody>
          </table>
        );
      case "tableRow":
        return <tr key={index}>{renderChildren(node.content)}</tr>;
      case "tableCell":
        return <td key={index} className="border border-border p-2">{renderChildren(node.content)}</td>;
      case "tableHeader":
        return <th key={index} className="border border-border p-2 bg-secondary/30 font-semibold">{renderChildren(node.content)}</th>;
      case "callout": {
        const calloutType = node.attrs?.type || "note";
        const colors: Record<string, string> = {
          note: "border-blue-200 bg-blue-50",
          tip: "border-green-200 bg-green-50",
          warning: "border-yellow-200 bg-yellow-50",
          important: "border-red-200 bg-red-50",
        };
        const labels: Record<string, string> = {
          note: "Note",
          tip: "Tip",
          warning: "Warning",
          important: "Important",
        };
        return (
          <div key={index} className={`border-l-4 p-4 rounded-r-lg my-4 ${colors[calloutType] || colors.note}`}>
            <p className="font-semibold text-sm mb-1">{labels[calloutType] || "Note"}</p>
            {renderChildren(node.content)}
          </div>
        );
      }
      case "text": {
        let el: React.ReactNode = node.text;
        if (node.marks) {
          for (const mark of node.marks) {
            switch (mark.type) {
              case "bold":
                el = <strong>{el}</strong>;
                break;
              case "italic":
                el = <em>{el}</em>;
                break;
              case "underline":
                el = <u>{el}</u>;
                break;
              case "strike":
                el = <s>{el}</s>;
                break;
              case "link": {
                const href = sanitizeUrl(mark.attrs?.href);
                if (href) {
                  el = <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary underline">{el}</a>;
                }
                break;
              }
              case "code":
                el = <code className="bg-secondary px-1 py-0.5 rounded text-sm">{el}</code>;
                break;
            }
          }
        }
        return el;
      }
      default:
        return null;
    }
  };

  const renderChildren = (children: any[] | undefined): React.ReactNode => {
    if (!children) return null;
    return children.map((child, i) => renderNode(child, i));
  };

  return <>{renderChildren(content.content)}</>;
}
