export interface AdminTicket {
  id: number;
  ticketNumber: string;
  subject: string;
  category: string;
  priority: "urgent" | "high" | "normal" | "low";
  status: "open" | "in_progress" | "awaiting_response" | "resolved" | "closed";
  tier: "basic" | "standard" | "premium" | "vip";
  assignedAgent: string | null;
  memberName: string;
  memberEmail: string;
  createdAt: string;
  updatedAt: string;
  slaDeadline: string;
  slaStatus: "breached" | "approaching" | "within";
  firstResponseAt: string | null;
  resolvedAt: string | null;
  satisfactionRating: number | null;
  messages: AdminTicketMessage[];
}

export interface AdminTicketMessage {
  id: number;
  body: string;
  senderType: "member" | "admin";
  senderName: string;
  isInternal: boolean;
  createdAt: string;
}

export interface CannedResponse {
  id: number;
  title: string;
  category: string;
  body: string;
  variables: string[];
}

export interface RoutingRule {
  id: number;
  name: string;
  condition: string;
  conditionValue: string;
  assignTo: string;
  priority: string;
  enabled: boolean;
  order: number;
}

export interface AgentMetrics {
  name: string;
  avatar: string;
  ticketsHandled: number;
  avgResponseTime: number;
  avgResolutionTime: number;
  slaCompliance: number;
  satisfactionRating: number;
  openTickets: number;
}

const now = new Date();
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3600000).toISOString();
const daysAgo = (d: number) => new Date(now.getTime() - d * 86400000).toISOString();

export const mockTickets: AdminTicket[] = [
  {
    id: 1, ticketNumber: "BTS-100234", subject: "Payment not processing for upgrade",
    category: "billing", priority: "urgent", status: "open", tier: "vip",
    assignedAgent: "Sarah Chen", memberName: "John Smith", memberEmail: "john@example.com",
    createdAt: hoursAgo(2), updatedAt: hoursAgo(1), slaDeadline: hoursAgo(-1),
    slaStatus: "approaching", firstResponseAt: null, resolvedAt: null, satisfactionRating: null,
    messages: [
      { id: 1, body: "I'm trying to upgrade my plan but the payment keeps failing. I've tried 3 different cards.", senderType: "member", senderName: "John Smith", isInternal: false, createdAt: hoursAgo(2) },
    ]
  },
  {
    id: 2, ticketNumber: "BTS-100235", subject: "Cannot access training module 5",
    category: "technical", priority: "high", status: "in_progress", tier: "premium",
    assignedAgent: "Mike Johnson", memberName: "Alice Brown", memberEmail: "alice@example.com",
    createdAt: hoursAgo(8), updatedAt: hoursAgo(3), slaDeadline: hoursAgo(1),
    slaStatus: "breached", firstResponseAt: hoursAgo(6), resolvedAt: null, satisfactionRating: null,
    messages: [
      { id: 2, body: "Module 5 shows a blank page when I try to load it.", senderType: "member", senderName: "Alice Brown", isInternal: false, createdAt: hoursAgo(8) },
      { id: 3, body: "I've checked and this seems to be a caching issue. Let me escalate.", senderType: "admin", senderName: "Mike Johnson", isInternal: false, createdAt: hoursAgo(6) },
      { id: 4, body: "Engineering confirmed CDN cache issue. They're purging now.", senderType: "admin", senderName: "Mike Johnson", isInternal: true, createdAt: hoursAgo(4) },
    ]
  },
  {
    id: 3, ticketNumber: "BTS-100236", subject: "Need training schedule change",
    category: "training", priority: "normal", status: "awaiting_response", tier: "standard",
    assignedAgent: "Sarah Chen", memberName: "David Lee", memberEmail: "david@example.com",
    createdAt: daysAgo(1), updatedAt: hoursAgo(12), slaDeadline: hoursAgo(-24),
    slaStatus: "within", firstResponseAt: hoursAgo(20), resolvedAt: null, satisfactionRating: null,
    messages: [
      { id: 5, body: "Can I switch to the Tuesday/Thursday cohort?", senderType: "member", senderName: "David Lee", isInternal: false, createdAt: daysAgo(1) },
      { id: 6, body: "Sure! I can move you. Do you want to start next week?", senderType: "admin", senderName: "Sarah Chen", isInternal: false, createdAt: hoursAgo(20) },
    ]
  },
  {
    id: 4, ticketNumber: "BTS-100237", subject: "Account locked after password reset",
    category: "account", priority: "urgent", status: "open", tier: "basic",
    assignedAgent: null, memberName: "Emma Wilson", memberEmail: "emma@example.com",
    createdAt: hoursAgo(1), updatedAt: hoursAgo(1), slaDeadline: hoursAgo(-2),
    slaStatus: "within", firstResponseAt: null, resolvedAt: null, satisfactionRating: null,
    messages: [
      { id: 7, body: "I reset my password but now my account is completely locked. I can't log in at all.", senderType: "member", senderName: "Emma Wilson", isInternal: false, createdAt: hoursAgo(1) },
    ]
  },
  {
    id: 5, ticketNumber: "BTS-100238", subject: "Coaching call recording missing",
    category: "technical", priority: "high", status: "open", tier: "vip",
    assignedAgent: "Lisa Wang", memberName: "Robert Taylor", memberEmail: "robert@example.com",
    createdAt: hoursAgo(5), updatedAt: hoursAgo(3), slaDeadline: hoursAgo(0.5),
    slaStatus: "breached", firstResponseAt: null, resolvedAt: null, satisfactionRating: null,
    messages: [
      { id: 8, body: "My coaching call from yesterday doesn't have a recording. This was a really important session.", senderType: "member", senderName: "Robert Taylor", isInternal: false, createdAt: hoursAgo(5) },
    ]
  },
  {
    id: 6, ticketNumber: "BTS-100239", subject: "Billing discrepancy on invoice",
    category: "billing", priority: "normal", status: "resolved", tier: "standard",
    assignedAgent: "Mike Johnson", memberName: "Sarah Park", memberEmail: "sarah.p@example.com",
    createdAt: daysAgo(3), updatedAt: daysAgo(1), slaDeadline: daysAgo(2),
    slaStatus: "within", firstResponseAt: daysAgo(2.5), resolvedAt: daysAgo(1), satisfactionRating: 5,
    messages: [
      { id: 9, body: "I was charged $99 but my plan should be $79.", senderType: "member", senderName: "Sarah Park", isInternal: false, createdAt: daysAgo(3) },
      { id: 10, body: "You're right, there was a prorating error. I've issued a $20 refund.", senderType: "admin", senderName: "Mike Johnson", isInternal: false, createdAt: daysAgo(2.5) },
      { id: 11, body: "Thank you so much!", senderType: "member", senderName: "Sarah Park", isInternal: false, createdAt: daysAgo(1) },
    ]
  },
  {
    id: 7, ticketNumber: "BTS-100240", subject: "Request for group coaching upgrade",
    category: "account", priority: "low", status: "closed", tier: "basic",
    assignedAgent: "Sarah Chen", memberName: "Tom Harris", memberEmail: "tom@example.com",
    createdAt: daysAgo(5), updatedAt: daysAgo(3), slaDeadline: daysAgo(4),
    slaStatus: "within", firstResponseAt: daysAgo(4.5), resolvedAt: daysAgo(3), satisfactionRating: 4,
    messages: [
      { id: 12, body: "How do I upgrade to get group coaching access?", senderType: "member", senderName: "Tom Harris", isInternal: false, createdAt: daysAgo(5) },
      { id: 13, body: "You can upgrade from your account settings. I've sent you a direct link.", senderType: "admin", senderName: "Sarah Chen", isInternal: false, createdAt: daysAgo(4.5) },
    ]
  },
  {
    id: 8, ticketNumber: "BTS-100241", subject: "Video player buffering issues",
    category: "technical", priority: "normal", status: "in_progress", tier: "premium",
    assignedAgent: "Lisa Wang", memberName: "Jennifer Kim", memberEmail: "jen@example.com",
    createdAt: daysAgo(2), updatedAt: hoursAgo(6), slaDeadline: hoursAgo(-6),
    slaStatus: "within", firstResponseAt: daysAgo(1.5), resolvedAt: null, satisfactionRating: null,
    messages: [
      { id: 14, body: "Videos keep buffering every 10 seconds. My internet is fine.", senderType: "member", senderName: "Jennifer Kim", isInternal: false, createdAt: daysAgo(2) },
      { id: 15, body: "Could you try clearing your browser cache and testing in incognito mode?", senderType: "admin", senderName: "Lisa Wang", isInternal: false, createdAt: daysAgo(1.5) },
      { id: 16, body: "Still happening in incognito.", senderType: "member", senderName: "Jennifer Kim", isInternal: false, createdAt: daysAgo(1) },
      { id: 17, body: "User is on Chrome 120. Video CDN shows slow responses from their region (US-West). Escalating to infra.", senderType: "admin", senderName: "Lisa Wang", isInternal: true, createdAt: hoursAgo(6) },
    ]
  },
];

export const mockCannedResponses: CannedResponse[] = [
  { id: 1, title: "Initial Greeting", category: "General", body: "Hi {{member_name}},\n\nThank you for reaching out to BTS Support! I'm {{agent_name}} and I'll be helping you today.\n\n", variables: ["member_name", "agent_name"] },
  { id: 2, title: "Request More Info", category: "General", body: "Hi {{member_name}},\n\nTo help resolve this, could you please provide:\n- Your browser and version\n- Steps to reproduce the issue\n- Any error messages you see\n\nThank you!", variables: ["member_name"] },
  { id: 3, title: "Billing Refund Issued", category: "Billing", body: "Hi {{member_name}},\n\nI've issued a refund of {{refund_amount}} to your payment method on file. It may take 5-10 business days to appear on your statement.\n\nIs there anything else I can help with?", variables: ["member_name", "refund_amount"] },
  { id: 4, title: "Password Reset Instructions", category: "Account", body: "Hi {{member_name}},\n\nTo reset your password:\n1. Go to the login page\n2. Click 'Forgot Password'\n3. Enter your email: {{member_email}}\n4. Check your inbox for the reset link\n\nThe link expires in 24 hours.", variables: ["member_name", "member_email"] },
  { id: 5, title: "Escalation Notice", category: "Technical", body: "Hi {{member_name}},\n\nI've escalated your issue to our technical team for further investigation. You'll receive an update within {{sla_hours}} hours.\n\nWe appreciate your patience!", variables: ["member_name", "sla_hours"] },
  { id: 6, title: "Cache Clear Instructions", category: "Technical", body: "Hi {{member_name}},\n\nPlease try the following:\n1. Clear your browser cache (Ctrl+Shift+Delete)\n2. Close all browser tabs\n3. Reopen the browser and try again\n\nIf the issue persists, please let us know.", variables: ["member_name"] },
  { id: 7, title: "Ticket Resolution", category: "General", body: "Hi {{member_name}},\n\nGreat news - your issue has been resolved! Here's a summary:\n\n{{resolution_summary}}\n\nIf you experience any further issues, don't hesitate to reach out. We're here to help!\n\nBest regards,\n{{agent_name}}", variables: ["member_name", "resolution_summary", "agent_name"] },
  { id: 8, title: "Upgrade Instructions", category: "Account", body: "Hi {{member_name}},\n\nTo upgrade your plan:\n1. Go to Account Settings\n2. Click 'Manage Subscription'\n3. Select your desired plan\n4. Complete the payment\n\nYour new features will be available immediately after upgrading.", variables: ["member_name"] },
];

export const mockRoutingRules: RoutingRule[] = [
  { id: 1, name: "VIP Priority", condition: "tier", conditionValue: "vip", assignTo: "Sarah Chen", priority: "high", enabled: true, order: 1 },
  { id: 2, name: "Billing Issues", condition: "category", conditionValue: "billing", assignTo: "Mike Johnson", priority: "normal", enabled: true, order: 2 },
  { id: 3, name: "Technical Escalation", condition: "category", conditionValue: "technical", assignTo: "Lisa Wang", priority: "normal", enabled: true, order: 3 },
  { id: 4, name: "Account Issues", condition: "category", conditionValue: "account", assignTo: "Sarah Chen", priority: "normal", enabled: true, order: 4 },
  { id: 5, name: "Urgent Tickets", condition: "priority", conditionValue: "urgent", assignTo: "Lisa Wang", priority: "urgent", enabled: false, order: 5 },
];

export const mockAgentMetrics: AgentMetrics[] = [
  { name: "Sarah Chen", avatar: "SC", ticketsHandled: 156, avgResponseTime: 1.2, avgResolutionTime: 18.5, slaCompliance: 96.2, satisfactionRating: 4.8, openTickets: 8 },
  { name: "Mike Johnson", avatar: "MJ", ticketsHandled: 132, avgResponseTime: 2.1, avgResolutionTime: 24.3, slaCompliance: 89.5, satisfactionRating: 4.5, openTickets: 12 },
  { name: "Lisa Wang", avatar: "LW", ticketsHandled: 178, avgResponseTime: 0.8, avgResolutionTime: 15.2, slaCompliance: 98.1, satisfactionRating: 4.9, openTickets: 5 },
  { name: "James Rodriguez", avatar: "JR", ticketsHandled: 98, avgResponseTime: 3.4, avgResolutionTime: 32.1, slaCompliance: 82.3, satisfactionRating: 4.2, openTickets: 15 },
];

export const mockAnalyticsData = {
  ticketsByStatus: [
    { status: "Open", count: 24 },
    { status: "In Progress", count: 18 },
    { status: "Awaiting Response", count: 12 },
    { status: "Resolved", count: 45 },
    { status: "Closed", count: 89 },
  ],
  volumeTrend: [
    { date: "Mon", opened: 12, closed: 8 },
    { date: "Tue", opened: 15, closed: 11 },
    { date: "Wed", opened: 8, closed: 14 },
    { date: "Thu", opened: 18, closed: 10 },
    { date: "Fri", opened: 22, closed: 16 },
    { date: "Sat", opened: 6, closed: 9 },
    { date: "Sun", opened: 4, closed: 5 },
  ],
  slaByTier: [
    { tier: "VIP", compliance: 98.5, target: 99 },
    { tier: "Premium", compliance: 94.2, target: 95 },
    { tier: "Standard", compliance: 88.7, target: 85 },
    { tier: "Basic", compliance: 82.1, target: 80 },
  ],
  categoryBreakdown: [
    { category: "Technical", count: 42, percentage: 28 },
    { category: "Billing", count: 35, percentage: 23 },
    { category: "Account", count: 30, percentage: 20 },
    { category: "Training", count: 25, percentage: 17 },
    { category: "Other", count: 18, percentage: 12 },
  ],
  satisfactionDistribution: [
    { rating: "5 Stars", count: 45 },
    { rating: "4 Stars", count: 32 },
    { rating: "3 Stars", count: 12 },
    { rating: "2 Stars", count: 5 },
    { rating: "1 Star", count: 2 },
  ],
  busyHours: [
    { hour: "6am", mon: 1, tue: 0, wed: 1, thu: 0, fri: 1, sat: 0, sun: 0 },
    { hour: "8am", mon: 5, tue: 4, wed: 3, thu: 6, fri: 5, sat: 1, sun: 0 },
    { hour: "10am", mon: 12, tue: 15, wed: 10, thu: 14, fri: 18, sat: 3, sun: 1 },
    { hour: "12pm", mon: 8, tue: 10, wed: 12, thu: 9, fri: 11, sat: 4, sun: 2 },
    { hour: "2pm", mon: 14, tue: 12, wed: 15, thu: 16, fri: 20, sat: 2, sun: 1 },
    { hour: "4pm", mon: 10, tue: 8, wed: 11, thu: 12, fri: 14, sat: 1, sun: 0 },
    { hour: "6pm", mon: 6, tue: 5, wed: 7, thu: 4, fri: 8, sat: 2, sun: 1 },
    { hour: "8pm", mon: 3, tue: 2, wed: 4, thu: 3, fri: 5, sat: 1, sun: 0 },
    { hour: "10pm", mon: 1, tue: 1, wed: 2, thu: 1, fri: 2, sat: 0, sun: 0 },
  ],
};
