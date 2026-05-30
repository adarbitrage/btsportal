import { useEffect } from "react";

const scriptPromises = new Map<string, Promise<void>>();

function loadScriptOnce(src: string): Promise<void> {
  const cached = scriptPromises.get(src);
  if (cached) return cached;
  const p = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${src}"]`,
    );
    if (existing) {
      resolve();
      return;
    }
    const s = document.createElement("script");
    s.type = "text/javascript";
    s.async = true;
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`Failed to load script: ${src}`));
    document.head.appendChild(s);
  });
  scriptPromises.set(src, p);
  return p;
}

type VidalyticsEmbedProps = {
  embedId: string;
  loaderUrl: string;
  className?: string;
};

export function VidalyticsEmbed({ embedId, loaderUrl, className }: VidalyticsEmbedProps) {
  const containerId = `vidalytics_embed_${embedId}`;

  useEffect(() => {
    let cancelled = false;
    const w = window as any;
    if (!w.Vidalytics) w.Vidalytics = {};
    if (!w.VidalyticsL) w.VidalyticsL = {};
    if (!w._vidalytics) w._vidalytics = {};

    loadScriptOnce(loaderUrl + "loader.min.js")
      .then(() => {
        if (cancelled) return;
        const LoaderClass = w.VidalyticsL.Loader;
        if (!LoaderClass) return;
        if (!w._vidalytics.loaderInstance) {
          w._vidalytics.loaderInstance = new LoaderClass();
        }
        w._vidalytics.loaderInstance.loadScript(
          loaderUrl + "player.min.js",
          () => {
            if (cancelled) return;
            const container = document.getElementById(containerId);
            if (!container || container.dataset.vidalyticsRan === "true") return;
            const EmbedClass = w.Vidalytics.Embed;
            if (!EmbedClass) return;
            container.dataset.vidalyticsRan = "true";
            new EmbedClass().run(containerId);
          },
        );
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [containerId, loaderUrl]);

  return (
    <div className={className}>
      <div
        id={containerId}
        style={{ width: "100%", position: "relative", paddingTop: "56.25%" }}
      />
    </div>
  );
}
