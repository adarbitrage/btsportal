import { Lock } from "lucide-react";

/**
 * Full-page locked screen shown when a member tries to reach a
 * content-access-gated route they are not entitled to.
 *
 * Intentionally NOT a redirect — the user stays at their URL and sees this
 * screen instead of silently bouncing to the dashboard.
 *
 * Deliberately contains NO upgrade pitch or plan-shopping CTA: upgrades
 * happen only through a sales coach on a call.
 */
export function ContentLockedScreen() {
  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center gap-6 p-8 max-w-2xl mx-auto w-full">
      <div className="text-center">
        <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
          <Lock className="w-7 h-7 text-primary" />
        </div>
        <h2 className="text-xl font-semibold text-foreground mb-2">
          This page is locked
        </h2>
        <p className="text-sm text-muted-foreground leading-relaxed">
          This content isn't included in your plan — talk to your coach for
          access.
        </p>
      </div>
    </div>
  );
}
