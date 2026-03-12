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
      <div className="p-8 max-w-[1200px] mx-auto space-y-10" style={{ color: '#2d2d2d' }}>
        
        {/* Welcome Banner */}
        <div 
          className="relative p-8 rounded-lg flex flex-col md:flex-row md:items-center justify-between gap-6"
          style={{ 
            backgroundColor: '#ffffff',
            border: '1px solid #e8e4dc',
          }}
        >
          <div>
            <div className="flex items-center gap-3 mb-3">
              <h1 
                className="text-4xl font-bold"
                style={{ fontFamily: "'Roboto', sans-serif", color: '#2d2d2d' }}
              >
                Welcome back, Marcus.
              </h1>
              <span 
                className="px-2.5 py-1 text-[11px] font-bold uppercase tracking-[1.5px] flex items-center gap-1.5 rounded"
                style={{ 
                  fontFamily: "'Roboto', sans-serif",
                  backgroundColor: '#fef3c7', 
                  color: '#b45309',
                }}
              >
                <Trophy className="w-3.5 h-3.5" />
                Gold Tier
              </span>
            </div>
            <p 
              className="text-[15px] flex items-center gap-4"
              style={{ fontFamily: "'Roboto', sans-serif", color: '#5a5a5a' }}
            >
              <span>Member since January 2026</span>
              <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: '#e8e4dc' }}></span>
              <span style={{ color: '#2d2d2d', fontWeight: 600 }}>Day 47 in the program</span>
            </p>
          </div>
          
          <div className="flex gap-4">
            <button 
              className="px-6 py-2.5 flex items-center gap-2 transition-colors"
              style={{ 
                fontFamily: "'Roboto', sans-serif",
                fontWeight: 700,
                backgroundColor: '#1a56db', 
                color: '#ffffff',
                borderRadius: '3px',
                fontSize: '14px',
                letterSpacing: '0.5px'
              }}
            >
              <Play className="w-4 h-4 fill-current" />
              RESUME TRAINING
            </button>
          </div>
        </div>

        {/* Quick Stats */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <StatCard icon={BookOpen} label="LESSONS COMPLETED" value="12" subtext="of 28 total" />
          <StatCard icon={Clock} label="HOURS LEARNED" value="8.5" subtext="+2.5 this week" />
          <StatCard icon={Flame} label="CURRENT STREAK" value="5 Days" subtext="Personal best: 14" />
          <StatCard icon={Ticket} label="TICKETS OPEN" value="1" subtext="Awaiting reply" />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-10">
          
          {/* Left Column (Main Content) */}
          <div className="lg:col-span-2 space-y-10">
            
            {/* Progress & Next Action */}
            <div 
              className="rounded-lg p-8"
              style={{ backgroundColor: '#ffffff', border: '1px solid #e8e4dc' }}
            >
              <div className="flex items-center justify-between mb-8 pb-4" style={{ borderBottom: '1px solid #e8e4dc' }}>
                <h2 
                  className="text-2xl font-bold flex items-center gap-2"
                  style={{ fontFamily: "'Roboto', sans-serif" }}
                >
                  <BookOpen className="w-6 h-6" style={{ color: '#1a56db' }} />
                  Training Progress
                </h2>
                <span 
                  className="text-[13px] font-bold tracking-wide uppercase"
                  style={{ fontFamily: "'Roboto', sans-serif", color: '#1a56db' }}
                >
                  42% Complete
                </span>
              </div>
              
              <div 
                className="w-full h-1.5 mb-10 overflow-hidden" 
                style={{ backgroundColor: '#f5f2ed', borderRadius: '3px' }}
              >
                <div 
                  className="h-full" 
                  style={{ backgroundColor: '#1a56db', width: '42%', borderRadius: '3px' }}
                ></div>
              </div>
              
              <div 
                className="p-6 relative"
                style={{ 
                  backgroundColor: '#f5f2ed', 
                  borderLeft: '4px solid #1a56db',
                  borderRadius: '0 4px 4px 0'
                }}
              >
                <div 
                  className="text-[11px] font-bold uppercase tracking-[2px] mb-3"
                  style={{ fontFamily: "'Roboto', sans-serif", color: '#1a56db' }}
                >
                  Up Next
                </div>
                <h3 
                  className="text-2xl font-bold mb-2"
                  style={{ fontFamily: "'Roboto', sans-serif", color: '#2d2d2d' }}
                >
                  Module 3: Ad Creative Testing
                </h3>
                <p 
                  className="text-[16px] mb-6"
                  style={{ fontFamily: "'Roboto', sans-serif", color: '#5a5a5a', fontStyle: 'italic' }}
                >
                  Lesson 3.2: Writing Headlines That Convert
                </p>
                <div className="flex items-center justify-between pt-5" style={{ borderTop: '1px solid #e8e4dc' }}>
                  <div 
                    className="flex items-center gap-2 text-[13px] font-semibold uppercase tracking-wide"
                    style={{ fontFamily: "'Roboto', sans-serif", color: '#5a5a5a' }}
                  >
                    <Clock className="w-4 h-4" />
                    18 mins remaining
                  </div>
                  <button 
                    className="px-5 py-2 flex items-center gap-2 transition-colors"
                    style={{ 
                      fontFamily: "'Roboto', sans-serif", 
                      fontWeight: 700, 
                      backgroundColor: '#1a56db', 
                      color: '#ffffff',
                      borderRadius: '3px',
                      fontSize: '13px',
                      letterSpacing: '0.5px'
                    }}
                  >
                    START LESSON
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>

            {/* Support Ticket Summary */}
            <div 
              className="rounded-lg p-8"
              style={{ backgroundColor: '#ffffff', border: '1px solid #e8e4dc' }}
            >
              <div className="flex items-center justify-between mb-8 pb-4" style={{ borderBottom: '1px solid #e8e4dc' }}>
                <h2 
                  className="text-2xl font-bold flex items-center gap-2"
                  style={{ fontFamily: "'Roboto', sans-serif" }}
                >
                  <MessageSquare className="w-6 h-6" style={{ color: '#1a56db' }} />
                  Recent Support
                </h2>
                <button 
                  className="text-[12px] font-bold uppercase tracking-[1px] flex items-center gap-1 hover:underline"
                  style={{ fontFamily: "'Roboto', sans-serif", color: '#1a56db' }}
                >
                  View All <ChevronRight className="w-4 h-4" />
                </button>
              </div>
              
              <div 
                className="flex items-start gap-5 p-6 rounded"
                style={{ backgroundColor: '#fcfbf9', border: '1px solid #e8e4dc' }}
              >
                <div className="p-2" style={{ color: '#d97706' }}>
                  <AlertCircle className="w-6 h-6" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center justify-between mb-2">
                    <h4 
                      className="text-lg font-bold"
                      style={{ fontFamily: "'Roboto', sans-serif", color: '#2d2d2d' }}
                    >
                      Facebook Pixel Event Tracking Issue
                    </h4>
                    <span 
                      className="text-[12px] uppercase tracking-wide font-semibold"
                      style={{ fontFamily: "'Roboto', sans-serif", color: '#888888' }}
                    >
                      2 hours ago
                    </span>
                  </div>
                  <p 
                    className="text-[15px] leading-relaxed mb-4"
                    style={{ fontFamily: "'Roboto', sans-serif", color: '#5a5a5a' }}
                  >
                    "I'm having trouble verifying the purchase event on my landing page after following the steps in Module 2."
                  </p>
                  <div 
                    className="flex items-center gap-3"
                    style={{ fontFamily: "'Roboto', sans-serif" }}
                  >
                    <span 
                      className="px-2.5 py-1 text-[11px] font-bold uppercase tracking-[1px] rounded"
                      style={{ backgroundColor: '#f5f2ed', color: '#5a5a5a', border: '1px solid #e8e4dc' }}
                    >
                      Technical Support
                    </span>
                    <span 
                      className="px-2.5 py-1 text-[11px] font-bold uppercase tracking-[1px] rounded"
                      style={{ backgroundColor: '#fef3c7', color: '#b45309' }}
                    >
                      Awaiting Reply
                    </span>
                  </div>
                </div>
              </div>
            </div>

          </div>

          {/* Right Column (Widgets) */}
          <div className="space-y-10">
            
            {/* Upcoming Calls */}
            <div 
              className="rounded-lg p-6"
              style={{ backgroundColor: '#ffffff', border: '1px solid #e8e4dc' }}
            >
              <h2 
                className="text-xl font-bold flex items-center gap-2 mb-6 pb-4"
                style={{ fontFamily: "'Roboto', sans-serif", borderBottom: '1px solid #e8e4dc' }}
              >
                <Video className="w-5 h-5" style={{ color: '#1a56db' }} />
                Upcoming Calls
              </h2>
              
              <div className="space-y-4">
                <CallCard 
                  title="Weekly Q&A" 
                  time="Tomorrow 2:00 PM EST" 
                  coach="Coach Sarah" 
                  type="Q&A" 
                />
                <CallCard 
                  title="Strategy Session" 
                  time="Mar 18, 1:00 PM EST" 
                  coach="Coach David" 
                  type="Strategy" 
                />
                <CallCard 
                  title="Mastermind" 
                  time="Mar 22, 4:00 PM EST" 
                  coach="Coach James" 
                  type="Mastermind" 
                />
              </div>
            </div>

            {/* Announcements */}
            <div 
              className="rounded-lg p-6"
              style={{ backgroundColor: '#ffffff', border: '1px solid #e8e4dc' }}
            >
              <h2 
                className="text-xl font-bold flex items-center gap-2 mb-6 pb-4"
                style={{ fontFamily: "'Roboto', sans-serif", borderBottom: '1px solid #e8e4dc' }}
              >
                <Megaphone className="w-5 h-5" style={{ color: '#1a56db' }} />
                Announcements
              </h2>
              
              <div className="space-y-6">
                <Announcement 
                  title="New Module Released!" 
                  date="Today" 
                  content="Module 5: Advanced Scaling Tactics is now live in the training portal."
                  isNew={true}
                />
                <div className="h-px w-full" style={{ backgroundColor: '#e8e4dc' }}></div>
                <Announcement 
                  title="Copywriting Workshop" 
                  date="Mar 15" 
                  content="Join our guest expert for a 2-hour deep dive into high-converting ad copy."
                  isNew={false}
                />
                <div className="h-px w-full" style={{ backgroundColor: '#e8e4dc' }}></div>
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

function StatCard({ icon: Icon, label, value, subtext }: any) {
  return (
    <div 
      className="rounded-lg p-6 flex flex-col items-center text-center"
      style={{ 
        backgroundColor: '#ffffff', 
        border: '1px solid #e8e4dc',
        borderTop: '3px solid #1a56db'
      }}
    >
      <div className="mb-4">
        <Icon className="w-6 h-6" style={{ color: '#1a56db' }} />
      </div>
      <p 
        className="text-[11px] font-bold uppercase tracking-[1.5px] mb-2"
        style={{ fontFamily: "'Roboto', sans-serif", color: '#888888' }}
      >
        {label}
      </p>
      <div className="flex flex-col items-center">
        <h3 
          className="text-4xl font-bold mb-1"
          style={{ fontFamily: "'Roboto', sans-serif", color: '#1a56db' }}
        >
          {value}
        </h3>
        <span 
          className="text-[13px] font-medium"
          style={{ fontFamily: "'Roboto', sans-serif", color: '#5a5a5a', fontStyle: 'italic' }}
        >
          {subtext}
        </span>
      </div>
    </div>
  );
}

function CallCard({ title, time, coach, type }: any) {
  return (
    <div 
      className="p-5 rounded-lg transition-colors"
      style={{ backgroundColor: '#faf9f7', border: '1px solid #e8e4dc' }}
    >
      <div className="flex items-start justify-between mb-4">
        <div>
          <h4 
            className="text-lg font-bold mb-1.5"
            style={{ fontFamily: "'Roboto', sans-serif", color: '#2d2d2d' }}
          >
            {title}
          </h4>
          <p 
            className="text-[13px] flex items-center gap-1.5 font-semibold"
            style={{ fontFamily: "'Roboto', sans-serif", color: '#5a5a5a', textTransform: 'uppercase', letterSpacing: '0.5px' }}
          >
            <Calendar className="w-4 h-4" />
            {time}
          </p>
        </div>
        <span 
          className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider rounded"
          style={{ 
            fontFamily: "'Roboto', sans-serif", 
            backgroundColor: '#eff6ff', 
            color: '#1a56db', 
            border: '1px solid #dbeafe' 
          }}
        >
          {type}
        </span>
      </div>
      
      <div className="flex items-center justify-between pt-4" style={{ borderTop: '1px dashed #e8e4dc' }}>
        <div className="flex items-center gap-2.5">
          <div 
            className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold"
            style={{ backgroundColor: '#f5f2ed', color: '#2d2d2d', border: '1px solid #e8e4dc' }}
          >
            {coach.charAt(6)}
          </div>
          <span 
            className="text-[14px]"
            style={{ fontFamily: "'Roboto', sans-serif", color: '#3d3d3d' }}
          >
            {coach}
          </span>
        </div>
        <button 
          className="px-3 py-1.5 rounded text-[11px] font-bold uppercase tracking-[1px] transition-colors hover:opacity-90"
          style={{ fontFamily: "'Roboto', sans-serif", backgroundColor: '#2d2d2d', color: '#ffffff' }}
        >
          RSVP
        </button>
      </div>
    </div>
  );
}

function Announcement({ title, date, content, isNew }: any) {
  return (
    <div className="group">
      <div className="flex items-center justify-between mb-2">
        <h4 
          className="text-[16px] font-bold flex items-center gap-2"
          style={{ fontFamily: "'Roboto', sans-serif", color: '#2d2d2d' }}
        >
          {title}
          {isNew && <span className="w-2 h-2 rounded-full" style={{ backgroundColor: '#1a56db' }}></span>}
        </h4>
        <span 
          className="text-[11px] font-bold uppercase tracking-[1px]"
          style={{ fontFamily: "'Roboto', sans-serif", color: '#888888' }}
        >
          {date}
        </span>
      </div>
      <p 
        className="text-[14px] leading-relaxed"
        style={{ fontFamily: "'Roboto', sans-serif", color: '#5a5a5a' }}
      >
        {content}
      </p>
    </div>
  );
}
