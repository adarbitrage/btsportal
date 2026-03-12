import React, { useState } from 'react';
import './_group.css';
import { AppLayout } from './_shared/AppLayout';
import {
  Ticket,
  Plus,
  Search,
  Paperclip,
  AlertCircle,
  CheckCircle,
  Clock,
  HelpCircle,
  BookOpen,
  ChevronRight,
  UploadCloud,
  MessageSquare
} from 'lucide-react';

// Mock data for tickets
const TICKETS = [
  {
    id: 'BTS-001247',
    subject: 'Payment method update issue',
    category: 'Billing',
    priority: 'High',
    status: 'In Progress',
    created: 'Mar 10',
    updated: '2 hours ago',
  },
  {
    id: 'BTS-001243',
    subject: "Can't access Module 5 content",
    category: 'Technical',
    priority: 'High',
    status: 'Awaiting Response',
    created: 'Mar 8',
    updated: '1 day ago',
  },
  {
    id: 'BTS-001238',
    subject: 'Question about ad creative sizing',
    category: 'Training',
    priority: 'Normal',
    status: 'Resolved',
    created: 'Mar 3',
    updated: 'Mar 4',
  },
];

const CATEGORY_COLORS: Record<string, string> = {
  Billing: 'bg-amber-500/10 text-amber-500 border-amber-500/20',
  Technical: 'bg-red-500/10 text-red-500 border-red-500/20',
  Training: 'bg-blue-500/10 text-blue-500 border-blue-500/20',
  Account: 'bg-purple-500/10 text-purple-500 border-purple-500/20',
};

const PRIORITY_COLORS: Record<string, string> = {
  Urgent: 'text-[#ef4444]',
  High: 'text-[#f97316]',
  Normal: 'text-[#3b82f6]',
  Low: 'text-[#6b7280]',
};

const STATUS_COLORS: Record<string, string> = {
  Open: 'bg-[#3b82f6]/10 text-[#3b82f6] border-[#3b82f6]/20',
  'In Progress': 'bg-[#f59e0b]/10 text-[#f59e0b] border-[#f59e0b]/20',
  'Awaiting Response': 'bg-[#8b5cf6]/10 text-[#8b5cf6] border-[#8b5cf6]/20',
  Resolved: 'bg-[#22c55e]/10 text-[#22c55e] border-[#22c55e]/20',
  Closed: 'bg-[#6b7280]/10 text-[#6b7280] border-[#6b7280]/20',
};

const KB_ARTICLES = [
  { title: 'Getting Started Guide', desc: 'The fundamentals of your BTS journey', icon: BookOpen },
  { title: 'Billing & Payments FAQ', desc: 'Invoices, payment methods, and plans', icon: Ticket },
  { title: 'Technical Troubleshooting', desc: 'Fix common access and display issues', icon: AlertCircle },
  { title: 'Training Module Help', desc: 'Navigating courses and coaching replays', icon: HelpCircle },
  { title: 'Account Settings Guide', desc: 'Manage your profile and notifications', icon: CheckCircle },
];

export function Support() {
  const [activeTab, setActiveTab] = useState('tickets');
  const [ticketSubject, setTicketSubject] = useState('');
  const [ticketCategory, setTicketCategory] = useState('');
  const [ticketDescription, setTicketDescription] = useState('');

  return (
    <AppLayout activePage="support" tier="gold" memberName="Marcus Johnson">
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-6xl mx-auto p-6 lg:p-8 space-y-8">
          
          {/* Header */}
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-[#f1f5f9] mb-2">Support Center</h1>
              <div className="flex items-center gap-2 text-sm text-[#94a3b8]">
                <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-[#fbbf24]/10 text-[#fbbf24] border border-[#fbbf24]/20 font-medium">
                  Gold Tier
                </span>
                <span>Unlimited tickets/month &mdash; 1 open</span>
              </div>
            </div>
            
            <button 
              onClick={() => setActiveTab('new')}
              className="flex items-center gap-2 bg-[#6366f1] hover:bg-[#4f46e5] text-white px-4 py-2.5 rounded-lg font-medium transition-colors"
            >
              <Plus className="w-4 h-4" />
              New Ticket
            </button>
          </div>

          {/* Main Layout */}
          <div className="flex flex-col lg:flex-row gap-8">
            
            {/* Left Column (Main Content) */}
            <div className="flex-1 space-y-6">
              
              {/* Tabs */}
              <div className="flex items-center gap-1 border-b border-[#334155]">
                {[
                  { id: 'tickets', label: 'My Tickets' },
                  { id: 'new', label: 'New Ticket' },
                  { id: 'kb', label: 'Knowledge Base' }
                ].map(tab => (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`px-5 py-3 text-sm font-medium border-b-2 transition-colors ${
                      activeTab === tab.id 
                        ? 'border-[#6366f1] text-[#6366f1]' 
                        : 'border-transparent text-[#94a3b8] hover:text-[#f1f5f9] hover:border-[#334155]'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {/* Tab Content */}
              <div className="bg-[#1e293b] border border-[#334155] rounded-xl overflow-hidden">
                
                {/* Tickets Tab */}
                {activeTab === 'tickets' && (
                  <div className="divide-y divide-[#334155]">
                    {/* Filters bar */}
                    <div className="p-4 flex flex-col sm:flex-row gap-4 justify-between items-center bg-[#1e293b]/50">
                      <div className="relative w-full sm:w-64">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#94a3b8]" />
                        <input 
                          type="text" 
                          placeholder="Search tickets..." 
                          className="w-full bg-[#0f172a] border border-[#334155] text-[#f1f5f9] placeholder:text-[#64748b] rounded-lg pl-9 pr-4 py-2 text-sm focus:outline-none focus:border-[#6366f1] focus:ring-1 focus:ring-[#6366f1]"
                        />
                      </div>
                      <div className="flex items-center gap-2 w-full sm:w-auto">
                        <select className="bg-[#0f172a] border border-[#334155] text-[#f1f5f9] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#6366f1]">
                          <option>All Statuses</option>
                          <option>Open</option>
                          <option>Resolved</option>
                        </select>
                      </div>
                    </div>

                    {/* Ticket List */}
                    <div className="divide-y divide-[#334155]">
                      {TICKETS.map(ticket => (
                        <div key={ticket.id} className="p-5 hover:bg-[#334155]/20 transition-colors group">
                          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                            <div className="space-y-2 flex-1">
                              <div className="flex items-center gap-3">
                                <span className="text-xs font-mono text-[#94a3b8]">#{ticket.id}</span>
                                <h3 className="text-[15px] font-medium text-[#f1f5f9] group-hover:text-[#6366f1] transition-colors cursor-pointer">
                                  {ticket.subject}
                                </h3>
                              </div>
                              <div className="flex flex-wrap items-center gap-3 text-xs">
                                <span className={`px-2 py-0.5 rounded-full border ${CATEGORY_COLORS[ticket.category]}`}>
                                  {ticket.category}
                                </span>
                                <div className="flex items-center gap-1.5 text-[#94a3b8]">
                                  <AlertCircle className={`w-3.5 h-3.5 ${PRIORITY_COLORS[ticket.priority]}`} />
                                  <span>{ticket.priority} Priority</span>
                                </div>
                                <span className="text-[#64748b]">&bull;</span>
                                <div className="flex items-center gap-1.5 text-[#94a3b8]">
                                  <Clock className="w-3.5 h-3.5" />
                                  <span>Created {ticket.created}</span>
                                </div>
                              </div>
                            </div>
                            
                            <div className="flex items-center justify-between md:flex-col md:items-end gap-3 min-w-[140px]">
                              <span className={`px-2.5 py-1 rounded-full text-xs font-medium border ${STATUS_COLORS[ticket.status]}`}>
                                {ticket.status}
                              </span>
                              <div className="text-xs text-[#64748b]">
                                {ticket.status === 'Resolved' ? `Resolved: ${ticket.updated}` : `Updated: ${ticket.updated}`}
                              </div>
                            </div>
                            
                            <div className="hidden md:flex ml-4">
                              <button className="w-8 h-8 rounded-full flex items-center justify-center text-[#94a3b8] hover:text-[#f1f5f9] hover:bg-[#334155] transition-colors">
                                <ChevronRight className="w-5 h-5" />
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* New Ticket Tab */}
                {activeTab === 'new' && (
                  <div className="p-6 md:p-8 space-y-6">
                    <div>
                      <h2 className="text-lg font-medium text-[#f1f5f9] mb-1">Submit a Request</h2>
                      <p className="text-sm text-[#94a3b8]">Please provide as much detail as possible so we can help you quickly.</p>
                    </div>

                    <form className="space-y-5" onSubmit={e => e.preventDefault()}>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                        <div className="space-y-1.5">
                          <label className="text-sm font-medium text-[#e2e8f0]">Category</label>
                          <select 
                            value={ticketCategory}
                            onChange={(e) => setTicketCategory(e.target.value)}
                            className="w-full bg-[#0f172a] border border-[#334155] text-[#f1f5f9] rounded-lg px-4 py-2.5 focus:outline-none focus:border-[#6366f1] focus:ring-1 focus:ring-[#6366f1]"
                          >
                            <option value="" disabled>Select category...</option>
                            <option value="Billing">Billing & Payments</option>
                            <option value="Technical">Technical Issue</option>
                            <option value="Training">Training Content</option>
                            <option value="Account">Account Settings</option>
                            <option value="Other">Other</option>
                          </select>
                        </div>
                        
                        <div className="space-y-1.5">
                          <label className="text-sm font-medium text-[#e2e8f0]">Subject</label>
                          <input 
                            type="text"
                            value={ticketSubject}
                            onChange={(e) => setTicketSubject(e.target.value)}
                            placeholder="Brief description of the issue"
                            className="w-full bg-[#0f172a] border border-[#334155] text-[#f1f5f9] rounded-lg px-4 py-2.5 focus:outline-none focus:border-[#6366f1] focus:ring-1 focus:ring-[#6366f1]"
                          />
                        </div>
                      </div>

                      <div className="space-y-1.5">
                        <label className="text-sm font-medium text-[#e2e8f0]">Description</label>
                        <textarea 
                          rows={6}
                          value={ticketDescription}
                          onChange={(e) => setTicketDescription(e.target.value)}
                          placeholder="Please describe your issue in detail..."
                          className="w-full bg-[#0f172a] border border-[#334155] text-[#f1f5f9] rounded-lg px-4 py-3 focus:outline-none focus:border-[#6366f1] focus:ring-1 focus:ring-[#6366f1] resize-none"
                        ></textarea>
                      </div>

                      <div className="space-y-1.5">
                        <label className="text-sm font-medium text-[#e2e8f0]">Attachments</label>
                        <div className="border-2 border-dashed border-[#334155] rounded-xl p-8 flex flex-col items-center justify-center text-center bg-[#0f172a]/50 hover:bg-[#334155]/20 transition-colors cursor-pointer group">
                          <div className="w-12 h-12 rounded-full bg-[#1e293b] flex items-center justify-center mb-3 group-hover:scale-110 transition-transform">
                            <UploadCloud className="w-6 h-6 text-[#94a3b8] group-hover:text-[#6366f1]" />
                          </div>
                          <p className="text-sm text-[#e2e8f0] font-medium mb-1">Click to upload or drag and drop</p>
                          <p className="text-xs text-[#64748b]">SVG, PNG, JPG or PDF (max. 10MB)</p>
                        </div>
                      </div>

                      <div className="pt-4 flex justify-end gap-3 border-t border-[#334155]">
                        <button 
                          type="button"
                          onClick={() => setActiveTab('tickets')}
                          className="px-5 py-2.5 text-sm font-medium text-[#e2e8f0] bg-transparent hover:bg-[#334155] rounded-lg transition-colors"
                        >
                          Cancel
                        </button>
                        <button 
                          type="submit"
                          className="px-5 py-2.5 text-sm font-medium text-white bg-[#6366f1] hover:bg-[#4f46e5] rounded-lg transition-colors"
                        >
                          Submit Ticket
                        </button>
                      </div>
                    </form>
                  </div>
                )}

                {/* Knowledge Base Tab */}
                {activeTab === 'kb' && (
                  <div className="p-6 space-y-6">
                    <div className="relative mb-6">
                      <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-[#94a3b8]" />
                      <input 
                        type="text" 
                        placeholder="Search for answers..." 
                        className="w-full bg-[#0f172a] border border-[#334155] text-[#f1f5f9] placeholder:text-[#64748b] rounded-xl pl-12 pr-4 py-4 text-base focus:outline-none focus:border-[#6366f1] focus:ring-1 focus:ring-[#6366f1]"
                      />
                    </div>
                    
                    <h3 className="text-sm font-medium text-[#94a3b8] uppercase tracking-wider mb-4">Popular Articles</h3>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {KB_ARTICLES.map((article, i) => (
                        <div key={i} className="p-4 rounded-xl border border-[#334155] bg-[#0f172a]/50 hover:bg-[#334155]/30 transition-colors cursor-pointer group flex gap-4">
                          <div className="w-10 h-10 rounded-lg bg-[#6366f1]/10 flex items-center justify-center shrink-0">
                            <article.icon className="w-5 h-5 text-[#6366f1]" />
                          </div>
                          <div>
                            <h4 className="text-[15px] font-medium text-[#e2e8f0] group-hover:text-[#818cf8] transition-colors mb-1">{article.title}</h4>
                            <p className="text-xs text-[#94a3b8] leading-relaxed">{article.desc}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                
              </div>
            </div>

            {/* Right Column (Sidebar) */}
            <div className="w-full lg:w-80 space-y-6 shrink-0">
              
              {/* SLA Card */}
              <div className="bg-[#1e293b] border border-[#334155] rounded-xl overflow-hidden relative">
                <div className="absolute top-0 right-0 w-32 h-32 bg-[#fbbf24]/10 rounded-bl-full -z-0"></div>
                <div className="p-5 relative z-10">
                  <div className="flex items-center gap-2 mb-4">
                    <Clock className="w-5 h-5 text-[#fbbf24]" />
                    <h3 className="font-semibold text-[#f1f5f9]">Your SLA: Gold Tier</h3>
                  </div>
                  
                  <div className="space-y-4">
                    <div className="space-y-1">
                      <div className="flex justify-between text-sm">
                        <span className="text-[#94a3b8]">First response</span>
                        <span className="text-[#e2e8f0] font-medium">&lt; 4 hours</span>
                      </div>
                      <div className="w-full h-1.5 bg-[#0f172a] rounded-full overflow-hidden">
                        <div className="h-full bg-[#fbbf24] w-[80%] rounded-full"></div>
                      </div>
                    </div>
                    
                    <div className="space-y-1">
                      <div className="flex justify-between text-sm">
                        <span className="text-[#94a3b8]">Resolution target</span>
                        <span className="text-[#e2e8f0] font-medium">&lt; 48 hours</span>
                      </div>
                      <div className="w-full h-1.5 bg-[#0f172a] rounded-full overflow-hidden">
                        <div className="h-full bg-[#fbbf24] w-[40%] rounded-full"></div>
                      </div>
                    </div>
                    
                    <div className="pt-3 border-t border-[#334155]">
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-[#94a3b8]">Current avg response:</span>
                        <span className="text-sm font-semibold text-[#22c55e]">2.1 hours</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Quick Links */}
              <div className="bg-[#1e293b] border border-[#334155] rounded-xl p-5">
                <h3 className="font-semibold text-[#f1f5f9] mb-4 flex items-center gap-2">
                  <HelpCircle className="w-4 h-4 text-[#6366f1]" />
                  Need Quick Answers?
                </h3>
                
                <div className="space-y-1">
                  {KB_ARTICLES.slice(0, 4).map((article, i) => (
                    <button key={i} className="w-full flex items-center justify-between p-2.5 rounded-lg hover:bg-[#334155]/50 transition-colors text-left group">
                      <span className="text-sm text-[#e2e8f0] group-hover:text-white truncate pr-4">
                        {article.title}
                      </span>
                      <ChevronRight className="w-4 h-4 text-[#64748b] group-hover:text-[#6366f1]" />
                    </button>
                  ))}
                </div>
                
                <button 
                  onClick={() => setActiveTab('kb')}
                  className="w-full mt-4 py-2 border border-[#334155] hover:bg-[#334155] text-sm font-medium text-[#e2e8f0] rounded-lg transition-colors"
                >
                  View All Topics
                </button>
              </div>

              {/* Live Chat */}
              <div className="bg-gradient-to-br from-[#6366f1]/20 to-[#8b5cf6]/20 border border-[#6366f1]/30 rounded-xl p-5 text-center">
                <div className="w-12 h-12 bg-gradient-to-br from-[#6366f1] to-[#8b5cf6] rounded-full flex items-center justify-center mx-auto mb-3 shadow-lg shadow-[#6366f1]/20">
                  <MessageSquare className="w-6 h-6 text-white" />
                </div>
                <h3 className="font-semibold text-white mb-1">Live Chat Support</h3>
                <p className="text-xs text-[#cbd5e1] mb-4">Available Mon-Fri, 9am-5pm EST</p>
                <button className="w-full py-2 bg-white text-[#4f46e5] font-semibold text-sm rounded-lg hover:bg-[#f8fafc] transition-colors">
                  Start Chat
                </button>
              </div>

            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
