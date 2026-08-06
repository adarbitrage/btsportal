import { ReactNode } from "react";
import { Sidebar } from "./Sidebar";
import { motion } from "framer-motion";
import { Footer } from "./Footer";
import { FeCallBar } from "./FeCallBar";
import { BackToTopButton } from "./BackToTopButton";
import { useFeCallBar } from "@/hooks/use-fe-call-bar";

// Note: the old CallDayBanner (top-of-page "today's call" strip) was
// retired in favor of the persistent NextCallPanel now rendered in the
// Sidebar (Task #1688). The sidebar panel already emphasizes "Join Call
// Now" on the day of the call, so keeping both would show two competing
// join-call prompts on every page.
export function AppLayout({ children }: { children: ReactNode }) {
  // FE-members' "book your call" bottom bar (fail-closed visibility hook).
  // When visible, the layout gets matching bottom padding so the fixed bar
  // never covers page content or the footer.
  const showFeCallBar = useFeCallBar();
  return (
    <div className={`flex min-h-screen bg-background${showFeCallBar ? " pb-24 sm:pb-16" : ""}`}>
      <Sidebar />
      <main className="flex-1 w-full min-w-0 relative flex flex-col">
        <div className="pt-16 md:pt-0 flex-1">
          <div className="max-w-7xl mx-auto p-4 sm:p-6 lg:p-8">
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, ease: "easeOut" }}
            >
              {children}
            </motion.div>
          </div>
        </div>
        <Footer />
      </main>
      <BackToTopButton raised={showFeCallBar} />
      {showFeCallBar && <FeCallBar />}
    </div>
  );
}
