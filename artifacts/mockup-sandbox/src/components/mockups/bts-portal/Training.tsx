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
      <div className="p-8 max-w-5xl mx-auto space-y-8" style={{ background: "#faf9f7" }}>
        {/* Header Section */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
          <div className="space-y-3">
            <h1 
              className="text-4xl font-bold text-[#2d2d2d]"
              style={{ fontFamily: "'Roboto', sans-serif" }}
            >
              Training Library
            </h1>
            <p 
              className="text-lg text-[#5a5a5a] flex items-center gap-2"
              style={{ fontFamily: "'Roboto', sans-serif" }}
            >
              <BookOpen className="w-5 h-5 text-[#1a56db]" />
              Master affiliate marketing from zero to scale
            </p>
          </div>

          <div 
            className="p-5 min-w-[300px] rounded"
            style={{ 
              background: "#ffffff",
              border: "1px solid #e8e4dc"
            }}
          >
            <div className="flex items-center justify-between mb-3">
              <span 
                className="text-sm font-bold uppercase tracking-wider text-[#5a5a5a]"
                style={{ fontFamily: "'Roboto', sans-serif" }}
              >
                Overall Progress
              </span>
              <span 
                className="text-lg font-bold text-[#1a56db]"
                style={{ fontFamily: "'Roboto', sans-serif" }}
              >
                {overallProgress}%
              </span>
            </div>
            <div className="w-full h-2 rounded-full overflow-hidden mb-3" style={{ background: "#e8e4dc" }}>
              <div 
                className="h-full rounded-full" 
                style={{ 
                  width: `${overallProgress}%`,
                  background: "#1a56db"
                }} 
              />
            </div>
            <div 
              className="text-[13px] text-[#5a5a5a] flex justify-between"
              style={{ fontFamily: "'Roboto', sans-serif" }}
            >
              <span>{completedLessons} of {totalLessons} lessons completed</span>
            </div>
          </div>
        </div>

        {/* Search and Filter */}
        <div className="flex items-center gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[#888]" />
            <input 
              type="text" 
              placeholder="Search lessons, modules, or tracks..." 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full text-[15px] rounded pl-10 pr-4 py-3 focus:outline-none transition-all"
              style={{ 
                background: "#ffffff",
                border: "1px solid #e8e4dc",
                color: "#2d2d2d",
                fontFamily: "'Roboto', sans-serif"
              }}
            />
          </div>
          <button 
            className="flex items-center gap-2 px-5 py-3 rounded text-[15px] font-bold transition-colors"
            style={{ 
              background: "#ffffff",
              border: "1px solid #e8e4dc",
              color: "#2d2d2d",
              fontFamily: "'Roboto', sans-serif"
            }}
          >
            <Filter className="w-4 h-4" />
            Filters
          </button>
        </div>

        {/* Tracks List */}
        <div className="space-y-6">
          
          {/* Track 1 */}
          <div 
            className="rounded overflow-hidden"
            style={{ background: "#ffffff", border: "1px solid #e8e4dc" }}
          >
            <div className="p-7">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                <div className="flex-1">
                  <div className="flex items-center gap-4 mb-3">
                    <span 
                      className="text-[11px] font-bold px-2.5 py-1 rounded uppercase tracking-[2px]"
                      style={{ 
                        fontFamily: "'Roboto', sans-serif",
                        color: "#16a34a",
                        background: "#f0fdf4",
                        border: "1px solid #bbf7d0"
                      }}
                    >
                      Track 1
                    </span>
                    <h2 
                      className="text-2xl font-bold text-[#2d2d2d]"
                      style={{ fontFamily: "'Roboto', sans-serif" }}
                    >
                      Building Your Foundation
                    </h2>
                  </div>
                  <p 
                    className="text-[16px] text-[#5a5a5a] mb-5 leading-relaxed"
                    style={{ fontFamily: "'Roboto', sans-serif" }}
                  >
                    Learn the core principles of affiliate marketing, finding winning offers, and setting up your initial tracking infrastructure.
                  </p>
                  
                  <div 
                    className="flex items-center gap-6 text-[14px] text-[#5a5a5a]"
                    style={{ fontFamily: "'Roboto', sans-serif" }}
                  >
                    <div className="flex items-center gap-2">
                      <BookOpen className="w-4 h-4 text-[#888]" /> 5 Modules
                    </div>
                    <div className="flex items-center gap-2">
                      <PlayCircle className="w-4 h-4 text-[#888]" /> 18 Lessons
                    </div>
                    <div className="flex items-center gap-2">
                      <Clock className="w-4 h-4 text-[#888]" /> 4h 30m
                    </div>
                  </div>
                </div>

                <div className="w-full md:w-56 shrink-0">
                  <div 
                    className="flex items-center justify-between mb-2"
                    style={{ fontFamily: "'Roboto', sans-serif" }}
                  >
                    <span className="text-[13px] font-bold text-[#5a5a5a] uppercase tracking-wider">Progress</span>
                    <span className="text-[15px] font-bold text-[#16a34a]">85%</span>
                  </div>
                  <div className="w-full h-2 rounded-full overflow-hidden mb-4" style={{ background: "#e8e4dc" }}>
                    <div className="h-full rounded-full" style={{ width: '85%', background: '#16a34a' }} />
                  </div>
                  <button 
                    className="w-full py-2.5 rounded text-[14px] font-bold transition-colors"
                    style={{ 
                      fontFamily: "'Roboto', sans-serif",
                      background: "#f5f2ed",
                      color: "#2d2d2d",
                      border: "1px solid #e8e4dc"
                    }}
                  >
                    Continue Track
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Track 2 */}
          <div 
            className="rounded overflow-hidden"
            style={{ 
              background: "#ffffff", 
              border: expandedTrack === 2 ? "2px solid #1a56db" : "1px solid #e8e4dc" 
            }}
          >
            <div 
              className="p-7"
              style={{ borderBottom: expandedTrack === 2 ? "1px solid #e8e4dc" : "none" }}
            >
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                <div className="flex-1">
                  <div className="flex items-center gap-4 mb-3">
                    <span 
                      className="text-[11px] font-bold px-2.5 py-1 rounded uppercase tracking-[2px]"
                      style={{ 
                        fontFamily: "'Roboto', sans-serif",
                        color: "#1a56db",
                        background: "#eff6ff",
                        border: "1px solid #dbeafe"
                      }}
                    >
                      Track 2
                    </span>
                    <h2 
                      className="text-2xl font-bold text-[#2d2d2d]"
                      style={{ fontFamily: "'Roboto', sans-serif" }}
                    >
                      Testing & Optimization
                    </h2>
                    <span 
                      className="text-[10px] font-bold px-2.5 py-1 rounded-full uppercase tracking-wider"
                      style={{ 
                        fontFamily: "'Roboto', sans-serif",
                        background: "#eff6ff", 
                        color: "#1a56db", 
                        border: "1px solid #dbeafe"
                      }}
                    >
                      Current
                    </span>
                  </div>
                  <p 
                    className="text-[16px] text-[#5a5a5a] mb-5 leading-relaxed"
                    style={{ fontFamily: "'Roboto', sans-serif" }}
                  >
                    Master the art of buying data efficiently, identifying profitable angles, and optimizing your campaigns for maximum ROI.
                  </p>
                  
                  <div 
                    className="flex items-center gap-6 text-[14px] text-[#5a5a5a]"
                    style={{ fontFamily: "'Roboto', sans-serif" }}
                  >
                    <div className="flex items-center gap-2">
                      <BookOpen className="w-4 h-4 text-[#888]" /> 4 Modules
                    </div>
                    <div className="flex items-center gap-2">
                      <PlayCircle className="w-4 h-4 text-[#888]" /> 16 Lessons
                    </div>
                    <div className="flex items-center gap-2">
                      <Clock className="w-4 h-4 text-[#888]" /> 3h 45m
                    </div>
                  </div>
                </div>

                <div className="w-full md:w-56 shrink-0">
                  <div 
                    className="flex items-center justify-between mb-2"
                    style={{ fontFamily: "'Roboto', sans-serif" }}
                  >
                    <span className="text-[13px] font-bold text-[#5a5a5a] uppercase tracking-wider">Progress</span>
                    <span className="text-[15px] font-bold text-[#1a56db]">30%</span>
                  </div>
                  <div className="w-full h-2 rounded-full overflow-hidden mb-4" style={{ background: "#e8e4dc" }}>
                    <div className="h-full rounded-full" style={{ width: '30%', background: '#1a56db' }} />
                  </div>
                  <button 
                    onClick={() => setExpandedTrack(expandedTrack === 2 ? null : 2)}
                    className="w-full py-2.5 rounded text-[14px] font-bold flex items-center justify-center gap-2 transition-colors"
                    style={{ 
                      fontFamily: "'Roboto', sans-serif",
                      background: "#1a56db",
                      color: "#ffffff"
                    }}
                  >
                    {expandedTrack === 2 ? 'Hide Modules' : 'View Modules'}
                    {expandedTrack === 2 ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            </div>

            {/* Modules list for Track 2 */}
            {expandedTrack === 2 && (
              <div className="p-7 space-y-4" style={{ background: "#faf9f7" }}>
                <h3 
                  className="text-[12px] font-bold uppercase tracking-[2px] mb-3"
                  style={{ color: "#5a5a5a", fontFamily: "'Roboto', sans-serif" }}
                >
                  Modules
                </h3>
                
                {/* Module 3 (Active) */}
                <div 
                  className="rounded overflow-hidden"
                  style={{ background: "#ffffff", border: "1px solid #e8e4dc" }}
                >
                  <button 
                    onClick={() => setExpandedModule(expandedModule === 3 ? null : 3)}
                    className="w-full flex items-center justify-between p-5 text-left transition-colors"
                    style={{ background: expandedModule === 3 ? "#f5f2ed" : "#ffffff" }}
                  >
                    <div className="flex items-center gap-5">
                      <div 
                        className="w-10 h-10 rounded-full flex items-center justify-center font-bold text-[16px]"
                        style={{ 
                          fontFamily: "'Roboto', sans-serif",
                          background: "#fffbeb",
                          color: "#d97706",
                          border: "1px solid #fde68a"
                        }}
                      >
                        3
                      </div>
                      <div>
                        <h4 
                          className="text-[18px] font-bold text-[#2d2d2d]"
                          style={{ fontFamily: "'Roboto', sans-serif" }}
                        >
                          Ad Creative Testing
                        </h4>
                        <p 
                          className="text-[14px] text-[#5a5a5a] mt-1"
                          style={{ fontFamily: "'Roboto', sans-serif" }}
                        >
                          4 lessons • 50% Complete
                        </p>
                      </div>
                    </div>
                    {expandedModule === 3 ? (
                      <ChevronUp className="w-5 h-5 text-[#5a5a5a]" />
                    ) : (
                      <ChevronDown className="w-5 h-5 text-[#5a5a5a]" />
                    )}
                  </button>
                  
                  {/* Lessons for Module 3 */}
                  {expandedModule === 3 && (
                    <div style={{ borderTop: "1px solid #e8e4dc" }}>
                      <div className="flex flex-col">
                        {/* Lesson 3.1 - Completed */}
                        <div 
                          className="flex items-center gap-5 p-5 cursor-pointer hover:bg-[#faf9f7] transition-colors"
                          style={{ borderBottom: "1px solid #e8e4dc" }}
                        >
                          <CheckCircle className="w-6 h-6 text-[#16a34a] shrink-0" />
                          <div className="flex-1">
                            <h5 
                              className="text-[16px] font-bold text-[#2d2d2d]"
                              style={{ fontFamily: "'Roboto', sans-serif" }}
                            >
                              3.1 Creative Formats That Convert
                            </h5>
                            <p 
                              className="text-[13px] text-[#5a5a5a] mt-1 flex items-center gap-1.5 uppercase tracking-wider"
                              style={{ fontFamily: "'Roboto', sans-serif" }}
                            >
                              <Play className="w-3.5 h-3.5" /> Video • 14 min
                            </p>
                          </div>
                          <span 
                            className="text-[12px] font-bold uppercase tracking-wider px-2.5 py-1 rounded"
                            style={{ 
                              fontFamily: "'Roboto', sans-serif",
                              color: "#16a34a",
                              background: "#f0fdf4"
                            }}
                          >
                            Completed
                          </span>
                        </div>

                        {/* Lesson 3.2 - In Progress */}
                        <div 
                          className="flex items-center gap-5 p-5 cursor-pointer"
                          style={{ 
                            borderBottom: "1px solid #e8e4dc",
                            background: "#eff6ff"
                          }}
                        >
                          <PlayCircle className="w-6 h-6 text-[#d97706] shrink-0" />
                          <div className="flex-1">
                            <h5 
                              className="text-[16px] font-bold text-[#1a56db]"
                              style={{ fontFamily: "'Roboto', sans-serif" }}
                            >
                              3.2 Writing Headlines That Convert
                            </h5>
                            <p 
                              className="text-[13px] text-[#1a56db] mt-1 flex items-center gap-1.5 uppercase tracking-wider opacity-80"
                              style={{ fontFamily: "'Roboto', sans-serif" }}
                            >
                              <Play className="w-3.5 h-3.5" /> Video • 22 min
                            </p>
                          </div>
                          <button 
                            className="text-[13px] font-bold px-4 py-2 rounded transition-colors"
                            style={{ 
                              fontFamily: "'Roboto', sans-serif",
                              background: "#1a56db",
                              color: "#ffffff"
                            }}
                          >
                            Resume
                          </button>
                        </div>

                        {/* Lesson 3.3 - Locked */}
                        <div 
                          className="flex items-center gap-5 p-5"
                          style={{ borderBottom: "1px solid #e8e4dc" }}
                        >
                          <Lock className="w-6 h-6 text-[#888] shrink-0" />
                          <div className="flex-1">
                            <h5 
                              className="text-[16px] text-[#888] italic"
                              style={{ fontFamily: "'Roboto', sans-serif" }}
                            >
                              3.3 Image & Video Creative Best Practices
                            </h5>
                            <p 
                              className="text-[13px] text-[#888] mt-1 flex items-center gap-1.5 uppercase tracking-wider"
                              style={{ fontFamily: "'Roboto', sans-serif" }}
                            >
                              <Play className="w-3.5 h-3.5" /> Video • 18 min
                            </p>
                          </div>
                        </div>

                        {/* Lesson 3.4 - Locked */}
                        <div className="flex items-center gap-5 p-5">
                          <Lock className="w-6 h-6 text-[#888] shrink-0" />
                          <div className="flex-1">
                            <h5 
                              className="text-[16px] text-[#888] italic"
                              style={{ fontFamily: "'Roboto', sans-serif" }}
                            >
                              3.4 A/B Testing Your Creatives
                            </h5>
                            <p 
                              className="text-[13px] text-[#888] mt-1 flex items-center gap-1.5 uppercase tracking-wider"
                              style={{ fontFamily: "'Roboto', sans-serif" }}
                            >
                              <Play className="w-3.5 h-3.5" /> Video • 25 min
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Module 4 */}
                <div 
                  className="rounded overflow-hidden"
                  style={{ background: "#ffffff", border: "1px solid #e8e4dc" }}
                >
                  <div className="w-full flex items-center justify-between p-5">
                    <div className="flex items-center gap-5">
                      <div 
                        className="w-10 h-10 rounded-full flex items-center justify-center font-bold text-[16px]"
                        style={{ 
                          fontFamily: "'Roboto', sans-serif",
                          background: "#f5f2ed",
                          color: "#888",
                          border: "1px solid #e8e4dc"
                        }}
                      >
                        4
                      </div>
                      <div>
                        <h4 
                          className="text-[18px] font-bold text-[#888]"
                          style={{ fontFamily: "'Roboto', sans-serif" }}
                        >
                          Landing Page Optimization
                        </h4>
                        <p 
                          className="text-[14px] text-[#888] mt-1"
                          style={{ fontFamily: "'Roboto', sans-serif" }}
                        >
                          3 lessons • 0% Complete
                        </p>
                      </div>
                    </div>
                    <Lock className="w-5 h-5 text-[#888]" />
                  </div>
                </div>

                {/* Module 5 */}
                <div 
                  className="rounded overflow-hidden"
                  style={{ background: "#ffffff", border: "1px solid #e8e4dc" }}
                >
                  <div className="w-full flex items-center justify-between p-5">
                    <div className="flex items-center gap-5">
                      <div 
                        className="w-10 h-10 rounded-full flex items-center justify-center font-bold text-[16px]"
                        style={{ 
                          fontFamily: "'Roboto', sans-serif",
                          background: "#f5f2ed",
                          color: "#888",
                          border: "1px solid #e8e4dc"
                        }}
                      >
                        5
                      </div>
                      <div>
                        <h4 
                          className="text-[18px] font-bold text-[#888]"
                          style={{ fontFamily: "'Roboto', sans-serif" }}
                        >
                          Split Testing Strategies
                        </h4>
                        <p 
                          className="text-[14px] text-[#888] mt-1"
                          style={{ fontFamily: "'Roboto', sans-serif" }}
                        >
                          5 lessons • 0% Complete
                        </p>
                      </div>
                    </div>
                    <Lock className="w-5 h-5 text-[#888]" />
                  </div>
                </div>

                {/* Module 6 */}
                <div 
                  className="rounded overflow-hidden relative"
                  style={{ background: "#ffffff", border: "1px solid #e8e4dc" }}
                >
                  <div 
                    className="absolute top-4 right-5 flex items-center gap-1.5 text-[11px] font-bold px-2 py-1 rounded uppercase tracking-wider"
                    style={{ 
                      fontFamily: "'Roboto', sans-serif",
                      color: "#b45309",
                      background: "#fef3c7",
                      border: "1px solid #fde68a"
                    }}
                  >
                    <Lock className="w-3 h-3" /> Gold+ Required
                  </div>
                  <div className="w-full flex items-center justify-between p-5 pt-8">
                    <div className="flex items-center gap-5">
                      <div 
                        className="w-10 h-10 rounded-full flex items-center justify-center font-bold text-[16px]"
                        style={{ 
                          fontFamily: "'Roboto', sans-serif",
                          background: "#f5f2ed",
                          color: "#888",
                          border: "1px solid #e8e4dc"
                        }}
                      >
                        6
                      </div>
                      <div>
                        <h4 
                          className="text-[18px] font-bold text-[#888]"
                          style={{ fontFamily: "'Roboto', sans-serif" }}
                        >
                          Analytics & Tracking
                        </h4>
                        <p 
                          className="text-[14px] text-[#888] mt-1"
                          style={{ fontFamily: "'Roboto', sans-serif" }}
                        >
                          4 lessons • 0% Complete
                        </p>
                      </div>
                    </div>
                  </div>
                </div>

              </div>
            )}
          </div>

          {/* Track 3 */}
          <div 
            className="rounded overflow-hidden"
            style={{ background: "#ffffff", border: "1px solid #e8e4dc" }}
          >
            <div className="p-7">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                <div className="flex-1">
                  <div className="flex items-center gap-4 mb-3">
                    <span 
                      className="text-[11px] font-bold px-2.5 py-1 rounded uppercase tracking-[2px]"
                      style={{ 
                        fontFamily: "'Roboto', sans-serif",
                        color: "#5a5a5a",
                        background: "#f5f2ed",
                        border: "1px solid #e8e4dc"
                      }}
                    >
                      Track 3
                    </span>
                    <h2 
                      className="text-2xl font-bold text-[#888] flex items-center gap-3"
                      style={{ fontFamily: "'Roboto', sans-serif" }}
                    >
                      Scaling Campaigns <Lock className="w-5 h-5 text-[#888]" />
                    </h2>
                  </div>
                  <p 
                    className="text-[16px] text-[#888] italic mb-5 leading-relaxed"
                    style={{ fontFamily: "'Roboto', sans-serif" }}
                  >
                    Take your profitable campaigns to the next level. Learn vertical and horizontal scaling tactics, budget management, and team building.
                  </p>
                  
                  <div 
                    className="flex items-center gap-6 text-[14px] text-[#888]"
                    style={{ fontFamily: "'Roboto', sans-serif" }}
                  >
                    <div className="flex items-center gap-2">
                      <BookOpen className="w-4 h-4" /> 3 Modules
                    </div>
                    <div className="flex items-center gap-2">
                      <PlayCircle className="w-4 h-4" /> 12 Lessons
                    </div>
                  </div>
                </div>

                <div className="w-full md:w-56 shrink-0">
                  <div 
                    className="rounded p-4 flex flex-col items-center text-center gap-3"
                    style={{ 
                      background: "#f5f2ed",
                      border: "1px dashed #d4cfc7"
                    }}
                  >
                    <Lock className="w-5 h-5 text-[#888]" />
                    <span 
                      className="text-[13px] text-[#5a5a5a]"
                      style={{ fontFamily: "'Roboto', sans-serif" }}
                    >
                      Complete Track 2 to unlock
                    </span>
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
