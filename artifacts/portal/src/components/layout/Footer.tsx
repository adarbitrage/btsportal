import { Link } from "wouter";

// Browsewrap footer — the platform Terms of Service is reachable here
// without requiring a signature (Task #1625 removed the onboarding signing
// gate; this is the sole in-app path to the ToS content going forward).
export function Footer() {
  return (
    <footer className="border-t border-border mt-8 py-4 px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto flex items-center justify-center sm:justify-start">
        <Link href="/legal/terms" className="text-xs text-muted-foreground hover:text-foreground underline">
          Terms of Service
        </Link>
      </div>
    </footer>
  );
}
