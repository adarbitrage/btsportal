import React, { useState } from 'react';
import './_group.css';
import { AppLayout } from './_shared/AppLayout';
import {
  Ticket,
  Plus,
  Search,
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
  Billing: 'bg-[#fef3c7] text-[#b45309]',
  Technical: 'bg-[#fef2f2] text-[#dc2626]',
  Training: 'bg-[#eff6ff] text-[#1a56db]',
  Account: 'bg-[#f3f4f6] text-[#4b5563]',
};

const PRIORITY_COLORS: Record<string, string> = {
  Urgent: '#dc2626',
  High: '#d97706',
  Normal: '#1a56db',
  Low: '#888888',
};

const STATUS_STYLES: Record<string, { bg: string, color: string }> = {
  'Open': { bg: '#eff6ff', color: '#1a56db' },
  'In Progress': { bg: '#fef3c7', color: '#b45309' },
  'Awaiting Response': { bg: '#faf5ff', color: '#7c3aed' },
  'Resolved': { bg: '#f0fdf4', color: '#16a34a' },
  'Closed': { bg: '#f3f4f6', color: '#6b7280' },
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
      <div className="flex-1 overflow-y-auto" style={{ backgroundColor: '#faf9f7' }}>
        <div className="max-w-6xl mx-auto p-6 lg:p-10 space-y-8">
          
          {/* Header */}
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-[#e8e4dc] pb-6">
            <div>
              <h1 className="text-3xl font-bold text-[#2d2d2d] mb-2" style={{ fontFamily: "'Playfair Display', serif" }}>Support Center</h1>
              <div className="flex items-center gap-2 text-sm text-[#5a5a5a]" style={{ fontFamily: "'Source Serif Pro', Georgia, serif" }}>
                <span>Get help with your account, billing, or technical issues</span>
              </div>
            </div>
            
            <button 
              onClick={() => setActiveTab('new')}
              className="flex items-center gap-2 px-5 py-2.5 rounded transition-colors shadow-sm"
              style={{ 
                backgroundColor: '#1a56db', 
                color: '#ffffff', 
                fontFamily: "'Source Sans Pro', sans-serif",
                fontWeight: 600
              }}
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
              <div className="flex items-center gap-6 border-b border-[#e8e4dc]">
                {[
                  { id: 'tickets', label: 'My Tickets' },
                  { id: 'new', label: 'New Ticket' },
                  { id: 'kb', label: 'Knowledge Base' }
                ].map(tab => (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className="py-3 text-[14px] font-bold uppercase tracking-wide transition-colors relative"
                    style={{ 
                      fontFamily: "'Source Sans Pro', sans-serif",
                      color: activeTab === tab.id ? '#1a56db' : '#5a5a5a'
                    }}
                  >
                    {tab.label}
                    {activeTab === tab.id && (
                      <div className="absolute bottom-[-1px] left-0 w-full h-[2px] bg-[#1a56db]" />
                    )}
                  </button>
                ))}
              </div>

              {/* Tab Content */}
              <div 
                className="bg-white rounded overflow-hidden shadow-sm"
                style={{ border: '1px solid #e8e4dc' }}
              >
                
                {/* Tickets Tab */}
                {activeTab === 'tickets' && (
                  <div className="divide-y divide-[#e8e4dc]">
                    {/* Filters bar */}
                    <div className="p-4 flex flex-col sm:flex-row gap-4 justify-between items-center bg-[#faf9f7] border-b border-[#e8e4dc]">
                      <div className="relative w-full sm:w-64">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#888]" />
                        <input 
                          type="text" 
                          placeholder="Search tickets..." 
                          className="w-full bg-white border border-[#e8e4dc] text-[#2d2d2d] placeholder:text-[#888] rounded pl-9 pr-4 py-2 text-sm focus:outline-none focus:border-[#1a56db] focus:ring-1 focus:ring-[#1a56db]"
                          style={{ fontFamily: "'Source Sans Pro', sans-serif" }}
                        />
                      </div>
                      <div className="flex items-center gap-2 w-full sm:w-auto">
                        <select 
                          className="w-full sm:w-auto bg-white border border-[#e8e4dc] text-[#2d2d2d] rounded px-3 py-2 text-sm focus:outline-none focus:border-[#1a56db]"
                          style={{ fontFamily: "'Source Sans Pro', sans-serif" }}
                        >
                          <option>All Statuses</option>
                          <option>Open</option>
                          <option>In Progress</option>
                          <option>Resolved</option>
                        </select>
                      </div>
                    </div>

                    {/* Ticket List */}
                    <div className="divide-y divide-[#e8e4dc]">
                      {TICKETS.map(ticket => (
                        <div key={ticket.id} className="p-5 hover:bg-[#faf9f7] transition-colors group cursor-pointer">
                          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                            <div className="space-y-2 flex-1">
                              <div className="flex items-center gap-3">
                                <span className="text-xs font-mono text-[#888]">#{ticket.id}</span>
                                <h3 
                                  className="text-[16px] font-bold text-[#2d2d2d] group-hover:text-[#1a56db] transition-colors"
                                  style={{ fontFamily: "'Playfair Display', serif" }}
                                >
                                  {ticket.subject}
                                </h3>
                              </div>
                              <div className="flex flex-wrap items-center gap-3 text-xs" style={{ fontFamily: "'Source Sans Pro', sans-serif" }}>
                                <span className={`px-2 py-0.5 rounded text-[10px] uppercase font-bold tracking-wider ${CATEGORY_COLORS[ticket.category] || CATEGORY_COLORS.Account}`}>
                                  {ticket.category}
                                </span>
                                <div className="flex items-center gap-1.5 text-[#5a5a5a]">
                                  <div className="w-2 h-2 rounded-full" style={{ backgroundColor: PRIORITY_COLORS[ticket.priority] }} />
                                  <span>{ticket.priority} Priority</span>
                                </div>
                                <span className="text-[#888]">&bull;</span>
                                <div className="flex items-center gap-1.5 text-[#5a5a5a]">
                                  <Clock className="w-3.5 h-3.5" />
                                  <span>Created {ticket.created}</span>
                                </div>
                              </div>
                            </div>
                            
                            <div className="flex items-center justify-between md:flex-col md:items-end gap-3 min-w-[140px]">
                              <span 
                                className="px-2.5 py-1 rounded text-[11px] font-bold uppercase tracking-[1px]"
                                style={{ 
                                  backgroundColor: STATUS_STYLES[ticket.status].bg,
                                  color: STATUS_STYLES[ticket.status].color,
                                  fontFamily: "'Source Sans Pro', sans-serif"
                                }}
                              >
                                {ticket.status}
                              </span>
                              <div className="text-xs text-[#888]" style={{ fontFamily: "'Source Sans Pro', sans-serif" }}>
                                {ticket.status === 'Resolved' ? `Resolved: ${ticket.updated}` : `Updated: ${ticket.updated}`}
                              </div>
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
                      <h2 className="text-2xl font-bold text-[#2d2d2d] mb-2" style={{ fontFamily: "'Playfair Display', serif" }}>Submit a Request</h2>
                      <p className="text-[#5a5a5a]" style={{ fontFamily: "'Source Serif Pro', Georgia, serif" }}>Please provide as much detail as possible so we can help you quickly.</p>
                    </div>

                    <form className="space-y-6" onSubmit={e => e.preventDefault()} style={{ fontFamily: "'Source Sans Pro', sans-serif" }}>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="space-y-2">
                          <label className="text-sm font-bold text-[#2d2d2d] uppercase tracking-wide">Category</label>
                          <select 
                            value={ticketCategory}
                            onChange={(e) => setTicketCategory(e.target.value)}
                            className="w-full bg-white border border-[#e8e4dc] text-[#2d2d2d] rounded px-4 py-3 focus:outline-none focus:border-[#1a56db] focus:ring-1 focus:ring-[#1a56db] shadow-sm"
                          >
                            <option value="" disabled>Select category...</option>
                            <option value="Billing">Billing & Payments</option>
                            <option value="Technical">Technical Issue</option>
                            <option value="Training">Training Content</option>
                            <option value="Account">Account Settings</option>
                            <option value="Other">Other</option>
                          </select>
                        </div>
                        
                        <div className="space-y-2">
                          <label className="text-sm font-bold text-[#2d2d2d] uppercase tracking-wide">Subject</label>
                          <input 
                            type="text"
                            value={ticketSubject}
                            onChange={(e) => setTicketSubject(e.target.value)}
                            placeholder="Brief description of the issue"
                            className="w-full bg-white border border-[#e8e4dc] text-[#2d2d2d] rounded px-4 py-3 focus:outline-none focus:border-[#1a56db] focus:ring-1 focus:ring-[#1a56db] shadow-sm placeholder:text-[#888]"
                          />
                        </div>
                      </div>

                      <div className="space-y-2">
                        <label className="text-sm font-bold text-[#2d2d2d] uppercase tracking-wide">Description</label>
                        <textarea 
                          rows={6}
                          value={ticketDescription}
                          onChange={(e) => setTicketDescription(e.target.value)}
                          placeholder="Please describe your issue in detail..."
                          className="w-full bg-white border border-[#e8e4dc] text-[#2d2d2d] rounded px-4 py-3 focus:outline-none focus:border-[#1a56db] focus:ring-1 focus:ring-[#1a56db] resize-none shadow-sm placeholder:text-[#888]"
                          style={{ fontFamily: "'Source Serif Pro', Georgia, serif" }}
                        ></textarea>
                      </div>

                      <div className="space-y-2">
                        <label className="text-sm font-bold text-[#2d2d2d] uppercase tracking-wide">Attachments</label>
                        <div className="border border-dashed border-[#d4cfc7] rounded p-8 flex flex-col items-center justify-center text-center bg-[#faf9f7] hover:bg-[#f5f2ed] transition-colors cursor-pointer group">
                          <div className="w-12 h-12 rounded-full bg-white border border-[#e8e4dc] flex items-center justify-center mb-3 shadow-sm group-hover:border-[#1a56db] transition-colors">
                            <UploadCloud className="w-5 h-5 text-[#5a5a5a] group-hover:text-[#1a56db]" />
                          </div>
                          <p className="text-sm text-[#2d2d2d] font-bold mb-1">Click to upload or drag and drop</p>
                          <p className="text-xs text-[#888]">SVG, PNG, JPG or PDF (max. 10MB)</p>
                        </div>
                      </div>

                      <div className="pt-6 flex justify-end gap-3 border-t border-[#e8e4dc]">
                        <button 
                          type="button"
                          onClick={() => setActiveTab('tickets')}
                          className="px-6 py-2.5 text-sm font-bold text-[#5a5a5a] bg-transparent hover:bg-[#f5f2ed] border border-[#e8e4dc] rounded transition-colors"
                        >
                          Cancel
                        </button>
                        <button 
                          type="submit"
                          className="px-6 py-2.5 text-sm font-bold text-white bg-[#1a56db] hover:bg-[#1e40af] rounded shadow-sm transition-colors"
                        >
                          Submit Ticket
                        </button>
                      </div>
                    </form>
                  </div>
                )}

                {/* Knowledge Base Tab */}
                {activeTab === 'kb' && (
                  <div className="p-6 space-y-8">
                    <div className="relative">
                      <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-[#888]" />
                      <input 
                        type="text" 
                        placeholder="Search for answers..." 
                        className="w-full bg-[#faf9f7] border border-[#e8e4dc] text-[#2d2d2d] placeholder:text-[#888] rounded pl-12 pr-4 py-4 text-base focus:outline-none focus:border-[#1a56db] focus:ring-1 focus:ring-[#1a56db] shadow-sm"
                        style={{ fontFamily: "'Source Sans Pro', sans-serif" }}
                      />
                    </div>
                    
                    <div>
                      <h3 className="text-sm font-bold text-[#2d2d2d] uppercase tracking-wide mb-4" style={{ fontFamily: "'Source Sans Pro', sans-serif" }}>Popular Articles</h3>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {KB_ARTICLES.map((article, i) => (
                          <div key={i} className="p-5 rounded border border-[#e8e4dc] bg-white hover:border-[#1a56db] hover:shadow-sm transition-all cursor-pointer group flex gap-4">
                            <div className="w-10 h-10 rounded bg-[#eff6ff] flex items-center justify-center shrink-0">
                              <article.icon className="w-5 h-5 text-[#1a56db]" />
                            </div>
                            <div>
                              <h4 className="text-[16px] font-bold text-[#2d2d2d] group-hover:text-[#1a56db] transition-colors mb-1" style={{ fontFamily: "'Playfair Display', serif" }}>{article.title}</h4>
                              <p className="text-sm text-[#5a5a5a] leading-relaxed" style={{ fontFamily: "'Source Serif Pro', Georgia, serif" }}>{article.desc}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
                
              </div>
            </div>

            {/* Right Column (Sidebar) */}
            <div className="w-full lg:w-80 space-y-6 shrink-0">
              
              {/* SLA Card */}
              <div 
                className="bg-[#f5f2ed] rounded shadow-sm relative overflow-hidden"
                style={{ border: '1px solid #e8e4dc', borderLeft: '4px solid #1a56db' }}
              >
                <div className="p-6 relative z-10">
                  <div className="flex items-center gap-2 mb-5">
                    <Clock className="w-5 h-5 text-[#1a56db]" />
                    <h3 className="text-lg font-bold text-[#2d2d2d]" style={{ fontFamily: "'Playfair Display', serif" }}>Your SLA: Gold Tier</h3>
                  </div>
                  
                  <div className="space-y-5" style={{ fontFamily: "'Source Sans Pro', sans-serif" }}>
                    <div className="space-y-1.5">
                      <div className="flex justify-between text-sm">
                        <span className="text-[#5a5a5a]">First response</span>
                        <span className="text-[#2d2d2d] font-bold">&lt; 4 hours</span>
                      </div>
                      <div className="w-full h-1.5 bg-[#e8e4dc] rounded-full overflow-hidden">
                        <div className="h-full bg-[#1a56db] w-[80%] rounded-full"></div>
                      </div>
                    </div>
                    
                    <div className="space-y-1.5">
                      <div className="flex justify-between text-sm">
                        <span className="text-[#5a5a5a]">Resolution target</span>
                        <span className="text-[#2d2d2d] font-bold">&lt; 48 hours</span>
                      </div>
                      <div className="w-full h-1.5 bg-[#e8e4dc] rounded-full overflow-hidden">
                        <div className="h-full bg-[#1a56db] w-[40%] rounded-full"></div>
                      </div>
                    </div>
                    
                    <div className="pt-4 border-t border-[#e8e4dc]">
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-[#5a5a5a] font-bold uppercase tracking-wide">Current avg response:</span>
                        <span className="text-sm font-bold text-[#16a34a]">2.1 hours</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Quick Links */}
              <div className="bg-white border border-[#e8e4dc] rounded shadow-sm p-6">
                <h3 className="text-lg font-bold text-[#2d2d2d] mb-4 flex items-center gap-2" style={{ fontFamily: "'Playfair Display', serif" }}>
                  <HelpCircle className="w-5 h-5 text-[#1a56db]" />
                  Need Quick Answers?
                </h3>
                
                <div className="space-y-2 mb-5" style={{ fontFamily: "'Source Sans Pro', sans-serif" }}>
                  {KB_ARTICLES.slice(0, 4).map((article, i) => (
                    <button key={i} className="w-full flex items-center justify-between py-2 text-left group border-b border-[#e8e4dc] last:border-0">
                      <span className="text-sm text-[#3d3d3d] font-medium group-hover:text-[#1a56db] transition-colors truncate pr-4">
                        {article.title}
                      </span>
                      <ChevronRight className="w-4 h-4 text-[#888] group-hover:text-[#1a56db]" />
                    </button>
                  ))}
                </div>
                
                <button 
                  onClick={() => setActiveTab('kb')}
                  className="w-full py-2.5 border border-[#e8e4dc] hover:bg-[#f5f2ed] text-sm font-bold text-[#2d2d2d] rounded transition-colors"
                  style={{ fontFamily: "'Source Sans Pro', sans-serif" }}
                >
                  View All Topics
                </button>
              </div>

              {/* Live Chat */}
              <div className="bg-[#eff6ff] border border-[#dbeafe] rounded p-6 text-center shadow-sm">
                <div className="w-12 h-12 bg-white rounded-full flex items-center justify-center mx-auto mb-4 border border-[#dbeafe] shadow-sm">
                  <MessageSquare className="w-5 h-5 text-[#1a56db]" />
                </div>
                <h3 className="text-lg font-bold text-[#2d2d2d] mb-1" style={{ fontFamily: "'Playfair Display', serif" }}>Live Chat Support</h3>
                <p className="text-xs text-[#5a5a5a] mb-5 font-bold uppercase tracking-wide" style={{ fontFamily: "'Source Sans Pro', sans-serif" }}>Available Mon-Fri, 9am-5pm EST</p>
                <button 
                  className="w-full py-2.5 bg-[#1a56db] text-white font-bold text-sm rounded hover:bg-[#1e40af] transition-colors shadow-sm"
                  style={{ fontFamily: "'Source Sans Pro', sans-serif" }}
                >
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
