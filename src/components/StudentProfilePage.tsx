import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  User, Copy, Check, Mail, GraduationCap, Calendar, Star, Phone, AlignLeft, BarChart, 
  Bookmark, FileText, Target, Layers, Award,
  Edit2, Shield, ArrowRight, History
} from 'lucide-react';
import DashboardLayout from './dashboard/DashboardLayout';
import { useProfile } from '../lib/useProfile';
import { cbtLabelForPortal, cbtRouteForPortal } from '../lib/portalRoutes';
import { supabase } from '../supabaseClient';

interface StudentProfilePageProps {
  onLogout: () => void;
  onNavigate?: (view: string) => void;
}

const QUICK_ACTIONS = [
  { label: 'Edit Profile', icon: Edit2, color: 'text-slate-300', id: 'settings', glow: false },
  { label: 'Security & Password', icon: Shield, color: 'text-slate-300', id: 'settings', glow: false },
];

export default function StudentProfilePage({ onLogout, onNavigate }: StudentProfilePageProps) {
  const { profile, loading } = useProfile();
  
  const [stats, setStats] = useState({
    subjects: 0,
    tests: 0,
    avgScore: 0
  });
  
  const [recentActivity, setRecentActivity] = useState<any[]>([]);

  useEffect(() => {
    async function loadData() {
      if (!profile) return;
      try {
        // Completed CBT activity for THIS student, read from the table that
        // actually holds it. UTME sittings live in `utme_attempts` (keyed by
        // student_id); the undergraduate drill in `cbt_attempts` (keyed by
        // user_id). The previous query read `cbt_results`, which the live submit
        // path never writes, so these statistics were permanently zero.
        // All three attempt tables are read unconditionally rather than branching
        // on `profile.portal`. That value is not guaranteed to be exactly 'UTME'
        // (it can be unset), and a wrong guess selected the empty table — a
        // successful query returning nothing, which is why real students saw
        // zeros here. All three tables hold this student's own completed
        // sittings, so reading them together is not mixing unrelated data, and
        // every portal now sees its own activity.
        const [savedRes, utmeRes, cbtRes, postUtmeRes] = await Promise.all([
          // Subjects available to this student — the same UTME subject source the
          // UTME dashboard lists. Replaces the old "Materials Saved" count:
          // materials are not the UTME learning system.
          supabase.from('utme_subjects').select('id', { count: 'exact', head: true }).eq('is_active', true),
          supabase
            .from('utme_attempts')
            .select('score, percentage, created_at, utme_subjects(name)')
            .eq('student_id', profile.id)
            .eq('status', 'completed')
            .order('created_at', { ascending: false }),
          supabase
            .from('cbt_attempts')
            .select('score, end_time, cbt_exams(title)')
            .eq('user_id', profile.id)
            .eq('status', 'completed')
            .order('end_time', { ascending: false }),
          supabase
            .from('post_utme_attempts')
            .select('score, end_time, post_utme_exams(title, subject)')
            .eq('user_id', profile.id)
            .eq('status', 'completed')
            .order('end_time', { ascending: false }),
        ]);

        const attempts: any[] = [
          ...(utmeRes.data || []).map((a: any) => ({
            ...a,
            finishedAt: a.created_at,
            label: a.utme_subjects?.name || 'UTME CBT',
          })),
          ...(cbtRes.data || []).map((a: any) => ({
            ...a,
            finishedAt: a.end_time,
            label: a.cbt_exams?.title || 'CBT Practice',
          })),
          ...(postUtmeRes.data || []).map((a: any) => ({
            ...a,
            finishedAt: a.end_time,
            label: a.post_utme_exams?.title || a.post_utme_exams?.subject || 'Post-UTME CBT',
          })),
        ].sort((a, b) =>
          String(b.finishedAt || '').localeCompare(String(a.finishedAt || '')),
        );

        // `score` is stored as a 0–100 percentage by both submit endpoints, so it
        // is used directly — the old (score / total_questions) * 100 divided an
        // already-percentage value a second time.
        const avgScore =
          attempts.length > 0
            ? Math.round(
                attempts.reduce((acc, a) => acc + Number(a.score ?? a.percentage ?? 0), 0) / attempts.length,
              )
            : 0;

        setStats({
          subjects: savedRes.count || 0,
          tests: attempts.length,
          avgScore,
        });

        const acts = attempts.slice(0, 5).map((a: any) => ({
          title: a.label || 'CBT Test',
          // utme_attempts carries no question total, so the percentage is shown.
          type: `Score: ${Math.round(Number(a.score ?? a.percentage ?? 0))}%`,
          // Same icon and colour as the UTME CBT entry in the sidebar and quick
          // actions, so a student sees these are the same CBT system. Subject,
          // score and date are unchanged.
          icon: Award,
          // end_time is the completion stamp on cbt_attempts; utme_attempts has
          // only created_at, which is when that sitting's row was written.
          time: new Date(a.end_time || a.created_at).toLocaleDateString(),
          color: 'text-emerald-500',
        }));
        setRecentActivity(acts);
      } catch (err) {
        console.error(err);
      }
    }
    loadData();
  }, [profile?.id, profile?.role]);
  
  const STATS = [
    { label: 'Subjects Enrolled', value: stats.subjects.toString(), icon: Layers, color: 'text-blue-500', bg: 'bg-blue-500/10' },
    { label: 'CBT Tests Taken', value: stats.tests.toString(), icon: FileText, color: 'text-purple-500', bg: 'bg-purple-500/10' },
    { label: 'Average Score', value: `${stats.avgScore}%`, icon: Target, color: 'text-emerald-500', bg: 'bg-emerald-500/10' },
  ];

  if (loading) {
    return (
      <DashboardLayout onLogout={onLogout} currentView="profile" onNavigate={onNavigate}>
        <div className="flex items-center justify-center min-h-[50vh]">
          <div className="flex flex-col items-center gap-4">
            <svg className="animate-spin h-8 w-8 text-amber-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            <span className="text-slate-400 font-medium">Loading...</span>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  const studentId = profile?.student_id || '—';
  const fullName = profile?.full_name || '—';
  const email = profile?.email || '—';
  const portal = profile?.portal || '—';
  const course = profile?.course || '—';
  const phone = profile?.phone_number || '—';
  const level = profile?.level || '—';
  const bio = profile?.bio || '—';
  const dateStr = profile?.created_at || profile?.registration_date;
  const regDate = dateStr ? new Date(dateStr).toLocaleDateString() : '—';
  const role = profile?.role || '—';
  const university = profile?.university || '—';
  const avatarUrl = profile?.avatar_url || null;
  const premiumStatus = profile?.premium_status || 'Free';
  const initials = fullName !== '—' ? fullName.split(' ').map((n: string) => n[0]).join('').substring(0, 2).toUpperCase() : 'ST';
  const department = profile?.department || '—';
  const faculty = profile?.faculty || '—';

  const [copied, setCopied] = useState(false);
  const [showToast, setShowToast] = useState(false);
  
  const handleCopyId = () => {
    navigator.clipboard.writeText(studentId);
    setCopied(true);
    setShowToast(true);
    setTimeout(() => {
      setCopied(false);
      setShowToast(false);
    }, 2000);
  };

  return (
    <DashboardLayout onLogout={onLogout} currentView="profile" onNavigate={onNavigate}>
      <div className="relative w-full pb-10">
        
        {/* Toast Notification */}
        <AnimatePresence>
          {showToast && (
            <motion.div
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="fixed top-24 left-1/2 -translate-x-1/2 z-50 bg-emerald-500/90 backdrop-blur-md text-white px-4 py-2 rounded-lg shadow-lg flex items-center gap-2 text-sm font-semibold border border-emerald-400"
            >
              <Check size={16} /> Student ID copied successfully.
            </motion.div>
          )}
        </AnimatePresence>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-6 lg:space-y-8 w-full max-w-7xl mx-auto"
        >
          {/* Header */}
          <div className="flex items-center gap-3 mb-2">
            <User className="text-blue-500" size={28} />
            <h1 className="text-2xl sm:text-3xl font-display font-bold text-white">My Profile</h1>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 lg:gap-8">
            
            {/* Left Column: Profile Card & Quick Actions */}
            <div className="space-y-6 lg:space-y-8">
              
              {/* Profile Card */}
              <div className="bg-[#0f172a]/80 backdrop-blur-md border border-slate-800 rounded-3xl p-6 relative overflow-hidden group">
                <div className="absolute top-0 left-0 w-full h-32 bg-gradient-to-br from-blue-600/20 to-purple-600/20 opacity-50"></div>
                
                <div className="relative flex flex-col items-center text-center mt-4">
                  {/* Avatar */}
                  <div className="w-24 h-24 rounded-full border-4 border-[#020617] bg-slate-800 flex items-center justify-center shadow-xl mb-4 overflow-hidden">
                    {avatarUrl ? (
                      <img loading="lazy" 
                        src={avatarUrl}
                        alt={fullName}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <User size={40} className="text-slate-400" />
                    )}
                  </div>
                  
                  <h2 className="text-xl font-display font-bold text-white mb-1">{fullName}</h2>
                  
                  <div className="flex items-center justify-center gap-2 bg-[#020617]/50 border border-slate-700/50 py-1.5 px-3 rounded-lg mb-6">
                    <span className="text-xs font-mono text-slate-300 tracking-wider select-all">{studentId}</span>
                    <button 
                      onClick={handleCopyId}
                      className="text-slate-400 hover:text-white transition-colors p-1 rounded-md hover:bg-slate-800"
                      title="Copy Student ID"
                    >
                      {copied ? <Check size={14} className="text-emerald-500" /> : <Copy size={14} />}
                    </button>
                  </div>
                </div>

                <div className="space-y-4 relative">
                  <div className="flex items-center gap-3 text-sm">
                    <div className="w-8 h-8 rounded-lg bg-slate-800/50 flex items-center justify-center shrink-0">
                      <Mail size={14} className="text-slate-400" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-0.5">Email Address</p>
                      <p className="text-slate-200 truncate">{email}</p>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-3 text-sm">
                    <div className="w-8 h-8 rounded-lg bg-slate-800/50 flex items-center justify-center shrink-0">
                      <User size={14} className="text-slate-400" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-0.5">Role</p>
                      <p className="text-slate-200 truncate">{role}</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 text-sm">
                    <div className="w-8 h-8 rounded-lg bg-slate-800/50 flex items-center justify-center shrink-0">
                      <Phone size={14} className="text-slate-400" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-0.5">Phone Number</p>
                      <p className="text-slate-200 truncate">{phone}</p>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-3 text-sm">
                    <div className="w-8 h-8 rounded-lg bg-slate-800/50 flex items-center justify-center shrink-0">
                      <GraduationCap size={14} className="text-slate-400" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-0.5">Academic Details</p>
                      <p className="text-slate-200 truncate">{portal} • {course}</p>
                      <p className="text-xs text-slate-400 truncate">{university}</p>
                      {role === 'Lecturer' && (
                        <>
                          <p className="text-xs text-slate-400 truncate mt-1">Dept: {department}</p>
                          <p className="text-xs text-slate-400 truncate">Faculty: {faculty}</p>
                        </>
                      )}
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-3 text-sm">
                    <div className="w-8 h-8 rounded-lg bg-slate-800/50 flex items-center justify-center shrink-0">
                      <BarChart size={14} className="text-slate-400" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-0.5">Level</p>
                      <p className="text-slate-200 truncate">{level}</p>
                    </div>
                  </div>

                  <div className="flex items-start gap-3 text-sm">
                    <div className="w-8 h-8 rounded-lg bg-slate-800/50 flex items-center justify-center shrink-0">
                      <AlignLeft size={14} className="text-slate-400" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-0.5">Bio</p>
                      <p className="text-slate-200 text-sm whitespace-pre-wrap leading-relaxed">{bio}</p>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-3 text-sm">
                    <div className="w-8 h-8 rounded-lg bg-slate-800/50 flex items-center justify-center shrink-0">
                      <Calendar size={14} className="text-slate-400" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-0.5">Registration Date</p>
                      <p className="text-slate-200">Joined {regDate}</p>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-3 text-sm pt-2">
                    <div className="w-8 h-8 rounded-lg bg-amber-500/10 flex items-center justify-center shrink-0 border border-amber-500/20">
                      <Star size={14} className="text-amber-500" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-0.5">Account Type</p>
                      <p className="text-amber-500 font-semibold flex items-center gap-1.5">
                        {premiumStatus} Member <Check size={12} />
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Quick Actions */}
              <div className="bg-[#0f172a]/80 backdrop-blur-md border border-slate-800 rounded-3xl p-6">
                <h3 className="text-lg font-display font-bold text-white mb-4">Quick Actions</h3>
                <div className="space-y-2">
                  {QUICK_ACTIONS.map((action, idx) => (
                    <button 
                      key={idx}
                      onClick={() => onNavigate && onNavigate(action.id)}
                      className={`w-full flex items-center justify-between p-3 rounded-xl transition-all ${
                        action.glow 
                          ? 'bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/20 hover:border-amber-500/40' 
                          : 'bg-[#020617]/50 hover:bg-slate-800 border border-slate-800/50 hover:border-slate-700'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <action.icon size={18} className={action.color} />
                        <span className={`text-sm font-medium ${action.glow ? 'text-amber-500' : 'text-slate-200'}`}>
                          {action.label}
                        </span>
                      </div>
                      <ArrowRight size={14} className={action.glow ? 'text-amber-500/50' : 'text-slate-500'} />
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Right Column: Stats & Recent Activity */}
            <div className="lg:col-span-2 space-y-6 lg:space-y-8">
              
              {/* Stats Grid */}
              <div className="bg-[#0f172a]/80 backdrop-blur-md border border-slate-800 rounded-3xl p-6">
                <h3 className="text-lg font-display font-bold text-white mb-6">Learning Statistics</h3>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  {STATS.map((stat, idx) => (
                    <div 
                      key={idx}
                      className="bg-[#020617]/50 border border-slate-800/50 hover:border-slate-700 rounded-2xl p-4 transition-colors"
                    >
                      <div className={`w-10 h-10 rounded-xl ${stat.bg} flex items-center justify-center mb-3`}>
                        <stat.icon size={20} className={stat.color} />
                      </div>
                      <p className="text-2xl font-display font-bold text-white mb-1">{stat.value}</p>
                      <p className="text-xs font-body text-slate-400">{stat.label}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Recent Activity */}
              <div className="bg-[#0f172a]/80 backdrop-blur-md border border-slate-800 rounded-3xl p-6">
                <div className="flex items-center justify-between mb-6">
                  <h3 className="text-lg font-display font-bold text-white">Recent Activity</h3>
                  <button onClick={() => onNavigate && onNavigate('analytics')} className="text-xs text-blue-500 hover:text-blue-400 font-semibold transition-colors">
                    View All
                  </button>
                </div>
                
                <div className="space-y-4">
                  {recentActivity.length === 0 ? (
                    <div className="text-center py-8 bg-[#020617]/50 rounded-2xl border border-slate-800/50">
                      <History className="w-12 h-12 text-slate-700 mx-auto mb-3" />
                      <p className="text-slate-400 font-medium">No recent activity found</p>
                    </div>
                  ) : recentActivity.map((activity, idx) => (
                    <div 
                      key={idx}
                      className="flex items-start gap-4 p-4 rounded-2xl bg-[#020617]/50 border border-slate-800/50 hover:border-slate-700 transition-colors"
                    >
                      <div className={`w-10 h-10 rounded-xl bg-[#0f172a] border border-slate-800 flex items-center justify-center shrink-0`}>
                        <activity.icon size={18} className={activity.color} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h4 className="text-sm font-display font-bold text-white truncate mb-1">
                          {activity.title}
                        </h4>
                        <div className="flex items-center gap-2 text-[10px] text-slate-400">
                          <span className="uppercase tracking-wider">{activity.type}</span>
                          <span>•</span>
                          <span>{activity.time}</span>
                        </div>
                      </div>
                      {/* Each programme keeps its practice history in its own
                          CBT centre, and the profile decides which. This
                          hardcoded the UTME centre, so an Undergraduate student
                          was sent to the wrong page; before that it pointed at
                          'courses', a route that no longer exists at all. */}
                      <button
                        onClick={() => onNavigate && onNavigate(cbtRouteForPortal(profile?.portal))}
                        aria-label={`Open ${cbtLabelForPortal(profile?.portal)} history`}
                        className="p-2 rounded-full hover:bg-slate-800 text-slate-400 hover:text-white transition-colors shrink-0"
                      >
                        <ArrowRight size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
              
            </div>
            
          </div>
        </motion.div>
      </div>
          </DashboardLayout>
  );
}
