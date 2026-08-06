import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { pinTicketDeskBubble } from "./lib/ticketdesk-bubble-pin";

// The TicketDesk live-chat widget renders in an open shadow root that page
// CSS can't reach — pin its bubble above the AI launcher via style injection.
pinTicketDeskBubble();

createRoot(document.getElementById("root")!).render(<App />);
