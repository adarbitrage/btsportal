import { ReactNode } from "react";
import { Sidebar } from "./Sidebar";
import { motion } from "framer-motion";
import { CallDayBanner } from "./CallDayBanner";

export function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <main className="flex-1 w-full min-w-0 relative">
        <div className="pt-16 md:pt-0">
          <CallDayBanner />
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
      </main>
    </div>
  );
}
