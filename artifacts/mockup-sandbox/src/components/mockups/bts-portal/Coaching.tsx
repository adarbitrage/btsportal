import React, { useState } from 'react';
import './_group.css';
import { AppLayout } from './_shared/AppLayout';
import { 
  Video, 
  Calendar as CalendarIcon, 
  Clock, 
  Users, 
  Lock, 
  Crown, 
  Play, 
  ExternalLink,
  ChevronRight
} from 'lucide-react';

const upcomingCalls = [
  {
    id: 1,
    type: 'Weekly Q&A',
    typeColor: '#1a56db',
    typeBg: '#eff6ff',
    date: 'Mar 13',
    dayOfWeek: 'Tomorrow',
    time: '2:00 PM EST',
    coach: 'Sarah Mitchell',
    topic: 'Open Q&A: Ask Anything',
    tier: 'Bronze+',
    tierReq: 'bronze',
    status: 'live', // live, upcoming, locked
    attendees: 42,
  },
  {
    id: 2,
    type: 'Strategy Session',
    typeColor: '#7c3aed',
    typeBg: '#faf5ff',
    date: 'Mar 18',
    dayOfWeek: 'Monday',
    time: '11:00 AM EST',
    coach: 'David Chen',
    topic: 'Scaling Facebook Ads to $500/day',
    tier: 'Silver+',
    tierReq: 'silver',
    status: 'upcoming',
    attendees: 18,
  },
  {
    id: 3,
    type: 'Mastermind',
    typeColor: '#b45309',
    typeBg: '#fef3c7',
    date: 'Mar 22',
    dayOfWeek: 'Friday',
    time: '3:00 PM EST',
    coach: 'James Park',
    topic: 'Campaign Teardowns & Optimization',
    tier: 'Gold+',
    tierReq: 'gold',
    status: 'upcoming',
    attendees: 12,
  },
  {
    id: 4,
    type: 'VIP Roundtable',
    typeColor: '#0891b2',
    typeBg: '#ecfeff',
    date: 'Mar 25',
    dayOfWeek: 'Monday',
    time: '1:00 PM EST',
    coach: 'Sarah Mitchell',
    topic: 'Private Strategy Review',
    tier: 'Diamond',
    tierReq: 'diamond',
    status: 'locked',
    attendees: 4,
  },
  {
    id: 5,
    type: 'Weekly Q&A',
    typeColor: '#1a56db',
    typeBg: '#eff6ff',
    date: 'Mar 27',
    dayOfWeek: 'Wednesday',
    time: '2:00 PM EST',
    coach: 'David Chen',
    topic: 'Traffic Sources Deep Dive',
    tier: 'Bronze+',
    tierReq: 'bronze',
    status: 'upcoming',
    attendees: 27,
  }
];

const coaches = [
  {
    id: 1,
    name: 'Sarah Mitchell',
    role: 'Facebook Ads Expert',
    sessions: 'Weekly Q&A, VIP Roundtable',
    avatar: 'SM',
    color: '#1a56db'
  },
  {
    id: 2,
    name: 'David Chen',
    role: 'Scaling Strategist',
    sessions: 'Strategy Sessions, Weekly Q&A',
    avatar: 'DC',
    color: '#7c3aed'
  },
  {
    id: 3,
    name: 'James Park',
    role: 'Optimization Specialist',
    sessions: 'Mastermind sessions',
    avatar: 'JP',
    color: '#b45309'
  }
];

export function Coaching() {
  const [activeTab, setActiveTab] = useState('upcoming');

  return (
    <AppLayout activePage="coaching" tier="gold" memberName="Marcus Johnson">
      <div className="max-w-5xl mx-auto p-6 lg:p-12 space-y-8">
        
        {/* Page Header */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 pb-6 border-b" style={{ borderColor: 'var(--bts-border)' }}>
          <div>
            <h1 className="text-4xl font-bold mb-3" style={{ fontFamily: 'var(--font-heading)', color: 'var(--bts-text)' }}>Coaching Calls</h1>
            <div className="flex items-center gap-2 text-sm" style={{ fontFamily: 'var(--font-ui)', color: 'var(--bts-text-secondary)' }}>
              <Crown className="w-4 h-4" style={{ color: 'var(--bts-gold)' }} />
              <span className="font-bold" style={{ color: 'var(--bts-gold)' }}>Gold members:</span>
              <span>Access to all call types except VIP</span>
            </div>
          </div>
          
          <div className="flex" style={{ fontFamily: 'var(--font-ui)' }}>
            {[
              { id: 'upcoming', label: 'Upcoming Calls' },
              { id: 'past', label: 'Past Recordings' },
              { id: 'coaches', label: 'My Coaches' }
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-6 py-2.5 text-[13px] font-bold uppercase tracking-wider transition-all`}
                style={{
                  color: activeTab === tab.id ? 'var(--bts-blue)' : 'var(--bts-text-muted)',
                  borderBottom: activeTab === tab.id ? '2px solid var(--bts-blue)' : '2px solid transparent',
                  marginBottom: '-1px'
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {activeTab === 'upcoming' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-10">
            
            {/* Left Column: Upcoming Calls */}
            <div className="lg:col-span-2 space-y-6">
              <h2 className="text-xl font-bold flex items-center gap-2 mb-4" style={{ fontFamily: 'var(--font-heading)', color: 'var(--bts-text)' }}>
                Schedule
              </h2>
              
              <div className="space-y-4">
                {upcomingCalls.map(call => (
                  <div 
                    key={call.id}
                    className="relative rounded bg-white p-6 transition-all duration-200"
                    style={{ 
                      border: '1px solid var(--bts-border)',
                      opacity: call.status === 'locked' ? 0.7 : 1,
                    }}
                  >
                    {call.status === 'locked' && (
                      <div className="absolute inset-0 bg-[#faf9f7]/40 backdrop-blur-[1px] rounded flex items-center justify-center z-10">
                        <div className="bg-white border rounded p-6 flex flex-col items-center shadow-lg" style={{ borderColor: 'var(--bts-border)', minWidth: '220px' }}>
                          <Lock className="w-5 h-5 mb-3" style={{ color: 'var(--bts-text)' }} />
                          <p className="text-[13px] font-bold uppercase tracking-widest mb-2" style={{ fontFamily: 'var(--font-ui)', color: 'var(--bts-text)' }}>Diamond Only</p>
                          <button className="text-xs font-semibold hover:underline" style={{ fontFamily: 'var(--font-ui)', color: 'var(--bts-blue)' }}>
                            Upgrade to Unlock &rarr;
                          </button>
                        </div>
                      </div>
                    )}
                    
                    <div className="flex flex-col sm:flex-row gap-6">
                      {/* Calendar Date Side */}
                      <div className="flex flex-col items-center justify-center sm:w-28 shrink-0 py-4 border-r" style={{ borderColor: 'var(--bts-border)' }}>
                        <span className="text-[11px] font-bold uppercase tracking-widest mb-1" style={{ fontFamily: 'var(--font-ui)', color: 'var(--bts-text-muted)' }}>
                          {call.date.split(' ')[0]}
                        </span>
                        <span className="text-4xl font-bold mb-1" style={{ fontFamily: 'var(--font-heading)', color: 'var(--bts-text)' }}>
                          {call.date.split(' ')[1]}
                        </span>
                        <span className="text-[11px] font-semibold tracking-wide mt-2" style={{ fontFamily: 'var(--font-ui)', color: 'var(--bts-text-secondary)' }}>
                          {call.dayOfWeek}
                        </span>
                      </div>
                      
                      {/* Call Details */}
                      <div className="flex-1 flex flex-col justify-between pl-2">
                        <div>
                          <div className="flex flex-wrap items-center gap-3 mb-3" style={{ fontFamily: 'var(--font-ui)' }}>
                            <span 
                              className="text-[11px] font-bold px-2.5 py-1 uppercase tracking-[1.5px] rounded-sm"
                              style={{ 
                                color: call.typeColor, 
                                backgroundColor: call.typeBg,
                              }}
                            >
                              {call.type}
                            </span>
                            <span className="text-[12px] font-semibold flex items-center gap-1.5" style={{ color: 'var(--bts-text-secondary)' }}>
                              <Clock className="w-3.5 h-3.5" />
                              {call.time}
                            </span>
                            {call.tierReq === 'diamond' ? (
                              <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 ml-auto flex items-center gap-1"
                                style={{ color: 'var(--bts-diamond)', backgroundColor: 'var(--bts-bg-highlight)', border: '1px solid var(--bts-border)' }}>
                                <Crown className="w-3 h-3" /> Diamond
                              </span>
                            ) : (
                              <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 ml-auto"
                                style={{ color: 'var(--bts-text-secondary)', backgroundColor: 'var(--bts-bg-highlight)', border: '1px solid var(--bts-border)' }}>
                                {call.tier}
                              </span>
                            )}
                          </div>
                          
                          <h3 className="text-xl font-bold mb-2 leading-snug" style={{ fontFamily: 'var(--font-heading)', color: 'var(--bts-text)' }}>
                            {call.topic}
                          </h3>
                          <div className="flex items-center gap-3 mb-6">
                            <div 
                              className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold"
                              style={{ 
                                backgroundColor: call.typeBg, 
                                color: call.typeColor,
                                fontFamily: 'var(--font-heading)'
                              }}
                            >
                              {call.coach.split(' ').map(n => n[0]).join('')}
                            </div>
                            <p className="text-[13px]" style={{ fontFamily: 'var(--font-body)', color: 'var(--bts-text-body)' }}>
                              With <span className="font-semibold italic">{call.coach}</span>
                            </p>
                          </div>
                        </div>
                        
                        <div className="flex items-center justify-between mt-auto pt-4 border-t" style={{ borderColor: 'var(--bts-border)' }}>
                          <div className="flex items-center gap-1.5 text-[12px] font-semibold" style={{ fontFamily: 'var(--font-ui)', color: 'var(--bts-text-secondary)' }}>
                            <Users className="w-3.5 h-3.5" />
                            {call.attendees} registered
                          </div>
                          
                          {call.status === 'live' ? (
                            <button className="flex items-center gap-2 px-5 py-2 text-[13px] font-bold text-white rounded-sm transition-all"
                              style={{ fontFamily: 'var(--font-ui)', backgroundColor: 'var(--bts-success)' }}>
                              <Video className="w-4 h-4" />
                              Join Call
                            </button>
                          ) : call.status === 'upcoming' ? (
                            <button className="flex items-center gap-2 px-5 py-2 text-[13px] font-bold text-white rounded-sm transition-all hover:opacity-90"
                              style={{ fontFamily: 'var(--font-ui)', backgroundColor: 'var(--bts-blue)' }}>
                              <CalendarIcon className="w-4 h-4" />
                              Register
                            </button>
                          ) : (
                            <button disabled className="flex items-center gap-2 px-5 py-2 text-[13px] font-bold rounded-sm cursor-not-allowed"
                              style={{ fontFamily: 'var(--font-ui)', color: 'var(--bts-text-muted)', backgroundColor: 'var(--bts-bg-highlight)', border: '1px solid var(--bts-border)' }}>
                              <Lock className="w-4 h-4" />
                              Locked
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            
            {/* Right Column: Coach Profiles */}
            <div className="space-y-6">
              <h2 className="text-xl font-bold flex items-center gap-2 mb-4" style={{ fontFamily: 'var(--font-heading)', color: 'var(--bts-text)' }}>
                Your Coaches
              </h2>
              
              <div className="space-y-4">
                {coaches.map(coach => (
                  <div key={coach.id} className="bg-white rounded p-5 transition-colors" style={{ border: '1px solid var(--bts-border)' }}>
                    <div className="flex items-start gap-4 mb-4">
                      <div 
                        className="w-12 h-12 rounded-full flex items-center justify-center font-bold text-lg shrink-0"
                        style={{ 
                          backgroundColor: `${coach.color}15`, 
                          color: coach.color,
                          fontFamily: 'var(--font-heading)'
                        }}
                      >
                        {coach.avatar}
                      </div>
                      <div>
                        <h4 className="font-bold text-[16px] mb-1" style={{ fontFamily: 'var(--font-heading)', color: 'var(--bts-text)' }}>{coach.name}</h4>
                        <p className="text-[12px] font-semibold uppercase tracking-wider" style={{ fontFamily: 'var(--font-ui)', color: 'var(--bts-text-secondary)' }}>{coach.role}</p>
                      </div>
                    </div>
                    <div className="text-[13px] p-3 rounded-sm mb-4" style={{ fontFamily: 'var(--font-body)', color: 'var(--bts-text-body)', backgroundColor: 'var(--bts-bg-highlight)' }}>
                      <span className="block font-semibold mb-1" style={{ color: 'var(--bts-text)' }}>Hosts:</span>
                      <span className="italic">{coach.sessions}</span>
                    </div>
                    <button className="w-full flex items-center justify-center gap-2 text-[13px] font-bold uppercase tracking-wider py-2.5 rounded-sm transition-colors hover:bg-gray-50"
                      style={{ fontFamily: 'var(--font-ui)', color: 'var(--bts-text)', border: '1px solid var(--bts-border)' }}>
                      <ExternalLink className="w-4 h-4" />
                      View Profile
                    </button>
                  </div>
                ))}
              </div>
              
              <div className="mt-8 rounded p-6" style={{ backgroundColor: 'var(--bts-bg-highlight)', border: '1px solid var(--bts-border)' }}>
                <h4 className="font-bold mb-3 flex items-center gap-2 text-lg" style={{ fontFamily: 'var(--font-heading)', color: 'var(--bts-text)' }}>
                  Missed a call?
                </h4>
                <p className="text-[14px] leading-relaxed mb-5" style={{ fontFamily: 'var(--font-body)', color: 'var(--bts-text-body)' }}>
                  All coaching calls are recorded and uploaded to the vault within 24 hours.
                </p>
                <button 
                  onClick={() => setActiveTab('past')}
                  className="text-[13px] font-bold uppercase tracking-wider flex items-center gap-1 hover:underline"
                  style={{ fontFamily: 'var(--font-ui)', color: 'var(--bts-blue)' }}
                >
                  Browse Recordings <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
            
          </div>
        )}
        
        {activeTab === 'past' && (
          <div className="flex flex-col items-center justify-center py-24 px-6 text-center bg-white rounded border" style={{ borderColor: 'var(--bts-border)' }}>
            <div className="w-16 h-16 rounded-full flex items-center justify-center mb-6" style={{ backgroundColor: 'var(--bts-bg-highlight)', border: '1px solid var(--bts-border)' }}>
              <Play className="w-8 h-8 ml-1" style={{ color: 'var(--bts-blue)' }} />
            </div>
            <h3 className="text-2xl font-bold mb-3" style={{ fontFamily: 'var(--font-heading)', color: 'var(--bts-text)' }}>Past Recordings</h3>
            <p className="max-w-md mx-auto mb-8 text-[15px] leading-relaxed" style={{ fontFamily: 'var(--font-body)', color: 'var(--bts-text-body)' }}>
              Browse our archive of past coaching calls, strategy sessions, and masterminds.
            </p>
            <button className="px-8 py-3 text-[13px] font-bold text-white uppercase tracking-wider rounded-sm transition-colors hover:opacity-90"
              style={{ fontFamily: 'var(--font-ui)', backgroundColor: 'var(--bts-blue)' }}>
              Access Vault
            </button>
          </div>
        )}
        
        {activeTab === 'coaches' && (
          <div className="flex flex-col items-center justify-center py-24 px-6 text-center bg-white rounded border" style={{ borderColor: 'var(--bts-border)' }}>
            <div className="w-16 h-16 rounded-full flex items-center justify-center mb-6" style={{ backgroundColor: 'var(--bts-bg-highlight)', border: '1px solid var(--bts-border)' }}>
              <Users className="w-8 h-8" style={{ color: 'var(--bts-blue)' }} />
            </div>
            <h3 className="text-2xl font-bold mb-3" style={{ fontFamily: 'var(--font-heading)', color: 'var(--bts-text)' }}>Coach Directory</h3>
            <p className="max-w-md mx-auto mb-8 text-[15px] leading-relaxed" style={{ fontFamily: 'var(--font-body)', color: 'var(--bts-text-body)' }}>
              Connect with our expert coaches and book 1-on-1 sessions.
            </p>
            <button className="px-8 py-3 text-[13px] font-bold text-white uppercase tracking-wider rounded-sm transition-colors hover:opacity-90"
              style={{ fontFamily: 'var(--font-ui)', backgroundColor: 'var(--bts-blue)' }}>
              View All Coaches
            </button>
          </div>
        )}
        
      </div>
    </AppLayout>
  );
}
