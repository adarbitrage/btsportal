import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";

/**
 * View-only PDF renderer (Resource Hub gating task): renders every page of a
 * PDF blob onto <canvas> elements via pdf.js, so there is NO browser PDF
 * toolbar and therefore no built-in download/print/save-as control. The blob
 * is fetched by the caller through the authenticated content endpoint.
 *
 * Deliberately minimal: continuous vertical page list, sized to the container
 * width, re-rendered on container resize (debounced via rAF).
 */

type PdfJsModule = typeof import("pdfjs-dist");

let pdfjsPromise: Promise<PdfJsModule> | null = null;

async function loadPdfJs(): Promise<PdfJsModule> {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const pdfjs = await import("pdfjs-dist");
      const worker = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
      pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
      return pdfjs;
    })();
  }
  return pdfjsPromise;
}

export function PdfCanvasViewer({ data }: { data: ArrayBuffer }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [pageCount, setPageCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const container = containerRef.current;
    if (!container) return;

    (async () => {
      try {
        const pdfjs = await loadPdfJs();
        // pdf.js transfers the buffer to the worker — hand it a copy so a
        // React re-render (StrictMode double-effect) can't hit a detached one.
        const doc = await pdfjs.getDocument({ data: data.slice(0) }).promise;
        if (cancelled) return;
        setPageCount(doc.numPages);
        container.replaceChildren();

        const width = Math.min(container.clientWidth || 800, 1000);
        for (let i = 1; i <= doc.numPages; i++) {
          if (cancelled) return;
          const page = await doc.getPage(i);
          const base = page.getViewport({ scale: 1 });
          const scale = width / base.width;
          const dpr = Math.min(window.devicePixelRatio || 1, 2);
          const viewport = page.getViewport({ scale: scale * dpr });

          const canvas = document.createElement("canvas");
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          canvas.style.width = `${viewport.width / dpr}px`;
          canvas.style.height = `${viewport.height / dpr}px`;
          canvas.className = "block mx-auto mb-4 rounded-md border border-border shadow-sm bg-white";
          canvas.setAttribute("data-testid", `pdf-page-${i}`);
          container.appendChild(canvas);

          const ctx = canvas.getContext("2d");
          if (!ctx) continue;
          await page.render({ canvas, canvasContext: ctx, viewport }).promise;
        }
        if (!cancelled) setStatus("ready");
      } catch (err) {
        console.error("[PdfCanvasViewer] render error:", err);
        if (!cancelled) setStatus("error");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [data]);

  return (
    <div data-testid="pdf-canvas-viewer" onContextMenu={(e) => e.preventDefault()}>
      {status === "loading" && (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin mr-2" /> Preparing document…
        </div>
      )}
      {status === "error" && (
        <p className="text-sm text-destructive py-8">
          Couldn't display this document. Please refresh the page and try again.
        </p>
      )}
      <div ref={containerRef} />
      {status === "ready" && pageCount > 0 && (
        <p className="text-xs text-muted-foreground text-center pb-4" data-testid="text-page-count">
          {pageCount} page{pageCount === 1 ? "" : "s"} · viewable in the portal only
        </p>
      )}
    </div>
  );
}
