import { useState } from "react";
import { ArrowDown, X } from "lucide-react";
import "./_group.css";

/**
 * Preview: redesigned LiveChatCallout with a simulated TicketDesk chat bubble
 * (60px circle, bottom-right — matching the real widget's default placement)
 * so we can verify the arrow lands directly above it.
 */

const PRIMARY = "#1a56db";

function Callout({ raised = false }: { raised?: boolean }) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;
  return (
    <div
      className={`fixed right-3 sm:right-4 z-50 pointer-events-none flex flex-col items-end animate-in fade-in slide-in-from-bottom-3 duration-500 ${
        raised ? "bottom-56" : "bottom-44"
      }`}
    >
      <div
        className="pointer-events-auto relative max-w-[260px] rounded-2xl rounded-br-md text-white shadow-xl ring-1 ring-black/5 px-4 py-3 pr-9"
        style={{ backgroundColor: PRIMARY, boxShadow: "0 20px 25px -5px rgba(26,86,219,.25), 0 8px 10px -6px rgba(26,86,219,.25)" }}
      >
        <button
          type="button"
          aria-label="Dismiss"
          onClick={() => setDismissed(true)}
          className="absolute top-2 right-2 rounded-full p-1 text-white/70 hover:text-white hover:bg-white/15 transition-colors"
        >
          <X className="w-3.5 h-3.5" />
        </button>
        <p className="text-sm font-semibold leading-snug">Have questions?</p>
        <p className="text-sm leading-snug text-white/90">Chat with a live team member now.</p>
        <span
          aria-hidden="true"
          className="absolute -bottom-1.5 right-6 h-3 w-3 rotate-45"
          style={{ backgroundColor: PRIMARY }}
        />
      </div>
      <ArrowDown
        aria-hidden="true"
        className="mt-2 mr-5 w-7 h-7 drop-shadow-sm animate-bounce"
        style={{ color: PRIMARY }}
      />
    </div>
  );
}

export default function LiveChatCalloutPreview() {
  return (
    <div className="min-h-screen" style={{ background: "#faf9f7" }}>
      <div className="p-8 text-sm text-gray-500">
        Page content behind the callout. Bubble is the simulated TicketDesk widget.
      </div>
      {/* Simulated TicketDesk chat bubble: 64px, pinned at bottom: 96px like
          the portal's .woot-widget-bubble { bottom: 96px !important } rule */}
      <div
        className="fixed z-40 rounded-full flex items-center justify-center text-white font-bold"
        style={{ width: 64, height: 64, right: 20, bottom: 96, backgroundColor: PRIMARY }}
      >
        💬
      </div>
      <Callout />
    </div>
  );
}
