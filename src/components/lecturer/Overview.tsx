import { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { BookOpen, FileText, Library, Users, Calendar, UploadCloud, Clock } from 'lucide-react';
import { useProfile } from '../../lib/useProfile';
import { supabase } from '../../supabaseClient';

export default function Overview() {
  const { profile } = useProfile();
  const displayName = profile?.full_name || "Lecturer";
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good Morning' : hour < 18 ? 'Good Afternoon' : 'Good Evening';

  const [stats, setStats] = useState({
    courses: 0,
    active_courses: 0,
    cbt: 0,
    students: 0,
    materials: 0,
    published: 0,
    uploadsThisWeek: 0,
  });

  /**
   * Teaching time on this lecturer's own exams over the last seven days.
   *
   * This is the closest thing to a real "work" metric the data supports: it is
   * the wall-clock time students spent sitting this lecturer's CBT papers, which
   * is what the lecturer actually produced. It is deliberately NOT a count of
   * logins — nothing on the platform records lecturer presence, and an invented
   * number is worse than an absent one.
   */
  const [teachingMinutes, setTeachingMinutes] = useState(0);

  const [recentActivities, setRecentActivities] = useState<any[]>([]);

  useEffect(() => {
    if (profile) {
      fetchStats();
      fetchRecentActivity();
    }
  }, [profile?.id, profile?.role]);

  // Real average across completed sittings on this lecturer's own exams.
  // The panel used to print a hardcoded "78%" with a "+5% from last semester"
  // that no query ever produced.
  const [avgPerformance, setAvgPerformance] = useState<{ avg: number; sittings: number }>({
    avg: 0,
    sittings: 0,
  });

  const fetchStats = async () => {
    if (!supabase || !profile) return;
    try {
      const [coursesRes, cbtRes, enrollmentsRes] = await Promise.all([
        supabase.from('courses').select('id, is_archived, course_code').eq('lecturer_id', profile.id),
        // lecturer/CBTManagement.tsx writes cbt_exams with `created_by`, not
        // `lecturer_id` (no such column), so counting by lecturer_id always
        // reported 0 exams.
        supabase.from('cbt_exams').select('id', { count: 'exact', head: true }).eq('created_by', profile.id),
        supabase.from('course_enrollments').select('student_id, courses!inner(lecturer_id)').eq('courses.lecturer_id', profile.id)
      ]);

      const courses = coursesRes.data || [];
      const uniqueStudentCount = new Set((enrollmentsRes.data || []).map((e: any) => e.student_id)).size;

      // Materials are scoped by COURSE CODE, not by `materials.lecturer_id`.
      // The column is written by LessonEditor/MaterialUploadModal but is not part
      // of any materials DDL in this repo, so filtering on it is one migration
      // away from an empty list. The lecturer's own course codes are the join the
      // rest of the dashboard already uses (Course Settings, the student viewer).
      const courseCodes = Array.from(
        new Set(courses.map((c: any) => c.course_code).filter(Boolean))
      ) as string[];

      const weekAgo = new Date();
      weekAgo.setDate(weekAgo.getDate() - 7);
      const weekAgoIso = weekAgo.toISOString();

      let materialTotal = 0;
      let materialPublished = 0;
      let materialThisWeek = 0;

      if (courseCodes.length > 0) {
        const { data: mats } = await supabase
          .from('materials')
          .select('id, is_published, created_at')
          .in('course_code', courseCodes);

        for (const m of (mats || []) as any[]) {
          materialTotal++;
          if (m.is_published) materialPublished++;
          if (m.created_at && new Date(m.created_at).toISOString() >= weekAgoIso) materialThisWeek++;
        }
      }

      setStats({
        courses: courses.length,
        active_courses: courses.filter(c => !c.is_archived).length,
        cbt: cbtRes.count || 0,
        students: uniqueStudentCount,
        materials: materialTotal,
        published: materialPublished,
        uploadsThisWeek: materialThisWeek,
      });

      // Average student performance across this lecturer's exams. Scoped by
      // `created_by` for the same reason the CBT count above is — cbt_exams has
      // no lecturer_id column. `score` is already a 0–100 percentage.
      const { data: ownExams } = await supabase
        .from('cbt_exams')
        .select('id')
        .eq('created_by', profile.id);
      const examIds = (ownExams || []).map((e: any) => e.id);

      if (examIds.length === 0) {
        setAvgPerformance({ avg: 0, sittings: 0 });
        setTeachingMinutes(0);
      } else {
        const { data: sittings } = await supabase
          .from('cbt_attempts')
          .select('score, start_time, end_time')
          .eq('status', 'completed')
          .not('score', 'is', null)
          .in('exam_id', examIds);

        const scores = (sittings || [])
          .map((s: any) => Number(s.score))
          .filter((n: number) => !Number.isNaN(n));
        setAvgPerformance({
          avg: scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0,
          sittings: scores.length,
        });

        // Teaching minutes over the last 7 days, summed from the sittings that
        // carry both timestamps. A row missing either is skipped rather than
        // counted as zero-length, so an incomplete attempt never drags the
        // average down.
        const weekAgo = new Date();
        weekAgo.setDate(weekAgo.getDate() - 7);
        let minutes = 0;
        for (const s of (sittings || []) as any[]) {
          if (!s.start_time || !s.end_time) continue;
          const start = new Date(s.start_time).getTime();
          const end = new Date(s.end_time).getTime();
          if (Number.isNaN(start) || Number.isNaN(end) || end < start) continue;
          if (start < weekAgo.getTime()) continue;
          minutes += (end - start) / 60000;
        }
        setTeachingMinutes(Math.round(minutes));
      }
    } catch (e) {
      console.error(e);
    }
  };

  const fetchRecentActivity = async () => {
    if (!supabase || !profile) return;
    try {
      const { data } = await supabase.from('courses').select('title, created_at').eq('lecturer_id', profile.id).order('created_at', { ascending: false }).limit(5);
      if (data && data.length > 0) {
        setRecentActivities(data.map((c, i) => ({ id: i, type: 'course', text: `You created ${c.title}`, time: new Date(c.created_at).toLocaleDateString(), icon: BookOpen, color: 'text-emerald-500' })));
      } else {
        setRecentActivities([]);
      }
    } catch (err) { console.error(err); }
  };

  /** Human duration for the teaching-time tile, e.g. 135 -> "2h 15m". */
  const formatDuration = (mins: number) => {
    if (!mins) return '0m';
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  };

  const STATS_DATA = [
    { label: 'Total Courses', value: stats.courses, icon: BookOpen, color: 'text-indigo-500', bg: 'bg-indigo-500/10' },
    { label: 'Active Courses', value: stats.active_courses, icon: Library, color: 'text-emerald-500', bg: 'bg-emerald-500/10' },
    { label: 'Total Students', value: stats.students, icon: Users, color: 'text-blue-500', bg: 'bg-blue-500/10' },
    { label: 'CBT Exams Created', value: stats.cbt, icon: FileText, color: 'text-cyan-500', bg: 'bg-cyan-500/10' },
    // Real activity rather than a restatement of the course list: what this
    // lecturer has actually produced, and what students have actually done with
    // it in the last seven days.
    { label: 'Materials Published', value: `${stats.published} / ${stats.materials}`, icon: UploadCloud, color: 'text-violet-500', bg: 'bg-violet-500/10' },
    { label: 'Uploaded This Week', value: stats.uploadsThisWeek, icon: UploadCloud, color: 'text-amber-500', bg: 'bg-amber-500/10' },
    { label: 'Teaching Time (7d)', value: formatDuration(teachingMinutes), icon: Clock, color: 'text-rose-500', bg: 'bg-rose-500/10' },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-8 max-w-7xl mx-auto"
    >
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-sm text-slate-400 mb-2">
            <Calendar size={14} />
            <span>{today}</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-display font-bold text-white mb-2">
            {greeting}, {displayName}
          </h1>
          <p className="text-sm font-body text-slate-400">
            Manage your courses and track student performance.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 lg:gap-6">
        {STATS_DATA.map((stat, idx) => (
          <div key={idx} className="bg-[#0f172a]/80 backdrop-blur-md border border-slate-800 rounded-3xl p-6 hover:border-slate-700 transition-colors">
            <div className="flex items-start justify-between mb-4">
              <div className={`w-12 h-12 rounded-2xl ${stat.bg} flex items-center justify-center`}>
                <stat.icon size={24} className={stat.color} />
              </div>
            </div>
            <h3 className="text-3xl font-display font-bold text-white mb-1">{stat.value}</h3>
            <p className="text-sm text-slate-400 font-medium">{stat.label}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-[#0f172a] border border-slate-800 rounded-3xl p-6 shadow-xl">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-xl font-display font-bold text-white">Average Student Performance</h3>
            <select className="bg-slate-900 border border-slate-800 text-slate-300 text-sm rounded-lg px-3 py-1.5 focus:outline-none focus:border-amber-500">
              <option>This Semester</option>
              <option>Last Semester</option>
              <option>All Time</option>
            </select>
          </div>
          
          <div className="h-64 flex items-center justify-center border-2 border-dashed border-slate-800 rounded-2xl">
             {avgPerformance.sittings > 0 ? (
               <div className="text-center">
                 <div className="text-4xl mb-4 text-emerald-500 font-bold">{avgPerformance.avg}%</div>
                 <p className="text-slate-400 text-sm">Average across all your courses</p>
                 <p className="text-xs text-slate-500 mt-2">
                   From {avgPerformance.sittings} completed sitting
                   {avgPerformance.sittings === 1 ? '' : 's'}
                 </p>
               </div>
             ) : (
               <div className="text-center px-6">
                 <div className="text-4xl mb-4 text-slate-600 font-bold">—</div>
                 <p className="text-slate-400 text-sm">No completed sittings yet</p>
                 <p className="text-xs text-slate-500 mt-2">
                   Averages appear once students take one of your CBT exams.
                 </p>
               </div>
             )}
          </div>
        </div>

        <div className="bg-[#0f172a] border border-slate-800 rounded-3xl p-6 shadow-xl">
          <h3 className="text-xl font-display font-bold text-white mb-6">Recent Activity</h3>
          
          <div className="space-y-6">
            {recentActivities.length > 0 ? recentActivities.map((activity) => (
              <div key={activity.id} className="flex gap-4">
                <div className={`w-10 h-10 rounded-full bg-slate-900 flex items-center justify-center shrink-0 border border-slate-800 ${activity.color}`}>
                  <activity.icon size={16} />
                </div>
                <div>
                  <p className="text-sm text-slate-300 font-medium leading-snug">{activity.text}</p>
                  <p className="text-xs text-slate-500 mt-1">{activity.time}</p>
                </div>
              </div>
            )) : (
              <div className="text-center py-8">
                <p className="text-slate-400 font-medium">No recent activity.</p>
              </div>
            )}
          </div>
          
          <button className="w-full mt-6 py-3 border border-slate-800 rounded-xl text-slate-400 text-sm font-semibold hover:text-white hover:bg-slate-800 transition-colors">
            View All Activity
          </button>
        </div>
      </div>
    </motion.div>
  );
}
