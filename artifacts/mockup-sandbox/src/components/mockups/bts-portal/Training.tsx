import React, { useState } from "react";
import { 
  BookOpen, 
  Play, 
  Lock, 
  CheckCircle, 
  Clock, 
  Search, 
  Filter,
  ChevronDown,
  ChevronUp,
  Unlock,
  PlayCircle
} from "lucide-react";
import "./_group.css";
import { AppLayout } from "./_shared/AppLayout";

export function Training() {
  const [expandedTrack, setExpandedTrack] = useState<number | null>(2);
  const [expandedModule, setExpandedModule] = useState<number | null>(3);
  const [searchQuery, setSearchQuery] = useState("");

  const overallProgress = 42;
  const completedLessons = 12;
  const totalLessons = 28;

  return (
    <AppLayout activePage="training" tier="gold" memberName="Marcus Johnson">
      <div className="p-8 max-w-5xl mx-auto space-y-8">
        {/* Header Section */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
          <div className="space-y-2">
            <h1 className="text-3xl font-bold tracking-tight text-[#f1f5f9]">
              Training Library
            </h1>
            <p className="text-[#94a3b8] text-sm flex items-center gap-2">
              <BookOpen className="w-4 h-4" />
              Master affiliate marketing from zero to scale
            </p>
          </div>

          <div className="bg-[#1e293b] border border-[#334155] rounded-xl p-4 min-w-[280px]">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-[#f1f5f9]">Overall Progress</span>
              <span className="text-sm font-bold text-[#6366f1]">{overallProgress}%</span>
            </div>
            <div className="w-full h-2.5 bg-[#0f172a] rounded-full overflow-hidden mb-2">
              <div 
                className="h-full rounded-full" 
                style={{ 
                  width: `${overallProgress}%`,
                  background: 'linear-gradient(90deg, #4f46e5, #818cf8)'
                }} 
              />
            </div>
            <div className="text-xs text-[#94a3b8] flex justify-between">
              <span>{completedLessons} of {totalLessons} lessons completed</span>
            </div>
          </div>
        </div>

        {/* Search and Filter */}
        <div className="flex items-center gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#64748b]" />
            <input 
              type="text" 
              placeholder="Search lessons, modules, or tracks..." 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-[#1e293b] border border-[#334155] text-[#f1f5f9] placeholder:text-[#64748b] text-sm rounded-lg pl-9 pr-4 py-2.5 focus:outline-none focus:border-[#6366f1] focus:ring-1 focus:ring-[#6366f1] transition-all"
            />
          </div>
          <button className="flex items-center gap-2 px-4 py-2.5 bg-[#1e293b] border border-[#334155] rounded-lg text-sm font-medium text-[#e2e8f0] hover:bg-[#334155] transition-colors">
            <Filter className="w-4 h-4" />
            Filters
          </button>
        </div>

        {/* Tracks List */}
        <div className="space-y-6">
          
          {/* Track 1 */}
          <div className="bg-[#1e293b] border border-[#334155] rounded-xl overflow-hidden transition-all duration-200 hover:border-[#475569]">
            <div className="p-6">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <span className="text-xs font-bold px-2 py-0.5 rounded-md bg-[#22c55e]/10 text-[#22c55e] border border-[#22c55e]/20">
                      Track 1
                    </span>
                    <h2 className="text-lg font-bold text-[#f1f5f9]">Building Your Foundation</h2>
                  </div>
                  <p className="text-sm text-[#94a3b8] mb-4">
                    Learn the core principles of affiliate marketing, finding winning offers, and setting up your initial tracking infrastructure.
                  </p>
                  
                  <div className="flex items-center gap-4 text-xs font-medium text-[#94a3b8]">
                    <div className="flex items-center gap-1.5">
                      <BookOpen className="w-3.5 h-3.5" /> 5 Modules
                    </div>
                    <div className="flex items-center gap-1.5">
                      <PlayCircle className="w-3.5 h-3.5" /> 18 Lessons
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Clock className="w-3.5 h-3.5" /> 4h 30m
                    </div>
                  </div>
                </div>

                <div className="w-full md:w-48 shrink-0">
                  <div className="flex items-center justify-between mb-1.5 text-sm">
                    <span className="text-[#94a3b8]">Progress</span>
                    <span className="font-bold text-[#22c55e]">85%</span>
                  </div>
                  <div className="w-full h-2 bg-[#0f172a] rounded-full overflow-hidden mb-3">
                    <div className="h-full bg-[#22c55e] rounded-full" style={{ width: '85%' }} />
                  </div>
                  <button className="w-full py-2 rounded-lg text-sm font-semibold bg-[#334155] text-white hover:bg-[#475569] transition-colors">
                    Continue Track
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Track 2 */}
          <div className={`bg-[#1e293b] border ${expandedTrack === 2 ? 'border-[#6366f1]' : 'border-[#334155]'} rounded-xl overflow-hidden transition-all duration-200`}>
            <div className="p-6 bg-gradient-to-r from-[#6366f1]/5 to-transparent border-b border-[#334155]">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <span className="text-xs font-bold px-2 py-0.5 rounded-md bg-[#6366f1]/10 text-[#818cf8] border border-[#6366f1]/20">
                      Track 2
                    </span>
                    <h2 className="text-lg font-bold text-[#f1f5f9]">Testing & Optimization</h2>
                    <span className="bg-[#f59e0b]/10 text-[#f59e0b] border border-[#f59e0b]/20 text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider">
                      Current
                    </span>
                  </div>
                  <p className="text-sm text-[#94a3b8] mb-4">
                    Master the art of buying data efficiently, identifying profitable angles, and optimizing your campaigns for maximum ROI.
                  </p>
                  
                  <div className="flex items-center gap-4 text-xs font-medium text-[#94a3b8]">
                    <div className="flex items-center gap-1.5">
                      <BookOpen className="w-3.5 h-3.5" /> 4 Modules
                    </div>
                    <div className="flex items-center gap-1.5">
                      <PlayCircle className="w-3.5 h-3.5" /> 16 Lessons
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Clock className="w-3.5 h-3.5" /> 3h 45m
                    </div>
                  </div>
                </div>

                <div className="w-full md:w-48 shrink-0">
                  <div className="flex items-center justify-between mb-1.5 text-sm">
                    <span className="text-[#94a3b8]">Progress</span>
                    <span className="font-bold text-[#6366f1]">30%</span>
                  </div>
                  <div className="w-full h-2 bg-[#0f172a] rounded-full overflow-hidden mb-3">
                    <div className="h-full rounded-full" style={{ width: '30%', background: 'linear-gradient(90deg, #4f46e5, #818cf8)' }} />
                  </div>
                  <button 
                    onClick={() => setExpandedTrack(expandedTrack === 2 ? null : 2)}
                    className="w-full py-2 rounded-lg text-sm font-semibold flex items-center justify-center gap-1 bg-[#6366f1] text-white hover:bg-[#4f46e5] transition-colors"
                  >
                    {expandedTrack === 2 ? 'Hide Modules' : 'View Modules'}
                    {expandedTrack === 2 ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            </div>

            {/* Modules list for Track 2 */}
            {expandedTrack === 2 && (
              <div className="bg-[#0f172a]/50 p-6 space-y-4">
                <h3 className="text-sm font-bold text-[#94a3b8] uppercase tracking-wider mb-2">Modules</h3>
                
                {/* Module 3 (Active) */}
                <div className="bg-[#1e293b] border border-[#334155] rounded-lg overflow-hidden">
                  <button 
                    onClick={() => setExpandedModule(expandedModule === 3 ? null : 3)}
                    className="w-full flex items-center justify-between p-4 hover:bg-[#334155]/50 transition-colors text-left"
                  >
                    <div className="flex items-center gap-4">
                      <div className="w-8 h-8 rounded-full bg-[#f59e0b]/10 text-[#f59e0b] flex items-center justify-center font-bold text-sm border border-[#f59e0b]/20">
                        3
                      </div>
                      <div>
                        <h4 className="text-sm font-bold text-[#f1f5f9]">Ad Creative Testing</h4>
                        <p className="text-xs text-[#94a3b8] mt-0.5">4 lessons • 50% Complete</p>
                      </div>
                    </div>
                    {expandedModule === 3 ? (
                      <ChevronUp className="w-5 h-5 text-[#64748b]" />
                    ) : (
                      <ChevronDown className="w-5 h-5 text-[#64748b]" />
                    )}
                  </button>
                  
                  {/* Lessons for Module 3 */}
                  {expandedModule === 3 && (
                    <div className="border-t border-[#334155] bg-[#0c1425]">
                      <div className="flex flex-col">
                        {/* Lesson 3.1 - Completed */}
                        <div className="flex items-center gap-4 p-4 border-b border-[#334155] hover:bg-[#1e293b] transition-colors cursor-pointer group">
                          <CheckCircle className="w-5 h-5 text-[#22c55e] shrink-0" />
                          <div className="flex-1">
                            <h5 className="text-sm font-medium text-[#cbd5e1] group-hover:text-white transition-colors">3.1 Creative Formats That Convert</h5>
                            <p className="text-xs text-[#64748b] mt-0.5 flex items-center gap-1.5">
                              <Play className="w-3 h-3" /> Video • 14 min
                            </p>
                          </div>
                          <span className="text-xs font-semibold text-[#22c55e] bg-[#22c55e]/10 px-2 py-1 rounded">Completed</span>
                        </div>

                        {/* Lesson 3.2 - In Progress */}
                        <div className="flex items-center gap-4 p-4 border-b border-[#334155] bg-[#6366f1]/5 hover:bg-[#6366f1]/10 transition-colors cursor-pointer group">
                          <PlayCircle className="w-5 h-5 text-[#f59e0b] shrink-0" />
                          <div className="flex-1">
                            <h5 className="text-sm font-bold text-[#f1f5f9] group-hover:text-white transition-colors">3.2 Writing Headlines That Convert</h5>
                            <p className="text-xs text-[#818cf8] mt-0.5 flex items-center gap-1.5">
                              <Play className="w-3 h-3" /> Video • 22 min
                            </p>
                          </div>
                          <button className="text-xs font-bold text-white bg-[#6366f1] hover:bg-[#4f46e5] px-3 py-1.5 rounded-lg transition-colors">
                            Resume
                          </button>
                        </div>

                        {/* Lesson 3.3 - Locked */}
                        <div className="flex items-center gap-4 p-4 border-b border-[#334155] opacity-60">
                          <Lock className="w-5 h-5 text-[#64748b] shrink-0" />
                          <div className="flex-1">
                            <h5 className="text-sm font-medium text-[#94a3b8]">3.3 Image & Video Creative Best Practices</h5>
                            <p className="text-xs text-[#64748b] mt-0.5 flex items-center gap-1.5">
                              <Play className="w-3 h-3" /> Video • 18 min
                            </p>
                          </div>
                        </div>

                        {/* Lesson 3.4 - Locked */}
                        <div className="flex items-center gap-4 p-4 opacity-60">
                          <Lock className="w-5 h-5 text-[#64748b] shrink-0" />
                          <div className="flex-1">
                            <h5 className="text-sm font-medium text-[#94a3b8]">3.4 A/B Testing Your Creatives</h5>
                            <p className="text-xs text-[#64748b] mt-0.5 flex items-center gap-1.5">
                              <Play className="w-3 h-3" /> Video • 25 min
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Module 4 */}
                <div className="bg-[#1e293b] border border-[#334155] rounded-lg overflow-hidden">
                  <div className="w-full flex items-center justify-between p-4 opacity-70">
                    <div className="flex items-center gap-4">
                      <div className="w-8 h-8 rounded-full bg-[#334155] text-[#94a3b8] flex items-center justify-center font-bold text-sm">
                        4
                      </div>
                      <div>
                        <h4 className="text-sm font-medium text-[#cbd5e1]">Landing Page Optimization</h4>
                        <p className="text-xs text-[#64748b] mt-0.5">3 lessons • 0% Complete</p>
                      </div>
                    </div>
                    <Lock className="w-4 h-4 text-[#64748b]" />
                  </div>
                </div>

                {/* Module 5 */}
                <div className="bg-[#1e293b] border border-[#334155] rounded-lg overflow-hidden">
                  <div className="w-full flex items-center justify-between p-4 opacity-70">
                    <div className="flex items-center gap-4">
                      <div className="w-8 h-8 rounded-full bg-[#334155] text-[#94a3b8] flex items-center justify-center font-bold text-sm">
                        5
                      </div>
                      <div>
                        <h4 className="text-sm font-medium text-[#cbd5e1]">Split Testing Strategies</h4>
                        <p className="text-xs text-[#64748b] mt-0.5">5 lessons • 0% Complete</p>
                      </div>
                    </div>
                    <Lock className="w-4 h-4 text-[#64748b]" />
                  </div>
                </div>

                {/* Module 6 */}
                <div className="bg-[#1e293b] border border-[#334155] rounded-lg overflow-hidden relative">
                  <div className="absolute top-3 right-4 flex items-center gap-1 text-xs font-bold text-[#ffd700] bg-[#ffd700]/10 px-2 py-0.5 rounded border border-[#ffd700]/20">
                    <Lock className="w-3 h-3" /> Gold+ Required
                  </div>
                  <div className="w-full flex items-center justify-between p-4 pt-6 opacity-70">
                    <div className="flex items-center gap-4">
                      <div className="w-8 h-8 rounded-full bg-[#334155] text-[#94a3b8] flex items-center justify-center font-bold text-sm">
                        6
                      </div>
                      <div>
                        <h4 className="text-sm font-medium text-[#cbd5e1]">Analytics & Tracking</h4>
                        <p className="text-xs text-[#64748b] mt-0.5">4 lessons • 0% Complete</p>
                      </div>
                    </div>
                  </div>
                </div>

              </div>
            )}
          </div>

          {/* Track 3 */}
          <div className="bg-[#1e293b] border border-[#334155] rounded-xl overflow-hidden opacity-80">
            <div className="p-6">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <span className="text-xs font-bold px-2 py-0.5 rounded-md bg-[#334155] text-[#94a3b8]">
                      Track 3
                    </span>
                    <h2 className="text-lg font-bold text-[#cbd5e1] flex items-center gap-2">
                      Scaling Campaigns <Lock className="w-4 h-4 text-[#64748b]" />
                    </h2>
                  </div>
                  <p className="text-sm text-[#64748b] mb-4">
                    Take your profitable campaigns to the next level. Learn vertical and horizontal scaling tactics, budget management, and team building.
                  </p>
                  
                  <div className="flex items-center gap-4 text-xs font-medium text-[#64748b]">
                    <div className="flex items-center gap-1.5">
                      <BookOpen className="w-3.5 h-3.5" /> 3 Modules
                    </div>
                    <div className="flex items-center gap-1.5">
                      <PlayCircle className="w-3.5 h-3.5" /> 12 Lessons
                    </div>
                  </div>
                </div>

                <div className="w-full md:w-48 shrink-0">
                  <div className="bg-[#0f172a] rounded-lg p-3 border border-[#334155] flex flex-col items-center text-center gap-2">
                    <Lock className="w-5 h-5 text-[#64748b]" />
                    <span className="text-xs text-[#94a3b8]">Complete Track 2 to unlock</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

        </div>
      </div>
    </AppLayout>
  );
}
