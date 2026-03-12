import React from 'react';
import './_group.css';
import { AppLayout } from './_shared/AppLayout';
import { 
  Play, 
  Calendar, 
  Video, 
  BookOpen, 
  Clock, 
  Flame, 
  Ticket,
  ChevronRight,
  Bell,
  MessageSquare,
  Trophy,
  ArrowRight,
  Megaphone,
  CheckCircle2,
  AlertCircle
} from 'lucide-react';

export function Dashboard() {
  return (
    <AppLayout activePage="dashboard" tier="gold" memberName="Marcus Johnson">
      <div className="p-8 max-w-[1200px] mx-auto space-y-8 text-[#f1f5f9]">
        
        {/* Welcome Banner */}
        <div className="relative overflow-hidden rounded-2xl bg-[#1e293b] border border-[#334155] p-8 shadow-lg">
          <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-500/10 rounded-full blur-3xl -mr-16 -mt-16 pointer-events-none"></div>
          <div className="absolute bottom-0 left-1/2 w-48 h-48 bg-amber-500/10 rounded-full blur-3xl -mb-24 pointer-events-none"></div>
          
          <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
            <div>
              <div className="flex items-center gap-3 mb-2">
                <h1 className="text-3xl font-bold tracking-tight">Welcome back, Marcus</h1>
                <span className="px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider bg-amber-500/10 text-[#ffd700] border border-[#ffd700]/30 flex items-center gap-1.5">
                  <Trophy className="w-3.5 h-3.5" />
                  Gold Tier
                </span>
              </div>
              <p className="text-[#94a3b8] text-sm flex items-center gap-4">
                <span>Member since Jan 2026</span>
                <span className="w-1 h-1 rounded-full bg-[#334155]"></span>
                <span className="font-medium text-[#f1f5f9]">Day 47 in the program</span>
              </p>
            </div>
            
            <div className="flex gap-4">
              <button className="px-6 py-2.5 rounded-xl bg-[#6366f1] hover:bg-[#4f46e5] text-white font-medium transition-colors shadow-[0_0_15px_rgba(99,102,241,0.3)] flex items-center gap-2">
                <Play className="w-4 h-4 fill-current" />
                Resume Training
              </button>
            </div>
          </div>
        </div>

        {/* Quick Stats */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard icon={BookOpen} label="Lessons Completed" value="12" subtext="of 28 total" color="indigo" />
          <StatCard icon={Clock} label="Hours Learned" value="8.5" subtext="+2.5 this week" color="emerald" />
          <StatCard icon={Flame} label="Current Streak" value="5 Days" subtext="Personal best: 14" color="amber" />
          <StatCard icon={Ticket} label="Tickets Open" value="1" subtext="Awaiting reply" color="rose" />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          {/* Left Column (Main Content) */}
          <div className="lg:col-span-2 space-y-8">
            
            {/* Progress & Next Action */}
            <div className="bg-[#1e293b] rounded-2xl border border-[#334155] p-6 shadow-md">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-lg font-semibold flex items-center gap-2">
                  <BookOpen className="w-5 h-5 text-[#818cf8]" />
                  Training Progress
                </h2>
                <span className="text-sm font-medium text-[#818cf8]">42% Complete</span>
              </div>
              
              <div className="w-full h-2.5 bg-[#0f172a] rounded-full overflow-hidden mb-8 border border-[#334155]">
                <div className="h-full bg-gradient-to-r from-[#6366f1] to-[#818cf8] rounded-full" style={{ width: '42%' }}></div>
              </div>
              
              <div className="p-5 rounded-xl bg-gradient-to-br from-[#0f172a] to-[#1e293b] border border-[#334155]">
                <div className="text-xs font-semibold text-[#818cf8] uppercase tracking-wider mb-2">Up Next</div>
                <h3 className="text-xl font-medium mb-2">Module 3: Ad Creative Testing</h3>
                <p className="text-[#94a3b8] text-sm mb-5">Lesson 3.2: Writing Headlines That Convert</p>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs text-[#94a3b8]">
                    <Clock className="w-4 h-4" />
                    18 mins remaining
                  </div>
                  <button className="px-5 py-2 rounded-lg bg-[#334155] hover:bg-[#475569] text-white text-sm font-medium transition-colors flex items-center gap-2">
                    Start Lesson
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>

            {/* Support Ticket Summary */}
            <div className="bg-[#1e293b] rounded-2xl border border-[#334155] p-6 shadow-md">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-lg font-semibold flex items-center gap-2">
                  <MessageSquare className="w-5 h-5 text-[#818cf8]" />
                  Recent Support
                </h2>
                <button className="text-sm text-[#818cf8] hover:text-[#6366f1] font-medium flex items-center gap-1">
                  View All <ChevronRight className="w-4 h-4" />
                </button>
              </div>
              
              <div className="flex items-start gap-4 p-4 rounded-xl bg-[#0f172a] border border-[#334155]">
                <div className="p-2 rounded-lg bg-rose-500/10 text-rose-400">
                  <AlertCircle className="w-5 h-5" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center justify-between mb-1">
                    <h4 className="font-medium text-[15px]">Facebook Pixel Event Tracking Issue</h4>
                    <span className="text-xs text-[#94a3b8]">2 hours ago</span>
                  </div>
                  <p className="text-sm text-[#94a3b8] mb-3 line-clamp-1">I'm having trouble verifying the purchase event on my landing page after following the steps in Module 2.</p>
                  <div className="flex items-center gap-3">
                    <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-[#334155] text-[#f1f5f9]">Technical Support</span>
                    <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-rose-500/10 text-rose-400 border border-rose-500/20">Awaiting Reply</span>
                  </div>
                </div>
              </div>
            </div>

          </div>

          {/* Right Column (Widgets) */}
          <div className="space-y-8">
            
            {/* Upcoming Calls */}
            <div className="bg-[#1e293b] rounded-2xl border border-[#334155] p-6 shadow-md">
              <h2 className="text-lg font-semibold flex items-center gap-2 mb-6">
                <Video className="w-5 h-5 text-[#818cf8]" />
                Upcoming Calls
              </h2>
              
              <div className="space-y-4">
                <CallCard 
                  title="Weekly Q&A" 
                  time="Tomorrow 2:00 PM EST" 
                  coach="Coach Sarah" 
                  type="Q&A" 
                  color="indigo"
                />
                <CallCard 
                  title="Strategy Session" 
                  time="Mar 18, 1:00 PM EST" 
                  coach="Coach David" 
                  type="Strategy" 
                  color="amber"
                />
                <CallCard 
                  title="Mastermind" 
                  time="Mar 22, 4:00 PM EST" 
                  coach="Coach James" 
                  type="Mastermind" 
                  color="purple"
                />
              </div>
            </div>

            {/* Announcements */}
            <div className="bg-[#1e293b] rounded-2xl border border-[#334155] p-6 shadow-md">
              <h2 className="text-lg font-semibold flex items-center gap-2 mb-6">
                <Megaphone className="w-5 h-5 text-[#818cf8]" />
                Announcements
              </h2>
              
              <div className="space-y-5">
                <Announcement 
                  title="New Module Released!" 
                  date="Today" 
                  content="Module 5: Advanced Scaling Tactics is now live in the training portal."
                  isNew={true}
                />
                <div className="h-px w-full bg-[#334155]"></div>
                <Announcement 
                  title="Copywriting Workshop" 
                  date="Mar 15" 
                  content="Join our guest expert for a 2-hour deep dive into high-converting ad copy."
                  isNew={false}
                />
                <div className="h-px w-full bg-[#334155]"></div>
                <Announcement 
                  title="Community Milestone" 
                  date="Mar 10" 
                  content="We just hit 1,000 active members! Check the community tab for a special giveaway."
                  isNew={false}
                />
              </div>
            </div>

          </div>
        </div>
      </div>
    </AppLayout>
  );
}

// Subcomponents

function StatCard({ icon: Icon, label, value, subtext, color }: any) {
  const colorMap: any = {
    indigo: { bg: 'bg-indigo-500/10', text: 'text-indigo-400' },
    emerald: { bg: 'bg-emerald-500/10', text: 'text-emerald-400' },
    amber: { bg: 'bg-amber-500/10', text: 'text-amber-400' },
    rose: { bg: 'bg-rose-500/10', text: 'text-rose-400' },
  };
  
  const colors = colorMap[color];

  return (
    <div className="bg-[#1e293b] border border-[#334155] rounded-xl p-5 shadow-sm flex items-center gap-4">
      <div className={`p-3 rounded-lg ${colors.bg} ${colors.text}`}>
        <Icon className="w-6 h-6" />
      </div>
      <div>
        <p className="text-xs text-[#94a3b8] font-medium mb-1">{label}</p>
        <div className="flex items-baseline gap-2">
          <h3 className="text-2xl font-bold text-[#f1f5f9]">{value}</h3>
          <span className="text-xs text-[#64748b]">{subtext}</span>
        </div>
      </div>
    </div>
  );
}

function CallCard({ title, time, coach, type, color }: any) {
  const badgeColors: any = {
    indigo: "bg-indigo-500/10 text-indigo-400 border-indigo-500/20",
    amber: "bg-amber-500/10 text-amber-400 border-amber-500/20",
    purple: "bg-purple-500/10 text-purple-400 border-purple-500/20",
  };

  return (
    <div className="p-4 rounded-xl bg-[#0f172a] border border-[#334155] hover:border-[#475569] transition-colors">
      <div className="flex items-start justify-between mb-3">
        <div>
          <h4 className="font-medium text-[15px] mb-1">{title}</h4>
          <p className="text-xs text-[#94a3b8] flex items-center gap-1.5">
            <Calendar className="w-3.5 h-3.5" />
            {time}
          </p>
        </div>
        <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border ${badgeColors[color]}`}>
          {type}
        </span>
      </div>
      
      <div className="flex items-center justify-between mt-4">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-full bg-[#334155] flex items-center justify-center text-[10px] font-bold">
            {coach.charAt(6)}
          </div>
          <span className="text-sm text-[#cbd5e1]">{coach}</span>
        </div>
        <button className="px-3 py-1.5 rounded-lg bg-[#334155] hover:bg-[#475569] text-xs font-medium transition-colors">
          Join
        </button>
      </div>
    </div>
  );
}

function Announcement({ title, date, content, isNew }: any) {
  return (
    <div className="group">
      <div className="flex items-center justify-between mb-1">
        <h4 className="font-medium text-sm text-[#e2e8f0] group-hover:text-[#818cf8] transition-colors flex items-center gap-2">
          {title}
          {isNew && <span className="w-2 h-2 rounded-full bg-[#f59e0b]"></span>}
        </h4>
        <span className="text-xs text-[#64748b]">{date}</span>
      </div>
      <p className="text-sm text-[#94a3b8] leading-relaxed">{content}</p>
    </div>
  );
}
