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
    typeColor: '#3b82f6',
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
    typeColor: '#8b5cf6',
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
    typeColor: '#f59e0b',
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
    typeColor: '#22d3ee',
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
    typeColor: '#3b82f6',
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
    color: '#3b82f6'
  },
  {
    id: 2,
    name: 'David Chen',
    role: 'Scaling Strategist',
    sessions: 'Strategy Sessions, Weekly Q&A',
    avatar: 'DC',
    color: '#8b5cf6'
  },
  {
    id: 3,
    name: 'James Park',
    role: 'Optimization Specialist',
    sessions: 'Mastermind sessions',
    avatar: 'JP',
    color: '#f59e0b'
  }
];

export function Coaching() {
  const [activeTab, setActiveTab] = useState('upcoming');

  return (
    <AppLayout activePage="coaching" tier="gold" memberName="Marcus Johnson">
      <div className="max-w-6xl mx-auto p-6 lg:p-10 space-y-8">
        
        {/* Page Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-white mb-2">Coaching Calls</h1>
            <div className="flex items-center gap-2 text-sm text-[#94a3b8]">
              <Crown className="w-4 h-4 text-[#ffd700]" />
              <span className="text-[#ffd700] font-medium">Gold members:</span>
              <span>Access to all call types except VIP</span>
            </div>
          </div>
          
          <div className="flex bg-[#1e293b] p-1 rounded-xl border border-[#334155] w-fit">
            {[
              { id: 'upcoming', label: 'Upcoming Calls' },
              { id: 'past', label: 'Past Recordings' },
              { id: 'coaches', label: 'My Coaches' }
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-5 py-2 rounded-lg text-sm font-medium transition-all ${
                  activeTab === tab.id 
                    ? 'bg-[#334155] text-white shadow-sm' 
                    : 'text-[#94a3b8] hover:text-white hover:bg-[#334155]/50'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {activeTab === 'upcoming' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            
            {/* Left Column: Upcoming Calls */}
            <div className="lg:col-span-2 space-y-4">
              <h2 className="text-xl font-semibold text-white flex items-center gap-2 mb-4">
                <Video className="w-5 h-5 text-indigo-400" />
                Schedule
              </h2>
              
              <div className="space-y-4">
                {upcomingCalls.map(call => (
                  <div 
                    key={call.id}
                    className={`relative rounded-xl border p-5 transition-all duration-200 ${
                      call.status === 'locked' 
                        ? 'bg-[#1e293b]/50 border-[#334155]/50 opacity-75' 
                        : 'bg-[#1e293b] border-[#334155] hover:border-[#475569] shadow-sm'
                    }`}
                  >
                    {call.status === 'locked' && (
                      <div className="absolute inset-0 bg-[#0f172a]/40 backdrop-blur-[1px] rounded-xl flex items-center justify-center z-10">
                        <div className="bg-[#1e293b] border border-[#334155] rounded-xl p-4 flex flex-col items-center shadow-xl">
                          <Lock className="w-6 h-6 text-cyan-400 mb-2" />
                          <p className="text-sm font-semibold text-white mb-1">Diamond Tier Only</p>
                          <button className="text-xs text-cyan-400 font-medium hover:text-cyan-300 transition-colors">
                            Upgrade to Unlock &rarr;
                          </button>
                        </div>
                      </div>
                    )}
                    
                    <div className="flex flex-col sm:flex-row gap-5">
                      {/* Calendar Date Side */}
                      <div className="flex flex-col items-center justify-center sm:w-24 shrink-0 bg-[#0f172a] rounded-lg p-3 border border-[#334155]/50">
                        <span className="text-xs font-medium text-[#94a3b8] uppercase tracking-wider mb-1">
                          {call.date.split(' ')[0]}
                        </span>
                        <span className="text-2xl font-bold text-white mb-1">
                          {call.date.split(' ')[1]}
                        </span>
                        <span className="text-[10px] font-semibold text-indigo-400 bg-indigo-500/10 px-2 py-0.5 rounded-full">
                          {call.dayOfWeek}
                        </span>
                      </div>
                      
                      {/* Call Details */}
                      <div className="flex-1 flex flex-col justify-between">
                        <div>
                          <div className="flex flex-wrap items-center gap-2 mb-2">
                            <span 
                              className="text-[11px] font-bold px-2 py-0.5 rounded-full"
                              style={{ 
                                color: call.typeColor, 
                                backgroundColor: `${call.typeColor}15`,
                                border: `1px solid ${call.typeColor}30`
                              }}
                            >
                              {call.type}
                            </span>
                            <span className="text-xs font-medium text-[#94a3b8] flex items-center gap-1.5">
                              <Clock className="w-3.5 h-3.5" />
                              {call.time}
                            </span>
                            {call.tierReq === 'diamond' ? (
                              <span className="text-[10px] font-bold text-[#b9f2ff] bg-[#b9f2ff]/10 px-2 py-0.5 rounded border border-[#b9f2ff]/20 ml-auto flex items-center gap-1">
                                <Crown className="w-3 h-3" /> Diamond
                              </span>
                            ) : (
                              <span className="text-[10px] font-semibold text-[#94a3b8] bg-[#334155] px-2 py-0.5 rounded ml-auto">
                                {call.tier}
                              </span>
                            )}
                          </div>
                          
                          <h3 className="text-lg font-bold text-white mb-1 leading-snug">
                            {call.topic}
                          </h3>
                          <div className="flex items-center gap-2 mb-4">
                            <div 
                              className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold"
                              style={{ 
                                backgroundColor: `${call.typeColor}20`, 
                                color: call.typeColor,
                                border: `1px solid ${call.typeColor}40`
                              }}
                            >
                              {call.coach.split(' ').map(n => n[0]).join('')}
                            </div>
                            <p className="text-sm text-[#94a3b8]">
                              With Coach <span className="font-medium text-[#e2e8f0]">{call.coach}</span>
                            </p>
                          </div>
                        </div>
                        
                        <div className="flex items-center justify-between mt-auto pt-4 border-t border-[#334155]/50">
                          <div className="flex items-center gap-1.5 text-xs text-[#94a3b8]">
                            <Users className="w-3.5 h-3.5" />
                            {call.attendees} registered
                          </div>
                          
                          {call.status === 'live' ? (
                            <button className="flex items-center gap-2 px-4 py-1.5 rounded-lg text-sm font-semibold text-white bg-gradient-to-r from-emerald-500 to-green-600 hover:from-emerald-400 hover:to-green-500 shadow-[0_0_15px_rgba(16,185,129,0.3)] transition-all">
                              <Video className="w-4 h-4" />
                              Join Now
                            </button>
                          ) : call.status === 'upcoming' ? (
                            <button className="flex items-center gap-2 px-4 py-1.5 rounded-lg text-sm font-semibold text-white bg-[#334155] hover:bg-[#475569] transition-all">
                              <CalendarIcon className="w-4 h-4" />
                              Register
                            </button>
                          ) : (
                            <button disabled className="flex items-center gap-2 px-4 py-1.5 rounded-lg text-sm font-semibold text-[#64748b] bg-[#0f172a] border border-[#334155] cursor-not-allowed">
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
            <div className="space-y-4">
              <h2 className="text-xl font-semibold text-white flex items-center gap-2 mb-4">
                <Users className="w-5 h-5 text-indigo-400" />
                Your Coaches
              </h2>
              
              <div className="space-y-4">
                {coaches.map(coach => (
                  <div key={coach.id} className="bg-[#1e293b] rounded-xl border border-[#334155] p-5 hover:border-[#475569] transition-colors">
                    <div className="flex items-start gap-4 mb-4">
                      <div 
                        className="w-12 h-12 rounded-full flex items-center justify-center font-bold text-lg shrink-0"
                        style={{ 
                          backgroundColor: `${coach.color}20`, 
                          color: coach.color,
                          border: `1px solid ${coach.color}40`
                        }}
                      >
                        {coach.avatar}
                      </div>
                      <div>
                        <h4 className="text-white font-semibold">{coach.name}</h4>
                        <p className="text-xs text-indigo-400 font-medium mb-1">{coach.role}</p>
                      </div>
                    </div>
                    <div className="text-xs text-[#94a3b8] bg-[#0f172a] rounded-lg p-3 border border-[#334155]/50">
                      <span className="block font-medium text-[#cbd5e1] mb-1">Hosts:</span>
                      {coach.sessions}
                    </div>
                    <button className="w-full mt-4 flex items-center justify-center gap-2 text-sm text-[#94a3b8] hover:text-white transition-colors py-2 border border-[#334155] rounded-lg hover:bg-[#334155]">
                      <ExternalLink className="w-4 h-4" />
                      View Profile
                    </button>
                  </div>
                ))}
              </div>
              
              <div className="mt-6 bg-gradient-to-br from-indigo-900/40 to-purple-900/40 border border-indigo-500/20 rounded-xl p-5">
                <h4 className="text-white font-semibold mb-2 flex items-center gap-2">
                  <Play className="w-4 h-4 text-indigo-400" />
                  Missed a call?
                </h4>
                <p className="text-sm text-[#94a3b8] mb-4">
                  All coaching calls are recorded and uploaded to the vault within 24 hours.
                </p>
                <button 
                  onClick={() => setActiveTab('past')}
                  className="text-sm font-medium text-indigo-400 hover:text-indigo-300 flex items-center gap-1"
                >
                  Browse Recordings <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
            
          </div>
        )}
        
        {activeTab === 'past' && (
          <div className="flex flex-col items-center justify-center py-20 px-4 text-center bg-[#1e293b] rounded-xl border border-[#334155]">
            <div className="w-16 h-16 bg-[#0f172a] rounded-full flex items-center justify-center mb-4 border border-[#334155]">
              <Play className="w-8 h-8 text-indigo-400 ml-1" />
            </div>
            <h3 className="text-xl font-bold text-white mb-2">Past Recordings</h3>
            <p className="text-[#94a3b8] max-w-md mx-auto mb-6">
              Browse our archive of past coaching calls, strategy sessions, and masterminds.
            </p>
            <button className="px-6 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-medium transition-colors">
              Access Vault
            </button>
          </div>
        )}
        
        {activeTab === 'coaches' && (
          <div className="flex flex-col items-center justify-center py-20 px-4 text-center bg-[#1e293b] rounded-xl border border-[#334155]">
            <div className="w-16 h-16 bg-[#0f172a] rounded-full flex items-center justify-center mb-4 border border-[#334155]">
              <Users className="w-8 h-8 text-indigo-400" />
            </div>
            <h3 className="text-xl font-bold text-white mb-2">Coach Directory</h3>
            <p className="text-[#94a3b8] max-w-md mx-auto mb-6">
              Connect with our expert coaches and book 1-on-1 sessions.
            </p>
            <button className="px-6 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-medium transition-colors">
              View All Coaches
            </button>
          </div>
        )}
        
      </div>
    </AppLayout>
  );
}
